import { serve } from 'https://deno.land/std@0.208.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.38.0';
import { z } from 'https://deno.land/x/zod@v3.22.4/mod.ts';
import { getCorsHeaders, isOriginAllowed } from '../_shared/cors.ts';
import { verifyDeviceBinding } from '../_shared/device.ts';
import { checkRateLimit, createRateLimitResponse, RATE_LIMIT_PRESETS } from '../_shared/rate-limit.ts';

const requestSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('updateRole'),
    userId: z.string().uuid(),
    role: z.enum(['client', 'pro', 'producer', 'admin']),
  }),
  z.object({
    action: z.literal('updateProStatus'),
    userId: z.string().uuid(),
    status: z.enum(['pending', 'approved', 'rejected']).nullable(),
  }),
  z.object({
    action: z.literal('updateCategory'),
    userId: z.string().uuid(),
    category: z.enum(['restaurateur', 'epicerie', 'grossiste', 'producteur_maraicher', 'autre']).nullable(),
  }),
  z.object({
    action: z.literal('updateProfile'),
    userId: z.string().uuid(),
    updates: z.object({
      role: z.enum(['client', 'pro', 'producer', 'admin']).optional(),
      category: z.enum(['restaurateur', 'epicerie', 'grossiste', 'producteur_maraicher', 'autre']).nullable().optional(),
      siret: z.string().max(50).nullable().optional(),
      tva_number: z.string().max(50).nullable().optional(),
      full_name: z.string().max(200).nullable().optional(),
    }).strict(),
  }).refine((data) => Object.keys(data.updates).length > 0, {
    message: 'No updates provided',
  }),
]);

function jsonResponse(payload: unknown, status = 200, corsHeaders: Record<string, string>): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
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

  return { user: data.user, authHeader, anonKey, supabaseUrl };
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

  const { user, error, authHeader, anonKey, supabaseUrl } = await getUserFromRequest(req, responseCorsHeaders);
  if (error) {
    return error;
  }

  const authClient = createClient(supabaseUrl ?? '', anonKey ?? '', {
    global: { headers: { Authorization: authHeader ?? '' } },
  });
  const deviceError = await verifyDeviceBinding(req, user, authClient, responseCorsHeaders);
  if (deviceError) {
    return deviceError;
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

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';

  if (!supabaseUrl || !anonKey || !serviceKey) {
    return jsonResponse({ error: 'CONFIG_ERROR' }, 500, responseCorsHeaders);
  }

  const serviceClient = createClient(supabaseUrl, serviceKey);
  const callerRole = await getUserRole(serviceClient, user.id);
  if (callerRole !== 'admin') {
    return jsonResponse({ error: 'FORBIDDEN' }, 403, responseCorsHeaders);
  }

  const updates: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };

  if (parsed.data.action === 'updateRole') {
    updates.role = parsed.data.role;
  }

  if (parsed.data.action === 'updateProStatus') {
    updates.pro_status = parsed.data.status;
  }

  if (parsed.data.action === 'updateCategory') {
    updates.category = parsed.data.category;
  }

  if (parsed.data.action === 'updateProfile') {
    updates.role = parsed.data.updates.role ?? updates.role;
    updates.category = parsed.data.updates.category ?? updates.category;
    updates.siret = parsed.data.updates.siret ?? updates.siret;
    updates.tva_number = parsed.data.updates.tva_number ?? updates.tva_number;
    updates.full_name = parsed.data.updates.full_name ?? updates.full_name;
  }

  const { data, error: updateError } = await serviceClient
    .from('profiles')
    .update(updates)
    .eq('id', parsed.data.userId)
    .select('id, role, pro_status, category')
    .single();

  if (updateError) {
    return jsonResponse({ error: 'DATABASE_ERROR' }, 500, responseCorsHeaders);
  }

  return jsonResponse({ profile: data }, 200, responseCorsHeaders);
});
