/**
 * Order Queue Store - Les Chanvriers Unis
 * Système de file d'attente pour les commandes en échec réseau
 * Permet de sauvegarder localement et resync au retour du réseau
 */

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Order } from './store';
import { syncOrderToSupabase, isSupabaseSyncConfigured } from './supabase-sync';
import NetInfo from '@react-native-community/netinfo';

// Structure d'une commande en attente
export interface PendingOrder {
  id: string;
  order: Order;
  createdAt: number;
  lastAttempt: number;
  attemptCount: number;
  error?: string;
  status: 'pending' | 'syncing' | 'failed' | 'synced';
}

// État du store
interface OrderQueueState {
  pendingOrders: PendingOrder[];
  isSyncing: boolean;
  lastSyncAttempt: number | null;

  // Actions
  addPendingOrder: (order: Order) => void;
  removePendingOrder: (orderId: string) => void;
  updateOrderStatus: (orderId: string, status: PendingOrder['status'], error?: string) => void;
  syncPendingOrders: () => Promise<{ success: number; failed: number }>;
  clearSyncedOrders: () => void;
  getPendingCount: () => number;
  getFailedCount: () => number;
}

export const useOrderQueueStore = create<OrderQueueState>()(
  persist(
    (set, get) => ({
      pendingOrders: [],
      isSyncing: false,
      lastSyncAttempt: null,

      addPendingOrder: (order: Order) => {
        const pendingOrder: PendingOrder = {
          id: order.id,
          order,
          createdAt: Date.now(),
          lastAttempt: Date.now(),
          attemptCount: 0,
          status: 'pending',
        };

        set((state) => ({
          pendingOrders: [...state.pendingOrders, pendingOrder],
        }));
      },

      removePendingOrder: (orderId: string) => {
        set((state) => ({
          pendingOrders: state.pendingOrders.filter((p) => p.id !== orderId),
        }));
      },

      updateOrderStatus: (orderId: string, status: PendingOrder['status'], error?: string) => {
        set((state) => ({
          pendingOrders: state.pendingOrders.map((p) =>
            p.id === orderId
              ? {
                  ...p,
                  status,
                  error,
                  lastAttempt: Date.now(),
                  attemptCount: p.attemptCount + 1,
                }
              : p
          ),
        }));
      },

      syncPendingOrders: async () => {
        const state = get();

        // Ne pas synchroniser si déjà en cours
        if (state.isSyncing) {
          return { success: 0, failed: 0 };
        }

        // Vérifier la connexion réseau
        const netInfo = await NetInfo.fetch();
        if (!netInfo.isConnected) {
          return { success: 0, failed: 0 };
        }

        // Vérifier si Supabase est configuré
        if (!isSupabaseSyncConfigured()) {
          return { success: 0, failed: 0 };
        }

        const pendingToSync = state.pendingOrders.filter(
          (p) => p.status === 'pending' || p.status === 'failed'
        );

        if (pendingToSync.length === 0) {
          return { success: 0, failed: 0 };
        }

        set({ isSyncing: true, lastSyncAttempt: Date.now() });

        let success = 0;
        let failed = 0;

        for (const pending of pendingToSync) {
          try {
            // Marquer comme en cours de sync
            get().updateOrderStatus(pending.id, 'syncing');

            // Tenter la synchronisation
            await syncOrderToSupabase(pending.order);

            // Succès
            get().updateOrderStatus(pending.id, 'synced');
            success++;
          } catch (error) {
            // Échec
            const errorMessage = error instanceof Error ? error.message : 'Erreur inconnue';

            // Si c'est une erreur de permissions RLS, on log moins agressivement
            if (errorMessage.includes('permissions Supabase') || errorMessage.includes('RLS')) {
              get().updateOrderStatus(pending.id, 'failed', errorMessage);
              failed++;
              console.warn(`[OrderQueue] Commande ${pending.id}: Migration SQL requise`);
            } else {
              get().updateOrderStatus(pending.id, 'failed', errorMessage);
              failed++;
              console.error(`[OrderQueue] Échec sync commande ${pending.id}:`, errorMessage);
            }
          }
        }

        set({ isSyncing: false });

        return { success, failed };
      },

      clearSyncedOrders: () => {
        set((state) => ({
          pendingOrders: state.pendingOrders.filter((p) => p.status !== 'synced'),
        }));
      },

      getPendingCount: () => {
        return get().pendingOrders.filter(
          (p) => p.status === 'pending' || p.status === 'failed'
        ).length;
      },

      getFailedCount: () => {
        return get().pendingOrders.filter((p) => p.status === 'failed').length;
      },
    }),
    {
      name: 'order-queue-storage',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({
        pendingOrders: state.pendingOrders,
        lastSyncAttempt: state.lastSyncAttempt,
      }),
    }
  )
);

// Hook pour la resync automatique au retour du réseau
let unsubscribeNetInfo: (() => void) | null = null;

export function setupOrderQueueNetworkListener() {
  if (unsubscribeNetInfo) return; // Déjà configuré

  unsubscribeNetInfo = NetInfo.addEventListener((state) => {
    if (state.isConnected && state.isInternetReachable) {
      const pendingCount = useOrderQueueStore.getState().getPendingCount();
      if (pendingCount > 0) {
        // Petite attente pour laisser le réseau se stabiliser
        setTimeout(() => {
          useOrderQueueStore.getState().syncPendingOrders();
        }, 2000);
      }
    }
  });
}

export function cleanupOrderQueueNetworkListener() {
  if (unsubscribeNetInfo) {
    unsubscribeNetInfo();
    unsubscribeNetInfo = null;
  }
}
