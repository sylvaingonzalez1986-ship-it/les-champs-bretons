-- Fix trigger functions that use SET search_path TO '' but reference
-- tables without schema qualification, causing "relation does not exist" errors.

CREATE OR REPLACE FUNCTION "public"."handle_profile_as_producer"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
BEGIN
  IF NEW.role = 'producer' THEN
    UPDATE public.producers
    SET
      email = NEW.email,
      name = COALESCE(NEW.full_name, NEW.email),
      pro_status = COALESCE(NEW.pro_status, 'approved')
    WHERE profile_id = NEW.id;

    IF NOT FOUND THEN
      INSERT INTO public.producers (id, profile_id, email, name, pro_status)
      VALUES (
        gen_random_uuid(),
        NEW.id,
        NEW.email,
        COALESCE(NEW.full_name, NEW.email),
        COALESCE(NEW.pro_status, 'approved')
      );
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION "public"."sync_direct_sales_availability"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
BEGIN
  IF NEW.vente_directe_ferme = false AND OLD.vente_directe_ferme = true THEN
    UPDATE public.products
    SET disponible_vente_directe = false
    WHERE producer_id IN (
      SELECT id FROM public.producers WHERE profile_id = NEW.id
    );
  END IF;
  RETURN NEW;
END;
$$;
