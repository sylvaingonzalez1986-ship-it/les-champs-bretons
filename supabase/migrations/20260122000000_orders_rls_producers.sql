-- Migration: Permettre aux utilisateurs de créer et voir les commandes
-- Date: 2026-01-22
-- Description: Politiques RLS complètes pour la table orders

-- ============================================
-- SUPPRIMER TOUTES LES ANCIENNES POLITIQUES
-- ============================================
DROP POLICY IF EXISTS "orders_select_own" ON orders;
DROP POLICY IF EXISTS "orders_select_enhanced" ON orders;
DROP POLICY IF EXISTS "orders_insert_own" ON orders;
DROP POLICY IF EXISTS "orders_insert_authenticated" ON orders;
DROP POLICY IF EXISTS "orders_update_own" ON orders;
DROP POLICY IF EXISTS "orders_delete_admin" ON orders;

-- ============================================
-- POLITIQUE SELECT (lecture)
-- ============================================
CREATE POLICY "orders_select_enhanced" ON orders
FOR SELECT
TO authenticated
USING (
  -- Client voit ses propres commandes
  customer_email = auth.email()

  -- Admin voit tout
  OR EXISTS (
    SELECT 1 FROM profiles
    WHERE profiles.id = auth.uid()
    AND profiles.role = 'admin'
  )

  -- Producteur voit les commandes contenant ses produits
  OR EXISTS (
    SELECT 1 FROM profiles
    INNER JOIN producers ON producers.email = profiles.email
    WHERE profiles.id = auth.uid()
    AND profiles.role = 'producer'
    AND EXISTS (
      SELECT 1 FROM jsonb_array_elements(orders.items) AS item
      WHERE item->>'producer_id' = producers.id
    )
  )

  -- Pro voit ses commandes PRO
  OR (
    is_pro_order = true
    AND EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role = 'pro'
      AND profiles.email = customer_email
    )
  )
);

-- ============================================
-- POLITIQUE INSERT (création)
-- Tout utilisateur authentifié peut créer une commande
-- ============================================
CREATE POLICY "orders_insert_authenticated" ON orders
FOR INSERT
TO authenticated
WITH CHECK (true);

-- ============================================
-- POLITIQUE UPDATE (modification)
-- ============================================
CREATE POLICY "orders_update_own" ON orders
FOR UPDATE
TO authenticated
USING (
  -- Client peut modifier ses commandes
  customer_email = auth.email()

  -- Admin peut tout modifier
  OR EXISTS (
    SELECT 1 FROM profiles
    WHERE profiles.id = auth.uid()
    AND profiles.role = 'admin'
  )

  -- Producteur peut modifier commandes avec ses produits
  OR EXISTS (
    SELECT 1 FROM profiles
    INNER JOIN producers ON producers.email = profiles.email
    WHERE profiles.id = auth.uid()
    AND profiles.role = 'producer'
    AND EXISTS (
      SELECT 1 FROM jsonb_array_elements(orders.items) AS item
      WHERE item->>'producer_id' = producers.id
    )
  )
);

-- ============================================
-- POLITIQUE DELETE (suppression)
-- Seuls les admins peuvent supprimer
-- ============================================
CREATE POLICY "orders_delete_admin" ON orders
FOR DELETE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM profiles
    WHERE profiles.id = auth.uid()
    AND profiles.role = 'admin'
  )
);
