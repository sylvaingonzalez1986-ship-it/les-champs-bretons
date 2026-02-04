// @ts-nocheck
import { serve } from 'https://deno.land/std@0.208.0/http/server.ts';
import { z } from 'https://deno.land/x/zod@v3.22.4/mod.ts';
import { getCorsHeaders, isOriginAllowed } from '../_shared/cors.ts';

const requestSchema = z.object({
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
      const rawPath = inputPath.slice(idx + marker.length);
      if (rawPath.startsWith('public/')) {
        return rawPath.slice('public/'.length);
      }
      if (rawPath.startsWith('sign/')) {
        return rawPath.slice('sign/'.length);
      }
      return rawPath;
    }
  }
  return inputPath.replace(/^\/+/, '');
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

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  if (!supabaseUrl) {
    return jsonResponse({ error: 'CONFIG_ERROR' }, 500, corsHeaders);
  }

  const normalized = normalizePath(parsed.data.path);
  const [bucket, ...rest] = normalized.split('/');
  const filePath = rest.join('/');
  if (bucket !== 'lab-analyses' || !filePath) {
    return jsonResponse({ error: 'INVALID_PATH' }, 400, corsHeaders);
  }

  const publicUrl = `${supabaseUrl}/storage/v1/object/public/${bucket}/${filePath}`;
  return jsonResponse({ url: publicUrl }, 200, corsHeaders);
});
