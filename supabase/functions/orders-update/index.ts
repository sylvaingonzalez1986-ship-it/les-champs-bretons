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
  ORDERS: { windowMs: 60_000, limit: 10 },
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

const updatesSchema = z.object({
  customer_first_name: z.string().min(1).max(100).optional(),
  customer_last_name: z.string().min(1).max(100).optional(),
  customer_email: z.string().email().max(255).optional(),
  customer_phone: z.string().max(50).optional(),
  customer_address: z.string().max(255).optional(),
  customer_city: z.string().max(100).optional(),
  customer_postal_code: z.string().max(20).optional(),
  items: z.array(z.record(z.unknown())).optional(),
  subtotal: z.number().nonnegative().optional(),
  shipping_fee: z.number().nonnegative().optional(),
  total: z.number().nonnegative().optional(),
  status: z.string().min(1).max(50).optional(),
  tracking_number: z.string().max(100).optional(),
  notes: z.string().max(1000).optional(),
  updated_at: z.string().optional(),
});

const requestSchema = z.object({
  id: z.string().min(1),
  updates: updatesSchema,
});

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function enforceRateLimit(req: Request, userId: string): Response | null {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0] || 'unknown';
  const userAgent = req.headers.get('user-agent') || 'unknown';
  const rateLimitResult = checkRateLimit(userId, RATE_LIMIT_PRESETS.ORDERS);

  if (!rateLimitResult.allowed) {
    logSecurityEvent({
      userId,
      action: 'rate_limit_exceeded',
      endpoint: 'orders-update',
      ip,
      userAgent,
      success: false,
      reason: `Exceeded ${RATE_LIMIT_PRESETS.ORDERS.limit} requests per window`,
    });
    return createRateLimitResponse(rateLimitResult, RATE_LIMIT_PRESETS.ORDERS, corsHeaders);
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

async function getProducerId(serviceClient: ReturnType<typeof createClient>, userId: string): Promise<string | null> {
  const { data, error } = await serviceClient
    .from('producers')
    .select('id')
    .eq('profile_id', userId)
    .single();

  if (error) {
    return null;
  }

  return data?.id ?? null;
}

function pickUpdates(source: Record<string, unknown>, allowed: Set<string>): Record<string, unknown> {
  const picked: Record<string, unknown> = {};
  for (const key of Object.keys(source)) {
    if (allowed.has(key)) {
      picked[key] = source[key];
    }
  }
  return picked;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'METHOD_NOT_ALLOWED' }, 405);
  }

  const { user, error } = await getUserFromRequest(req);
  if (error) {
    return error;
  }

  const rateLimitResponse = enforceRateLimit(req, user.id);
  if (rateLimitResponse) {
    return rateLimitResponse;
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
  const role = await getUserRole(serviceClient, user.id);

  const { data: order, error: orderError } = await serviceClient
    .from('orders')
    .select('id,user_id,items,status')
    .eq('id', parsed.data.id)
    .single();

  if (orderError || !order) {
    return jsonResponse({ error: 'ORDER_NOT_FOUND' }, 404);
  }

  const updates = parsed.data.updates;
  let allowedFields: Set<string>;

  if (role === 'admin') {
    allowedFields = new Set(Object.keys(updates));
  } else if (role === 'producer') {
    const producerId = await getProducerId(serviceClient, user.id);
    if (!producerId) {
      return jsonResponse({ error: 'FORBIDDEN' }, 403);
    }

    const items = Array.isArray(order.items) ? order.items : [];
    const hasProducerItems = items.some((item: Record<string, unknown>) => item?.producer_id === producerId);
    if (!hasProducerItems) {
      return jsonResponse({ error: 'FORBIDDEN' }, 403);
    }

    allowedFields = new Set(['status', 'tracking_number', 'notes']);
  } else {
    if (order.user_id !== user.id) {
      return jsonResponse({ error: 'FORBIDDEN' }, 403);
    }

    allowedFields = new Set([
      'customer_first_name',
      'customer_last_name',
      'customer_email',
      'customer_phone',
      'customer_address',
      'customer_city',
      'customer_postal_code',
      'items',
      'subtotal',
      'shipping_fee',
      'total',
      'notes',
      'status',
    ]);

    if (updates.status && updates.status !== 'pending') {
      return jsonResponse({ error: 'FORBIDDEN' }, 403);
    }
  }

  const filteredUpdates = pickUpdates(updates, allowedFields);
  if (Object.keys(filteredUpdates).length === 0) {
    return jsonResponse({ error: 'NO_ALLOWED_FIELDS' }, 400);
  }

  filteredUpdates.updated_at = new Date().toISOString();

  const { error: updateError } = await serviceClient
    .from('orders')
    .update(filteredUpdates)
    .eq('id', parsed.data.id);

  if (updateError) {
    return jsonResponse({ error: 'DATABASE_ERROR' }, 500);
  }

  return jsonResponse({ success: true });
});
