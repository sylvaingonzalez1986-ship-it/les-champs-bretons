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
  GENERAL: { windowMs: 60_000, limit: 30 },
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

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Max-Age': '86400',
};

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
    action: z.literal('delete'),
    lotId: z.string().min(1),
  }),
  z.object({
    action: z.literal('addItem'),
    lotId: z.string().min(1),
    item: lotItemSchema,
  }),
]);

function jsonResponse(payload: unknown, status = 200): Response {
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

function enforceRateLimit(req: Request, userId: string): Response | null {
  const rateLimitResult = checkRateLimit(userId, RATE_LIMIT_PRESETS.GENERAL);
  if (!rateLimitResult.allowed) {
    return createRateLimitResponse(rateLimitResult, RATE_LIMIT_PRESETS.GENERAL, corsHeaders);
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

  const { user, error } = await getUserFromRequest(req);
  if (error) {
    return error;
  }

  const rateLimitResponse = enforceRateLimit(req, user.id);
  if (rateLimitResponse) {
    return rateLimitResponse;
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (!serviceKey) {
    return jsonResponse({ error: 'CONFIG_ERROR' }, 500);
  }

  const serviceClient = createClient(supabaseUrl, serviceKey);
  const isAdmin = await ensureAdminRole(serviceClient, user.id);
  if (!isAdmin) {
    return jsonResponse({ error: 'FORBIDDEN' }, 403);
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
      return jsonResponse({ error: 'DATABASE_ERROR' }, 500);
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
        return jsonResponse({ error: 'DATABASE_ERROR' }, 500);
      }
    }

    return jsonResponse({ success: true, lot: lotData });
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
      return jsonResponse({ error: 'DATABASE_ERROR' }, 500);
    }

    return jsonResponse({ success: true });
  }

  if (parsed.data.action === 'delete') {
    const lotId = parsed.data.lotId;

    await serviceClient.from('lot_items').delete().eq('lot_id', lotId);
    const { error: deleteError } = await serviceClient.from('lots').delete().eq('id', lotId);

    if (deleteError) {
      return jsonResponse({ error: 'DATABASE_ERROR' }, 500);
    }

    return jsonResponse({ success: true });
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
      return jsonResponse({ error: 'DATABASE_ERROR' }, 500);
    }

    return jsonResponse({ success: true });
  }

  return jsonResponse({ error: 'INVALID_ACTION' }, 400);
});
