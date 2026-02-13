-- ============================================================================
-- Allow 'pro' role to access pro_resources and pro_resource_categories
-- ============================================================================
-- Date: 2026-02-11
-- Purpose: Extend SELECT RLS policies to include 'pro' role alongside
--          'producer' and 'admin', so pro users can browse the resource directory.
-- ============================================================================

-- Drop existing SELECT policies
DROP POLICY IF EXISTS "pro_resource_categories_select" ON public.pro_resource_categories;
DROP POLICY IF EXISTS "pro_resources_select" ON public.pro_resources;

-- Recreate with 'pro' included
CREATE POLICY "pro_resource_categories_select"
  ON public.pro_resource_categories FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role IN ('pro', 'producer', 'admin')
    )
  );

CREATE POLICY "pro_resources_select"
  ON public.pro_resources FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role IN ('pro', 'producer', 'admin')
    )
  );
