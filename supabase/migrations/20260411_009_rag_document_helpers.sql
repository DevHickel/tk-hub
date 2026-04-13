-- Step 1: Add DMS columns to documents table (if not already added)
ALTER TABLE public.documents
  ADD COLUMN IF NOT EXISTS uploaded_by uuid REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS file_name text,
  ADD COLUMN IF NOT EXISTS file_path text,
  ADD COLUMN IF NOT EXISTS file_hash text,
  ADD COLUMN IF NOT EXISTS tipo text,
  ADD COLUMN IF NOT EXISTS numero text,
  ADD COLUMN IF NOT EXISTS colaborador text,
  ADD COLUMN IF NOT EXISTS data_emissao date,
  ADD COLUMN IF NOT EXISTS data_vencimento date,
  ADD COLUMN IF NOT EXISTS emissor text,
  ADD COLUMN IF NOT EXISTS source text DEFAULT 'upload',
  ADD COLUMN IF NOT EXISTS status text DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

-- Step 2: Helper function: count distinct RAG source files
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

-- Step 3: Helper function: list distinct RAG source files
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
