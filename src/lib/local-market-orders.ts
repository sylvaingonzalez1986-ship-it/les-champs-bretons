/**
 * Local Market Orders - Les Chanvriers Unis
 * Gestion des commandes directes auprès des producteurs locaux
 * Système séparé du panier boutique en ligne
 */

import { create } from 'zustand';
import { SUPABASE_URL, SUPABASE_ANON_KEY, getValidSession } from '@/lib/supabase-auth';

// Types pour les commandes Marché Local
export interface LocalMarketOrder {
  id: string | number;
  created_at: string;
  updated_at: string;

  // Client
  customer_id: string;
  customer_name: string;
  customer_email: string;
  customer_phone: string | null;

  // Producteur
  producer_id: string;
  producer_name: string;
  producer_email: string;
  producer_phone: string | null;
  producer_location: string | null;

  // Produit
  product_id: string;
  product_name: string;
  product_description: string | null;
  quantity: number;
  unit_price: number;
  total_amount: number;

  // Statut
  status: 'pending' | 'confirmed' | 'ready' | 'completed' | 'cancelled';

  // Code de retrait
  pickup_code: string;

  // Coordonnées du retrait
  pickup_date: string | null;
  pickup_location: string | null;
  pickup_instructions: string | null;

  // Livraison
  delivery_method: 'pickup' | 'shipping';
  delivery_fee: number | null;
  delivery_address: string | null;
  delivery_instructions: string | null;

  // Notes
  customer_notes: string | null;
  producer_notes: string | null;

  // Paiement
  is_paid: boolean;
  payment_method: string | null;
  completed_at: string | null;
}

export interface CreateLocalOrderParams {
  // Infos client
  customer_name: string;
  customer_email: string;
  customer_phone?: string;

  // Infos producteur
  producer_id: string;
  producer_name: string;
  producer_email: string;
  producer_phone?: string;
  producer_location?: string;

  // Infos produit
  product_id: string;
  product_name: string;
  product_description?: string;
  quantity: number;
  unit_price: number;

  // Infos retrait
  pickup_location?: string;
  pickup_instructions?: string;

  // Livraison
  delivery_method?: 'pickup' | 'shipping';
  delivery_fee?: number;
  delivery_address?: string;
  delivery_instructions?: string;

  // Notes
  customer_notes?: string;
}

interface LocalMarketOrdersStore {
  orders: LocalMarketOrder[];
  loading: boolean;
  error: string | null;

  // Actions
  loadOrders: (
    userId: string,
    accessToken: string,
    options?: { limit?: number; offset?: number; append?: boolean }
  ) => Promise<LocalMarketOrder[]>;
  loadOrdersForProducer: (
    producerId: string,
    accessToken: string,
    options?: { limit?: number; offset?: number }
  ) => Promise<LocalMarketOrder[]>;
  createOrder: (
    userId: string,
    accessToken: string,
    params: CreateLocalOrderParams
  ) => Promise<{ success: boolean; order?: LocalMarketOrder; pickupCode?: string; error?: string }>;
  getOrderByPickupCode: (
    accessToken: string,
    pickupCode: string
  ) => Promise<LocalMarketOrder | null>;
  cancelOrder: (
    userId: string,
    accessToken: string,
    orderId: string
  ) => Promise<{ success: boolean; error?: string }>;
  updateOrderStatus: (
    accessToken: string,
    orderId: string,
    status: LocalMarketOrder['status'],
    producerNotes?: string
  ) => Promise<{ success: boolean; error?: string }>;
}

// Store Zustand pour les commandes Marché Local
export const useLocalMarketOrders = create<LocalMarketOrdersStore>((set, get) => ({
  orders: [],
  loading: false,
  error: null,

  // Charger les commandes de l'utilisateur
  loadOrders: async (userId: string, accessToken: string, options) => {
    if (!userId || !accessToken) {
      set({ orders: [], loading: false });
      return [];
    }

    set({ loading: true, error: null });

    try {
      const { limit, offset, append } = options ?? {};
      // Construire l'URL avec les paramètres de requête
      let url = `${SUPABASE_URL}/rest/v1/local_market_orders?customer_id=eq.${userId}&order=created_at.desc&select=*`;
      if (typeof limit === 'number') {
        url += `&limit=${limit}`;
      }
      if (typeof offset === 'number') {
        url += `&offset=${offset}`;
      }

      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'apikey': SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${accessToken}`,
          'Prefer': 'return=representation',
        },
      });

      const responseText = await response.text();
      if (!response.ok) {
        // Gérer les erreurs spécifiques
        if (response.status === 401) {
          set({ orders: [], loading: false, error: 'Session expirée, veuillez vous reconnecter' });
        } else if (response.status === 404 || response.status === 400) {
          // Table n'existe peut-être pas encore ou erreur de requête - pas une erreur critique pour l'utilisateur
          set({ orders: [], loading: false, error: null });
        } else if (response.status === 403) {
          // Erreur RLS - l'utilisateur n'a pas les permissions
          set({ orders: [], loading: false, error: null });
        } else {
          set({ orders: [], loading: false, error: `Erreur ${response.status}` });
        }
          return [];
      }

      // Parser la réponse JSON
      let data: LocalMarketOrder[] = [];
      try {
        data = responseText ? JSON.parse(responseText) : [];
      } catch (parseError) {
        set({ orders: [], loading: false, error: 'Erreur de format des données' });
        return [];
      }

      const MAX_ORDERS = 200;
      set((state) => {
        const merged = append ? [...state.orders, ...data] : data;
        return {
          orders: merged.length > MAX_ORDERS ? merged.slice(0, MAX_ORDERS) : merged,
          loading: false,
          error: null,
        };
      });
      return data;
    } catch (error) {
      set({ orders: [], loading: false, error: 'Erreur de connexion au serveur' });
      return [];
    }
  },

  // Créer une nouvelle commande
  createOrder: async (userId, accessToken, params) => {
    if (!userId || !accessToken) {
      return { success: false, error: 'Utilisateur non connecté' };
    }

    try {
      const response = await fetch(
        `${SUPABASE_URL}/functions/v1/local-market-orders`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${accessToken}`,
          },
          body: JSON.stringify({
            action: 'create',
            producerId: params.producer_id,
            productId: params.product_id,
            quantity: params.quantity,
            pickupLocation: params.pickup_location,
            pickupInstructions: params.pickup_instructions,
            deliveryMethod: params.delivery_method,
            deliveryFee: params.delivery_fee,
            deliveryAddress: params.delivery_address,
            deliveryInstructions: params.delivery_instructions,
            customerNotes: params.customer_notes,
            customerName: params.customer_name,
            customerEmail: params.customer_email,
            customerPhone: params.customer_phone,
          }),
        }
      );

      const responseText = await response.text();

      if (!response.ok) {
        let errorMessage = 'Erreur lors de la création de la commande';
        try {
          const errorData = JSON.parse(responseText);
          const parts: string[] = [];
          if (errorData.error) parts.push(errorData.error);
          if (errorData.details) parts.push(errorData.details);
          if (errorData.producerId) parts.push(`producerId: ${errorData.producerId}`);
          if (errorData.message) parts.push(errorData.message);
          if (parts.length > 0) errorMessage = parts.join(' — ');
        } catch (e) {
          // Réponse non-JSON
        }

        console.warn('[createOrder] Error:', errorMessage, 'status:', response.status);
        return { success: false, error: errorMessage };
      }

      let createdOrder: LocalMarketOrder;
      let pickupCode = '';
      try {
        const data = JSON.parse(responseText);
        createdOrder = data.order as LocalMarketOrder;
        pickupCode = data.pickupCode || createdOrder?.pickup_code || '';
      } catch (parseError) {
        return { success: false, error: 'Erreur de format de réponse' };
      }

      // Mettre à jour la liste locale des commandes
      set((state) => ({
        orders: [createdOrder, ...state.orders],
      }));

      // Envoyer l'email au producteur
      try {
        await sendLocalMarketOrderEmail(accessToken, createdOrder);
      } catch (emailError) {
        // Ne pas faire échouer la commande si l'email échoue
      }

      return {
        success: true,
        order: createdOrder,
        pickupCode: createdOrder.pickup_code || pickupCode,
      };
    } catch (error) {
      return { success: false, error: 'Erreur de connexion' };
    }
  },

  // Récupérer une commande par code de retrait
  getOrderByPickupCode: async (accessToken, pickupCode) => {
    try {
      const response = await fetch(
        `${SUPABASE_URL}/functions/v1/local-market-orders`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${accessToken}`,
          },
          body: JSON.stringify({
            action: 'getByPickupCode',
            pickupCode,
          }),
        }
      );

      if (!response.ok) {
        return null;
      }

      const data = await response.json();
      return data.order || null;
    } catch (error) {
      return null;
    }
  },

  // Annuler une commande
  cancelOrder: async (userId, accessToken, orderId) => {
    if (!userId || !accessToken) {
      return { success: false, error: 'Utilisateur non connecté' };
    }

    try {
      const response = await fetch(
        `${SUPABASE_URL}/functions/v1/local-market-orders`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${accessToken}`,
          },
          body: JSON.stringify({
            action: 'cancel',
            orderId,
          }),
        }
      );

      if (!response.ok) {
        return { success: false, error: 'Erreur lors de l\'annulation' };
      }

      // Mettre à jour la liste locale
      set((state) => ({
        orders: state.orders.map((order) =>
          order.id === orderId ? { ...order, status: 'cancelled' as const } : order
        ),
      }));

      return { success: true };
    } catch (error) {
      return { success: false, error: 'Erreur de connexion' };
    }
  },

  // Charger les commandes pour un producteur
  loadOrdersForProducer: async (producerId: string, accessToken: string, options) => {
    if (!producerId) {
      return [];
    }

    try {
      // Utiliser getValidSession pour s'assurer d'avoir un token valide
      const session = await getValidSession();
      const validToken = session?.access_token || accessToken;

      if (!validToken) {
        return [];
      }

      const { limit, offset } = options ?? {};
      let url = `${SUPABASE_URL}/rest/v1/local_market_orders?producer_id=eq.${producerId}&order=created_at.desc&select=*`;
      if (typeof limit === 'number') {
        url += `&limit=${limit}`;
      }
      if (typeof offset === 'number') {
        url += `&offset=${offset}`;
      }

      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'apikey': SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${validToken}`,
        },
      });

      const responseText = await response.text();

      if (!response.ok) {
        return [];
      }

      const data = responseText ? JSON.parse(responseText) : [];
      return data as LocalMarketOrder[];
    } catch (error) {
      return [];
    }
  },

  // Mettre à jour le statut d'une commande (pour producteur)
  updateOrderStatus: async (accessToken: string, orderId: string, status: LocalMarketOrder['status'], producerNotes?: string) => {
    if (!orderId) {
      return { success: false, error: 'Paramètres manquants' };
    }

    try {
      const session = await getValidSession();
      const validToken = session?.access_token || accessToken;

      if (!validToken) {
        return { success: false, error: 'Session expirée' };
      }

      const response = await fetch(
        `${SUPABASE_URL}/functions/v1/local-market-orders`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${validToken}`,
          },
          body: JSON.stringify({
            action: 'updateStatus',
            orderId,
            status,
            producerNotes,
          }),
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        console.warn('[LocalMarketOrders] Error updating order status:', response.status, errorText);
        return { success: false, error: 'Erreur lors de la mise à jour' };
      }
      return { success: true };
    } catch (error) {
      console.warn('[LocalMarketOrders] Update failed:', error);
      return { success: false, error: 'Erreur de connexion' };
    }
  },
}));

// Fonction pour envoyer l'email au producteur via Edge Function
async function sendLocalMarketOrderEmail(
  accessToken: string,
  order: LocalMarketOrder
): Promise<void> {
  try {
    const response = await fetch(
      `${SUPABASE_URL}/functions/v1/send-local-market-order-email`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          orderId: order.id,
          producerEmail: order.producer_email,
          producerName: order.producer_name,
          customerName: order.customer_name,
          customerEmail: order.customer_email,
          customerPhone: order.customer_phone || undefined,
          productName: order.product_name,
          quantity: order.quantity,
          unitPrice: order.unit_price,
          totalAmount: order.total_amount,
          pickupCode: order.pickup_code,
          pickupLocation: order.pickup_location || undefined,
          pickupInstructions: order.pickup_instructions || undefined,
          deliveryMethod: order.delivery_method || 'pickup',
          deliveryFee: order.delivery_fee ?? 0,
          deliveryAddress: order.delivery_address || undefined,
          deliveryInstructions: order.delivery_instructions || undefined,
          customerNotes: order.customer_notes || undefined,
        }),
      }
    );

    if (!response.ok) {
    }
  } catch (error) {
  }
}

// Helper pour afficher le statut en français
export function getStatusLabel(status: LocalMarketOrder['status']): string {
  const labels: Record<LocalMarketOrder['status'], string> = {
    pending: 'En attente',
    confirmed: 'Confirmée',
    ready: 'Prête',
    completed: 'Terminée',
    cancelled: 'Annulée',
  };
  return labels[status] || status;
}

// Helper pour obtenir la couleur du statut
export function getStatusColor(status: LocalMarketOrder['status']): string {
  const colors: Record<LocalMarketOrder['status'], string> = {
    pending: '#F59E0B',     // Jaune/Orange
    confirmed: '#3B82F6',   // Bleu
    ready: '#10B981',       // Vert
    completed: '#6B7280',   // Gris
    cancelled: '#EF4444',   // Rouge
  };
  return colors[status] || '#6B7280';
}
