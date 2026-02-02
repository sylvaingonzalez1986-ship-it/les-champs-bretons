import { serve } from 'https://deno.land/std@0.208.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.38.0';
import {
  createValidatedHandler,
  directSaleOrderSchema,
  RATE_LIMIT_PRESETS,
  corsHeaders,
  type DirectSaleOrderInput,
} from '../_shared/middleware.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';

const serviceClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

interface ProductRow {
  id: string;
  producer_id: string;
  price_public: number;
  name: string;
}

interface ProducerRow {
  id: string;
  adresse_retrait: string | null;
  horaires_retrait: string | null;
  instructions_retrait: string | null;
}

const handler = createValidatedHandler<DirectSaleOrderInput>(
  {
    schema: directSaleOrderSchema,
    rateLimit: RATE_LIMIT_PRESETS.ORDERS,
    functionName: 'create-direct-sale-orders',
  },
  async ({ user, data }, rawRequest) => {
    const { items } = data;

    // Group items by producer
    const itemsByProducer = new Map<string, DirectSaleOrderInput['items']>();
    for (const item of items) {
      const list = itemsByProducer.get(item.producerId) ?? [];
      list.push(item);
      itemsByProducer.set(item.producerId, list);
    }

    const orderIds: string[] = [];
    const errors: Array<{ producerId: string; reason: string }> = [];

    const authHeader = rawRequest.headers.get('Authorization') || '';

    for (const [producerId, producerItems] of itemsByProducer.entries()) {
      // Fetch producer pickup info
      const { data: producerData, error: producerError } = await serviceClient
        .from('producers')
        .select('id, adresse_retrait, horaires_retrait, instructions_retrait')
        .eq('id', producerId)
        .single();

      if (producerError || !producerData) {
        errors.push({ producerId, reason: 'Producer not found' });
        continue;
      }

      const producer = producerData as ProducerRow;

      // Fetch product data to compute totals securely
      const productIds = producerItems.map(
        (item: DirectSaleOrderInput['items'][number]) => item.productId
      );
      const { data: productsData, error: productsError } = await serviceClient
        .from('products')
        .select('id, producer_id, price_public, name')
        .in('id', productIds);

      if (productsError || !productsData) {
        errors.push({ producerId, reason: 'Products not found' });
        continue;
      }

      const products = productsData as ProductRow[];
      const productsMap = new Map(products.map((p) => [p.id, p]));

      let total = 0;
      const orderLines = [] as Array<{
        product_id: string;
        quantite: number;
        prix_unitaire: number;
        sous_total: number;
      }>;

      let invalid = false;
      for (const item of producerItems) {
        const product = productsMap.get(item.productId);
        if (!product || product.producer_id !== producerId) {
          errors.push({ producerId, reason: 'Invalid product for producer' });
          invalid = true;
          break;
        }

        const unitPrice = Number(product.price_public ?? 0);
        const lineTotal = unitPrice * item.quantity;
        total += lineTotal;
        orderLines.push({
          product_id: item.productId,
          quantite: item.quantity,
          prix_unitaire: unitPrice,
          sous_total: lineTotal,
        });
      }

      if (invalid) continue;

      if (total < 20) {
        errors.push({ producerId, reason: 'Minimum amount not met' });
        continue;
      }

      // Insert order
      const { data: orderData, error: orderError } = await serviceClient
        .from('commandes_vente_directe')
        .insert({
          user_id: user.id,
          producer_id: producerId,
          total,
          statut: 'en_attente',
          adresse_retrait: producer.adresse_retrait ?? '',
          horaires_retrait: producer.horaires_retrait ?? '',
          instructions_retrait: producer.instructions_retrait ?? null,
        })
        .select('id')
        .single();

      if (orderError || !orderData?.id) {
        errors.push({ producerId, reason: 'Failed to create order' });
        continue;
      }

      const orderId = orderData.id as string;

      // Insert order lines
      const { error: linesError } = await serviceClient
        .from('lignes_commande_vente_directe')
        .insert(
          orderLines.map((line) => ({
            ...line,
            commande_id: orderId,
          }))
        );

      if (linesError) {
        errors.push({ producerId, reason: 'Failed to create order lines' });
        continue;
      }

      orderIds.push(orderId);

      // Trigger email (best-effort)
      if (authHeader) {
        try {
          await fetch(`${SUPABASE_URL}/functions/v1/send-order-email`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: authHeader,
            },
            body: JSON.stringify({
              commandeId: orderId,
              producerId,
              userId: user.id,
            }),
          });
        } catch {
          // ignore email errors
        }
      }
    }

    return new Response(
      JSON.stringify({
        success: orderIds.length > 0,
        orderIds,
        errors,
      }),
      {
        status: orderIds.length > 0 ? 200 : 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
);

serve(handler);
