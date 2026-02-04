-- ============================================================================
-- MIGRATION: Sync order_items from orders.items JSONB
-- Date: 2026-02-04
-- ============================================================================

-- Ensure trigger function exists
CREATE OR REPLACE FUNCTION sync_order_items_from_orders()
RETURNS TRIGGER AS $$
BEGIN
  -- Remove existing rows for this order (idempotent on update)
  DELETE FROM order_items WHERE order_id = NEW.id;

  -- Insert fresh rows from JSONB items
  INSERT INTO order_items (order_id, producer_id, product_id, quantity, unit_price, total_price)
  SELECT
    NEW.id,
    (item->>'producer_id')::TEXT,
    (item->>'product_id')::TEXT,
    COALESCE((item->>'quantity')::INTEGER, 1),
    COALESCE((item->>'unit_price')::NUMERIC, 0),
    COALESCE((item->>'total_price')::NUMERIC, 0)
  FROM jsonb_array_elements(NEW.items) AS item
  WHERE (item->>'product_id')::TEXT IS NOT NULL
    AND (item->>'producer_id')::TEXT IS NOT NULL;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS orders_sync_order_items ON orders;

CREATE TRIGGER orders_sync_order_items
  AFTER INSERT OR UPDATE OF items ON orders
  FOR EACH ROW
  EXECUTE FUNCTION sync_order_items_from_orders();
