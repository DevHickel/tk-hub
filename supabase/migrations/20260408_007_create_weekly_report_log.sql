-- Weekly report execution log
CREATE TABLE IF NOT EXISTS weekly_report_log (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_type       text NOT NULL CHECK (report_type IN ('management', 'hr', 'it')),
  week_start        date NOT NULL,
  week_end          date NOT NULL,
  recipients_count  int NOT NULL DEFAULT 0,
  metrics_snapshot  jsonb,
  status            text NOT NULL DEFAULT 'sent' CHECK (status IN ('sent', 'failed')),
  error_message     text,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS weekly_report_log_week
  ON weekly_report_log (week_start DESC);

ALTER TABLE weekly_report_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "weekly_report_log_select" ON weekly_report_log
  FOR SELECT TO authenticated
  USING ((auth.jwt() ->> 'role') IN ('admin', 'manager', 'tk_master'));
