-- Fix mutable search_path for update_pro_orders_updated_at
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'update_pro_orders_updated_at'
  ) THEN
    ALTER FUNCTION public.update_pro_orders_updated_at() SET search_path = '';
  END IF;
END $$;
