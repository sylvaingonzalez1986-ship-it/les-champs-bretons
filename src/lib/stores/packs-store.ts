import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Packs Store - for pack management
export interface PackItem {
  name: string;
  quantity: string;
  value: number;
  images?: string[]; // Jusqu'à 3 images
  producerName?: string; // Nom du producteur
}

export interface Pack {
  id: string;
  name: string;
  description: string;
  price: number;
  pricePro?: number | null; // Prix professionnel
  originalPrice: number;
  image: string;
  items: PackItem[];
  tag?: string;
  color: string;
  active: boolean;
  visibleForClients?: boolean; // Visible pour les clients (défaut: true)
  visibleForPros?: boolean; // Visible pour les pros (défaut: false)
}

interface PacksStore {
  packs: Pack[];
  addPack: (pack: Omit<Pack, 'id'>) => void;
  updatePack: (id: string, updates: Partial<Pack>) => void;
  removePack: (id: string) => void;
  togglePackActive: (id: string) => void;
  getActivePacks: () => Pack[];
}

export const usePacksStore = create<PacksStore>()(
  persist(
    (set, get) => ({
      packs: [],

      addPack: (packData) => {
        const newPack: Pack = {
          ...packData,
          id: `pack-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        };
        set((state) => ({
          packs: [...state.packs, newPack],
        }));
      },

      updatePack: (id, updates) =>
        set((state) => ({
          packs: state.packs.map((pack) =>
            pack.id === id ? { ...pack, ...updates } : pack
          ),
        })),

      removePack: (id) =>
        set((state) => ({
          packs: state.packs.filter((pack) => pack.id !== id),
        })),

      togglePackActive: (id) =>
        set((state) => ({
          packs: state.packs.map((pack) =>
            pack.id === id ? { ...pack, active: !pack.active } : pack
          ),
        })),

      getActivePacks: () => {
        return get().packs.filter((pack) => pack.active);
      },
    }),
    {
      name: 'cbd-packs-storage',
      storage: createJSONStorage(() => AsyncStorage),
    }
  )
);
