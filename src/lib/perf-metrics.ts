import { SUPABASE_URL, SUPABASE_ANON_KEY, getSession } from './supabase-auth';

type MetricContext = Record<string, string | number | boolean | null | undefined>;

type PerfMetric = {
  name: string;
  type: 'timing' | 'count';
  value: number;
  context?: MetricContext;
};

const METRIC_BUFFER: PerfMetric[] = [];
let flushTimeout: ReturnType<typeof setTimeout> | null = null;
const MAX_BUFFER = 20;
const FLUSH_DELAY_MS = 15000;

function scheduleFlush(): void {
  if (flushTimeout) return;
  flushTimeout = setTimeout(() => {
    flushTimeout = null;
    void flushMetrics();
  }, FLUSH_DELAY_MS);
}

async function flushMetrics(): Promise<void> {
  if (METRIC_BUFFER.length === 0) return;

  const payload = METRIC_BUFFER.splice(0, METRIC_BUFFER.length);
  try {
    const session = getSession();
    const token = session?.access_token || SUPABASE_ANON_KEY;

    await fetch(`${SUPABASE_URL}/functions/v1/perf-metrics`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ metrics: payload }),
    });
  } catch {
    // Silent failure for metrics
  }
}

function enqueueMetric(metric: PerfMetric): void {
  METRIC_BUFFER.push(metric);
  if (METRIC_BUFFER.length >= MAX_BUFFER) {
    void flushMetrics();
    return;
  }
  scheduleFlush();
}

export function startMetric(name: string): number {
  const start = Date.now();
  if (__DEV__) {
    console.info(`[Metrics] Start: ${name}`);
  }
  return start;
}

export function endMetric(name: string, startTime: number, context?: MetricContext): void {
  const durationMs = Date.now() - startTime;
  if (__DEV__) {
    console.info(`[Metrics] ${name}=${durationMs}ms`, context ?? {});
  }
  enqueueMetric({ name, type: 'timing', value: durationMs, context });
}

export function incrementMetric(name: string, count = 1, context?: MetricContext): void {
  if (__DEV__) {
    console.info(`[Metrics] ${name}+=${count}`, context ?? {});
  }
  enqueueMetric({ name, type: 'count', value: count, context });
}
