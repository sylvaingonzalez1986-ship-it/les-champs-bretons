-- Remove HempTycoon-specific ticket metadata and sources

BEGIN;

-- Reclassify legacy HempTycoon transactions to a generic admin source
UPDATE ticket_transactions
SET source = 'admin'
WHERE source = 'hemptycoon';

-- Drop HempTycoon-specific index
DROP INDEX IF EXISTS idx_ticket_tx_hemptycoon;

-- Remove HempTycoon-only columns
ALTER TABLE ticket_transactions
  DROP COLUMN IF EXISTS replay_hash,
  DROP COLUMN IF EXISTS server_validated,
  DROP COLUMN IF EXISTS validated_by;

-- Refresh source constraint without HempTycoon
ALTER TABLE ticket_transactions
  DROP CONSTRAINT IF EXISTS ticket_transactions_source_check;

ALTER TABLE ticket_transactions
  ADD CONSTRAINT ticket_transactions_source_check
  CHECK (source IN (
    'purchase',
    'subscription',
    'spin',
    'admin',
    'refund',
    'expired'
  ));

-- Replace award_tickets without HempTycoon-specific fields
DROP FUNCTION IF EXISTS award_tickets(uuid, integer, text, jsonb, text);

CREATE OR REPLACE FUNCTION award_tickets(
  p_user_id UUID,
  p_amount INTEGER,
  p_source TEXT,
  p_source_details JSONB DEFAULT NULL
) RETURNS TABLE(new_balance INTEGER) AS $$
DECLARE
  v_new_balance INTEGER;
BEGIN
  IF p_amount <= 0 THEN
    RAISE EXCEPTION 'Amount must be positive';
  END IF;

  INSERT INTO user_tickets (user_id, balance, lifetime_earned)
  VALUES (p_user_id, p_amount, p_amount)
  ON CONFLICT (user_id) DO UPDATE SET
    balance = user_tickets.balance + p_amount,
    lifetime_earned = user_tickets.lifetime_earned + p_amount,
    updated_at = now()
  RETURNING user_tickets.balance INTO v_new_balance;

  INSERT INTO ticket_transactions (
    user_id,
    amount,
    balance_after,
    source,
    source_details
  ) VALUES (
    p_user_id,
    p_amount,
    v_new_balance,
    p_source,
    p_source_details
  );

  RETURN QUERY SELECT v_new_balance;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

ALTER FUNCTION public.award_tickets(uuid, integer, text, jsonb) SET search_path = '';

REVOKE EXECUTE ON FUNCTION award_tickets FROM public;
REVOKE EXECUTE ON FUNCTION award_tickets FROM anon;
GRANT EXECUTE ON FUNCTION award_tickets TO service_role;

-- Update table comments to remove cross-app references
COMMENT ON TABLE user_tickets IS 'Centralized ticket balance for Les Chanvriers';
COMMENT ON TABLE ticket_transactions IS 'Audit trail for ticket transactions';

COMMIT;
