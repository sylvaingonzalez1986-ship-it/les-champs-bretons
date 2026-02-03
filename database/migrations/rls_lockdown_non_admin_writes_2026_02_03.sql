-- Lock down direct writes for non-admins
-- Tables: user_subscriptions, user_stats, lots, lot_items, pro_orders

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'user_subscriptions') THEN
    ALTER TABLE user_subscriptions ENABLE ROW LEVEL SECURITY;
    ALTER TABLE user_subscriptions FORCE ROW LEVEL SECURITY;

    DROP POLICY IF EXISTS "user_subscriptions_select_own" ON user_subscriptions;
    DROP POLICY IF EXISTS "user_subscriptions_select_admin" ON user_subscriptions;
    DROP POLICY IF EXISTS "user_subscriptions_insert_admin" ON user_subscriptions;
    DROP POLICY IF EXISTS "user_subscriptions_update_admin" ON user_subscriptions;
    DROP POLICY IF EXISTS "user_subscriptions_delete_admin" ON user_subscriptions;

    CREATE POLICY "user_subscriptions_select_own"
      ON user_subscriptions FOR SELECT
      USING (user_id = auth.uid());

    CREATE POLICY "user_subscriptions_select_admin"
      ON user_subscriptions FOR SELECT
      USING (is_admin());

    CREATE POLICY "user_subscriptions_insert_admin"
      ON user_subscriptions FOR INSERT
      WITH CHECK (is_admin());

    CREATE POLICY "user_subscriptions_update_admin"
      ON user_subscriptions FOR UPDATE
      USING (is_admin())
      WITH CHECK (is_admin());

    CREATE POLICY "user_subscriptions_delete_admin"
      ON user_subscriptions FOR DELETE
      USING (is_admin());
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'user_stats') THEN
    ALTER TABLE user_stats ENABLE ROW LEVEL SECURITY;
    ALTER TABLE user_stats FORCE ROW LEVEL SECURITY;

    DROP POLICY IF EXISTS "user_stats_select_own" ON user_stats;
    DROP POLICY IF EXISTS "user_stats_select_admin" ON user_stats;
    DROP POLICY IF EXISTS "user_stats_insert_admin" ON user_stats;
    DROP POLICY IF EXISTS "user_stats_update_admin" ON user_stats;
    DROP POLICY IF EXISTS "user_stats_delete_admin" ON user_stats;

    CREATE POLICY "user_stats_select_own"
      ON user_stats FOR SELECT
      USING (user_id = auth.uid());

    CREATE POLICY "user_stats_select_admin"
      ON user_stats FOR SELECT
      USING (is_admin());

    CREATE POLICY "user_stats_insert_admin"
      ON user_stats FOR INSERT
      WITH CHECK (is_admin());

    CREATE POLICY "user_stats_update_admin"
      ON user_stats FOR UPDATE
      USING (is_admin())
      WITH CHECK (is_admin());

    CREATE POLICY "user_stats_delete_admin"
      ON user_stats FOR DELETE
      USING (is_admin());
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'lots') THEN
    ALTER TABLE lots ENABLE ROW LEVEL SECURITY;
    ALTER TABLE lots FORCE ROW LEVEL SECURITY;

    DROP POLICY IF EXISTS "lots_select_all" ON lots;
    DROP POLICY IF EXISTS "lots_insert_admin" ON lots;
    DROP POLICY IF EXISTS "lots_update_admin" ON lots;
    DROP POLICY IF EXISTS "lots_delete_admin" ON lots;

    CREATE POLICY "lots_select_all"
      ON lots FOR SELECT
      USING (true);

    CREATE POLICY "lots_insert_admin"
      ON lots FOR INSERT
      WITH CHECK (is_admin());

    CREATE POLICY "lots_update_admin"
      ON lots FOR UPDATE
      USING (is_admin())
      WITH CHECK (is_admin());

    CREATE POLICY "lots_delete_admin"
      ON lots FOR DELETE
      USING (is_admin());
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'lot_items') THEN
    ALTER TABLE lot_items ENABLE ROW LEVEL SECURITY;
    ALTER TABLE lot_items FORCE ROW LEVEL SECURITY;

    DROP POLICY IF EXISTS "lot_items_select_all" ON lot_items;
    DROP POLICY IF EXISTS "lot_items_insert_admin" ON lot_items;
    DROP POLICY IF EXISTS "lot_items_update_admin" ON lot_items;
    DROP POLICY IF EXISTS "lot_items_delete_admin" ON lot_items;

    CREATE POLICY "lot_items_select_all"
      ON lot_items FOR SELECT
      USING (true);

    CREATE POLICY "lot_items_insert_admin"
      ON lot_items FOR INSERT
      WITH CHECK (is_admin());

    CREATE POLICY "lot_items_update_admin"
      ON lot_items FOR UPDATE
      USING (is_admin())
      WITH CHECK (is_admin());

    CREATE POLICY "lot_items_delete_admin"
      ON lot_items FOR DELETE
      USING (is_admin());
  END IF;
END $$;

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

    CREATE POLICY "pro_orders_select_own"
      ON pro_orders FOR SELECT
      USING (pro_user_id = auth.uid());

    CREATE POLICY "pro_orders_select_admin"
      ON pro_orders FOR SELECT
      USING (is_admin());

    CREATE POLICY "pro_orders_insert_admin"
      ON pro_orders FOR INSERT
      WITH CHECK (is_admin());

    CREATE POLICY "pro_orders_update_admin"
      ON pro_orders FOR UPDATE
      USING (is_admin())
      WITH CHECK (is_admin());

    CREATE POLICY "pro_orders_delete_admin"
      ON pro_orders FOR DELETE
      USING (is_admin());
  END IF;
END $$;
