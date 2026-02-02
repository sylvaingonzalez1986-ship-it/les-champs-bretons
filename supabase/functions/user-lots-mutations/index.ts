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

const recordWonSchema = z.object({
  action: z.literal('recordWon'),
  userCode: z.string().min(1),
  giftCode: z.string().min(1),
  lot: z.object({
    lotId: z.string().min(1),
    lotName: z.string().min(1),
    lotDescription: z.string().optional().nullable(),
    lotRarity: z.string().optional().nullable(),
    lotImage: z.string().optional().nullable(),
    lotType: z.string().optional().nullable(),
    lotValue: z.number().optional().nullable(),
    discountPercent: z.number().optional().nullable(),
    discountAmount: z.number().optional().nullable(),
    minOrderAmount: z.number().optional().nullable(),
  }),
});

const markUsedSchema = z.object({
  action: z.literal('markUsed'),
  lotId: z.string().min(1),
});

const giftToSchema = z.object({
  action: z.literal('giftTo'),
  lotId: z.string().min(1),
  recipientCode: z.string().min(1),
});

const claimGiftSchema = z.object({
  action: z.literal('claimGift'),
  giftCode: z.string().min(1),
  recipientCode: z.string().min(1),
});

const addLotSchema = z.object({
  action: z.literal('addLot'),
  lot: z.object({
    lotId: z.string().min(1),
    lotName: z.string().min(1),
    lotDescription: z.string().optional().nullable(),
    lotRarity: z.string().optional().nullable(),
    lotImage: z.string().optional().nullable(),
    lotValue: z.number().optional().nullable(),
    lotType: z.string().optional().nullable(),
    discountPercent: z.number().optional().nullable(),
    discountAmount: z.number().optional().nullable(),
    minOrderAmount: z.number().optional().nullable(),
  }),
});

const migrateSchema = z.object({
  action: z.literal('migrate'),
  userCode: z.string().min(1),
});

const requestSchema = z.discriminatedUnion('action', [
  recordWonSchema,
  markUsedSchema,
  giftToSchema,
  claimGiftSchema,
  addLotSchema,
  migrateSchema,
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
      endpoint: 'user-lots-mutations',
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
    return { user: null };
  }

  const supabase = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) {
    return { user: null };
  }

  return { user: data.user };
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
  const { user } = await getUserFromRequest(req);
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0] || 'unknown';

  const rateLimitResponse = enforceRateLimit(req, user?.id ?? ip);
  if (rateLimitResponse) {
    return rateLimitResponse;
  }

  if (parsed.data.action === 'recordWon') {
    const { userCode, giftCode, lot } = parsed.data;
    const data = {
      id: crypto.randomUUID(),
      user_id: user?.id ?? null,
      user_code: userCode,
      lot_id: lot.lotId,
      lot_name: lot.lotName,
      lot_description: lot.lotDescription ?? null,
      lot_rarity: lot.lotRarity ?? null,
      lot_image: lot.lotImage ?? null,
      lot_type: lot.lotType ?? 'product',
      lot_value: lot.lotValue ?? 0,
      discount_percent: lot.discountPercent ?? null,
      discount_amount: lot.discountAmount ?? null,
      min_order_amount: lot.minOrderAmount ?? null,
      won_at: new Date().toISOString(),
      used: false,
      used_at: null,
      gifted_to: null,
      gifted_at: null,
      gift_code: giftCode,
    };

    const { data: inserted, error } = await serviceClient
      .from('user_lots')
      .insert(data)
      .select('*')
      .single();

    if (error) {
      return jsonResponse({ error: 'DATABASE_ERROR' }, 500);
    }

    return jsonResponse(inserted);
  }

  if (parsed.data.action === 'markUsed') {
    if (!user?.id) {
      return jsonResponse({ error: 'UNAUTHORIZED' }, 401);
    }

    const { data: lot, error: lotError } = await serviceClient
      .from('user_lots')
      .select('id,user_id')
      .eq('id', parsed.data.lotId)
      .single();

    if (lotError || !lot) {
      return jsonResponse({ error: 'LOT_NOT_FOUND' }, 404);
    }

    if (lot.user_id !== user.id) {
      return jsonResponse({ error: 'FORBIDDEN' }, 403);
    }

    const { error } = await serviceClient
      .from('user_lots')
      .update({ used: true, used_at: new Date().toISOString() })
      .eq('id', parsed.data.lotId);

    if (error) {
      return jsonResponse({ error: 'DATABASE_ERROR' }, 500);
    }

    return jsonResponse({ success: true });
  }

  if (parsed.data.action === 'giftTo') {
    if (!user?.id) {
      return jsonResponse({ error: 'UNAUTHORIZED' }, 401);
    }

    const { data: lot, error: lotError } = await serviceClient
      .from('user_lots')
      .select('id,user_id')
      .eq('id', parsed.data.lotId)
      .single();

    if (lotError || !lot) {
      return jsonResponse({ error: 'LOT_NOT_FOUND' }, 404);
    }

    if (lot.user_id !== user.id) {
      return jsonResponse({ error: 'FORBIDDEN' }, 403);
    }

    const { error } = await serviceClient
      .from('user_lots')
      .update({
        gifted_to: parsed.data.recipientCode,
        gifted_at: new Date().toISOString(),
      })
      .eq('id', parsed.data.lotId);

    if (error) {
      return jsonResponse({ error: 'DATABASE_ERROR' }, 500);
    }

    return jsonResponse({ success: true });
  }

  if (parsed.data.action === 'claimGift') {
    const { giftCode, recipientCode } = parsed.data;
    const normalizedCode = giftCode.trim().toUpperCase();

    const { data: lots, error: findError } = await serviceClient
      .from('user_lots')
      .select('*')
      .eq('gift_code', normalizedCode)
      .limit(1);

    if (findError) {
      return jsonResponse({ error: 'DATABASE_ERROR' }, 500);
    }

    if (!lots || lots.length === 0) {
      return jsonResponse({ error: 'NOT_FOUND' }, 404);
    }

    const lot = lots[0];

    if (lot.user_code === recipientCode) {
      return jsonResponse({ error: 'OWN_CODE' }, 400);
    }

    if (lot.used) {
      return jsonResponse({ error: 'ALREADY_USED' }, 409);
    }

    if (lot.gifted_to && lot.gifted_to !== recipientCode && lot.gifted_to !== lot.user_code) {
      return jsonResponse({ error: 'ALREADY_CLAIMED' }, 409);
    }

    const updateData: Record<string, unknown> = {
      user_code: recipientCode,
      gifted_to: recipientCode,
      gifted_at: new Date().toISOString(),
    };

    if (user?.id) {
      updateData.user_id = user.id;
    }

    const { data: updated, error: updateError } = await serviceClient
      .from('user_lots')
      .update(updateData)
      .eq('id', lot.id)
      .select('*')
      .single();

    if (updateError) {
      return jsonResponse({ error: 'DATABASE_ERROR' }, 500);
    }

    return jsonResponse({ success: true, lot: updated });
  }

  if (parsed.data.action === 'addLot') {
    if (!user?.id) {
      return jsonResponse({ error: 'UNAUTHORIZED' }, 401);
    }

    const lot = parsed.data.lot;
    const data = {
      id: crypto.randomUUID(),
      user_id: user.id,
      lot_id: lot.lotId,
      lot_name: lot.lotName,
      lot_description: lot.lotDescription ?? null,
      lot_rarity: lot.lotRarity ?? null,
      lot_image: lot.lotImage ?? null,
      lot_value: lot.lotValue ?? 0,
      lot_type: lot.lotType ?? 'product',
      discount_percent: lot.discountPercent ?? null,
      discount_amount: lot.discountAmount ?? null,
      min_order_amount: lot.minOrderAmount ?? null,
      won_at: new Date().toISOString(),
    };

    const { data: inserted, error } = await serviceClient
      .from('user_lots')
      .insert(data)
      .select('*')
      .single();

    if (error) {
      return jsonResponse({ error: 'DATABASE_ERROR' }, 500);
    }

    return jsonResponse({ id: inserted.id });
  }

  if (parsed.data.action === 'migrate') {
    if (!user?.id) {
      return jsonResponse({ error: 'UNAUTHORIZED' }, 401);
    }

    const { data, error } = await serviceClient
      .from('user_lots')
      .update({ user_id: user.id })
      .eq('user_code', parsed.data.userCode)
      .select('id');

    if (error) {
      return jsonResponse({ error: 'DATABASE_ERROR' }, 500);
    }

    return jsonResponse({ migrated: data?.length ?? 0 });
  }

  return jsonResponse({ error: 'INVALID_ACTION' }, 400);
});
