-- Enable RLS on storage.objects if not already enabled
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;

-- Drop existing policies (idempotent)
DROP POLICY IF EXISTS "product_images_insert" ON storage.objects;
DROP POLICY IF EXISTS "product_images_delete" ON storage.objects;

-- Upload restricted to producers (path = {producerId}/...)
CREATE POLICY "product_images_insert"
ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'product-images'
  AND EXISTS (
    SELECT 1
    FROM public.producers p
    WHERE p.profile_id = auth.uid()
      AND storage.objects.name LIKE (p.id || '/%')
  )
);

-- Delete restricted to producers (same rule)
CREATE POLICY "product_images_delete"
ON storage.objects FOR DELETE
USING (
  bucket_id = 'product-images'
  AND EXISTS (
    SELECT 1
    FROM public.producers p
    WHERE p.profile_id = auth.uid()
      AND storage.objects.name LIKE (p.id || '/%')
  )
);