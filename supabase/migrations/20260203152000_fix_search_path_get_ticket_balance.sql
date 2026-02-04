-- Fix mutable search_path for get_ticket_balance
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'get_ticket_balance'
  ) THEN
    ALTER FUNCTION public.get_ticket_balance(uuid) SET search_path = '';
  END IF;
END $$;
