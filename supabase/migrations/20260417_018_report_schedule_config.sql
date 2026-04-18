-- Adiciona colunas de agendamento ao report_config
-- send_day: 0=domingo, 1=segunda... 6=sábado
-- send_hour: 0-23 (horário de Brasília)

ALTER TABLE report_config
  ADD COLUMN IF NOT EXISTS send_day int NOT NULL DEFAULT 0
    CHECK (send_day BETWEEN 0 AND 6),
  ADD COLUMN IF NOT EXISTS send_hour int NOT NULL DEFAULT 0
    CHECK (send_hour BETWEEN 0 AND 23);
