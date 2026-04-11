-- Tabela de chunks para RAG pipeline
-- Cada documento DMS é dividido em chunks com embedding individual

CREATE TABLE IF NOT EXISTS public.document_chunks (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  document_id int REFERENCES public.documents(id) ON DELETE CASCADE,
  content text NOT NULL,
  chunk_index int NOT NULL,
  embedding vector(1536),
  created_at timestamptz DEFAULT now()
);

-- Índice vetorial para busca por similaridade (ivfflat)
CREATE INDEX IF NOT EXISTS document_chunks_embedding_idx
  ON public.document_chunks
  USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);

-- Índice full-text em português para busca híbrida
CREATE INDEX IF NOT EXISTS document_chunks_fts_idx
  ON public.document_chunks
  USING gin(to_tsvector('portuguese', content));

-- RLS
ALTER TABLE public.document_chunks ENABLE ROW LEVEL SECURITY;

CREATE POLICY IF NOT EXISTS "authenticated read document_chunks"
  ON public.document_chunks
  FOR SELECT
  USING (auth.role() = 'authenticated');

-- Backend usa service key — bypassa RLS para writes
