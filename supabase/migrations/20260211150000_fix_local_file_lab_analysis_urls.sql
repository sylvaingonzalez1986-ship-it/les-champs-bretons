-- ============================================================================
-- Fix lab_analysis_url: remove local file paths that were saved by mistake
-- ============================================================================
-- Problem: Some products have local device file paths (file://, /data/, content://)
--          saved as lab_analysis_url instead of proper storage paths.
--          These paths only worked on the producer's device.
-- Fix: Set them to NULL so producers can re-upload.
-- ============================================================================

UPDATE public.products
SET lab_analysis_url = NULL
WHERE lab_analysis_url LIKE 'file://%'
   OR lab_analysis_url LIKE '/data/%'
   OR lab_analysis_url LIKE 'content://%'
   OR lab_analysis_url LIKE '%/cache/%';

-- Refresh materialized view
REFRESH MATERIALIZED VIEW CONCURRENTLY public.producers_catalog;
