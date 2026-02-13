-- Create direct sales cart table in Supabase schema (idempotent)

CREATE TABLE IF NOT EXISTS public.panier_vente_directe (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  product_id text NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  producer_id text NOT NULL REFERENCES public.producers(id) ON DELETE CASCADE,
  quantity integer NOT NULL DEFAULT 1 CHECK (quantity > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.panier_vente_directe ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.panier_vente_directe FORCE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_panier_vente_directe_user_created
  ON public.panier_vente_directe(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_panier_vente_directe_user_product
  ON public.panier_vente_directe(user_id, product_id, created_at DESC);

DROP POLICY IF EXISTS panier_select ON public.panier_vente_directe;
DROP POLICY IF EXISTS panier_insert ON public.panier_vente_directe;
DROP POLICY IF EXISTS panier_update ON public.panier_vente_directe;
DROP POLICY IF EXISTS panier_delete ON public.panier_vente_directe;

CREATE POLICY panier_select
ON public.panier_vente_directe
FOR SELECT
USING (user_id = auth.uid());

CREATE POLICY panier_insert
ON public.panier_vente_directe
FOR INSERT
WITH CHECK (user_id = auth.uid());

CREATE POLICY panier_update
ON public.panier_vente_directe
FOR UPDATE
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());

CREATE POLICY panier_delete
ON public.panier_vente_directe
FOR DELETE
USING (user_id = auth.uid());

CREATE OR REPLACE FUNCTION public.update_panier_vente_directe_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO ''
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS panier_vente_directe_updated_at ON public.panier_vente_directe;
CREATE TRIGGER panier_vente_directe_updated_at
BEFORE UPDATE ON public.panier_vente_directe
FOR EACH ROW
EXECUTE FUNCTION public.update_panier_vente_directe_updated_at();
