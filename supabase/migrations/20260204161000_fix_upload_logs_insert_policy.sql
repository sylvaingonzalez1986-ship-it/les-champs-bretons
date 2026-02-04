-- ============================================================================
-- FIX UPLOAD_LOGS INSERT POLICY (prevent log pollution)
-- Date: 2026-02-04
-- ============================================================================

DROP POLICY IF EXISTS "upload_logs_insert" ON upload_logs;

CREATE POLICY "upload_logs_insert"
ON upload_logs FOR INSERT
TO authenticated
WITH CHECK (
  user_id = auth.uid()
);
