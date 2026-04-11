-- Hybrid search function for RAG pipeline
-- Combines semantic (vector) search with keyword search

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
    SELECT id, content, metadata, similarity FROM semantic
    UNION
    SELECT id, content, metadata, similarity FROM keyword
  )
  SELECT DISTINCT ON (id)
    id, content, metadata, similarity
  FROM combined
  ORDER BY id, similarity DESC
  LIMIT match_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.hybrid_search(text, text, int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.hybrid_search(text, text, int) TO service_role;
