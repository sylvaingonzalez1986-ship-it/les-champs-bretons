-- ============================================================================
-- MIGRATION: Création de la table pro_orders pour la bourse
-- ============================================================================
-- Date: 2026-01-25
-- Problème: Les commandes de la bourse ne sont pas sauvegardées car la table
--           pro_orders n'existe pas dans Supabase
-- Solution: Créer la table pro_orders avec les bonnes policies RLS
-- ============================================================================

-- ============================================================================
-- ÉTAPE 1: Créer la table pro_orders
-- ============================================================================
CREATE TABLE IF NOT EXISTS pro_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Lien vers le produit
  product_id TEXT NOT NULL,

  -- Lien vers l'utilisateur pro qui passe la commande
  pro_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Type de commande (pour l'instant uniquement buy_request)
  type TEXT NOT NULL DEFAULT 'buy_request' CHECK (type IN ('buy_request')),

  -- Quantité commandée
  quantity INTEGER NOT NULL CHECK (quantity > 0),

  -- Prix unitaire au moment de la commande
  unit_price NUMERIC(10,2) NOT NULL CHECK (unit_price >= 0),

  -- Statut de la commande
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'matched', 'cancelled')),

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================================
-- ÉTAPE 2: Créer les index pour les performances
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_pro_orders_product_id ON pro_orders(product_id);
CREATE INDEX IF NOT EXISTS idx_pro_orders_pro_user_id ON pro_orders(pro_user_id);
CREATE INDEX IF NOT EXISTS idx_pro_orders_status ON pro_orders(status);
CREATE INDEX IF NOT EXISTS idx_pro_orders_created_at ON pro_orders(created_at DESC);

-- ============================================================================
-- ÉTAPE 3: Activer RLS (Row Level Security)
-- ============================================================================
ALTER TABLE pro_orders ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- ÉTAPE 4: Supprimer les anciennes policies si elles existent
-- ============================================================================
DROP POLICY IF EXISTS "pro_orders_select" ON pro_orders;
DROP POLICY IF EXISTS "pro_orders_insert" ON pro_orders;
DROP POLICY IF EXISTS "pro_orders_update" ON pro_orders;
DROP POLICY IF EXISTS "pro_orders_delete" ON pro_orders;

-- ============================================================================
-- ÉTAPE 5: Créer les policies RLS
-- ============================================================================

-- SELECT:
-- - Les pros/producteurs voient leurs propres commandes
-- - Les producteurs voient les commandes sur leurs produits
-- - Les admins voient toutes les commandes
CREATE POLICY "pro_orders_select"
ON pro_orders FOR SELECT
USING (
  -- L'utilisateur voit ses propres commandes
  pro_user_id = auth.uid()
  OR
  -- Les admins voient tout
  EXISTS (
    SELECT 1 FROM profiles
    WHERE id = auth.uid() AND role = 'admin'
  )
  OR
  -- Les producteurs voient les commandes sur leurs produits
  EXISTS (
    SELECT 1 FROM products p
    JOIN producers pr ON p.producer_id = pr.id
    WHERE p.id = pro_orders.product_id
    AND pr.profile_id = auth.uid()
  )
);

-- INSERT: Les pros et producteurs peuvent créer des commandes
CREATE POLICY "pro_orders_insert"
ON pro_orders FOR INSERT
WITH CHECK (
  auth.uid() IS NOT NULL
  AND
  EXISTS (
    SELECT 1 FROM profiles
    WHERE id = auth.uid()
    AND role IN ('pro', 'producer', 'admin')
  )
);

-- UPDATE:
-- - L'utilisateur peut modifier ses propres commandes (pour annuler)
-- - Les producteurs peuvent modifier les commandes sur leurs produits
-- - Les admins peuvent tout modifier
CREATE POLICY "pro_orders_update"
ON pro_orders FOR UPDATE
USING (
  pro_user_id = auth.uid()
  OR
  EXISTS (
    SELECT 1 FROM profiles
    WHERE id = auth.uid() AND role = 'admin'
  )
  OR
  EXISTS (
    SELECT 1 FROM products p
    JOIN producers pr ON p.producer_id = pr.id
    WHERE p.id = pro_orders.product_id
    AND pr.profile_id = auth.uid()
  )
)
WITH CHECK (
  pro_user_id = auth.uid()
  OR
  EXISTS (
    SELECT 1 FROM profiles
    WHERE id = auth.uid() AND role = 'admin'
  )
  OR
  EXISTS (
    SELECT 1 FROM products p
    JOIN producers pr ON p.producer_id = pr.id
    WHERE p.id = pro_orders.product_id
    AND pr.profile_id = auth.uid()
  )
);

-- DELETE: Seuls les admins peuvent supprimer
CREATE POLICY "pro_orders_delete"
ON pro_orders FOR DELETE
USING (
  EXISTS (
    SELECT 1 FROM profiles
    WHERE id = auth.uid() AND role = 'admin'
  )
);

-- ============================================================================
-- ÉTAPE 6: Créer le trigger de mise à jour automatique de updated_at
-- ============================================================================
CREATE OR REPLACE FUNCTION update_pro_orders_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS pro_orders_updated_at_trigger ON pro_orders;

CREATE TRIGGER pro_orders_updated_at_trigger
  BEFORE UPDATE ON pro_orders
  FOR EACH ROW
  EXECUTE FUNCTION update_pro_orders_updated_at();

-- ============================================================================
-- ÉTAPE 7: Vérifier que tout est bien créé
-- ============================================================================

-- Vérifier la table
SELECT
  table_name,
  column_name,
  data_type
FROM information_schema.columns
WHERE table_name = 'pro_orders'
AND table_schema = 'public'
ORDER BY ordinal_position;

-- Vérifier les policies
SELECT
  policyname,
  cmd,
  permissive
FROM pg_policies
WHERE tablename = 'pro_orders';

-- ============================================================================
-- RÉSUMÉ
-- ============================================================================
-- Cette migration crée la table pro_orders pour la bourse des producteurs.
--
-- Structure:
-- - id: UUID auto-généré
-- - product_id: ID du produit commandé
-- - pro_user_id: ID de l'utilisateur pro qui passe la commande
-- - type: Type de commande ('buy_request')
-- - quantity: Quantité commandée
-- - unit_price: Prix unitaire au moment de la commande
-- - status: 'pending', 'matched', ou 'cancelled'
-- - created_at, updated_at: Timestamps
--
-- Policies RLS:
-- - SELECT: Utilisateurs voient leurs commandes, producteurs voient les commandes
--           sur leurs produits, admins voient tout
-- - INSERT: Pros, producteurs et admins peuvent créer des commandes
-- - UPDATE: Utilisateurs peuvent modifier leurs commandes, producteurs peuvent
--           modifier les commandes sur leurs produits, admins peuvent tout modifier
-- - DELETE: Admins uniquement
--
-- IMPORTANT: Exécutez cette migration dans Supabase SQL Editor pour créer la table
-- ============================================================================
