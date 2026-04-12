-- Support certificate renewal: track which upload triggered a renewal
ALTER TABLE public.processed_certificates
  ADD COLUMN IF NOT EXISTS renewed_from uuid NULL,
  ADD COLUMN IF NOT EXISTS renewed_at timestamptz NULL;

COMMENT ON COLUMN public.processed_certificates.renewed_from IS 'ID of the temporary upload row that triggered the most recent renewal';
COMMENT ON COLUMN public.processed_certificates.renewed_at IS 'Timestamp of the most recent renewal';
