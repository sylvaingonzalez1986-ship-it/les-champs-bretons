// @ts-nocheck
import { serve } from 'https://deno.land/std@0.208.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.38.0';
import { z } from 'https://deno.land/x/zod@v3.22.4/mod.ts';
import { getCorsHeaders, isOriginAllowed } from '../_shared/cors.ts';

const requestSchema = z.object({
  bucket: z.enum(['music-audio', 'music-covers']),
  path: z.string().min(1),
  expiresIn: z.number().int().positive().max(86400).optional(),
});

function jsonResponse(payload: unknown, status = 200, headers?: Record<string, string>): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...(headers ?? {}), 'Content-Type': 'application/json' },
  });
}

function normalizePath(inputPath: string): string {
  if (inputPath.startsWith('http://') || inputPath.startsWith('https://')) {
    const marker = '/storage/v1/object/';
    const idx = inputPath.indexOf(marker);
    if (idx !== -1) {
      return inputPath.slice(idx + marker.length);
    }
  }
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

  return { user: data.user };
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

  const { error } = await getUserFromRequest(req, corsHeaders);
  if (error) {
    return error;
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (!serviceKey || !supabaseUrl) {
    return jsonResponse({ error: 'CONFIG_ERROR' }, 500, corsHeaders);
  }

  const serviceClient = createClient(supabaseUrl, serviceKey);
  const normalized = normalizePath(parsed.data.path);
  const [bucket, ...rest] = normalized.split('/');
  const filePath = rest.join('/');
  if (bucket !== parsed.data.bucket || !filePath) {
    return jsonResponse({ error: 'INVALID_PATH' }, 400, corsHeaders);
  }

  const expiresIn = parsed.data.expiresIn ?? 3600;
  const { data: signed, error: signError } = await serviceClient
    .storage
    .from(parsed.data.bucket)
    .createSignedUrl(filePath, expiresIn);

  if (signError || !signed?.signedUrl) {
    return jsonResponse({ error: 'SIGN_ERROR' }, 500, corsHeaders);
  }

  return jsonResponse({ url: signed.signedUrl }, 200, corsHeaders);
});
