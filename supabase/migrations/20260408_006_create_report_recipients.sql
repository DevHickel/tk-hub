-- Report recipients
CREATE TABLE IF NOT EXISTS report_recipients (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email       text NOT NULL,
  name        text NOT NULL,
  report_type text NOT NULL CHECK (report_type IN ('management', 'hr', 'it', 'all')),
  active      boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS report_recipients_email_type
  ON report_recipients (email, report_type);

ALTER TABLE report_recipients ENABLE ROW LEVEL SECURITY;

CREATE POLICY "report_recipients_select" ON report_recipients
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "report_recipients_modify" ON report_recipients
  FOR ALL TO authenticated
  USING     ((auth.jwt() ->> 'role') IN ('admin', 'manager', 'tk_master'))
  WITH CHECK ((auth.jwt() ->> 'role') IN ('admin', 'manager', 'tk_master'));
