-- Upgrade modelo de embedding: text-embedding-3-small → text-embedding-3-large
-- O modelo large usa dimensions=1536 (truncado via API), então as colunas
-- permanecem vector(1536) — sem mudança de schema. A qualidade melhora porque
-- o modelo large tem representações mais ricas mesmo truncadas (Matryoshka).
--
-- IMPORTANTE: após aplicar, re-processar todos os documentos RAG (excluir + re-upload)

-- ============================================================================
-- 1. Limpar dados incompatíveis (embeddings antigos gerados com modelo small)
-- ============================================================================
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'embedding_cache') THEN
    TRUNCATE TABLE public.embedding_cache;
    RAISE NOTICE 'embedding_cache limpa';
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'chunk_feedback') THEN
    DELETE FROM public.chunk_feedback;
    RAISE NOTICE 'chunk_feedback limpa';
  END IF;
END $$;

-- ============================================================================
-- 2. Nullificar embeddings antigos nos documentos (forçar re-geração)
-- ============================================================================
UPDATE public.documents SET embedding = NULL WHERE embedding IS NOT NULL;

-- ============================================================================
-- 3. Recriar RPCs (sem mudança de tipo, apenas refresh)
-- ============================================================================

-- hybrid_search (já existe com vector(1536), recriar para garantir)
DROP FUNCTION IF EXISTS public.hybrid_search(text, text, int);

CREATE OR REPLACE FUNCTION public.hybrid_search(
  query_text      text,
  query_embedding text,
  match_count     int DEFAULT 5
)
RETURNS TABLE(
  id         bigint,
  content    text,
  metadata   jsonb,
  similarity float
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
AS $$
DECLARE
  embedding_vector vector(1536);
BEGIN
  embedding_vector := query_embedding::vector;

  RETURN QUERY
  WITH semantic AS (
    SELECT
      d.id::bigint AS sid,
      d.content AS scontent,
      d.metadata AS smetadata,
      (1 - (d.embedding <=> embedding_vector))::float AS ssimilarity
    FROM public.documents d
    WHERE d.embedding IS NOT NULL
      AND d.content IS NOT NULL
    ORDER BY d.embedding <=> embedding_vector
    LIMIT match_count * 2
  ),
  keyword AS (
    SELECT
      d.id::bigint AS kid,
      d.content AS kcontent,
      d.metadata AS kmetadata,
      ts_rank(
        to_tsvector('portuguese', coalesce(d.content, '')),
        plainto_tsquery('portuguese', query_text)
      )::float AS ksimilarty
    FROM public.documents d
    WHERE d.content IS NOT NULL
      AND to_tsvector('portuguese', coalesce(d.content, '')) @@ plainto_tsquery('portuguese', query_text)
    LIMIT match_count * 2
  ),
  combined AS (
    SELECT sid AS id, scontent AS content, smetadata AS metadata, ssimilarity AS similarity FROM semantic
    UNION ALL
    SELECT kid, kcontent, kmetadata, ksimilarty FROM keyword
  )
  SELECT DISTINCT ON (c.id)
    c.id, c.content, c.metadata, c.similarity
  FROM combined c
  ORDER BY c.id, c.similarity DESC
  LIMIT match_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.hybrid_search(text, text, int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.hybrid_search(text, text, int) TO service_role;

-- match_documents_with_feedback (recriar para garantir consistência)
DROP FUNCTION IF EXISTS public.match_documents_with_feedback(vector, int, float, float, float);
DROP FUNCTION IF EXISTS public.match_documents_with_feedback(vector(1536), int, float, float, float);

CREATE OR REPLACE FUNCTION public.match_documents_with_feedback(
  query_embedding vector(1536),
  match_count int default 10,
  global_weight float default 0.01,
  context_weight float default 0.15,
  context_threshold float default 0.7
)
RETURNS TABLE (
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
LANGUAGE sql STABLE AS $$
  WITH base AS (
    SELECT d.id, d.content, d.metadata, d.file_name,
           greatest(-20, least(20, d.feedback_score)) AS clamped_score,
           d.feedback_score,
           (1 - (d.embedding <=> query_embedding))::float AS base_sim
    FROM public.documents d
    WHERE d.embedding IS NOT NULL
    ORDER BY d.embedding <=> query_embedding
    LIMIT match_count * 3
  ),
  ctx AS (
    SELECT cf.chunk_id,
           sum(
             cf.score::float * (1 - (cf.question_embedding <=> query_embedding))
           ) FILTER (
             WHERE (1 - (cf.question_embedding <=> query_embedding)) >= context_threshold
           ) AS ctx_boost
    FROM public.chunk_feedback cf
    WHERE cf.chunk_id IN (SELECT base.id FROM base)
    GROUP BY cf.chunk_id
  )
  SELECT b.id, b.content, b.metadata, b.file_name,
         (b.base_sim + (b.clamped_score * global_weight) + coalesce(ctx.ctx_boost, 0) * context_weight)::float AS similarity,
         b.base_sim::float AS base_similarity,
         (b.clamped_score * global_weight)::float AS global_boost,
         (coalesce(ctx.ctx_boost, 0) * context_weight)::float AS contextual_boost,
         b.feedback_score
  FROM base b
  LEFT JOIN ctx ON ctx.chunk_id = b.id
  ORDER BY similarity DESC
  LIMIT match_count;
$$;

GRANT EXECUTE ON FUNCTION public.match_documents_with_feedback(vector(1536), int, float, float, float)
  TO authenticated, service_role;

-- apply_chunk_feedback (recriar para garantir consistência)
DROP FUNCTION IF EXISTS public.apply_chunk_feedback(bigint[], uuid, text, text, vector, smallint);
DROP FUNCTION IF EXISTS public.apply_chunk_feedback(bigint[], uuid, text, text, vector(1536), smallint);

CREATE OR REPLACE FUNCTION public.apply_chunk_feedback(
  p_chunk_ids bigint[],
  p_user_id uuid,
  p_question text,
  p_question_hash text,
  p_question_embedding vector(1536),
  p_score smallint
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  cid bigint;
  old_score smallint;
  delta smallint;
BEGIN
  FOREACH cid IN ARRAY p_chunk_ids LOOP
    SELECT score INTO old_score
    FROM public.chunk_feedback
    WHERE chunk_id = cid AND user_id = p_user_id AND question_hash = p_question_hash;

    INSERT INTO public.chunk_feedback
      (chunk_id, user_id, question, question_hash, question_embedding, score)
    VALUES (cid, p_user_id, p_question, p_question_hash, p_question_embedding, p_score)
    ON CONFLICT (chunk_id, user_id, question_hash) DO UPDATE
      SET score = excluded.score,
          created_at = now();

    delta := p_score - coalesce(old_score, 0);

    IF delta <> 0 THEN
      UPDATE public.documents
      SET feedback_score = feedback_score + delta
      WHERE id = cid;
    END IF;
  END LOOP;
END $$;

GRANT EXECUTE ON FUNCTION public.apply_chunk_feedback(bigint[], uuid, text, text, vector(1536), smallint)
  TO service_role;
