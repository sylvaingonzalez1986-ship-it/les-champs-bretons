import { serve } from 'https://deno.land/std@0.208.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.38.0';
import { z } from 'https://deno.land/x/zod@v3.22.4/mod.ts';
import { getCorsHeaders, isOriginAllowed } from '../_shared/cors.ts';
import { verifyDeviceBinding } from '../_shared/device.ts';
import { checkRateLimit, createRateLimitResponse, RATE_LIMIT_PRESETS } from '../_shared/rate-limit.ts';

const requestSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('add'),
    item: z.object({
      productId: z.string().min(1),
      productName: z.string().min(1),
      productRarity: z.string().min(1),
      productValue: z.number().nonnegative(),
      productImage: z.string().optional().nullable(),
      lotId: z.string().optional().nullable(),
      lotType: z.string().optional().nullable(),
      discountPercent: z.number().nonnegative().optional().nullable(),
      discountAmount: z.number().nonnegative().optional().nullable(),
      minOrderAmount: z.number().nonnegative().optional().nullable(),
    }).strict(),
  }),
  z.object({
    action: z.literal('markUsed'),
    itemId: z.string().min(1),
  }),
  z.object({
    action: z.literal('delete'),
    itemId: z.string().min(1),
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

  return { user: data.user, authHeader, supabaseUrl, anonKey };
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

  const { user, error, authHeader, supabaseUrl, anonKey } = await getUserFromRequest(req, responseCorsHeaders);
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

  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (!serviceKey) {
    return jsonResponse({ error: 'CONFIG_ERROR' }, 500, responseCorsHeaders);
  }

  const serviceClient = createClient(supabaseUrl ?? '', serviceKey);

  if (parsed.data.action === 'add') {
    const item = parsed.data.item;
    const { error: insertError, data } = await serviceClient
      .from('user_collection')
      .insert({
        user_id: user.id,
        product_id: item.productId,
        product_name: item.productName,
        product_rarity: item.productRarity,
        product_value: item.productValue,
        product_image: item.productImage ?? null,
        lot_id: item.lotId ?? null,
        lot_type: item.lotType ?? null,
        discount_percent: item.discountPercent ?? null,
        discount_amount: item.discountAmount ?? null,
        min_order_amount: item.minOrderAmount ?? null,
        used: false,
        obtained_at: new Date().toISOString(),
      })
      .select('id')
      .single();

    if (insertError) {
      return jsonResponse({ error: 'DATABASE_ERROR' }, 500, responseCorsHeaders);
    }

    return jsonResponse({ id: data?.id ?? null }, 200, responseCorsHeaders);
  }

  if (parsed.data.action === 'markUsed') {
    const { error: updateError } = await serviceClient
      .from('user_collection')
      .update({ used: true })
      .eq('id', parsed.data.itemId)
      .eq('user_id', user.id);

    if (updateError) {
      return jsonResponse({ error: 'DATABASE_ERROR' }, 500, responseCorsHeaders);
    }

    return jsonResponse({ success: true }, 200, responseCorsHeaders);
  }

  if (parsed.data.action === 'delete') {
    const { error: deleteError } = await serviceClient
      .from('user_collection')
      .delete()
      .eq('id', parsed.data.itemId)
      .eq('user_id', user.id);

    if (deleteError) {
      return jsonResponse({ error: 'DATABASE_ERROR' }, 500, responseCorsHeaders);
    }

    return jsonResponse({ success: true }, 200, responseCorsHeaders);
  }

  return jsonResponse({ error: 'INVALID_ACTION' }, 400, responseCorsHeaders);
});
