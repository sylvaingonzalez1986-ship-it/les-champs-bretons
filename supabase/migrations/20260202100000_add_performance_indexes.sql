-- ============================================================================
-- PERFORMANCE INDEXES - Load Testing Fixes
-- Date: 2026-02-02
-- ============================================================================

-- Bourse product pagination
CREATE INDEX IF NOT EXISTS idx_products_bourse_pagination
  ON products(visible_for_pros, id)
  WHERE visible_for_pros = true AND status = 'published';

-- Pro orders demand aggregation
CREATE INDEX IF NOT EXISTS idx_pro_orders_product_pending
  ON pro_orders(product_id)
  INCLUDE (quantity)
  WHERE status = 'pending';

-- Cart queries
DO $$
BEGIN
  IF to_regclass('public.panier_vente_directe') IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS idx_panier_vente_directe_user_created
      ON panier_vente_directe(user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_panier_vente_directe_user_product
      ON panier_vente_directe(user_id, product_id, created_at DESC);
  END IF;
END $$;

-- Product stock lookups
DO $$
BEGIN
  IF to_regclass('public.products') IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS idx_products_stock_lookup
      ON products(id)
      INCLUDE (stock, stock_available);
  END IF;
END $$;

-- Local market orders
DO $$
BEGIN
  IF to_regclass('public.local_market_orders') IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS idx_local_market_orders_producer_status
      ON local_market_orders(producer_id, status, created_at DESC);

    CREATE INDEX IF NOT EXISTS idx_local_market_orders_pickup_code
      ON local_market_orders(pickup_code)
      WHERE status IN ('pending', 'confirmed', 'ready');
  END IF;
END $$;
