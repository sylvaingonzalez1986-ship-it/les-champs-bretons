import { serve } from 'https://deno.land/std@0.208.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.38.0';
import { z } from 'https://deno.land/x/zod@v3.22.4/mod.ts';
type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  resetAt: number;
};

type RateLimitPreset = {
  windowMs: number;
  limit: number;
};

const RATE_LIMIT_PRESETS: Record<string, RateLimitPreset> = {
  GENERAL: { windowMs: 60_000, limit: 60 },
};

const rateLimitStore = new Map<string, { count: number; resetAt: number }>();

function checkRateLimit(key: string, preset: RateLimitPreset): RateLimitResult {
  const now = Date.now();
  const entry = rateLimitStore.get(key);

  if (!entry || now >= entry.resetAt) {
    const resetAt = now + preset.windowMs;
    rateLimitStore.set(key, { count: 1, resetAt });
    return { allowed: true, remaining: preset.limit - 1, resetAt };
  }

  if (entry.count >= preset.limit) {
    return { allowed: false, remaining: 0, resetAt: entry.resetAt };
  }

  entry.count += 1;
  rateLimitStore.set(key, entry);
  return { allowed: true, remaining: Math.max(preset.limit - entry.count, 0), resetAt: entry.resetAt };
}

function createRateLimitResponse(
  result: RateLimitResult,
  preset: RateLimitPreset,
  extraHeaders: Record<string, string>,
): Response {
  const headers = new Headers({
    ...extraHeaders,
    'Content-Type': 'application/json',
    'Retry-After': Math.ceil((result.resetAt - Date.now()) / 1000).toString(),
    'X-RateLimit-Limit': preset.limit.toString(),
    'X-RateLimit-Remaining': result.remaining.toString(),
    'X-RateLimit-Reset': Math.floor(result.resetAt / 1000).toString(),
  });

  return new Response(JSON.stringify({ error: 'RATE_LIMITED' }), { status: 429, headers });
}

function logSecurityEvent(event: {
  userId: string;
  action: string;
  endpoint: string;
  ip: string;
  userAgent: string;
  success: boolean;
  reason?: string;
}) {
  console.warn('[security-event]', JSON.stringify(event));
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Max-Age': '86400',
};

const promoSchema = z.object({
  id: z.string().min(1).optional(),
  product_id: z.string().min(1).optional(),
  producer_id: z.string().min(1).optional(),
  product_name: z.string().min(1).optional(),
  producer_name: z.string().min(1).optional(),
  original_price: z.number().nonnegative().optional(),
  promo_price: z.number().nonnegative().optional(),
  discount_percent: z.number().nonnegative().optional(),
  image: z.string().max(500).optional(),
  valid_until: z.string().min(1).optional(),
  active: z.boolean().optional(),
});

const requestSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('create'), promo: promoSchema }),
  z.object({ action: z.literal('update'), promoId: z.string().min(1), updates: promoSchema }),
  z.object({ action: z.literal('delete'), promoId: z.string().min(1) }),
]);

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function enforceRateLimit(req: Request, userId: string): Response | null {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0] || 'unknown';
  const userAgent = req.headers.get('user-agent') || 'unknown';
  const rateLimitResult = checkRateLimit(userId, RATE_LIMIT_PRESETS.GENERAL);

  if (!rateLimitResult.allowed) {
    logSecurityEvent({
      userId,
      action: 'rate_limit_exceeded',
      endpoint: 'promo-products-mutations',
      ip,
      userAgent,
      success: false,
      reason: `Exceeded ${RATE_LIMIT_PRESETS.GENERAL.limit} requests per window`,
    });
    return createRateLimitResponse(rateLimitResult, RATE_LIMIT_PRESETS.GENERAL, corsHeaders);
  }

  return null;
}

async function getUserFromRequest(req: Request) {
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
  const authHeader = req.headers.get('Authorization');

  if (!authHeader) {
    return { error: jsonResponse({ error: 'UNAUTHORIZED' }, 401) };
  }

  const supabase = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) {
    return { error: jsonResponse({ error: 'UNAUTHORIZED' }, 401) };
  }

  return { user: data.user };
}

async function getUserRole(serviceClient: ReturnType<typeof createClient>, userId: string): Promise<string> {
  const { data, error } = await serviceClient
    .from('profiles')
    .select('role')
    .eq('id', userId)
    .single();

  if (error) {
    return 'user';
  }

  return data?.role ?? 'user';
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'METHOD_NOT_ALLOWED' }, 405);
  }

  let body: unknown = {};
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: 'INVALID_JSON' }, 400);
  }

  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return jsonResponse({ error: 'VALIDATION_ERROR' }, 400);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

  if (!serviceKey) {
    return jsonResponse({ error: 'CONFIG_ERROR' }, 500);
  }

  const serviceClient = createClient(supabaseUrl, serviceKey);
  const { user, error } = await getUserFromRequest(req);
  if (error) {
    return error;
  }

  const rateLimitResponse = enforceRateLimit(req, user.id);
  if (rateLimitResponse) {
    return rateLimitResponse;
  }

  const role = await getUserRole(serviceClient, user.id);
  if (role !== 'admin') {
    return jsonResponse({ error: 'FORBIDDEN' }, 403);
  }

  if (parsed.data.action === 'create') {
    const { data, error: insertError } = await serviceClient
      .from('promo_products')
      .insert(parsed.data.promo)
      .select('*')
      .single();

    if (insertError) {
      return jsonResponse({ error: 'DATABASE_ERROR' }, 500);
    }

    return jsonResponse(data);
  }

  if (parsed.data.action === 'update') {
    const { data, error: updateError } = await serviceClient
      .from('promo_products')
      .update({
        ...parsed.data.updates,
        updated_at: new Date().toISOString(),
      })
      .eq('id', parsed.data.promoId)
      .select('*')
      .single();

    if (updateError) {
      return jsonResponse({ error: 'DATABASE_ERROR' }, 500);
    }

    return jsonResponse(data);
  }

  if (parsed.data.action === 'delete') {
    const { error: deleteError } = await serviceClient
      .from('promo_products')
      .delete()
      .eq('id', parsed.data.promoId);

    if (deleteError) {
      return jsonResponse({ error: 'DATABASE_ERROR' }, 500);
    }

    return jsonResponse({ success: true });
  }

  return jsonResponse({ error: 'INVALID_ACTION' }, 400);
});
