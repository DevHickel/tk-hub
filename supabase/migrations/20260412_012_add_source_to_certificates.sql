-- Add source column to track how the certificate was entered
ALTER TABLE public.processed_certificates
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'upload';

-- Existing rows are all from upload; no backfill needed
COMMENT ON COLUMN public.processed_certificates.source IS 'How the certificate was entered: upload (AI extraction) or manual';
