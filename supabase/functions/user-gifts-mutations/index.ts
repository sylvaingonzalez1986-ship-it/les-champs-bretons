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

const createSchema = z.object({
  action: z.literal('create'),
  gift: z.object({
    giftCode: z.string().min(1),
    collectionItemId: z.string().optional().nullable(),
    productId: z.string().min(1),
    productName: z.string().min(1),
    productRarity: z.string().optional().nullable(),
  }),
});

const claimSchema = z.object({
  action: z.literal('claim'),
  giftCode: z.string().min(1),
});

const requestSchema = z.discriminatedUnion('action', [createSchema, claimSchema]);

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
      endpoint: 'user-gifts-mutations',
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

  if (parsed.data.action === 'create') {
    const gift = parsed.data.gift;
    const { data, error: insertError } = await serviceClient
      .from('user_gifts')
      .insert({
        sender_id: user.id,
        gift_code: gift.giftCode,
        collection_item_id: gift.collectionItemId ?? null,
        product_id: gift.productId,
        product_name: gift.productName,
        product_rarity: gift.productRarity ?? null,
        used: false,
      })
      .select('*')
      .single();

    if (insertError) {
      return jsonResponse({ error: 'DATABASE_ERROR' }, 500);
    }

    return jsonResponse({ id: data?.id ?? null });
  }

  if (parsed.data.action === 'claim') {
    const { data: gifts, error: findError } = await serviceClient
      .from('user_gifts')
      .select('*')
      .eq('gift_code', parsed.data.giftCode)
      .is('recipient_id', null)
      .limit(1);

    if (findError) {
      return jsonResponse({ error: 'DATABASE_ERROR' }, 500);
    }

    if (!gifts || gifts.length === 0) {
      return jsonResponse({ error: 'NOT_FOUND' }, 404);
    }

    const gift = gifts[0];

    const { error: updateError } = await serviceClient
      .from('user_gifts')
      .update({
        recipient_id: user.id,
        claimed_at: new Date().toISOString(),
      })
      .eq('id', gift.id);

    if (updateError) {
      return jsonResponse({ error: 'DATABASE_ERROR' }, 500);
    }

    return jsonResponse({
      ...gift,
      recipient_id: user.id,
      claimed_at: new Date().toISOString(),
    });
  }

  return jsonResponse({ error: 'INVALID_ACTION' }, 400);
});
