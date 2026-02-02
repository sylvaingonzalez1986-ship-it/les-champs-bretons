-- ==========================================================================
-- SECURITY HARDENING: RLS + Immutable Ownership
-- Date: 2026-01-31
-- Scope: orders, producers, commandes_vente_directe, lignes_commande_vente_directe
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1) PRODUCERS: tighten insert/update/delete policies + immutable profile_id
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'producers') THEN
    ALTER TABLE producers ENABLE ROW LEVEL SECURITY;

    DROP POLICY IF EXISTS "producers_select" ON producers;
    DROP POLICY IF EXISTS "producers_update_own" ON producers;
    DROP POLICY IF EXISTS "producers_update_admin" ON producers;
    DROP POLICY IF EXISTS "producers_insert_admin" ON producers;
    DROP POLICY IF EXISTS "producers_delete" ON producers;

    -- Public read access (non-sensitive producer data). Keep if needed for marketplace.
    CREATE POLICY "producers_select"
    ON producers FOR SELECT
    USING (true);

    -- Only the linked profile can update their producer
    CREATE POLICY "producers_update_own"
    ON producers FOR UPDATE
    USING (auth.uid() = profile_id)
    WITH CHECK (auth.uid() = profile_id);

    -- Admins can update any producer
    CREATE POLICY "producers_update_admin"
    ON producers FOR UPDATE
    USING (is_admin())
    WITH CHECK (is_admin());

    -- Admins only can insert new producers
    CREATE POLICY "producers_insert_admin"
    ON producers FOR INSERT
    WITH CHECK (is_admin() OR auth.role() = 'service_role');

    -- Only admins can delete producers
    CREATE POLICY "producers_delete"
    ON producers FOR DELETE
    USING (is_admin());

    -- Immutable ownership: prevent profile_id changes
    CREATE OR REPLACE FUNCTION prevent_producer_profile_change()
    RETURNS TRIGGER AS $$
    BEGIN
      IF NEW.profile_id IS DISTINCT FROM OLD.profile_id THEN
        RAISE EXCEPTION 'profile_id is immutable';
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;

    DROP TRIGGER IF EXISTS producers_profile_immutable ON producers;
    CREATE TRIGGER producers_profile_immutable
      BEFORE UPDATE ON producers
      FOR EACH ROW
      EXECUTE FUNCTION prevent_producer_profile_change();
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 2) ORDERS: strict RLS + immutable user/customer identity
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'orders') THEN
    ALTER TABLE orders ENABLE ROW LEVEL SECURITY;

    DROP POLICY IF EXISTS "orders_select" ON orders;
    DROP POLICY IF EXISTS "orders_select_enhanced" ON orders;
    DROP POLICY IF EXISTS "orders_insert" ON orders;
    DROP POLICY IF EXISTS "orders_insert_authenticated" ON orders;
    DROP POLICY IF EXISTS "orders_update" ON orders;
    DROP POLICY IF EXISTS "orders_update_own" ON orders;
    DROP POLICY IF EXISTS "orders_delete" ON orders;
    DROP POLICY IF EXISTS "orders_delete_admin" ON orders;

    CREATE POLICY "orders_select_secure"
    ON orders FOR SELECT
    TO authenticated
    USING (
      customer_email = auth.email()
      OR (user_id IS NOT NULL AND user_id = auth.uid())
      OR is_admin()
      OR EXISTS (
        SELECT 1 FROM jsonb_array_elements(items) AS item
        WHERE (item->>'producer_id')::TEXT IN (
          SELECT id FROM producers WHERE profile_id = auth.uid()
        )
      )
    );

    CREATE POLICY "orders_insert_own"
    ON orders FOR INSERT
    TO authenticated
    WITH CHECK (
      user_id = auth.uid()
      AND customer_email = auth.email()
    );

    -- Only admins and producers can update orders (no customer writes)
    CREATE POLICY "orders_update_admin_producer"
    ON orders FOR UPDATE
    TO authenticated
    USING (
      is_admin()
      OR EXISTS (
        SELECT 1 FROM jsonb_array_elements(items) AS item
        WHERE (item->>'producer_id')::TEXT IN (
          SELECT id FROM producers WHERE profile_id = auth.uid()
        )
      )
    )
    WITH CHECK (
      is_admin()
      OR EXISTS (
        SELECT 1 FROM jsonb_array_elements(items) AS item
        WHERE (item->>'producer_id')::TEXT IN (
          SELECT id FROM producers WHERE profile_id = auth.uid()
        )
      )
    );

    CREATE POLICY "orders_delete_admin"
    ON orders FOR DELETE
    TO authenticated
    USING (is_admin());

    -- Immutable ownership: prevent changing user_id/customer_email
    CREATE OR REPLACE FUNCTION prevent_orders_identity_change()
    RETURNS TRIGGER AS $$
    BEGIN
      IF NEW.user_id IS DISTINCT FROM OLD.user_id THEN
        RAISE EXCEPTION 'user_id is immutable';
      END IF;
      IF NEW.customer_email IS DISTINCT FROM OLD.customer_email THEN
        RAISE EXCEPTION 'customer_email is immutable';
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;

    DROP TRIGGER IF EXISTS orders_identity_immutable ON orders;
    CREATE TRIGGER orders_identity_immutable
      BEFORE UPDATE ON orders
      FOR EACH ROW
      EXECUTE FUNCTION prevent_orders_identity_change();
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 3) COMMANDES_VENTE_DIRECTE: strict RLS + immutable ownership
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'commandes_vente_directe') THEN
    ALTER TABLE commandes_vente_directe ENABLE ROW LEVEL SECURITY;

    DROP POLICY IF EXISTS "Users can view own orders" ON commandes_vente_directe;
    DROP POLICY IF EXISTS "Producers can view their orders" ON commandes_vente_directe;
    DROP POLICY IF EXISTS "Admins can view all orders" ON commandes_vente_directe;
    DROP POLICY IF EXISTS "Users can create own orders" ON commandes_vente_directe;
    DROP POLICY IF EXISTS "Admins can update orders" ON commandes_vente_directe;

    CREATE POLICY "cdv_select_customer"
    ON commandes_vente_directe FOR SELECT
    USING (auth.uid() = user_id);

    CREATE POLICY "cdv_select_producer"
    ON commandes_vente_directe FOR SELECT
    USING (
      producer_id IN (SELECT id FROM producers WHERE profile_id = auth.uid())
    );

    CREATE POLICY "cdv_select_admin"
    ON commandes_vente_directe FOR SELECT
    USING (is_admin());

    CREATE POLICY "cdv_insert_customer"
    ON commandes_vente_directe FOR INSERT
    WITH CHECK (auth.uid() = user_id);

    CREATE POLICY "cdv_update_producer"
    ON commandes_vente_directe FOR UPDATE
    USING (
      producer_id IN (SELECT id FROM producers WHERE profile_id = auth.uid())
    )
    WITH CHECK (
      producer_id IN (SELECT id FROM producers WHERE profile_id = auth.uid())
    );

    CREATE POLICY "cdv_update_admin"
    ON commandes_vente_directe FOR UPDATE
    USING (is_admin())
    WITH CHECK (is_admin());

    -- Immutable ownership: prevent user_id/producer_id changes
    CREATE OR REPLACE FUNCTION prevent_cdv_identity_change()
    RETURNS TRIGGER AS $$
    BEGIN
      IF NEW.user_id IS DISTINCT FROM OLD.user_id THEN
        RAISE EXCEPTION 'user_id is immutable';
      END IF;
      IF NEW.producer_id IS DISTINCT FROM OLD.producer_id THEN
        RAISE EXCEPTION 'producer_id is immutable';
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;

    DROP TRIGGER IF EXISTS cdv_identity_immutable ON commandes_vente_directe;
    CREATE TRIGGER cdv_identity_immutable
      BEFORE UPDATE ON commandes_vente_directe
      FOR EACH ROW
      EXECUTE FUNCTION prevent_cdv_identity_change();
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 4) LIGNES_COMMANDE_VENTE_DIRECTE: immutable foreign keys
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'lignes_commande_vente_directe') THEN
    ALTER TABLE lignes_commande_vente_directe ENABLE ROW LEVEL SECURITY;

    DROP POLICY IF EXISTS "Users can view own order lines" ON lignes_commande_vente_directe;
    DROP POLICY IF EXISTS "Producers can view their order lines" ON lignes_commande_vente_directe;
    DROP POLICY IF EXISTS "Admins can view all order lines" ON lignes_commande_vente_directe;
    DROP POLICY IF EXISTS "Users can create own order lines" ON lignes_commande_vente_directe;

    CREATE POLICY "cdv_lines_select_customer"
    ON lignes_commande_vente_directe FOR SELECT
    USING (
      commande_id IN (
        SELECT id FROM commandes_vente_directe WHERE user_id = auth.uid()
      )
    );

    CREATE POLICY "cdv_lines_select_producer"
    ON lignes_commande_vente_directe FOR SELECT
    USING (
      commande_id IN (
        SELECT id FROM commandes_vente_directe
        WHERE producer_id IN (SELECT id FROM producers WHERE profile_id = auth.uid())
      )
    );

    CREATE POLICY "cdv_lines_select_admin"
    ON lignes_commande_vente_directe FOR SELECT
    USING (is_admin());

    CREATE POLICY "cdv_lines_insert_customer"
    ON lignes_commande_vente_directe FOR INSERT
    WITH CHECK (
      commande_id IN (
        SELECT id FROM commandes_vente_directe WHERE user_id = auth.uid()
      )
    );

    CREATE OR REPLACE FUNCTION prevent_cdv_line_identity_change()
    RETURNS TRIGGER AS $$
    BEGIN
      IF NEW.commande_id IS DISTINCT FROM OLD.commande_id THEN
        RAISE EXCEPTION 'commande_id is immutable';
      END IF;
      IF NEW.product_id IS DISTINCT FROM OLD.product_id THEN
        RAISE EXCEPTION 'product_id is immutable';
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;

    DROP TRIGGER IF EXISTS cdv_line_identity_immutable ON lignes_commande_vente_directe;
    CREATE TRIGGER cdv_line_identity_immutable
      BEFORE UPDATE ON lignes_commande_vente_directe
      FOR EACH ROW
      EXECUTE FUNCTION prevent_cdv_line_identity_change();
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 5) LOCAL_MARKET_ORDERS: strict RLS + immutable ownership
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'local_market_orders') THEN
    ALTER TABLE local_market_orders ENABLE ROW LEVEL SECURITY;

    DROP POLICY IF EXISTS "lmo_select_customer" ON local_market_orders;
    DROP POLICY IF EXISTS "lmo_select_producer" ON local_market_orders;
    DROP POLICY IF EXISTS "lmo_select_admin" ON local_market_orders;
    DROP POLICY IF EXISTS "lmo_insert_customer" ON local_market_orders;
    DROP POLICY IF EXISTS "lmo_update_producer" ON local_market_orders;
    DROP POLICY IF EXISTS "lmo_update_admin" ON local_market_orders;
    DROP POLICY IF EXISTS "lmo_update_customer_cancel" ON local_market_orders;

    CREATE POLICY "lmo_select_customer"
    ON local_market_orders FOR SELECT
    USING (customer_id = auth.uid());

    CREATE POLICY "lmo_select_producer"
    ON local_market_orders FOR SELECT
    USING (
      producer_id IN (SELECT id FROM producers WHERE profile_id = auth.uid())
    );

    CREATE POLICY "lmo_select_admin"
    ON local_market_orders FOR SELECT
    USING (is_admin());

    CREATE POLICY "lmo_insert_customer"
    ON local_market_orders FOR INSERT
    WITH CHECK (customer_id = auth.uid());

    -- Customer can only cancel their own order
    CREATE POLICY "lmo_update_customer_cancel"
    ON local_market_orders FOR UPDATE
    USING (customer_id = auth.uid())
    WITH CHECK (customer_id = auth.uid() AND status = 'cancelled');

    -- Producers can update orders linked to them
    CREATE POLICY "lmo_update_producer"
    ON local_market_orders FOR UPDATE
    USING (producer_id IN (SELECT id FROM producers WHERE profile_id = auth.uid()))
    WITH CHECK (producer_id IN (SELECT id FROM producers WHERE profile_id = auth.uid()));

    -- Admins can update any
    CREATE POLICY "lmo_update_admin"
    ON local_market_orders FOR UPDATE
    USING (is_admin())
    WITH CHECK (is_admin());

    -- Immutable ownership: prevent changing customer/producer/product/pickup_code
    CREATE OR REPLACE FUNCTION prevent_lmo_identity_change()
    RETURNS TRIGGER AS $$
    BEGIN
      IF NEW.customer_id IS DISTINCT FROM OLD.customer_id THEN
        RAISE EXCEPTION 'customer_id is immutable';
      END IF;
      IF NEW.producer_id IS DISTINCT FROM OLD.producer_id THEN
        RAISE EXCEPTION 'producer_id is immutable';
      END IF;
      IF NEW.product_id IS DISTINCT FROM OLD.product_id THEN
        RAISE EXCEPTION 'product_id is immutable';
      END IF;
      IF NEW.pickup_code IS DISTINCT FROM OLD.pickup_code THEN
        RAISE EXCEPTION 'pickup_code is immutable';
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;

    DROP TRIGGER IF EXISTS lmo_identity_immutable ON local_market_orders;
    CREATE TRIGGER lmo_identity_immutable
      BEFORE UPDATE ON local_market_orders
      FOR EACH ROW
      EXECUTE FUNCTION prevent_lmo_identity_change();
  END IF;
END $$;
