import { serve } from 'https://deno.land/std@0.208.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';
import { z } from 'https://deno.land/x/zod@v3.22.4/mod.ts';
import { getCorsHeaders, isOriginAllowed } from '../_shared/cors.ts';
import { checkRateLimit, createRateLimitResponse, RATE_LIMIT_PRESETS } from '../_shared/rate-limit.ts';

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

function jsonResponse(payload: unknown, status = 200, corsHeaders: Record<string, string>): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

async function enforceRateLimit(req: Request, userId: string): Promise<Response | null> {
  const rateLimitResult = await checkRateLimit(userId, RATE_LIMIT_PRESETS.GENERAL);
  if (!rateLimitResult.allowed) {
    return createRateLimitResponse(rateLimitResult, RATE_LIMIT_PRESETS.GENERAL, getCorsHeaders(req));
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

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

  if (!serviceKey) {
    return jsonResponse({ error: 'CONFIG_ERROR' }, 500, responseCorsHeaders);
  }

  const serviceClient = createClient(supabaseUrl, serviceKey);
  const { user } = await getUserFromRequest(req);
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0] || 'unknown';

  const rateLimitResponse = await enforceRateLimit(req, user?.id ?? ip);
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
      return jsonResponse({ error: 'DATABASE_ERROR' }, 500, responseCorsHeaders);
    }

    return jsonResponse(inserted, 200, responseCorsHeaders);
  }

  if (parsed.data.action === 'markUsed') {
    if (!user?.id) {
      return jsonResponse({ error: 'UNAUTHORIZED' }, 401, responseCorsHeaders);
    }

    const { data: lot, error: lotError } = await serviceClient
      .from('user_lots')
      .select('id,user_id')
      .eq('id', parsed.data.lotId)
      .single();

    if (lotError || !lot) {
      return jsonResponse({ error: 'LOT_NOT_FOUND' }, 404, responseCorsHeaders);
    }

    if (lot.user_id !== user.id) {
      return jsonResponse({ error: 'FORBIDDEN' }, 403, responseCorsHeaders);
    }

    const { error } = await serviceClient
      .from('user_lots')
      .update({ used: true, used_at: new Date().toISOString() })
      .eq('id', parsed.data.lotId);

    if (error) {
      return jsonResponse({ error: 'DATABASE_ERROR' }, 500, responseCorsHeaders);
    }

    return jsonResponse({ success: true }, 200, responseCorsHeaders);
  }

  if (parsed.data.action === 'giftTo') {
    if (!user?.id) {
      return jsonResponse({ error: 'UNAUTHORIZED' }, 401, responseCorsHeaders);
    }

    const { data: lot, error: lotError } = await serviceClient
      .from('user_lots')
      .select('id,user_id')
      .eq('id', parsed.data.lotId)
      .single();

    if (lotError || !lot) {
      return jsonResponse({ error: 'LOT_NOT_FOUND' }, 404, responseCorsHeaders);
    }

    if (lot.user_id !== user.id) {
      return jsonResponse({ error: 'FORBIDDEN' }, 403, responseCorsHeaders);
    }

    const { error } = await serviceClient
      .from('user_lots')
      .update({
        gifted_to: parsed.data.recipientCode,
        gifted_at: new Date().toISOString(),
      })
      .eq('id', parsed.data.lotId);

    if (error) {
      return jsonResponse({ error: 'DATABASE_ERROR' }, 500, responseCorsHeaders);
    }

    return jsonResponse({ success: true }, 200, responseCorsHeaders);
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
      return jsonResponse({ error: 'DATABASE_ERROR' }, 500, responseCorsHeaders);
    }

    if (!lots || lots.length === 0) {
      return jsonResponse({ error: 'NOT_FOUND' }, 404, responseCorsHeaders);
    }

    const lot = lots[0];

    if (lot.user_code === recipientCode) {
      return jsonResponse({ error: 'OWN_CODE' }, 400, responseCorsHeaders);
    }

    if (lot.used) {
      return jsonResponse({ error: 'ALREADY_USED' }, 409, responseCorsHeaders);
    }

    if (lot.gifted_to && lot.gifted_to !== recipientCode && lot.gifted_to !== lot.user_code) {
      return jsonResponse({ error: 'ALREADY_CLAIMED' }, 409, responseCorsHeaders);
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
      return jsonResponse({ error: 'DATABASE_ERROR' }, 500, responseCorsHeaders);
    }

    return jsonResponse({ success: true, lot: updated }, 200, responseCorsHeaders);
  }

  if (parsed.data.action === 'addLot') {
    if (!user?.id) {
      return jsonResponse({ error: 'UNAUTHORIZED' }, 401, responseCorsHeaders);
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
      return jsonResponse({ error: 'DATABASE_ERROR' }, 500, responseCorsHeaders);
    }

    return jsonResponse({ id: inserted.id }, 200, responseCorsHeaders);
  }

  if (parsed.data.action === 'migrate') {
    if (!user?.id) {
      return jsonResponse({ error: 'UNAUTHORIZED' }, 401, responseCorsHeaders);
    }

    const { data, error } = await serviceClient
      .from('user_lots')
      .update({ user_id: user.id })
      .eq('user_code', parsed.data.userCode)
      .select('id');

    if (error) {
      return jsonResponse({ error: 'DATABASE_ERROR' }, 500, responseCorsHeaders);
    }

    return jsonResponse({ migrated: data?.length ?? 0 }, 200, responseCorsHeaders);
  }

  return jsonResponse({ error: 'INVALID_ACTION' }, 400, responseCorsHeaders);
});
