-- Novos campos pro certificado: duração da validade, conteúdo programático,
-- e tags de NR (Norma Regulamentadora). Tudo opcional — registros existentes
-- mantêm NULL e o worker preenche conforme for re-extraindo.

ALTER TABLE public.processed_certificates
  ADD COLUMN IF NOT EXISTS validade_meses integer,
  ADD COLUMN IF NOT EXISTS conteudo_programatico text,
  ADD COLUMN IF NOT EXISTS nr_codes text[];

COMMENT ON COLUMN public.processed_certificates.validade_meses IS
  'Duração da validade em meses (ex: 12, 24). NULL quando não informado no certificado e sem completion+expiry pra inferir.';

COMMENT ON COLUMN public.processed_certificates.conteudo_programatico IS
  'Conteúdo programático / ementa do treinamento (texto longo). Mostrado só no painel lateral.';

COMMENT ON COLUMN public.processed_certificates.nr_codes IS
  'Lista de Normas Regulamentadoras associadas (ex: {"NR-6","NR-33"}). Exibido como badges.';

CREATE INDEX IF NOT EXISTS idx_processed_certificates_nr_codes
  ON public.processed_certificates USING gin (nr_codes);
