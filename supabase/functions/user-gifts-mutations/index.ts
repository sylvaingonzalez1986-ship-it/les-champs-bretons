import { serve } from 'https://deno.land/std@0.208.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.38.0';
import { z } from 'https://deno.land/x/zod@v3.22.4/mod.ts';
import { getCorsHeaders, isOriginAllowed } from '../_shared/cors.ts';
import { checkRateLimit, createRateLimitResponse, RATE_LIMIT_PRESETS } from '../_shared/rate-limit.ts';

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
  const { user, error } = await getUserFromRequest(req);
  if (error) {
    return error;
  }

  const rateLimitResponse = await enforceRateLimit(req, user.id);
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
      return jsonResponse({ error: 'DATABASE_ERROR' }, 500, responseCorsHeaders);
    }

    return jsonResponse({ id: data?.id ?? null }, 200, responseCorsHeaders);
  }

  if (parsed.data.action === 'claim') {
    const { data: gifts, error: findError } = await serviceClient
      .from('user_gifts')
      .select('*')
      .eq('gift_code', parsed.data.giftCode)
      .is('recipient_id', null)
      .limit(1);

    if (findError) {
      return jsonResponse({ error: 'DATABASE_ERROR' }, 500, responseCorsHeaders);
    }

    if (!gifts || gifts.length === 0) {
      return jsonResponse({ error: 'NOT_FOUND' }, 404, responseCorsHeaders);
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
      return jsonResponse({ error: 'DATABASE_ERROR' }, 500, responseCorsHeaders);
    }

    return jsonResponse({
      ...gift,
      recipient_id: user.id,
      claimed_at: new Date().toISOString(),
    }, 200, responseCorsHeaders);
  }

  return jsonResponse({ error: 'INVALID_ACTION' }, 400, responseCorsHeaders);
});
