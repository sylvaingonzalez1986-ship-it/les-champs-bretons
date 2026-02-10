import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { CustomerInfo } from './customer-info-store';

// Orders Store - for admin order management
// 1: pending (En attente) - Rouge
// 2: payment_sent (Lien de paiement envoyé) - Orange
// 3: paid (Paiement reçu, préparation) - Jaune
// 4: shipped (Commande envoyée en locker) - Vert
// 5: cancelled (Annulée) - Gris
export type OrderStatus = 'pending' | 'payment_sent' | 'paid' | 'shipped' | 'cancelled';

export const ORDER_STATUS_CONFIG: Record<OrderStatus, {
  label: string;
  color: string;
  step: number;
  description: string;
}> = {
  pending: {
    label: 'En attente',
    color: '#EF4444',
    step: 1,
    description: 'Commande reçue, en attente de traitement'
  },
  payment_sent: {
    label: 'Lien de paiement envoyé',
    color: '#F97316',
    step: 2,
    description: 'Le lien de paiement a été envoyé par email'
  },
  paid: {
    label: 'Paiement reçu',
    color: '#EAB308',
    step: 3,
    description: 'Paiement confirmé, commande en préparation'
  },
  shipped: {
    label: 'Commande expédiée',
    color: '#22C55E',
    step: 4,
    description: 'Commande expédiée avec Mondial Relay'
  },
  cancelled: {
    label: 'Annulée',
    color: '#6B7280',
    step: 0,
    description: 'Commande annulée'
  },
};

export interface OrderItem {
  productId: string;
  productName: string;
  productType: string;
  producerId: string;
  producerName: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  tvaRate?: number; // Taux de TVA en % (défaut: 20)
}

export interface Order {
  id: string;
  customerInfo: CustomerInfo;
  items: OrderItem[];
  subtotal: number;
  shippingFee: number;
  total: number;
  status: OrderStatus;
  trackingNumber?: string;
  createdAt: number;
  updatedAt: number;
  notes?: string;
  // Order type - permet de distinguer les commandes PRO des commandes classiques
  isProOrder?: boolean;
  // Delivery method for local market orders
  deliveryMethod?: 'pickup' | 'shipping';
  // Payment validation fields (optionnels - système simplifié)
  paymentValidated?: boolean;
  paymentValidatedAt?: number;
  paymentValidatedBy?: string;
  ticketsDistributed?: boolean;
  ticketsEarned?: number;
}

interface OrdersStore {
  orders: Order[];
  setOrders: (orders: Order[]) => void;
  addOrder: (order: Omit<Order, 'id' | 'status' | 'createdAt' | 'updatedAt'> & { id?: string }) => string;
  updateOrderStatus: (orderId: string, status: OrderStatus) => void;
  updateOrderNotes: (orderId: string, notes: string) => void;
  updateOrderTrackingNumber: (orderId: string, trackingNumber: string) => void;
  deleteOrder: (orderId: string) => void;
  updateOrderId: (oldId: string, newId: string) => void;
  getOrderById: (orderId: string) => Order | undefined;
  getOrdersByStatus: (status: OrderStatus) => Order[];
  getOrdersByCustomerEmail: (email: string) => Order[];
  // Payment validation
  validatePayment: (orderId: string, validatedBy?: string) => { success: boolean; ticketsDistributed: number };
  markTicketsDistributed: (orderId: string) => void;
}

export const useOrdersStore = create<OrdersStore>()(
  persist(
    (set, get) => ({
      orders: [],

      setOrders: (orders) => set({ orders }),

      addOrder: (orderData) => {
        const orderId = orderData.id ?? `order-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        const now = Date.now();
        const newOrder: Order = {
          ...orderData,
          id: orderId,
          status: 'pending',
          createdAt: now,
          updatedAt: now,
        };
        set((state) => ({
          orders: [newOrder, ...state.orders],
        }));
        return orderId;
      },

      updateOrderStatus: (orderId, status) =>
        set((state) => ({
          orders: state.orders.map((order) =>
            order.id === orderId
              ? { ...order, status, updatedAt: Date.now() }
              : order
          ),
        })),

      updateOrderNotes: (orderId, notes) =>
        set((state) => ({
          orders: state.orders.map((order) =>
            order.id === orderId
              ? { ...order, notes, updatedAt: Date.now() }
              : order
          ),
        })),

      updateOrderTrackingNumber: (orderId, trackingNumber) =>
        set((state) => ({
          orders: state.orders.map((order) =>
            order.id === orderId
              ? { ...order, trackingNumber, updatedAt: Date.now() }
              : order
          ),
        })),

      deleteOrder: (orderId) =>
        set((state) => ({
          orders: state.orders.filter((order) => order.id !== orderId),
        })),

      updateOrderId: (oldId, newId) =>
        set((state) => ({
          orders: state.orders.map((order) =>
            order.id === oldId ? { ...order, id: newId } : order
          ),
        })),

      getOrderById: (orderId) => {
        return get().orders.find((order) => order.id === orderId);
      },

      getOrdersByStatus: (status) => {
        return get().orders.filter((order) => order.status === status);
      },

      getOrdersByCustomerEmail: (email) => {
        return get().orders.filter((order) =>
          order.customerInfo.email.toLowerCase() === email.toLowerCase()
        );
      },

      // Validate payment and mark order as paid
      validatePayment: (orderId, validatedBy) => {
        const order = get().orders.find((o) => o.id === orderId);
        if (!order) {
          return { success: false, ticketsDistributed: 0 };
        }

        // Already validated
        if (order.paymentValidated) {
          return { success: false, ticketsDistributed: 0 };
        }

        const now = Date.now();
        set((state) => ({
          orders: state.orders.map((o) =>
            o.id === orderId
              ? {
                  ...o,
                  paymentValidated: true,
                  paymentValidatedAt: now,
                  paymentValidatedBy: validatedBy,
                  status: 'paid' as OrderStatus,
                  updatedAt: now,
                }
              : o
          ),
        }));

        return { success: true, ticketsDistributed: order.ticketsEarned ?? 0 };
      },

      // Mark tickets as distributed (after notification sent)
      markTicketsDistributed: (orderId) => {
        set((state) => ({
          orders: state.orders.map((order) =>
            order.id === orderId
              ? { ...order, ticketsDistributed: true, updatedAt: Date.now() }
              : order
          ),
        }));
      },
    }),
    {
      name: 'cbd-orders-storage',
      storage: createJSONStorage(() => AsyncStorage),
    }
  )
);
