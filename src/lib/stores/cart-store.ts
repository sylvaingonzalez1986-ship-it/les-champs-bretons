import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ProducerProduct } from '../producers';

// Cart item type
export interface CartItem {
  product: ProducerProduct;
  producerId: string;
  producerName: string;
  quantity: number;
  promoDiscount?: number; // Pourcentage de réduction promo (ex: 20 pour -20%)
}

interface CartStore {
  items: CartItem[];
  ownerId: string | null;
  addToCart: (product: ProducerProduct, producerId: string, producerName: string, promoDiscount?: number) => void;
  removeFromCart: (productId: string) => void;
  updateQuantity: (productId: string, quantity: number) => void;
  clearCart: () => void;
  setOwnerId: (ownerId: string | null) => void;
  getTotal: () => number;
  getItemCount: () => number;
}

export const useCartStore = create<CartStore>()(
  persist(
    (set, get) => ({
      items: [],
      ownerId: null,
      addToCart: (product: ProducerProduct, producerId: string, producerName: string, promoDiscount?: number) =>
        set((state) => {
          // Pour les produits promo, on crée une entrée séparée avec un ID unique
          const itemKey = promoDiscount ? `${product.id}-promo-${promoDiscount}` : product.id;
          const existingItem = state.items.find((item) => {
            const existingKey = item.promoDiscount ? `${item.product.id}-promo-${item.promoDiscount}` : item.product.id;
            return existingKey === itemKey;
          });

          if (existingItem) {
            return {
              items: state.items.map((item) => {
                const existingKey = item.promoDiscount ? `${item.product.id}-promo-${item.promoDiscount}` : item.product.id;
                return existingKey === itemKey
                  ? { ...item, quantity: item.quantity + 1 }
                  : item;
              }),
            };
          }
          return {
            items: [...state.items, { product, producerId, producerName, quantity: 1, promoDiscount }],
          };
        }),
      removeFromCart: (productId: string) =>
        set((state) => ({
          items: state.items.filter((item) => item.product.id !== productId),
        })),
      updateQuantity: (productId: string, quantity: number) =>
        set((state) => ({
          items: quantity <= 0
            ? state.items.filter((item) => item.product.id !== productId)
            : state.items.map((item) =>
                item.product.id === productId ? { ...item, quantity } : item
              ),
        })),
      clearCart: () => set({ items: [] }),
      setOwnerId: (ownerId: string | null) =>
        set((state) => {
          if (state.ownerId === ownerId) {
            return state;
          }
          return { ownerId, items: [] };
        }),
      getTotal: () => {
        const state = get();
        return state.items.reduce((sum, item) => {
          const price = item.promoDiscount
            ? item.product.price * (1 - item.promoDiscount / 100)
            : item.product.price;
          return sum + price * item.quantity;
        }, 0);
      },
      getItemCount: () => {
        const state = get();
        return state.items.reduce((sum, item) => sum + item.quantity, 0);
      },
    }),
    {
      name: 'cbd-cart-storage',
      storage: createJSONStorage(() => AsyncStorage),
    }
  )
);
