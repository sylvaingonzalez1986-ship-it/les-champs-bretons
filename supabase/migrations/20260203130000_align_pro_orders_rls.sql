-- Align pro_orders RLS with Edge Function behavior (pro/admin inserts via user JWT)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'pro_orders') THEN
    ALTER TABLE pro_orders ENABLE ROW LEVEL SECURITY;
    ALTER TABLE pro_orders FORCE ROW LEVEL SECURITY;

    DROP POLICY IF EXISTS "pro_orders_select_own" ON pro_orders;
    DROP POLICY IF EXISTS "pro_orders_select_admin" ON pro_orders;
    DROP POLICY IF EXISTS "pro_orders_insert_admin" ON pro_orders;
    DROP POLICY IF EXISTS "pro_orders_update_admin" ON pro_orders;
    DROP POLICY IF EXISTS "pro_orders_delete_admin" ON pro_orders;
    DROP POLICY IF EXISTS "pro_orders_insert_pro" ON pro_orders;
    DROP POLICY IF EXISTS "pro_orders_update_own" ON pro_orders;

    CREATE POLICY "pro_orders_select_own"
      ON pro_orders FOR SELECT
      USING (pro_user_id = auth.uid());

    CREATE POLICY "pro_orders_select_admin"
      ON pro_orders FOR SELECT
      USING (is_admin());

    CREATE POLICY "pro_orders_insert_pro"
      ON pro_orders FOR INSERT
      WITH CHECK (
        pro_user_id = auth.uid()
        AND EXISTS (
          SELECT 1 FROM profiles
          WHERE id = auth.uid() AND role IN ('pro', 'admin')
        )
      );

    CREATE POLICY "pro_orders_update_own"
      ON pro_orders FOR UPDATE
      USING (pro_user_id = auth.uid())
      WITH CHECK (
        pro_user_id = auth.uid()
        AND EXISTS (
          SELECT 1 FROM profiles
          WHERE id = auth.uid() AND role IN ('pro', 'admin')
        )
      );

    CREATE POLICY "pro_orders_delete_admin"
      ON pro_orders FOR DELETE
      USING (is_admin());
  END IF;
END $$;
