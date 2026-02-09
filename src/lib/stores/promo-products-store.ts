import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Promo Products Store - for managing products on promotion
export interface PromoProduct {
  id: string;
  productId: string;
  producerId: string;
  productName: string;
  producerName: string;
  originalPrice: number;
  promoPrice: number;
  promoPricePro?: number | null; // Prix promo pour les pros
  discountPercent: number;
  image: string;
  validUntil: string;
  active: boolean;
  visibleForClients?: boolean; // Visible pour les clients (défaut: true)
  visibleForPros?: boolean; // Visible pour les pros (défaut: true)
}

interface PromoProductsStore {
  promoProducts: PromoProduct[];
  addPromoProduct: (product: Omit<PromoProduct, 'id'>) => void;
  updatePromoProduct: (id: string, updates: Partial<PromoProduct>) => void;
  removePromoProduct: (id: string) => void;
  togglePromoProductActive: (id: string) => void;
  getActivePromoProducts: () => PromoProduct[];
  clearAllPromoProducts: () => void;
}

export const usePromoProductsStore = create<PromoProductsStore>()(
  persist(
    (set, get) => ({
      promoProducts: [],

      addPromoProduct: (productData) => {
        const newProduct: PromoProduct = {
          ...productData,
          id: `promo-product-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        };
        set((state) => ({
          promoProducts: [...state.promoProducts, newProduct],
        }));
      },

      updatePromoProduct: (id, updates) =>
        set((state) => ({
          promoProducts: state.promoProducts.map((product) =>
            product.id === id ? { ...product, ...updates } : product
          ),
        })),

      removePromoProduct: (id) =>
        set((state) => ({
          promoProducts: state.promoProducts.filter((product) => product.id !== id),
        })),

      togglePromoProductActive: (id) =>
        set((state) => ({
          promoProducts: state.promoProducts.map((product) =>
            product.id === id ? { ...product, active: !product.active } : product
          ),
        })),

      getActivePromoProducts: () => {
        return get().promoProducts.filter((product) => product.active);
      },

      clearAllPromoProducts: () =>
        set({ promoProducts: [] }),
    }),
    {
      name: 'cbd-promo-products-storage',
      storage: createJSONStorage(() => AsyncStorage),
    }
  )
);
