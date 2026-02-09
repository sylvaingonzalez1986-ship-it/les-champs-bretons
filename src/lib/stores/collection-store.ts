import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { CollectionItem, CBDProduct } from '../types';

interface CollectionStore {
  collection: CollectionItem[];
  totalSpins: number;
  addToCollection: (product: CBDProduct, lotInfo?: {
    lotId: string;
    lotType: 'product' | 'discount';
    discountPercent?: number;
    discountAmount?: number;
    minOrderAmount?: number;
  }) => void;
  useCollectionItem: (itemId: string) => void;
  getAvailableItems: () => CollectionItem[];
  getAvailableDiscounts: () => CollectionItem[];
  getAvailableProducts: () => CollectionItem[];
  incrementSpins: () => void;
  clearCollection: () => void;
  resetStore: () => void; // Reset pour changement d'utilisateur
}

export const useCollectionStore = create<CollectionStore>()(
  persist(
    (set, get) => ({
      collection: [],
      totalSpins: 0,
      addToCollection: (product: CBDProduct, lotInfo?: {
        lotId: string;
        lotType: 'product' | 'discount';
        discountPercent?: number;
        discountAmount?: number;
        minOrderAmount?: number;
      }) => {
        const newItem = {
          id: `${product.id}-${Date.now()}`,
          product,
          obtainedAt: new Date(),
          used: false,
          lotId: lotInfo?.lotId,
          lotType: lotInfo?.lotType,
          discountPercent: lotInfo?.discountPercent,
          discountAmount: lotInfo?.discountAmount,
          minOrderAmount: lotInfo?.minOrderAmount,
        };

        // Get the current collection before update
        const currentCollection = get().collection;
        const newCollection = [newItem, ...currentCollection];

        // Update the store
        set({ collection: newCollection });
      },
      useCollectionItem: (itemId: string) =>
        set((state) => ({
          collection: state.collection.filter((item) => item.id !== itemId),
        })),
      getAvailableItems: () => {
        return get().collection.filter((item) => !item.used);
      },
      getAvailableDiscounts: () => {
        return get().collection.filter((item) => !item.used && item.lotType === 'discount');
      },
      getAvailableProducts: () => {
        return get().collection.filter((item) => !item.used && item.lotType !== 'discount');
      },
      incrementSpins: () =>
        set((state) => ({ totalSpins: state.totalSpins + 1 })),
      clearCollection: () => set({ collection: [] }),
      resetStore: () => set({ collection: [], totalSpins: 0 }),
    }),
    {
      name: 'cbd-collection-storage',
      storage: createJSONStorage(() => AsyncStorage),
    }
  )
);
