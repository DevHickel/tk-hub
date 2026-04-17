-- Upgrade embeddings de text-embedding-3-small (1536 dims) para text-embedding-3-large (3072 dims)
-- IMPORTANTE: após aplicar esta migration, é necessário:
-- 1. Limpar a tabela embedding_cache (embeddings antigos são incompatíveis)
-- 2. Re-processar todos os documentos RAG (excluir + re-upload)

-- ============================================================================
-- 1. Limpar dados incompatíveis
-- ============================================================================
TRUNCATE TABLE public.embedding_cache;
DELETE FROM public.chunk_feedback;

-- ============================================================================
-- 2. Alterar colunas de embedding para vector(3072)
-- ============================================================================

-- documents.embedding: stored as text/jsonb, cast em queries via ::vector
-- A coluna pode ser text ou vector — vamos garantir que o index aceite 3072

-- Drop indices antigos que dependem de vector(1536)
DROP INDEX IF EXISTS idx_documents_embedding;
DROP INDEX IF EXISTS documents_embedding_idx;

-- Alterar tipo se for vector nativo
DO $$
BEGIN
  -- Tentar alterar de vector(1536) para vector(3072)
  -- Se a coluna for text, isso falha silenciosamente e não tem problema
  -- porque o cast ::vector aceita qualquer dimensão
  BEGIN
    ALTER TABLE public.documents
      ALTER COLUMN embedding TYPE vector(3072)
      USING embedding::vector(3072);
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'documents.embedding não é vector nativo, pulando ALTER TYPE';
  END;
END $$;

-- Recriar index IVFFlat para 3072 dims
CREATE INDEX IF NOT EXISTS idx_documents_embedding
  ON public.documents USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);

-- ============================================================================
-- 3. chunk_feedback.question_embedding → vector(3072)
-- ============================================================================
DROP INDEX IF EXISTS idx_chunk_feedback_embedding;

ALTER TABLE public.chunk_feedback
  ALTER COLUMN question_embedding TYPE vector(3072)
  USING question_embedding::vector(3072);

CREATE INDEX IF NOT EXISTS idx_chunk_feedback_embedding
  ON public.chunk_feedback USING ivfflat (question_embedding vector_cosine_ops)
  WITH (lists = 100);

-- ============================================================================
-- 4. Recriar RPCs com vector(3072)
-- ============================================================================

-- hybrid_search
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
  embedding_vector vector(3072);
BEGIN
  embedding_vector := query_embedding::vector;

  RETURN QUERY
  WITH semantic AS (
    SELECT
      d.id::bigint,
      d.content,
      d.metadata,
      1 - (d.embedding <=> embedding_vector) AS similarity
    FROM public.documents d
    WHERE d.embedding IS NOT NULL
      AND d.content IS NOT NULL
    ORDER BY d.embedding <=> embedding_vector
    LIMIT match_count * 2
  ),
  keyword AS (
    SELECT
      d.id::bigint,
      d.content,
      d.metadata,
      ts_rank(
        to_tsvector('portuguese', coalesce(d.content, '')),
        plainto_tsquery('portuguese', query_text)
      ) AS similarity
    FROM public.documents d
    WHERE d.content IS NOT NULL
      AND to_tsvector('portuguese', coalesce(d.content, '')) @@ plainto_tsquery('portuguese', query_text)
    LIMIT match_count * 2
  ),
  combined AS (
    SELECT sid AS id, scontent AS content, smetadata AS metadata, ssimilarity AS similarity FROM (SELECT id AS sid, content AS scontent, metadata AS smetadata, similarity AS ssimilarity FROM semantic) s
    UNION
    SELECT kid AS id, kcontent AS content, kmetadata AS metadata, ksimilarity AS similarity FROM (SELECT id AS kid, content AS kcontent, metadata AS kmetadata, similarity AS ksimilarity FROM keyword) k
  )
  SELECT DISTINCT ON (combined.id)
    combined.id, combined.content, combined.metadata, combined.similarity
  FROM combined
  ORDER BY combined.id, combined.similarity DESC
  LIMIT match_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.hybrid_search(text, text, int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.hybrid_search(text, text, int) TO service_role;

-- match_documents_with_feedback
DROP FUNCTION IF EXISTS public.match_documents_with_feedback(vector, int, float, float, float);
DROP FUNCTION IF EXISTS public.match_documents_with_feedback(vector(1536), int, float, float, float);

CREATE OR REPLACE FUNCTION public.match_documents_with_feedback(
  query_embedding vector(3072),
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
           1 - (d.embedding <=> query_embedding) AS base_sim
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
         b.base_sim
           + (b.clamped_score * global_weight)
           + coalesce(ctx.ctx_boost, 0) * context_weight AS similarity,
         b.base_sim AS base_similarity,
         b.clamped_score * global_weight AS global_boost,
         coalesce(ctx.ctx_boost, 0) * context_weight AS contextual_boost,
         b.feedback_score
  FROM base b
  LEFT JOIN ctx ON ctx.chunk_id = b.id
  ORDER BY similarity DESC
  LIMIT match_count;
$$;

GRANT EXECUTE ON FUNCTION public.match_documents_with_feedback(vector(3072), int, float, float, float)
  TO authenticated, service_role;

-- apply_chunk_feedback
DROP FUNCTION IF EXISTS public.apply_chunk_feedback(bigint[], uuid, text, text, vector, smallint);
DROP FUNCTION IF EXISTS public.apply_chunk_feedback(bigint[], uuid, text, text, vector(1536), smallint);

CREATE OR REPLACE FUNCTION public.apply_chunk_feedback(
  p_chunk_ids bigint[],
  p_user_id uuid,
  p_question text,
  p_question_hash text,
  p_question_embedding vector(3072),
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

GRANT EXECUTE ON FUNCTION public.apply_chunk_feedback(bigint[], uuid, text, text, vector(3072), smallint)
  TO service_role;
