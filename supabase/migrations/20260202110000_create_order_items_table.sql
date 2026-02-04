-- ============================================================================
-- MIGRATION: Create order_items junction table for faster producer filtering
-- Date: 2026-02-02
-- ============================================================================

-- Create table
CREATE TABLE IF NOT EXISTS order_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  producer_id TEXT NOT NULL REFERENCES producers(id) ON DELETE RESTRICT,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  quantity INTEGER NOT NULL DEFAULT 1,
  unit_price NUMERIC(10,2) NOT NULL DEFAULT 0,
  total_price NUMERIC(10,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Prevent duplicate rows when re-running
CREATE UNIQUE INDEX IF NOT EXISTS idx_order_items_unique
  ON order_items(order_id, product_id, producer_id);

-- Performance indexes
CREATE INDEX IF NOT EXISTS idx_order_items_producer_id ON order_items(producer_id);
CREATE INDEX IF NOT EXISTS idx_order_items_order_id ON order_items(order_id);

-- Backfill from orders.items JSONB
INSERT INTO order_items (order_id, producer_id, product_id, quantity, unit_price, total_price)
SELECT
  o.id,
  (item->>'producer_id')::TEXT,
  (item->>'product_id')::TEXT,
  COALESCE((item->>'quantity')::INTEGER, 1),
  COALESCE((item->>'unit_price')::NUMERIC, 0),
  COALESCE((item->>'total_price')::NUMERIC, 0)
FROM orders o
CROSS JOIN LATERAL jsonb_array_elements(o.items) AS item
WHERE (item->>'product_id')::TEXT IN (SELECT id FROM products)
ON CONFLICT (order_id, product_id, producer_id) DO NOTHING;

-- Enable RLS
ALTER TABLE order_items ENABLE ROW LEVEL SECURITY;

-- SELECT: same visibility rules as orders
DROP POLICY IF EXISTS order_items_select ON order_items;
CREATE POLICY order_items_select
ON order_items FOR SELECT
USING (
  -- Admins see all
  is_admin()
  OR
  -- Customers see their orders
  order_id IN (
    SELECT id FROM orders
    WHERE user_id = auth.uid()
       OR customer_email = get_current_user_email()
  )
  OR
  -- Producers see order items for their products
  producer_id IN (
    SELECT id FROM producers WHERE profile_id = auth.uid()
  )
);

-- No client-side insert/update/delete policies (service role handles writes)
