-- Fix mutable search_path for get_upload_statistics
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'get_upload_statistics'
  ) THEN
    ALTER FUNCTION public.get_upload_statistics(integer) SET search_path = '';
  END IF;
END $$;
