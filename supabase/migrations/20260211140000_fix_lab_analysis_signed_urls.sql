-- ============================================================================
-- Fix lab_analysis_url: replace expired signed URLs with relative storage paths
-- ============================================================================
-- Date: 2026-02-11
-- Problem: products.lab_analysis_url may contain full signed URLs (with token=...)
--          or full public URLs instead of relative paths (lab-analyses/...).
--          The bucket is public so only relative paths are needed.
-- Fix: Extract the relative path from signed/public URLs.
-- ============================================================================

-- Fix signed URLs (with token=)
UPDATE public.products
SET lab_analysis_url = split_part(
  split_part(lab_analysis_url, '/storage/v1/object/sign/', 2),
  '?', 1
)
WHERE lab_analysis_url LIKE '%/storage/v1/object/sign/%'
  AND lab_analysis_url LIKE '%?token=%';

-- Fix full public URLs
UPDATE public.products
SET lab_analysis_url = split_part(lab_analysis_url, '/storage/v1/object/public/', 2)
WHERE lab_analysis_url LIKE '%/storage/v1/object/public/lab-analyses/%'
  AND lab_analysis_url NOT LIKE 'lab-analyses/%';

-- Refresh materialized view to pick up changes
REFRESH MATERIALIZED VIEW CONCURRENTLY public.producers_catalog;
