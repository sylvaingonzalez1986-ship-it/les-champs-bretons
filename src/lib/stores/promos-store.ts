import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Promo Store - for managing promotions
export interface Promo {
  id: string;
  title: string;
  description: string;
  code: string;
  discount: number; // percentage
  image: string;
  validUntil: string;
  minOrder: number;
  active: boolean;
}

interface PromosStore {
  promos: Promo[];
  addPromo: (promo: Omit<Promo, 'id'>) => void;
  updatePromo: (id: string, updates: Partial<Promo>) => void;
  removePromo: (id: string) => void;
  togglePromoActive: (id: string) => void;
  getActivePromos: () => Promo[];
  clearAllPromos: () => void;
}

export const usePromosStore = create<PromosStore>()(
  persist(
    (set, get) => ({
      promos: [],

      addPromo: (promoData) => {
        const newPromo: Promo = {
          ...promoData,
          id: `promo-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        };
        set((state) => ({
          promos: [...state.promos, newPromo],
        }));
      },

      updatePromo: (id, updates) =>
        set((state) => ({
          promos: state.promos.map((promo) =>
            promo.id === id ? { ...promo, ...updates } : promo
          ),
        })),

      removePromo: (id) =>
        set((state) => ({
          promos: state.promos.filter((promo) => promo.id !== id),
        })),

      togglePromoActive: (id) =>
        set((state) => ({
          promos: state.promos.map((promo) =>
            promo.id === id ? { ...promo, active: !promo.active } : promo
          ),
        })),

      getActivePromos: () => {
        return get().promos.filter((promo) => promo.active);
      },

      clearAllPromos: () =>
        set({ promos: [] }),
    }),
    {
      name: 'cbd-promos-storage',
      storage: createJSONStorage(() => AsyncStorage),
    }
  )
);
