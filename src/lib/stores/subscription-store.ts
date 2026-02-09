import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Subscription types
export type SubscriptionTier = 'none' | 'basic' | 'premium' | 'vip';

export const SUBSCRIPTION_CONFIG: Record<SubscriptionTier, {
  name: string;
  price: number;
  ticketsPerMonth: number;
  color: string;
}> = {
  none: {
    name: 'Aucun',
    price: 0,
    ticketsPerMonth: 0,
    color: '#6B7280',
  },
  basic: {
    name: 'Basic',
    price: 30,
    ticketsPerMonth: 1,
    color: '#3B82F6',
  },
  premium: {
    name: 'Premium',
    price: 60,
    ticketsPerMonth: 2,
    color: '#8B5CF6',
  },
  vip: {
    name: 'VIP',
    price: 90,
    ticketsPerMonth: 3,
    color: '#F59E0B',
  },
};

interface SubscriptionStore {
  subscription: SubscriptionTier;
  tickets: number;
  lastTicketRefresh: string | null; // ISO date string
  setSubscription: (tier: SubscriptionTier) => void;
  useTicket: () => boolean;
  addTickets: (amount: number) => void;
  refreshTickets: () => void;
  resetStore: () => void; // Reset pour changement d'utilisateur
}

export const useSubscriptionStore = create<SubscriptionStore>()(
  persist(
    (set, get) => ({
      subscription: 'none',
      tickets: 0,
      lastTicketRefresh: null,

      setSubscription: (tier: SubscriptionTier) => {
        const config = SUBSCRIPTION_CONFIG[tier];
        set({
          subscription: tier,
          tickets: config.ticketsPerMonth,
          lastTicketRefresh: new Date().toISOString(),
        });
      },

      useTicket: () => {
        const state = get();
        if (state.tickets <= 0) return false;
        set({ tickets: state.tickets - 1 });
        return true;
      },

      addTickets: (amount: number) =>
        set((state) => ({
          tickets: state.tickets + amount,
        })),

      refreshTickets: () => {
        const state = get();
        if (state.subscription === 'none') return;

        const now = new Date();
        const lastRefresh = state.lastTicketRefresh ? new Date(state.lastTicketRefresh) : null;

        // Check if a month has passed since last refresh
        if (!lastRefresh ||
            now.getMonth() !== lastRefresh.getMonth() ||
            now.getFullYear() !== lastRefresh.getFullYear()) {
          const config = SUBSCRIPTION_CONFIG[state.subscription];
          set({
            tickets: config.ticketsPerMonth,
            lastTicketRefresh: now.toISOString(),
          });
        }
      },

      resetStore: () => {
        set({
          subscription: 'none',
          tickets: 0,
          lastTicketRefresh: null,
        });
      },
    }),
    {
      name: 'cbd-subscription-storage',
      storage: createJSONStorage(() => AsyncStorage),
    }
  )
);
