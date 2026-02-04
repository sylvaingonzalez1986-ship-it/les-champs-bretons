import { serve } from 'https://deno.land/std@0.208.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';
import { z } from 'https://deno.land/x/zod@v3.22.4/mod.ts';
import { getCorsHeaders, isOriginAllowed } from '../_shared/cors.ts';
import { checkRateLimit, createRateLimitResponse, RATE_LIMIT_PRESETS } from '../_shared/rate-limit.ts';

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

function jsonResponse(payload: unknown, status = 200, corsHeaders: Record<string, string>): Response {
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

  const rateLimitResponse = await enforceRateLimit(req, user.id);
  if (rateLimitResponse) {
    return rateLimitResponse;
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
  const role = await getUserRole(serviceClient, user.id);

  if (role !== 'admin' && role !== 'producer') {
    return jsonResponse({ error: 'FORBIDDEN' }, 403, responseCorsHeaders);
  }

  if (parsed.data.action === 'create') {
    const productInput = pickFields(parsed.data.product as Record<string, unknown>, PRODUCT_FIELDS);
    const producerId = role === 'producer' ? await getProducerId(serviceClient, user.id) : null;

    if (role === 'producer' && !producerId) {
      return jsonResponse({ error: 'FORBIDDEN' }, 403, responseCorsHeaders);
    }

    const product = {
      ...productInput,
      producer_id: producerId ?? productInput.producer_id,
      id: productInput.id ?? `product-${crypto.randomUUID()}`,
    };

    if (!product.producer_id || !product.name) {
      return jsonResponse({ error: 'VALIDATION_ERROR' }, 400, responseCorsHeaders);
    }

    const { data, error: insertError } = await serviceClient
      .from('products')
      .insert(product)
      .select('*')
      .single();

    if (insertError) {
      return jsonResponse({ error: 'DATABASE_ERROR' }, 500, responseCorsHeaders);
    }

    return jsonResponse(data, 200, responseCorsHeaders);
  }

  if (parsed.data.action === 'update') {
    const updates = pickFields(parsed.data.updates as Record<string, unknown>, UPDATE_FIELDS);
    if (Object.keys(updates).length === 0) {
      return jsonResponse({ error: 'NO_ALLOWED_FIELDS' }, 400, responseCorsHeaders);
    }

    if (role === 'producer') {
      const producerId = await getProducerId(serviceClient, user.id);
      if (!producerId) {
        return jsonResponse({ error: 'FORBIDDEN' }, 403, responseCorsHeaders);
      }

      const { data: product, error: productError } = await serviceClient
        .from('products')
        .select('producer_id')
        .eq('id', parsed.data.productId)
        .single();

      if (productError || !product) {
        return jsonResponse({ error: 'PRODUCT_NOT_FOUND' }, 404, responseCorsHeaders);
      }

      if (product.producer_id !== producerId) {
        return jsonResponse({ error: 'FORBIDDEN' }, 403, responseCorsHeaders);
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
      return jsonResponse({ error: 'DATABASE_ERROR' }, 500, responseCorsHeaders);
    }

    return jsonResponse(data, 200, responseCorsHeaders);
  }

  if (parsed.data.action === 'delete') {
    if (role === 'producer') {
      const producerId = await getProducerId(serviceClient, user.id);
      if (!producerId) {
        return jsonResponse({ error: 'FORBIDDEN' }, 403, responseCorsHeaders);
      }

      const { data: product, error: productError } = await serviceClient
        .from('products')
        .select('producer_id')
        .eq('id', parsed.data.productId)
        .single();

      if (productError || !product) {
        return jsonResponse({ error: 'PRODUCT_NOT_FOUND' }, 404, responseCorsHeaders);
      }

      if (product.producer_id !== producerId) {
        return jsonResponse({ error: 'FORBIDDEN' }, 403, responseCorsHeaders);
      }
    }

    const { error: deleteError } = await serviceClient
      .from('products')
      .delete()
      .eq('id', parsed.data.productId);

    if (deleteError) {
      return jsonResponse({ error: 'DATABASE_ERROR' }, 500, responseCorsHeaders);
    }

    return jsonResponse({ success: true }, 200, responseCorsHeaders);
  }

  return jsonResponse({ error: 'INVALID_ACTION' }, 400, responseCorsHeaders);
});
