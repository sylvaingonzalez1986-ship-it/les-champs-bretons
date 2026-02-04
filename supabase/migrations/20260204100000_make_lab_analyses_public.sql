-- ============================================================================
-- MAKE LAB ANALYSES PUBLIC (READ) - Align with product visibility
-- Date: 2026-02-04
-- ============================================================================

-- 1. Set bucket public for read access
UPDATE storage.buckets
SET public = true
WHERE id = 'lab-analyses';

-- 2. Replace restrictive read policy with public read
DROP POLICY IF EXISTS "lab_analyses_authenticated_read" ON storage.objects;
DROP POLICY IF EXISTS "lab_analyses_public_read" ON storage.objects;

CREATE POLICY "lab_analyses_public_read"
ON storage.objects FOR SELECT
TO public
USING (
  bucket_id = 'lab-analyses'
);
