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

function logDatabaseError(stage: string, error: unknown, userId: string) {
  console.error(`[bind-device] ${stage} failed`, {
    userId,
    error,
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
    .maybeSingle();

  if (profileError && profileError.code !== 'PGRST116') {
    logDatabaseError('profile_lookup', profileError, userId);
    return jsonResponse({ error: 'DATABASE_ERROR' }, 500, responseCorsHeaders);
  }

  if (profile?.device_id && profile.device_id !== deviceId) {
    return jsonResponse({ error: 'DEVICE_MISMATCH' }, 409, responseCorsHeaders);
  }

  const now = new Date().toISOString();
  if (!profile) {
    const { error: insertError } = await serviceClient
      .from('profiles')
      .insert({
        id: userId,
        email: userData.user.email ?? null,
        full_name: userData.user.user_metadata?.full_name ?? null,
        role: 'client',
        device_id: deviceId,
        device_bound_at: now,
        last_device_seen_at: now,
      });

    if (insertError) {
      if (insertError.code === '23505') {
        const { data: conflictProfile, error: conflictProfileError } = await serviceClient
          .from('profiles')
          .select('device_id')
          .eq('id', userId)
          .maybeSingle();

        if (conflictProfileError) {
          logDatabaseError('profile_lookup_after_conflict', conflictProfileError, userId);
          return jsonResponse({ error: 'DATABASE_ERROR' }, 500, responseCorsHeaders);
        }

        if (!conflictProfile?.device_id) {
          const { error: conflictUpdateError } = await serviceClient
            .from('profiles')
            .update({ device_id: deviceId, device_bound_at: now, last_device_seen_at: now })
            .eq('id', userId);

          if (conflictUpdateError) {
            logDatabaseError('profile_update_after_conflict', conflictUpdateError, userId);
            return jsonResponse({ error: 'DATABASE_ERROR' }, 500, responseCorsHeaders);
          }
        } else if (conflictProfile.device_id !== deviceId) {
          return jsonResponse({ error: 'DEVICE_MISMATCH' }, 409, responseCorsHeaders);
        } else {
          const { error: touchError } = await serviceClient
            .from('profiles')
            .update({ last_device_seen_at: now })
            .eq('id', userId);

          if (touchError) {
            logDatabaseError('profile_touch_after_conflict', touchError, userId);
            return jsonResponse({ error: 'DATABASE_ERROR' }, 500, responseCorsHeaders);
          }
        }

        return jsonResponse({ success: true }, 200, responseCorsHeaders);
      }

      logDatabaseError('profile_insert', insertError, userId);
      return jsonResponse({ error: 'DATABASE_ERROR' }, 500, responseCorsHeaders);
    }

    return jsonResponse({ success: true }, 200, responseCorsHeaders);
  }

  const updatePayload = profile.device_id
    ? { last_device_seen_at: now }
    : { device_id: deviceId, device_bound_at: now, last_device_seen_at: now };

  const { error: updateError } = await serviceClient
    .from('profiles')
    .update(updatePayload)
    .eq('id', userId);

  if (updateError) {
    logDatabaseError('profile_update', updateError, userId);
    return jsonResponse({ error: 'DATABASE_ERROR' }, 500, responseCorsHeaders);
  }

  return jsonResponse({ success: true }, 200, responseCorsHeaders);
});
