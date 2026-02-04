-- =============================================================================
-- Migration: Security Audit Fixes - January 2026
-- Date: 2026-01-25
-- Description: Comprehensive security improvements based on audit report
-- =============================================================================

-- =============================================================================
-- 1. ENSURE RLS IS ENABLED ON ALL TABLES (DEFAULT DENY)
-- =============================================================================

-- Helper to enable RLS on a table if it exists
CREATE OR REPLACE FUNCTION public.enable_rls_if_exists(table_name_param TEXT)
RETURNS VOID AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = table_name_param) THEN
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', table_name_param);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', table_name_param);
  END IF;
END;
$$ LANGUAGE plpgsql;

-- Enable RLS on all known tables
SELECT public.enable_rls_if_exists('profiles');
SELECT public.enable_rls_if_exists('producers');
SELECT public.enable_rls_if_exists('products');
SELECT public.enable_rls_if_exists('orders');
SELECT public.enable_rls_if_exists('pro_orders');
SELECT public.enable_rls_if_exists('user_lots');
SELECT public.enable_rls_if_exists('lots');
SELECT public.enable_rls_if_exists('packs');
SELECT public.enable_rls_if_exists('promo_products');
SELECT public.enable_rls_if_exists('audit_log_entries');
SELECT public.enable_rls_if_exists('producer_chat_messages');
SELECT public.enable_rls_if_exists('music_tracks');
SELECT public.enable_rls_if_exists('app_data');
SELECT public.enable_rls_if_exists('player_progress');
SELECT public.enable_rls_if_exists('seasons');
SELECT public.enable_rls_if_exists('fields');
SELECT public.enable_rls_if_exists('upload_logs');
SELECT public.enable_rls_if_exists('allowed_mime_types');
SELECT public.enable_rls_if_exists('panier_vente_directe');
SELECT public.enable_rls_if_exists('commandes_vente_directe');

-- Clean up helper function
DROP FUNCTION IF EXISTS public.enable_rls_if_exists(TEXT);


-- =============================================================================
-- 2. ADD MISSING INDEXES FOR PERFORMANCE
-- =============================================================================

-- Indexes on profiles table
CREATE INDEX IF NOT EXISTS idx_profiles_role ON public.profiles(role);
CREATE INDEX IF NOT EXISTS idx_profiles_user_code ON public.profiles(user_code);
CREATE INDEX IF NOT EXISTS idx_profiles_email ON public.profiles(email);

-- Indexes on producers table
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'producers') THEN
    CREATE INDEX IF NOT EXISTS idx_producers_profile_id ON public.producers(profile_id);
    CREATE INDEX IF NOT EXISTS idx_producers_region ON public.producers(region);
    CREATE INDEX IF NOT EXISTS idx_producers_department ON public.producers(department);
  END IF;
END $$;

-- Indexes on products table
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'products') THEN
    CREATE INDEX IF NOT EXISTS idx_products_producer_id ON public.products(producer_id);
    CREATE INDEX IF NOT EXISTS idx_products_status ON public.products(status);
    CREATE INDEX IF NOT EXISTS idx_products_type ON public.products(type);
    CREATE INDEX IF NOT EXISTS idx_products_visible_clients ON public.products(visible_for_clients) WHERE visible_for_clients = true;
    CREATE INDEX IF NOT EXISTS idx_products_visible_pros ON public.products(visible_for_pros) WHERE visible_for_pros = true;
  END IF;
END $$;

-- Indexes on orders table
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'orders') THEN
    CREATE INDEX IF NOT EXISTS idx_orders_user_id ON public.orders(user_id);
    CREATE INDEX IF NOT EXISTS idx_orders_customer_email ON public.orders(customer_email);
    CREATE INDEX IF NOT EXISTS idx_orders_status ON public.orders(status);
    CREATE INDEX IF NOT EXISTS idx_orders_created_at ON public.orders(created_at DESC);
  END IF;
END $$;

-- Indexes on user_lots table
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'user_lots') THEN
    CREATE INDEX IF NOT EXISTS idx_user_lots_user_id ON public.user_lots(user_id);
    CREATE INDEX IF NOT EXISTS idx_user_lots_user_code ON public.user_lots(user_code);
  END IF;
END $$;

-- Indexes on chat messages
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'producer_chat_messages') THEN
    CREATE INDEX IF NOT EXISTS idx_chat_messages_created_at ON public.producer_chat_messages(created_at DESC);
  END IF;
END $$;


-- =============================================================================
-- 3. SECURE HELPER FUNCTIONS WITH SEARCH_PATH
-- =============================================================================

-- Recreate is_admin with secure search_path
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role = 'admin'
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = '';

-- Recreate is_producer with secure search_path
CREATE OR REPLACE FUNCTION public.is_producer()
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role = 'producer'
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = '';

-- Recreate is_pro with secure search_path
CREATE OR REPLACE FUNCTION public.is_pro()
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role = 'pro'
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = '';

-- Recreate get_user_producer_id with secure search_path
CREATE OR REPLACE FUNCTION public.get_user_producer_id()
RETURNS TEXT AS $$
BEGIN
  RETURN (
    SELECT p.id FROM public.producers p
    WHERE p.profile_id = auth.uid()
    LIMIT 1
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = '';

-- Recreate get_current_user_email with secure search_path
CREATE OR REPLACE FUNCTION public.get_current_user_email()
RETURNS TEXT AS $$
BEGIN
  RETURN (
    SELECT email FROM public.profiles
    WHERE id = auth.uid()
    LIMIT 1
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = '';


-- =============================================================================
-- 4. AUDIT LOG PROTECTION (IMMUTABLE)
-- =============================================================================

-- Ensure audit_log_entries exists and is protected
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'audit_log_entries') THEN
    -- Enable RLS
    ALTER TABLE public.audit_log_entries ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.audit_log_entries FORCE ROW LEVEL SECURITY;

    -- Drop existing policies to recreate them
    DROP POLICY IF EXISTS "audit_log_select_own" ON public.audit_log_entries;
    DROP POLICY IF EXISTS "audit_log_select_admin" ON public.audit_log_entries;
    DROP POLICY IF EXISTS "audit_log_insert" ON public.audit_log_entries;
    DROP POLICY IF EXISTS "Users can view own audit logs" ON public.audit_log_entries;
    DROP POLICY IF EXISTS "Admins can view all audit logs" ON public.audit_log_entries;
    DROP POLICY IF EXISTS "Authenticated users can insert audit logs" ON public.audit_log_entries;

    -- SELECT: Users see their own logs
    CREATE POLICY "audit_log_select_own"
    ON public.audit_log_entries FOR SELECT
    USING (auth.uid() = user_id);

    -- SELECT: Admins see all logs
    CREATE POLICY "audit_log_select_admin"
    ON public.audit_log_entries FOR SELECT
    USING (
      EXISTS (
        SELECT 1 FROM public.profiles
        WHERE id = auth.uid() AND role = 'admin'
      )
    );

    -- INSERT: Only via triggers (authenticated context)
    CREATE POLICY "audit_log_insert"
    ON public.audit_log_entries FOR INSERT
    WITH CHECK (auth.uid() IS NOT NULL);

    -- NO UPDATE policy = blocked
    -- NO DELETE policy = blocked (audit logs are immutable)
  END IF;
END $$;


-- =============================================================================
-- 5. PANIER AND COMMANDES VENTE DIRECTE RLS
-- =============================================================================

-- Panier vente directe policies
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'panier_vente_directe') THEN
    DROP POLICY IF EXISTS "panier_select" ON public.panier_vente_directe;
    DROP POLICY IF EXISTS "panier_insert" ON public.panier_vente_directe;
    DROP POLICY IF EXISTS "panier_update" ON public.panier_vente_directe;
    DROP POLICY IF EXISTS "panier_delete" ON public.panier_vente_directe;

    CREATE POLICY "panier_select"
    ON public.panier_vente_directe FOR SELECT
    USING (user_id = auth.uid());

    CREATE POLICY "panier_insert"
    ON public.panier_vente_directe FOR INSERT
    WITH CHECK (user_id = auth.uid());

    CREATE POLICY "panier_update"
    ON public.panier_vente_directe FOR UPDATE
    USING (user_id = auth.uid());

    CREATE POLICY "panier_delete"
    ON public.panier_vente_directe FOR DELETE
    USING (user_id = auth.uid());
  END IF;
END $$;

-- Commandes vente directe policies
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'commandes_vente_directe') THEN
    DROP POLICY IF EXISTS "commandes_vd_select" ON public.commandes_vente_directe;
    DROP POLICY IF EXISTS "commandes_vd_insert" ON public.commandes_vente_directe;
    DROP POLICY IF EXISTS "commandes_vd_update" ON public.commandes_vente_directe;

    -- Users see their own orders, producers see orders for their products
    CREATE POLICY "commandes_vd_select"
    ON public.commandes_vente_directe FOR SELECT
    USING (
      user_id = auth.uid()
      OR producer_id IN (SELECT id FROM public.producers WHERE profile_id = auth.uid())
      OR EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
    );

    CREATE POLICY "commandes_vd_insert"
    ON public.commandes_vente_directe FOR INSERT
    WITH CHECK (user_id = auth.uid());

    -- Producers can update status, admins can update all
    CREATE POLICY "commandes_vd_update"
    ON public.commandes_vente_directe FOR UPDATE
    USING (
      producer_id IN (SELECT id FROM public.producers WHERE profile_id = auth.uid())
      OR EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
    );
  END IF;
END $$;


-- =============================================================================
-- 6. INPUT VALIDATION FUNCTIONS
-- =============================================================================

-- Function to validate email format
CREATE OR REPLACE FUNCTION public.is_valid_email(email_input TEXT)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN email_input ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$';
END;
$$ LANGUAGE plpgsql IMMUTABLE SET search_path = '';

-- Function to sanitize text input (remove control characters)
CREATE OR REPLACE FUNCTION public.sanitize_text(input_text TEXT)
RETURNS TEXT AS $$
BEGIN
  IF input_text IS NULL THEN
    RETURN NULL;
  END IF;
  -- Remove control characters except newlines and tabs
  RETURN regexp_replace(input_text, '[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]', '', 'g');
END;
$$ LANGUAGE plpgsql IMMUTABLE SET search_path = '';


-- =============================================================================
-- 7. VERIFICATION QUERIES (for manual check)
-- =============================================================================

-- Run this to verify RLS status:
-- SELECT schemaname, tablename, rowsecurity FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename;

-- Run this to list all policies:
-- SELECT tablename, policyname, permissive, cmd FROM pg_policies WHERE schemaname = 'public' ORDER BY tablename, policyname;

-- =============================================================================
-- END OF MIGRATION
-- =============================================================================
