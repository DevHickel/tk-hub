-- Contas de email monitoradas para extração automática de certificados via IMAP

CREATE TABLE IF NOT EXISTS certificate_email_accounts (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  label            text NOT NULL DEFAULT 'Caixa de certificados',
  imap_host        text NOT NULL,
  imap_port        int NOT NULL DEFAULT 993,
  imap_user        text NOT NULL,
  imap_pass        text NOT NULL,
  use_tls          boolean NOT NULL DEFAULT true,
  active           boolean NOT NULL DEFAULT true,
  last_uid         int NOT NULL DEFAULT 0,
  uid_validity     int NOT NULL DEFAULT 0,
  last_checked_at  timestamptz,
  last_error       text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE certificate_email_accounts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "cert_email_select" ON certificate_email_accounts
  FOR SELECT TO authenticated
  USING ((auth.jwt() ->> 'role') IN ('admin', 'tk_master'));

CREATE POLICY "cert_email_modify" ON certificate_email_accounts
  FOR ALL TO authenticated
  USING ((auth.jwt() ->> 'role') IN ('admin', 'tk_master'))
  WITH CHECK ((auth.jwt() ->> 'role') IN ('admin', 'tk_master'));

-- Adicionar coluna de rastreamento de email de origem nos certificados
ALTER TABLE public.processed_certificates
  ADD COLUMN IF NOT EXISTS source_email text;

COMMENT ON COLUMN public.processed_certificates.source_email IS
  'Email de origem quando o certificado foi recebido via monitoramento IMAP';
