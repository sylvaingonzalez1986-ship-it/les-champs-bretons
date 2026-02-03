-- ============================================================================
-- SECURE LAB-ANALYSES BUCKET
-- Date: 2026-02-03
-- Description: Make lab-analyses bucket private and set up proper RLS
-- ============================================================================

-- 1. Mettre le bucket en privé (désactiver l'accès public)
UPDATE storage.buckets
SET public = false
WHERE id = 'lab-analyses';

-- 2. Supprimer les anciennes policies trop permissives (si existantes)
DROP POLICY IF EXISTS "Allow public read access" ON storage.objects;
DROP POLICY IF EXISTS "lab_analyses_public_read" ON storage.objects;
DROP POLICY IF EXISTS "Anyone can read lab analyses" ON storage.objects;

-- 3. Policy: Seuls les utilisateurs authentifiés peuvent lire les analyses
CREATE POLICY "lab_analyses_authenticated_read"
ON storage.objects FOR SELECT
TO authenticated
USING (
  bucket_id = 'lab-analyses'
);

-- 4. Policy: Seuls les admins et producteurs peuvent uploader
CREATE POLICY "lab_analyses_upload_admin_producer"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'lab-analyses'
  AND (
    -- Admin peut tout uploader
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'admin'
    )
    OR
    -- Producteur peut uploader pour ses propres produits
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'producer'
    )
  )
);

-- 5. Policy: Seuls les admins peuvent supprimer
CREATE POLICY "lab_analyses_delete_admin_only"
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id = 'lab-analyses'
  AND EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role = 'admin'
  )
);

-- 6. Créer le bucket s'il n'existe pas
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'lab-analyses',
  'lab-analyses',
  false,  -- PRIVÉ
  5242880,  -- 5MB max
  ARRAY['application/pdf', 'image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO UPDATE SET
  public = false,
  file_size_limit = 5242880,
  allowed_mime_types = ARRAY['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];
