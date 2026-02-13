/**
 * Tabs Layout - Les Chanvriers Unis
 * Version robuste avec hooks securises et gestion des erreurs
 */
import React, { useEffect, useMemo } from 'react';
import { Tabs } from 'expo-router';
import { Platform, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  Gift,
  Map,
  Settings,
  User,
  ShoppingCart,
  Package,
  Percent,
  Briefcase,
  Store,
  Music,
  Warehouse,
  FlaskConical,
  Handshake,
  BarChart3,
} from 'lucide-react-native';
import { COLORS } from '@/lib/colors';
import { useCartStore, useTabVisibilityStore, TabRole } from '@/lib/store';
import { useDirectSalesCart } from '@/lib/direct-sales-cart';
import { useAuth, usePermissions } from '@/lib/useAuth';
import { ErrorBoundary } from '@/components/ErrorBoundary';

/**
 * Hook sécurisé pour les permissions utilisateur
 * Retourne des valeurs par défaut si le contexte n'est pas prêt
 */
function useSafePermissions() {
  try {
    return usePermissions();
  } catch (error) {
    console.warn('[TabLayout] usePermissions failed, using defaults:', error);
    return {
      isAuthenticated: false,
      isClient: true,
      isPro: false,
      isProApproved: false,
      isProPending: false,
      isProRejected: false,
      proStatus: null,
      isProducer: false,
      isAdmin: false,
      canManageProducts: false,
      canManageOrders: false,
      canManageUsers: false,
      canAccessProPricing: false,
    };
  }
}

/**
 * Hook pour la visibilité des tabs basée sur le rôle
 */
function useTabVisibility() {
  const { isPro: isProUser, isAdmin, isProducer, isProApproved } = useSafePermissions();
  const isTabVisibleForRole = useTabVisibilityStore((s) => s.isTabVisibleForRole);

  // Determine user role for tab visibility
  const userRole = useMemo((): TabRole | null => {
    if (isProducer) return 'producer';
    if (isProUser || isProApproved) return 'pro';
    return 'client';
  }, [isProducer, isProUser, isProApproved]);

  // Helper to check tab visibility
  const shouldShowTab = useMemo(() => {
    return (tabId: 'map' | 'packs' | 'promo' | 'produits' | 'cart' | 'tirage' | 'profile' | 'music' | 'ma-boutique' | 'marche-local' | 'reseau-pro' | 'gestion') => {
      // Admin sees everything
      if (isAdmin) return true;
      // Clients never see the map tab in navigation
      if (userRole === 'client' && tabId === 'map') return false;
      // Clients never see the promo tab in navigation
      if (userRole === 'client' && tabId === 'promo') return false;
      // Use role-based configuration
      return isTabVisibleForRole(tabId, userRole);
    };
  }, [isAdmin, isTabVisibleForRole, userRole]);

  return { shouldShowTab, isAdmin, isProUser, isProApproved };
}

/**
 * Badge component for cart icons
 */
function CartBadges({ packCount, localCount }: { packCount: number; localCount: number }) {
  if (packCount <= 0 && localCount <= 0) return null;
  return (
    <View
      style={{
        position: 'absolute',
        top: -2,
        right: -8,
        flexDirection: 'row',
        gap: 4,
        alignItems: 'center',
      }}
    >
      {packCount > 0 && (
        <View
          style={{
            width: 10,
            height: 10,
            borderRadius: 5,
            backgroundColor: COLORS.accent.red,
            borderWidth: 1.5,
            borderColor: COLORS.background.nightSky,
          }}
        />
      )}
      {localCount > 0 && (
        <View
          style={{
            width: 10,
            height: 10,
            borderRadius: 5,
            backgroundColor: COLORS.primary.orange,
            borderWidth: 1.5,
            borderColor: COLORS.background.nightSky,
          }}
        />
      )}
    </View>
  );
}

/**
 * Icon wrapper with focus state
 */
function TabIcon({
  children,
  focused,
  focusColor,
}: {
  children: React.ReactNode;
  focused: boolean;
  focusColor: string;
}) {
  return (
    <View
      style={{
        padding: 6,
        borderRadius: 12,
        backgroundColor: focused ? `${focusColor}25` : 'transparent',
      }}
    >
      {children}
    </View>
  );
}

export default function TabLayout() {
  // Store selectors - use primitive values to prevent unnecessary re-renders
  const cartItems = useCartStore((s) => s.items);
  const localCartItems = useDirectSalesCart((s) => s.items);
  const loadLocalCart = useDirectSalesCart((s) => s.loadCart);
  const { session } = useAuth();
  const packsItemCount = useMemo(
    () => cartItems.reduce((sum, item) => sum + item.quantity, 0),
    [cartItems]
  );
  const localItemCount = useMemo(
    () => localCartItems.reduce((sum, item) => sum + item.quantity, 0),
    [localCartItems]
  );
  // Permissions and tab visibility
  const { shouldShowTab, isAdmin, isProUser, isProApproved } = useTabVisibility();
  const insets = useSafeAreaInsets();

  useEffect(() => {
    if (!session?.user?.id || !session?.access_token) return;
    loadLocalCart(session.user.id, session.access_token);
  }, [session?.user?.id, session?.access_token, loadLocalCart]);

  // Memoize screen options to prevent recreation on each render
  const screenOptions = useMemo(
    () => ({
      headerShown: false,
      lazy: true,
      detachInactiveScreens: true,
      freezeOnBlur: true,
      tabBarStyle: {
        backgroundColor: COLORS.background.nightSky,
        borderTopColor: COLORS.primary.gold,
        borderTopWidth: 2,
        height: Platform.OS === 'android' ? 70 + insets.bottom : 90,
        paddingBottom: Platform.OS === 'android' ? Math.max(10, insets.bottom) : 28,
        paddingTop: 8,
        shadowColor: COLORS.primary.gold,
        shadowOffset: { width: 0, height: -4 },
        shadowOpacity: 0.3,
        shadowRadius: 8,
        elevation: 10,
      },
      tabBarActiveTintColor: COLORS.primary.brightYellow,
      tabBarInactiveTintColor: COLORS.text.muted,
      tabBarLabelStyle: {
        fontSize: 10,
        fontWeight: '600' as const,
        letterSpacing: 0.2,
        fontFamily: Platform.OS === 'ios' ? 'Wallpoet_400Regular' : undefined,
      },
    }),
    [insets.bottom]
  );

  return (
    <ErrorBoundary>
      <Tabs screenOptions={screenOptions}>
      {/* Hidden routes */}
      <Tabs.Screen name="index" options={{ href: null }} />
      <Tabs.Screen name="collection" options={{ href: null }} />
      <Tabs.Screen name="produits" options={{ href: null }} />
      <Tabs.Screen name="odds" options={{ href: null }} />
      <Tabs.Screen name="shop" options={{ href: null }} />
      <Tabs.Screen name="settings" options={{ href: null }} />
      <Tabs.Screen name="donnees-partagees" options={{ href: null }} />
      <Tabs.Screen name="marche-catalogue" options={{ href: null }} />
      <Tabs.Screen name="compta" options={{ href: null }} />

      {/* Visible tabs — Marché Local en premier (page d'accueil clients) */}
      <Tabs.Screen
        name="marche-local"
        options={{
          title: 'Marché',
          href: shouldShowTab('marche-local') && !(isProUser || isProApproved) ? '/(tabs)/marche-local' : null,
          tabBarIcon: ({ color, size, focused }) => (
            <TabIcon focused={focused} focusColor={COLORS.accent.hemp}>
              <Warehouse size={size} color={focused ? COLORS.accent.hemp : color} strokeWidth={focused ? 2.5 : 2} />
            </TabIcon>
          ),
        }}
      />

      <Tabs.Screen
        name="map"
        options={{
          title: 'Carte',
          href: shouldShowTab('map') ? '/(tabs)/map' : null,
          tabBarIcon: ({ color, size, focused }) => (
            <TabIcon focused={focused} focusColor={COLORS.accent.forest}>
              <Map size={size} color={focused ? COLORS.accent.hemp : color} strokeWidth={focused ? 2.5 : 2} />
            </TabIcon>
          ),
        }}
      />

      <Tabs.Screen
        name="music"
        options={{
          title: 'Musique',
          href: shouldShowTab('music') ? '/(tabs)/music' : null,
          tabBarIcon: ({ color, size, focused }) => (
            <TabIcon focused={focused} focusColor={COLORS.primary.gold}>
              <Music size={size} color={focused ? COLORS.primary.gold : color} strokeWidth={focused ? 2.5 : 2} />
            </TabIcon>
          ),
        }}
      />

      <Tabs.Screen
        name="packs"
        options={{
          title: 'Packs',
          href: shouldShowTab('packs') ? '/(tabs)/packs' : null,
          tabBarIcon: ({ color, size, focused }) => (
            <TabIcon focused={focused} focusColor={COLORS.primary.orange}>
              <Package size={size} color={focused ? COLORS.primary.orange : color} strokeWidth={focused ? 2.5 : 2} />
            </TabIcon>
          ),
        }}
      />

      <Tabs.Screen
        name="promo"
        options={{
          title: 'Promo',
          href: shouldShowTab('promo') ? '/(tabs)/promo' : null,
          tabBarIcon: ({ color, size, focused }) => (
            <TabIcon focused={focused} focusColor={COLORS.accent.red}>
              <Percent size={size} color={focused ? COLORS.accent.red : color} strokeWidth={focused ? 2.5 : 2} />
            </TabIcon>
          ),
        }}
      />

      <Tabs.Screen
        name="pro"
        options={{
          title: 'Pro',
          href: isProUser || isAdmin ? '/(tabs)/pro' : null,
          tabBarIcon: ({ color, size, focused }) => (
            <TabIcon focused={focused} focusColor={COLORS.accent.teal}>
              <Briefcase size={size} color={focused ? COLORS.accent.teal : color} strokeWidth={focused ? 2.5 : 2} />
            </TabIcon>
          ),
        }}
      />

      <Tabs.Screen
        name="regions"
        options={{
          href: null,
        }}
      />

      <Tabs.Screen
        name="ma-boutique"
        options={{
          title: 'Ma Boutique',
          href: shouldShowTab('ma-boutique') ? '/(tabs)/ma-boutique' : null,
          tabBarIcon: ({ color, size, focused }) => (
            <TabIcon focused={focused} focusColor={COLORS.accent.hemp}>
              <Store size={size} color={focused ? COLORS.accent.hemp : color} strokeWidth={focused ? 2.5 : 2} />
            </TabIcon>
          ),
        }}
      />

      <Tabs.Screen
        name="gestion"
        options={{
          title: 'Gestion',
          href: shouldShowTab('gestion') ? '/(tabs)/gestion' : null,
          tabBarIcon: ({ color, size, focused }) => (
            <TabIcon focused={focused} focusColor={COLORS.primary.gold}>
              <BarChart3 size={size} color={focused ? COLORS.primary.gold : color} strokeWidth={focused ? 2.5 : 2} />
            </TabIcon>
          ),
        }}
      />

      <Tabs.Screen
        name="reseau-pro"
        options={{
          title: 'Réseau Pro',
          href: shouldShowTab('reseau-pro') ? '/(tabs)/reseau-pro' : null,
          tabBarIcon: ({ color, size, focused }) => (
            <TabIcon focused={focused} focusColor={COLORS.accent.forest}>
              <Handshake size={size} color={focused ? COLORS.accent.forest : color} strokeWidth={focused ? 2.5 : 2} />
            </TabIcon>
          ),
        }}
      />

      <Tabs.Screen
        name="cart"
        options={{
          title: 'Panier',
          href: shouldShowTab('cart') ? '/(tabs)/cart' : null,
          tabBarIcon: ({ color, size, focused }) => (
            <TabIcon focused={focused} focusColor={COLORS.primary.coral}>
              <ShoppingCart size={size} color={focused ? COLORS.primary.coral : color} strokeWidth={focused ? 2.5 : 2} />
              <CartBadges packCount={packsItemCount} localCount={localItemCount} />
            </TabIcon>
          ),
        }}
      />

      {/* FARMING/GAME SUPPRIMÉ - Feature retirée pour simplifier l'app */}

      <Tabs.Screen
        name="tirage"
        options={{
          title: 'Tirage',
          href: shouldShowTab('tirage') ? '/(tabs)/tirage' : null,
          tabBarIcon: ({ color, size, focused }) => (
            <TabIcon focused={focused} focusColor={COLORS.primary.gold}>
              <Gift size={size} color={color} strokeWidth={focused ? 2.5 : 2} />
            </TabIcon>
          ),
        }}
      />

      <Tabs.Screen
        name="admin"
        options={{
          title: 'Admin',
          href: isAdmin ? '/(tabs)/admin' : null,
          tabBarIcon: ({ color, size, focused }) => (
            <TabIcon focused={focused} focusColor={COLORS.accent.teal}>
              <Settings size={size} color={focused ? COLORS.accent.teal : color} strokeWidth={focused ? 2.5 : 2} />
            </TabIcon>
          ),
        }}
      />

      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profil',
          href: shouldShowTab('profile') ? '/(tabs)/profile' : null,
          tabBarIcon: ({ color, size, focused }) => (
            <TabIcon focused={focused} focusColor={COLORS.accent.sky}>
              <User size={size} color={focused ? COLORS.accent.sky : color} strokeWidth={focused ? 2.5 : 2} />
            </TabIcon>
          ),
        }}
      />

      <Tabs.Screen
        name="test-api"
        options={{
          title: 'Test API',
          href: isAdmin ? '/(tabs)/test-api' : null,
          tabBarIcon: ({ color, size, focused }) => (
            <TabIcon focused={focused} focusColor={COLORS.accent.redOrange}>
              <FlaskConical size={size} color={focused ? COLORS.accent.redOrange : color} strokeWidth={focused ? 2.5 : 2} />
            </TabIcon>
          ),
        }}
      />
      </Tabs>
    </ErrorBoundary>
  );
}
