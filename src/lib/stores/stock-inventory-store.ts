import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Product Stock Inventory - Manage product quantities and prices
export interface StockItem {
  id: string;
  productId: string;
  producerId: string;
  productName: string;
  producerName: string;
  productType: string;
  quantity: number;
  price: number;
  costPrice: number; // Prix d'achat
  tvaRate: number;
  unit: string; // 'g', 'ml', 'unité'
  minStock: number; // Seuil d'alerte stock bas
  image?: string;
  description?: string;
  cbdPercent?: number;
  thcPercent?: number;
  weight?: string;
  // Visibility and promo settings
  visible: boolean; // Visible dans la boutique du producteur
  isOnPromo: boolean; // En promotion
  discountPercent: number; // Pourcentage de réduction
  promoValidUntil?: string; // Date de fin de promo
  createdAt: number;
  updatedAt: number;
}

interface StockInventoryStore {
  stock: StockItem[];
  addStockItem: (item: Omit<StockItem, 'id' | 'createdAt' | 'updatedAt'>) => void;
  updateStockItem: (id: string, updates: Partial<StockItem>) => void;
  removeStockItem: (id: string) => void;
  updateQuantity: (id: string, quantity: number) => void;
  decrementQuantity: (id: string, amount: number) => boolean;
  incrementQuantity: (id: string, amount: number) => void;
  getStockByProduct: (productId: string) => StockItem | undefined;
  getLowStockItems: () => StockItem[];
  getTotalStockValue: () => number;
  clearAllStock: () => void;
}

export const useStockInventoryStore = create<StockInventoryStore>()(
  persist(
    (set, get) => ({
      stock: [],

      addStockItem: (itemData) => {
        const now = Date.now();
        const newItem: StockItem = {
          ...itemData,
          id: `stock-${now}-${Math.random().toString(36).substr(2, 9)}`,
          createdAt: now,
          updatedAt: now,
        };
        set((state) => ({
          stock: [...state.stock, newItem],
        }));
      },

      updateStockItem: (id, updates) =>
        set((state) => ({
          stock: state.stock.map((item) =>
            item.id === id
              ? { ...item, ...updates, updatedAt: Date.now() }
              : item
          ),
        })),

      removeStockItem: (id) =>
        set((state) => ({
          stock: state.stock.filter((item) => item.id !== id),
        })),

      updateQuantity: (id, quantity) =>
        set((state) => ({
          stock: state.stock.map((item) =>
            item.id === id
              ? { ...item, quantity: Math.max(0, quantity), updatedAt: Date.now() }
              : item
          ),
        })),

      decrementQuantity: (id, amount) => {
        const state = get();
        const item = state.stock.find((i) => i.id === id);
        if (!item || item.quantity < amount) return false;

        set((s) => ({
          stock: s.stock.map((i) =>
            i.id === id
              ? { ...i, quantity: i.quantity - amount, updatedAt: Date.now() }
              : i
          ),
        }));
        return true;
      },

      incrementQuantity: (id, amount) =>
        set((state) => ({
          stock: state.stock.map((item) =>
            item.id === id
              ? { ...item, quantity: item.quantity + amount, updatedAt: Date.now() }
              : item
          ),
        })),

      getStockByProduct: (productId) => {
        return get().stock.find((item) => item.productId === productId);
      },

      getLowStockItems: () => {
        return get().stock.filter((item) => item.quantity <= item.minStock);
      },

      getTotalStockValue: () => {
        return get().stock.reduce((sum, item) => sum + item.quantity * item.price, 0);
      },

      clearAllStock: () => set({ stock: [] }),
    }),
    {
      name: 'cbd-stock-inventory-storage',
      storage: createJSONStorage(() => AsyncStorage),
    }
  )
);
