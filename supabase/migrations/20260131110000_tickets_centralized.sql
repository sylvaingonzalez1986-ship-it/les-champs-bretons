-- ============================================================================
-- TICKETS CENTRALISÉS - Intégration HempTycoon × Les Chanvriers
-- ============================================================================
-- Version: 1.0
-- Date: 2026-01-31
--
-- Ce fichier centralise les tickets dans Supabase au lieu du stockage local.
-- Permet le partage entre l'app boutique et le jeu HempTycoon.
-- ============================================================================

-- ============================================================================
-- 1. TABLE user_tickets (Solde principal)
-- ============================================================================

CREATE TABLE IF NOT EXISTS user_tickets (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  
  -- Solde actuel
  balance INTEGER NOT NULL DEFAULT 0 CHECK (balance >= 0),
  
  -- Stats lifetime
  lifetime_earned INTEGER NOT NULL DEFAULT 0,
  lifetime_spent INTEGER NOT NULL DEFAULT 0,
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Index pour les requêtes fréquentes
CREATE INDEX IF NOT EXISTS idx_user_tickets_balance ON user_tickets(balance) WHERE balance > 0;

-- Trigger pour updated_at
CREATE OR REPLACE FUNCTION update_user_tickets_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_user_tickets_updated ON user_tickets;
CREATE TRIGGER trigger_user_tickets_updated
  BEFORE UPDATE ON user_tickets
  FOR EACH ROW
  EXECUTE FUNCTION update_user_tickets_timestamp();

-- ============================================================================
-- 2. TABLE ticket_transactions (Historique complet)
-- ============================================================================

CREATE TABLE IF NOT EXISTS ticket_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  
  -- Transaction
  amount INTEGER NOT NULL,              -- Positif = gain, Négatif = dépense
  balance_after INTEGER NOT NULL,       -- Solde après transaction
  
  -- Source de la transaction
  source TEXT NOT NULL CHECK (source IN (
    'purchase',       -- Achat boutique (25€ = 1 ticket)
    'subscription',   -- Abonnement mensuel
    'hemptycoon',     -- Récompense du jeu
    'spin',           -- Utilisation pour tirage
    'admin',          -- Ajustement admin
    'refund',         -- Remboursement
    'expired'         -- Expiration
  )),
  
  -- Détails selon la source
  source_details JSONB,
  -- Pour 'purchase': { "order_id": "...", "amount_eur": 75 }
  -- Pour 'subscription': { "tier": "premium", "month": "2026-01" }
  -- Pour 'hemptycoon': { "event": "weekly_ranking", "rank": 5, "week": "2026-W05" }
  -- Pour 'spin': { "lot_id": "...", "lot_name": "..." }
  
  -- Anti-fraude (pour HempTycoon)
  replay_hash TEXT,                     -- Hash du replay prouvant le gain
  server_validated BOOLEAN DEFAULT FALSE,
  validated_by TEXT,                    -- 'edge_function', 'admin_manual'
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Index pour les requêtes
CREATE INDEX IF NOT EXISTS idx_ticket_tx_user ON ticket_transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_ticket_tx_source ON ticket_transactions(source);
CREATE INDEX IF NOT EXISTS idx_ticket_tx_created ON ticket_transactions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ticket_tx_hemptycoon ON ticket_transactions(source, created_at) 
  WHERE source = 'hemptycoon';

-- ============================================================================
-- 3. RLS POLICIES
-- ============================================================================

-- Enable RLS
ALTER TABLE user_tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE ticket_transactions ENABLE ROW LEVEL SECURITY;

-- === user_tickets ===

-- Users can read their own balance
DROP POLICY IF EXISTS "Users read own ticket balance" ON user_tickets;
CREATE POLICY "Users read own ticket balance" ON user_tickets
  FOR SELECT USING (auth.uid() = user_id);

-- Only service_role can modify balances (via Edge Functions)
DROP POLICY IF EXISTS "Service role manages tickets" ON user_tickets;
CREATE POLICY "Service role manages tickets" ON user_tickets
  FOR ALL USING (auth.role() = 'service_role');

-- Admins can view all balances (for support)
DROP POLICY IF EXISTS "Admins view all ticket balances" ON user_tickets;
CREATE POLICY "Admins view all ticket balances" ON user_tickets
  FOR SELECT USING (is_admin());

-- === ticket_transactions ===

-- Users can read their own transaction history
DROP POLICY IF EXISTS "Users read own transactions" ON ticket_transactions;
CREATE POLICY "Users read own transactions" ON ticket_transactions
  FOR SELECT USING (auth.uid() = user_id);

-- Only service_role can insert transactions
DROP POLICY IF EXISTS "Service role inserts transactions" ON ticket_transactions;
CREATE POLICY "Service role inserts transactions" ON ticket_transactions
  FOR INSERT WITH CHECK (auth.role() = 'service_role');

-- Admins can view all transactions (for audit)
DROP POLICY IF EXISTS "Admins view all transactions" ON ticket_transactions;
CREATE POLICY "Admins view all transactions" ON ticket_transactions
  FOR SELECT USING (is_admin());

-- ============================================================================
-- 4. FUNCTIONS
-- ============================================================================

-- Function: Award tickets (called by Edge Functions)
CREATE OR REPLACE FUNCTION award_tickets(
  p_user_id UUID,
  p_amount INTEGER,
  p_source TEXT,
  p_source_details JSONB DEFAULT NULL,
  p_replay_hash TEXT DEFAULT NULL
) RETURNS TABLE(new_balance INTEGER) AS $$
DECLARE
  v_new_balance INTEGER;
BEGIN
  -- Validate amount
  IF p_amount <= 0 THEN
    RAISE EXCEPTION 'Amount must be positive';
  END IF;
  
  -- Upsert user_tickets
  INSERT INTO user_tickets (user_id, balance, lifetime_earned)
  VALUES (p_user_id, p_amount, p_amount)
  ON CONFLICT (user_id) DO UPDATE SET
    balance = user_tickets.balance + p_amount,
    lifetime_earned = user_tickets.lifetime_earned + p_amount,
    updated_at = now()
  RETURNING user_tickets.balance INTO v_new_balance;
  
  -- Log transaction
  INSERT INTO ticket_transactions (
    user_id, 
    amount, 
    balance_after, 
    source, 
    source_details, 
    replay_hash, 
    server_validated,
    validated_by
  ) VALUES (
    p_user_id, 
    p_amount, 
    v_new_balance, 
    p_source, 
    p_source_details, 
    p_replay_hash, 
    TRUE,
    'edge_function'
  );
  
  RETURN QUERY SELECT v_new_balance;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function: Spend tickets (for spins)
CREATE OR REPLACE FUNCTION spend_tickets(
  p_user_id UUID,
  p_amount INTEGER,
  p_source TEXT DEFAULT 'spin',
  p_source_details JSONB DEFAULT NULL
) RETURNS TABLE(success BOOLEAN, new_balance INTEGER, error_message TEXT) AS $$
DECLARE
  v_current_balance INTEGER;
  v_new_balance INTEGER;
BEGIN
  -- Validate amount
  IF p_amount <= 0 THEN
    RETURN QUERY SELECT FALSE, 0, 'Amount must be positive'::TEXT;
    RETURN;
  END IF;
  
  -- Get current balance with lock
  SELECT balance INTO v_current_balance
  FROM user_tickets
  WHERE user_id = p_user_id
  FOR UPDATE;
  
  -- Check if user has tickets
  IF v_current_balance IS NULL OR v_current_balance < p_amount THEN
    RETURN QUERY SELECT FALSE, COALESCE(v_current_balance, 0), 'Insufficient tickets'::TEXT;
    RETURN;
  END IF;
  
  -- Deduct tickets
  v_new_balance := v_current_balance - p_amount;
  
  UPDATE user_tickets SET
    balance = v_new_balance,
    lifetime_spent = lifetime_spent + p_amount,
    updated_at = now()
  WHERE user_id = p_user_id;
  
  -- Log transaction (negative amount)
  INSERT INTO ticket_transactions (
    user_id, 
    amount, 
    balance_after, 
    source, 
    source_details,
    server_validated,
    validated_by
  ) VALUES (
    p_user_id, 
    -p_amount, 
    v_new_balance, 
    p_source, 
    p_source_details,
    TRUE,
    'edge_function'
  );
  
  RETURN QUERY SELECT TRUE, v_new_balance, NULL::TEXT;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function: Get ticket balance (convenience)
CREATE OR REPLACE FUNCTION get_ticket_balance(p_user_id UUID)
RETURNS INTEGER AS $$
DECLARE
  v_balance INTEGER;
BEGIN
  SELECT balance INTO v_balance
  FROM user_tickets
  WHERE user_id = p_user_id;
  
  RETURN COALESCE(v_balance, 0);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

-- ============================================================================
-- 5. REVOKE PUBLIC ACCESS (Security)
-- ============================================================================

REVOKE EXECUTE ON FUNCTION award_tickets FROM public;
REVOKE EXECUTE ON FUNCTION award_tickets FROM anon;
GRANT EXECUTE ON FUNCTION award_tickets TO service_role;

REVOKE EXECUTE ON FUNCTION spend_tickets FROM public;
REVOKE EXECUTE ON FUNCTION spend_tickets FROM anon;
GRANT EXECUTE ON FUNCTION spend_tickets TO service_role;

-- get_ticket_balance can be called by authenticated users
REVOKE EXECUTE ON FUNCTION get_ticket_balance FROM public;
REVOKE EXECUTE ON FUNCTION get_ticket_balance FROM anon;
GRANT EXECUTE ON FUNCTION get_ticket_balance TO authenticated;
GRANT EXECUTE ON FUNCTION get_ticket_balance TO service_role;

-- ============================================================================
-- 6. MIGRATION: Import existing local tickets (ONE-TIME)
-- ============================================================================

-- Note: This needs to be done via an Edge Function that:
-- 1. Reads the user's local ticket balance from the app
-- 2. Calls award_tickets() with source='migration'
-- 3. Clears the local storage

-- Example Edge Function call:
-- SELECT * FROM award_tickets(
--   'user-uuid-here',
--   5,  -- tickets from local storage
--   'migration',
--   '{"migrated_from": "local_storage", "migrated_at": "2026-01-31"}'
-- );

COMMENT ON TABLE user_tickets IS 'Centralized ticket balance for cross-app integration (Les Chanvriers + HempTycoon)';
COMMENT ON TABLE ticket_transactions IS 'Audit trail for all ticket transactions across apps';
