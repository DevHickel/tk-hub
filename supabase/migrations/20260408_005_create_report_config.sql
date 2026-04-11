-- Report configuration (single row table)
CREATE TABLE IF NOT EXISTS report_config (
  id                         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  language                   text NOT NULL DEFAULT 'pt' CHECK (language IN ('pt', 'en')),
  hour_cost_brl              numeric(8,2) NOT NULL DEFAULT 35,
  benchmark_search_min       int NOT NULL DEFAULT 8,
  benchmark_doc_process_min  int NOT NULL DEFAULT 25,
  benchmark_alert_min        int NOT NULL DEFAULT 5,
  benchmark_email_triage_min int NOT NULL DEFAULT 10,
  updated_at                 timestamptz NOT NULL DEFAULT now()
);

-- Garante que sempre exista apenas 1 linha
CREATE UNIQUE INDEX IF NOT EXISTS report_config_singleton ON report_config ((true));

-- Semente com valores padrão
INSERT INTO report_config DEFAULT VALUES
  ON CONFLICT DO NOTHING;

ALTER TABLE report_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "report_config_select" ON report_config
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "report_config_modify" ON report_config
  FOR ALL TO authenticated
  USING     ((auth.jwt() ->> 'role') IN ('admin', 'manager', 'tk_master'))
  WITH CHECK ((auth.jwt() ->> 'role') IN ('admin', 'manager', 'tk_master'));
