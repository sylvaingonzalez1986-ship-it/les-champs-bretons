-- Add device binding fields to profiles
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS device_id text,
  ADD COLUMN IF NOT EXISTS device_bound_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_device_seen_at timestamptz;

-- Prevent device_id changes except service role or admin
CREATE OR REPLACE FUNCTION prevent_device_id_change()
RETURNS TRIGGER AS $func$
BEGIN
  IF NEW.device_id IS DISTINCT FROM OLD.device_id THEN
    IF auth.role() <> 'service_role' AND NOT is_admin() THEN
      RAISE EXCEPTION 'device_id is immutable';
    END IF;
  END IF;
  RETURN NEW;
END;
$func$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS profiles_device_id_immutable ON profiles;
CREATE TRIGGER profiles_device_id_immutable
  BEFORE UPDATE ON profiles
  FOR EACH ROW
  EXECUTE FUNCTION prevent_device_id_change();