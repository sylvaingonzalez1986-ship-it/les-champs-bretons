import { serve } from 'https://deno.land/std@0.208.0/http/server.ts';
import { createClient, SupabaseClient, User } from 'https://esm.sh/@supabase/supabase-js@2.38.0';
import { z } from 'https://deno.land/x/zod@v3.22.4/mod.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Max-Age': '86400',
};

const RATE_LIMIT_PRESETS = {
  ORDERS: {
    limit: 10,
    windowMs: 60 * 1000,
    identifier: 'orders',
  },
} as const;

interface RateLimitConfig {
  limit: number;
  windowMs: number;
  identifier: string;
}

interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
  retryAfterSeconds?: number;
}

const rateLimitStore = new Map<string, { count: number; resetAt: number }>();

function checkRateLimit(userId: string, config: RateLimitConfig): RateLimitResult {
  const now = Date.now();
  const key = `${config.identifier}:${userId}`;
  const entry = rateLimitStore.get(key);

  if (!entry || now > entry.resetAt) {
    rateLimitStore.set(key, { count: 1, resetAt: now + config.windowMs });
    return { allowed: true, remaining: config.limit - 1, resetAt: now + config.windowMs };
  }

  if (entry.count >= config.limit) {
    return {
      allowed: false,
      remaining: 0,
      resetAt: entry.resetAt,
      retryAfterSeconds: Math.ceil((entry.resetAt - now) / 1000),
    };
  }

  entry.count += 1;
  return { allowed: true, remaining: config.limit - entry.count, resetAt: entry.resetAt };
}

function createRateLimitResponse(
  result: RateLimitResult,
  config: RateLimitConfig
): Response {
  return new Response(
    JSON.stringify({
      error: 'RATE_LIMIT_EXCEEDED',
      message: `Rate limit exceeded. Maximum ${config.limit} requests per ${Math.ceil(config.windowMs / 1000)} seconds.`,
      retryAfter: result.retryAfterSeconds,
      resetAt: new Date(result.resetAt).toISOString(),
    }),
    {
      status: 429,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    }
  );
}

const uuidSchema = z.string().uuid('Invalid UUID format');
const emailSchema = z.string().email('Invalid email format').max(255);
const quantitySchema = z.number().int().positive().max(10000);

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
    customerNotes: z.string().max(1000).optional(),
    customerName: z.string().max(200).optional(),
    customerEmail: emailSchema.optional(),
    customerPhone: z.string().max(30).optional(),
  }),
  z.object({
    action: z.literal('cancel'),
    orderId: uuidSchema,
  }),
  z.object({
    action: z.literal('updateStatus'),
    orderId: uuidSchema,
    status: localMarketOrderStatusSchema,
    producerNotes: z.string().max(1000).optional(),
  }),
  z.object({
    action: z.literal('getByPickupCode'),
    pickupCode: z.string().min(4).max(32),
  }),
]);

type LocalMarketOrderActionInput = z.infer<typeof localMarketOrderActionSchema>;

interface ValidatedRequest<T> {
  user: User;
  data: T;
  supabase: SupabaseClient;
}

function createValidatedHandler<T>(
  config: { schema: z.ZodSchema<T>; rateLimit: RateLimitConfig; functionName: string },
  handler: (validated: ValidatedRequest<T>) => Promise<Response>
): (req: Request) => Promise<Response> {
  const { schema, rateLimit, functionName } = config;

  return async (req: Request): Promise<Response> => {
    if (req.method === 'OPTIONS') {
      return new Response('ok', { headers: corsHeaders });
    }

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'UNAUTHORIZED' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
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
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const userId = userData.user.id;
    const rateLimitResult = checkRateLimit(userId, rateLimit);
    if (!rateLimitResult.allowed) {
      return createRateLimitResponse(rateLimitResult, rateLimit);
    }

    let body: unknown = {};
    try {
      body = await req.json();
    } catch {
      return new Response(JSON.stringify({ error: 'PARSE_ERROR' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
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
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    try {
      return await handler({
        user: userData.user,
        data: validation.data,
        supabase,
      });
    } catch (error) {
      console.error(`[${functionName}] Handler error:`, error);
      return new Response(JSON.stringify({ error: 'INTERNAL_ERROR' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
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

const handler = createValidatedHandler<LocalMarketOrderActionInput>(
  {
    schema: localMarketOrderActionSchema,
    rateLimit: RATE_LIMIT_PRESETS.ORDERS,
    functionName: 'local-market-orders',
  },
  async ({ user, data, supabase }) => {
    const profile = await getUserProfile(user.id, supabase);
    const role = profile?.role ?? 'user';

    if (data.action === 'create') {
      const {
        producerId,
        productId,
        quantity,
        pickupLocation,
        pickupInstructions,
        customerNotes,
        customerName,
        customerEmail,
        customerPhone,
      } = data;

      // Fetch producer
      const { data: producer, error: producerError } = await serviceClient
        .from('producers')
        .select('id, name, email, phone, city, region')
        .eq('id', producerId)
        .single();

      if (producerError || !producer) {
        return new Response(JSON.stringify({ error: 'Producer not found' }), {
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

      const unitPrice = Number(product.price_public ?? 0);
      const totalAmount = unitPrice * quantity;
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
        producer_phone: producer.phone,
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
        pickup_location: pickupLocation || null,
        pickup_instructions: pickupInstructions || null,
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
      if (role !== 'producer' && role !== 'admin') {
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

      if (role === 'producer') {
        const producer = await getProducerByProfileId(user.id);
        if (!producer || producer.id !== order.producer_id) {
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
      const { data: order, error: orderError } = await serviceClient
        .from('local_market_orders')
        .select('*')
        .eq('id', data.orderId)
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
        .eq('id', data.orderId)
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
      if (role !== 'producer' && role !== 'admin') {
        return new Response(JSON.stringify({ error: 'FORBIDDEN' }), {
          status: 403,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const { data: order, error: orderError } = await serviceClient
        .from('local_market_orders')
        .select('*')
        .eq('id', data.orderId)
        .single();

      if (orderError || !order) {
        return new Response(JSON.stringify({ error: 'Order not found' }), {
          status: 404,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      if (role === 'producer') {
        const producer = await getProducerByProfileId(user.id);
        if (!producer || producer.id !== order.producer_id) {
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
        .eq('id', data.orderId)
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
