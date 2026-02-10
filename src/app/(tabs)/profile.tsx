import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { View, Pressable, ScrollView, Image, Modal, Alert, ActivityIndicator } from 'react-native';
import { Text, TextInput } from '@/components/ui';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { User, Package, Award, Settings, ChevronRight, Leaf, Camera, Lock, LogOut, X, Ticket, Check, Grid3X3, ChevronDown, ChevronUp, Mail, Phone, MapPin, Home, ShoppingBag, Clock, Truck, CreditCard, XCircle, Copy, ExternalLink, Gift, RefreshCw, Shield, Building2, FileText, UserCircle, Users } from 'lucide-react-native';
import * as Clipboard from 'expo-clipboard';
import { getSafeMailtoUrl, getSafeTelUrl, safeOpenExternalUrl } from '@/lib/safe-linking';
import * as ImagePicker from 'expo-image-picker';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useQueryClient } from '@tanstack/react-query';
import {
  useCollectionStore,
  useSubscriptionStore,
  useCustomerInfoStore,
  useOrdersStore,
  ORDER_STATUS_CONFIG,
  OrderStatus,
  useReferralStore,
  useProducerStore,
} from '@/lib/store';
import { claimGiftedLotWithDetails, isSupabaseSyncConfigured } from '@/lib/supabase-sync';
import { updateMyProducer } from '@/lib/supabase-producer';
import { RARITY_CONFIG, Rarity } from '@/lib/types';
import { ImageCropper } from '@/components/ImageCropper';
import { useAuth, useUserIdentity, usePermissions } from '@/lib/useAuth';
import { COLORS } from '@/lib/colors';
import { USER_ROLE_LABELS, USER_ROLE_COLORS, USER_CATEGORY_LABELS, UserRole } from '@/lib/supabase-users';
import { ClientProfileForm } from '@/components/ClientProfileForm';
import { ProducerProfileForm } from '@/components/ProducerProfileForm';
import { ProProfileForm } from '@/components/ProProfileForm';
import { UserProfile } from '@/lib/supabase-auth';
import { AdminDashboard } from '@/components/AdminDashboard';
import { Toast, useToast } from '@/components/Toast';
import { useAdminOrdersQuery, useMyProducerQuery, useProducerLocalOrdersQuery, useProducerProOrdersQuery } from '@/api/orders';
import { useLocalMarketOrdersInfinite } from '@/api/local-market';

const PROFILE_IMAGE_KEY = 'user-profile-image';
const SIGNAL_GROUP_URL = 'https://signal.group/#CjQKIL5CUggt4OrebPgc7zjsc_h_AzrSw8I6k3QPM2l4MTkAEhDN8aN4Rmj_6F7NA8Dkved1';

interface MenuItemProps {
  icon: React.ReactNode;
  label: string;
  value?: string;
  onPress?: () => void;
}

const MenuItem = ({ icon, label, value, onPress }: MenuItemProps) => (
  <Pressable
    onPress={onPress}
    className="flex-row items-center py-4 px-4 bg-white/5 rounded-xl mb-2 active:opacity-70"
  >
    <View className="w-10 h-10 rounded-full bg-teal-600/20 items-center justify-center">
      {icon}
    </View>
    <Text className="text-white flex-1 ml-3 text-base font-medium">{label}</Text>
    {value && <Text className="text-gray-400 mr-2">{value}</Text>}
    <ChevronRight size={20} color="#6B7280" />
  </Pressable>
);

export default function ProfileScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [profileImage, setProfileImage] = useState<string | null>(null);
  const [showInfoForm, setShowInfoForm] = useState(false);
  const [showOrders, setShowOrders] = useState(false);
  const [showProducerProfile, setShowProducerProfile] = useState(false); // Fiche producteur
  const [copiedTrackingId, setCopiedTrackingId] = useState<string | null>(null);
  const [showProducerClients, setShowProducerClients] = useState(false);
  const [showProducerProClients, setShowProducerProClients] = useState(false);

  // Toast pour les feedbacks
  const { toast, showToast, hideToast } = useToast();

  // Image cropper state
  const [showCropper, setShowCropper] = useState(false);
  const [imageToCrop, setImageToCrop] = useState('');

  const collection = useCollectionStore((s) => s.collection);
  const totalSpins = useCollectionStore((s) => s.totalSpins);
  const addToCollection = useCollectionStore((s) => s.addToCollection);

  // Referral
  const referralPoints = useReferralStore((s) => s.points);
  const giftsSent = useReferralStore((s) => s.giftsSent);
  const giftsReceived = useReferralStore((s) => s.giftsReceived);
  const myCode = useReferralStore((s) => s.myCode);
  const generateMyCode = useReferralStore((s) => s.generateMyCode);
  const addPoints = useReferralStore((s) => s.addPoints);

  // Pro financial summary period filter
  const [proPeriodFilter, setProPeriodFilter] = useState<'day' | 'quarter' | 'year' | 'all'>('all');

  // Gift code input state
  const [giftCodeInput, setGiftCodeInput] = useState('');
  const [giftCodeError, setGiftCodeError] = useState(false);
  const [giftCodeSuccess, setGiftCodeSuccess] = useState(false);

  // Customer Info
  const customerInfo = useCustomerInfoStore((s) => s.customerInfo);
  const setCustomerInfo = useCustomerInfoStore((s) => s.setCustomerInfo);
  const isProfileComplete = useCustomerInfoStore((s) => s.isProfileComplete);

  // Supabase Auth
  const { isAuthenticated, session, user, profile, signOut, isSigningOut, isLoading: isLoadingAuth, updateProfile, isUpdatingProfile } = useAuth();
  const { authMode, userCode: supabaseUserCode, role, fullName: authFullName, email: authEmail } = useUserIdentity();
  const { isPro, isProducer, isAdmin: isAuthAdmin } = usePermissions();
  const [showAuthSection, setShowAuthSection] = useState(false);
  const [showAdminDashboard, setShowAdminDashboard] = useState(false);

  // Check if user is a client (can access gamification features)
  const isClient = !isAuthenticated || role === 'client' || role === 'admin';
  const isProUser = isPro || isProducer;

  // Get producers to find the one linked to current user (for producer role)
  const producers = useProducerStore((s) => s.producers);

  const queryClient = useQueryClient();

  // Producer linked to current user - fetched from Supabase for reliability
  const { data: myProducer } = useMyProducerQuery();

  // Check if producer profile is incomplete (missing key fields for farm sales)
  const isProducerProfileIncomplete = isProducer && profile && (
    !profile.company_name ||
    !profile.siret ||
    !profile.phone ||
    !profile.city
  );

  // Auto-open producer profile form if incomplete
  useEffect(() => {
    if (isProducerProfileIncomplete && !showProducerProfile) {
      setShowProducerProfile(true);
    }
  }, [isProducerProfileIncomplete]);

  // Fallback: find producer in local store by email (for display in stats)
  const linkedProducerFromStore = isProducer && authEmail
    ? producers.find((p) => p.email?.toLowerCase() === authEmail.toLowerCase())
    : null;

  // Orders - different logic for producers vs clients/pros
  const allOrders = useOrdersStore((s) => s.orders);
  const setOrders = useOrdersStore((s) => s.setOrders);
  const [isManualRefresh, setIsManualRefresh] = useState(false);
  const ordersEnabled = showOrders && isSupabaseSyncConfigured();
  const producerIdForOrders = isProducer ? myProducer?.id ?? '' : '';

  const {
    data: userOrders,
    isFetching: isUserOrdersFetching,
    refetch: refetchUserOrders,
  } = useAdminOrdersQuery(ordersEnabled && !isProducer);

  const {
    data: producerOrders,
    isFetching: isProducerOrdersFetching,
    refetch: refetchProducerOrders,
  } = useProducerProOrdersQuery(producerIdForOrders);

  const {
    data: producerLocalOrders = [],
    isLoading: isProducerLocalOrdersLoading,
    refetch: refetchProducerLocalOrders,
  } = useProducerLocalOrdersQuery(producerIdForOrders, session?.access_token ?? '');

  const { refetch: refetchLocalMarketOrders } = useLocalMarketOrdersInfinite(
    ordersEnabled ? session?.user?.id : undefined,
    ordersEnabled ? session?.access_token : undefined,
    10
  );

  const ordersLoading = isManualRefresh || isUserOrdersFetching || isProducerOrdersFetching || isProducerLocalOrdersLoading;

  const ordersFromQuery = useMemo(() => {
    if (isProducer) {
      return producerOrders ?? [];
    }
    return userOrders ?? [];
  }, [isProducer, producerOrders, userOrders]);

  useEffect(() => {
    if (!ordersEnabled) {
      return;
    }

    if (isProducer) {
      if (!producerOrders) {
        return;
      }
    } else if (!userOrders) {
      return;
    }

    const sortedOrders = [...ordersFromQuery].sort((a, b) => b.createdAt - a.createdAt);
    setOrders(sortedOrders);
  }, [ordersEnabled, isProducer, producerOrders, userOrders, ordersFromQuery, setOrders]);

  // RLS gère déjà le filtrage côté serveur - on affiche toutes les commandes reçues
  // Pour les producteurs: filtrer par leurs produits (toutes les commandes, pas seulement PRO)
  // Pour les clients/pros: RLS renvoie déjà uniquement leurs commandes
  const myOrders = isProducer && myProducer
    ? allOrders.filter((order) =>
        order.items.some((item) => item.producerId === myProducer.id)
      )
    : allOrders; // RLS filtre déjà par user_id

  const producerClientListMax = 8;

  const producerProClients = useMemo(() => {
    const entries = new Map<string, { name: string; email?: string; phone?: string }>();

    (producerOrders ?? []).forEach((order) => {
      const info = order.customerInfo;
      const email = info.email?.toLowerCase();
      const phone = info.phone?.trim();
      const fullName = `${info.firstName ?? ''} ${info.lastName ?? ''}`.trim();
      const name = fullName || info.email || 'Client pro';
      const key = email || phone || name.toLowerCase();

      if (!key || entries.has(key)) return;
      entries.set(key, { name, email: info.email ?? undefined, phone: info.phone ?? undefined });
    });

    return Array.from(entries.values());
  }, [producerOrders]);

  const producerLocalClients = useMemo(() => {
    const entries = new Map<string, { name: string; email?: string; phone?: string }>();

    producerLocalOrders.forEach((order) => {
      const email = order.customer_email?.toLowerCase();
      const phone = order.customer_phone?.trim() ?? undefined;
      const name = order.customer_name?.trim() || order.customer_email || 'Client particulier';
      const key = email || phone || name.toLowerCase();

      if (!key || entries.has(key)) return;
      entries.set(key, { name, email: order.customer_email ?? undefined, phone });
    });

    return Array.from(entries.values());
  }, [producerLocalOrders]);

  const handleManualRefresh = useCallback(async () => {
    if (!isSupabaseSyncConfigured()) {
      return;
    }

    if (isProducer && !producerIdForOrders) {
      return;
    }

    setIsManualRefresh(true);

    try {
      let refreshedOrdersCount = 0;

      if (isProducer) {
        const [proResult, localResult] = await Promise.all([
          refetchProducerOrders(),
          refetchProducerLocalOrders(),
        ]);
        refreshedOrdersCount = (proResult.data?.length ?? 0) + (localResult.data?.length ?? 0);
      } else {
        const [ordersResult] = await Promise.all([
          refetchUserOrders(),
          refetchLocalMarketOrders(),
        ]);
        refreshedOrdersCount = ordersResult.data?.length ?? 0;
      }

      showToast(
        `${refreshedOrdersCount} commande${refreshedOrdersCount > 1 ? 's' : ''} mise${refreshedOrdersCount > 1 ? 's' : ''} à jour`,
        'success'
      );
    } catch (error) {
      console.error('[Profile] Error refreshing orders:', error);
      showToast('Erreur lors de l\'actualisation des commandes', 'error');
    } finally {
      setIsManualRefresh(false);
    }
  }, [
    isProducer,
    producerIdForOrders,
    refetchProducerOrders,
    refetchProducerLocalOrders,
    refetchUserOrders,
    refetchLocalMarketOrders,
    showToast,
  ]);

  const openMailTo = useCallback(async (email?: string) => {
    if (!email) {
      showToast('Contact indisponible', 'warning');
      return;
    }
    const mailUrl = getSafeMailtoUrl(email);
    if (!mailUrl) {
      showToast('Contact indisponible', 'warning');
      return;
    }
    const opened = await safeOpenExternalUrl(mailUrl, { allowMailto: true });
    if (!opened) {
      showToast('Contact indisponible', 'warning');
    }
  }, [showToast]);

  const openTel = useCallback(async (phone?: string) => {
    if (!phone) {
      showToast('Contact indisponible', 'warning');
      return;
    }
    const telUrl = getSafeTelUrl(phone);
    if (!telUrl) {
      showToast('Contact indisponible', 'warning');
      return;
    }
    const opened = await safeOpenExternalUrl(telUrl, { allowTel: true });
    if (!opened) {
      showToast('Contact indisponible', 'warning');
    }
  }, [showToast]);

  useEffect(() => {
    if (!showOrders || !isProducer || !producerIdForOrders) {
      return;
    }

    const interval = setInterval(() => {
      refetchProducerOrders();
    }, 30000);

    return () => {
      clearInterval(interval);
    };
  }, [showOrders, isProducer, producerIdForOrders, refetchProducerOrders]);

  // Subscription
  const tickets = useSubscriptionStore((s) => s.tickets);
  const subscription = useSubscriptionStore((s) => s.subscription);
  const setSubscription = useSubscriptionStore((s) => s.setSubscription);

  // Load saved profile image on mount
  useEffect(() => {
    const loadProfileImage = async () => {
      try {
        const savedImage = await AsyncStorage.getItem(PROFILE_IMAGE_KEY);
        if (savedImage) {
          setProfileImage(savedImage);
        }
      } catch (error) {
        console.warn('Error loading profile image:', error);
      }
    };
    loadProfileImage();
  }, []);

  // Handle picking image from library
  const handlePickImage = async () => {
    try {
      // Request permission
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        return;
      }

      // Launch image picker
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: false,
        quality: 0.9,
      });

      if (!result.canceled && result.assets && result.assets[0]) {
        // Open cropper for profile image (square)
        setImageToCrop(result.assets[0].uri);
        setShowCropper(true);
      }
    } catch (error) {
      console.warn('Error picking image:', error);
    }
  };

  // Handle cropped profile image
  const handleCroppedProfileImage = async (croppedUri: string) => {
    setProfileImage(croppedUri);
    setShowCropper(false);
    setImageToCrop('');

    // Save to AsyncStorage
    try {
      await AsyncStorage.setItem(PROFILE_IMAGE_KEY, croppedUri);
    } catch (error) {
      console.warn('Error saving image:', error);
    }
  };

  const handleOpenSignalGroup = useCallback(async () => {
    const opened = await safeOpenExternalUrl(SIGNAL_GROUP_URL);
    if (!opened) {
      showToast('Impossible d\'ouvrir le lien Signal', 'error');
    }
  }, [showToast]);

  // Generate user code on mount if not exists
  useEffect(() => {
    if (!myCode) {
      generateMyCode();
    }
  }, [myCode, generateMyCode]);

  // Handle claiming a gift code via Supabase
  const handleClaimGiftCode = async () => {
    if (!giftCodeInput.trim()) {
      return;
    }

    // Ensure user has a code
    const userCode = myCode || generateMyCode();

    // Check if Supabase is configured
    if (!isSupabaseSyncConfigured()) {
      setGiftCodeError(true);
      setGiftCodeSuccess(false);
      setTimeout(() => setGiftCodeError(false), 3000);
      return;
    }
    try {
      const result = await claimGiftedLotWithDetails(giftCodeInput.trim().toUpperCase(), userCode);

      if (result.success && result.lot) {

        // Create the product object for collection
        const product = {
          id: result.lot.lotId,
          name: result.lot.lotName,
          description: result.lot.lotDescription || 'Lot gagné',
          producer: 'Cadeau',
          region: 'France',
          rarity: (result.lot.lotRarity || 'common') as 'common' | 'rare' | 'epic' | 'legendary' | 'platinum',
          thcPercent: 0.2,
          cbdPercent: 10,
          image: result.lot.lotImage || 'https://images.unsplash.com/photo-1587049352846-4a222e784d38?w=400',
          value: result.lot.lotValue ?? 0,
        };

        // Create lotInfo with all necessary metadata
        const lotInfo = {
          lotId: result.lot.lotId,
          lotType: (result.lot.lotType || 'product') as 'product' | 'discount',
          discountPercent: result.lot.discountPercent ?? undefined,
          discountAmount: result.lot.discountAmount ?? undefined,
          minOrderAmount: result.lot.minOrderAmount ?? undefined,
        };

        // Add to collection
        addToCollection(product, lotInfo);

        setGiftCodeSuccess(true);
        setGiftCodeError(false);
        setGiftCodeInput('');
        // Award points for claiming
        addPoints(5);
        // Reset success message after 3 seconds
        setTimeout(() => setGiftCodeSuccess(false), 3000);
      } else {
        setGiftCodeError(true);
        setGiftCodeSuccess(false);
        // Reset error message after 3 seconds
        setTimeout(() => setGiftCodeError(false), 3000);
      }
    } catch (error) {
      console.warn('[Profile] Error claiming gift:', error);
      setGiftCodeError(true);
      setGiftCodeSuccess(false);
      setTimeout(() => setGiftCodeError(false), 3000);
    }
  };

  // Calculate stats
  const totalProducts = collection.length;
  const legendaryCount = collection.filter((item) => item.product.rarity === 'legendary').length;
  const platinumCount = collection.filter((item) => item.product.rarity === 'platinum').length;
  const epicCount = collection.filter((item) => item.product.rarity === 'epic').length;
  const totalValue = collection.reduce((sum, item) => sum + item.product.value, 0);

  // Filter orders by period for Pro financial summary
  const getFilteredOrdersForPro = () => {
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const startOfQuarter = new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1).getTime();
    const startOfYear = new Date(now.getFullYear(), 0, 1).getTime();

    return myOrders.filter((order) => {
      if (proPeriodFilter === 'all') return true;
      if (proPeriodFilter === 'day') return order.createdAt >= startOfDay;
      if (proPeriodFilter === 'quarter') return order.createdAt >= startOfQuarter;
      if (proPeriodFilter === 'year') return order.createdAt >= startOfYear;
      return true;
    });
  };

  // Calculate HT and TVA totals for Pro/Producer
  const calculateProFinancials = () => {
    const filteredOrders = getFilteredOrdersForPro();

    let totalTTC = 0;
    let totalTVA = 0;

    filteredOrders.forEach((order) => {
      // Pour les producteurs: ne compter que leurs propres produits
      if (isProducer && myProducer) {
        order.items.forEach((item) => {
          if (item.producerId === myProducer.id) {
            totalTTC += item.totalPrice;
            const tvaRate = item.tvaRate ?? 20;
            const tva = item.totalPrice - (item.totalPrice / (1 + tvaRate / 100));
            totalTVA += tva;
          }
        });
      } else {
        // Pour les pros: compter le total de la commande
        totalTTC += order.total;
        order.items.forEach((item) => {
          const tvaRate = item.tvaRate ?? 20;
          const tva = item.totalPrice - (item.totalPrice / (1 + tvaRate / 100));
          totalTVA += tva;
        });
      }
    });

    const totalHT = totalTTC - totalTVA;
    return { totalHT, totalTVA, totalTTC, orderCount: filteredOrders.length };
  };

  const proFinancials = calculateProFinancials();

  return (
    <View className="flex-1" style={{ paddingTop: insets.top, backgroundColor: COLORS.background.nightSky }}>
      <ScrollView className="flex-1" showsVerticalScrollIndicator={false}>
        {/* Header */}
        <View className="px-6 pt-4 pb-6">
          <Text className="text-white text-2xl font-bold">Profil</Text>
        </View>

        {/* Profile Card */}
        <View className="mx-6 bg-gradient-to-br rounded-3xl overflow-hidden mb-6">
          <View className="bg-teal-900/40 p-6 border border-teal-800/50 rounded-3xl">
            <View className="flex-row items-center">
              <Pressable onPress={handlePickImage} className="active:opacity-80">
                <View className="w-20 h-20 rounded-full bg-teal-600 items-center justify-center border-2 border-teal-400 overflow-hidden">
                  {profileImage ? (
                    <Image
                      source={{ uri: profileImage }}
                      style={{ width: 80, height: 80 }}
                      resizeMode="cover"
                    />
                  ) : (
                    <User size={40} color="#fff" />
                  )}
                </View>
                {/* Camera badge */}
                <View className="absolute bottom-0 right-0 w-7 h-7 rounded-full bg-teal-500 items-center justify-center border-2 border-[#0A0F0D]">
                  <Camera size={14} color="#fff" />
                </View>
              </Pressable>
              <View className="ml-4 flex-1">
                <Text className="text-white text-xl font-bold">
                  {customerInfo.firstName && customerInfo.lastName
                    ? `${customerInfo.firstName} ${customerInfo.lastName}`
                    : 'Collectionneur'}
                </Text>
              </View>
            </View>
          </View>
        </View>

        {/* Auth Section - Hidden for producers (integrated in Ma fiche producteur) */}
        {!isProducer && (
        <View className="mx-6 mb-6">
          <Pressable
            onPress={() => setShowAuthSection(!showAuthSection)}
            className={`flex-row items-center justify-between p-4 rounded-xl border ${
              isAuthenticated
                ? 'bg-emerald-900/30 border-emerald-700/50'
                : 'bg-gray-900/30 border-gray-700/50'
            } active:opacity-70`}
          >
            <View className="flex-row items-center flex-1">
              <View
                className={`w-10 h-10 rounded-full items-center justify-center ${
                  isAuthenticated ? 'bg-emerald-600/30' : 'bg-gray-600/30'
                }`}
              >
                <Shield size={20} color={isAuthenticated ? '#10B981' : '#6B7280'} />
              </View>
              <View className="ml-3 flex-1">
                <Text className="text-white font-semibold">Mes Informations</Text>
                <Text className={`text-sm ${isAuthenticated ? 'text-emerald-400' : 'text-gray-400'}`}>
                  {isAuthenticated
                    ? `Connecté en tant que ${role === 'admin' ? 'Admin' : role === 'pro' ? 'Pro' : role === 'producer' ? 'Producteur' : 'Client'}`
                    : 'Non connecté'}
                </Text>
              </View>
            </View>
            <View className="flex-row items-center">
              {isAuthenticated && (
                <View
                  className="mr-2 px-2 py-1 rounded-full"
                  style={{ backgroundColor: USER_ROLE_COLORS[role as UserRole] }}
                >
                  <Text className="text-white text-xs font-bold">
                    {USER_ROLE_LABELS[role as UserRole]}
                  </Text>
                </View>
              )}
              {showAuthSection ? (
                <ChevronUp size={20} color="#6B7280" />
              ) : (
                <ChevronDown size={20} color="#6B7280" />
              )}
            </View>
          </Pressable>

          {/* Auth Details (collapsible) */}
          {showAuthSection && (
            <View className="mt-3 bg-white/5 rounded-xl p-4 border border-white/10">
              {isAuthenticated ? (
                <>
                  {/* User Info */}
                  <View className="mb-4">
                    <View className="flex-row items-center mb-3">
                      <UserCircle size={18} color="#10B981" />
                      <Text className="text-emerald-400 text-sm ml-2 font-medium">
                        Informations du compte
                      </Text>
                    </View>

                    <View className="bg-white/5 rounded-lg p-3 mb-2">
                      <Text className="text-gray-400 text-xs mb-1">Email</Text>
                      <Text className="text-white">{authEmail || user?.email || 'Non renseigné'}</Text>
                    </View>

                    <View className="bg-white/5 rounded-lg p-3 mb-2">
                      <Text className="text-gray-400 text-xs mb-1">Nom complet</Text>
                      <Text className="text-white">{authFullName || profile?.full_name || 'Non renseigné'}</Text>
                    </View>

                    <View className="flex-row">
                      <View className="flex-1 bg-white/5 rounded-lg p-3 mr-2">
                        <Text className="text-gray-400 text-xs mb-1">Rôle</Text>
                        <Text style={{ color: USER_ROLE_COLORS[role as UserRole] }} className="font-medium">
                          {USER_ROLE_LABELS[role as UserRole]}
                        </Text>
                      </View>
                      {profile?.category && (
                        <View className="flex-1 bg-white/5 rounded-lg p-3 ml-2">
                          <Text className="text-gray-400 text-xs mb-1">Catégorie</Text>
                          <Text className="text-white">
                            {USER_CATEGORY_LABELS[profile.category] || profile.category}
                          </Text>
                        </View>
                      )}
                    </View>
                  </View>

                  {/* SIRET/TVA for Pro/Producer */}
                  {(isPro || isProducer) && (
                    <View className="mb-4">
                      <View className="flex-row items-center mb-3">
                        <Building2 size={18} color={COLORS.accent.teal} />
                        <Text style={{ color: COLORS.accent.teal }} className="text-sm ml-2 font-medium">
                          Informations professionnelles
                        </Text>
                      </View>

                      <View className="bg-white/5 rounded-lg p-3 mb-2">
                        <Text className="text-gray-400 text-xs mb-1">SIRET</Text>
                        <Text className={profile?.siret ? 'text-white' : 'text-amber-400'}>
                          {profile?.siret || 'Non renseigné - requis'}
                        </Text>
                      </View>

                      <View className="bg-white/5 rounded-lg p-3">
                        <Text className="text-gray-400 text-xs mb-1">Numéro TVA (optionnel)</Text>
                        <Text className={profile?.tva_number ? 'text-white' : 'text-gray-500'}>
                          {profile?.tva_number || 'Non renseigné'}
                        </Text>
                      </View>
                    </View>
                  )}

                  {/* Edit Profile Button */}
                  <Pressable
                    onPress={() => router.push('/edit-profile')}
                    className="bg-emerald-600/20 rounded-xl py-3 flex-row items-center justify-center mb-3 active:opacity-70"
                    style={{ borderWidth: 1, borderColor: '#10B98140' }}
                  >
                    <FileText size={18} color="#10B981" />
                    <Text className="text-emerald-400 font-medium ml-2">
                      Modifier mon profil
                    </Text>
                  </Pressable>

                  {/* Logout Button */}
                  <Pressable
                    onPress={() => signOut()}
                    disabled={isSigningOut}
                    className="bg-red-600/20 rounded-xl py-3 flex-row items-center justify-center active:opacity-70"
                    style={{ borderWidth: 1, borderColor: '#EF444440' }}
                  >
                    {isSigningOut ? (
                      <ActivityIndicator size="small" color="#EF4444" />
                    ) : (
                      <>
                        <LogOut size={18} color="#EF4444" />
                        <Text className="text-red-400 font-medium ml-2">
                          Se déconnecter
                        </Text>
                      </>
                    )}
                  </Pressable>
                </>
              ) : (
                <>
                  {/* Not Authenticated - Login/Signup Options */}
                  <View className="mb-4">
                    <Text className="text-gray-400 text-sm text-center mb-4">
                      Créez un compte pour accéder aux fonctionnalités professionnelles et synchroniser vos données.
                    </Text>

                    <Pressable
                      onPress={() => router.push('/auth/signup')}
                      className="rounded-xl py-4 flex-row items-center justify-center mb-3 active:opacity-80"
                      style={{ backgroundColor: COLORS.primary.gold }}
                    >
                      <User size={20} color="#fff" />
                      <Text className="text-white font-bold ml-2">
                        Créer un compte
                      </Text>
                    </Pressable>

                    <Pressable
                      onPress={() => router.push('/auth/login')}
                      className="rounded-xl py-4 flex-row items-center justify-center active:opacity-70"
                      style={{
                        backgroundColor: 'transparent',
                        borderWidth: 1,
                        borderColor: COLORS.primary.paleGold,
                      }}
                    >
                      <Lock size={20} color={COLORS.primary.paleGold} />
                      <Text style={{ color: COLORS.primary.paleGold }} className="font-bold ml-2">
                        Se connecter
                      </Text>
                    </Pressable>
                  </View>

                  {/* Local Code Info */}
                  <View className="bg-white/5 rounded-lg p-3">
                    <Text className="text-gray-400 text-xs mb-1">Code local (actuel)</Text>
                    <Text className="text-white font-mono">{myCode || 'Génération...'}</Text>
                  </View>
                </>
              )}
            </View>
          )}
        </View>
        )}

        {/* Admin Dashboard Section */}
        {isAuthAdmin && (
          <View className="mx-6 mb-6">
            <Pressable
              onPress={() => setShowAdminDashboard(!showAdminDashboard)}
              className="flex-row items-center justify-between p-4 rounded-xl border bg-amber-900/30 border-amber-700/50 active:opacity-70"
            >
              <View className="flex-row items-center flex-1">
                <View className="w-10 h-10 rounded-full items-center justify-center bg-amber-600/30">
                  <BarChart3 size={20} color={COLORS.primary.gold} />
                </View>
                <View className="ml-3 flex-1">
                  <Text className="text-white font-semibold">Dashboard de contrôle</Text>
                  <Text className="text-sm text-amber-400">
                    CA, TVA, Utilisateurs, Statistiques
                  </Text>
                </View>
              </View>
              <View className="flex-row items-center">
                {showAdminDashboard ? (
                  <ChevronUp size={20} color={COLORS.primary.gold} />
                ) : (
                  <ChevronDown size={20} color={COLORS.primary.gold} />
                )}
              </View>
            </Pressable>

            {showAdminDashboard && (
              <View className="mt-3 bg-white/5 rounded-xl p-4 border border-white/10">
                <AdminDashboard
                  onNavigateToUsers={() => {
                    router.push('/(tabs)/admin');
                  }}
                />
              </View>
            )}
          </View>
        )}


        {/* Customer Info Section (for non-authenticated users) */}
        {!isAuthenticated && (
          <View className="mx-6 mb-6">
            <Pressable
              onPress={() => setShowInfoForm(!showInfoForm)}
              className={`flex-row items-center justify-between p-4 rounded-xl border ${
                isProfileComplete()
                  ? 'bg-teal-900/30 border-teal-700/50'
                  : 'bg-amber-900/30 border-amber-700/50'
              } active:opacity-70`}
            >
              <View className="flex-row items-center flex-1">
                <View
                  className={`w-10 h-10 rounded-full items-center justify-center ${
                    isProfileComplete() ? 'bg-teal-600/30' : 'bg-amber-600/30'
                  }`}
                >
                  <User size={20} color={isProfileComplete() ? '#0D9488' : '#F59E0B'} />
                </View>
                <View className="ml-3 flex-1">
                  <Text className="text-white font-semibold">Mes informations</Text>
                  <Text className={`text-sm ${isProfileComplete() ? 'text-teal-400' : 'text-amber-400'}`}>
                    {isProfileComplete() ? 'Profil complet' : 'À compléter pour commander'}
                  </Text>
                </View>
              </View>
              <View className="flex-row items-center">
                {isProfileComplete() && (
                  <View className="mr-2 w-6 h-6 rounded-full bg-teal-500 items-center justify-center">
                    <Check size={14} color="white" />
                  </View>
                )}
                {showInfoForm ? (
                  <ChevronUp size={20} color="#6B7280" />
                ) : (
                  <ChevronDown size={20} color="#6B7280" />
                )}
              </View>
            </Pressable>

            {/* Info Form (collapsible) - for non-authenticated users */}
            {showInfoForm && (
              <View className="mt-3 bg-white/5 rounded-xl p-4 border border-white/10">
                {/* First Name & Last Name */}
                <View className="flex-row mb-3">
                  <View className="flex-1 mr-2">
                    <Text className="text-gray-400 text-xs mb-1">Prénom *</Text>
                    <TextInput
                      value={customerInfo.firstName}
                      onChangeText={(text) => setCustomerInfo({ firstName: text })}
                      placeholder="Jean"
                      placeholderTextColor="#6B7280"
                      className="bg-white/10 rounded-lg px-3 py-3 text-white border border-white/20"
                    />
                  </View>
                  <View className="flex-1 ml-2">
                    <Text className="text-gray-400 text-xs mb-1">Nom *</Text>
                    <TextInput
                      value={customerInfo.lastName}
                      onChangeText={(text) => setCustomerInfo({ lastName: text })}
                      placeholder="Dupont"
                      placeholderTextColor="#6B7280"
                      className="bg-white/10 rounded-lg px-3 py-3 text-white border border-white/20"
                    />
                  </View>
                </View>

                {/* Email */}
                <View className="mb-3">
                  <Text className="text-gray-400 text-xs mb-1">Email *</Text>
                  <View className="flex-row items-center bg-white/10 rounded-lg border border-white/20">
                    <View className="pl-3">
                      <Mail size={18} color="#6B7280" />
                    </View>
                    <TextInput
                      value={customerInfo.email}
                      onChangeText={(text) => setCustomerInfo({ email: text })}
                      placeholder="jean.dupont@email.com"
                      placeholderTextColor="#6B7280"
                      keyboardType="email-address"
                      autoCapitalize="none"
                      className="flex-1 px-3 py-3 text-white"
                    />
                  </View>
                </View>

                {/* Phone */}
                <View className="mb-3">
                  <Text className="text-gray-400 text-xs mb-1">Téléphone *</Text>
                  <View className="flex-row items-center bg-white/10 rounded-lg border border-white/20">
                    <View className="pl-3">
                      <Phone size={18} color="#6B7280" />
                    </View>
                    <TextInput
                      value={customerInfo.phone}
                      onChangeText={(text) => setCustomerInfo({ phone: text })}
                      placeholder="06 12 34 56 78"
                      placeholderTextColor="#6B7280"
                      keyboardType="phone-pad"
                      className="flex-1 px-3 py-3 text-white"
                    />
                  </View>
                </View>

                {/* Address */}
                <View className="mb-3">
                  <Text className="text-gray-400 text-xs mb-1">Adresse *</Text>
                  <View className="flex-row items-center bg-white/10 rounded-lg border border-white/20">
                    <View className="pl-3">
                      <Home size={18} color="#6B7280" />
                    </View>
                    <TextInput
                      value={customerInfo.address}
                      onChangeText={(text) => setCustomerInfo({ address: text })}
                      placeholder="123 Rue de la Paix"
                      placeholderTextColor="#6B7280"
                      className="flex-1 px-3 py-3 text-white"
                    />
                  </View>
                </View>

                {/* City & Postal Code */}
                <View className="flex-row">
                  <View className="flex-1 mr-2">
                    <Text className="text-gray-400 text-xs mb-1">Ville *</Text>
                    <View className="flex-row items-center bg-white/10 rounded-lg border border-white/20">
                      <View className="pl-3">
                        <MapPin size={18} color="#6B7280" />
                      </View>
                      <TextInput
                        value={customerInfo.city}
                        onChangeText={(text) => setCustomerInfo({ city: text })}
                        placeholder="Paris"
                        placeholderTextColor="#6B7280"
                        className="flex-1 px-3 py-3 text-white"
                      />
                    </View>
                  </View>
                  <View className="flex-1 ml-2">
                    <Text className="text-gray-400 text-xs mb-1">Code postal *</Text>
                    <TextInput
                      value={customerInfo.postalCode}
                      onChangeText={(text) => setCustomerInfo({ postalCode: text })}
                      placeholder="75001"
                      placeholderTextColor="#6B7280"
                      keyboardType="number-pad"
                      className="bg-white/10 rounded-lg px-3 py-3 text-white border border-white/20"
                    />
                  </View>
                </View>
              </View>
            )}
          </View>
        )}

        {/* My Orders Section - FOR CLIENTS/PROS ONLY (not producers) */}
        {!isProducer && (
        <View className="mx-6 mb-6">
          <Pressable
            onPress={() => setShowOrders(!showOrders)}
            className="flex-row items-center justify-between p-4 rounded-xl border bg-blue-900/30 border-blue-700/50 active:opacity-70"
          >
            <View className="flex-row items-center flex-1">
              <View className="w-10 h-10 rounded-full items-center justify-center bg-blue-600/30">
                <ShoppingBag size={20} color="#3B82F6" />
              </View>
              <View className="ml-3 flex-1">
                <Text className="text-white font-semibold">Mes commandes</Text>
                <Text className="text-sm text-blue-400">
                  {myOrders.length === 0
                    ? 'Aucune commande'
                    : `${myOrders.length} commande${myOrders.length > 1 ? 's' : ''}`}
                </Text>
              </View>
            </View>
            <View className="flex-row items-center">
              {ordersLoading && (
                <ActivityIndicator size="small" color="#3B82F6" style={{ marginRight: 8 }} />
              )}
              {myOrders.length > 0 && (
                <View className="mr-2 px-2 py-1 rounded-full bg-blue-500">
                  <Text className="text-white text-xs font-bold">{myOrders.length}</Text>
                </View>
              )}
              {showOrders ? (
                <ChevronUp size={20} color="#6B7280" />
              ) : (
                <ChevronDown size={20} color="#6B7280" />
              )}
            </View>
          </Pressable>

          {/* Orders List (collapsible) */}
          {showOrders && (
            <View className="mt-3">
              {/* Bouton de refresh manuel */}
              <Pressable
                onPress={handleManualRefresh}
                disabled={ordersLoading}
                className="flex-row items-center justify-center py-2 px-4 rounded-xl mb-3 active:opacity-70"
                style={{
                  backgroundColor: isProducer ? 'rgba(16, 185, 129, 0.15)' : 'rgba(59, 130, 246, 0.15)',
                  borderWidth: 1,
                  borderColor: isProducer ? 'rgba(16, 185, 129, 0.3)' : 'rgba(59, 130, 246, 0.3)',
                  opacity: ordersLoading ? 0.6 : 1,
                }}
              >
                {ordersLoading ? (
                  <ActivityIndicator size="small" color={isProducer ? '#10B981' : '#3B82F6'} />
                ) : (
                  <RefreshCw size={16} color={isProducer ? '#10B981' : '#3B82F6'} />
                )}
                <Text
                  className="font-medium ml-2 text-sm"
                  style={{ color: isProducer ? '#10B981' : '#3B82F6' }}
                >
                  {ordersLoading ? 'Actualisation...' : 'Actualiser les commandes'}
                </Text>
              </Pressable>

              {/* Pro/Producer Financial Summary */}
              {isProUser && isAuthenticated && myOrders.length > 0 && (
                <View
                  className={`rounded-xl p-4 mb-4 border ${
                    isProducer
                      ? 'bg-emerald-900/30 border-emerald-700/50'
                      : 'bg-indigo-900/30 border-indigo-700/50'
                  }`}
                >
                  <View className="flex-row items-center justify-between mb-3">
                    <View className="flex-row items-center">
                      <FileText size={18} color={isProducer ? '#10B981' : '#818CF8'} />
                      <Text className="text-white font-semibold ml-2">
                        {isProducer ? "Chiffre d'affaires" : 'Récapitulatif financier'}
                      </Text>
                    </View>
                  </View>

                  {/* Period Filter Buttons */}
                  <View className="flex-row mb-4" style={{ gap: 6 }}>
                    {[
                      { key: 'day' as const, label: 'Jour' },
                      { key: 'quarter' as const, label: 'Trimestre' },
                      { key: 'year' as const, label: 'Année' },
                      { key: 'all' as const, label: 'Total' },
                    ].map((period) => (
                      <Pressable
                        key={period.key}
                        onPress={() => setProPeriodFilter(period.key)}
                        className="flex-1 py-2 rounded-lg items-center"
                        style={{
                          backgroundColor: proPeriodFilter === period.key
                            ? (isProducer ? '#10B981' : '#818CF8')
                            : (isProducer ? 'rgba(16, 185, 129, 0.15)' : 'rgba(129, 140, 248, 0.15)'),
                          borderWidth: 1,
                          borderColor: proPeriodFilter === period.key
                            ? (isProducer ? '#10B981' : '#818CF8')
                            : (isProducer ? 'rgba(16, 185, 129, 0.3)' : 'rgba(129, 140, 248, 0.3)'),
                        }}
                      >
                        <Text
                          className="text-xs font-medium"
                          style={{
                            color: proPeriodFilter === period.key
                              ? '#fff'
                              : (isProducer ? '#10B981' : '#818CF8')
                          }}
                        >
                          {period.label}
                        </Text>
                      </Pressable>
                    ))}
                  </View>

                  {/* Financial Summary */}
                  <View className="bg-white/5 rounded-lg p-3 mb-3">
                    <View className="flex-row justify-between items-center mb-2">
                      <Text className="text-gray-400 text-sm">
                        {isProducer ? 'Commandes reçues' : 'Commandes'}
                      </Text>
                      <Text className="text-white font-medium">{proFinancials.orderCount}</Text>
                    </View>
                    <View className="flex-row justify-between items-center mb-2">
                      <Text className="text-gray-400 text-sm">
                        {isProducer ? 'CA HT' : 'Total HT'}
                      </Text>
                      <Text
                        className="font-bold text-lg"
                        style={{ color: isProducer ? '#10B981' : '#A5B4FC' }}
                      >
                        {proFinancials.totalHT.toFixed(2)}€
                      </Text>
                    </View>
                    <View className="flex-row justify-between items-center pb-2 border-b border-white/10">
                      <Text className="text-gray-400 text-sm">
                        {isProducer ? 'TVA collectée' : 'TVA'}
                      </Text>
                      <Text className="text-amber-400 font-medium">{proFinancials.totalTVA.toFixed(2)}€</Text>
                    </View>
                    <View className="flex-row justify-between items-center pt-2">
                      <Text className="text-gray-400 text-sm">
                        {isProducer ? 'CA TTC' : 'Total TTC'}
                      </Text>
                      <Text className="text-white font-bold">{proFinancials.totalTTC.toFixed(2)}€</Text>
                    </View>
                  </View>

                  <Text className="text-gray-500 text-xs text-center">
                    {proPeriodFilter === 'day' && "Aujourd'hui"}
                    {proPeriodFilter === 'quarter' && 'Ce trimestre'}
                    {proPeriodFilter === 'year' && 'Cette année'}
                    {proPeriodFilter === 'all' && 'Depuis la création du compte'}
                  </Text>
                </View>
              )}

              {myOrders.length === 0 ? (
                <View className="bg-white/5 rounded-xl p-6 items-center border border-white/10">
                  <ShoppingBag size={40} color="#6B7280" />
                  <Text className="text-gray-400 text-center mt-3">
                    {isProducer
                      ? "Vous n'avez pas encore reçu de commande"
                      : "Vous n'avez pas encore passé de commande"}
                  </Text>
                </View>
              ) : (
                myOrders
                  .sort((a, b) => b.createdAt - a.createdAt)
                  .map((order) => {
                    const statusConfig = ORDER_STATUS_CONFIG[order.status];
                    const orderDate = new Date(order.createdAt).toLocaleDateString('fr-FR', {
                      day: 'numeric',
                      month: 'short',
                      year: 'numeric',
                    });

                    // Status icon based on order status
                    const StatusIcon = () => {
                      switch (order.status) {
                        case 'pending':
                          return <Clock size={16} color={statusConfig.color} />;
                        case 'payment_sent':
                          return <Mail size={16} color={statusConfig.color} />;
                        case 'paid':
                          return <CreditCard size={16} color={statusConfig.color} />;
                        case 'shipped':
                          return <Truck size={16} color={statusConfig.color} />;
                        case 'cancelled':
                          return <XCircle size={16} color={statusConfig.color} />;
                        default:
                          return <Clock size={16} color={statusConfig.color} />;
                      }
                    };

                    return (
                      <View
                        key={order.id}
                        className="bg-white/5 rounded-xl p-4 mb-3 border"
                        style={{ borderColor: `${statusConfig.color}40` }}
                      >
                        {/* Order Header */}
                        <View className="flex-row items-center justify-between mb-3">
                          <View className="flex-row items-center">
                            <StatusIcon />
                            <Text
                              className="font-medium text-sm ml-2"
                              style={{ color: statusConfig.color }}
                            >
                              {statusConfig.label}
                            </Text>
                          </View>
                          <Text className="text-gray-500 text-xs">{orderDate}</Text>
                        </View>

                        {/* Progress Bar */}
                        <View className="mb-3">
                          <View className="flex-row items-center justify-between mb-2">
                            {(['pending', 'payment_sent', 'paid', 'shipped'] as OrderStatus[]).map(
                              (status, index) => {
                                const config = ORDER_STATUS_CONFIG[status];
                                const currentStep = ORDER_STATUS_CONFIG[order.status].step;
                                const stepNumber = config.step;
                                const isCompleted = currentStep >= stepNumber && order.status !== 'cancelled';
                                const isCurrent = order.status === status;

                                return (
                                  <View key={status} className="items-center flex-1">
                                    <View
                                      className="w-6 h-6 rounded-full items-center justify-center"
                                      style={{
                                        backgroundColor: isCompleted ? config.color : '#374151',
                                        borderWidth: isCurrent ? 2 : 0,
                                        borderColor: '#fff',
                                      }}
                                    >
                                      {isCompleted && <Check size={12} color="#fff" />}
                                    </View>
                                    {index < 3 && (
                                      <View
                                        className="absolute top-3 h-0.5"
                                        style={{
                                          left: '60%',
                                          right: '-40%',
                                          backgroundColor: currentStep > stepNumber ? ORDER_STATUS_CONFIG[(['pending', 'payment_sent', 'paid', 'shipped'] as OrderStatus[])[index + 1]].color : '#374151',
                                        }}
                                      />
                                    )}
                                  </View>
                                );
                              }
                            )}
                          </View>
                          <View className="flex-row justify-between px-1">
                            <Text className="text-gray-500 text-[10px] text-center flex-1">Attente</Text>
                            <Text className="text-gray-500 text-[10px] text-center flex-1">Paiement</Text>
                            <Text className="text-gray-500 text-[10px] text-center flex-1">Préparation</Text>
                            <Text className="text-gray-500 text-[10px] text-center flex-1">Envoyée</Text>
                          </View>
                        </View>

                        {/* Status Description */}
                        <Text className="text-gray-400 text-xs mb-3">
                          {statusConfig.description}
                        </Text>

                        {/* Tracking Number (if shipped) */}
                        {order.status === 'shipped' && order.trackingNumber && (
                          <View
                            className="rounded-lg p-3 mb-3"
                            style={{ backgroundColor: `${ORDER_STATUS_CONFIG.shipped.color}20` }}
                          >
                            <View className="flex-row items-center justify-between">
                              <View className="flex-row items-center">
                                <Truck size={16} color={ORDER_STATUS_CONFIG.shipped.color} />
                                <Text
                                  className="ml-2 font-medium"
                                  style={{ color: ORDER_STATUS_CONFIG.shipped.color }}
                                >
                                  Numéro de suivi
                                </Text>
                              </View>
                              <Pressable
                                onPress={async () => {
                                  await Clipboard.setStringAsync(order.trackingNumber || '');
                                  setCopiedTrackingId(order.id);
                                  setTimeout(() => setCopiedTrackingId(null), 2000);
                                }}
                                className="flex-row items-center px-3 py-1.5 rounded-lg active:opacity-70"
                                style={{
                                  backgroundColor: copiedTrackingId === order.id
                                    ? ORDER_STATUS_CONFIG.shipped.color
                                    : `${ORDER_STATUS_CONFIG.shipped.color}30`,
                                }}
                              >
                                {copiedTrackingId === order.id ? (
                                  <>
                                    <Check size={14} color="#fff" />
                                    <Text className="text-white text-xs font-medium ml-1">Copié</Text>
                                  </>
                                ) : (
                                  <>
                                    <Copy size={14} color={ORDER_STATUS_CONFIG.shipped.color} />
                                    <Text
                                      className="text-xs font-medium ml-1"
                                      style={{ color: ORDER_STATUS_CONFIG.shipped.color }}
                                    >
                                      Copier
                                    </Text>
                                  </>
                                )}
                              </Pressable>
                            </View>

                            {/* Lien Mondial Relay */}
                            <Pressable
                              onPress={() => {
                                void safeOpenExternalUrl('https://www.mondialrelay.fr/suivi-de-colis');
                              }}
                              className="flex-row items-center mt-2 active:opacity-70"
                            >
                              <ExternalLink size={14} color="#60A5FA" />
                              <Text className="text-blue-400 text-sm ml-1.5 underline">
                                Suivre mon colis sur Mondial Relay
                              </Text>
                            </Pressable>

                            <Text className="text-white font-bold mt-2" selectable>{order.trackingNumber}</Text>
                          </View>
                        )}

                        {/* Order Items Summary */}
                        <View className="border-t border-white/10 pt-3">
                          <Text className="text-gray-400 text-xs mb-2">
                            {order.items.length} article{order.items.length > 1 ? 's' : ''}
                          </Text>
                          {order.items.slice(0, 2).map((item, idx) => (
                            <Text key={idx} className="text-white text-sm" numberOfLines={1}>
                              {item.quantity}x {item.productName}
                            </Text>
                          ))}
                          {order.items.length > 2 && (
                            <Text className="text-gray-500 text-xs">
                              +{order.items.length - 2} autre{order.items.length - 2 > 1 ? 's' : ''}
                            </Text>
                          )}
                        </View>

                        {/* Order Total */}
                        <View className="mt-3 pt-3 border-t border-white/10">
                          {/* TVA due à l'État */}
                          <View
                            className="flex-row items-center justify-between py-2 px-3 rounded-lg mb-2"
                            style={{ backgroundColor: 'rgba(199, 91, 91, 0.15)', borderWidth: 1, borderColor: 'rgba(199, 91, 91, 0.4)' }}
                          >
                            <Text style={{ color: '#C75B5B' }} className="text-sm font-semibold">TVA due à l'État</Text>
                            <Text style={{ color: '#C75B5B' }} className="font-bold">
                              {order.items.reduce((sum, item) => {
                                const tvaRate = item.tvaRate ?? 20;
                                const tva = item.totalPrice - (item.totalPrice / (1 + tvaRate / 100));
                                return sum + tva;
                              }, 0).toFixed(2)}€
                            </Text>
                          </View>
                          <View className="flex-row items-center justify-between">
                            <Text className="text-gray-400">Total</Text>
                            <Text className="text-amber-400 font-bold text-lg">
                              {order.total.toFixed(2)}€
                            </Text>
                          </View>
                        </View>
                      </View>
                    );
                  })
              )}
            </View>
          )}
        </View>
        )}

        {/* Local Market Orders Section - FOR CLIENTS */}
        {!isProducer && isAuthenticated && (
          <View className="mx-6 mb-6">
            <Pressable
              onPress={() => router.push('/mes-commandes-marche-local')}
              className="flex-row items-center justify-between p-4 rounded-xl border bg-orange-900/30 border-orange-700/50 active:opacity-70"
            >
              <View className="flex-row items-center flex-1">
                <View className="w-10 h-10 rounded-full items-center justify-center bg-orange-600/30">
                  <MapPin size={20} color="#F97316" />
                </View>
                <View className="ml-3 flex-1">
                  <Text className="text-white font-semibold">
                    Marché Local
                  </Text>
                  <Text className="text-orange-400 text-sm">
                    Commandes directes producteurs
                  </Text>
                </View>
              </View>
              <ChevronRight size={20} color="#F97316" />
            </Pressable>
          </View>
        )}

        {/* PRODUCER SECTION - Simplified Accès rapide */}
        {isProducer && isAuthenticated && (
          <View className="mx-6 mb-6">
            <View className="bg-amber-900/15 rounded-2xl p-4 border border-amber-600/40">

              {/* Ma Fiche Producteur */}
              <Pressable
                onPress={() => setShowProducerProfile(!showProducerProfile)}
                className="flex-row items-center py-2.5 px-3 rounded-xl mb-2 active:opacity-70"
                style={{
                  backgroundColor: isProducerProfileIncomplete ? 'rgba(239, 68, 68, 0.18)' : 'rgba(251, 146, 60, 0.22)',
                  borderWidth: 1,
                  borderColor: isProducerProfileIncomplete ? 'rgba(239, 68, 68, 0.25)' : 'rgba(251, 146, 60, 0.35)'
                }}
              >
                <View
                  className="w-8 h-8 rounded-full items-center justify-center"
                  style={{ backgroundColor: isProducerProfileIncomplete ? 'rgba(239, 68, 68, 0.3)' : 'rgba(251, 146, 60, 0.3)' }}
                >
                  <UserCircle size={16} color={isProducerProfileIncomplete ? '#EF4444' : '#FB923C'} />
                </View>
                <Text className="text-white text-sm font-medium ml-2.5 flex-1">Mes Infos</Text>
                {isProducerProfileIncomplete && (
                  <View className="bg-red-500 rounded-full w-5 h-5 items-center justify-center mr-1.5">
                    <Text className="text-white text-[10px] font-bold">!</Text>
                  </View>
                )}
                {showProducerProfile ? (
                  <ChevronUp size={16} color={isProducerProfileIncomplete ? '#EF4444' : '#FB923C'} />
                ) : (
                  <ChevronDown size={16} color={isProducerProfileIncomplete ? '#EF4444' : '#FB923C'} />
                )}
              </Pressable>

              {/* Formulaire fiche producteur (collapsible) */}
              {showProducerProfile && (
                <View className="mb-2 bg-orange-900/25 rounded-xl p-3 border border-orange-600/40">
                  {/* Informations du compte */}
                  <View className="mb-4 pb-3 border-b border-orange-700/30">
                    <View className="flex-row items-center mb-2">
                      <UserCircle size={14} color="#F59E0B" />
                      <Text className="text-amber-400 text-xs ml-1.5 font-medium">Mon compte</Text>
                    </View>
                    <View className="flex-row mb-2">
                      <View className="flex-1 bg-white/10 rounded-lg p-2 mr-1">
                        <Text className="text-amber-200 text-[10px]">Email</Text>
                        <Text className="text-white text-xs" numberOfLines={1}>{authEmail || 'Non renseigné'}</Text>
                      </View>
                      <View className="flex-1 bg-white/10 rounded-lg p-2 ml-1">
                        <Text className="text-amber-200 text-[10px]">Rôle</Text>
                        <Text className="text-amber-400 text-xs font-medium">Producteur</Text>
                      </View>
                    </View>
                    <View className="flex-row">
                      <Pressable
                        onPress={() => router.push('/edit-profile')}
                        className="flex-1 bg-amber-600/20 rounded-lg py-2 flex-row items-center justify-center mr-1 active:opacity-70"
                      >
                        <FileText size={12} color="#F59E0B" />
                        <Text className="text-amber-300 text-xs font-medium ml-1">Modifier</Text>
                      </Pressable>
                      <Pressable
                        onPress={() => signOut()}
                        disabled={isSigningOut}
                        className="flex-1 bg-red-600/15 rounded-lg py-2 flex-row items-center justify-center ml-1 active:opacity-70"
                      >
                        {isSigningOut ? (
                          <ActivityIndicator size="small" color="#EF4444" />
                        ) : (
                          <>
                            <LogOut size={12} color="#EF4444" />
                            <Text className="text-red-400 text-xs font-medium ml-1">Déconnexion</Text>
                          </>
                        )}
                      </Pressable>
                    </View>
                  </View>

                  <ProducerProfileForm
                    profile={profile ?? null}
                    email={authEmail}
                    onSave={async (data) => {
                      // 1. Mettre à jour le profil utilisateur (table profiles)
                      await updateProfile(data);

                      // 2. Mettre à jour aussi la table producers si le producteur existe
                      if (myProducer?.id) {
                        try {
                          await updateMyProducer(myProducer.id, {
                            name: data.company_name || data.full_name || myProducer.name,
                            city: data.city || null,
                            siret: data.siret || null,
                          });
                          // Rafraîchir les données du producteur
                          await queryClient.invalidateQueries({ queryKey: ['producer'] });
                        } catch (err) {
                          console.warn('[Profile] Error updating producer:', err);
                        }
                      }

                      showToast('Fiche producteur mise à jour', 'success');
                    }}
                    isSaving={isUpdatingProfile}
                  />
                </View>
              )}

              {/* Dashboard clients producteur */}
              <View className="mt-2 bg-amber-950/25 rounded-xl p-3 border border-amber-700/40">
                <View className="flex-row items-center mb-2">
                  <View className="w-7 h-7 rounded-full items-center justify-center bg-amber-500/30">
                    <Users size={14} color="#F59E0B" />
                  </View>
                  <Text className="text-amber-100 text-sm font-semibold ml-2">Mes Clients</Text>
                </View>

                <View className="flex-row" style={{ gap: 8 }}>
                  <View className="flex-1 bg-white/10 rounded-lg p-2 items-center border border-white/10">
                    <Text className="text-white text-lg font-bold">{producerLocalClients.length}</Text>
                    <Text className="text-amber-100 text-[10px]">Clients particuliers</Text>
                  </View>
                  <View className="flex-1 bg-white/10 rounded-lg p-2 items-center border border-white/10">
                    <Text className="text-white text-lg font-bold">{producerProClients.length}</Text>
                    <Text className="text-amber-100 text-[10px]">Clients pro</Text>
                  </View>
                </View>

                <Pressable
                  onPress={() => setShowProducerClients(!showProducerClients)}
                  className="flex-row items-center justify-between mt-3 p-2 rounded-lg bg-amber-500/20 active:opacity-70"
                >
                  <Text className="text-amber-100 text-xs font-medium">Clients particuliers</Text>
                  <View className="flex-row items-center">
                    <Text className="text-amber-100 text-xs mr-2">{producerLocalClients.length}</Text>
                    {showProducerClients ? (
                      <ChevronUp size={14} color="#F59E0B" />
                    ) : (
                      <ChevronDown size={14} color="#F59E0B" />
                    )}
                  </View>
                </Pressable>

                {showProducerClients && (
                  <View className="mt-2">
                    {producerLocalClients.length === 0 ? (
                      <Text className="text-amber-100 text-xs text-center py-2">Aucun client particulier</Text>
                    ) : (
                      producerLocalClients.slice(0, producerClientListMax).map((client, index) => (
                        <View key={`${client.email ?? client.name}-${index}`} className="flex-row items-center justify-between bg-white/10 rounded-lg p-2 mb-1.5 border border-white/5">
                          <View className="flex-1 mr-2">
                            <Text className="text-white text-xs font-semibold" numberOfLines={1}>{client.name}</Text>
                            {client.email && (
                              <Text className="text-amber-100 text-[10px]" numberOfLines={1}>{client.email}</Text>
                            )}
                          </View>
                          <View className="flex-row items-center">
                            <Pressable
                              onPress={() => openMailTo(client.email)}
                              className="w-7 h-7 rounded-full items-center justify-center mr-2 active:opacity-70"
                              style={{ backgroundColor: 'rgba(217, 119, 6, 0.2)', opacity: client.email ? 1 : 0.4 }}
                            >
                              <Mail size={12} color={client.email ? '#D97706' : '#94A3B8'} />
                            </Pressable>
                            <Pressable
                              onPress={() => openTel(client.phone)}
                              className="w-7 h-7 rounded-full items-center justify-center active:opacity-70"
                              style={{ backgroundColor: 'rgba(234, 88, 12, 0.2)', opacity: client.phone ? 1 : 0.4 }}
                            >
                              <Phone size={12} color={client.phone ? '#EA580C' : '#94A3B8'} />
                            </Pressable>
                          </View>
                        </View>
                      ))
                    )}
                    {producerLocalClients.length > producerClientListMax && (
                      <Text className="text-amber-100 text-[10px] text-center mt-1">
                        +{producerLocalClients.length - producerClientListMax} autres clients
                      </Text>
                    )}
                  </View>
                )}

                <Pressable
                  onPress={() => setShowProducerProClients(!showProducerProClients)}
                  className="flex-row items-center justify-between mt-3 p-2 rounded-lg bg-orange-500/20 active:opacity-70"
                >
                  <Text className="text-amber-100 text-xs font-medium">Clients pro</Text>
                  <View className="flex-row items-center">
                    <Text className="text-amber-100 text-xs mr-2">{producerProClients.length}</Text>
                    {showProducerProClients ? (
                      <ChevronUp size={14} color="#FB923C" />
                    ) : (
                      <ChevronDown size={14} color="#FB923C" />
                    )}
                  </View>
                </Pressable>

                {showProducerProClients && (
                  <View className="mt-2">
                    {producerProClients.length === 0 ? (
                      <Text className="text-amber-100 text-xs text-center py-2">Aucun client pro</Text>
                    ) : (
                      producerProClients.slice(0, producerClientListMax).map((client, index) => (
                        <View key={`${client.email ?? client.name}-${index}`} className="flex-row items-center justify-between bg-white/10 rounded-lg p-2 mb-1.5 border border-white/5">
                          <View className="flex-1 mr-2">
                            <Text className="text-white text-xs font-semibold" numberOfLines={1}>{client.name}</Text>
                            {client.email && (
                              <Text className="text-amber-100 text-[10px]" numberOfLines={1}>{client.email}</Text>
                            )}
                          </View>
                          <View className="flex-row items-center">
                            <Pressable
                              onPress={() => openMailTo(client.email)}
                              className="w-7 h-7 rounded-full items-center justify-center mr-2 active:opacity-70"
                              style={{ backgroundColor: 'rgba(217, 119, 6, 0.2)', opacity: client.email ? 1 : 0.4 }}
                            >
                              <Mail size={12} color={client.email ? '#D97706' : '#94A3B8'} />
                            </Pressable>
                            <Pressable
                              onPress={() => openTel(client.phone)}
                              className="w-7 h-7 rounded-full items-center justify-center active:opacity-70"
                              style={{ backgroundColor: 'rgba(234, 88, 12, 0.2)', opacity: client.phone ? 1 : 0.4 }}
                            >
                              <Phone size={12} color={client.phone ? '#EA580C' : '#94A3B8'} />
                            </Pressable>
                          </View>
                        </View>
                      ))
                    )}
                    {producerProClients.length > producerClientListMax && (
                      <Text className="text-amber-100 text-[10px] text-center mt-1">
                        +{producerProClients.length - producerClientListMax} autres clients
                      </Text>
                    )}
                  </View>
                )}
              </View>
            </View>
          </View>
        )}



        {/* Referral Card - ONLY FOR CLIENTS */}
        {isClient && (
        <View className="mx-6 bg-amber-900/30 rounded-2xl p-4 mb-6 border border-amber-700/50">
          <View className="flex-row items-center justify-between">
            <View className="flex-row items-center">
              <Gift size={24} color="#D4AF37" />
              <Text className="text-white font-semibold ml-2">Parrainage</Text>
            </View>
            <View className="bg-amber-600/30 px-3 py-1 rounded-full">
              <Text className="text-amber-400 font-bold">{referralPoints} pts</Text>
            </View>
          </View>
          <View className="flex-row mt-3" style={{ gap: 12 }}>
            <View className="flex-1 bg-white/5 rounded-xl p-3 items-center">
              <Text className="text-amber-400 text-2xl font-bold">{giftsSent.length}</Text>
              <Text className="text-gray-400 text-xs">Cadeaux envoyés</Text>
            </View>
            <View className="flex-1 bg-white/5 rounded-xl p-3 items-center">
              <Text className="text-amber-400 text-2xl font-bold">{giftsReceived.length}</Text>
              <Text className="text-gray-400 text-xs">Cadeaux reçus</Text>
            </View>
            <View className="flex-1 bg-white/5 rounded-xl p-3 items-center">
              <Text className="text-amber-400 text-2xl font-bold">{giftsSent.filter(g => g.used).length}</Text>
              <Text className="text-gray-400 text-xs">Utilisés</Text>
            </View>
          </View>
          <Text className="text-gray-500 text-xs mt-2 text-center">
            Gagnez 10 pts quand un ami utilise votre cadeau
          </Text>

          {/* Gift Code Input Section */}
          <View className="mt-4 pt-4 border-t border-amber-700/30">
            <Text className="text-gray-400 text-sm mb-2">Entrer un code cadeau</Text>
            <View className="flex-row" style={{ gap: 8 }}>
              <TextInput
                className="flex-1 bg-white/10 rounded-xl px-4 py-3 text-white"
                placeholder="Ex: GIFT-XXXX-XXXX"
                placeholderTextColor="#6B7280"
                value={giftCodeInput}
                onChangeText={(text) => {
                  setGiftCodeInput(text);
                }}
                autoCapitalize="characters"
              />
              <Pressable
                onPress={handleClaimGiftCode}
                className="bg-amber-600 rounded-xl px-6 items-center justify-center active:opacity-70"
                style={{ minWidth: 60 }}
              >
                <Check size={24} color="#FFFFFF" />
              </Pressable>
            </View>
            {giftCodeError && (
              <Text className="text-red-400 text-xs mt-2">
                Code invalide ou déjà utilisé
              </Text>
            )}
            {giftCodeSuccess && (
              <Text className="text-green-400 text-xs mt-2">
                Cadeau réclamé avec succès !
              </Text>
            )}
          </View>
        </View>
        )}

        {/* Ma Collection Section - ONLY FOR CLIENTS */}
        {isClient && (
        <View className="mx-6 mb-6">
          <View className="flex-row items-center justify-between mb-3">
            <View className="flex-row items-center">
              <Grid3X3 size={20} color="#D4AF37" />
              <Text className="text-white text-lg font-bold ml-2">Ma Collection</Text>
            </View>
            <Pressable
              onPress={() => router.push('/(tabs)/collection')}
              className="flex-row items-center active:opacity-70"
            >
              <Text className="text-teal-400 text-sm font-medium mr-1">Voir tout</Text>
              <ChevronRight size={16} color="#0D9488" />
            </Pressable>
          </View>

          {/* Rarity breakdown mini cards */}
          <View className="flex-row" style={{ gap: 8 }}>
            {(Object.keys(RARITY_CONFIG) as Rarity[]).map((rarity) => {
              const count = collection.filter((item) => item.product.rarity === rarity).length;
              const config = RARITY_CONFIG[rarity];
              return (
                <View
                  key={rarity}
                  style={{
                    flex: 1,
                    backgroundColor: config.bgColor,
                    borderWidth: 1,
                    borderColor: config.borderColor,
                    borderRadius: 12,
                    padding: 12,
                    alignItems: 'center',
                  }}
                >
                  <Text style={{ color: config.color, fontSize: 20, fontWeight: 'bold' }}>
                    {count}
                  </Text>
                  <Text className="text-gray-500 text-xs mt-1">{config.label}</Text>
                </View>
              );
            })}
          </View>

          {/* View Collection Button */}
          <Pressable
            onPress={() => router.push('/(tabs)/collection')}
            className="mt-4 bg-amber-900/40 border border-amber-700/50 rounded-xl p-4 flex-row items-center justify-between active:opacity-70"
          >
            <View className="flex-row items-center">
              <View className="w-10 h-10 rounded-full bg-amber-600/30 items-center justify-center">
                <Package size={20} color="#D4AF37" />
              </View>
              <View className="ml-3">
                <Text className="text-white font-semibold">{totalProducts} produits</Text>
                <Text className="text-gray-400 text-sm">dans votre collection</Text>
              </View>
            </View>
            <ChevronRight size={20} color="#D4AF37" />
          </Pressable>
        </View>
        )}

        {/* Tickets Section - ONLY FOR CLIENTS */}
        {isClient && (
        <View className="mx-6 mb-6">
          <Text className="text-white text-lg font-bold mb-3">Mes Tickets</Text>

          {/* Current Tickets */}
          <View className="bg-amber-900/30 rounded-2xl p-4 border border-amber-700/50">
            <View className="flex-row items-center justify-between">
              <View className="flex-row items-center">
                <View className="w-12 h-12 rounded-full bg-amber-600/30 items-center justify-center">
                  <Ticket size={24} color="#F59E0B" />
                </View>
                <View className="ml-3">
                  <Text className="text-white font-semibold">Tickets disponibles</Text>
                  <Text className="text-gray-400 text-sm">1 ticket par 20€ d'achat</Text>
                </View>
              </View>
              <View className="bg-amber-500 px-4 py-2 rounded-xl">
                <Text className="text-white text-2xl font-bold">{tickets}</Text>
              </View>
            </View>
          </View>
        </View>
        )}

        {/* Menu Items */}
        <View className="mx-6 mb-8">
          {isProUser && (
            <View className="mb-4 rounded-2xl p-4 border" style={{ backgroundColor: 'rgba(16, 185, 129, 0.12)', borderColor: 'rgba(16, 185, 129, 0.35)' }}>
              <View className="flex-row items-start">
                <View className="w-10 h-10 rounded-full items-center justify-center mr-3" style={{ backgroundColor: 'rgba(16, 185, 129, 0.25)' }}>
                  <Users size={20} color="#10B981" />
                </View>
                <View className="flex-1">
                  <Text className="text-white font-semibold">Des questions ? Des idées ? Besoin d'aide ?</Text>
                  <Text className="text-emerald-200 text-sm mt-1">Rejoins la commu sur Signal</Text>
                </View>
              </View>
              <Pressable
                onPress={handleOpenSignalGroup}
                className="mt-3 py-2.5 rounded-xl items-center justify-center active:opacity-80"
                style={{ backgroundColor: '#10B981' }}
              >
                <Text className="text-white font-bold">Rejoindre le groupe Signal</Text>
              </Pressable>
            </View>
          )}
          <MenuItem
            icon={<Settings size={20} color="#0D9488" />}
            label="Paramètres"
            onPress={() => router.push('/(tabs)/settings')}
          />
        </View>
      </ScrollView>

      {/* Image Cropper Modal */}
      <ImageCropper
        visible={showCropper}
        imageUri={imageToCrop}
        aspectRatio={1}
        onCrop={handleCroppedProfileImage}
        onCancel={() => {
          setShowCropper(false);
          setImageToCrop('');
        }}
      />

      {/* Toast pour les notifications */}
      <Toast
        visible={toast.visible}
        message={toast.message}
        type={toast.type}
        onHide={hideToast}
        position="top"
      />
    </View>
  );
}
