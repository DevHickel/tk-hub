-- Adicionar colunas DMS à tabela documents existente
-- A tabela documents já existe com (id int, content, embedding, metadata)
-- Adicionamos as colunas necessárias para o DMS sem recriar a tabela

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

-- Comentário explicando os valores possíveis de status
COMMENT ON COLUMN public.documents.status IS 'queued | processing | active | expired | error | archived';
COMMENT ON COLUMN public.documents.source IS 'upload | email';
