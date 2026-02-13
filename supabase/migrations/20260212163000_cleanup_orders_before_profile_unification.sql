-- Cleanup orders created before profile orders layout change.
-- Explicit cutoff to avoid ambiguity.
-- All orders created before 2026-02-12 15:29:07+00 will be deleted.

DO $$
DECLARE
  v_cutoff timestamptz := '2026-02-12 15:29:07+00';
  v_deleted bigint;
BEGIN
  IF to_regclass('public.local_market_orders') IS NOT NULL THEN
    DELETE FROM public.local_market_orders
    WHERE created_at < v_cutoff;
    GET DIAGNOSTICS v_deleted = ROW_COUNT;
    RAISE NOTICE '[cleanup] local_market_orders deleted: %', v_deleted;
  END IF;

  IF to_regclass('public.commandes_vente_directe') IS NOT NULL THEN
    DELETE FROM public.commandes_vente_directe
    WHERE created_at < v_cutoff;
    GET DIAGNOSTICS v_deleted = ROW_COUNT;
    RAISE NOTICE '[cleanup] commandes_vente_directe deleted: %', v_deleted;
  END IF;

  IF to_regclass('public.orders') IS NOT NULL THEN
    DELETE FROM public.orders
    WHERE created_at < v_cutoff;
    GET DIAGNOSTICS v_deleted = ROW_COUNT;
    RAISE NOTICE '[cleanup] orders deleted: %', v_deleted;
  END IF;

  IF to_regclass('public.pro_orders') IS NOT NULL THEN
    DELETE FROM public.pro_orders
    WHERE created_at < v_cutoff;
    GET DIAGNOSTICS v_deleted = ROW_COUNT;
    RAISE NOTICE '[cleanup] pro_orders deleted: %', v_deleted;
  END IF;
END
$$;
