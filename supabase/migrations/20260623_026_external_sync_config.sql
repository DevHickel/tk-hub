-- Infra de integração com APIs externas (TK Solution e futuros).
-- Fase 0: preparar o terreno antes da TK fornecer credenciais.
--
-- external_sync_config: 1 row por provider ('tk', etc.). Guarda secret hash,
--   URL base pra polling outbound, token, e estatísticas.
-- external_sync_events: histórico de cada webhook recebido / sincronização
--   pra debug e auditoria.
-- documents.external_id: liga documento RAG à entidade original na TK,
--   permite idempotência (mesmo external_id não duplica).

CREATE TABLE IF NOT EXISTS public.external_sync_config (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider            text NOT NULL UNIQUE,
  active              boolean NOT NULL DEFAULT false,
  webhook_secret_hash text,                  -- sha256(secret); secret bruto só admin vê 1x na geração
  base_url            text,                  -- URL base da API outbound (polling/download)
  api_token           text,                  -- token outbound (mascarado nos GETs)
  last_event_at       timestamptz,
  last_error          text,
  events_count        int NOT NULL DEFAULT 0,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.external_sync_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "external_sync_config_admin_all" ON public.external_sync_config;
CREATE POLICY "external_sync_config_admin_all" ON public.external_sync_config
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin'));

CREATE TABLE IF NOT EXISTS public.external_sync_events (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider      text NOT NULL,
  event_type    text NOT NULL,             -- ex: 'procedure.created'
  external_id   text,                       -- ID na TK (PR-001, etc.)
  status        text NOT NULL,              -- 'received' | 'processed' | 'error' | 'skipped'
  payload       jsonb,
  error_message text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_external_sync_events_provider_created
  ON public.external_sync_events (provider, created_at DESC);

ALTER TABLE public.external_sync_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "external_sync_events_admin_select" ON public.external_sync_events;
CREATE POLICY "external_sync_events_admin_select" ON public.external_sync_events
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role IN ('admin','manager')));

-- Backend escreve/lê com service_role, que bypassa RLS — sem policy de INSERT/UPDATE.

-- Linkar documento RAG ao external_id de origem (TK)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='documents') THEN
    EXECUTE 'ALTER TABLE public.documents ADD COLUMN IF NOT EXISTS external_id text';
    EXECUTE 'ALTER TABLE public.documents ADD COLUMN IF NOT EXISTS external_provider text';
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_documents_external_provider_id ON public.documents (external_provider, external_id)';
  END IF;
END $$;
