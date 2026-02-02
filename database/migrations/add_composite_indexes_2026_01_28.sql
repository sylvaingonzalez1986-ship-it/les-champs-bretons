-- =============================================================================
-- Migration: Add Composite Indexes for Performance
-- Date: 2026-01-28
-- =============================================================================

-- 1. INDEX SUR PRODUCTS
CREATE INDEX IF NOT EXISTS idx_products_producer_status
  ON products(producer_id, status)
  WHERE status = 'published';

CREATE INDEX IF NOT EXISTS idx_products_type_visibility
  ON products(type, visible_for_clients, visible_for_pros);

-- 2. INDEX SUR ORDERS
CREATE INDEX IF NOT EXISTS idx_orders_user_status_date
  ON orders(user_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_orders_customer_email
  ON orders(customer_email);

CREATE INDEX IF NOT EXISTS idx_orders_created_at
  ON orders(created_at DESC);

-- 3. INDEX SUR PROFILES
CREATE INDEX IF NOT EXISTS idx_profiles_role
  ON profiles(role);

CREATE INDEX IF NOT EXISTS idx_profiles_user_code
  ON profiles(user_code)
  WHERE user_code IS NOT NULL;

-- 4. INDEX SUR PRODUCERS
CREATE INDEX IF NOT EXISTS idx_producers_region
  ON producers(region);

CREATE INDEX IF NOT EXISTS idx_producers_department
  ON producers(department);

-- 5. INDEX SUR USER_LOTS
CREATE INDEX IF NOT EXISTS idx_user_lots_user
  ON user_lots(user_id, won_at DESC);

-- 6. INDEX SUR AUDIT_LOG_ENTRIES
CREATE INDEX IF NOT EXISTS idx_audit_log_created
  ON audit_log_entries(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_log_user
  ON audit_log_entries(user_id, created_at DESC);

-- VERIFICATION
SELECT
  idx.tablename,
  idx.indexname,
  pg_size_pretty(pg_relation_size(cls.oid)) as index_size
FROM pg_indexes idx
JOIN pg_class cls ON cls.relname = idx.indexname
WHERE idx.schemaname = 'public'
  AND idx.indexname LIKE 'idx_%'
ORDER BY idx.tablename, idx.indexname;
