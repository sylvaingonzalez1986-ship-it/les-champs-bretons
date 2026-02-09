import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Tab Visibility Store - for controlling which tabs are visible per role
export type TabId = 'map' | 'packs' | 'promo' | 'produits' | 'cart' | 'tirage' | 'profile' | 'music' | 'regions' | 'ma-boutique' | 'marche-local' | 'reseau-pro';

// Role-based visibility
export type TabRole = 'client' | 'pro' | 'producer';

export interface TabRoleVisibility {
  client: boolean;
  pro: boolean;
  producer: boolean;
}

export interface TabConfig {
  id: TabId;
  name: string;
  visible: boolean; // Legacy - kept for backward compatibility
  roleVisibility: TabRoleVisibility;
}

interface TabVisibilityStore {
  tabs: TabConfig[];
  setTabVisibility: (tabId: TabId, visible: boolean) => void;
  setTabRoleVisibility: (tabId: TabId, role: TabRole, visible: boolean) => void;
  isTabVisible: (tabId: TabId) => boolean;
  isTabVisibleForRole: (tabId: TabId, role: TabRole | null) => boolean;
  resetToDefaults: () => void;
}

const DEFAULT_TABS: TabConfig[] = [
  { id: 'map', name: 'Carte', visible: true, roleVisibility: { client: true, pro: true, producer: true } },
  { id: 'music', name: 'Musique', visible: true, roleVisibility: { client: true, pro: true, producer: true } },
  { id: 'packs', name: 'Packs', visible: true, roleVisibility: { client: true, pro: true, producer: false } },
  { id: 'promo', name: 'Promo', visible: true, roleVisibility: { client: true, pro: true, producer: false } },
  { id: 'regions', name: 'Régions', visible: true, roleVisibility: { client: false, pro: true, producer: false } },
  { id: 'produits', name: 'Produits', visible: true, roleVisibility: { client: true, pro: true, producer: true } },
  { id: 'ma-boutique', name: 'Ma Boutique', visible: true, roleVisibility: { client: false, pro: false, producer: true } },
  { id: 'reseau-pro', name: 'Réseau Pro', visible: true, roleVisibility: { client: false, pro: false, producer: true } },
  { id: 'cart', name: 'Panier', visible: true, roleVisibility: { client: true, pro: true, producer: false } },
  { id: 'tirage', name: 'Tirage', visible: true, roleVisibility: { client: true, pro: false, producer: false } },
  { id: 'profile', name: 'Profil', visible: true, roleVisibility: { client: true, pro: true, producer: true } },
  { id: 'marche-local', name: 'Marché Local', visible: true, roleVisibility: { client: true, pro: true, producer: true } },
];

export const useTabVisibilityStore = create<TabVisibilityStore>()(
  persist(
    (set, get) => ({
      tabs: DEFAULT_TABS,

      setTabVisibility: (tabId: TabId, visible: boolean) =>
        set((state) => ({
          tabs: state.tabs.map((tab) =>
            tab.id === tabId ? { ...tab, visible } : tab
          ),
        })),

      setTabRoleVisibility: (tabId: TabId, role: TabRole, visible: boolean) =>
        set((state) => ({
          tabs: state.tabs.map((tab) =>
            tab.id === tabId
              ? {
                  ...tab,
                  roleVisibility: {
                    ...tab.roleVisibility,
                    [role]: visible,
                  },
                }
              : tab
          ),
        })),

      isTabVisible: (tabId: TabId) => {
        const tab = get().tabs.find((t) => t.id === tabId);
        return tab?.visible ?? true;
      },

      isTabVisibleForRole: (tabId: TabId, role: TabRole | null) => {
        const tab = get().tabs.find((t) => t.id === tabId);
        if (!tab) return true;
        // If no role (not logged in), treat as client
        const effectiveRole = role ?? 'client';

        // Enforce pro tabs: Carte / Chat / Marché Local / Profil only
        if (effectiveRole === 'pro') {
          const proAllowed: TabId[] = ['map', 'marche-local', 'profile'];
          return proAllowed.includes(tabId);
        }

        return tab.roleVisibility?.[effectiveRole] ?? tab.visible ?? true;
      },

      resetToDefaults: () =>
        set({ tabs: DEFAULT_TABS }),
    }),
    {
      name: 'cbd-tab-visibility-storage',
      storage: createJSONStorage(() => AsyncStorage),
      // Merge persisted tabs with default tabs to ensure new tabs are added
      merge: (persistedState, currentState) => {
        const persisted = persistedState as Partial<TabVisibilityStore>;
        const persistedTabs = persisted?.tabs ?? [];

        // Ensure all default tabs exist, preserving visibility from persisted state
        const mergedTabs = DEFAULT_TABS.map((defaultTab) => {
          const existingTab = persistedTabs.find((t) => t.id === defaultTab.id);
          if (existingTab) {
            // Merge roleVisibility with defaults to handle new roles
            return {
              ...defaultTab,
              ...existingTab,
              roleVisibility: {
                ...defaultTab.roleVisibility,
                ...existingTab.roleVisibility,
              },
            };
          }
          return defaultTab;
        });

        return {
          ...currentState,
          ...persisted,
          tabs: mergedTabs,
        };
      },
    }
  )
);
