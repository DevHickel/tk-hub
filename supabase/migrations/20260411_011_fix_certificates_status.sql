-- Fix processed_certificates status logic
-- Problem: certs with expiry_date < today are being auto-rejected/deleted
-- by an existing trigger. This migration removes that behavior and replaces
-- it with a clean 'expired' status instead.

-- 1. Drop any trigger that auto-rejects or deletes expired certs
DO $$
DECLARE
  trig RECORD;
BEGIN
  FOR trig IN
    SELECT trigger_name
    FROM information_schema.triggers
    WHERE event_object_table = 'processed_certificates'
      AND event_object_schema = 'public'
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.processed_certificates', trig.trigger_name);
    RAISE NOTICE 'Dropped trigger: %', trig.trigger_name;
  END LOOP;
END;
$$;

-- 2. Ensure status column accepts all valid values (no restrictive CHECK)
ALTER TABLE public.processed_certificates
  DROP CONSTRAINT IF EXISTS processed_certificates_status_check;

ALTER TABLE public.processed_certificates
  DROP CONSTRAINT IF EXISTS certificates_status_check;

-- 3. Fix any existing certs currently marked as 'rejected' that have
--    expiry_date populated — they were likely auto-rejected by the old trigger.
--    Restore them to 'expired' so they appear correctly.
UPDATE public.processed_certificates
SET status = 'expired'
WHERE status = 'rejected'
  AND expiry_date IS NOT NULL
  AND rejection_reason IS NULL; -- no manual rejection reason = auto-rejected

-- 4. Mark all certs whose expiry_date has already passed as 'expired'
--    (not pending, not approved — they are historically expired)
UPDATE public.processed_certificates
SET status = 'expired'
WHERE expiry_date IS NOT NULL
  AND expiry_date < CURRENT_DATE
  AND status IN ('pending', 'approved');

-- 5. Create a clean trigger: when expiry_date passes, set status = 'expired'
--    Runs on INSERT and UPDATE so newly uploaded expired certs are handled correctly.
CREATE OR REPLACE FUNCTION public.fn_auto_expire_certificate()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  -- If expiry_date is in the past and status is not manually reviewed, mark expired
  IF NEW.expiry_date IS NOT NULL
     AND NEW.expiry_date < CURRENT_DATE
     AND NEW.status NOT IN ('rejected', 'expired', 'processing', 'error')
  THEN
    NEW.status := 'expired';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_auto_expire_certificate
BEFORE INSERT OR UPDATE ON public.processed_certificates
FOR EACH ROW
EXECUTE FUNCTION public.fn_auto_expire_certificate();
