-- Adiciona campo de custo fixo mensal de infraestrutura ao report_config
-- Usado no cálculo de ROI: economia / (custo IA + custo fixo semanal)

ALTER TABLE report_config
  ADD COLUMN IF NOT EXISTS monthly_fixed_cost_brl numeric(10,2) NOT NULL DEFAULT 0;

COMMENT ON COLUMN report_config.monthly_fixed_cost_brl IS
  'Custo fixo mensal de infraestrutura (VPS, domínio, licenças, agência, etc). Dividido por 4.33 para obter custo semanal no cálculo de ROI.';
