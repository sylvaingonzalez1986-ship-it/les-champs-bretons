-- Fix mutable search_path for handle_profile_as_producer
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'handle_profile_as_producer'
  ) THEN
    ALTER FUNCTION public.handle_profile_as_producer() SET search_path = '';
  END IF;
END $$;
