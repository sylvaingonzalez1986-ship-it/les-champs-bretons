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

const packItemSchema = z.object({
  name: z.string().min(1),
  quantity: z.number().int().nonnegative(),
  value: z.number().nonnegative(),
  images: z.array(z.string()).optional().nullable(),
  producer_name: z.string().optional().nullable(),
});

const packSchema = z.object({
  id: z.string().min(1).optional(),
  name: z.string().min(1).optional(),
  description: z.string().optional().nullable(),
  price: z.number().nonnegative().optional(),
  original_price: z.number().nonnegative().optional().nullable(),
  image: z.string().max(500).optional().nullable(),
  tag: z.string().optional().nullable(),
  color: z.string().optional(),
  active: z.boolean().optional(),
  items: z.array(packItemSchema).optional(),
});

const requestSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('create'), pack: packSchema }),
  z.object({ action: z.literal('update'), packId: z.string().min(1), pack: packSchema }),
  z.object({ action: z.literal('delete'), packId: z.string().min(1) }),
]);

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
      endpoint: 'packs-mutations',
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

  return { user: data.user };
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

async function replacePackItems(
  serviceClient: ReturnType<typeof createClient>,
  packId: string,
  items: Array<z.infer<typeof packItemSchema>>
) {
  await serviceClient.from('pack_items').delete().eq('pack_id', packId);

  if (items.length === 0) {
    return;
  }

  const payload = items.map((item) => ({
    pack_id: packId,
    name: item.name,
    quantity: item.quantity,
    value: item.value,
    images: item.images ?? null,
    producer_name: item.producer_name ?? null,
  }));

  await serviceClient.from('pack_items').insert(payload);
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'METHOD_NOT_ALLOWED' }, 405);
  }

  let body: unknown = {};
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: 'INVALID_JSON' }, 400);
  }

  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return jsonResponse({ error: 'VALIDATION_ERROR' }, 400);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

  if (!serviceKey) {
    return jsonResponse({ error: 'CONFIG_ERROR' }, 500);
  }

  const serviceClient = createClient(supabaseUrl, serviceKey);
  const { user, error } = await getUserFromRequest(req);
  if (error) {
    return error;
  }

  const rateLimitResponse = enforceRateLimit(req, user.id);
  if (rateLimitResponse) {
    return rateLimitResponse;
  }

  const role = await getUserRole(serviceClient, user.id);
  if (role !== 'admin') {
    return jsonResponse({ error: 'FORBIDDEN' }, 403);
  }

  if (parsed.data.action === 'create') {
    const pack = parsed.data.pack;
    const packId = pack.id ?? `pack-${crypto.randomUUID()}`;

    const { data, error: insertError } = await serviceClient
      .from('packs')
      .insert({
        id: packId,
        name: pack.name,
        description: pack.description ?? null,
        price: pack.price,
        original_price: pack.original_price ?? null,
        image: pack.image ?? null,
        tag: pack.tag ?? null,
        color: pack.color,
        active: pack.active ?? true,
      })
      .select('*')
      .single();

    if (insertError) {
      return jsonResponse({ error: 'DATABASE_ERROR' }, 500);
    }

    await replacePackItems(serviceClient, packId, pack.items ?? []);

    return jsonResponse(data);
  }

  if (parsed.data.action === 'update') {
    const pack = parsed.data.pack;

    const { data, error: updateError } = await serviceClient
      .from('packs')
      .update({
        ...(pack.name !== undefined ? { name: pack.name } : {}),
        ...(pack.description !== undefined ? { description: pack.description ?? null } : {}),
        ...(pack.price !== undefined ? { price: pack.price } : {}),
        ...(pack.original_price !== undefined ? { original_price: pack.original_price ?? null } : {}),
        ...(pack.image !== undefined ? { image: pack.image ?? null } : {}),
        ...(pack.tag !== undefined ? { tag: pack.tag ?? null } : {}),
        ...(pack.color !== undefined ? { color: pack.color } : {}),
        ...(pack.active !== undefined ? { active: pack.active } : {}),
        updated_at: new Date().toISOString(),
      })
      .eq('id', parsed.data.packId)
      .select('*')
      .single();

    if (updateError) {
      return jsonResponse({ error: 'DATABASE_ERROR' }, 500);
    }

    if (pack.items) {
      await replacePackItems(serviceClient, parsed.data.packId, pack.items);
    }

    return jsonResponse(data);
  }

  if (parsed.data.action === 'delete') {
    await serviceClient.from('pack_items').delete().eq('pack_id', parsed.data.packId);

    const { error: deleteError } = await serviceClient
      .from('packs')
      .delete()
      .eq('id', parsed.data.packId);

    if (deleteError) {
      return jsonResponse({ error: 'DATABASE_ERROR' }, 500);
    }

    return jsonResponse({ success: true });
  }

  return jsonResponse({ error: 'INVALID_ACTION' }, 400);
});
