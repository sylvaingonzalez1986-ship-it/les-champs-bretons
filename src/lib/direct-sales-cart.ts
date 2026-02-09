import { create } from 'zustand';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '@/lib/supabase-auth';
import { isSupabaseConfigured, getSupabaseConfig } from './env-validation';
import { startMetric, endMetric, incrementMetric } from './perf-metrics';
import { ensureDeviceId } from './device-id';

// Helper pour obtenir la config de manière sécurisée
const getConfig = () => {
  if (isSupabaseConfigured()) {
    return getSupabaseConfig();
  }
  // Fallback sur les imports existants pour compatibilité
  return { url: SUPABASE_URL, anonKey: SUPABASE_ANON_KEY };
};

const getMutationHeaders = async (accessToken: string) => {
  const deviceId = await ensureDeviceId();
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${accessToken}`,
    'X-Device-Id': deviceId,
  };
};

export interface DirectSalesCartItem {
  id: string;
  product_id: string;
  producer_id: string;
  producer_name: string;
  product_name: string;
  price: number;
  quantity: number;
  image: string;
  created_at: string;
}

interface DirectSalesCartApiItem {
  id: string;
  product_id: string;
  producer_id: string;
  quantity: number;
  created_at: string;
  product: { id: string; name: string; price_public: number; image: string } | { id: string; name: string; price_public: number; image: string }[] | null;
  producer: { id: string; name: string } | { id: string; name: string }[] | null;
}

interface DirectSalesCartStore {
  items: DirectSalesCartItem[];
  loading: boolean;

  // Actions
  loadCart: (userId: string, accessToken: string) => Promise<void>;
  addItem: (userId: string, accessToken: string, item: Omit<DirectSalesCartItem, 'id' | 'created_at'>) => Promise<void>;
  removeItem: (userId: string, accessToken: string, id: string) => Promise<void>;
  updateQuantity: (userId: string, accessToken: string, id: string, quantity: number) => Promise<void>;
  clearCart: (userId: string, accessToken: string) => Promise<void>;
  createOrders: (userId: string, accessToken: string) => Promise<{ success: boolean; orderIds?: string[]; error?: string }>;

  // Computed
  getTotalByProducer: (producerId: string) => number;
  getProducerIds: () => string[];
  getItemsByProducer: (producerId: string) => DirectSalesCartItem[];
  getGrandTotal: () => number;
  getProducersWithInsufficientAmount: () => { producerId: string; producerName: string; amount: number }[];
  isMinimumMet: () => boolean;
}

export const useDirectSalesCart = create<DirectSalesCartStore>((set, get) => ({
  items: [],
  loading: false,

  // Charger le panier depuis Supabase
  loadCart: async (userId: string, accessToken: string) => {
    try {
      const metricStart = startMetric('cart.load');
      set({ loading: true });

      if (!userId) {
        set({ items: [], loading: false });
        return;
      }

      const response = await fetch(
        `${SUPABASE_URL}/rest/v1/panier_vente_directe?user_id=eq.${userId}&select=id,product_id,producer_id,quantity,created_at,product:products(id,name,price_public,image),producer:producers(id,name)&order=created_at.desc`,
        {
          headers: {
            'Content-Type': 'application/json',
            apikey: SUPABASE_ANON_KEY,
            Authorization: `Bearer ${accessToken}`,
          },
        }
      );

      if (response.ok) {
        const data = (await response.json()) as DirectSalesCartApiItem[];

        const enrichedItems: DirectSalesCartItem[] = [];
        let orphanedItemsCount = 0;

        for (const item of data) {
          const product = Array.isArray(item.product) ? item.product[0] : item.product;
          const producer = Array.isArray(item.producer) ? item.producer[0] : item.producer;

          // Skip items with missing product or invalid price (orphaned items)
          if (!product || typeof product.price_public !== 'number' || product.price_public <= 0) {
            console.warn('[DirectSalesCart] Skipping orphaned item with missing/invalid product:', item.id);
            orphanedItemsCount++;
            continue;
          }

          // Skip items with missing producer
          if (!producer) {
            console.warn('[DirectSalesCart] Skipping item with missing producer:', item.id);
            orphanedItemsCount++;
            continue;
          }

          enrichedItems.push({
            id: item.id,
            product_id: item.product_id,
            producer_id: item.producer_id,
            producer_name: producer.name || 'Producteur inconnu',
            product_name: product.name || 'Produit inconnu',
            price: product.price_public,
            quantity: item.quantity,
            image: product.image || '',
            created_at: item.created_at,
          });
        }

        if (orphanedItemsCount > 0) {
          console.warn(`[DirectSalesCart] ${orphanedItemsCount} orphaned items filtered from cart`);
        }

        set({ items: enrichedItems });
        endMetric('cart.load', metricStart, { items: enrichedItems.length, orphaned: orphanedItemsCount });
      }
    } catch (error) {
      console.warn('[DirectSalesCart] Error loading cart:', error);
    } finally {
      set({ loading: false });
    }
  },

  // Ajouter un item au panier
  addItem: async (userId: string, accessToken: string, item) => {
    try {
      if (!userId) return;

      const response = await fetch(
        `${SUPABASE_URL}/functions/v1/direct-sales-cart-mutations`,
        {
          method: 'POST',
          headers: await getMutationHeaders(accessToken),
          body: JSON.stringify({
            action: 'addItem',
            item: {
              productId: item.product_id,
              producerId: item.producer_id,
              quantity: item.quantity,
            },
          }),
        }
      );

      if (response.ok) {
        // Recharger le panier
        await get().loadCart(userId, accessToken);
      }
    } catch (error) {
      console.warn('[DirectSalesCart] Error adding item:', error);
    }
  },

  // Supprimer un item
  removeItem: async (userId: string, accessToken: string, id: string) => {
    try {
      if (!userId) return;

      const response = await fetch(
        `${SUPABASE_URL}/functions/v1/direct-sales-cart-mutations`,
        {
          method: 'POST',
          headers: await getMutationHeaders(accessToken),
          body: JSON.stringify({
            action: 'removeItem',
            itemId: id,
          }),
        }
      );

      // Only update local state if server confirms success
      if (response.ok) {
        set({ items: get().items.filter((item) => item.id !== id) });
      } else {
        console.warn('[DirectSalesCart] Server rejected removeItem, reloading cart');
        await get().loadCart(userId, accessToken);
      }
    } catch (error) {
      console.warn('[DirectSalesCart] Error removing item:', error);
      // Reload cart to ensure consistency
      await get().loadCart(userId, accessToken);
    }
  },

  // Modifier la quantité
  updateQuantity: async (userId: string, accessToken: string, id: string, quantity: number) => {
    try {
      if (quantity <= 0) {
        await get().removeItem(userId, accessToken, id);
        return;
      }

      if (!userId) return;

      const response = await fetch(
        `${SUPABASE_URL}/functions/v1/direct-sales-cart-mutations`,
        {
          method: 'POST',
          headers: await getMutationHeaders(accessToken),
          body: JSON.stringify({
            action: 'updateQuantity',
            itemId: id,
            quantity,
          }),
        }
      );

      // Only update local state if server confirms success
      if (response.ok) {
        set({
          items: get().items.map((item) =>
            item.id === id ? { ...item, quantity } : item
          ),
        });
      } else {
        console.warn('[DirectSalesCart] Server rejected updateQuantity, reloading cart');
        await get().loadCart(userId, accessToken);
      }
    } catch (error) {
      console.warn('[DirectSalesCart] Error updating quantity:', error);
      // Reload cart to ensure consistency
      await get().loadCart(userId, accessToken);
    }
  },

  // Vider le panier
  clearCart: async (userId: string, accessToken: string) => {
    try {
      if (!userId) return;

      const response = await fetch(
        `${SUPABASE_URL}/functions/v1/direct-sales-cart-mutations`,
        {
          method: 'POST',
          headers: await getMutationHeaders(accessToken),
          body: JSON.stringify({
            action: 'clearCart',
          }),
        }
      );

      // Only update local state if server confirms success
      if (response.ok) {
        set({ items: [] });
      } else {
        console.warn('[DirectSalesCart] Server rejected clearCart, reloading cart');
        await get().loadCart(userId, accessToken);
      }
    } catch (error) {
      console.warn('[DirectSalesCart] Error clearing cart:', error);
      // Reload cart to ensure consistency
      await get().loadCart(userId, accessToken);
    }
  },

  // Créer les commandes pour chaque producteur
  createOrders: async (userId: string, accessToken: string) => {
    try {
      const metricStart = startMetric('orders.create');
      if (!userId) {
        return { success: false, error: 'User not authenticated' };
      }

      const producerIds = get().getProducerIds();

      if (producerIds.length === 0) {
        return { success: false, error: 'Cart is empty' };
      }

      // Vérifier que le minimum est atteint
      if (!get().isMinimumMet()) {
        return { success: false, error: 'Minimum amount not met for some producers' };
      }

      const items = get().items.map((item) => ({
        productId: item.product_id,
        producerId: item.producer_id,
        quantity: item.quantity,
      }));

      const response = await fetch(
        `${SUPABASE_URL}/functions/v1/create-direct-sale-orders`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${accessToken}`,
          },
          body: JSON.stringify({ items }),
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        return { success: false, error: errorText || 'Failed to create orders' };
      }

      const result = await response.json();
      const orderIds: string[] = Array.isArray(result?.orderIds) ? result.orderIds : [];
      incrementMetric('orders.created', orderIds.length || 0);
      endMetric('orders.create', metricStart, { orders: orderIds.length || 0 });

      // Vider le panier après succès
      if (orderIds.length > 0) {
        await get().clearCart(userId, accessToken);
      }

      return {
        success: orderIds.length > 0,
        orderIds: orderIds.length > 0 ? orderIds : undefined,
        error: orderIds.length === 0 ? 'Failed to create any orders' : undefined,
      };
    } catch (error) {
      console.warn('[DirectSalesCart] Error in createOrders:', error);
      return { success: false, error: 'An error occurred while creating orders' };
    }
  },

  // Calculer le total par producteur
  getTotalByProducer: (producerId: string) => {
    return get()
      .items.filter((item) => item.producer_id === producerId)
      .reduce((sum, item) => sum + item.price * item.quantity, 0);
  },

  // Récupérer les IDs des producteurs
  getProducerIds: () => {
    return [...new Set(get().items.map((item) => item.producer_id))];
  },

  // Récupérer les items par producteur
  getItemsByProducer: (producerId: string) => {
    return get().items.filter((item) => item.producer_id === producerId);
  },

  // Calculer le grand total
  getGrandTotal: () => {
    return get().items.reduce((sum, item) => sum + item.price * item.quantity, 0);
  },

  // Récupérer les producteurs avec montant insuffisant
  getProducersWithInsufficientAmount: () => {
    const result: { producerId: string; producerName: string; amount: number }[] = [];
    const producerIds = get().getProducerIds();

    producerIds.forEach((producerId) => {
      const items = get().getItemsByProducer(producerId);
      const amount = get().getTotalByProducer(producerId);

      if (amount < 20) {
        result.push({
          producerId,
          producerName: items[0]?.producer_name || 'Unknown',
          amount,
        });
      }
    });

    return result;
  },

  // Vérifier si le minimum est atteint pour tous les producteurs
  isMinimumMet: () => {
    const producerIds = get().getProducerIds();
    if (producerIds.length === 0) return false;

    return producerIds.every((producerId) => {
      const total = get().getTotalByProducer(producerId);
      return total >= 20;
    });
  },
}));
