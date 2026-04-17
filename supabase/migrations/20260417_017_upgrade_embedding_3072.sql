-- Upgrade embeddings de text-embedding-3-small (1536 dims) para text-embedding-3-large (3072 dims)
-- IMPORTANTE: após aplicar esta migration, é necessário:
-- 1. Re-processar todos os documentos RAG (excluir + re-upload)

-- ============================================================================
-- 0. Garantir que enable_vector_extension existe
-- ============================================================================
CREATE EXTENSION IF NOT EXISTS vector;

-- ============================================================================
-- 1. Limpar dados incompatíveis (tabelas podem não existir)
-- ============================================================================
DO $$
BEGIN
  -- embedding_cache pode não existir em todos os ambientes
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'embedding_cache') THEN
    TRUNCATE TABLE public.embedding_cache;
    RAISE NOTICE 'embedding_cache limpa';
  END IF;

  -- chunk_feedback sempre existe (migration 015)
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'chunk_feedback') THEN
    DELETE FROM public.chunk_feedback;
    RAISE NOTICE 'chunk_feedback limpa';
  END IF;
END $$;

-- ============================================================================
-- 2. documents.embedding → vector(3072)
-- ============================================================================
DROP INDEX IF EXISTS idx_documents_embedding;
DROP INDEX IF EXISTS documents_embedding_idx;

DO $$
BEGIN
  ALTER TABLE public.documents
    ALTER COLUMN embedding TYPE vector(3072)
    USING NULL;
  RAISE NOTICE 'documents.embedding alterado para vector(3072)';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'documents.embedding: %', SQLERRM;
END $$;

-- Recriar index IVFFlat
-- IVFFlat precisa de ao menos 100 rows para lists=100; usamos HNSW que não tem esse requisito
CREATE INDEX IF NOT EXISTS idx_documents_embedding
  ON public.documents USING hnsw (embedding vector_cosine_ops);

-- ============================================================================
-- 3. chunk_feedback.question_embedding → vector(3072)
-- ============================================================================
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'chunk_feedback') THEN
    DROP INDEX IF EXISTS idx_chunk_feedback_embedding;

    ALTER TABLE public.chunk_feedback
      ALTER COLUMN question_embedding TYPE vector(3072)
      USING NULL;

    CREATE INDEX idx_chunk_feedback_embedding
      ON public.chunk_feedback USING hnsw (question_embedding vector_cosine_ops);

    RAISE NOTICE 'chunk_feedback.question_embedding alterado para vector(3072)';
  END IF;
END $$;

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
      d.id::bigint AS id,
      d.content,
      d.metadata,
      (1 - (d.embedding <=> embedding_vector))::float AS similarity
    FROM public.documents d
    WHERE d.embedding IS NOT NULL
      AND d.content IS NOT NULL
    ORDER BY d.embedding <=> embedding_vector
    LIMIT match_count * 2
  ),
  keyword AS (
    SELECT
      d.id::bigint AS id,
      d.content,
      d.metadata,
      ts_rank(
        to_tsvector('portuguese', coalesce(d.content, '')),
        plainto_tsquery('portuguese', query_text)
      )::float AS similarity
    FROM public.documents d
    WHERE d.content IS NOT NULL
      AND to_tsvector('portuguese', coalesce(d.content, '')) @@ plainto_tsquery('portuguese', query_text)
    LIMIT match_count * 2
  ),
  combined AS (
    SELECT * FROM semantic
    UNION ALL
    SELECT * FROM keyword
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

-- match_documents_with_feedback
DROP FUNCTION IF EXISTS public.match_documents_with_feedback(vector, int, float, float, float);
DROP FUNCTION IF EXISTS public.match_documents_with_feedback(vector(1536), int, float, float, float);
DROP FUNCTION IF EXISTS public.match_documents_with_feedback(vector(3072), int, float, float, float);

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

GRANT EXECUTE ON FUNCTION public.match_documents_with_feedback(vector(3072), int, float, float, float)
  TO authenticated, service_role;

-- apply_chunk_feedback
DROP FUNCTION IF EXISTS public.apply_chunk_feedback(bigint[], uuid, text, text, vector, smallint);
DROP FUNCTION IF EXISTS public.apply_chunk_feedback(bigint[], uuid, text, text, vector(1536), smallint);
DROP FUNCTION IF EXISTS public.apply_chunk_feedback(bigint[], uuid, text, text, vector(3072), smallint);

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
