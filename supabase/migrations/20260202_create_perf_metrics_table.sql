-- ============================================================================
-- PERF METRICS TABLE - Load Testing Fixes
-- Date: 2026-02-02
-- ============================================================================

CREATE TABLE IF NOT EXISTS perf_metrics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid,
  name text NOT NULL,
  metric_type text NOT NULL CHECK (metric_type IN ('timing', 'count')),
  value numeric NOT NULL,
  context jsonb,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_perf_metrics_created_at ON perf_metrics(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_perf_metrics_name ON perf_metrics(name);

ALTER TABLE perf_metrics ENABLE ROW LEVEL SECURITY;

-- No client-side policies (service role only)
