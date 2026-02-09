-- ============================================================================
-- PRO RESOURCES: Categories & Resource directory for producers
-- ============================================================================
-- Date: 2026-02-06
-- Purpose: Dynamic professional resource directory (training, seeds, soil, tools)
--          accessible to producers only. Categories are admin-configurable.
-- ============================================================================

-- ── Categories table ──
CREATE TABLE IF NOT EXISTS public.pro_resource_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text NOT NULL UNIQUE,
  description text,
  color text DEFAULT '#D4A853',
  sort_order integer DEFAULT 0,
  active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- ── Resources table ──
CREATE TABLE IF NOT EXISTS public.pro_resources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id uuid NOT NULL REFERENCES public.pro_resource_categories(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  logo_url text,
  website_url text,
  email text,
  phone text,
  city text,
  region text,
  tags text[] DEFAULT '{}',
  featured boolean DEFAULT false,
  active boolean DEFAULT true,
  sort_order integer DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- ── Indexes ──
CREATE INDEX IF NOT EXISTS idx_pro_resources_category ON public.pro_resources(category_id);
CREATE INDEX IF NOT EXISTS idx_pro_resources_active ON public.pro_resources(active) WHERE active = true;
CREATE INDEX IF NOT EXISTS idx_pro_resource_categories_active ON public.pro_resource_categories(active) WHERE active = true;

-- ── RLS ──
ALTER TABLE public.pro_resource_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pro_resources ENABLE ROW LEVEL SECURITY;

-- SELECT: producers and admins only
CREATE POLICY "pro_resource_categories_select"
  ON public.pro_resource_categories FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role IN ('producer', 'admin')
    )
  );

CREATE POLICY "pro_resources_select"
  ON public.pro_resources FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role IN ('producer', 'admin')
    )
  );

-- INSERT/UPDATE/DELETE: admin or service_role only
CREATE POLICY "pro_resource_categories_admin_insert"
  ON public.pro_resource_categories FOR INSERT
  TO authenticated
  WITH CHECK (public.is_admin() OR auth.role() = 'service_role');

CREATE POLICY "pro_resource_categories_admin_update"
  ON public.pro_resource_categories FOR UPDATE
  TO authenticated
  USING (public.is_admin() OR auth.role() = 'service_role')
  WITH CHECK (public.is_admin() OR auth.role() = 'service_role');

CREATE POLICY "pro_resource_categories_admin_delete"
  ON public.pro_resource_categories FOR DELETE
  TO authenticated
  USING (public.is_admin() OR auth.role() = 'service_role');

CREATE POLICY "pro_resources_admin_insert"
  ON public.pro_resources FOR INSERT
  TO authenticated
  WITH CHECK (public.is_admin() OR auth.role() = 'service_role');

CREATE POLICY "pro_resources_admin_update"
  ON public.pro_resources FOR UPDATE
  TO authenticated
  USING (public.is_admin() OR auth.role() = 'service_role')
  WITH CHECK (public.is_admin() OR auth.role() = 'service_role');

CREATE POLICY "pro_resources_admin_delete"
  ON public.pro_resources FOR DELETE
  TO authenticated
  USING (public.is_admin() OR auth.role() = 'service_role');

-- ── updated_at trigger ──
CREATE OR REPLACE FUNCTION public.update_pro_resource_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

CREATE TRIGGER pro_resource_categories_updated_at
  BEFORE UPDATE ON public.pro_resource_categories
  FOR EACH ROW EXECUTE FUNCTION public.update_pro_resource_updated_at();

CREATE TRIGGER pro_resources_updated_at
  BEFORE UPDATE ON public.pro_resources
  FOR EACH ROW EXECUTE FUNCTION public.update_pro_resource_updated_at();

-- ── Seed: 4 initial categories ──
INSERT INTO public.pro_resource_categories (name, slug, description, color, sort_order) VALUES
  ('Formation', 'formation', 'Formations professionnelles, certifications et ateliers', '#6BB5D9', 1),
  ('Semences', 'semences', 'Semenciers, variétés certifiées et génétiques', '#5A9E5A', 2),
  ('Vie du Sol', 'vie-du-sol', 'Amendements, micro-organismes et biostimulants', '#9B7B5A', 3),
  ('Outillage', 'outillage', 'Matériel agricole, outils et équipements', '#E8945A', 4)
ON CONFLICT (slug) DO NOTHING;
