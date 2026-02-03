/**
 * Root Layout - Les Chanvriers Unis
 * Version simplifiée pour debug
 */
import { DarkTheme, ThemeProvider } from '@react-navigation/native';
import { Stack, useRouter, useSegments, useRootNavigationState } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useFonts, Wallpoet_400Regular } from '@expo-google-fonts/wallpoet';
import { useCallback, useEffect, useState, useMemo, useRef } from 'react';
import { View, ActivityIndicator, Text } from 'react-native';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { useDataSync } from '@/lib/useDataSync';
import { useUserDataSync } from '@/lib/useUserData';
import { AudioProvider } from '@/contexts/AudioContext';
import { useAuth } from '@/lib/useAuth';
import { COLORS } from '@/lib/colors';
import { isSupabaseConfigured } from '@/lib/env-validation';
import { NetworkProvider, useNetwork } from '@/lib/network-context';
import { NetworkBanner } from '@/components/NetworkBanner';
import { setupOrderQueueNetworkListener, cleanupOrderQueueNetworkListener } from '@/lib/order-queue-store';

export const unstable_settings = {
  initialRouteName: '(tabs)',
};

// Prevent splash from auto-hiding
SplashScreen.preventAutoHideAsync().catch(() => {});

// Create QueryClient outside component
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 2,
      retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 30000),
      staleTime: 1000 * 60 * 10,
      gcTime: 1000 * 60 * 60,
      refetchOnMount: 'always',
      refetchOnWindowFocus: false,
    },
  },
});

// Custom dark theme
const ChanvriersUnisDarkTheme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    background: '#0A0F0D',
    card: '#141F18',
    primary: '#D4AF37',
    border: '#1A472A',
  },
};

function LoadingScreen({ message }: { message?: string }) {
  return (
    <View style={{
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      backgroundColor: COLORS.background.nightSky,
    }}>
      <ActivityIndicator size="large" color={COLORS.primary.gold} />
      {message && (
        <Text style={{ color: COLORS.text.muted, marginTop: 16, fontSize: 14 }}>
          {message}
        </Text>
      )}
    </View>
  );
}

function EnvironmentErrorScreen() {
  return (
    <View style={{
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      backgroundColor: COLORS.background.nightSky,
      padding: 24,
    }}>
      <Text style={{ color: '#FF6B6B', fontSize: 18, fontWeight: 'bold', marginBottom: 16, textAlign: 'center' }}>
        Configuration manquante
      </Text>
      <Text style={{ color: COLORS.text.muted, fontSize: 14, textAlign: 'center', marginBottom: 8 }}>
        Variables d'environnement requises:
      </Text>
      <Text style={{ color: COLORS.primary.gold, fontSize: 12, textAlign: 'center' }}>
        • EXPO_PUBLIC_SUPABASE_URL
      </Text>
      <Text style={{ color: COLORS.primary.gold, fontSize: 12, textAlign: 'center' }}>
        • EXPO_PUBLIC_SUPABASE_ANON_KEY
      </Text>
    </View>
  );
}

/**
 * Auth Guard - Simplified version
 */
function AuthGuard({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading, isInitialized, profile, session } = useAuth();
  const segments = useSegments();
  const router = useRouter();
  const rootNavState = useRootNavigationState();
  const [loadingTimeout, setLoadingTimeout] = useState(false);
  const navigationDone = useRef<string | null>(null);

  // Safety timeout
  useEffect(() => {
    if (!isInitialized || isLoading) {
      const timeout = setTimeout(() => {
        console.warn('[AuthGuard] Loading timeout reached after 10s');
        setLoadingTimeout(true);
      }, 10000);
      return () => clearTimeout(timeout);
    }
  }, [isInitialized, isLoading]);

  // Navigation logic - with deduplication
  useEffect(() => {
    if (!rootNavState?.key) return;
    if (!rootNavState?.routes?.length) return;
    if (!segments || segments.length === 0) return;
    if (!isInitialized || (isLoading && !loadingTimeout)) return;

    const inAuthGroup = segments[0] === 'auth';
    const inAgeVerification = segments[0] === 'age-verification';
    const inProPendingPage = segments[0] === 'pro-pending';
    const inTabs = segments[0] === '(tabs)';

    let targetRoute: string | null = null;

    // Skip navigation if user is on reset-password page (deep link from email)
    const currentPath = segments.join('/');
    if (currentPath.includes('reset-password') || currentPath.includes('email-confirmed')) {
      return;
    }

    const isAdultVerified = profile?.is_adult === true;
    if (!isAdultVerified) {
      if (!inAgeVerification && !inAuthGroup) {
        targetRoute = '/age-verification';
      }
    } else {
      const isPro = profile?.role === 'pro';
      const proStatus = (profile as any)?.pro_status;
      const isProPending = isPro && (proStatus === 'pending' || proStatus === null);
      const isProRejected = isPro && proStatus === 'rejected';

      if (isProPending || isProRejected) {
        if (!inProPendingPage && !inAuthGroup) {
          targetRoute = '/pro-pending';
        }
      } else if (inAuthGroup || inAgeVerification || inProPendingPage) {
        targetRoute = '/(tabs)/map';
      }
    }

    // Only navigate if we have a target and haven't navigated there already
    if (targetRoute && navigationDone.current !== targetRoute) {
      navigationDone.current = targetRoute;
      router.replace(targetRoute as any);
    }
  }, [
    isAuthenticated,
    isInitialized,
    isLoading,
    loadingTimeout,
    profile?.is_adult,
    profile?.role,
    (profile as any)?.pro_status,
    segments,
    router,
    rootNavState?.key,
  ]);

  // Reset navigation tracking when auth state changes
  useEffect(() => {
    navigationDone.current = null;
  }, [isAuthenticated, profile?.is_adult, profile?.role, (profile as any)?.pro_status]);

  if (!isInitialized || (isLoading && !loadingTimeout)) {
    return <LoadingScreen message="Chargement..." />;
  }

  return <>{children}</>;
}

function SafeAudioWrapper({ children }: { children: React.ReactNode }) {
  const [audioError, setAudioError] = useState(false);

  if (audioError) {
    console.warn('[Audio] Audio context failed, continuing without audio');
    return <>{children}</>;
  }

  return (
    <ErrorBoundary onError={() => setAudioError(true)} fallback={<>{children}</>}>
      <AudioProvider>{children}</AudioProvider>
    </ErrorBoundary>
  );
}

function NetworkStatusWrapper({ children }: { children: React.ReactNode }) {
  const { isOnline, checkConnection } = useNetwork();
  const [showSuccess, setShowSuccess] = useState(false);
  const [wasOffline, setWasOffline] = useState(false);

  useEffect(() => {
    if (!isOnline) {
      setWasOffline(true);
    } else if (wasOffline && isOnline) {
      setShowSuccess(true);
      setWasOffline(false);
      setTimeout(() => setShowSuccess(false), 3000);
    }
  }, [isOnline, wasOffline]);

  return (
    <>
      <NetworkBanner isOnline={isOnline} showSuccess={showSuccess} onRetry={checkConnection} />
      {children}
    </>
  );
}

function DataSyncWrapper({ children }: { children: React.ReactNode }) {
  useDataSync();
  useUserDataSync();

  useEffect(() => {
    setupOrderQueueNetworkListener();
    return () => {
      cleanupOrderQueueNetworkListener();
    };
  }, []);

  return <>{children}</>;
}

function RootLayoutNav() {
  return (
    <ThemeProvider value={ChanvriersUnisDarkTheme}>
      <DataSyncWrapper>
        <AuthGuard>
          <Stack>
            <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
            <Stack.Screen name="auth" options={{ headerShown: false }} />
            <Stack.Screen name="age-verification" options={{ headerShown: false, gestureEnabled: false }} />
            <Stack.Screen name="pro-pending" options={{ headerShown: false, gestureEnabled: false }} />
            <Stack.Screen name="producer-profile" options={{ headerShown: false }} />
            <Stack.Screen name="admin-music" options={{ headerShown: false }} />
            <Stack.Screen name="edit-profile" options={{ headerShown: false, presentation: 'modal' }} />
            <Stack.Screen name="panier-vente-directe" options={{ headerShown: false }} />
            <Stack.Screen name="commande-confirmation" options={{ headerShown: false }} />
            <Stack.Screen name="mes-commandes-marche-local" options={{ headerShown: false }} />
            <Stack.Screen name="gestion-commandes" options={{ headerShown: false }} />
            <Stack.Screen name="modal" options={{ presentation: 'modal' }} />
          </Stack>
        </AuthGuard>
      </DataSyncWrapper>
    </ThemeProvider>
  );
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    Wallpoet_400Regular,
  });

  const supabaseConfigured = useMemo(() => isSupabaseConfigured(), []);

  const onLayoutRootView = useCallback(async () => {
    if (fontsLoaded || fontError) {
      try {
        await SplashScreen.hideAsync();
      } catch (e) {}
    }
  }, [fontsLoaded, fontError]);

  useEffect(() => {
    if (fontError) {
      console.warn('[Fonts] Error loading fonts:', fontError);
    }
  }, [fontError]);

  const [fontTimeout, setFontTimeout] = useState(false);
  useEffect(() => {
    const timeout = setTimeout(() => {
      if (!fontsLoaded && !fontError) {
        console.warn('[Fonts] Font loading timeout');
        setFontTimeout(true);
      }
    }, 5000);
    return () => clearTimeout(timeout);
  }, [fontsLoaded, fontError]);

  if (!fontsLoaded && !fontError && !fontTimeout) {
    return <LoadingScreen message="Chargement des polices..." />;
  }

  if (!supabaseConfigured) {
    return <EnvironmentErrorScreen />;
  }

  return (
    <ErrorBoundary>
      <View style={{ flex: 1 }} onLayout={onLayoutRootView}>
        <QueryClientProvider client={queryClient}>
          <NetworkProvider>
            <SafeAreaProvider>
              <GestureHandlerRootView style={{ flex: 1 }}>
                <SafeAudioWrapper>
                  <NetworkStatusWrapper>
                    <StatusBar style="light" />
                    <RootLayoutNav />
                  </NetworkStatusWrapper>
                </SafeAudioWrapper>
              </GestureHandlerRootView>
            </SafeAreaProvider>
          </NetworkProvider>
        </QueryClientProvider>
      </View>
    </ErrorBoundary>
  );
}
