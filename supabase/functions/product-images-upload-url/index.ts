// @ts-nocheck
import { serve } from 'https://deno.land/std@0.208.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';
import { z } from 'https://deno.land/x/zod@v3.22.4/mod.ts';
import { getCorsHeaders, isOriginAllowed } from '../_shared/cors.ts';
import { verifyDeviceBinding } from '../_shared/device.ts';
import { checkRateLimit, createRateLimitResponse, RATE_LIMIT_PRESETS } from '../_shared/rate-limit.ts';

const requestSchema = z.object({
  path: z.string().min(1),
  contentType: z.string().min(1).max(100),
  fileSize: z.number().int().positive().max(10 * 1024 * 1024),
});

function jsonResponse(payload: unknown, status = 200, headers?: Record<string, string>): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...(headers ?? {}), 'Content-Type': 'application/json' },
  });
}

function normalizePath(inputPath: string): string {
  return inputPath.replace(/^\/+/, '').replace(/\.\.+/g, '');
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

serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  const origin = req.headers.get('origin');

  if (!isOriginAllowed(origin)) {
    return new Response(JSON.stringify({ error: 'CORS_NOT_ALLOWED' }), {
      status: 403,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'METHOD_NOT_ALLOWED' }, 405, corsHeaders);
  }

  let body: unknown = {};
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: 'INVALID_JSON' }, 400, corsHeaders);
  }

  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return jsonResponse({ error: 'VALIDATION_ERROR' }, 400, corsHeaders);
  }

  const { user, error, authHeader, supabaseUrl, anonKey } = await getUserFromRequest(req, corsHeaders);
  if (error) {
    return error;
  }

  const authClient = createClient(supabaseUrl ?? '', anonKey ?? '', {
    global: { headers: { Authorization: authHeader ?? '' } },
  });

  const deviceError = await verifyDeviceBinding(req, user, authClient, corsHeaders);
  if (deviceError) {
    return deviceError;
  }

  const rateLimitResult = await checkRateLimit(user.id, RATE_LIMIT_PRESETS.GENERAL);
  if (!rateLimitResult.allowed) {
    return createRateLimitResponse(rateLimitResult, RATE_LIMIT_PRESETS.GENERAL, corsHeaders);
  }

  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (!serviceKey || !supabaseUrl) {
    return jsonResponse({ error: 'CONFIG_ERROR' }, 500, corsHeaders);
  }

  const serviceClient = createClient(supabaseUrl, serviceKey);

  const normalized = normalizePath(parsed.data.path);
  const bucket = 'product-images';

  const { data: validationResult, error: validationError } = await serviceClient
    .rpc('validate_file_upload', {
      p_bucket_name: bucket,
      p_file_path: normalized,
      p_file_size: parsed.data.fileSize,
      p_mime_type: parsed.data.contentType,
      p_file_header: null,
    });

  if (validationError || validationResult?.valid === false) {
    return jsonResponse({ error: 'VALIDATION_ERROR' }, 400, corsHeaders);
  }

  const { data: signed, error: signError } = await serviceClient
    .storage
    .from(bucket)
    .createSignedUploadUrl(normalized);

  if (signError || !signed?.signedUrl) {
    return jsonResponse({ error: 'SIGN_ERROR' }, 500, corsHeaders);
  }

  return jsonResponse({
    signedUrl: signed.signedUrl,
    path: `${bucket}/${normalized}`,
  }, 200, corsHeaders);
});
