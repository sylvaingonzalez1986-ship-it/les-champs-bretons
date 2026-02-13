import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  View,
  ScrollView,
  Pressable,
  Image,
  ActivityIndicator,
  Dimensions,
  FlatList,
  RefreshControl,
} from 'react-native';
import { Text } from '@/components/ui';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import {
  MapPin,
  Store,
  ShoppingCart,
  ShoppingBag,
  ClipboardList,
  Sparkles,
  X,
  Leaf,
  Layers,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  Map as MapIcon,
} from 'lucide-react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { COLORS } from '@/lib/colors';
import { SUPABASE_URL, SUPABASE_ANON_KEY, getValidSession } from '@/lib/supabase-auth';
import { useDirectSalesCart } from '@/lib/direct-sales-cart';
import { usePermissions } from '@/lib/useAuth';
import { PriceTier } from '@/lib/producers';
import Animated, {
  FadeIn,
  FadeInDown,
  FadeInUp,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
  interpolate,
  Extrapolation,
} from 'react-native-reanimated';
import { getImageSource } from '@/lib/asset-images';
import { optimizeImageSource, optimizeImageUrl } from '@/lib/image-utils';
import { CultureTypeIcons } from '@/components/CultureTypeIcons';
import { getSignedProductImageUrl } from '@/lib/supabase-product-images';
import { getSignedImageUrl } from '@/lib/storage-utils';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const CARD_WIDTH = SCREEN_WIDTH * 0.715;
const CARD_HEIGHT = CARD_WIDTH * 1.35;
const CARD_SPACING = 16;

// Liste des noms de départements français
const DEPARTMENT_NAMES: Record<string, string> = {
  '01': 'Ain', '02': 'Aisne', '03': 'Allier', '04': 'Alpes-de-Haute-Provence',
  '05': 'Hautes-Alpes', '06': 'Alpes-Maritimes', '07': 'Ardèche', '08': 'Ardennes',
  '09': 'Ariège', '10': 'Aube', '11': 'Aude', '12': 'Aveyron',
  '13': 'Bouches-du-Rhône', '14': 'Calvados', '15': 'Cantal', '16': 'Charente',
  '17': 'Charente-Maritime', '18': 'Cher', '19': 'Corrèze', '2A': 'Corse-du-Sud',
  '2B': 'Haute-Corse', '21': 'Côte-d\'Or', '22': 'Côtes-d\'Armor', '23': 'Creuse',
  '24': 'Dordogne', '25': 'Doubs', '26': 'Drôme', '27': 'Eure',
  '28': 'Eure-et-Loir', '29': 'Finistère', '30': 'Gard', '31': 'Haute-Garonne',
  '32': 'Gers', '33': 'Gironde', '34': 'Hérault', '35': 'Ille-et-Vilaine',
  '36': 'Indre', '37': 'Indre-et-Loire', '38': 'Isère', '39': 'Jura',
  '40': 'Landes', '41': 'Loir-et-Cher', '42': 'Loire', '43': 'Haute-Loire',
  '44': 'Loire-Atlantique', '45': 'Loiret', '46': 'Lot', '47': 'Lot-et-Garonne',
  '48': 'Lozère', '49': 'Maine-et-Loire', '50': 'Manche', '51': 'Marne',
  '52': 'Haute-Marne', '53': 'Mayenne', '54': 'Meurthe-et-Moselle', '55': 'Meuse',
  '56': 'Morbihan', '57': 'Moselle', '58': 'Nièvre', '59': 'Nord',
  '60': 'Oise', '61': 'Orne', '62': 'Pas-de-Calais', '63': 'Puy-de-Dôme',
  '64': 'Pyrénées-Atlantiques', '65': 'Hautes-Pyrénées', '66': 'Pyrénées-Orientales',
  '67': 'Bas-Rhin', '68': 'Haut-Rhin', '69': 'Rhône', '70': 'Haute-Saône',
  '71': 'Saône-et-Loire', '72': 'Sarthe', '73': 'Savoie', '74': 'Haute-Savoie',
  '75': 'Paris', '76': 'Seine-Maritime', '77': 'Seine-et-Marne', '78': 'Yvelines',
  '79': 'Deux-Sèvres', '80': 'Somme', '81': 'Tarn', '82': 'Tarn-et-Garonne',
  '83': 'Var', '84': 'Vaucluse', '85': 'Vendée', '86': 'Vienne',
  '87': 'Haute-Vienne', '88': 'Vosges', '89': 'Yonne', '90': 'Territoire de Belfort',
  '91': 'Essonne', '92': 'Hauts-de-Seine', '93': 'Seine-Saint-Denis',
  '94': 'Val-de-Marne', '95': 'Val-d\'Oise',
};

interface DirectSalesProducer {
  id: string;
  name: string;
  city: string;
  region: string;
  department: string;
  image: string;
  vente_directe_ferme: boolean;
  adresse_retrait: string | null;
  horaires_retrait: string | null;
  instructions_retrait: string | null;
  shipping_enabled?: boolean | null;
  shipping_fee?: number | null;
  shipping_note?: string | null;
  soil_type?: string;
  climate_type?: string;
  culture_outdoor?: boolean;
  culture_greenhouse?: boolean;
  culture_indoor?: boolean;
  profile_id?: string;
  profile?: {
    company_name: string | null;
    business_name: string | null;
  };
  products?: DirectSalesProduct[];
}

type DirectSalesProduct = {
  id: string;
  name: string;
  price_public: number;
  price_pro?: number;
  image: string;
  description: string;
  disponible_vente_directe: boolean;
  stock?: number;
  ville_retrait?: string;
  price_tiers?: PriceTier[];
};

function getProducerDisplayName(producer: DirectSalesProducer): string {
  const name = producer.profile?.company_name || producer.profile?.business_name || producer.name || 'Producteur';
  return name.trim().replace(/\.\s*$/, '');
}

// ─── Producer Card for the horizontal carousel (matches map.tsx style) ───
interface MarcheCardItemProps {
  producer: DirectSalesProducer;
  index: number;
  scrollX: Animated.SharedValue<number>;
  isScrolling: Animated.SharedValue<number>;
  onAddToLocalCart: (product: DirectSalesProduct, producer: DirectSalesProducer) => Promise<void>;
  onViewShop: (producerId: string) => void;
}

const MarcheCardItem = ({ producer, index, scrollX, isScrolling, onAddToLocalCart, onViewShop }: MarcheCardItemProps) => {
  const pickupCity = producer.city;

  // Glow animation
  const glowOpacity = useSharedValue(0.4);

  React.useEffect(() => {
    glowOpacity.value = withRepeat(
      withSequence(
        withTiming(0.7, { duration: 2000 }),
        withTiming(0.4, { duration: 2000 })
      ),
      -1,
      true
    );
  }, [glowOpacity]);

  const glowStyle = useAnimatedStyle(() => ({
    opacity: glowOpacity.value,
  }));

  const inputRange = [
    (index - 1) * (CARD_WIDTH + CARD_SPACING),
    index * (CARD_WIDTH + CARD_SPACING),
    (index + 1) * (CARD_WIDTH + CARD_SPACING),
  ];

  const animatedCardStyle = useAnimatedStyle(() => {
    const scale = interpolate(
      scrollX.value,
      inputRange,
      [0.9, 1, 0.9],
      Extrapolation.CLAMP
    );
    const baseOpacity = interpolate(
      scrollX.value,
      inputRange,
      [0.5, 1, 0.5],
      Extrapolation.CLAMP
    );
    const scrollingOpacity = interpolate(
      isScrolling.value,
      [0, 1],
      [baseOpacity, 0.1],
      Extrapolation.CLAMP
    );
    return {
      transform: [{ scale }],
      opacity: scrollingOpacity,
    };
  });

  return (
    <View
      style={{
        width: CARD_WIDTH,
        marginHorizontal: CARD_SPACING / 2,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {/* Glow effect */}
      <Animated.View
        style={[
          glowStyle,
          {
            position: 'absolute',
            width: CARD_WIDTH + 12,
            height: CARD_HEIGHT + 12,
            borderRadius: 24,
            backgroundColor: COLORS.primary.gold,
            shadowColor: COLORS.primary.brightYellow,
            shadowOffset: { width: 0, height: 0 },
            shadowOpacity: 1,
            shadowRadius: 25,
          },
        ]}
      />

      {/* Main Card */}
      <Animated.View
        style={[
          animatedCardStyle,
          {
            width: CARD_WIDTH,
            height: CARD_HEIGHT,
            borderRadius: 20,
            overflow: 'hidden',
            opacity: 0.65,
          },
        ]}
      >
        <LinearGradient
          colors={['rgba(212, 168, 83, 0.8)', 'rgba(232, 148, 90, 0.8)', 'rgba(232, 200, 120, 0.8)']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={{ flex: 1, padding: 3 }}
        >
          <View
            className="flex-1 rounded-[17px] overflow-hidden"
            style={{ backgroundColor: 'rgba(22, 34, 54, 0.87)' }}
          >
            {/* Card header with image */}
            <View className="h-[32%] relative">
              {producer.image ? (
                <Image
                  source={optimizeImageSource(getImageSource(producer.image), 800)}
                  className="w-full h-full"
                  resizeMode="cover"
                />
              ) : (
                <View className="w-full h-full items-center justify-center" style={{ backgroundColor: 'rgba(255, 255, 255, 0.06)' }}>
                  <Store size={32} color={COLORS.text.muted} />
                </View>
              )}
              <LinearGradient
                colors={['transparent', 'rgba(22, 34, 54, 0.6)', COLORS.background.nightSky]}
                style={{
                  position: 'absolute',
                  bottom: 0,
                  left: 0,
                  right: 0,
                  height: 60,
                }}
              />
              <View className="absolute top-2 left-2">
                <Sparkles size={14} color={COLORS.primary.brightYellow} />
              </View>
              {/* Badge Vente directe */}
              <View
                className="absolute top-2 right-2 px-2 py-1 rounded-full"
                style={{ backgroundColor: 'rgba(90, 158, 90, 0.7)' }}
              >
                <Text className="text-[9px] font-bold" style={{ color: COLORS.text.white }}>
                  Vente directe
                </Text>
              </View>
              <View
                pointerEvents="none"
                className="absolute inset-0"
                style={{
                  borderWidth: 1.5,
                  borderColor: 'rgba(212, 168, 83, 0.31)',
                }}
              />
            </View>

            {/* Card content - scrollable */}
            <ScrollView
              className="flex-1 px-3 -mt-2"
              showsVerticalScrollIndicator={false}
              contentContainerStyle={{ paddingBottom: 8 }}
            >
              {/* Name banner */}
              <View
                className="rounded-xl px-2 py-2 mb-2"
                style={{
                  backgroundColor: 'rgba(212, 168, 83, 0.15)',
                  borderWidth: 1.5,
                  borderColor: 'rgba(212, 168, 83, 0.31)',
                }}
              >
                <View className="flex-row items-center justify-center">
                  <Sparkles size={12} color={COLORS.primary.brightYellow} />
                  <Text
                    className="text-sm font-bold text-center mx-1"
                    style={{ color: COLORS.primary.paleGold }}
                    numberOfLines={1}
                  >
                    {getProducerDisplayName(producer)}
                  </Text>
                  <Sparkles size={12} color={COLORS.primary.brightYellow} />
                </View>
              </View>

              {/* Pickup city */}
              <View
                className="rounded-lg px-2 py-1.5 mb-2"
                style={{
                  backgroundColor: 'rgba(74, 155, 155, 0.12)',
                  borderWidth: 1,
                  borderColor: 'rgba(74, 155, 155, 0.25)',
                }}
              >
                <View className="flex-row items-center justify-center">
                  <MapPin size={12} color={COLORS.accent.teal} />
                  <Text
                    className="text-xs font-bold ml-1"
                    style={{ color: COLORS.accent.teal }}
                    numberOfLines={1}
                  >
                    Retrait à {pickupCity}
                  </Text>
                </View>
              </View>

              {/* Location */}
              <View className="flex-row items-center justify-center mb-2">
                <View
                  className="flex-row items-center px-2 py-1 rounded-full"
                  style={{ backgroundColor: 'rgba(61, 122, 74, 0.15)' }}
                >
                  <MapPin size={10} color={COLORS.accent.hemp} />
                  <Text
                    className="text-xs ml-1 font-semibold"
                    style={{ color: COLORS.accent.hemp }}
                    numberOfLines={1}
                  >
                    {[
                      producer.department ? DEPARTMENT_NAMES[producer.department] || producer.department : '',
                      producer.region,
                    ].filter(Boolean).join(', ')}
                  </Text>
                </View>
              </View>

              {/* Terroir attributes */}
              <View className="flex-row justify-center gap-2 mb-2">
                {producer.soil_type && (
                  <View
                    className="flex-row items-center px-2 py-1 rounded-full"
                    style={{ backgroundColor: 'rgba(90, 158, 90, 0.12)' }}
                  >
                    <Leaf size={10} color={COLORS.accent.hemp} />
                    <Text
                      className="text-[9px] font-semibold ml-1"
                      style={{ color: COLORS.accent.hemp }}
                      numberOfLines={1}
                    >
                      {producer.soil_type.length > 12 ? producer.soil_type.slice(0, 12) + '...' : producer.soil_type}
                    </Text>
                  </View>
                )}
                {producer.climate_type && (
                  <View
                    className="flex-row items-center px-2 py-1 rounded-full"
                    style={{ backgroundColor: 'rgba(232, 201, 122, 0.12)' }}
                  >
                    <Sparkles size={10} color={COLORS.primary.paleGold} />
                    <Text
                      className="text-[9px] font-semibold ml-1"
                      style={{ color: COLORS.primary.paleGold }}
                      numberOfLines={1}
                    >
                      {producer.climate_type.length > 12 ? producer.climate_type.slice(0, 12) + '...' : producer.climate_type}
                    </Text>
                  </View>
                )}
              </View>

              {/* Culture type icons */}
              {(producer.culture_outdoor || producer.culture_greenhouse || producer.culture_indoor) && (
                <View className="flex-row justify-center mb-2">
                  <CultureTypeIcons
                    outdoor={producer.culture_outdoor === true}
                    greenhouse={producer.culture_greenhouse === true}
                    indoor={producer.culture_indoor === true}
                    size={16}
                    animated={false}
                  />
                </View>
              )}

              {/* Products preview */}
              {producer.products && producer.products.length > 0 && (
                <View className="mb-2">
                  <Text className="text-[10px] font-semibold mb-1" style={{ color: COLORS.text.muted }}>
                    {producer.products.length} produit{producer.products.length > 1 ? 's' : ''}
                  </Text>
                  {producer.products.slice(0, 2).map((product) => {
                    const stockValue = typeof product.stock === 'string' ? parseInt(product.stock, 10) : product.stock;
                    const isOutOfStock = typeof stockValue === 'number' && !isNaN(stockValue) && stockValue <= 0;
                    const hasTieredPricing = product.price_tiers && product.price_tiers.length > 0;
                    const lowestTierPrice = hasTieredPricing && product.price_tiers
                      ? Math.min(...product.price_tiers.map(t => t.price))
                      : null;
                    return (
                      <View
                        key={product.id}
                        className="rounded-lg mb-1 overflow-hidden"
                        style={{
                          backgroundColor: 'rgba(255, 255, 255, 0.03)',
                          borderWidth: 1,
                          borderColor: isOutOfStock ? 'rgba(199, 91, 91, 0.19)' : 'rgba(90, 158, 90, 0.19)',
                          opacity: isOutOfStock ? 0.6 : 1,
                        }}
                      >
                        <View className="flex-row p-1.5 items-center">
                          {product.image ? (
                            <Image
                              source={{ uri: optimizeImageUrl(product.image, 200) }}
                              className="w-9 h-9 rounded-md mr-1.5"
                            />
                          ) : (
                            <View className="w-9 h-9 rounded-md mr-1.5 items-center justify-center" style={{ backgroundColor: 'rgba(90, 158, 90, 0.12)' }}>
                              <ShoppingBag size={12} color={COLORS.accent.hemp} />
                            </View>
                          )}
                          <View className="flex-1">
                            <Text className="text-[10px] font-bold" style={{ color: COLORS.text.cream }} numberOfLines={1}>
                              {product.name}
                            </Text>
                            <View className="flex-row items-center">
                              <Text className="text-xs font-bold" style={{ color: COLORS.primary.gold }}>
                                {(product.price_public ?? 0).toFixed(2)}€
                              </Text>
                              {hasTieredPricing && lowestTierPrice && (
                                <View className="flex-row items-center ml-1">
                                  <Layers size={8} color={COLORS.accent.hemp} />
                                  <Text className="text-[8px] ml-0.5" style={{ color: COLORS.accent.hemp }}>
                                    dès {lowestTierPrice.toFixed(2)}€
                                  </Text>
                                </View>
                              )}
                            </View>
                          </View>
                          {!isOutOfStock && (
                            <Pressable
                              onPress={() => onAddToLocalCart(product, producer)}
                              className="px-2 py-1.5 rounded-md"
                              style={{ backgroundColor: 'rgba(90, 158, 90, 0.2)' }}
                            >
                              <ShoppingCart size={14} color={COLORS.accent.hemp} />
                            </Pressable>
                          )}
                        </View>
                      </View>
                    );
                  })}
                </View>
              )}

              {/* Shop button */}
              <Pressable
                onPress={() => onViewShop(producer.id)}
                className="rounded-xl py-2 flex-row items-center justify-center active:opacity-80"
                style={{ backgroundColor: COLORS.accent.forest }}
              >
                <ShoppingBag size={14} color={COLORS.text.white} />
                <Text
                  className="font-bold ml-1.5 text-xs"
                  style={{ color: COLORS.text.white }}
                >
                  Voir les produits
                </Text>
              </Pressable>
            </ScrollView>

            {/* Card border */}
            <View
              pointerEvents="none"
              className="absolute inset-0 rounded-[17px]"
              style={{
                borderWidth: 1.5,
                borderColor: 'rgba(212, 168, 83, 0.25)',
              }}
            />
          </View>
        </LinearGradient>
      </Animated.View>
    </View>
  );
};

// ─── Main Screen ───
export default function MarcheLocal() {
  const insets = useSafeAreaInsets();
  const { producerId: highlightedProducerId } = useLocalSearchParams<{ producerId: string }>();
  const { isPro, isProApproved } = usePermissions();
  const [showHowItWorks, setShowHowItWorks] = useState(false);

  const [producers, setProducers] = useState<DirectSalesProducer[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [producersLoadingMore, setProducersLoadingMore] = useState(false);
  const [producersHasMore, setProducersHasMore] = useState(true);
  const producersPageRef = useRef(0);

  const [selectedDepartment, setSelectedDepartment] = useState<string | null>(null);
  const [currentIndex, setCurrentIndex] = useState(0);
  const flatListRef = useRef<FlatList>(null);
  const scrollX = useSharedValue(0);
  const isScrolling = useSharedValue(0);
  const currentIndexRef = useRef(0);
  const isHoldingRef = useRef(false);
  const scrollDirectionRef = useRef<'prev' | 'next' | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const currentOffsetRef = useRef(0);

  // Direct sales cart
  const addItem = useDirectSalesCart((s) => s.addItem);

  const PRODUCERS_PAGE_SIZE = 50;

  // Group producers by department
  const departmentGroups = useMemo(() => {
    const groups: Record<string, DirectSalesProducer[]> = {};
    const seenIds = new Set<string>();

    producers.forEach((producer) => {
      if (seenIds.has(producer.id)) return;
      seenIds.add(producer.id);
      const dept = producer.department || 'Inconnu';
      if (!groups[dept]) groups[dept] = [];
      groups[dept].push(producer);
    });

    return Object.entries(groups)
      .map(([department, prods]) => ({
        department,
        departmentName: DEPARTMENT_NAMES[department] || department,
        producers: prods,
      }))
      .sort((a, b) => a.departmentName.localeCompare(b.departmentName));
  }, [producers]);

  // Producers for selected department
  const filteredProducers = useMemo(() => {
    if (!selectedDepartment) return [];
    const group = departmentGroups.find((g) => g.department === selectedDepartment);
    return group?.producers ?? [];
  }, [departmentGroups, selectedDepartment]);

  const displayedProducers = selectedDepartment ? filteredProducers : [];

  // Handler pour ajouter un produit au panier local depuis la fiche producteur
  const handleAddToLocalCart = useCallback(async (
    product: DirectSalesProduct,
    producer: DirectSalesProducer
  ) => {
    const session = await getValidSession();
    if (!session?.user?.id || !session?.access_token) {
      router.push('/auth/login');
      return;
    }
    const stockValue = typeof product.stock === 'string' ? parseInt(product.stock, 10) : product.stock;
    // Bloquer uniquement si un stock explicite est <= 0.
    // Si le stock n'est pas renseigné, on autorise l'ajout au panier.
    if (typeof stockValue === 'number' && !isNaN(stockValue) && stockValue <= 0) return;

    await addItem(session.user.id, session.access_token, {
      product_id: product.id,
      producer_id: producer.id,
      producer_name: getProducerDisplayName(producer),
      product_name: product.name,
      price: product.price_public,
      quantity: 1,
      image: product.image,
    });
  }, [addItem]);

  const handleViewShop = useCallback((producerId: string) => {
    router.push({
      pathname: '/(tabs)/marche-catalogue',
      params: { producerId },
    });
  }, []);

  // Reset index when department changes
  useEffect(() => {
    if (selectedDepartment) {
      setCurrentIndex(0);
      currentIndexRef.current = 0;
      currentOffsetRef.current = 0;
      flatListRef.current?.scrollToOffset({ offset: 0, animated: false });
    }
  }, [selectedDepartment]);

  // Continuous scroll logic (same as map.tsx)
  const ITEM_WIDTH = CARD_WIDTH + CARD_SPACING;
  const TOTAL_WIDTH = ITEM_WIDTH * displayedProducers.length;
  const SCROLL_SPEED = 8;

  const continuousScroll = () => {
    if (!isHoldingRef.current || !scrollDirectionRef.current) return;
    const direction = scrollDirectionRef.current === 'next' ? 1 : -1;
    let newOffset = currentOffsetRef.current + (SCROLL_SPEED * direction);
    if (newOffset >= TOTAL_WIDTH) newOffset = 0;
    else if (newOffset < 0) newOffset = TOTAL_WIDTH - ITEM_WIDTH;
    currentOffsetRef.current = newOffset;
    flatListRef.current?.scrollToOffset({ offset: newOffset, animated: false });
    const newIndex = Math.round(newOffset / ITEM_WIDTH) % displayedProducers.length;
    if (newIndex !== currentIndexRef.current && newIndex >= 0 && newIndex < displayedProducers.length) {
      currentIndexRef.current = newIndex;
      setCurrentIndex(newIndex);
    }
    animationFrameRef.current = requestAnimationFrame(continuousScroll);
  };

  const startContinuousScroll = (direction: 'prev' | 'next') => {
    isHoldingRef.current = true;
    scrollDirectionRef.current = direction;
    isScrolling.value = withTiming(1, { duration: 150 });
    animationFrameRef.current = requestAnimationFrame(continuousScroll);
  };

  const stopContinuousScroll = () => {
    isHoldingRef.current = false;
    scrollDirectionRef.current = null;
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    const nearestIndex = Math.round(currentOffsetRef.current / ITEM_WIDTH) % displayedProducers.length;
    const snapOffset = nearestIndex * ITEM_WIDTH;
    flatListRef.current?.scrollToOffset({ offset: snapOffset, animated: true });
    currentIndexRef.current = nearestIndex;
    setCurrentIndex(nearestIndex);
    isScrolling.value = withTiming(0, { duration: 200 });
  };

  React.useEffect(() => {
    currentIndexRef.current = currentIndex;
    currentOffsetRef.current = currentIndex * ITEM_WIDTH;
  }, [currentIndex, ITEM_WIDTH]);

  const onViewableItemsChanged = useRef(({ viewableItems }: { viewableItems: { index: number | null }[] }) => {
    if (viewableItems.length > 0 && viewableItems[0].index !== null) {
      setCurrentIndex(viewableItems[0].index);
    }
  }).current;

  const viewabilityConfig = useRef({
    viewAreaCoveragePercentThreshold: 50,
  }).current;

  // Load producers from public-catalog
  const loadProducers = useCallback(async (reset = false) => {
    try {
      if (reset) {
        setLoading(true);
        setProducers([]);
        producersPageRef.current = 0;
        setProducersHasMore(true);
      } else {
        setProducersLoadingMore(true);
      }

      const nextPage = reset ? 0 : producersPageRef.current;
      const offset = nextPage * PRODUCERS_PAGE_SIZE;

      const response = await fetch(
        `${SUPABASE_URL}/functions/v1/public-catalog?action=producers&limit=${PRODUCERS_PAGE_SIZE}&offset=${offset}`,
        {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
            apikey: SUPABASE_ANON_KEY,
            Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
            'Cache-Control': 'no-cache, no-store, must-revalidate',
            Pragma: 'no-cache',
          },
        }
      );

      if (!response.ok) {
        if (reset) setProducers([]);
        setProducersHasMore(false);
        setLoading(false);
        return;
      }

      const result = await response.json();
      const producersList: DirectSalesProducer[] = Array.isArray(result?.producers) ? result.producers : [];

      const producersWithSignedImages = await Promise.all(
        producersList.map(async (producer) => {
          const signedProducerImage = await getSignedImageUrl(producer.image);
          const directSaleProducts = producer.products
            ? producer.products.filter((product) => product.disponible_vente_directe === true)
            : [];
          const signedProducts = await Promise.all(
            directSaleProducts.map(async (product) => ({
              ...product,
              image: await getSignedProductImageUrl(product.image),
            }))
          );
          return { ...producer, image: signedProducerImage, products: signedProducts };
        })
      );

      const uniqueProducers = producersWithSignedImages.filter(
        (producer, index, self) => index === self.findIndex((p) => p.id === producer.id)
      );

      setProducers((prev) => {
        const merged = [...prev, ...uniqueProducers];
        const unique = new Map<string, DirectSalesProducer>(merged.map((p) => [p.id, p]));
        return Array.from(unique.values());
      });
      setProducersHasMore(Boolean(result?.hasMore));
      producersPageRef.current = reset ? 1 : producersPageRef.current + 1;
    } catch {
      if (reset) setProducers([]);
      setProducersHasMore(false);
    } finally {
      setLoading(false);
      setProducersLoadingMore(false);
    }
  }, [PRODUCERS_PAGE_SIZE]);

  useFocusEffect(
    useCallback(() => {
      if (isPro || isProApproved) {
        router.replace('/(tabs)/packs');
        return;
      }
      void loadProducers(true);
    }, [isPro, isProApproved, loadProducers])
  );

  // Deep-link: scroll to highlighted producer
  useEffect(() => {
    if (highlightedProducerId && producers.length > 0) {
      const producer = producers.find((p) => p.id === highlightedProducerId);
      if (producer) {
        const dept = producer.department || 'Inconnu';
        setSelectedDepartment(dept);
        const deptProducers = producers.filter((p) => (p.department || 'Inconnu') === dept);
        const idx = deptProducers.findIndex((p) => p.id === highlightedProducerId);
        if (idx >= 0) {
          setTimeout(() => {
            setCurrentIndex(idx);
            currentIndexRef.current = idx;
            flatListRef.current?.scrollToIndex({ index: idx, animated: true });
          }, 300);
        }
      }
    }
  }, [highlightedProducerId, producers]);

  const onRefresh = async () => {
    setRefreshing(true);
    setSelectedDepartment(null);
    await loadProducers(true);
    setRefreshing(false);
  };

  if (loading) {
    return (
      <View className="flex-1 items-center justify-center" style={{ backgroundColor: COLORS.background.nightSky }}>
        <ActivityIndicator size="large" color={COLORS.primary.gold} />
        <Text className="mt-4" style={{ color: COLORS.text.lightGray }}>
          Chargement des producteurs...
        </Text>
      </View>
    );
  }

  return (
    <View className="flex-1" style={{ backgroundColor: COLORS.background.nightSky }}>
      {/* Background image - same as map tab */}
      <View
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
        }}
      >
        <Image
          source={require('../../../assets/image-1767811691.jpeg')}
          style={{ width: '100%', height: '100%' }}
          resizeMode="contain"
        />
        <LinearGradient
          colors={[`${COLORS.background.nightSky}20`, `${COLORS.background.nightSky}40`, `${COLORS.background.nightSky}70`]}
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
          }}
        />
      </View>

      {/* Header - same logo style as map tab */}
      <LinearGradient
        colors={[`${COLORS.background.nightSky}E6`, `${COLORS.background.nightSky}99`, 'transparent']}
        style={{
          paddingTop: insets.top + 10,
          paddingHorizontal: 20,
          paddingBottom: 20,
        }}
      >
        {/* Action buttons row */}
        <View className="flex-row items-center justify-between mb-2">
          <View className="flex-row items-center gap-2">
            <Pressable
              onPress={() => router.push('/mes-commandes-marche-local')}
              className="p-2.5 rounded-lg"
              style={{ backgroundColor: 'rgba(232, 148, 90, 0.19)' }}
            >
              <ClipboardList size={18} color={COLORS.primary.orange} />
            </Pressable>
          </View>
          <CartButton />
        </View>

        <Animated.View entering={FadeIn.duration(500)} className="items-center">
          <View
            style={{
              width: 80,
              height: 80,
              borderRadius: 40,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <View
              style={{
                position: 'absolute',
                width: 80,
                height: 80,
                borderRadius: 40,
                backgroundColor: '#F5F5DC',
                shadowColor: '#FFFACD',
                shadowOffset: { width: 0, height: 0 },
                shadowOpacity: 0.9,
                shadowRadius: 15,
              }}
            />
            <View
              style={{
                width: 70,
                height: 70,
                borderRadius: 35,
                overflow: 'hidden',
                zIndex: 10,
              }}
            >
              <Image
                source={require('../../../assets/image-1767902007.png')}
                style={{ width: 70, height: 70, borderRadius: 35 }}
                resizeMode="contain"
              />
            </View>
          </View>
          <Text style={{ color: COLORS.primary.paleGold }} className="text-sm font-bold mt-2">
            Marché local
          </Text>
          <Text style={{ color: COLORS.text.muted }} className="text-xs mt-1">
            {producers.length} producteur{producers.length > 1 ? 's' : ''} · Vente directe
          </Text>
        </Animated.View>
      </LinearGradient>

      {/* Main content - Department list OR Producer carousel */}
      {!selectedDepartment ? (
        /* Department list - same style as map's region list */
        <View className="flex-1">
          <ScrollView
            contentContainerStyle={{
              paddingHorizontal: 16,
              paddingTop: 8,
              paddingBottom: insets.bottom + 20,
            }}
            showsVerticalScrollIndicator={false}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.primary.gold} />}
          >
            <Animated.View entering={FadeInDown.duration(400)}>
              <Pressable
                onPress={() => setShowHowItWorks((prev) => !prev)}
                className="mb-4 rounded-2xl overflow-hidden"
              >
                <View
                  className="px-4 py-3 flex-row items-center justify-between"
                  style={{
                    backgroundColor: 'rgba(20, 29, 47, 0.78)',
                    borderWidth: 1,
                    borderColor: `${COLORS.primary.gold}30`,
                  }}
                >
                  <View>
                    <Text style={{ color: COLORS.text.cream }} className="font-bold">
                      Comment ca marche
                    </Text>
                    <Text style={{ color: COLORS.text.muted }} className="text-xs mt-0.5">
                      Marche local vs Packs
                    </Text>
                  </View>
                  {showHowItWorks ? (
                    <ChevronUp size={18} color={COLORS.primary.paleGold} />
                  ) : (
                    <ChevronDown size={18} color={COLORS.primary.paleGold} />
                  )}
                </View>
              </Pressable>

              {showHowItWorks && (
                <View
                  className="mb-4 rounded-2xl p-4"
                  style={{
                    backgroundColor: 'rgba(20, 29, 47, 0.72)',
                    borderWidth: 1,
                    borderColor: `${COLORS.primary.gold}25`,
                  }}
                >
                  <View className="rounded-xl p-3" style={{ backgroundColor: 'rgba(90, 158, 90, 0.12)' }}>
                    <Text style={{ color: COLORS.accent.hemp }} className="font-semibold">
                      Marche local: direct producteur
                    </Text>
                    <Text style={{ color: COLORS.text.muted }} className="text-xs mt-1">
                      Vous commandez en direct avec le producteur, selon ses options de retrait sur place ou de livraison.
                    </Text>
                  </View>

                  <View className="mt-2 rounded-xl p-3" style={{ backgroundColor: 'rgba(212, 168, 83, 0.12)' }}>
                    <Text style={{ color: COLORS.primary.paleGold }} className="font-semibold">
                      Packs: prix avantageux et decouverte
                    </Text>
                    <Text style={{ color: COLORS.text.muted }} className="text-xs mt-1">
                      Les packs regroupent des fleurs et de la resine en vrac provenant des producteurs de la plateforme.
                    </Text>
                  </View>

                  <View className="mt-2 rounded-xl p-3" style={{ backgroundColor: 'rgba(232, 148, 90, 0.14)' }}>
                    <Text style={{ color: COLORS.primary.orange }} className="font-semibold">
                      Bonus loterie
                    </Text>
                    <Text style={{ color: COLORS.text.muted }} className="text-xs mt-1">
                      Tous les 20 EUR depenses sur les packs, vous gagnez 1 ticket de loterie.
                    </Text>
                  </View>
                </View>
              )}

              <View className="flex-row items-center justify-center mb-4">
                <MapIcon size={20} color={COLORS.primary.gold} />
                <Text style={{ color: COLORS.primary.paleGold }} className="text-lg font-bold ml-2">
                  Sélectionnez un département
                </Text>
              </View>

              {departmentGroups.length === 0 && (
                <View className="items-center py-12">
                  <Store size={48} color={COLORS.text.muted} strokeWidth={1.5} />
                  <Text className="text-center mt-4" style={{ color: COLORS.text.lightGray }}>
                    Aucun producteur ne propose la vente directe pour le moment.
                  </Text>
                </View>
              )}

              {departmentGroups.map((group, index) => {
                const count = group.producers.length;
                const productCount = group.producers.reduce((acc, p) => acc + (p.products?.length || 0), 0);

                return (
                  <Animated.View
                    key={group.department}
                    entering={FadeInDown.duration(300).delay(index * 50)}
                  >
                    <Pressable
                      onPress={() => setSelectedDepartment(group.department)}
                      className="mb-3 rounded-2xl overflow-hidden"
                    >
                      <View
                        className="px-4 py-4 flex-row items-center justify-between"
                        style={{
                          backgroundColor: 'rgba(22, 34, 54, 0.75)',
                          borderWidth: 1.5,
                          borderColor: `${COLORS.primary.gold}40`,
                          borderRadius: 16,
                        }}
                      >
                        <View className="flex-row items-center flex-1">
                          <View
                            className="w-10 h-10 rounded-full items-center justify-center mr-3"
                            style={{ backgroundColor: `${COLORS.primary.gold}20` }}
                          >
                            <MapPin size={20} color={COLORS.primary.gold} />
                          </View>
                          <View className="flex-1">
                            <Text
                              style={{ color: COLORS.text.cream }}
                              className="font-semibold text-base"
                              numberOfLines={1}
                            >
                              {group.departmentName}
                            </Text>
                            <View className="flex-row items-center mt-0.5">
                              <Text style={{ color: COLORS.accent.hemp }} className="text-xs">
                                {count} producteur{count > 1 ? 's' : ''}
                              </Text>
                              <Text style={{ color: COLORS.text.muted }} className="text-xs ml-2">
                                · {productCount} produit{productCount > 1 ? 's' : ''}
                              </Text>
                            </View>
                          </View>
                        </View>

                        <View
                          className="px-3 py-1.5 rounded-full"
                          style={{ backgroundColor: COLORS.accent.forest }}
                        >
                          <Text style={{ color: COLORS.text.white }} className="text-xs font-bold">
                            Voir
                          </Text>
                        </View>
                      </View>
                    </Pressable>
                  </Animated.View>
                );
              })}

              {/* Load more */}
              {producersHasMore && (
                <Pressable
                  onPress={() => loadProducers(false)}
                  disabled={producersLoadingMore}
                  className="items-center my-4 px-4 py-2 rounded-full self-center"
                  style={{ backgroundColor: `${COLORS.text.white}10` }}
                >
                  <Text style={{ color: COLORS.text.lightGray }}>
                    {producersLoadingMore ? 'Chargement...' : 'Charger plus'}
                  </Text>
                </Pressable>
              )}
            </Animated.View>
          </ScrollView>
        </View>
      ) : (
        /* Producer carousel - same style as map tab */
        <>
          {/* Selected department header */}
          <Animated.View
            entering={FadeInUp.duration(300)}
            className="px-4 pb-2"
          >
            <Pressable
              onPress={() => setSelectedDepartment(null)}
              className="flex-row items-center justify-center py-2 px-4 rounded-xl self-center"
              style={{
                backgroundColor: 'rgba(22, 34, 54, 0.85)',
                borderWidth: 1.5,
                borderColor: `${COLORS.primary.gold}50`,
              }}
            >
              <X size={16} color={COLORS.primary.gold} />
              <Text style={{ color: COLORS.primary.paleGold }} className="font-bold ml-2">
                {departmentGroups.find((g) => g.department === selectedDepartment)?.departmentName ?? selectedDepartment}
              </Text>
              <Text style={{ color: COLORS.text.muted }} className="text-xs ml-2">
                ({filteredProducers.length} producteur{filteredProducers.length > 1 ? 's' : ''})
              </Text>
            </Pressable>
          </Animated.View>

          {filteredProducers.length === 0 ? (
            <View className="flex-1 items-center justify-center px-6">
              <Leaf size={48} color={COLORS.text.muted} />
              <Text style={{ color: COLORS.text.muted }} className="mt-4 text-lg text-center">
                Aucun producteur dans ce département
              </Text>
              <Pressable
                onPress={() => setSelectedDepartment(null)}
                className="mt-4 px-6 py-3 rounded-xl"
                style={{ backgroundColor: COLORS.accent.forest }}
              >
                <Text style={{ color: COLORS.text.white }} className="font-bold">
                  Retour aux départements
                </Text>
              </Pressable>
            </View>
          ) : (
            <View className="flex-1 justify-center">
              <Animated.FlatList
                ref={flatListRef}
                data={displayedProducers}
                keyExtractor={(item) => item.id}
                horizontal
                showsHorizontalScrollIndicator={false}
                snapToInterval={CARD_WIDTH + CARD_SPACING}
                decelerationRate="fast"
                contentContainerStyle={{
                  paddingHorizontal: (SCREEN_WIDTH - CARD_WIDTH) / 2 - CARD_SPACING / 2,
                }}
                onScroll={(event) => {
                  scrollX.value = event.nativeEvent.contentOffset.x;
                  if (!isHoldingRef.current) {
                    currentOffsetRef.current = event.nativeEvent.contentOffset.x;
                  }
                }}
                onScrollBeginDrag={() => {
                  isScrolling.value = withTiming(1, { duration: 150 });
                }}
                onScrollEndDrag={() => {
                  isScrolling.value = withTiming(0, { duration: 200 });
                }}
                onMomentumScrollEnd={() => {
                  isScrolling.value = withTiming(0, { duration: 200 });
                }}
                scrollEventThrottle={16}
                onViewableItemsChanged={onViewableItemsChanged}
                viewabilityConfig={viewabilityConfig}
                renderItem={({ item, index }) => (
                  <MarcheCardItem
                    producer={item}
                    index={index}
                    scrollX={scrollX}
                    isScrolling={isScrolling}
                    onAddToLocalCart={handleAddToLocalCart}
                    onViewShop={handleViewShop}
                  />
                )}
              />

              {/* Navigation arrows */}
              {displayedProducers.length > 1 && (
                <>
                  <Pressable
                    onPressIn={() => startContinuousScroll('prev')}
                    onPressOut={stopContinuousScroll}
                    className="absolute left-3 w-10 h-10 rounded-full items-center justify-center active:scale-95"
                    style={{
                      backgroundColor: `${COLORS.background.nightSky}D0`,
                      borderWidth: 1.5,
                      borderColor: COLORS.primary.gold,
                    }}
                  >
                    <ChevronLeft size={22} color={COLORS.primary.brightYellow} />
                  </Pressable>
                  <Pressable
                    onPressIn={() => startContinuousScroll('next')}
                    onPressOut={stopContinuousScroll}
                    className="absolute right-3 w-10 h-10 rounded-full items-center justify-center active:scale-95"
                    style={{
                      backgroundColor: `${COLORS.background.nightSky}D0`,
                      borderWidth: 1.5,
                      borderColor: COLORS.primary.gold,
                    }}
                  >
                    <ChevronRight size={22} color={COLORS.primary.brightYellow} />
                  </Pressable>
                </>
              )}
            </View>
          )}

          {/* Pagination dots */}
          {displayedProducers.length > 1 && (
            <View
              className="flex-row justify-center items-center pb-4"
              style={{ paddingBottom: insets.bottom + 16 }}
            >
              {displayedProducers.map((_, index) => (
                <View
                  key={index}
                  style={{
                    width: index === currentIndex ? 24 : 8,
                    height: 8,
                    borderRadius: 4,
                    backgroundColor: index === currentIndex ? COLORS.primary.gold : 'rgba(212, 168, 83, 0.25)',
                    marginHorizontal: 4,
                  }}
                />
              ))}
            </View>
          )}
        </>
      )}

    </View>
  );
}

function CartButton() {
  const cart = useDirectSalesCart((s) => s);
  const itemCount = cart.items.length;

  return (
    <Pressable
      onPress={() => router.push('/panier-vente-directe')}
      className="p-2.5 rounded-lg relative"
      style={{ backgroundColor: 'rgba(90, 158, 90, 0.19)' }}
    >
      <ShoppingCart size={18} color={COLORS.accent.hemp} />
      {itemCount > 0 && (
        <View
          className="absolute top-0 right-0 w-5 h-5 rounded-full items-center justify-center"
          style={{ backgroundColor: COLORS.accent.red }}
        >
          <Text className="text-xs font-bold" style={{ color: COLORS.text.white }}>
            {itemCount > 99 ? '99+' : itemCount}
          </Text>
        </View>
      )}
    </Pressable>
  );
}
