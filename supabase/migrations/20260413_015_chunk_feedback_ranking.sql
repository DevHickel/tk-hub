-- Loop de aprendizado por feedback no RAG
-- Boost duplo: global (barato, sempre ativo) + contextual (por embedding da pergunta)

-- ============================================================================
-- A. Score global agregado no chunk
-- ============================================================================
alter table public.documents
  add column if not exists feedback_score int not null default 0;

create index if not exists idx_documents_feedback_score
  on public.documents(feedback_score);

-- ============================================================================
-- B. Feedback contextual — source of truth com embedding da pergunta
-- ============================================================================
create table if not exists public.chunk_feedback (
  id uuid primary key default gen_random_uuid(),
  chunk_id bigint not null references public.documents(id) on delete cascade,
  user_id uuid not null references auth.users(id),
  question text not null,
  question_hash text not null,
  question_embedding vector(1536) not null,
  score smallint not null check (score in (-1, 1)),
  created_at timestamptz default now(),
  unique (chunk_id, user_id, question_hash)
);

create index if not exists idx_chunk_feedback_chunk_id
  on public.chunk_feedback(chunk_id);

create index if not exists idx_chunk_feedback_embedding
  on public.chunk_feedback using ivfflat (question_embedding vector_cosine_ops)
  with (lists = 100);

alter table public.chunk_feedback enable row level security;

drop policy if exists "authenticated can read chunk_feedback" on public.chunk_feedback;
create policy "authenticated can read chunk_feedback"
  on public.chunk_feedback for select
  using (auth.role() = 'authenticated');

drop policy if exists "authenticated can insert own chunk_feedback" on public.chunk_feedback;
create policy "authenticated can insert own chunk_feedback"
  on public.chunk_feedback for insert
  with check (auth.uid() = user_id);

drop policy if exists "authenticated can update own chunk_feedback" on public.chunk_feedback;
create policy "authenticated can update own chunk_feedback"
  on public.chunk_feedback for update
  using (auth.uid() = user_id);

-- ============================================================================
-- C. Link mensagem do chat → chat_history (para feedback sobreviver a reloads)
-- ============================================================================
alter table public.messages
  add column if not exists chat_history_id uuid references public.chat_history(id) on delete set null;

create index if not exists idx_messages_chat_history_id
  on public.messages(chat_history_id);

-- ============================================================================
-- D. RPC de retrieval com boost duplo (global + contextual)
-- ============================================================================
drop function if exists public.match_documents_with_feedback(vector, int, float, float, float);

create or replace function public.match_documents_with_feedback(
  query_embedding vector(1536),
  match_count int default 10,
  global_weight float default 0.01,
  context_weight float default 0.15,
  context_threshold float default 0.7
)
returns table (
  id bigint,
  content text,
  metadata jsonb,
  file_name text,
  similarity float,
  base_similarity float,
  global_boost float,
  contextual_boost float,
  feedback_score int
)
language sql stable as $$
  with base as (
    select d.id, d.content, d.metadata, d.file_name,
           greatest(-20, least(20, d.feedback_score)) as clamped_score,
           d.feedback_score,
           1 - (d.embedding <=> query_embedding) as base_sim
    from public.documents d
    where d.embedding is not null
    order by d.embedding <=> query_embedding
    limit match_count * 3
  ),
  ctx as (
    select cf.chunk_id,
           sum(
             cf.score::float * (1 - (cf.question_embedding <=> query_embedding))
           ) filter (
             where (1 - (cf.question_embedding <=> query_embedding)) >= context_threshold
           ) as ctx_boost
    from public.chunk_feedback cf
    where cf.chunk_id in (select id from base)
    group by cf.chunk_id
  )
  select b.id, b.content, b.metadata, b.file_name,
         b.base_sim
           + (b.clamped_score * global_weight)
           + coalesce(ctx.ctx_boost, 0) * context_weight as similarity,
         b.base_sim as base_similarity,
         b.clamped_score * global_weight as global_boost,
         coalesce(ctx.ctx_boost, 0) * context_weight as contextual_boost,
         b.feedback_score
  from base b
  left join ctx on ctx.chunk_id = b.id
  order by similarity desc
  limit match_count;
$$;

grant execute on function public.match_documents_with_feedback(vector, int, float, float, float)
  to authenticated, service_role;

-- ============================================================================
-- E. RPC para aplicar feedback atomicamente
-- Trata insert, update (reversão de voto) e delta correto no agregado global
-- ============================================================================
drop function if exists public.apply_chunk_feedback(bigint[], uuid, text, text, vector, smallint);

create or replace function public.apply_chunk_feedback(
  p_chunk_ids bigint[],
  p_user_id uuid,
  p_question text,
  p_question_hash text,
  p_question_embedding vector(1536),
  p_score smallint
) returns void
language plpgsql security definer as $$
declare
  cid bigint;
  old_score smallint;
  delta smallint;
begin
  foreach cid in array p_chunk_ids loop
    -- Captura voto anterior (se existir) para calcular delta correto
    select score into old_score
    from public.chunk_feedback
    where chunk_id = cid and user_id = p_user_id and question_hash = p_question_hash;

    -- Upsert: dedup por (chunk_id, user_id, question_hash)
    insert into public.chunk_feedback
      (chunk_id, user_id, question, question_hash, question_embedding, score)
    values (cid, p_user_id, p_question, p_question_hash, p_question_embedding, p_score)
    on conflict (chunk_id, user_id, question_hash) do update
      set score = excluded.score,
          created_at = now();

    -- Delta correto: se não havia voto antes, delta = p_score; se havia, delta = p_score - old_score
    delta := p_score - coalesce(old_score, 0);

    if delta <> 0 then
      update public.documents
      set feedback_score = feedback_score + delta
      where id = cid;
    end if;
  end loop;
end $$;

grant execute on function public.apply_chunk_feedback(bigint[], uuid, text, text, vector, smallint)
  to service_role;
