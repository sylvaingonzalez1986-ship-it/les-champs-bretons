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

const lotSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional().nullable(),
  rarity: z.string().min(1),
  image: z.string().min(1),
  value: z.number().nonnegative(),
  active: z.boolean(),
  lotType: z.string().optional().nullable(),
  discountPercent: z.number().optional().nullable(),
  discountAmount: z.number().optional().nullable(),
  minOrderAmount: z.number().optional().nullable(),
});

const lotItemSchema = z.object({
  productId: z.string().min(1),
  producerId: z.string().min(1),
  productName: z.string().min(1),
  producerName: z.string().min(1),
  quantity: z.number().int().positive().max(10000),
});

const requestSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('create'),
    lot: lotSchema,
    items: z.array(lotItemSchema),
  }),
  z.object({
    action: z.literal('update'),
    lotId: z.string().min(1),
    updates: lotSchema.partial(),
  }),
  z.object({
    action: z.literal('replaceItems'),
    lotId: z.string().min(1),
    items: z.array(lotItemSchema),
  }),
  z.object({
    action: z.literal('delete'),
    lotId: z.string().min(1),
  }),
  z.object({
    action: z.literal('addItem'),
    lotId: z.string().min(1),
    item: lotItemSchema,
  }),
]);

function jsonResponse(payload: unknown, status = 200, corsHeaders: Record<string, string>): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

async function getUserFromRequest(req: Request) {
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
  const authHeader = req.headers.get('Authorization');

  if (!authHeader) {
    return { error: jsonResponse({ error: 'UNAUTHORIZED' }, 401, getCorsHeaders(req)) };
  }

  const supabase = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) {
    return { error: jsonResponse({ error: 'UNAUTHORIZED' }, 401, getCorsHeaders(req)) };
  }

  return { user: data.user };
}

async function enforceRateLimit(req: Request, userId: string): Promise<Response | null> {
  const rateLimitResult = await checkRateLimit(userId, RATE_LIMIT_PRESETS.GENERAL);
  if (!rateLimitResult.allowed) {
    logSecurityEvent({
      userId,
      action: 'rate_limit_exceeded',
      endpoint: 'lots-mutations',
      ip: req.headers.get('x-forwarded-for')?.split(',')[0] || 'unknown',
      userAgent: req.headers.get('user-agent') || 'unknown',
      success: false,
      reason: `Exceeded ${RATE_LIMIT_PRESETS.GENERAL.limit} requests per window`,
    });
    return createRateLimitResponse(rateLimitResult, RATE_LIMIT_PRESETS.GENERAL, getCorsHeaders(req));
  }
  return null;
}

async function ensureAdminRole(serviceClient: ReturnType<typeof createClient>, userId: string): Promise<boolean> {
  const { data, error } = await serviceClient
    .from('profiles')
    .select('role')
    .eq('id', userId)
    .single();

  if (error || !data) return false;
  return data.role === 'admin';
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

  const { user, error } = await getUserFromRequest(req);
  if (error) {
    return error;
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
  const authHeader = req.headers.get('Authorization') ?? '';
  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const deviceError = await verifyDeviceBinding(req, user, userClient, responseCorsHeaders);
  if (deviceError) {
    return deviceError;
  }

  const rateLimitResponse = await enforceRateLimit(req, user.id);
  if (rateLimitResponse) {
    return rateLimitResponse;
  }

  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (!serviceKey) {
    return jsonResponse({ error: 'CONFIG_ERROR' }, 500, responseCorsHeaders);
  }

  const serviceClient = createClient(supabaseUrl, serviceKey);
  const isAdmin = await ensureAdminRole(serviceClient, user.id);
  if (!isAdmin) {
    return jsonResponse({ error: 'FORBIDDEN' }, 403, responseCorsHeaders);
  }

  if (parsed.data.action === 'create') {
    const lot = parsed.data.lot;
    const items = parsed.data.items;

    const { data: lotData, error: lotError } = await serviceClient
      .from('lots')
      .insert({
        id: lot.id,
        name: lot.name,
        description: lot.description ?? null,
        rarity: lot.rarity,
        image: lot.image,
        value: lot.value,
        active: lot.active,
        lot_type: lot.lotType ?? null,
        discount_percent: lot.discountPercent ?? null,
        discount_amount: lot.discountAmount ?? null,
        min_order_amount: lot.minOrderAmount ?? null,
      })
      .select('*')
      .single();

    if (lotError) {
      return jsonResponse({ error: 'DATABASE_ERROR' }, 500, responseCorsHeaders);
    }

    if (items.length > 0) {
      const insertItems = items.map((item) => ({
        lot_id: lot.id,
        product_id: item.productId,
        producer_id: item.producerId,
        product_name: item.productName,
        producer_name: item.producerName,
        quantity: item.quantity,
      }));

      const { error: itemsError } = await serviceClient
        .from('lot_items')
        .insert(insertItems);

      if (itemsError) {
        return jsonResponse({ error: 'DATABASE_ERROR' }, 500, responseCorsHeaders);
      }
    }

    return jsonResponse({ success: true, lot: lotData }, 200, responseCorsHeaders);
  }

  if (parsed.data.action === 'update') {
    const updates = parsed.data.updates;

    const { error: updateError } = await serviceClient
      .from('lots')
      .update({
        name: updates.name,
        description: updates.description ?? null,
        rarity: updates.rarity,
        image: updates.image,
        value: updates.value,
        active: updates.active,
        lot_type: updates.lotType ?? null,
        discount_percent: updates.discountPercent ?? null,
        discount_amount: updates.discountAmount ?? null,
        min_order_amount: updates.minOrderAmount ?? null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', parsed.data.lotId);

    if (updateError) {
      return jsonResponse({ error: 'DATABASE_ERROR' }, 500, responseCorsHeaders);
    }

    return jsonResponse({ success: true }, 200, responseCorsHeaders);
  }

  if (parsed.data.action === 'delete') {
    const lotId = parsed.data.lotId;

    await serviceClient.from('lot_items').delete().eq('lot_id', lotId);
    const { error: deleteError } = await serviceClient.from('lots').delete().eq('id', lotId);

    if (deleteError) {
      return jsonResponse({ error: 'DATABASE_ERROR' }, 500, responseCorsHeaders);
    }

    return jsonResponse({ success: true }, 200, responseCorsHeaders);
  }

  if (parsed.data.action === 'addItem') {
    const { lotId, item } = parsed.data;

    const { error: insertError } = await serviceClient
      .from('lot_items')
      .insert({
        lot_id: lotId,
        product_id: item.productId,
        producer_id: item.producerId,
        product_name: item.productName,
        producer_name: item.producerName,
        quantity: item.quantity,
      });

    if (insertError) {
      return jsonResponse({ error: 'DATABASE_ERROR' }, 500, responseCorsHeaders);
    }

    return jsonResponse({ success: true }, 200, responseCorsHeaders);
  }

  if (parsed.data.action === 'replaceItems') {
    const { lotId, items } = parsed.data;

    await serviceClient.from('lot_items').delete().eq('lot_id', lotId);

    if (items.length > 0) {
      const insertItems = items.map((item) => ({
        lot_id: lotId,
        product_id: item.productId,
        producer_id: item.producerId,
        product_name: item.productName,
        producer_name: item.producerName,
        quantity: item.quantity,
      }));

      const { error: itemsError } = await serviceClient
        .from('lot_items')
        .insert(insertItems);

      if (itemsError) {
        return jsonResponse({ error: 'DATABASE_ERROR' }, 500, responseCorsHeaders);
      }
    }

    return jsonResponse({ success: true }, 200, responseCorsHeaders);
  }

  return jsonResponse({ error: 'INVALID_ACTION' }, 400, responseCorsHeaders);
});
