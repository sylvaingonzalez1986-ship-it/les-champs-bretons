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

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function enforceRateLimit(req: Request, userId: string): Response | null {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0] || 'unknown';
  const userAgent = req.headers.get('user-agent') || 'unknown';
  const rateLimitResult = checkRateLimit(userId, RATE_LIMIT_PRESETS.GENERAL);

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
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const { user, error } = await getUserFromRequest(req);
  if (error) {
    return error;
  }

  const rateLimitResponse = enforceRateLimit(req, user.id);
  if (rateLimitResponse) {
    return rateLimitResponse;
  }

  const isAdmin = await ensureAdmin(user.id);
  if (!isAdmin) {
    return jsonResponse({ error: 'FORBIDDEN' }, 403);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

  if (!serviceKey) {
    return jsonResponse({ error: 'CONFIG_ERROR' }, 500);
  }

  const serviceClient = createClient(supabaseUrl, serviceKey);

  if (req.method === 'GET') {
    const { data, error: fetchError } = await serviceClient
      .from('app_data')
      .select('*')
      .order('created_at', { ascending: false });

    if (fetchError) {
      return jsonResponse({ error: 'DATABASE_ERROR' }, 500);
    }

    return jsonResponse(data ?? []);
  }

  let body: unknown = {};
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: 'INVALID_JSON' }, 400);
  }

  if (req.method === 'POST') {
    const parsed = appDataInsertSchema.safeParse(body);
    if (!parsed.success) {
      return jsonResponse({ error: 'VALIDATION_ERROR' }, 400);
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
      return jsonResponse({ error: 'DATABASE_ERROR' }, 500);
    }

    return jsonResponse(data);
  }

  if (req.method === 'PATCH') {
    const parsed = appDataUpdateSchema.safeParse(body);
    if (!parsed.success) {
      return jsonResponse({ error: 'VALIDATION_ERROR' }, 400);
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
      return jsonResponse({ error: 'DATABASE_ERROR' }, 500);
    }

    return jsonResponse(data);
  }

  if (req.method === 'DELETE') {
    const parsed = appDataDeleteSchema.safeParse(body);
    if (!parsed.success) {
      return jsonResponse({ error: 'VALIDATION_ERROR' }, 400);
    }

    const { error: deleteError } = await serviceClient
      .from('app_data')
      .delete()
      .eq('id', parsed.data.id);

    if (deleteError) {
      return jsonResponse({ error: 'DATABASE_ERROR' }, 500);
    }

    return jsonResponse({ success: true });
  }

  return jsonResponse({ error: 'METHOD_NOT_ALLOWED' }, 405);
});
