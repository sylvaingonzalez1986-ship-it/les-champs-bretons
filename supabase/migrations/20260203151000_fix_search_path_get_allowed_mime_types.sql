-- Fix mutable search_path for get_allowed_mime_types
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'get_allowed_mime_types'
  ) THEN
    ALTER FUNCTION public.get_allowed_mime_types(text) SET search_path = '';
  END IF;
END $$;
