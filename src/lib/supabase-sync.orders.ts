import { getValidSession } from './supabase-auth';
import {
  SUPABASE_URL,
  getAuthenticatedHeaders,
  isSupabaseSyncConfigured,
  supabaseFetch,
} from './supabase-sync-core';
import { Order, OrderStatus } from './store';

export interface SupabaseOrderItem {
  product_id: string;
  product_name: string;
  product_type: string;
  producer_id: string;
  producer_name: string;
  quantity: number;
  unit_price: number;
  total_price: number;
  tva_rate: number | null;
}

export interface SupabaseOrder {
  id: string;
  user_id?: string | null;
  customer_first_name: string;
  customer_last_name: string;
  customer_email: string;
  customer_phone: string;
  customer_address: string;
  customer_city: string;
  customer_postal_code: string;
  items: SupabaseOrderItem[];
  subtotal: number;
  shipping_fee: number;
  total: number;
  status: string;
  tracking_number: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  // Order type - PRO ou client classique
  is_pro_order: boolean;
  // Payment validation fields
  payment_validated: boolean;
  payment_validated_at: string | null;
  payment_validated_by: string | null;
  tickets_distributed: boolean;
  tickets_earned: number;
}

// Convert Supabase order to app Order format
function supabaseToOrder(so: SupabaseOrder): Order & { user_id?: string | null } {
  return {
    id: so.id,
    user_id: so.user_id, // DEBUG: copie user_id pour vérification RLS
    customerInfo: {
      firstName: so.customer_first_name,
      lastName: so.customer_last_name,
      email: so.customer_email,
      phone: so.customer_phone,
      address: so.customer_address,
      city: so.customer_city,
      postalCode: so.customer_postal_code,
    },
    items: so.items.map((item) => ({
      productId: item.product_id,
      productName: item.product_name,
      productType: item.product_type,
      producerId: item.producer_id,
      producerName: item.producer_name,
      quantity: item.quantity,
      unitPrice: item.unit_price,
      totalPrice: item.total_price,
      tvaRate: item.tva_rate ?? undefined,
    })),
    subtotal: so.subtotal,
    shippingFee: so.shipping_fee,
    total: so.total,
    status: so.status as OrderStatus,
    trackingNumber: so.tracking_number ?? undefined,
    notes: so.notes ?? undefined,
    createdAt: new Date(so.created_at).getTime(),
    updatedAt: new Date(so.updated_at).getTime(),
    // Order type
    isProOrder: so.is_pro_order ?? false,
    // Payment validation fields
    paymentValidated: so.payment_validated ?? false,
    paymentValidatedAt: so.payment_validated_at ? new Date(so.payment_validated_at).getTime() : undefined,
    paymentValidatedBy: so.payment_validated_by ?? undefined,
    ticketsDistributed: so.tickets_distributed ?? false,
    ticketsEarned: so.tickets_earned ?? 0,
  };
}

// Convert app Order to Supabase format
function orderToSupabase(order: Order): Omit<SupabaseOrder, 'created_at' | 'updated_at'> {
  return {
    id: order.id,
    customer_first_name: order.customerInfo.firstName,
    customer_last_name: order.customerInfo.lastName,
    customer_email: order.customerInfo.email,
    customer_phone: order.customerInfo.phone,
    customer_address: order.customerInfo.address,
    customer_city: order.customerInfo.city,
    customer_postal_code: order.customerInfo.postalCode,
    items: order.items.map((item) => ({
      product_id: item.productId,
      product_name: item.productName,
      product_type: item.productType,
      producer_id: item.producerId,
      producer_name: item.producerName,
      quantity: item.quantity,
      unit_price: item.unitPrice,
      total_price: item.totalPrice,
      tva_rate: item.tvaRate ?? null,
    })),
    subtotal: order.subtotal,
    shipping_fee: order.shippingFee,
    total: order.total,
    status: order.status,
    tracking_number: order.trackingNumber ?? null,
    notes: order.notes ?? null,
    // Order type
    is_pro_order: order.isProOrder ?? false,
    // Payment validation fields
    payment_validated: order.paymentValidated ?? false,
    payment_validated_at: order.paymentValidatedAt ? new Date(order.paymentValidatedAt).toISOString() : null,
    payment_validated_by: order.paymentValidatedBy ?? null,
    tickets_distributed: order.ticketsDistributed ?? false,
    tickets_earned: order.ticketsEarned ?? 0,
  };
}

// Fetch all orders from Supabase (utilise RLS - clients voient leurs commandes, admins voient tout)
/**
 * Fetch orders - optionally filtered by producer_id for security
 * When producerId is provided, only returns orders containing products from that producer
 * IMPORTANT: Requires user authentication - returns empty array if not authenticated
 */
export async function fetchOrders(
  producerId?: string,
  options?: { limit?: number; offset?: number }
): Promise<Order[]> {
  if (!isSupabaseSyncConfigured()) {
    return [];
  }

  try {
    // Check authentication BEFORE making request
    const session = await getValidSession();
    if (!session?.access_token) {
      return [];
    }

    const headers = await getAuthenticatedHeaders();

    let url = `${SUPABASE_URL}/rest/v1/orders?select=*&order=created_at.desc`;

    // If producerId is provided, filter orders that contain this producer's products
    // This is done server-side for security - producers only see relevant orders
    let response: Response | null = null;

    if (producerId) {
      const joinUrl = `${SUPABASE_URL}/rest/v1/orders?select=*,order_items!inner(producer_id)&order=created_at.desc&order_items.producer_id=eq.${producerId}`;
      const pagedJoinUrl = `${joinUrl}${options?.limit !== undefined ? `&limit=${options.limit}` : ''}${options?.offset !== undefined ? `&offset=${options.offset}` : ''}`;
      response = await supabaseFetch(pagedJoinUrl, { method: 'GET', headers });
    } else {
      if (options?.limit !== undefined) {
        url += `&limit=${options.limit}`;
      }
      if (options?.offset !== undefined) {
        url += `&offset=${options.offset}`;
      }

      response = await supabaseFetch(url, {
        method: 'GET',
        headers,
      });
    }

    if (!response.ok) {
      const errorText = await response.text();
      // 403 = RLS policy denied access (user doesn't have permission or token expired)
      if (response.status === 403) {
        return [];
      }
      // Erreur de table manquante (42P01) - la table n'existe pas dans Supabase
      if (errorText.includes('42P01') || errorText.includes('does not exist') || errorText.includes('relation')) {
        return [];
      }
      // 404 générique
      if (response.status === 404) {
        return [];
      }
      return [];
    }

    const data: SupabaseOrder[] = await response.json();
    return data.map(supabaseToOrder);
  } catch (error) {
    console.warn('[fetchOrders] Error fetching orders:', error instanceof Error ? error.message : 'Unknown error');
    return [];
  }
}

/**
 * Fetch orders for a specific producer - server-side filtered
 * Only returns orders containing products from the authenticated producer
 * Supports pagination for load testing and performance optimization
 */
export async function fetchOrdersForProducer(
  producerId: string,
  options?: { limit?: number; offset?: number }
): Promise<Order[]> {
  if (!producerId) {
    console.warn('[fetchOrdersForProducer] Producer ID is required');
    return [];
  }
  return fetchOrders(producerId, options);
}

// Add order to Supabase (inclut user_id pour RLS)
export async function addOrderToSupabase(order: Order): Promise<SupabaseOrder | null> {
  if (!isSupabaseSyncConfigured()) {
    throw new Error('Supabase non configuré');
  }

  const session = await getValidSession();
  const headers = await getAuthenticatedHeaders();
  const orderData = orderToSupabase(order);

  const response = await supabaseFetch(`${SUPABASE_URL}/rest/v1/orders`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      ...orderData,
      user_id: session?.user?.id || null,
      created_at: new Date(order.createdAt).toISOString(),
      updated_at: new Date(order.updatedAt).toISOString(),
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    // Vérifier si c'est une erreur de permissions RLS (42501)
    if (errorText.includes('42501') || errorText.includes('permission denied')) {
      console.warn('[addOrderToSupabase] Erreur permissions RLS - La migration SQL doit être exécutée dans Supabase');
      console.warn('[addOrderToSupabase] Exécutez: database/migrations/fix_orders_rls_policies.sql');
      // Throw une erreur plus explicite
      throw new Error('Erreur de permissions Supabase. Exécutez la migration fix_orders_rls_policies.sql');
    }
    // Vérifier si c'est une erreur de table manquante (audit_log_entries, etc.)
    if (errorText.includes('42P01') || errorText.includes('does not exist')) {
      console.warn('[addOrderToSupabase] Table manquante dans Supabase');
      // On considère que la commande est enregistrée localement et on ne bloque pas
      console.warn('[addOrderToSupabase] La commande sera conservée localement uniquement');
      return null;
    }
    throw new Error('Erreur ajout commande');
  }

  const data = await response.json();
  return Array.isArray(data) ? data[0] : data;
}

// Update order in Supabase (utilise RLS - client ne peut modifier que ses commandes)
export async function updateOrderInSupabase(id: string, updates: Partial<Order>): Promise<void> {
  if (!isSupabaseSyncConfigured()) {
    throw new Error('Supabase non configuré');
  }

  const supabaseUpdates: Record<string, unknown> = {};

  if (updates.customerInfo) {
    supabaseUpdates.customer_first_name = updates.customerInfo.firstName;
    supabaseUpdates.customer_last_name = updates.customerInfo.lastName;
    supabaseUpdates.customer_email = updates.customerInfo.email;
    supabaseUpdates.customer_phone = updates.customerInfo.phone;
    supabaseUpdates.customer_address = updates.customerInfo.address;
    supabaseUpdates.customer_city = updates.customerInfo.city;
    supabaseUpdates.customer_postal_code = updates.customerInfo.postalCode;
  }
  if (updates.items !== undefined) {
    supabaseUpdates.items = updates.items.map((item) => ({
      product_id: item.productId,
      product_name: item.productName,
      product_type: item.productType,
      producer_id: item.producerId,
      producer_name: item.producerName,
      quantity: item.quantity,
      unit_price: item.unitPrice,
      total_price: item.totalPrice,
      tva_rate: item.tvaRate ?? null,
    }));
  }
  if (updates.subtotal !== undefined) supabaseUpdates.subtotal = updates.subtotal;
  if (updates.shippingFee !== undefined) supabaseUpdates.shipping_fee = updates.shippingFee;
  if (updates.total !== undefined) supabaseUpdates.total = updates.total;
  if (updates.status !== undefined) supabaseUpdates.status = updates.status;
  if (updates.trackingNumber !== undefined) supabaseUpdates.tracking_number = updates.trackingNumber;
  if (updates.notes !== undefined) supabaseUpdates.notes = updates.notes;
  supabaseUpdates.updated_at = new Date().toISOString();

  const headers = await getAuthenticatedHeaders();
  const response = await supabaseFetch(`${SUPABASE_URL}/functions/v1/orders-update`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ id, updates: supabaseUpdates }),
  });

  if (!response.ok) {
    throw new Error('Erreur mise à jour commande');
  }
}

// Delete order from Supabase (utilise RLS - seuls les admins peuvent supprimer)
export async function deleteOrderFromSupabase(id: string): Promise<void> {
  if (!isSupabaseSyncConfigured()) {
    throw new Error('Supabase non configuré');
  }

  const headers = await getAuthenticatedHeaders();
  const response = await supabaseFetch(`${SUPABASE_URL}/rest/v1/orders?id=eq.${id}`, {
    method: 'DELETE',
    headers,
  });

  if (!response.ok) {
    throw new Error('Erreur suppression commande');
  }
}

// Sync order to Supabase (add or update)
export async function syncOrderToSupabase(order: Order): Promise<void> {
  if (!isSupabaseSyncConfigured()) {
    throw new Error('Supabase non configuré');
  }

  try {
    // Check if order already exists
    const headers = await getAuthenticatedHeaders();
    const response = await supabaseFetch(`${SUPABASE_URL}/rest/v1/orders?id=eq.${order.id}&select=id`, {
      method: 'GET',
      headers,
    });

    // Si la requête échoue avec une erreur de permission, on continue avec l'ajout
    if (!response.ok) {
      const errorText = await response.text();
      if (errorText.includes('42501') || errorText.includes('permission denied') || errorText.includes('42P01')) {
        console.warn('[syncOrderToSupabase] Erreur permissions RLS sur la vérification');
        // On essaie quand même d'ajouter la commande
        await addOrderToSupabase(order);
        return;
      }
      // Autre erreur - on tente quand même l'ajout
      console.warn('[syncOrderToSupabase] Erreur vérification');
      await addOrderToSupabase(order);
      return;
    }

    const existing = await response.json();

    if (existing && existing.length > 0) {
      // Update existing order
      await updateOrderInSupabase(order.id, order);
    } else {
      // Add new order
      await addOrderToSupabase(order);
    }
  } catch (error) {
    // Propager l'erreur pour que le système de file d'attente puisse la gérer
    throw error;
  }
}
