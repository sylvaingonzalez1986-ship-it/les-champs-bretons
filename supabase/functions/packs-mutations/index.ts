import { serve } from 'https://deno.land/std@0.208.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.38.0';
import { z } from 'https://deno.land/x/zod@v3.22.4/mod.ts';
import { getCorsHeaders, isOriginAllowed } from '../_shared/cors.ts';
import { checkRateLimit, createRateLimitResponse, RATE_LIMIT_PRESETS } from '../_shared/rate-limit.ts';

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

function jsonResponse(payload: unknown, status = 200, corsHeaders: Record<string, string>): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

async function enforceRateLimit(req: Request, userId: string): Promise<Response | null> {
  const rateLimitResult = await checkRateLimit(userId, RATE_LIMIT_PRESETS.GENERAL);
  if (!rateLimitResult.allowed) {
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

  if (!serviceKey) {
    return jsonResponse({ error: 'CONFIG_ERROR' }, 500, responseCorsHeaders);
  }

  const serviceClient = createClient(supabaseUrl, serviceKey);
  const { user, error } = await getUserFromRequest(req);
  if (error) {
    return error;
  }

  const rateLimitResponse = await enforceRateLimit(req, user.id);
  if (rateLimitResponse) {
    return rateLimitResponse;
  }

  const role = await getUserRole(serviceClient, user.id);
  if (role !== 'admin') {
    return jsonResponse({ error: 'FORBIDDEN' }, 403, responseCorsHeaders);
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
      return jsonResponse({ error: 'DATABASE_ERROR' }, 500, responseCorsHeaders);
    }

    await replacePackItems(serviceClient, packId, pack.items ?? []);

    return jsonResponse(data, 200, responseCorsHeaders);
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
      return jsonResponse({ error: 'DATABASE_ERROR' }, 500, responseCorsHeaders);
    }

    if (pack.items) {
      await replacePackItems(serviceClient, parsed.data.packId, pack.items);
    }

    return jsonResponse(data, 200, responseCorsHeaders);
  }

  if (parsed.data.action === 'delete') {
    await serviceClient.from('pack_items').delete().eq('pack_id', parsed.data.packId);

    const { error: deleteError } = await serviceClient
      .from('packs')
      .delete()
      .eq('id', parsed.data.packId);

    if (deleteError) {
      return jsonResponse({ error: 'DATABASE_ERROR' }, 500, responseCorsHeaders);
    }

    return jsonResponse({ success: true }, 200, responseCorsHeaders);
  }

  return jsonResponse({ error: 'INVALID_ACTION' }, 400, responseCorsHeaders);
});
