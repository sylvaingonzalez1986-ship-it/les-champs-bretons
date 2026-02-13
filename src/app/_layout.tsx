/**
 * Root Layout - Les Chanvriers Unis
 * Version simplifiée pour debug
 */
import { DarkTheme, ThemeProvider } from '@react-navigation/native';
import { Stack, useRouter, useSegments, useRootNavigationState, type Href } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useFonts, Wallpoet_400Regular } from '@expo-google-fonts/wallpoet';
import { useCallback, useEffect, useState, useMemo, useRef } from 'react';
import { View, ActivityIndicator, Text, Pressable, InteractionManager } from 'react-native';
import { configureReanimatedLogger, ReanimatedLogLevel } from 'react-native-reanimated';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { configureLogger } from '@/lib/logger';
import { useDataSync } from '@/lib/useDataSync';
import { useUserDataSync } from '@/lib/useUserData';
import { useAudioStore } from '@/lib/store';
import { useAuth } from '@/lib/useAuth';
import { COLORS } from '@/lib/colors';
import { isSupabaseConfigured } from '@/lib/env-validation';
import { NetworkProvider, useNetwork } from '@/lib/network-context';
import { NetworkBanner } from '@/components/NetworkBanner';
import { setupOrderQueueNetworkListener, cleanupOrderQueueNetworkListener } from '@/lib/order-queue-store';
import { warmEdgeFunctions } from '@/lib/warmup';

// Configure Reanimated logger to suppress strict mode warnings
configureReanimatedLogger({
  level: ReanimatedLogLevel.warn,
  strict: false,
});

configureLogger();

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
      refetchOnMount: true,
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

type RootRoute = '/auth/login' | '/age-verification' | '/pro-pending' | '/(tabs)/map';

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

function AuthErrorScreen({
  title,
  message,
  onRetry,
}: {
  title: string;
  message: string;
  onRetry: () => void;
}) {
  return (
    <View style={{
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      backgroundColor: COLORS.background.nightSky,
      padding: 24,
    }}>
      <Text style={{ color: '#FF6B6B', fontSize: 18, fontWeight: 'bold', marginBottom: 12, textAlign: 'center' }}>
        {title}
      </Text>
      <Text style={{ color: COLORS.text.muted, fontSize: 14, textAlign: 'center', marginBottom: 16 }}>
        {message}
      </Text>
      <Pressable
        onPress={onRetry}
        style={{
          paddingHorizontal: 16,
          paddingVertical: 10,
          backgroundColor: COLORS.primary.gold,
          borderRadius: 10,
        }}
      >
        <Text style={{ color: '#0A0F0D', fontWeight: 'bold' }}>Réessayer</Text>
      </Pressable>
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
  const {
    isAuthenticated,
    isInitialized,
    profile,
    isLoadingSession,
    isLoadingProfile,
    sessionError,
    profileError,
    retrySession,
    retryProfile,
  } = useAuth();
  const segments = useSegments();
  const router = useRouter();
  const rootNavState = useRootNavigationState();
  const navigationDone = useRef<string | null>(null);

  // Navigation logic - with deduplication
  useEffect(() => {
    if (!rootNavState?.key) return;
    if (!rootNavState?.routes?.length) return;
    if (!segments) return;
    if (!isInitialized || isLoadingSession || isLoadingProfile) return;
    if (sessionError || profileError) return;

    const inAuthGroup = segments[0] === 'auth';
    const inAgeVerification = segments[0] === 'age-verification';
    const inProPendingPage = segments[0] === 'pro-pending';
    let targetRoute: RootRoute | null = null;

    // Skip navigation if user is on reset-password page (deep link from email)
    const currentPath = segments.join('/');
    if (currentPath.includes('reset-password') || currentPath.includes('email-confirmed')) {
      return;
    }

    // 1. FIRST: Check if user is authenticated
    if (!isAuthenticated) {
      // Not authenticated - redirect to login if not already in auth group
      if (!inAuthGroup) {
        targetRoute = '/auth/login';
      }
    } else {
      // 2. User is authenticated - check age verification
      const isAdultVerified = profile?.is_adult === true;
      if (!isAdultVerified) {
        if (!inAgeVerification && !inAuthGroup) {
          targetRoute = '/age-verification';
        }
      } else {
        // 3. Age verified - check pro status
        const isPro = profile?.role === 'pro';
        const proStatus = profile?.pro_status ?? null;
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
    }

    // Only navigate if we have a target and haven't navigated there already
    if (targetRoute && navigationDone.current !== targetRoute) {
      navigationDone.current = targetRoute;
      router.replace(targetRoute as Href);
    }
  }, [
    isAuthenticated,
    isInitialized,
    isLoadingSession,
    isLoadingProfile,
    sessionError,
    profileError,
    profile?.is_adult,
    profile?.role,
    profile?.pro_status,
    segments,
    router,
    rootNavState?.key,
    rootNavState?.routes?.length,
  ]);

  // Reset navigation tracking when auth state changes
  useEffect(() => {
    navigationDone.current = null;
  }, [isAuthenticated, profile?.is_adult, profile?.role, profile?.pro_status]);

  if (!isInitialized || isLoadingSession) {
    return <LoadingScreen message="Chargement de la session..." />;
  }

  if (sessionError) {
    return (
      <AuthErrorScreen
        title="Connexion impossible"
        message="Impossible de charger la session. Vérifiez votre connexion et réessayez."
        onRetry={retrySession}
      />
    );
  }

  if (isAuthenticated && isLoadingProfile) {
    return <LoadingScreen message="Chargement du profil..." />;
  }

  if (profileError) {
    return (
      <AuthErrorScreen
        title="Profil indisponible"
        message="Le profil n'a pas pu être chargé. Vérifiez votre connexion et réessayez."
        onRetry={retryProfile}
      />
    );
  }

  return <>{children}</>;
}

function AudioEngineInitializer({ children }: { children: React.ReactNode }) {
  const initializeAudio = useAudioStore((s) => s.initialize);
  const destroyAudio = useAudioStore((s) => s.destroy);

  useEffect(() => {
    void initializeAudio().catch((error) => {
      console.warn('[Audio] Initialization failed:', error);
    });

    return () => {
      void destroyAudio();
    };
  }, [initializeAudio, destroyAudio]);

  return <>{children}</>;
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
  const warmupTriggered = useRef(false);

  const onLayoutRootView = useCallback(async () => {
    if (fontsLoaded || fontError) {
      try {
        await SplashScreen.hideAsync();
      } catch (e) {
        if (__DEV__) {
          console.warn('[Layout] Erreur initialisation:', e);
        }
      }
    }
  }, [fontsLoaded, fontError]);

  useEffect(() => {
    if (fontError) {
      console.warn('[Fonts] Error loading fonts:', fontError);
    }
  }, [fontError]);

  useEffect(() => {
    if (!supabaseConfigured || warmupTriggered.current) return;
    warmupTriggered.current = true;
    const task = InteractionManager.runAfterInteractions(() => {
      void warmEdgeFunctions();
    });
    return () => {
      task.cancel?.();
    };
  }, [supabaseConfigured]);

  const [fontTimeout, setFontTimeout] = useState(false);
  useEffect(() => {
    const timeout = setTimeout(() => {
      if (!fontsLoaded && !fontError) {
        setFontTimeout(true);
      }
    }, 12000);
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
                <AudioEngineInitializer>
                  <NetworkStatusWrapper>
                    <StatusBar style="light" />
                    <RootLayoutNav />
                  </NetworkStatusWrapper>
                </AudioEngineInitializer>
              </GestureHandlerRootView>
            </SafeAreaProvider>
          </NetworkProvider>
        </QueryClientProvider>
      </View>
    </ErrorBoundary>
  );
}
