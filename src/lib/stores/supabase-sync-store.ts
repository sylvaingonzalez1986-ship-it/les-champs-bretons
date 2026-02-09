import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Producer } from '../producers';
import { Lot } from './lots-store';

// Supabase Sync Store - for syncing producers from Supabase
interface SupabaseSyncStore {
  syncedProducers: Producer[];
  syncedLots: Lot[];
  lastSyncAt: string | null;
  lastLotsSyncAt: string | null;
  isSyncing: boolean;
  syncError: string | null;
  setSyncedProducers: (producers: Producer[]) => void;
  setSyncedLots: (lots: Lot[]) => void;
  setSyncing: (syncing: boolean) => void;
  setSyncError: (error: string | null) => void;
  updateLastSync: () => void;
  updateLastLotsSync: () => void;
  clearSyncedData: () => void;
}

export const useSupabaseSyncStore = create<SupabaseSyncStore>()(
  persist(
    (set) => ({
      syncedProducers: [],
      syncedLots: [],
      lastSyncAt: null,
      lastLotsSyncAt: null,
      isSyncing: false,
      syncError: null,

      setSyncedProducers: (producers: Producer[]) =>
        set({
          syncedProducers: producers,
          lastSyncAt: new Date().toISOString(),
          syncError: null,
        }),

      setSyncedLots: (lots: Lot[]) =>
        set({
          syncedLots: lots,
          lastLotsSyncAt: new Date().toISOString(),
          syncError: null,
        }),

      setSyncing: (syncing: boolean) =>
        set({ isSyncing: syncing }),

      setSyncError: (error: string | null) =>
        set({ syncError: error }),

      updateLastSync: () =>
        set({ lastSyncAt: new Date().toISOString() }),

      updateLastLotsSync: () =>
        set({ lastLotsSyncAt: new Date().toISOString() }),

      clearSyncedData: () =>
        set({
          syncedProducers: [],
          syncedLots: [],
          lastSyncAt: null,
          lastLotsSyncAt: null,
          syncError: null,
        }),
    }),
    {
      name: 'cbd-supabase-sync-storage',
      storage: createJSONStorage(() => AsyncStorage),
    }
  )
);
