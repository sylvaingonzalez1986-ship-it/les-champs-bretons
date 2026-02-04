import { serve } from 'https://deno.land/std@0.208.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.38.0';
import { z } from 'https://deno.land/x/zod@v3.22.4/mod.ts';
import { getCorsHeaders, isOriginAllowed } from '../_shared/cors.ts';
import { checkRateLimit, createRateLimitResponse, RATE_LIMIT_PRESETS } from '../_shared/rate-limit.ts';

const itemSchema = z.object({
  producerId: z.string().min(1),
  productId: z.string().min(1),
  quantity: z.number().int().positive().max(10000),
});

const directSaleOrderSchema = z.object({
  items: z.array(itemSchema).min(1),
});

type DirectSaleOrderInput = z.infer<typeof directSaleOrderSchema>;

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

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';

const serviceClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);


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

  const isWarmup = req.headers.get('x-warmup') === '1';
  if (isWarmup) {
    return jsonResponse({ ok: true, warmed: true }, 200, responseCorsHeaders);
  }

  let body: unknown = {};
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: 'INVALID_JSON' }, 400, responseCorsHeaders);
  }

  const parsed = directSaleOrderSchema.safeParse(body);
  if (!parsed.success) {
    return jsonResponse({ error: 'VALIDATION_ERROR' }, 400, responseCorsHeaders);
  }

  const rateLimitResult = await checkRateLimit(user.id, RATE_LIMIT_PRESETS.ORDERS);
  if (!rateLimitResult.allowed) {
    return createRateLimitResponse(rateLimitResult, RATE_LIMIT_PRESETS.ORDERS, responseCorsHeaders);
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
        headers: { ...responseCorsHeaders, 'Content-Type': 'application/json' },
      }
    );
});
