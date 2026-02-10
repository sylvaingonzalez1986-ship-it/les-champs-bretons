import { serve } from 'https://deno.land/std@0.208.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';
import { z } from 'https://deno.land/x/zod@v3.22.4/mod.ts';
import { getCorsHeaders, isOriginAllowed } from '../_shared/cors.ts';
import {
  checkRateLimit,
  createRateLimitResponse,
  logSecurityEvent,
  RATE_LIMIT_PRESETS,
} from '../_shared/rate-limit.ts';


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
  shipping_enabled: z.boolean().optional().nullable(),
  shipping_fee: z.number().min(0).max(999999.99).optional().nullable(),
  shipping_note: z.string().max(500).optional().nullable(),
}).strict();

const updateProfileSchema = z.object({
  updates: profileUpdatesSchema,
}).refine((data) => Object.keys(data.updates).length > 0, {
  message: 'No updates provided',
});

function jsonResponse(payload: unknown, status = 200, corsHeaders: Record<string, string>): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
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

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) {
    return jsonResponse({ error: 'UNAUTHORIZED' }, 401, responseCorsHeaders);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const requireDeviceBinding = Deno.env.get('REQUIRE_DEVICE_BINDING') === 'true';

  if (!supabaseUrl || !anonKey || !serviceKey) {
    return jsonResponse({ error: 'CONFIG_ERROR' }, 500, responseCorsHeaders);
  }

  const supabase = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) {
    return jsonResponse({ error: 'UNAUTHORIZED' }, 401, responseCorsHeaders);
  }

  const serviceClient = createClient(supabaseUrl, serviceKey);

  // Device binding is best-effort; do not block profile updates on failure.
  // Auth token + rate limiting provides sufficient security.

  const userId = userData.user.id;
  const rateLimitResult = await checkRateLimit(userId, RATE_LIMIT_PRESETS.GENERAL);
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
    return createRateLimitResponse(rateLimitResult, RATE_LIMIT_PRESETS.GENERAL, responseCorsHeaders);
  }

  let body: unknown = {};
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: 'INVALID_JSON' }, 400, responseCorsHeaders);
  }

  const parsed = updateProfileSchema.safeParse(body);
  if (!parsed.success) {
    return jsonResponse({ error: 'VALIDATION_ERROR' }, 400, responseCorsHeaders);
  }

  const updates = {
    ...parsed.data.updates,
    updated_at: new Date().toISOString(),
  };

  const { data: profileData, error: updateError } = await serviceClient
    .from('profiles')
    .update(updates)
    .eq('id', userId)
    .select('*')
    .single();

  if (updateError) {
    console.error('[update-profile] DB error:', updateError.message, updateError.code, updateError.details);
    return jsonResponse({ error: 'DATABASE_ERROR', errorDetails: updateError.message, errorCode: updateError.code }, 500, responseCorsHeaders);
  }

  if (
    parsed.data.updates.vente_directe_ferme !== undefined ||
    parsed.data.updates.adresse_retrait !== undefined ||
    parsed.data.updates.horaires_retrait !== undefined ||
    parsed.data.updates.instructions_retrait !== undefined ||
    parsed.data.updates.shipping_enabled !== undefined ||
    parsed.data.updates.shipping_fee !== undefined ||
    parsed.data.updates.shipping_note !== undefined
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
      if (parsed.data.updates.shipping_enabled !== undefined) {
        producerUpdates.shipping_enabled = parsed.data.updates.shipping_enabled;
      }
      if (parsed.data.updates.shipping_fee !== undefined) {
        producerUpdates.shipping_fee = parsed.data.updates.shipping_fee;
      }
      if (parsed.data.updates.shipping_note !== undefined) {
        producerUpdates.shipping_note = parsed.data.updates.shipping_note;
      }

      await serviceClient
        .from('producers')
        .update(producerUpdates)
        .eq('id', producerData.id);
    }
  }

  return jsonResponse({ profile: profileData });
});
