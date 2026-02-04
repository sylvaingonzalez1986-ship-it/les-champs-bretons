-- Fix mutable search_path for update_user_tickets_timestamp
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'update_user_tickets_timestamp'
  ) THEN
    ALTER FUNCTION public.update_user_tickets_timestamp() SET search_path = '';
  END IF;
END $$;
