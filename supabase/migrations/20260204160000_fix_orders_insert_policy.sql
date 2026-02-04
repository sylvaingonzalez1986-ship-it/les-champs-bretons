-- ============================================================================
-- FIX ORDERS INSERT POLICY (prevent impersonation)
-- Date: 2026-02-04
-- ============================================================================

DROP POLICY IF EXISTS "orders_insert_authenticated" ON orders;
DROP POLICY IF EXISTS "orders_insert_own" ON orders;

CREATE POLICY "orders_insert_own" ON orders
FOR INSERT
TO authenticated
WITH CHECK (
  user_id = auth.uid()
  AND customer_email = auth.email()
);
