import { serve } from 'https://deno.land/std@0.208.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';
import { z } from 'https://deno.land/x/zod@v3.22.4/mod.ts';
import { getCorsHeaders, isOriginAllowed } from '../_shared/cors.ts';
import { checkRateLimit, createRateLimitResponse, RATE_LIMIT_PRESETS } from '../_shared/rate-limit.ts';

const itemSchema = z.object({
  producerId: z.string().min(1),
  productId: z.string().min(1),
  quantity: z.number().int().positive().max(10000),
});

const producerOptionSchema = z.object({
  producerId: z.string().min(1),
  deliveryMethod: z.enum(['pickup', 'shipping']).default('pickup'),
  deliveryAddress: z.string().max(500).optional(),
  deliveryInstructions: z.string().max(1000).optional(),
  paymentMethod: z.enum(['payment_link', 'on_site']).optional(),
});

const directSaleOrderSchema = z.object({
  items: z.array(itemSchema).min(1),
  producerOptions: z.array(producerOptionSchema).optional(),
});

type DirectSaleOrderInput = z.infer<typeof directSaleOrderSchema>;

function jsonResponse(payload: unknown, status = 200, corsHeaders: Record<string, string>): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function logOrderError(stage: string, producerId: string, error: unknown) {
  console.error(`[create-direct-sale-orders] ${stage}`, {
    producerId,
    error,
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

function isSafeIdentifier(id: string): boolean {
  const trimmed = id.trim();
  if (!trimmed) return false;
  if (trimmed.length > 128) return false;
  // Disallow whitespace/control chars to keep identifiers predictable.
  return !/[\s\x00-\x1F\x7F]/.test(trimmed);
}

// Create service client per-request to avoid race conditions
function createServiceClient() {
  const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
  return createClient(supabaseUrl, serviceKey);
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

  const { items, producerOptions } = parsed.data;

  // Validate producer/product identifiers (text ids in this schema).
  for (const item of items) {
    if (!isSafeIdentifier(item.producerId)) {
      return jsonResponse({ error: 'INVALID_PRODUCER_ID' }, 400, responseCorsHeaders);
    }
    if (!isSafeIdentifier(item.productId)) {
      return jsonResponse({ error: 'INVALID_PRODUCT_ID' }, 400, responseCorsHeaders);
    }
  }

  if (producerOptions) {
    for (const option of producerOptions) {
      if (!isSafeIdentifier(option.producerId)) {
        return jsonResponse({ error: 'INVALID_PRODUCER_ID' }, 400, responseCorsHeaders);
      }
    }
  }

  // Create service client per-request to avoid race conditions
  const serviceClient = createServiceClient();
  const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';

  // Group items by producer
  const itemsByProducer = new Map<string, DirectSaleOrderInput['items']>();
  for (const item of items) {
    const list = itemsByProducer.get(item.producerId) ?? [];
    list.push(item);
    itemsByProducer.set(item.producerId, list);
  }

  const orderIds: string[] = [];
  const errors: Array<{ producerId: string; reason: string }> = [];
  const optionsByProducer = new Map(
    (producerOptions ?? []).map((option) => [option.producerId, option])
  );

  const authHeader = req.headers.get('Authorization') || '';

  for (const [producerId, producerItems] of itemsByProducer.entries()) {
    const producerOption = optionsByProducer.get(producerId);
    const deliveryMethod = producerOption?.deliveryMethod ?? 'pickup';
    const deliveryAddress = producerOption?.deliveryAddress?.trim() || null;
    const deliveryInstructions = producerOption?.deliveryInstructions?.trim() || null;
    const paymentMethod = deliveryMethod === 'shipping'
      ? 'payment_link'
      : (producerOption?.paymentMethod ?? 'on_site');

    const { data: producer, error: producerError } = await serviceClient
      .from('producers')
      .select('id, shipping_enabled, shipping_fee')
      .eq('id', producerId)
      .single();

    if (producerError || !producer) {
      logOrderError('producer_lookup_failed', producerId, producerError);
      errors.push({ producerId, reason: 'Producer not found' });
      continue;
    }

    if (deliveryMethod === 'shipping' && !producer.shipping_enabled) {
      errors.push({ producerId, reason: 'Shipping not available for this producer' });
      continue;
    }

    if (deliveryMethod === 'shipping' && !deliveryAddress) {
      errors.push({ producerId, reason: 'Delivery address required for shipping' });
      continue;
    }

    const payloadItems = producerItems.map((item: { productId: string; producerId: string; quantity: number }) => ({
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
        logOrderError('rpc_create_direct_sale_order_failed', producerId, orderError);
        const message = orderError?.message ?? '';
        let reason = 'Failed to create order';
        if (message.includes('PRODUCER_NOT_FOUND')) reason = 'Producer not found';
        if (message.includes('INVALID_PRODUCT')) reason = 'Invalid product for producer';
        if (message.includes('INVALID_QUANTITY')) reason = 'Invalid quantity';
        if (message.includes('MINIMUM_AMOUNT_NOT_MET')) reason = 'Minimum amount not met';
        if (message.toLowerCase().includes('row-level security')) reason = 'RLS policy blocked order creation';
        if (message.toLowerCase().includes('permission denied')) reason = 'Permission denied while creating order';
        if (message.toLowerCase().includes('does not exist')) reason = 'Database function or table missing';
        if (message.toLowerCase().includes('check constraint')) reason = 'Order failed database validation';
        if (reason === 'Failed to create order' && message.trim().length > 0) {
          reason = `Failed to create order: ${message.trim()}`;
        }
        errors.push({ producerId, reason });
        continue;
      }

      const resolvedDeliveryFee = deliveryMethod === 'shipping'
        ? Number(producer.shipping_fee ?? 0)
        : 0;

      const { error: orderUpdateError } = await serviceClient
        .from('commandes_vente_directe')
        .update({
          delivery_method: deliveryMethod,
          delivery_fee: resolvedDeliveryFee,
          delivery_address: deliveryMethod === 'shipping' ? deliveryAddress : null,
          delivery_instructions: deliveryMethod === 'shipping' ? deliveryInstructions : null,
          payment_method: paymentMethod,
        })
        .eq('id', orderId as string);

      if (orderUpdateError) {
        logOrderError('order_delivery_update_failed', producerId, orderUpdateError);
        await serviceClient
          .from('commandes_vente_directe')
          .delete()
          .eq('id', orderId as string);
        errors.push({ producerId, reason: 'Failed to save delivery options' });
        continue;
      }

      orderIds.push(orderId as string);

      // Trigger email (best-effort)
      if (authHeader) {
        try {
          await fetch(`${supabaseUrl}/functions/v1/send-order-email`, {
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
