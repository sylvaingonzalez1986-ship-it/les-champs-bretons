-- =============================================================================
-- Migration: Fix mutable search_path on SECURITY DEFINER functions
-- Date: 2026-01-15 (Updated: 2026-02-03)
-- Description: Addresses "role mutable search_path" security vulnerability
-- =============================================================================
--
-- RISQUE DE SÉCURITÉ:
-- Les fonctions SECURITY DEFINER sans search_path fixe sont vulnérables aux
-- attaques d'injection SQL. Un attaquant peut créer un schema malveillant
-- avec des objets du même nom et manipuler search_path pour exécuter son code
-- avec les privilèges élevés de la fonction.
--
-- SOLUTION:
-- Fixer search_path = '' (vide) force l'utilisation de noms qualifiés (schema.table)
-- ce qui empêche toute injection via search_path.
--
-- AUDIT SOURCE: pg_proc query on production database (2026-02-03)
-- =============================================================================

-- Fonctions sans paramètres
ALTER FUNCTION public.auth_is_admin() SET search_path = '';
ALTER FUNCTION public.auth_is_pro() SET search_path = '';
ALTER FUNCTION public.auth_is_producer() SET search_path = '';
ALTER FUNCTION public.check_is_admin() SET search_path = '';
ALTER FUNCTION public.create_user_code_mapping() SET search_path = '';
ALTER FUNCTION public.create_user_data() SET search_path = '';
ALTER FUNCTION public.export_user_data() SET search_path = '';
ALTER FUNCTION public.get_current_profile() SET search_path = '';
ALTER FUNCTION public.get_current_user_email() SET search_path = '';
ALTER FUNCTION public.get_my_producer_id() SET search_path = '';
ALTER FUNCTION public.get_user_producer_id() SET search_path = '';
ALTER FUNCTION public.handle_new_user() SET search_path = '';
ALTER FUNCTION public.is_admin() SET search_path = '';
ALTER FUNCTION public.is_pro() SET search_path = '';
ALTER FUNCTION public.is_producer() SET search_path = '';
ALTER FUNCTION public.log_product_update() SET search_path = '';
ALTER FUNCTION public.prevent_mass_enumeration() SET search_path = '';
ALTER FUNCTION public.preview_account_deletion() SET search_path = '';

-- Fonctions avec paramètres (signatures exactes auditées 2026-02-03)
ALTER FUNCTION public.add_user_lot(uuid, text, text, text, text, text, numeric, text, integer, numeric, numeric) SET search_path = '';
ALTER FUNCTION public.admin_reset_rate_limit(inet, text) SET search_path = '';
ALTER FUNCTION public.check_rate_limit(inet, text, uuid, integer, integer, integer) SET search_path = '';
ALTER FUNCTION public.create_direct_sale_order(uuid, text, jsonb) SET search_path = '';
ALTER FUNCTION public.delete_user_account(text) SET search_path = '';
ALTER FUNCTION public.get_allowed_mime_types(text) SET search_path = '';
ALTER FUNCTION public.get_upload_statistics(integer) SET search_path = '';
ALTER FUNCTION public.link_producer_to_profile(text, uuid) SET search_path = '';
ALTER FUNCTION public.link_user_code(text) SET search_path = '';
ALTER FUNCTION public.log_security_event(text, text, text, boolean, text, jsonb) SET search_path = '';
ALTER FUNCTION public.request_account_deletion(uuid) SET search_path = '';
ALTER FUNCTION public.validate_file_upload(text, text, bigint, text, bytea) SET search_path = '';

-- =============================================================================
-- Fin de la migration - 30 fonctions SECURITY DEFINER sécurisées
-- =============================================================================

-- =============================================================================
-- IMPORTANT: Après cette migration, les fonctions doivent utiliser des noms
-- pleinement qualifiés (ex: public.profiles au lieu de profiles).
-- Si une fonction échoue, vérifiez qu'elle utilise bien les noms qualifiés.
-- =============================================================================
