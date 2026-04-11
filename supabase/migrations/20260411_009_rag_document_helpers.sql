-- Helper function: count distinct RAG source files
-- New uploads use file_name; old chunks use metadata->>'source'
CREATE OR REPLACE FUNCTION public.count_rag_documents()
RETURNS bigint
LANGUAGE sql STABLE SECURITY DEFINER
AS $$
  SELECT COUNT(DISTINCT COALESCE(file_name, metadata->>'source'))
  FROM public.documents
  WHERE COALESCE(file_name, metadata->>'source') IS NOT NULL;
$$;

GRANT EXECUTE ON FUNCTION public.count_rag_documents() TO authenticated;

-- Helper function: list distinct RAG source files
CREATE OR REPLACE FUNCTION public.list_rag_documents()
RETURNS TABLE(
  source_name text,
  file_name   text,
  status      text,
  source      text,
  created_at  timestamptz,
  chunk_count bigint,
  ids         bigint[]
)
LANGUAGE sql STABLE SECURITY DEFINER
AS $$
  SELECT
    COALESCE(d.file_name, d.metadata->>'source')          AS source_name,
    d.file_name,
    d.status,
    d.source,
    MIN(d.created_at)                                     AS created_at,
    COUNT(*)                                              AS chunk_count,
    ARRAY_AGG(d.id ORDER BY d.id)                         AS ids
  FROM public.documents d
  WHERE COALESCE(d.file_name, d.metadata->>'source') IS NOT NULL
  GROUP BY
    COALESCE(d.file_name, d.metadata->>'source'),
    d.file_name,
    d.status,
    d.source
  ORDER BY MIN(d.created_at) DESC;
$$;

GRANT EXECUTE ON FUNCTION public.list_rag_documents() TO authenticated;
