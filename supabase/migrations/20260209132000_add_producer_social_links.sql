-- Add social links to producers table and refresh producers_catalog view

ALTER TABLE producers
  ADD COLUMN IF NOT EXISTS instagram_url text,
  ADD COLUMN IF NOT EXISTS facebook_url text,
  ADD COLUMN IF NOT EXISTS twitter_url text,
  ADD COLUMN IF NOT EXISTS tiktok_url text,
  ADD COLUMN IF NOT EXISTS youtube_url text,
  ADD COLUMN IF NOT EXISTS website_url text,
  ADD COLUMN IF NOT EXISTS linkedin_url text;

-- Rebuild materialized view to include new fields
DROP MATERIALIZED VIEW IF EXISTS producers_catalog;

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
  p.instagram_url,
  p.facebook_url,
  p.twitter_url,
  p.tiktok_url,
  p.youtube_url,
  p.website_url,
  p.linkedin_url,
  p.profile_id,
  p.created_at,
  p.updated_at,
  jsonb_build_object(
    'company_name', prof.company_name,
    'business_name', prof.business_name
  ) AS profile,
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
  p.instagram_url, p.facebook_url, p.twitter_url, p.tiktok_url, p.youtube_url, p.website_url, p.linkedin_url,
  p.profile_id, p.created_at, p.updated_at,
  prof.company_name, prof.business_name;

CREATE UNIQUE INDEX IF NOT EXISTS idx_producers_catalog_id
  ON producers_catalog(id);

CREATE INDEX IF NOT EXISTS idx_producers_catalog_name
  ON producers_catalog(name);

CREATE INDEX IF NOT EXISTS idx_producers_catalog_region
  ON producers_catalog(region, department);

GRANT SELECT ON producers_catalog TO anon;
GRANT SELECT ON producers_catalog TO authenticated;

REFRESH MATERIALIZED VIEW producers_catalog;
