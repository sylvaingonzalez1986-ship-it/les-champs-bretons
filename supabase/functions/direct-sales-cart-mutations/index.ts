import { serve } from 'https://deno.land/std@0.208.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';
import { z } from 'https://deno.land/x/zod@v3.22.4/mod.ts';
import { getCorsHeaders, isOriginAllowed } from '../_shared/cors.ts';
import { verifyDeviceBinding } from '../_shared/device.ts';
import { checkRateLimit, createRateLimitResponse, RATE_LIMIT_PRESETS } from '../_shared/rate-limit.ts';

const requestSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('addItem'),
    item: z.object({
      productId: z.string().min(1),
      producerId: z.string().min(1),
      quantity: z.number().int().positive().max(10000),
    }).strict(),
  }),
  z.object({
    action: z.literal('updateQuantity'),
    itemId: z.string().min(1),
    quantity: z.number().int().min(0).max(10000),
  }),
  z.object({
    action: z.literal('removeItem'),
    itemId: z.string().min(1),
  }),
  z.object({
    action: z.literal('clearCart'),
  }),
]);

function jsonResponse(payload: unknown, status = 200, corsHeaders: Record<string, string>): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function logDatabaseError(stage: string, error: unknown, userId: string) {
  console.error(`[direct-sales-cart-mutations] ${stage} failed`, {
    userId,
    error,
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

  if (parsed.data.action === 'addItem') {
    const { productId, producerId, quantity } = parsed.data.item;
    const { data: existingItem, error: existingItemError } = await serviceClient
      .from('panier_vente_directe')
      .select('id, quantity')
      .eq('user_id', user.id)
      .eq('product_id', productId)
      .eq('producer_id', producerId)
      .maybeSingle();

    if (existingItemError) {
      logDatabaseError('addItem.lookup', existingItemError, user.id);
      return jsonResponse({ error: 'DATABASE_ERROR' }, 500, responseCorsHeaders);
    }

    if (existingItem?.id) {
      const { error: updateError } = await serviceClient
        .from('panier_vente_directe')
        .update({ quantity: existingItem.quantity + quantity })
        .eq('id', existingItem.id)
        .eq('user_id', user.id);

      if (updateError) {
        logDatabaseError('addItem.update', updateError, user.id);
        return jsonResponse({ error: 'DATABASE_ERROR' }, 500, responseCorsHeaders);
      }

      return jsonResponse({ success: true }, 200, responseCorsHeaders);
    }

    const { error: insertError } = await serviceClient
      .from('panier_vente_directe')
      .insert({
        user_id: user.id,
        product_id: productId,
        producer_id: producerId,
        quantity,
      });

    if (insertError) {
      logDatabaseError('addItem.insert', insertError, user.id);
      return jsonResponse({ error: 'DATABASE_ERROR' }, 500, responseCorsHeaders);
    }

    return jsonResponse({ success: true }, 200, responseCorsHeaders);
  }

  if (parsed.data.action === 'updateQuantity') {
    const { itemId, quantity } = parsed.data;

    if (quantity <= 0) {
      const { error: deleteError } = await serviceClient
        .from('panier_vente_directe')
        .delete()
        .eq('id', itemId)
        .eq('user_id', user.id);

      if (deleteError) {
        logDatabaseError('updateQuantity.delete', deleteError, user.id);
        return jsonResponse({ error: 'DATABASE_ERROR' }, 500, responseCorsHeaders);
      }

      return jsonResponse({ success: true }, 200, responseCorsHeaders);
    }

    const { error: updateError } = await serviceClient
      .from('panier_vente_directe')
      .update({ quantity })
      .eq('id', itemId)
      .eq('user_id', user.id);

    if (updateError) {
      logDatabaseError('updateQuantity.update', updateError, user.id);
      return jsonResponse({ error: 'DATABASE_ERROR' }, 500, responseCorsHeaders);
    }

    return jsonResponse({ success: true }, 200, responseCorsHeaders);
  }

  if (parsed.data.action === 'removeItem') {
    const { error: deleteError } = await serviceClient
      .from('panier_vente_directe')
      .delete()
      .eq('id', parsed.data.itemId)
      .eq('user_id', user.id);

    if (deleteError) {
      logDatabaseError('removeItem.delete', deleteError, user.id);
      return jsonResponse({ error: 'DATABASE_ERROR' }, 500, responseCorsHeaders);
    }

    return jsonResponse({ success: true }, 200, responseCorsHeaders);
  }

  if (parsed.data.action === 'clearCart') {
    const { error: clearError } = await serviceClient
      .from('panier_vente_directe')
      .delete()
      .eq('user_id', user.id);

    if (clearError) {
      logDatabaseError('clearCart.delete', clearError, user.id);
      return jsonResponse({ error: 'DATABASE_ERROR' }, 500, responseCorsHeaders);
    }

    return jsonResponse({ success: true }, 200, responseCorsHeaders);
  }

  return jsonResponse({ error: 'INVALID_ACTION' }, 400, responseCorsHeaders);
});
