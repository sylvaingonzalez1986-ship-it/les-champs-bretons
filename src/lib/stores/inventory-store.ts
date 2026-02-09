import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Lot, LotItem } from './lots-store';
import type { Rarity } from '../types';

// Inventory Store - for storing won lots from tirage
export type LotType = 'product' | 'discount';

export interface InventoryLot {
  id: string;
  lotId: string;
  name: string;
  description: string;
  rarity: Rarity;
  image: string;
  type: LotType;
  // For product lots
  items?: LotItem[];
  value?: number;
  // For discount lots
  discountPercent?: number;
  discountAmount?: number; // Fixed amount in euros
  minOrderAmount?: number; // Minimum order amount to apply discount
  wonAt: number;
  used: boolean;
  usedAt?: number;
}

interface InventoryStore {
  inventory: InventoryLot[];
  addToInventory: (lot: Lot, type: LotType, discountPercent?: number, discountAmount?: number, minOrderAmount?: number) => void;
  useInventoryLot: (inventoryLotId: string) => void;
  getAvailableLots: () => InventoryLot[];
  getAvailableDiscounts: () => InventoryLot[];
  getAvailableProducts: () => InventoryLot[];
  clearUsedLots: () => void;
}

export const useInventoryStore = create<InventoryStore>()(
  persist(
    (set, get) => ({
      inventory: [],

      addToInventory: (lot: Lot, type: LotType, discountPercent?: number, discountAmount?: number, minOrderAmount?: number) => {
        const inventoryLot: InventoryLot = {
          id: `inv-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          lotId: lot.id,
          name: lot.name,
          description: lot.description,
          rarity: lot.rarity,
          image: lot.image,
          type,
          items: type === 'product' ? lot.items : undefined,
          value: type === 'product' ? lot.value : undefined,
          discountPercent: type === 'discount' ? discountPercent : undefined,
          discountAmount: type === 'discount' ? discountAmount : undefined,
          minOrderAmount: type === 'discount' ? minOrderAmount : undefined,
          wonAt: Date.now(),
          used: false,
        };
        set((state) => ({
          inventory: [inventoryLot, ...state.inventory],
        }));
      },

      useInventoryLot: (inventoryLotId: string) =>
        set((state) => ({
          inventory: state.inventory.map((lot) =>
            lot.id === inventoryLotId
              ? { ...lot, used: true, usedAt: Date.now() }
              : lot
          ),
        })),

      getAvailableLots: () => {
        return get().inventory.filter((lot) => !lot.used);
      },

      getAvailableDiscounts: () => {
        return get().inventory.filter((lot) => !lot.used && lot.type === 'discount');
      },

      getAvailableProducts: () => {
        return get().inventory.filter((lot) => !lot.used && lot.type === 'product');
      },

      clearUsedLots: () =>
        set((state) => ({
          inventory: state.inventory.filter((lot) => !lot.used),
        })),
    }),
    {
      name: 'cbd-inventory-storage',
      storage: createJSONStorage(() => AsyncStorage),
    }
  )
);
