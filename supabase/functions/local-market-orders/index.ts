import { serve } from 'https://deno.land/std@0.208.0/http/server.ts';
import { createClient, SupabaseClient, User } from 'https://esm.sh/@supabase/supabase-js@2.49.1';
import { z } from 'https://deno.land/x/zod@v3.22.4/mod.ts';
import { getCorsHeaders, isOriginAllowed } from '../_shared/cors.ts';
import {
  checkRateLimit,
  createRateLimitResponse,
  logSecurityEvent,
  RATE_LIMIT_PRESETS,
} from '../_shared/rate-limit.ts';


const uuidSchema = z.string().uuid('Invalid UUID format');
const idOrPickupSchema = z.string().min(1, 'Invalid order identifier');
const emailSchema = z.string().email('Invalid email format').max(255);
const quantitySchema = z.number().int().positive().max(10000);
const deliveryMethodSchema = z.enum(['pickup', 'shipping']);

const localMarketOrderStatusSchema = z.enum([
  'pending',
  'confirmed',
  'ready',
  'completed',
  'cancelled',
]);

const localMarketOrderActionSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('create'),
    producerId: z.string().min(1),
    productId: z.string().min(1),
    quantity: quantitySchema,
    pickupLocation: z.string().max(200).optional(),
    pickupInstructions: z.string().max(500).optional(),
    deliveryMethod: deliveryMethodSchema.optional(),
    deliveryFee: z.number().min(0).max(999999.99).optional(),
    deliveryAddress: z.string().max(500).optional(),
    deliveryInstructions: z.string().max(1000).optional(),
    customerNotes: z.string().max(1000).optional(),
    customerName: z.string().max(200).optional(),
    customerEmail: emailSchema.optional(),
    customerPhone: z.string().max(30).optional(),
  }),
  z.object({
    action: z.literal('cancel'),
    orderId: idOrPickupSchema,
  }),
  z.object({
    action: z.literal('updateStatus'),
    orderId: idOrPickupSchema,
    status: localMarketOrderStatusSchema,
    producerNotes: z.string().max(1000).optional(),
  }),
  z.object({
    action: z.literal('getByPickupCode'),
    pickupCode: z.string().min(4).max(32),
  }),
]);

type LocalMarketOrderActionInput = z.infer<typeof localMarketOrderActionSchema>;

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function resolveOrderLookup(orderId: string): { field: 'id' | 'pickup_code'; value: string } {
  if (UUID_REGEX.test(orderId)) {
    return { field: 'id', value: orderId };
  }
  return { field: 'pickup_code', value: orderId };
}

interface ValidatedRequest<T> {
  user: User;
  data: T;
  supabase: SupabaseClient;
  responseCorsHeaders: Record<string, string>;
}

function createValidatedHandler<T>(
  config: { schema: z.ZodSchema<T>; rateLimit: { limit: number; windowMs: number; identifier: string }; functionName: string },
  handler: (validated: ValidatedRequest<T>) => Promise<Response>
): (req: Request) => Promise<Response> {
  const { schema, rateLimit, functionName } = config;

  return async (req: Request): Promise<Response> => {
    const responseCorsHeaders = getCorsHeaders(req);
    const origin = req.headers.get('Origin');

    if (!isOriginAllowed(origin)) {
      logSecurityEvent({
        userId: 'anonymous',
        action: 'invalid_origin',
        endpoint: functionName,
        ip: req.headers.get('x-forwarded-for')?.split(',')[0] || 'unknown',
        userAgent: req.headers.get('User-Agent') || 'unknown',
        success: false,
        reason: `Origin not allowed: ${origin ?? 'unknown'}`,
      });
      return new Response(JSON.stringify({ error: 'FORBIDDEN', message: 'Invalid origin' }), {
        status: 403,
        headers: { ...responseCorsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (req.method === 'OPTIONS') {
      return new Response('ok', { headers: responseCorsHeaders });
    }

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'UNAUTHORIZED' }), {
        status: 401,
        headers: { ...responseCorsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData.user) {
      return new Response(JSON.stringify({ error: 'UNAUTHORIZED' }), {
        status: 401,
        headers: { ...responseCorsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const userId = userData.user.id;
    const rateLimitResult = await checkRateLimit(userId, rateLimit);
    if (!rateLimitResult.allowed) {
      logSecurityEvent({
        userId,
        action: 'rate_limit_exceeded',
        endpoint: functionName,
        ip: req.headers.get('x-forwarded-for')?.split(',')[0] || 'unknown',
        userAgent: req.headers.get('User-Agent') || 'unknown',
        success: false,
        reason: `Exceeded ${rateLimit.limit} requests per window`,
      });
      return createRateLimitResponse(rateLimitResult, rateLimit, responseCorsHeaders);
    }

    let body: unknown = {};
    try {
      body = await req.json();
    } catch {
      return new Response(JSON.stringify({ error: 'PARSE_ERROR' }), {
        status: 400,
        headers: { ...responseCorsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const validation = schema.safeParse(body);
    if (!validation.success) {
      return new Response(JSON.stringify({
        error: 'VALIDATION_ERROR',
        message: 'Request validation failed',
        details: validation.error.errors.map(err => ({
          path: err.path.join('.'),
          message: err.message,
        })),
      }), {
        status: 400,
        headers: { ...responseCorsHeaders, 'Content-Type': 'application/json' },
      });
    }

    try {
      return await handler({
        user: userData.user,
        data: validation.data,
        supabase,
        responseCorsHeaders,
      });
    } catch (error) {
      console.error(`[${functionName}] Handler error:`, error);
      return new Response(JSON.stringify({ error: 'INTERNAL_ERROR' }), {
        status: 500,
        headers: { ...responseCorsHeaders, 'Content-Type': 'application/json' },
      });
    }
  };
}

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';

const serviceClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

function generatePickupCode(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

async function getUserProfile(userId: string, supabase: ReturnType<typeof createClient>) {
  const { data } = await supabase
    .from('profiles')
    .select('id, role, first_name, last_name, full_name, email, phone')
    .eq('id', userId)
    .single();
  return data;
}

async function getProducerByProfileId(profileId: string) {
  const { data } = await serviceClient
    .from('producers')
    .select('id, name, email, phone, city, region')
    .eq('profile_id', profileId)
    .single();
  return data;
}

async function resolveProducerForProfile(profile: Awaited<ReturnType<typeof getUserProfile>>) {
  if (!profile?.id) {
    return null;
  }

  const byProfileId = await getProducerByProfileId(profile.id);
  if (byProfileId) {
    return byProfileId;
  }

  if (!profile.email) {
    return null;
  }

  const { data } = await serviceClient
    .from('producers')
    .select('id, name, email, phone, city, region')
    .eq('email', profile.email)
    .single();
  return data;
}

const handler = createValidatedHandler<LocalMarketOrderActionInput>(
  {
    schema: localMarketOrderActionSchema,
    rateLimit: RATE_LIMIT_PRESETS.ORDERS,
    functionName: 'local-market-orders',
  },
  async ({ user, data, supabase, responseCorsHeaders }) => {
    const corsHeaders = responseCorsHeaders;
    const profile = await getUserProfile(user.id, supabase);
    const role = profile?.role ?? 'user';
    const isProducerRole = role === 'producer' || role === 'pro';

    if (data.action === 'create') {
      const {
        producerId,
        productId,
        quantity,
        pickupLocation,
        pickupInstructions,
        deliveryMethod,
        deliveryAddress,
        deliveryInstructions,
        customerNotes,
        customerName,
        customerEmail,
        customerPhone,
      } = data;

      // Fetch producer
      const { data: producer, error: producerError } = await serviceClient
        .from('producers')
        .select('id, name, email, city, region, shipping_enabled, shipping_fee')
        .eq('id', producerId)
        .single();

      if (producerError || !producer) {
        console.error('[local-market-orders] Producer lookup failed:', producerId, producerError?.message, producerError?.code);
        return new Response(JSON.stringify({ error: 'Producer not found', producerId, details: producerError?.message }), {
          status: 404,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // Fetch product
      const { data: product, error: productError } = await serviceClient
        .from('products')
        .select('id, producer_id, name, description, price_public')
        .eq('id', productId)
        .single();

      if (productError || !product) {
        return new Response(JSON.stringify({ error: 'Product not found' }), {
          status: 404,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      if (product.producer_id !== producerId) {
        return new Response(JSON.stringify({ error: 'Product/producer mismatch' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const resolvedDeliveryMethod = deliveryMethod ?? 'pickup';

      if (resolvedDeliveryMethod === 'shipping' && !producer.shipping_enabled) {
        return new Response(JSON.stringify({
          error: 'DELIVERY_NOT_AVAILABLE',
          message: 'La livraison n\'est pas disponible pour ce producteur.',
        }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      if (resolvedDeliveryMethod === 'shipping' && !deliveryAddress?.trim()) {
        return new Response(JSON.stringify({
          error: 'DELIVERY_ADDRESS_REQUIRED',
          message: 'Adresse de livraison requise.',
        }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const resolvedDeliveryFee = resolvedDeliveryMethod === 'shipping'
        ? Number(producer.shipping_fee ?? 0)
        : 0;

      const unitPrice = Number(product.price_public ?? 0);
      const totalAmount = unitPrice * quantity + resolvedDeliveryFee;
      const pickupCode = generatePickupCode();

      const resolvedCustomerName =
        profile?.full_name ||
        `${profile?.first_name ?? ''} ${profile?.last_name ?? ''}`.trim() ||
        customerName ||
        'Client';

      const resolvedCustomerEmail = profile?.email || user.email || customerEmail || '';
      const resolvedCustomerPhone = profile?.phone || customerPhone || null;

      const orderPayload = {
        customer_id: user.id,
        customer_name: resolvedCustomerName,
        customer_email: resolvedCustomerEmail,
        customer_phone: resolvedCustomerPhone,
        producer_id: producerId,
        producer_name: producer.name,
        producer_email: producer.email,
        producer_phone: null,
        producer_location: producer.city || producer.region || null,
        product_id: productId,
        product_name: product.name,
        product_description: product.description || null,
        quantity,
        unit_price: unitPrice,
        total_amount: totalAmount,
        status: 'pending',
        pickup_code: pickupCode,
        pickup_date: null,
        pickup_location: resolvedDeliveryMethod === 'pickup' ? pickupLocation || null : null,
        pickup_instructions: resolvedDeliveryMethod === 'pickup' ? pickupInstructions || null : null,
        delivery_method: resolvedDeliveryMethod,
        delivery_fee: resolvedDeliveryFee,
        delivery_address: resolvedDeliveryMethod === 'shipping' ? deliveryAddress?.trim() || null : null,
        delivery_instructions: resolvedDeliveryMethod === 'shipping' ? deliveryInstructions?.trim() || null : null,
        customer_notes: customerNotes || null,
        producer_notes: null,
        is_paid: false,
        payment_method: null,
        completed_at: null,
      };

      const { data: order, error: orderError } = await serviceClient
        .from('local_market_orders')
        .insert(orderPayload)
        .select('*')
        .single();

      if (orderError || !order) {
        return new Response(JSON.stringify({ error: 'Failed to create order' }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      return new Response(JSON.stringify({ success: true, order, pickupCode }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (data.action === 'getByPickupCode') {
      if (!isProducerRole && role !== 'admin') {
        return new Response(JSON.stringify({ error: 'FORBIDDEN' }), {
          status: 403,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const { data: order, error: orderError } = await serviceClient
        .from('local_market_orders')
        .select('*')
        .eq('pickup_code', data.pickupCode)
        .single();

      if (orderError || !order) {
        return new Response(JSON.stringify({ error: 'Order not found' }), {
          status: 404,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      if (isProducerRole) {
        const producer = await resolveProducerForProfile(profile);
        if (!producer || producer.id !== order.producer_id) {
          console.warn('[local-market-orders] getByPickupCode forbidden', {
            userId: user.id,
            role,
            profileEmail: profile?.email ?? null,
            resolvedProducerId: producer?.id ?? null,
            orderProducerId: order.producer_id,
          });
          return new Response(JSON.stringify({ error: 'FORBIDDEN' }), {
            status: 403,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
      }

      return new Response(JSON.stringify({ success: true, order }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (data.action === 'cancel') {
      const lookup = resolveOrderLookup(data.orderId);
      const { data: order, error: orderError } = await serviceClient
        .from('local_market_orders')
        .select('*')
        .eq(lookup.field, lookup.value)
        .single();

      if (orderError || !order) {
        return new Response(JSON.stringify({ error: 'Order not found' }), {
          status: 404,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      if (order.customer_id !== user.id && role !== 'admin') {
        return new Response(JSON.stringify({ error: 'FORBIDDEN' }), {
          status: 403,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const { data: updated, error: updateError } = await serviceClient
        .from('local_market_orders')
        .update({ status: 'cancelled' })
        .eq(lookup.field, lookup.value)
        .select('*')
        .single();

      if (updateError || !updated) {
        return new Response(JSON.stringify({ error: 'Failed to cancel order' }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      return new Response(JSON.stringify({ success: true, order: updated }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (data.action === 'updateStatus') {
      if (!isProducerRole && role !== 'admin') {
        return new Response(JSON.stringify({ error: 'FORBIDDEN' }), {
          status: 403,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const lookup = resolveOrderLookup(data.orderId);
      const { data: order, error: orderError } = await serviceClient
        .from('local_market_orders')
        .select('*')
        .eq(lookup.field, lookup.value)
        .single();

      if (orderError || !order) {
        return new Response(JSON.stringify({ error: 'Order not found' }), {
          status: 404,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      if (isProducerRole) {
        const producer = await resolveProducerForProfile(profile);
        const producerMatches = producer?.id === order.producer_id;
        const profileMatches = profile?.id === order.producer_id;
        if (!producerMatches && !profileMatches) {
          console.warn('[local-market-orders] updateStatus forbidden', {
            userId: user.id,
            role,
            profileEmail: profile?.email ?? null,
            resolvedProducerId: producer?.id ?? null,
            orderProducerId: order.producer_id,
            orderLookupField: lookup.field,
            orderLookupValue: lookup.value,
          });
          return new Response(JSON.stringify({ error: 'FORBIDDEN' }), {
            status: 403,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
      }

      const { data: updated, error: updateError } = await serviceClient
        .from('local_market_orders')
        .update({
          status: data.status,
          producer_notes: data.producerNotes ?? null,
        })
        .eq(lookup.field, lookup.value)
        .select('*')
        .single();

      if (updateError || !updated) {
        return new Response(JSON.stringify({ error: 'Failed to update order' }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      return new Response(JSON.stringify({ success: true, order: updated }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ error: 'Unsupported action' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
);

serve(handler);
