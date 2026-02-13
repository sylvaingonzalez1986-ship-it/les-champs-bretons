-- Fix prevent_device_id_change for search_path='' safety
-- Ensures function call resolves explicitly and cannot fail on lookup.

CREATE OR REPLACE FUNCTION public.prevent_device_id_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path TO ''
AS $func$
BEGIN
  IF NEW.device_id IS DISTINCT FROM OLD.device_id THEN
    IF auth.role() <> 'service_role' AND NOT public.is_admin() THEN
      RAISE EXCEPTION 'device_id is immutable';
    END IF;
  END IF;
  RETURN NEW;
END;
$func$;
