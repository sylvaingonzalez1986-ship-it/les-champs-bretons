import { serve } from 'https://deno.land/std@0.208.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';
import { getCorsHeaders, isOriginAllowed } from '../_shared/cors.ts';
import {
  checkRateLimit,
  createRateLimitResponse,
  logSecurityEvent,
  RATE_LIMIT_PRESETS,
} from '../_shared/rate-limit.ts';

function jsonResponse(payload: unknown, status = 200, corsHeaders: Record<string, string>): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function normalizeDeviceId(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length > 128) return null;
  return trimmed;
}

serve(async (req) => {
  const responseCorsHeaders = getCorsHeaders(req);
  const origin = req.headers.get('origin');

  if (!isOriginAllowed(origin)) {
    return jsonResponse({ error: 'CORS_NOT_ALLOWED' }, 403, responseCorsHeaders);
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

  const deviceIdHeader = req.headers.get('X-Device-Id');
  const deviceId = deviceIdHeader ? normalizeDeviceId(deviceIdHeader) : null;
  if (!deviceId) {
    return jsonResponse({ error: 'DEVICE_ID_REQUIRED' }, 400, responseCorsHeaders);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

  if (!supabaseUrl || !anonKey || !serviceKey) {
    return jsonResponse({ error: 'CONFIG_ERROR' }, 500, responseCorsHeaders);
  }

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data: userData, error: userError } = await userClient.auth.getUser();
  if (userError || !userData.user) {
    return jsonResponse({ error: 'UNAUTHORIZED' }, 401, responseCorsHeaders);
  }

  const userId = userData.user.id;
  const rateLimitResult = await checkRateLimit(userId, RATE_LIMIT_PRESETS.DEVICE_BIND);
  if (!rateLimitResult.allowed) {
    logSecurityEvent({
      userId,
      action: 'rate_limit_exceeded',
      endpoint: 'bind-device',
      ip: req.headers.get('x-forwarded-for')?.split(',')[0] || 'unknown',
      userAgent: req.headers.get('user-agent') || 'unknown',
      success: false,
      reason: `Exceeded ${RATE_LIMIT_PRESETS.DEVICE_BIND.limit} requests per window`,
    });
    return createRateLimitResponse(rateLimitResult, RATE_LIMIT_PRESETS.DEVICE_BIND, responseCorsHeaders);
  }

  const serviceClient = createClient(supabaseUrl, serviceKey);
  const { data: profile, error: profileError } = await serviceClient
    .from('profiles')
    .select('device_id')
    .eq('id', userId)
    .single();

  if (profileError) {
    return jsonResponse({ error: 'DATABASE_ERROR' }, 500, responseCorsHeaders);
  }

  if (profile?.device_id && profile.device_id !== deviceId) {
    return jsonResponse({ error: 'DEVICE_MISMATCH' }, 409, responseCorsHeaders);
  }

  const now = new Date().toISOString();
  const updatePayload = profile?.device_id
    ? { last_device_seen_at: now }
    : { device_id: deviceId, device_bound_at: now, last_device_seen_at: now };

  const { error: updateError } = await serviceClient
    .from('profiles')
    .update(updatePayload)
    .eq('id', userId);

  if (updateError) {
    return jsonResponse({ error: 'DATABASE_ERROR' }, 500, responseCorsHeaders);
  }

  return jsonResponse({ success: true }, 200, responseCorsHeaders);
});
