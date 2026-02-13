import { serve } from 'https://deno.land/std@0.208.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';
import { z } from 'https://deno.land/x/zod@v3.22.4/mod.ts';
import { getCorsHeaders, isOriginAllowed } from '../_shared/cors.ts';
import { verifyDeviceBinding } from '../_shared/device.ts';
import { checkRateLimit, createRateLimitResponse, RATE_LIMIT_PRESETS } from '../_shared/rate-limit.ts';

const orderStatusSchema = z.enum(['en_attente', 'confirmee', 'prete', 'recuperee', 'annulee']);

const listSchema = z.object({
  action: z.literal('list'),
  producerId: z.string().uuid().optional(),
  status: orderStatusSchema.optional(),
  limit: z.number().int().min(1).max(200).optional(),
  offset: z.number().int().min(0).optional(),
});

const detailsSchema = z.object({
  action: z.literal('details'),
  orderId: z.string().uuid(),
});

const updateSchema = z.object({
  action: z.literal('updateStatus'),
  orderId: z.string().uuid(),
  status: orderStatusSchema,
});

const producerSchema = z.object({
  action: z.literal('producerId'),
});

const requestSchema = z.discriminatedUnion('action', [
  listSchema,
  detailsSchema,
  updateSchema,
  producerSchema,
]);

type RequestInput = z.infer<typeof requestSchema>;

type DirectSaleOrder = {
  id: string;
  user_id: string;
  producer_id: string;
  pickup_code: string;
  total: number;
  statut: string;
  adresse_retrait: string;
  horaires_retrait: string;
  instructions_retrait: string | null;
  created_at: string;
  updated_at: string;
};

type OrderLine = {
  id: string;
  commande_id: string;
  product_id: string;
  quantite: number;
  prix_unitaire: number;
  sous_total: number;
  product_name?: string;
};

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

async function getProducerId(serviceClient: ReturnType<typeof createClient>, userId: string): Promise<string | null> {
  const { data, error } = await serviceClient
    .from('producers')
    .select('id')
    .eq('profile_id', userId)
    .maybeSingle();

  if (!error && data?.id) {
    return data.id;
  }

  // Fallback for legacy/misaligned producer links
  const { data: profileData, error: profileError } = await serviceClient
    .from('profiles')
    .select('linked_producer_id')
    .eq('id', userId)
    .maybeSingle();

  if (profileError) {
    return null;
  }

  const linkedProducerId = profileData?.linked_producer_id;
  if (!linkedProducerId) {
    return null;
  }

  const { data: linkedProducer, error: linkedError } = await serviceClient
    .from('producers')
    .select('id')
    .eq('id', linkedProducerId)
    .maybeSingle();

  if (linkedError) {
    return null;
  }

  return linkedProducer?.id ?? null;
}

async function ensureProducerAccess(
  serviceClient: ReturnType<typeof createClient>,
  userId: string,
  role: string,
  targetProducerId: string
): Promise<boolean> {
  if (role === 'admin') {
    return true;
  }

  const producerId = await getProducerId(serviceClient, userId);
  return Boolean(producerId && producerId === targetProducerId);
}

async function getServiceClient() {
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  return createClient(supabaseUrl, serviceKey);
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

  const rateLimitResult = await checkRateLimit(user.id, RATE_LIMIT_PRESETS.ORDERS);
  if (!rateLimitResult.allowed) {
    return createRateLimitResponse(rateLimitResult, RATE_LIMIT_PRESETS.ORDERS, responseCorsHeaders);
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

  const serviceClient = await getServiceClient();
  const role = await getUserRole(serviceClient, user.id);

  const input: RequestInput = parsed.data;

  if (input.action === 'producerId') {
    const producerId = await getProducerId(serviceClient, user.id);
    return jsonResponse({ producerId }, 200, responseCorsHeaders);
  }

  if (input.action === 'list') {
    const limit = input.limit ?? 200;
    const offset = input.offset ?? 0;

    const targetProducerId = input.producerId ?? await getProducerId(serviceClient, user.id);
    if (!targetProducerId) {
      return jsonResponse({ error: 'FORBIDDEN' }, 403, responseCorsHeaders);
    }

    const hasAccess = await ensureProducerAccess(serviceClient, user.id, role, targetProducerId);
    if (!hasAccess) {
      return jsonResponse({ error: 'FORBIDDEN' }, 403, responseCorsHeaders);
    }

    let query = serviceClient
      .from('commandes_vente_directe')
      .select('id,user_id,producer_id,pickup_code,total,statut,adresse_retrait,horaires_retrait,instructions_retrait,created_at,updated_at')
      .eq('producer_id', targetProducerId)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (input.status) {
      query = query.eq('statut', input.status);
    }

    const { data, error: listError } = await query;
    if (listError) {
      return jsonResponse({ error: 'DATABASE_ERROR' }, 500, responseCorsHeaders);
    }

    const orders = Array.isArray(data) ? data : [];

    return jsonResponse({
      orders,
      hasMore: orders.length === limit,
    }, 200, responseCorsHeaders);
  }

  if (input.action === 'details') {
    const { orderId } = input;

    const { data: order, error: orderError } = await serviceClient
      .from('commandes_vente_directe')
      .select('id,user_id,producer_id,pickup_code,total,statut,adresse_retrait,horaires_retrait,instructions_retrait,created_at,updated_at')
      .eq('id', orderId)
      .single();

    if (orderError || !order) {
      return jsonResponse({ error: 'ORDER_NOT_FOUND' }, 404, responseCorsHeaders);
    }

    const hasAccess = await ensureProducerAccess(serviceClient, user.id, role, order.producer_id);
    if (!hasAccess) {
      return jsonResponse({ error: 'FORBIDDEN' }, 403, responseCorsHeaders);
    }

    const { data: linesData, error: linesError } = await serviceClient
      .from('lignes_commande_vente_directe')
      .select('id,commande_id,product_id,quantite,prix_unitaire,sous_total,product:products(name)')
      .eq('commande_id', orderId);

    if (linesError) {
      return jsonResponse({ error: 'DATABASE_ERROR' }, 500, responseCorsHeaders);
    }

    const lines: OrderLine[] = (Array.isArray(linesData) ? linesData : []).map((line) => ({
      id: line.id,
      commande_id: line.commande_id,
      product_id: line.product_id,
      quantite: line.quantite,
      prix_unitaire: line.prix_unitaire,
      sous_total: line.sous_total,
      product_name: line.product?.name ?? 'Produit inconnu',
    }));

    const { data: customer } = await serviceClient
      .from('profiles')
      .select('id,email,first_name,last_name,phone')
      .eq('id', order.user_id)
      .single();

    return jsonResponse({
      order,
      lines,
      customer: customer ?? null,
    }, 200, responseCorsHeaders);
  }

  if (input.action === 'updateStatus') {
    const { orderId, status } = input;

    const { data: existing, error: existingError } = await serviceClient
      .from('commandes_vente_directe')
      .select('id,producer_id')
      .eq('id', orderId)
      .single();

    if (existingError || !existing) {
      return jsonResponse({ error: 'ORDER_NOT_FOUND' }, 404, responseCorsHeaders);
    }

    const hasAccess = await ensureProducerAccess(serviceClient, user.id, role, existing.producer_id);
    if (!hasAccess) {
      return jsonResponse({ error: 'FORBIDDEN' }, 403, responseCorsHeaders);
    }

    const { data: updated, error: updateError } = await serviceClient
      .from('commandes_vente_directe')
      .update({
        statut: status,
        updated_at: new Date().toISOString(),
      })
      .eq('id', orderId)
      .select('id,user_id,producer_id,pickup_code,total,statut,adresse_retrait,horaires_retrait,instructions_retrait,created_at,updated_at')
      .single();

    if (updateError || !updated) {
      return jsonResponse({ error: 'DATABASE_ERROR' }, 500, responseCorsHeaders);
    }

    return jsonResponse({ order: updated }, 200, responseCorsHeaders);
  }

  return jsonResponse({ error: 'INVALID_ACTION' }, 400, responseCorsHeaders);
});
