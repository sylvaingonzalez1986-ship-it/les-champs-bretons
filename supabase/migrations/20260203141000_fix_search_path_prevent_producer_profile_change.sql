-- Fix mutable search_path for prevent_producer_profile_change
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'prevent_producer_profile_change'
  ) THEN
    ALTER FUNCTION public.prevent_producer_profile_change() SET search_path = '';
  END IF;
END $$;
