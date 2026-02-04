-- Enable RLS on public.rate_limits and deny access for non-service roles
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'rate_limits'
  ) THEN
    ALTER TABLE public.rate_limits ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.rate_limits FORCE ROW LEVEL SECURITY;

    DROP POLICY IF EXISTS "rate_limits_no_access" ON public.rate_limits;
    CREATE POLICY "rate_limits_no_access"
      ON public.rate_limits
      FOR ALL
      USING (false)
      WITH CHECK (false);
  END IF;
END $$;
