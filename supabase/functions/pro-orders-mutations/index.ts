// @ts-nocheck
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
import { verifyDeviceBinding } from '../_shared/device.ts';

const requestSchema = z.object({
  action: z.literal('create'),
  productId: z.string().min(1),
  quantity: z.number().int().positive().max(10000),
  unitPrice: z.number().positive().max(1_000_000),
});

function jsonResponse(payload: unknown, status = 200, corsHeaders: Record<string, string>): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

async function getUserFromRequest(req: Request, responseCorsHeaders: Record<string, string>) {
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
  const authHeader = req.headers.get('Authorization');

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

async function enforceRateLimit(
  req: Request,
  userId: string,
  responseCorsHeaders: Record<string, string>
): Promise<Response | null> {
  const rateLimitResult = await checkRateLimit(userId, RATE_LIMIT_PRESETS.ORDERS);
  if (!rateLimitResult.allowed) {
    logSecurityEvent({
      userId,
      action: 'rate_limit_exceeded',
      endpoint: 'pro-orders-mutations',
      ip: req.headers.get('x-forwarded-for')?.split(',')[0] || 'unknown',
      userAgent: req.headers.get('user-agent') || 'unknown',
      success: false,
      reason: `Exceeded ${RATE_LIMIT_PRESETS.ORDERS.limit} requests per window`,
    });
    return createRateLimitResponse(rateLimitResult, RATE_LIMIT_PRESETS.ORDERS, responseCorsHeaders);
  }
  return null;
}

async function ensureProRole(serviceClient: ReturnType<typeof createClient>, userId: string): Promise<boolean> {
  const { data, error } = await serviceClient
    .from('profiles')
    .select('role')
    .eq('id', userId)
    .single();

  if (error || !data) return false;
  return data.role === 'pro' || data.role === 'admin';
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

  const { user, error } = await getUserFromRequest(req, responseCorsHeaders);
  if (error) {
    return error;
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
  const authHeader = req.headers.get('Authorization') ?? '';
  const deviceClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const deviceError = await verifyDeviceBinding(req, user, deviceClient, responseCorsHeaders);
  if (deviceError) {
    return deviceError;
  }

  const rateLimitResponse = await enforceRateLimit(req, user.id, responseCorsHeaders);
  if (rateLimitResponse) {
    return rateLimitResponse;
  }

  if (!anonKey || !authHeader) {
    return jsonResponse({ error: 'CONFIG_ERROR' }, 500, responseCorsHeaders);
  }

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });

  const isPro = await ensureProRole(userClient, user.id);
  if (!isPro) {
    return jsonResponse({ error: 'FORBIDDEN' }, 403, responseCorsHeaders);
  }

  const { productId, quantity, unitPrice } = parsed.data;
  const now = new Date().toISOString();

  const { data, error: insertError } = await userClient
    .from('pro_orders')
    .insert({
      product_id: productId,
      pro_user_id: user.id,
      type: 'buy_request',
      quantity,
      unit_price: unitPrice,
      status: 'pending',
      created_at: now,
      updated_at: now,
    })
    .select('*')
    .single();

  if (insertError) {
    return jsonResponse({ error: 'DATABASE_ERROR' }, 500, responseCorsHeaders);
  }

  return jsonResponse({ success: true, order: data }, 200, responseCorsHeaders);
});
