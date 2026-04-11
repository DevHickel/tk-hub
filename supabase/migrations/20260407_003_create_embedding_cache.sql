-- Cache de embeddings — evita recalcular embeddings idênticos
-- Economiza custo de API da OpenAI (text-embedding-3-small)

CREATE TABLE IF NOT EXISTS public.embedding_cache (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  hash text NOT NULL UNIQUE,       -- sha256 do texto
  embedding vector(1536) NOT NULL,
  text_preview text,               -- primeiros 100 chars para debug
  hit_count int DEFAULT 1,         -- quantas vezes foi reutilizado
  created_at timestamptz DEFAULT now()
);

-- Índice no hash para lookup O(1)
CREATE INDEX IF NOT EXISTS embedding_cache_hash_idx
  ON public.embedding_cache (hash);

-- RLS
ALTER TABLE public.embedding_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY IF NOT EXISTS "authenticated read embedding_cache"
  ON public.embedding_cache
  FOR SELECT
  USING (auth.role() = 'authenticated');
