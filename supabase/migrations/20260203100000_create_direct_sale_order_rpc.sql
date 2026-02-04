-- ============================================================================
-- DIRECT SALE ORDER RPC - Atomic order + lines creation
-- Date: 2026-02-03
-- ============================================================================

CREATE OR REPLACE FUNCTION create_direct_sale_order(
  p_user_id uuid,
  p_producer_id text,
  p_items jsonb
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order_id uuid;
  v_item jsonb;
  v_product record;
  v_total numeric := 0;
  v_qty integer;
  v_unit numeric;
  v_line_total numeric;
  v_producer record;
BEGIN
  IF jsonb_typeof(p_items) <> 'array' THEN
    RAISE EXCEPTION 'INVALID_ITEMS';
  END IF;

  SELECT adresse_retrait, horaires_retrait, instructions_retrait
    INTO v_producer
  FROM producers
  WHERE id = p_producer_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'PRODUCER_NOT_FOUND';
  END IF;

  INSERT INTO commandes_vente_directe (
    user_id,
    producer_id,
    total,
    statut,
    adresse_retrait,
    horaires_retrait,
    instructions_retrait
  ) VALUES (
    p_user_id,
    p_producer_id,
    0,
    'en_attente',
    COALESCE(v_producer.adresse_retrait, ''),
    COALESCE(v_producer.horaires_retrait, ''),
    v_producer.instructions_retrait
  )
  RETURNING id INTO v_order_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_qty := COALESCE((v_item->>'quantity')::int, 0);
    IF v_qty <= 0 THEN
      RAISE EXCEPTION 'INVALID_QUANTITY';
    END IF;

    SELECT id, producer_id, price_public
      INTO v_product
    FROM products
    WHERE id = (v_item->>'productId')::text;

    IF NOT FOUND OR v_product.producer_id <> p_producer_id THEN
      RAISE EXCEPTION 'INVALID_PRODUCT';
    END IF;

    v_unit := COALESCE(v_product.price_public, 0);
    v_line_total := v_unit * v_qty;
    v_total := v_total + v_line_total;

    INSERT INTO lignes_commande_vente_directe (
      commande_id,
      product_id,
      quantite,
      prix_unitaire,
      sous_total
    ) VALUES (
      v_order_id,
      v_product.id,
      v_qty,
      v_unit,
      v_line_total
    );
  END LOOP;

  IF v_total < 20 THEN
    RAISE EXCEPTION 'MINIMUM_AMOUNT_NOT_MET';
  END IF;

  UPDATE commandes_vente_directe
    SET total = v_total
  WHERE id = v_order_id;

  RETURN v_order_id;
EXCEPTION WHEN OTHERS THEN
  IF v_order_id IS NOT NULL THEN
    DELETE FROM commandes_vente_directe WHERE id = v_order_id;
  END IF;
  RAISE;
END;
$$;

REVOKE EXECUTE ON FUNCTION create_direct_sale_order(uuid, text, jsonb) FROM public;
REVOKE EXECUTE ON FUNCTION create_direct_sale_order(uuid, text, jsonb) FROM anon;
REVOKE EXECUTE ON FUNCTION create_direct_sale_order(uuid, text, jsonb) FROM authenticated;
GRANT EXECUTE ON FUNCTION create_direct_sale_order(uuid, text, jsonb) TO service_role;
