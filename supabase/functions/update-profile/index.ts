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
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Max-Age': '86400',
};

const profileUpdatesSchema = z.object({
  full_name: z.string().max(200).optional().nullable(),
  first_name: z.string().max(100).optional().nullable(),
  last_name: z.string().max(100).optional().nullable(),
  birth_date: z.string().max(30).optional().nullable(),
  phone: z.string().max(50).optional().nullable(),
  address: z.string().max(255).optional().nullable(),
  postal_code: z.string().max(20).optional().nullable(),
  city: z.string().max(100).optional().nullable(),
  company_name: z.string().max(200).optional().nullable(),
  business_name: z.string().max(200).optional().nullable(),
  siret: z.string().max(50).optional().nullable(),
  tva_number: z.string().max(50).optional().nullable(),
  category: z.enum(['restaurateur', 'epicerie', 'grossiste', 'producteur_maraicher', 'autre']).optional().nullable(),
  is_adult: z.boolean().optional().nullable(),
  vente_directe_ferme: z.boolean().optional().nullable(),
  adresse_retrait: z.string().max(255).optional().nullable(),
  horaires_retrait: z.string().max(255).optional().nullable(),
  instructions_retrait: z.string().max(1000).optional().nullable(),
}).strict();

const updateProfileSchema = z.object({
  updates: profileUpdatesSchema,
}).refine((data) => Object.keys(data.updates).length > 0, {
  message: 'No updates provided',
});

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'METHOD_NOT_ALLOWED' }, 405);
  }

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) {
    return jsonResponse({ error: 'UNAUTHORIZED' }, 401);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

  if (!supabaseUrl || !anonKey || !serviceKey) {
    return jsonResponse({ error: 'CONFIG_ERROR' }, 500);
  }

  const supabase = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) {
    return jsonResponse({ error: 'UNAUTHORIZED' }, 401);
  }

  const userId = userData.user.id;
  const rateLimitResult = checkRateLimit(userId, RATE_LIMIT_PRESETS.GENERAL);
  if (!rateLimitResult.allowed) {
    logSecurityEvent({
      userId,
      action: 'rate_limit_exceeded',
      endpoint: 'update-profile',
      ip: req.headers.get('x-forwarded-for')?.split(',')[0] || 'unknown',
      userAgent: req.headers.get('user-agent') || 'unknown',
      success: false,
      reason: `Exceeded ${RATE_LIMIT_PRESETS.GENERAL.limit} requests per window`,
    });
    return createRateLimitResponse(rateLimitResult, RATE_LIMIT_PRESETS.GENERAL, corsHeaders);
  }

  let body: unknown = {};
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: 'INVALID_JSON' }, 400);
  }

  const parsed = updateProfileSchema.safeParse(body);
  if (!parsed.success) {
    return jsonResponse({ error: 'VALIDATION_ERROR' }, 400);
  }

  const updates = {
    ...parsed.data.updates,
    updated_at: new Date().toISOString(),
  };

  const serviceClient = createClient(supabaseUrl, serviceKey);

  const { data: profileData, error: updateError } = await serviceClient
    .from('profiles')
    .update(updates)
    .eq('id', userId)
    .select('*')
    .single();

  if (updateError) {
    return jsonResponse({ error: 'DATABASE_ERROR' }, 500);
  }

  if (
    parsed.data.updates.vente_directe_ferme !== undefined ||
    parsed.data.updates.adresse_retrait !== undefined ||
    parsed.data.updates.horaires_retrait !== undefined ||
    parsed.data.updates.instructions_retrait !== undefined
  ) {
    const { data: producerData } = await serviceClient
      .from('producers')
      .select('id')
      .eq('profile_id', userId)
      .single();

    if (producerData?.id) {
      const producerUpdates: Record<string, unknown> = {};
      if (parsed.data.updates.vente_directe_ferme !== undefined) {
        producerUpdates.vente_directe_ferme = parsed.data.updates.vente_directe_ferme;
      }
      if (parsed.data.updates.adresse_retrait !== undefined) {
        producerUpdates.adresse_retrait = parsed.data.updates.adresse_retrait;
      }
      if (parsed.data.updates.horaires_retrait !== undefined) {
        producerUpdates.horaires_retrait = parsed.data.updates.horaires_retrait;
      }
      if (parsed.data.updates.instructions_retrait !== undefined) {
        producerUpdates.instructions_retrait = parsed.data.updates.instructions_retrait;
      }

      await serviceClient
        .from('producers')
        .update(producerUpdates)
        .eq('id', producerData.id);
    }
  }

  return jsonResponse({ profile: profileData });
});
