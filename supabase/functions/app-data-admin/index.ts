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

const appDataInsertSchema = z.object({
  nom: z.string().trim().min(1).max(200),
  description: z.string().trim().max(1000).optional().nullable(),
  valeur: z.string().trim().max(1000).optional().nullable(),
});

const appDataUpdateSchema = z.object({
  id: z.string().min(1),
  nom: z.string().trim().min(1).max(200).optional(),
  description: z.string().trim().max(1000).optional().nullable(),
  valeur: z.string().trim().max(1000).optional().nullable(),
}).refine((data) => data.nom !== undefined || data.description !== undefined || data.valeur !== undefined, {
  message: 'No updates provided',
});

const appDataDeleteSchema = z.object({
  id: z.string().min(1),
});

function jsonResponse(payload: unknown, status = 200, corsHeaders: Record<string, string>): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

async function enforceRateLimit(req: Request, userId: string): Promise<Response | null> {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0] || 'unknown';
  const userAgent = req.headers.get('user-agent') || 'unknown';
  const rateLimitResult = await checkRateLimit(userId, RATE_LIMIT_PRESETS.GENERAL);

  if (!rateLimitResult.allowed) {
    logSecurityEvent({
      userId,
      action: 'rate_limit_exceeded',
      endpoint: 'app-data-admin',
      ip,
      userAgent,
      success: false,
      reason: `Exceeded ${RATE_LIMIT_PRESETS.GENERAL.limit} requests per window`,
    });
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

  return { user: data.user, authHeader };
}

async function ensureAdmin(userId: string): Promise<boolean> {
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

  if (!serviceKey) {
    return false;
  }

  const serviceClient = createClient(supabaseUrl, serviceKey);
  const { data: profile, error } = await serviceClient
    .from('profiles')
    .select('role')
    .eq('id', userId)
    .single();

  if (error) {
    return false;
  }

  return profile?.role === 'admin';
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

  const { user, error } = await getUserFromRequest(req);
  if (error) {
    return error;
  }

  const rateLimitResponse = await enforceRateLimit(req, user.id);
  if (rateLimitResponse) {
    return rateLimitResponse;
  }

  const isAdmin = await ensureAdmin(user.id);
  if (!isAdmin) {
    return jsonResponse({ error: 'FORBIDDEN' }, 403, responseCorsHeaders);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

  if (!serviceKey) {
    return jsonResponse({ error: 'CONFIG_ERROR' }, 500, responseCorsHeaders);
  }

  const serviceClient = createClient(supabaseUrl, serviceKey);

  if (req.method === 'GET') {
    const { data, error: fetchError } = await serviceClient
      .from('app_data')
      .select('*')
      .order('created_at', { ascending: false });

    if (fetchError) {
      return jsonResponse({ error: 'DATABASE_ERROR' }, 500, responseCorsHeaders);
    }

    return jsonResponse(data ?? [], 200, responseCorsHeaders);
  }

  let body: unknown = {};
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: 'INVALID_JSON' }, 400, responseCorsHeaders);
  }

  if (req.method === 'POST') {
    const parsed = appDataInsertSchema.safeParse(body);
    if (!parsed.success) {
      return jsonResponse({ error: 'VALIDATION_ERROR' }, 400, responseCorsHeaders);
    }

    const { data, error: insertError } = await serviceClient
      .from('app_data')
      .insert({
        nom: parsed.data.nom,
        description: parsed.data.description ?? null,
        valeur: parsed.data.valeur ?? null,
      })
      .select('*')
      .single();

    if (insertError) {
      return jsonResponse({ error: 'DATABASE_ERROR' }, 500, responseCorsHeaders);
    }

    return jsonResponse(data, 200, responseCorsHeaders);
  }

  if (req.method === 'PATCH') {
    const parsed = appDataUpdateSchema.safeParse(body);
    if (!parsed.success) {
      return jsonResponse({ error: 'VALIDATION_ERROR' }, 400, responseCorsHeaders);
    }

    const { id, ...updates } = parsed.data;
    const { data, error: updateError } = await serviceClient
      .from('app_data')
      .update({
        ...(updates.nom !== undefined ? { nom: updates.nom } : {}),
        ...(updates.description !== undefined ? { description: updates.description } : {}),
        ...(updates.valeur !== undefined ? { valeur: updates.valeur } : {}),
      })
      .eq('id', id)
      .select('*')
      .single();

    if (updateError) {
      return jsonResponse({ error: 'DATABASE_ERROR' }, 500, responseCorsHeaders);
    }

    return jsonResponse(data, 200, responseCorsHeaders);
  }

  if (req.method === 'DELETE') {
    const parsed = appDataDeleteSchema.safeParse(body);
    if (!parsed.success) {
      return jsonResponse({ error: 'VALIDATION_ERROR' }, 400, responseCorsHeaders);
    }

    const { error: deleteError } = await serviceClient
      .from('app_data')
      .delete()
      .eq('id', parsed.data.id);

    if (deleteError) {
      return jsonResponse({ error: 'DATABASE_ERROR' }, 500, responseCorsHeaders);
    }

    return jsonResponse({ success: true }, 200, responseCorsHeaders);
  }

  return jsonResponse({ error: 'METHOD_NOT_ALLOWED' }, 405, responseCorsHeaders);
});
