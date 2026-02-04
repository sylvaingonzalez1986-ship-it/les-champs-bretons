-- ============================================================================
-- MATERIALIZED VIEW: producers_catalog
-- Optimizes N+1 query pattern by pre-joining producers with products
-- Date: 2026-02-04
-- ============================================================================

-- =============================================================================
-- 1. CREATE MATERIALIZED VIEW
-- =============================================================================
-- This view pre-aggregates producers with their products and profile info
-- Reduces 30+ HTTP requests to 1 single query

CREATE MATERIALIZED VIEW IF NOT EXISTS producers_catalog AS
SELECT
  p.id,
  p.name,
  p.email,
  p.region,
  p.department,
  p.city,
  p.image,
  p.description,
  p.latitude,
  p.longitude,
  p.map_position_x,
  p.map_position_y,
  p.soil_type,
  p.soil_ph,
  p.soil_characteristics,
  p.climate_type,
  p.climate_avg_temp,
  p.climate_rainfall,
  p.culture_outdoor,
  p.culture_greenhouse,
  p.culture_indoor,
  p.vente_directe_ferme,
  p.adresse_retrait,
  p.horaires_retrait,
  p.instructions_retrait,
  p.profile_id,
  p.created_at,
  p.updated_at,
  -- Profile info (joined)
  jsonb_build_object(
    'company_name', prof.company_name,
    'business_name', prof.business_name
  ) AS profile,
  -- Products aggregated as JSONB array
  COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id', prod.id,
        'producer_id', prod.producer_id,
        'name', prod.name,
        'type', prod.type,
        'cbd_percent', prod.cbd_percent,
        'thc_percent', prod.thc_percent,
        'price_public', prod.price_public,
        'price_pro', prod.price_pro,
        'weight', prod.weight,
        'image', prod.image,
        'images', prod.images,
        'description', prod.description,
        'tva_rate', prod.tva_rate,
        'stock', prod.stock,
        'is_on_promo', prod.is_on_promo,
        'promo_percent', prod.promo_percent,
        'visible_for_clients', prod.visible_for_clients,
        'visible_for_pros', prod.visible_for_pros,
        'status', prod.status,
        'lab_analysis_url', prod.lab_analysis_url,
        'price_tiers', prod.price_tiers,
        'price_pro_tiers', prod.price_pro_tiers,
        'created_at', prod.created_at,
        'updated_at', prod.updated_at
      ) ORDER BY prod.name
    ) FILTER (WHERE prod.id IS NOT NULL),
    '[]'::jsonb
  ) AS products
FROM producers p
LEFT JOIN profiles prof ON prof.id = p.profile_id
LEFT JOIN products prod ON prod.producer_id = p.id
GROUP BY
  p.id, p.name, p.email, p.region, p.department, p.city, p.image, p.description,
  p.latitude, p.longitude, p.map_position_x, p.map_position_y,
  p.soil_type, p.soil_ph, p.soil_characteristics,
  p.climate_type, p.climate_avg_temp, p.climate_rainfall,
  p.culture_outdoor, p.culture_greenhouse, p.culture_indoor,
  p.vente_directe_ferme, p.adresse_retrait, p.horaires_retrait, p.instructions_retrait,
  p.profile_id, p.created_at, p.updated_at,
  prof.company_name, prof.business_name;

-- =============================================================================
-- 2. CREATE INDEXES ON MATERIALIZED VIEW
-- =============================================================================

-- Primary lookup index
CREATE UNIQUE INDEX IF NOT EXISTS idx_producers_catalog_id
  ON producers_catalog(id);

-- Name search/sort index
CREATE INDEX IF NOT EXISTS idx_producers_catalog_name
  ON producers_catalog(name);

-- Region filtering
CREATE INDEX IF NOT EXISTS idx_producers_catalog_region
  ON producers_catalog(region, department);

-- =============================================================================
-- 3. REFRESH FUNCTION
-- =============================================================================
-- Function to refresh the materialized view
-- Uses CONCURRENTLY to avoid locking reads during refresh

CREATE OR REPLACE FUNCTION refresh_producers_catalog()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  -- CONCURRENTLY allows reads during refresh (requires unique index)
  REFRESH MATERIALIZED VIEW CONCURRENTLY public.producers_catalog;
END;
$$;

-- Revoke public access (security)
REVOKE EXECUTE ON FUNCTION refresh_producers_catalog FROM public;
REVOKE EXECUTE ON FUNCTION refresh_producers_catalog FROM anon;
GRANT EXECUTE ON FUNCTION refresh_producers_catalog TO service_role;

-- =============================================================================
-- 4. AUTO-REFRESH TRIGGERS
-- =============================================================================
-- Debounced refresh: only refreshes once per statement (not per row)
-- This prevents excessive refreshes during bulk operations

-- Trigger function for products changes
CREATE OR REPLACE FUNCTION trigger_refresh_producers_catalog_on_products()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  -- Use pg_try_advisory_lock to prevent concurrent refreshes
  -- Lock ID 12345 is arbitrary but unique to this operation
  IF pg_try_advisory_xact_lock(12345) THEN
    PERFORM public.refresh_producers_catalog();
  END IF;
  RETURN NULL;
END;
$$;

-- Trigger function for producers changes
CREATE OR REPLACE FUNCTION trigger_refresh_producers_catalog_on_producers()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF pg_try_advisory_xact_lock(12345) THEN
    PERFORM public.refresh_producers_catalog();
  END IF;
  RETURN NULL;
END;
$$;

-- Create triggers (AFTER STATEMENT to batch row changes)
DROP TRIGGER IF EXISTS refresh_catalog_on_products_change ON products;
CREATE TRIGGER refresh_catalog_on_products_change
  AFTER INSERT OR UPDATE OR DELETE ON products
  FOR EACH STATEMENT
  EXECUTE FUNCTION trigger_refresh_producers_catalog_on_products();

DROP TRIGGER IF EXISTS refresh_catalog_on_producers_change ON producers;
CREATE TRIGGER refresh_catalog_on_producers_change
  AFTER INSERT OR UPDATE OR DELETE ON producers
  FOR EACH STATEMENT
  EXECUTE FUNCTION trigger_refresh_producers_catalog_on_producers();

-- =============================================================================
-- 5. ENABLE RLS ACCESS (Read-only for all authenticated users)
-- =============================================================================
-- Note: Materialized views don't support RLS directly, but we can control
-- access via the API. The view is read-only by nature.

-- Grant SELECT to authenticated users (via PostgREST)
GRANT SELECT ON producers_catalog TO anon;
GRANT SELECT ON producers_catalog TO authenticated;

-- =============================================================================
-- 6. INITIAL REFRESH
-- =============================================================================
-- Populate the view with current data
REFRESH MATERIALIZED VIEW producers_catalog;

-- =============================================================================
-- USAGE NOTES:
-- =============================================================================
-- Query the view: SELECT * FROM producers_catalog ORDER BY name LIMIT 100;
--
-- The 'products' column is a JSONB array that can be parsed in the app.
--
-- Performance: 1 query instead of N+1 pattern (30+ queries)
-- Refresh: Automatic on INSERT/UPDATE/DELETE of products or producers
-- =============================================================================
