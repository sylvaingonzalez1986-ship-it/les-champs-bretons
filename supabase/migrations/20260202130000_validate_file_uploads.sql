-- ============================================================================
-- VALIDATION DES UPLOADS DE FICHIERS - Les Chanvriers Unis
-- ============================================================================
-- Version: 1.0
-- Date: 2026-02-02
-- NOTE: Ported from database/migrations/validate_file_uploads.sql
-- ============================================================================

-- ============================================================================
-- 1. TABLE DE LOG DES UPLOADS
-- ============================================================================

CREATE TABLE IF NOT EXISTS upload_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id),
  bucket_name text NOT NULL,
  file_path text NOT NULL,
  file_size bigint,
  mime_type text,
  validation_status text NOT NULL CHECK (validation_status IN ('accepted', 'rejected', 'suspicious')),
  rejection_reason text,
  ip_address inet,
  user_agent text,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_upload_logs_user_id ON upload_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_upload_logs_status ON upload_logs(validation_status);
CREATE INDEX IF NOT EXISTS idx_upload_logs_created_at ON upload_logs(created_at DESC);

ALTER TABLE upload_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS upload_logs_select_admin ON upload_logs;
CREATE POLICY "upload_logs_select_admin"
ON upload_logs FOR SELECT
USING (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
);

DROP POLICY IF EXISTS upload_logs_insert ON upload_logs;
CREATE POLICY "upload_logs_insert"
ON upload_logs FOR INSERT
WITH CHECK (true);

-- ============================================================================
-- 2. TYPES MIME AUTORISÉS
-- ============================================================================

CREATE TABLE IF NOT EXISTS allowed_mime_types (
  id serial PRIMARY KEY,
  category text NOT NULL,
  mime_type text NOT NULL UNIQUE,
  max_size_bytes bigint NOT NULL,
  magic_bytes bytea[],
  description text,
  active boolean DEFAULT true
);

INSERT INTO allowed_mime_types (category, mime_type, max_size_bytes, magic_bytes, description) VALUES
('image', 'image/jpeg', 10485760, ARRAY[E'\\xFFD8FF'::bytea], 'JPEG image'),
('image', 'image/png', 10485760, ARRAY[E'\\x89504E47'::bytea], 'PNG image'),
('image', 'image/webp', 10485760, ARRAY[E'\\x52494646'::bytea], 'WebP image'),
('image', 'image/gif', 5242880, ARRAY[E'\\x47494638'::bytea], 'GIF image'),
('document', 'application/pdf', 5242880, ARRAY[E'\\x25504446'::bytea], 'PDF document')
ON CONFLICT (mime_type) DO NOTHING;

-- ============================================================================
-- 3. FONCTION DE VALIDATION DES UPLOADS
-- ============================================================================

CREATE OR REPLACE FUNCTION validate_file_upload(
  p_bucket_name text,
  p_file_path text,
  p_file_size bigint,
  p_mime_type text,
  p_file_header bytea DEFAULT NULL
)
RETURNS jsonb AS $$
DECLARE
  v_allowed allowed_mime_types%ROWTYPE;
  v_is_valid boolean := false;
  v_rejection_reason text := NULL;
  v_status text := 'rejected';
  v_result jsonb;
BEGIN
  SELECT * INTO v_allowed
  FROM allowed_mime_types
  WHERE mime_type = p_mime_type AND active = true;

  IF NOT FOUND THEN
    v_rejection_reason := 'Type de fichier non autorisé: ' || p_mime_type;
    v_status := 'rejected';
  ELSIF p_file_size > v_allowed.max_size_bytes THEN
    v_rejection_reason := 'Fichier trop volumineux. Max: ' || (v_allowed.max_size_bytes / 1048576) || 'MB';
    v_status := 'rejected';
  ELSIF p_file_header IS NOT NULL THEN
    v_is_valid := false;

    IF v_allowed.magic_bytes IS NOT NULL THEN
      FOR i IN 1..array_length(v_allowed.magic_bytes, 1) LOOP
        IF position(v_allowed.magic_bytes[i] in p_file_header) = 1 THEN
          v_is_valid := true;
          EXIT;
        END IF;
      END LOOP;

      IF NOT v_is_valid THEN
        v_rejection_reason := 'Signature de fichier invalide. Le fichier ne correspond pas au type déclaré.';
        v_status := 'suspicious';
      ELSE
        v_status := 'accepted';
      END IF;
    ELSE
      v_status := 'accepted';
    END IF;
  ELSE
    v_status := 'accepted';
  END IF;

  INSERT INTO upload_logs (
    user_id,
    bucket_name,
    file_path,
    file_size,
    mime_type,
    validation_status,
    rejection_reason
  ) VALUES (
    auth.uid(),
    p_bucket_name,
    p_file_path,
    p_file_size,
    p_mime_type,
    v_status,
    v_rejection_reason
  );

  v_result := jsonb_build_object(
    'valid', v_status = 'accepted',
    'status', v_status,
    'reason', v_rejection_reason,
    'max_size_mb', (v_allowed.max_size_bytes / 1048576)::int
  );

  RETURN v_result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- 4. FONCTION POUR OBTENIR LES TYPES AUTORISÉS
-- ============================================================================

CREATE OR REPLACE FUNCTION get_allowed_mime_types(p_category text DEFAULT NULL)
RETURNS TABLE (
  mime_type text,
  max_size_mb int,
  description text
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    amt.mime_type,
    (amt.max_size_bytes / 1048576)::int as max_size_mb,
    amt.description
  FROM allowed_mime_types amt
  WHERE amt.active = true
    AND (p_category IS NULL OR amt.category = p_category)
  ORDER BY amt.category, amt.mime_type;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

-- ============================================================================
-- 5. STATISTIQUES DES UPLOADS (pour les admins)
-- ============================================================================

CREATE OR REPLACE FUNCTION get_upload_statistics(
  p_days int DEFAULT 30
)
RETURNS jsonb AS $$
DECLARE
  v_stats jsonb;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin') THEN
    RETURN jsonb_build_object('error', 'Non autorisé');
  END IF;

  SELECT jsonb_build_object(
    'total_uploads', COUNT(*),
    'accepted', COUNT(*) FILTER (WHERE validation_status = 'accepted'),
    'rejected', COUNT(*) FILTER (WHERE validation_status = 'rejected'),
    'suspicious', COUNT(*) FILTER (WHERE validation_status = 'suspicious'),
    'total_size_mb', COALESCE(SUM(file_size) / 1048576, 0),
    'by_mime_type', (
      SELECT jsonb_object_agg(mime_type, cnt)
      FROM (
        SELECT mime_type, COUNT(*) as cnt
        FROM upload_logs
        WHERE created_at > now() - (p_days || ' days')::interval
        GROUP BY mime_type
      ) sub
    ),
    'recent_rejections', (
      SELECT jsonb_agg(jsonb_build_object(
        'file_path', file_path,
        'mime_type', mime_type,
        'reason', rejection_reason,
        'created_at', created_at
      ))
      FROM (
        SELECT file_path, mime_type, rejection_reason, created_at
        FROM upload_logs
        WHERE validation_status IN ('rejected', 'suspicious')
          AND created_at > now() - (p_days || ' days')::interval
        ORDER BY created_at DESC
        LIMIT 10
      ) sub
    )
  ) INTO v_stats
  FROM upload_logs
  WHERE created_at > now() - (p_days || ' days')::interval;

  RETURN v_stats;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- 6. GRANT PERMISSIONS
-- ============================================================================

GRANT EXECUTE ON FUNCTION validate_file_upload TO authenticated;
GRANT EXECUTE ON FUNCTION get_allowed_mime_types TO authenticated;
GRANT EXECUTE ON FUNCTION get_upload_statistics TO authenticated;
