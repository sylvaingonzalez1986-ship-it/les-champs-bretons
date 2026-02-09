import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Rarity, RARITY_CONFIG } from '../types';

// Lot item - a product in a lot
export interface LotItem {
  productId: string;
  producerId: string;
  productName: string;
  producerName: string;
  quantity: number;
}

// Lot - a mystery box prize
export interface Lot {
  id: string;
  name: string;
  description: string;
  rarity: Rarity;
  image: string;
  items: LotItem[];
  value: number; // Total value in euros
  active: boolean;
  // Type of lot: product (physical items) or discount (reduction on order)
  lotType?: 'product' | 'discount';
  // Discount fields (only for discount type)
  discountPercent?: number;
  discountAmount?: number;
  minOrderAmount?: number;
}

interface LotsStore {
  lots: Lot[];
  addLot: (lot: Lot) => void;
  updateLot: (id: string, updates: Partial<Lot>) => void;
  removeLot: (id: string) => void;
  clearAllLots: () => void;
  toggleLotActive: (id: string) => void;
  addItemToLot: (lotId: string, item: LotItem) => void;
  removeItemFromLot: (lotId: string, productId: string) => void;
  updateItemQuantity: (lotId: string, productId: string, quantity: number) => void;
  getLotsByRarity: (rarity: Rarity) => Lot[];
  getActiveLots: () => Lot[];
  drawRandomLot: () => Lot | null;
}

export const useLotsStore = create<LotsStore>()(
  persist(
    (set, get) => ({
      lots: [],

      addLot: (lot: Lot) =>
        set((state) => ({
          lots: [...state.lots, lot],
        })),

      updateLot: (id: string, updates: Partial<Lot>) =>
        set((state) => ({
          lots: state.lots.map((lot) =>
            lot.id === id ? { ...lot, ...updates } : lot
          ),
        })),

      removeLot: (id: string) =>
        set((state) => ({
          lots: state.lots.filter((lot) => lot.id !== id),
        })),

      clearAllLots: () =>
        set({ lots: [] }),

      toggleLotActive: (id: string) =>
        set((state) => ({
          lots: state.lots.map((lot) =>
            lot.id === id ? { ...lot, active: !lot.active } : lot
          ),
        })),

      addItemToLot: (lotId: string, item: LotItem) =>
        set((state) => ({
          lots: state.lots.map((lot) =>
            lot.id === lotId
              ? { ...lot, items: [...lot.items, item] }
              : lot
          ),
        })),

      removeItemFromLot: (lotId: string, productId: string) =>
        set((state) => ({
          lots: state.lots.map((lot) =>
            lot.id === lotId
              ? { ...lot, items: lot.items.filter((i) => i.productId !== productId) }
              : lot
          ),
        })),

      updateItemQuantity: (lotId: string, productId: string, quantity: number) =>
        set((state) => ({
          lots: state.lots.map((lot) =>
            lot.id === lotId
              ? {
                  ...lot,
                  items: lot.items.map((i) =>
                    i.productId === productId ? { ...i, quantity } : i
                  ),
                }
              : lot
          ),
        })),

      getLotsByRarity: (rarity: Rarity) => {
        return get().lots.filter((lot) => lot.rarity === rarity && lot.active);
      },

      getActiveLots: () => {
        return get().lots.filter((lot) => lot.active);
      },

      drawRandomLot: () => {
        const activeLots = get().lots.filter((lot) => lot.active);
        if (activeLots.length === 0) return null;

        // Calculate total probability
        const random = Math.random() * 100;
        let cumulative = 0;

        // Determine rarity based on probability
        let selectedRarity: Rarity = 'common';
        for (const [rarity, config] of Object.entries(RARITY_CONFIG)) {
          cumulative += config.probability;
          if (random <= cumulative) {
            selectedRarity = rarity as Rarity;
            break;
          }
        }

        // Get lots of selected rarity
        const lotsOfRarity = activeLots.filter((lot) => lot.rarity === selectedRarity);

        // If no lots of that rarity, fall back to any active lot
        const eligibleLots = lotsOfRarity.length > 0 ? lotsOfRarity : activeLots;

        // Random selection from eligible lots
        const randomIndex = Math.floor(Math.random() * eligibleLots.length);
        return eligibleLots[randomIndex] ?? null;
      },
    }),
    {
      name: 'cbd-lots-storage',
      storage: createJSONStorage(() => AsyncStorage),
    }
  )
);
