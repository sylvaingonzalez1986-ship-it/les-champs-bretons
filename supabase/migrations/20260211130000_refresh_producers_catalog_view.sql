-- ============================================================================
-- Refresh producers_catalog materialized view
-- ============================================================================
-- Date: 2026-02-11
-- Purpose: After fixing signed URLs to relative paths in producers and products
--          tables (migrations 20260211110000 and 20260211120000), the materialized
--          view still contains stale expired signed URLs. This refresh updates
--          the view with the corrected relative paths.
-- ============================================================================

REFRESH MATERIALIZED VIEW CONCURRENTLY producers_catalog;
