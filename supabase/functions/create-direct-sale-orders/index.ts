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

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Max-Age': '86400',
};

const itemSchema = z.object({
  producerId: z.string().min(1),
  productId: z.string().min(1),
  quantity: z.number().int().positive().max(10000),
});

const directSaleOrderSchema = z.object({
  items: z.array(itemSchema).min(1),
});

type DirectSaleOrderInput = z.infer<typeof directSaleOrderSchema>;

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

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';

const serviceClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);


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

  let body: unknown = {};
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: 'INVALID_JSON' }, 400);
  }

  const parsed = directSaleOrderSchema.safeParse(body);
  if (!parsed.success) {
    return jsonResponse({ error: 'VALIDATION_ERROR' }, 400);
  }

  const rateLimitResult = checkRateLimit(user.id, RATE_LIMIT_PRESETS.ORDERS);
  if (!rateLimitResult.allowed) {
    return createRateLimitResponse(rateLimitResult, RATE_LIMIT_PRESETS.ORDERS, corsHeaders);
  }

  const { items } = parsed.data;

    // Group items by producer
    const itemsByProducer = new Map<string, DirectSaleOrderInput['items']>();
    for (const item of items) {
      const list = itemsByProducer.get(item.producerId) ?? [];
      list.push(item);
      itemsByProducer.set(item.producerId, list);
    }

    const orderIds: string[] = [];
    const errors: Array<{ producerId: string; reason: string }> = [];

    const authHeader = req.headers.get('Authorization') || '';

    for (const [producerId, producerItems] of itemsByProducer.entries()) {
      const payloadItems = producerItems.map((item) => ({
        productId: item.productId,
        quantity: item.quantity,
      }));

      const { data: orderId, error: orderError } = await serviceClient.rpc(
        'create_direct_sale_order',
        {
          p_user_id: user.id,
          p_producer_id: producerId,
          p_items: payloadItems,
        }
      );

      if (orderError || !orderId) {
        const message = orderError?.message ?? '';
        let reason = 'Failed to create order';
        if (message.includes('PRODUCER_NOT_FOUND')) reason = 'Producer not found';
        if (message.includes('INVALID_PRODUCT')) reason = 'Invalid product for producer';
        if (message.includes('INVALID_QUANTITY')) reason = 'Invalid quantity';
        if (message.includes('MINIMUM_AMOUNT_NOT_MET')) reason = 'Minimum amount not met';
        errors.push({ producerId, reason });
        continue;
      }

      orderIds.push(orderId as string);

      // Trigger email (best-effort)
      if (authHeader) {
        try {
          await fetch(`${SUPABASE_URL}/functions/v1/send-order-email`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: authHeader,
            },
            body: JSON.stringify({
              commandeId: orderId,
              producerId,
              userId: user.id,
            }),
          });
        } catch {
          // ignore email errors
        }
      }
    }

    return new Response(
      JSON.stringify({
        success: orderIds.length > 0,
        orderIds,
        errors,
      }),
      {
        status: orderIds.length > 0 ? 200 : 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
});
