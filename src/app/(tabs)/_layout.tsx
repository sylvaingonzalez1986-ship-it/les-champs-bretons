/**
 * Tabs Layout - Les Chanvriers Unis
 * Version robuste avec hooks securises et gestion des erreurs
 */
import React, { useMemo } from 'react';
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
  Globe,
  MessageCircle,
  Warehouse,
  FlaskConical,
} from 'lucide-react-native';
import { COLORS } from '@/lib/colors';
import { useCartStore, useTabVisibilityStore, useProducerChatStore, TabRole } from '@/lib/store';
import { Text } from '@/components/ui';
import { usePermissions } from '@/lib/useAuth';

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
    return (tabId: 'map' | 'packs' | 'promo' | 'produits' | 'cart' | 'tirage' | 'profile' | 'music' | 'regions' | 'ma-boutique' | 'chat-producteurs' | 'marche-local') => {
      // Admin sees everything
      if (isAdmin) return true;
      // Use role-based configuration
      return isTabVisibleForRole(tabId, userRole);
    };
  }, [isAdmin, isTabVisibleForRole, userRole]);

  return { shouldShowTab, isAdmin, isProUser, isProApproved };
}

/**
 * Badge component for cart/chat icons
 */
function TabBadge({ count }: { count: number }) {
  if (count <= 0) return null;

  return (
    <View
      style={{
        position: 'absolute',
        top: 0,
        right: -4,
        backgroundColor: COLORS.accent.red,
        borderRadius: 10,
        minWidth: 20,
        height: 20,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: 4,
        borderWidth: 2,
        borderColor: COLORS.background.nightSky,
        shadowColor: COLORS.accent.red,
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.5,
        shadowRadius: 4,
      }}
    >
      <Text style={{ color: COLORS.text.white, fontSize: 10, fontWeight: 'bold' }}>
        {count > 99 ? '99+' : count}
      </Text>
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
  const itemCount = useCartStore((s) => s.items.reduce((sum, item) => sum + item.quantity, 0));
  const chatUnreadCount = useProducerChatStore((s) => s.unreadCount);

  // Permissions and tab visibility
  const { shouldShowTab, isAdmin, isProUser, isProApproved } = useTabVisibility();
  const insets = useSafeAreaInsets();

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

      {/* Visible tabs */}
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
          title: 'Régions',
          href: shouldShowTab('regions') ? '/(tabs)/regions' : null,
          tabBarIcon: ({ color, size, focused }) => (
            <TabIcon focused={focused} focusColor={COLORS.primary.gold}>
              <Globe size={size} color={focused ? COLORS.primary.gold : color} strokeWidth={focused ? 2.5 : 2} />
            </TabIcon>
          ),
        }}
      />

      <Tabs.Screen
        name="ma-boutique"
        options={{
          title: 'Boutique',
          href: shouldShowTab('ma-boutique') ? '/(tabs)/ma-boutique' : null,
          tabBarIcon: ({ color, size, focused }) => (
            <TabIcon focused={focused} focusColor={COLORS.accent.hemp}>
              <Store size={size} color={focused ? COLORS.accent.hemp : color} strokeWidth={focused ? 2.5 : 2} />
            </TabIcon>
          ),
        }}
      />

      <Tabs.Screen
        name="chat-producteurs"
        options={{
          title: 'Chat',
          href: (shouldShowTab('chat-producteurs') || isProUser) ? '/(tabs)/chat-producteurs' : null,
          tabBarIcon: ({ color, size, focused }) => (
            <TabIcon focused={focused} focusColor="#10B981">
              <MessageCircle size={size} color={focused ? '#10B981' : color} strokeWidth={focused ? 2.5 : 2} />
              <TabBadge count={chatUnreadCount} />
            </TabIcon>
          ),
        }}
      />

      <Tabs.Screen
        name="marche-local"
        options={{
          title: 'Marché',
          href: shouldShowTab('marche-local') ? '/(tabs)/marche-local' : null,
          tabBarIcon: ({ color, size, focused }) => (
            <TabIcon focused={focused} focusColor={COLORS.accent.hemp}>
              <Warehouse size={size} color={focused ? COLORS.accent.hemp : color} strokeWidth={focused ? 2.5 : 2} />
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
              <TabBadge count={itemCount} />
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
  );
}
