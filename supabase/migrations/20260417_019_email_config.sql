-- Configuração SMTP para envio de emails (singleton)
CREATE TABLE IF NOT EXISTS email_config (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider      text NOT NULL DEFAULT 'smtp' CHECK (provider IN ('smtp')),
  smtp_host     text NOT NULL DEFAULT '',
  smtp_port     int NOT NULL DEFAULT 587,
  smtp_user     text NOT NULL DEFAULT '',
  smtp_pass     text NOT NULL DEFAULT '',
  from_name     text NOT NULL DEFAULT 'TK Solution',
  from_email    text NOT NULL DEFAULT '',
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS email_config_singleton ON email_config ((true));
INSERT INTO email_config DEFAULT VALUES ON CONFLICT DO NOTHING;

ALTER TABLE email_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "email_config_select" ON email_config FOR SELECT TO authenticated
  USING ((auth.jwt() ->> 'role') IN ('admin', 'tk_master'));

CREATE POLICY "email_config_modify" ON email_config FOR ALL TO authenticated
  USING ((auth.jwt() ->> 'role') IN ('admin', 'tk_master'))
  WITH CHECK ((auth.jwt() ->> 'role') IN ('admin', 'tk_master'));
