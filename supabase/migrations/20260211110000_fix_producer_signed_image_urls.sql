-- ============================================================================
-- Fix producer images: replace expired signed URLs with relative storage paths
-- ============================================================================
-- Date: 2026-02-11
-- Problem: Some producer image fields contain full signed URLs (with token=...)
--          instead of relative paths (images/producers/...). Signed URLs expire
--          after 1h, making images invisible.
-- Fix: Extract the relative path from signed URLs.
-- ============================================================================

-- Fix producers table: extract relative path from signed URLs
UPDATE public.producers
SET image = 'images/' || split_part(
  split_part(image, '/storage/v1/object/sign/', 2),
  '?', 1
)
WHERE image LIKE '%/storage/v1/object/sign/%'
  AND image LIKE '%?token=%';

-- Also fix any public URLs stored instead of relative paths
UPDATE public.producers
SET image = 'images/' || split_part(
  split_part(image, '/storage/v1/object/public/', 2),
  '?', 1
)
WHERE image LIKE '%/storage/v1/object/public/images/%'
  AND image NOT LIKE 'images/%';

-- Fix products table too (same issue could exist)
UPDATE public.products
SET image = 'images/' || split_part(
  split_part(image, '/storage/v1/object/sign/', 2),
  '?', 1
)
WHERE image LIKE '%/storage/v1/object/sign/%'
  AND image LIKE '%?token=%';

UPDATE public.products
SET image = 'images/' || split_part(
  split_part(image, '/storage/v1/object/public/', 2),
  '?', 1
)
WHERE image LIKE '%/storage/v1/object/public/images/%'
  AND image NOT LIKE 'images/%';
