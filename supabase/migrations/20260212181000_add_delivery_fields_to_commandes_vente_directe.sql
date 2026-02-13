-- Add delivery/payment fields for direct sale orders (commandes_vente_directe)

ALTER TABLE public.commandes_vente_directe
  ADD COLUMN IF NOT EXISTS delivery_method text DEFAULT 'pickup',
  ADD COLUMN IF NOT EXISTS delivery_fee numeric(10,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS delivery_address text,
  ADD COLUMN IF NOT EXISTS delivery_instructions text,
  ADD COLUMN IF NOT EXISTS payment_method text DEFAULT 'on_site';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'commandes_vente_directe_delivery_method_check'
  ) THEN
    ALTER TABLE public.commandes_vente_directe
      ADD CONSTRAINT commandes_vente_directe_delivery_method_check
      CHECK (delivery_method IN ('pickup', 'shipping'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'commandes_vente_directe_delivery_fee_check'
  ) THEN
    ALTER TABLE public.commandes_vente_directe
      ADD CONSTRAINT commandes_vente_directe_delivery_fee_check
      CHECK (delivery_fee >= 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'commandes_vente_directe_payment_method_check'
  ) THEN
    ALTER TABLE public.commandes_vente_directe
      ADD CONSTRAINT commandes_vente_directe_payment_method_check
      CHECK (payment_method IN ('payment_link', 'on_site'));
  END IF;
END $$;
