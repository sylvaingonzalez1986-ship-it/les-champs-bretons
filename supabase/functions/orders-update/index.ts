import { serve } from 'https://deno.land/std@0.208.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.38.0';
import { z } from 'https://deno.land/x/zod@v3.22.4/mod.ts';
import { getCorsHeaders, isOriginAllowed } from '../_shared/cors.ts';
import {
  checkRateLimit,
  createRateLimitResponse,
  logSecurityEvent,
  RATE_LIMIT_PRESETS,
} from '../_shared/rate-limit.ts';

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

function jsonResponse(payload: unknown, status = 200, corsHeaders: Record<string, string>): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

async function enforceRateLimit(req: Request, userId: string): Promise<Response | null> {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0] || 'unknown';
  const userAgent = req.headers.get('user-agent') || 'unknown';
  const rateLimitResult = await checkRateLimit(userId, RATE_LIMIT_PRESETS.ORDERS);

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
    return createRateLimitResponse(rateLimitResult, RATE_LIMIT_PRESETS.ORDERS, getCorsHeaders(req));
  }

  return null;
}

async function getUserFromRequest(req: Request) {
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
  const authHeader = req.headers.get('Authorization');
  const responseCorsHeaders = getCorsHeaders(req);

  if (!authHeader) {
    return { error: jsonResponse({ error: 'UNAUTHORIZED' }, 401, responseCorsHeaders) };
  }

  const supabase = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) {
    return { error: jsonResponse({ error: 'UNAUTHORIZED' }, 401, responseCorsHeaders) };
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
  const responseCorsHeaders = getCorsHeaders(req);
  const origin = req.headers.get('origin');

  if (!isOriginAllowed(origin)) {
    return new Response(JSON.stringify({ error: 'CORS_NOT_ALLOWED' }), {
      status: 403,
      headers: { ...responseCorsHeaders, 'Content-Type': 'application/json' },
    });
  }

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: responseCorsHeaders });
  }

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'METHOD_NOT_ALLOWED' }, 405, responseCorsHeaders);
  }

  const { user, error } = await getUserFromRequest(req);
  if (error) {
    return error;
  }

  const rateLimitResponse = await enforceRateLimit(req, user.id);
  if (rateLimitResponse) {
    return rateLimitResponse;
  }

  let body: unknown = {};
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: 'INVALID_JSON' }, 400, responseCorsHeaders);
  }

  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return jsonResponse({ error: 'VALIDATION_ERROR' }, 400, responseCorsHeaders);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

  if (!serviceKey) {
    return jsonResponse({ error: 'CONFIG_ERROR' }, 500, responseCorsHeaders);
  }

  const serviceClient = createClient(supabaseUrl, serviceKey);
  const role = await getUserRole(serviceClient, user.id);

  const { data: order, error: orderError } = await serviceClient
    .from('orders')
    .select('id,user_id,items,status')
    .eq('id', parsed.data.id)
    .single();

  if (orderError || !order) {
    return jsonResponse({ error: 'ORDER_NOT_FOUND' }, 404, responseCorsHeaders);
  }

  const updates = parsed.data.updates;
  let allowedFields: Set<string>;

  if (role === 'admin') {
    allowedFields = new Set(Object.keys(updates));
  } else if (role === 'producer') {
    const producerId = await getProducerId(serviceClient, user.id);
    if (!producerId) {
      return jsonResponse({ error: 'FORBIDDEN' }, 403, responseCorsHeaders);
    }

    const items = Array.isArray(order.items) ? order.items : [];
    const hasProducerItems = items.some((item: Record<string, unknown>) => item?.producer_id === producerId);
    if (!hasProducerItems) {
      return jsonResponse({ error: 'FORBIDDEN' }, 403, responseCorsHeaders);
    }

    allowedFields = new Set(['status', 'tracking_number', 'notes']);
  } else {
    if (order.user_id !== user.id) {
      return jsonResponse({ error: 'FORBIDDEN' }, 403, responseCorsHeaders);
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
      return jsonResponse({ error: 'FORBIDDEN' }, 403, responseCorsHeaders);
    }
  }

  const filteredUpdates = pickUpdates(updates, allowedFields);
  if (Object.keys(filteredUpdates).length === 0) {
    return jsonResponse({ error: 'NO_ALLOWED_FIELDS' }, 400, responseCorsHeaders);
  }

  filteredUpdates.updated_at = new Date().toISOString();

  const { error: updateError } = await serviceClient
    .from('orders')
    .update(filteredUpdates)
    .eq('id', parsed.data.id);

  if (updateError) {
    return jsonResponse({ error: 'DATABASE_ERROR' }, 500, responseCorsHeaders);
  }

  return jsonResponse({ success: true }, 200, responseCorsHeaders);
});
