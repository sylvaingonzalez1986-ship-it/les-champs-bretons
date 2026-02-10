// @ts-nocheck
import { serve } from 'https://deno.land/std@0.208.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';
import { z } from 'https://deno.land/x/zod@v3.22.4/mod.ts';
import { getCorsHeaders, isOriginAllowed } from '../_shared/cors.ts';
import { checkRateLimit, createRateLimitResponse, RATE_LIMIT_PRESETS } from '../_shared/rate-limit.ts';

const producerSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1).max(200).optional(),
  email: z.string().email().optional().nullable(),
  region: z.string().max(100).optional().nullable(),
  department: z.string().max(100).optional().nullable(),
  city: z.string().max(100).optional().nullable(),
  image: z.string().max(500).optional().nullable(),
  description: z.string().max(2000).optional().nullable(),
  latitude: z.number().optional(),
  longitude: z.number().optional(),
  map_position_x: z.number().optional().nullable(),
  map_position_y: z.number().optional().nullable(),
  soil_type: z.string().max(100).optional().nullable(),
  soil_ph: z.string().max(50).optional().nullable(),
  soil_characteristics: z.string().max(500).optional().nullable(),
  climate_type: z.string().max(100).optional().nullable(),
  climate_avg_temp: z.string().max(50).optional().nullable(),
  climate_rainfall: z.string().max(50).optional().nullable(),
  culture_outdoor: z.boolean().optional().nullable(),
  culture_greenhouse: z.boolean().optional().nullable(),
  culture_indoor: z.boolean().optional().nullable(),
  profile_id: z.string().uuid().optional().nullable(),
  vente_directe_ferme: z.boolean().optional().nullable(),
  adresse_retrait: z.string().max(255).optional().nullable(),
  horaires_retrait: z.string().max(255).optional().nullable(),
  instructions_retrait: z.string().max(1000).optional().nullable(),
  instagram_url: z.string().max(500).optional().nullable(),
  facebook_url: z.string().max(500).optional().nullable(),
  twitter_url: z.string().max(500).optional().nullable(),
  tiktok_url: z.string().max(500).optional().nullable(),
  youtube_url: z.string().max(500).optional().nullable(),
  website_url: z.string().max(500).optional().nullable(),
  linkedin_url: z.string().max(500).optional().nullable(),
});

const requestSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('create'),
    producer: producerSchema,
  }),
  z.object({
    action: z.literal('update'),
    producerId: z.string().min(1),
    updates: producerSchema,
  }),
  z.object({
    action: z.literal('delete'),
    producerId: z.string().min(1),
  }),
]);

const PRODUCER_FIELDS = new Set([
  'id',
  'name',
  'email',
  'region',
  'department',
  'city',
  'image',
  'description',
  'latitude',
  'longitude',
  'map_position_x',
  'map_position_y',
  'soil_type',
  'soil_ph',
  'soil_characteristics',
  'climate_type',
  'climate_avg_temp',
  'climate_rainfall',
  'culture_outdoor',
  'culture_greenhouse',
  'culture_indoor',
  'profile_id',
  'vente_directe_ferme',
  'adresse_retrait',
  'horaires_retrait',
  'instructions_retrait',
  'instagram_url',
  'facebook_url',
  'twitter_url',
  'tiktok_url',
  'youtube_url',
  'website_url',
  'linkedin_url',
]);

const UPDATE_FIELDS = new Set([...PRODUCER_FIELDS].filter((field) => field !== 'id' && field !== 'profile_id'));

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

async function getUserFromRequest(req: Request, responseCorsHeaders: Record<string, string>) {
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
  const authHeader = req.headers.get('Authorization');

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

  return { user: data.user, authHeader, supabaseUrl, anonKey };
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

  const { user, error, authHeader, supabaseUrl, anonKey } = await getUserFromRequest(req, responseCorsHeaders);
  if (error) {
    return error;
  }

  const rateLimitResult = await checkRateLimit(user.id, RATE_LIMIT_PRESETS.GENERAL);
  if (!rateLimitResult.allowed) {
    return createRateLimitResponse(rateLimitResult, RATE_LIMIT_PRESETS.GENERAL, responseCorsHeaders);
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

  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (!serviceKey || !supabaseUrl) {
    return jsonResponse({ error: 'CONFIG_ERROR' }, 500, responseCorsHeaders);
  }

  const serviceClient = createClient(supabaseUrl, serviceKey);
  const role = await getUserRole(serviceClient, user.id);

  if (role !== 'admin' && role !== 'producer') {
    return jsonResponse({ error: 'FORBIDDEN' }, 403, responseCorsHeaders);
  }

  if (parsed.data.action === 'create') {
    const producerInput = pickFields(parsed.data.producer as Record<string, unknown>, PRODUCER_FIELDS);
    const producerId = role === 'producer' ? await getProducerId(serviceClient, user.id) : null;

    if (role === 'producer' && producerId) {
      return jsonResponse({ error: 'ALREADY_EXISTS' }, 409, responseCorsHeaders);
    }

    const producer = {
      ...producerInput,
      id: producerInput.id ?? `producer-${crypto.randomUUID()}`,
      profile_id: role === 'producer' ? user.id : producerInput.profile_id ?? null,
    };

    const producerName = producerInput.name;
    if (!producerName || typeof producerName !== 'string') {
      return jsonResponse({ error: 'VALIDATION_ERROR' }, 400, responseCorsHeaders);
    }

    const { data, error: insertError } = await serviceClient
      .from('producers')
      .insert(producer)
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

      if (producerId !== parsed.data.producerId) {
        return jsonResponse({ error: 'FORBIDDEN' }, 403, responseCorsHeaders);
      }
    }

    const { data, error: updateError } = await serviceClient
      .from('producers')
      .update({
        ...updates,
        updated_at: new Date().toISOString(),
      })
      .eq('id', parsed.data.producerId)
      .select('*')
      .single();

    if (updateError) {
      return jsonResponse({ error: 'DATABASE_ERROR' }, 500, responseCorsHeaders);
    }

    return jsonResponse(data, 200, responseCorsHeaders);
  }

  if (parsed.data.action === 'delete') {
    if (role !== 'admin') {
      return jsonResponse({ error: 'FORBIDDEN' }, 403, responseCorsHeaders);
    }

    const { error: deleteProductsError } = await serviceClient
      .from('products')
      .delete()
      .eq('producer_id', parsed.data.producerId);

    if (deleteProductsError) {
      return jsonResponse({ error: 'DATABASE_ERROR' }, 500, responseCorsHeaders);
    }

    const { error: deleteError } = await serviceClient
      .from('producers')
      .delete()
      .eq('id', parsed.data.producerId);

    if (deleteError) {
      return jsonResponse({ error: 'DATABASE_ERROR' }, 500, responseCorsHeaders);
    }

    return jsonResponse({ success: true }, 200, responseCorsHeaders);
  }

  return jsonResponse({ error: 'INVALID_ACTION' }, 400, responseCorsHeaders);
});
