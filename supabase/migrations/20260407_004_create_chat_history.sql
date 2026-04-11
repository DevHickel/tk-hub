-- Histórico de perguntas e respostas do RAG
-- Separado da tabela messages (que é para o chat UI)
-- Registra modelo usado e tokens consumidos para analytics de custo

CREATE TABLE IF NOT EXISTS public.chat_history (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES auth.users(id),
  question text NOT NULL,
  answer text NOT NULL,
  chunks_used jsonb,        -- IDs dos chunks usados como contexto
  model_used text,          -- 'gpt-4o-mini' | 'gpt-4o'
  tokens_used int,          -- total de tokens consumidos
  created_at timestamptz DEFAULT now()
);

-- Índice para busca por usuário
CREATE INDEX IF NOT EXISTS chat_history_user_id_idx
  ON public.chat_history (user_id);

-- RLS
ALTER TABLE public.chat_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY IF NOT EXISTS "authenticated read chat_history"
  ON public.chat_history
  FOR SELECT
  USING (auth.role() = 'authenticated');
