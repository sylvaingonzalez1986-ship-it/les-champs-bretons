import { serve } from 'https://deno.land/std@0.208.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.38.0';
import { z } from 'https://deno.land/x/zod@v3.22.4/mod.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Max-Age': '86400',
};

type RateLimitEntry = {
  count: number;
  resetAt: number;
};

const RATE_LIMIT = { limit: 60, windowMs: 60 * 1000 };
const rateLimitStore = new Map<string, RateLimitEntry>();

const metricSchema = z.object({
  name: z.string().min(1).max(120),
  type: z.enum(['timing', 'count']),
  value: z.number().nonnegative(),
  context: z.record(z.unknown()).optional(),
});

const requestSchema = z.object({
  metrics: z.array(metricSchema).min(1).max(50),
});

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'METHOD_NOT_ALLOWED' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const ip = req.headers.get('x-forwarded-for')?.split(',')[0] || 'unknown';
  const now = Date.now();
  const entry = rateLimitStore.get(ip);
  if (!entry || now > entry.resetAt) {
    rateLimitStore.set(ip, { count: 1, resetAt: now + RATE_LIMIT.windowMs });
  } else if (entry.count >= RATE_LIMIT.limit) {
    return new Response(
      JSON.stringify({
        error: 'RATE_LIMIT_EXCEEDED',
        message: `Rate limit exceeded. Max ${RATE_LIMIT.limit}/min.`,
      }),
      { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } else {
    entry.count += 1;
  }

  let body: unknown = {};
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'INVALID_JSON' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return new Response(JSON.stringify({ error: 'VALIDATION_ERROR' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

  if (!supabaseUrl || !serviceKey) {
    return new Response(
      JSON.stringify({ error: 'CONFIG_ERROR' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  const serviceClient = createClient(supabaseUrl, serviceKey);
  const payload = parsed.data.metrics.map((metric) => ({
    name: metric.name,
    metric_type: metric.type,
    value: metric.value,
    context: metric.context ?? null,
  }));

  const { error } = await serviceClient.from('perf_metrics').insert(payload);
  if (error) {
    return new Response(
      JSON.stringify({ error: 'DATABASE_ERROR', message: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  return new Response(
    JSON.stringify({ success: true }),
    { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );
});
