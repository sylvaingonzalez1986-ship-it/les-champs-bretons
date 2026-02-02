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

const productSchema = z.object({
  id: z.string().optional(),
  producer_id: z.string().optional(),
  name: z.string().min(1).max(200).optional(),
  type: z.string().max(100).optional(),
  cbd_percent: z.number().nonnegative().optional().nullable(),
  thc_percent: z.number().nonnegative().optional().nullable(),
  price_public: z.number().nonnegative().optional(),
  price_pro: z.number().nonnegative().optional().nullable(),
  weight: z.string().max(50).optional().nullable(),
  image: z.string().max(500).optional().nullable(),
  images: z.array(z.string()).optional().nullable(),
  description: z.string().max(2000).optional().nullable(),
  tva_rate: z.number().nonnegative().optional(),
  stock: z.number().int().nonnegative().optional().nullable(),
  is_on_promo: z.boolean().optional(),
  promo_percent: z.number().nonnegative().optional().nullable(),
  visible_for_clients: z.boolean().optional(),
  visible_for_pros: z.boolean().optional(),
  status: z.string().max(50).optional(),
  lab_analysis_url: z.string().max(500).optional().nullable(),
  disponible_vente_directe: z.boolean().optional(),
  price_tiers: z.array(z.record(z.unknown())).optional().nullable(),
  price_pro_tiers: z.array(z.record(z.unknown())).optional().nullable(),
});

const requestSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('create'),
    product: productSchema,
  }),
  z.object({
    action: z.literal('update'),
    productId: z.string().min(1),
    updates: productSchema,
  }),
  z.object({
    action: z.literal('delete'),
    productId: z.string().min(1),
  }),
]);

const PRODUCT_FIELDS = new Set([
  'id',
  'producer_id',
  'name',
  'type',
  'cbd_percent',
  'thc_percent',
  'price_public',
  'price_pro',
  'weight',
  'image',
  'images',
  'description',
  'tva_rate',
  'stock',
  'is_on_promo',
  'promo_percent',
  'visible_for_clients',
  'visible_for_pros',
  'status',
  'lab_analysis_url',
  'disponible_vente_directe',
  'price_tiers',
  'price_pro_tiers',
]);

const UPDATE_FIELDS = new Set([...PRODUCT_FIELDS].filter((field) => field !== 'id' && field !== 'producer_id'));

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function pickFields(source: Record<string, unknown>, allowed: Set<string>): Record<string, unknown> {
  const picked: Record<string, unknown> = {};
  for (const key of Object.keys(source)) {
    if (allowed.has(key)) {
      picked[key] = source[key];
    }
  }
  return picked;
}

function enforceRateLimit(req: Request, userId: string): Response | null {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0] || 'unknown';
  const userAgent = req.headers.get('user-agent') || 'unknown';
  const rateLimitResult = checkRateLimit(userId, RATE_LIMIT_PRESETS.GENERAL);

  if (!rateLimitResult.allowed) {
    logSecurityEvent({
      userId,
      action: 'rate_limit_exceeded',
      endpoint: 'products-mutations',
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

async function getUserRole(serviceClient: ReturnType<typeof createClient>, userId: string): Promise<string> {
  const { data, error } = await serviceClient
    .from('profiles')
    .select('role')
    .eq('id', userId)
    .single();

  if (error) {
    return 'user';
  }

  return data?.role ?? 'user';
}

async function getProducerId(serviceClient: ReturnType<typeof createClient>, userId: string): Promise<string | null> {
  const { data, error } = await serviceClient
    .from('producers')
    .select('id')
    .eq('profile_id', userId)
    .single();

  if (error) {
    return null;
  }

  return data?.id ?? null;
}

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

  const rateLimitResponse = enforceRateLimit(req, user.id);
  if (rateLimitResponse) {
    return rateLimitResponse;
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
  const role = await getUserRole(serviceClient, user.id);

  if (role !== 'admin' && role !== 'producer') {
    return jsonResponse({ error: 'FORBIDDEN' }, 403);
  }

  if (parsed.data.action === 'create') {
    const productInput = pickFields(parsed.data.product as Record<string, unknown>, PRODUCT_FIELDS);
    const producerId = role === 'producer' ? await getProducerId(serviceClient, user.id) : null;

    if (role === 'producer' && !producerId) {
      return jsonResponse({ error: 'FORBIDDEN' }, 403);
    }

    const product = {
      ...productInput,
      producer_id: producerId ?? productInput.producer_id,
      id: productInput.id ?? `product-${crypto.randomUUID()}`,
    };

    if (!product.producer_id || !product.name) {
      return jsonResponse({ error: 'VALIDATION_ERROR' }, 400);
    }

    const { data, error: insertError } = await serviceClient
      .from('products')
      .insert(product)
      .select('*')
      .single();

    if (insertError) {
      return jsonResponse({ error: 'DATABASE_ERROR' }, 500);
    }

    return jsonResponse(data);
  }

  if (parsed.data.action === 'update') {
    const updates = pickFields(parsed.data.updates as Record<string, unknown>, UPDATE_FIELDS);
    if (Object.keys(updates).length === 0) {
      return jsonResponse({ error: 'NO_ALLOWED_FIELDS' }, 400);
    }

    if (role === 'producer') {
      const producerId = await getProducerId(serviceClient, user.id);
      if (!producerId) {
        return jsonResponse({ error: 'FORBIDDEN' }, 403);
      }

      const { data: product, error: productError } = await serviceClient
        .from('products')
        .select('producer_id')
        .eq('id', parsed.data.productId)
        .single();

      if (productError || !product) {
        return jsonResponse({ error: 'PRODUCT_NOT_FOUND' }, 404);
      }

      if (product.producer_id !== producerId) {
        return jsonResponse({ error: 'FORBIDDEN' }, 403);
      }
    }

    const { data, error: updateError } = await serviceClient
      .from('products')
      .update({
        ...updates,
        updated_at: new Date().toISOString(),
      })
      .eq('id', parsed.data.productId)
      .select('*')
      .single();

    if (updateError) {
      return jsonResponse({ error: 'DATABASE_ERROR' }, 500);
    }

    return jsonResponse(data);
  }

  if (parsed.data.action === 'delete') {
    if (role === 'producer') {
      const producerId = await getProducerId(serviceClient, user.id);
      if (!producerId) {
        return jsonResponse({ error: 'FORBIDDEN' }, 403);
      }

      const { data: product, error: productError } = await serviceClient
        .from('products')
        .select('producer_id')
        .eq('id', parsed.data.productId)
        .single();

      if (productError || !product) {
        return jsonResponse({ error: 'PRODUCT_NOT_FOUND' }, 404);
      }

      if (product.producer_id !== producerId) {
        return jsonResponse({ error: 'FORBIDDEN' }, 403);
      }
    }

    const { error: deleteError } = await serviceClient
      .from('products')
      .delete()
      .eq('id', parsed.data.productId);

    if (deleteError) {
      return jsonResponse({ error: 'DATABASE_ERROR' }, 500);
    }

    return jsonResponse({ success: true });
  }

  return jsonResponse({ error: 'INVALID_ACTION' }, 400);
});
