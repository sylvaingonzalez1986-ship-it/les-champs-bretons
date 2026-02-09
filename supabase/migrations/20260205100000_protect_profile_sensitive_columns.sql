-- ============================================================================
-- SECURITY: Protect sensitive columns on profiles from client-side tampering
-- ============================================================================
-- Date: 2026-02-05
-- Problem: RLS policy "Users can update own profile" allows authenticated users
--          to PATCH any column on their own profile row via PostgREST, including
--          `role`, `pro_status`, `email`, `is_adult`, `age_verified_at`,
--          and `user_code`. This enables privilege escalation.
--
-- Solution: BEFORE UPDATE trigger with GRANULAR rules per column:
--   - role:             block setting to 'admin' (signup sets 'pro'/'producer' = OK)
--   - pro_status:       block setting to 'approved'/'rejected' (signup sets 'pending' = OK)
--   - email:            block ALL changes (must use supabase auth.updateUser())
--   - is_adult:         block ALL changes (server-side verification only)
--   - age_verified_at:  block ALL changes (server-side verification only)
--   - user_code:        block ALL changes (dedicated linkUserCode RPC)
--
-- Compatibility: signup.tsx sets role='pro' & pro_status='pending' → ALLOWED
--                login.tsx sets pending role from AsyncStorage     → ALLOWED
--                edit-profile.tsx sends name/phone/address         → ALLOWED
--                admin dashboard via service_role                  → ALLOWED
--
-- Pattern: Same as existing prevent_device_id_change() trigger.
-- Impact: Zero breakage on any existing flow.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.protect_profile_sensitive_columns()
RETURNS TRIGGER AS $func$
BEGIN
  -- ── Fast path: service_role can do anything ──
  IF auth.role() = 'service_role' THEN
    RETURN NEW;
  END IF;

  -- ── Fast path: admins can do anything ──
  IF public.is_admin() THEN
    RETURN NEW;
  END IF;

  -- ════════════════════════════════════════════════════════════════════
  -- ROLE: Users can self-assign 'client', 'pro', 'producer' during
  -- signup, but NEVER 'admin'.
  -- ════════════════════════════════════════════════════════════════════
  IF NEW.role IS DISTINCT FROM OLD.role THEN
    IF NEW.role = 'admin' THEN
      RAISE EXCEPTION 'Cannot self-assign admin role'
        USING ERRCODE = '42501'; -- insufficient_privilege
    END IF;
    -- Additional guard: once you're 'pro' or 'producer', you can't
    -- downgrade back to 'client' to re-trigger signup flow
    IF OLD.role IN ('pro', 'producer') AND NEW.role = 'client' THEN
      RAISE EXCEPTION 'Cannot downgrade role — contact support'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  -- ════════════════════════════════════════════════════════════════════
  -- PRO_STATUS: Users can set 'pending' (signup) but never
  -- 'approved' or 'rejected' (admin-only workflow).
  -- ════════════════════════════════════════════════════════════════════
  IF NEW.pro_status IS DISTINCT FROM OLD.pro_status THEN
    IF NEW.pro_status IN ('approved', 'rejected') THEN
      RAISE EXCEPTION 'Cannot self-approve or self-reject pro status'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  -- ════════════════════════════════════════════════════════════════════
  -- HARD-BLOCKED columns: never modifiable by regular users.
  -- ════════════════════════════════════════════════════════════════════
  IF NEW.email IS DISTINCT FROM OLD.email THEN
    RAISE EXCEPTION 'Cannot modify email via profile update — use auth flow'
      USING ERRCODE = '42501';
  END IF;

  IF NEW.is_adult IS DISTINCT FROM OLD.is_adult THEN
    RAISE EXCEPTION 'Cannot modify is_adult — server-side verification only'
      USING ERRCODE = '42501';
  END IF;

  IF NEW.age_verified_at IS DISTINCT FROM OLD.age_verified_at THEN
    RAISE EXCEPTION 'Cannot modify age_verified_at — server-side verification only'
      USING ERRCODE = '42501';
  END IF;

  IF NEW.user_code IS DISTINCT FROM OLD.user_code THEN
    RAISE EXCEPTION 'Cannot modify user_code — use the dedicated link flow'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$func$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

-- Drop if exists (idempotent)
DROP TRIGGER IF EXISTS profiles_protect_sensitive_columns ON public.profiles;

-- Fire BEFORE the existing device_id trigger so we catch escalation first
CREATE TRIGGER profiles_protect_sensitive_columns
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_profile_sensitive_columns();

-- ============================================================================
-- VERIFICATION (run manually to confirm):
-- SELECT tgname, tgtype, tgenabled
--   FROM pg_trigger
--  WHERE tgrelid = 'public.profiles'::regclass
--    AND NOT tgisinternal;
-- ============================================================================
