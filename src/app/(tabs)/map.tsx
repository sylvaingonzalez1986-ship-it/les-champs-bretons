import React, { useState, useMemo, useEffect, useRef } from 'react';
import { View, Pressable, Dimensions, Image, FlatList, ViewToken, ScrollView } from 'react-native';
import { Text } from '@/components/ui';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Sparkles, ShoppingBag, MapPin, Leaf, Star, ChevronLeft, ChevronRight, Thermometer, CloudRain, Mountain, X, Map, Instagram, Facebook, Twitter, Linkedin, Youtube, Globe } from 'lucide-react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withSequence,
  withTiming,
  FadeIn,
  FadeInDown,
  FadeInUp,
  interpolate,
  Extrapolation,
} from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { Redirect, useRouter } from 'expo-router';
import { Producer, SAMPLE_PRODUCERS, PRODUCT_TYPE_COLORS } from '@/lib/producers';
import { useProducerStore, useSupabaseSyncStore, useProductReviewsStore } from '@/lib/store';
import { COLORS } from '@/lib/colors';
import { fetchAllProducersWithProducts, isSupabaseSyncConfigured } from '@/lib/supabase-sync';
import { getImageSource } from '@/lib/asset-images';
import { CultureTypeIcons } from '@/components/CultureTypeIcons';
import { usePermissions, useUserIdentity } from '@/lib/useAuth';
import { CompactCacheStatus } from '@/components/CacheStatusBanner';
import { safeOpenExternalUrl } from '@/lib/safe-linking';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const CARD_WIDTH = SCREEN_WIDTH * 0.715;
const CARD_HEIGHT = CARD_WIDTH * 1.35;
const CARD_SPACING = 16;

// Fonction pour normaliser les noms de région (retire accents, met en minuscule)
function normalizeRegionName(region: string): string {
  return region
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // Retire les accents
    .replace(/[''`]/g, '') // Retire les apostrophes variées
    .replace(/\s+/g, ' ') // Normalise les espaces
    .trim();
}

// Liste des régions françaises officielles (13 régions métropolitaines)
const FRENCH_REGIONS = [
  'Auvergne-Rhône-Alpes',
  'Bourgogne-Franche-Comté',
  'Bretagne',
  'Centre-Val de Loire',
  'Corse',
  'Grand Est',
  'Hauts-de-France',
  'Île-de-France',
  'Normandie',
  'Nouvelle-Aquitaine',
  'Occitanie',
  'Pays de la Loire',
  'Provence-Alpes-Côte d\'Azur',
];

// Mapping des anciennes régions vers les nouvelles (pour rétrocompatibilité)
const REGION_ALIASES: Record<string, string> = {
  // Anciennes régions avant réforme 2016
  'rhone-alpes': 'Auvergne-Rhône-Alpes',
  'auvergne': 'Auvergne-Rhône-Alpes',
  'bourgogne': 'Bourgogne-Franche-Comté',
  'franche-comte': 'Bourgogne-Franche-Comté',
  'alsace': 'Grand Est',
  'lorraine': 'Grand Est',
  'champagne-ardenne': 'Grand Est',
  'champagne': 'Grand Est',
  'nord-pas-de-calais': 'Hauts-de-France',
  'picardie': 'Hauts-de-France',
  'basse-normandie': 'Normandie',
  'haute-normandie': 'Normandie',
  'aquitaine': 'Nouvelle-Aquitaine',
  'limousin': 'Nouvelle-Aquitaine',
  'poitou-charentes': 'Nouvelle-Aquitaine',
  'languedoc-roussillon': 'Occitanie',
  'midi-pyrenees': 'Occitanie',
  'provence': 'Provence-Alpes-Côte d\'Azur',
  'paca': 'Provence-Alpes-Côte d\'Azur',
  'cote dazur': 'Provence-Alpes-Côte d\'Azur',
  // Variantes courtes
  'ile-de-france': 'Île-de-France',
  'idf': 'Île-de-France',
  'centre': 'Centre-Val de Loire',
  'pays-de-la-loire': 'Pays de la Loire',
  'pdl': 'Pays de la Loire',
};

// Fonction pour mapper une région de producteur vers une région officielle
function mapToOfficialRegion(producerRegion: string | undefined | null): string | null {
  if (!producerRegion) return null;

  const normalized = normalizeRegionName(producerRegion);

  // Vérifier d'abord si c'est déjà une région officielle (comparaison normalisée)
  for (const officialRegion of FRENCH_REGIONS) {
    if (normalizeRegionName(officialRegion) === normalized) {
      return officialRegion;
    }
  }

  // Vérifier si c'est un alias
  if (REGION_ALIASES[normalized]) {
    return REGION_ALIASES[normalized];
  }

  // Recherche partielle (si la région du producteur contient le nom d'une région officielle ou vice versa)
  for (const officialRegion of FRENCH_REGIONS) {
    const normalizedOfficial = normalizeRegionName(officialRegion);
    if (normalized.includes(normalizedOfficial) || normalizedOfficial.includes(normalized)) {
      return officialRegion;
    }
  }

  // Si aucune correspondance trouvée, retourner null
  return null;
}

interface ProducerCardItemProps {
  producer: Producer;
  index: number;
  scrollX: Animated.SharedValue<number>;
  isScrolling: Animated.SharedValue<number>;
}

const ProducerCardItem = ({ producer, index, scrollX, isScrolling }: ProducerCardItemProps) => {
  const router = useRouter();
  const reviews = useProductReviewsStore((s) => s.reviews);
  const producerReviews = reviews.filter((r) => r.producerId === producer.id);
  const averageRating = producerReviews.length > 0
    ? producerReviews.reduce((sum, r) => sum + r.rating, 0) / producerReviews.length
    : 0;

  const productTypes = [...new Set(producer.products.map((p) => p.type))];
  const socialLinks = producer.socialLinks;
  const hasSocialLinks = Boolean(
    socialLinks?.instagram ||
      socialLinks?.facebook ||
      socialLinks?.twitter ||
      socialLinks?.linkedin ||
      socialLinks?.tiktok ||
      socialLinks?.youtube ||
      socialLinks?.website
  );

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
    // When scrolling, reduce opacity to 10% (0.1)
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
            <View className="h-[38%] relative">
              {producer.image ? (
                <Image
                  source={getImageSource(producer.image)}
                  className="w-full h-full"
                  resizeMode="cover"
                />
              ) : (
                <View className="w-full h-full items-center justify-center" style={{ backgroundColor: 'rgba(255, 255, 255, 0.06)' }}>
                  <Leaf size={32} color={COLORS.text.muted} />
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

              {/* Local market indicator icon */}
              {producer.products.some(p => p.disponible_vente_directe) && (
                <Pressable
                  onPress={() => {
                    router.push({
                      pathname: '/(tabs)/marche-local',
                      params: { producerId: producer.id }
                    });
                  }}
                  className="absolute top-2 right-2 rounded-full p-2"
                  style={{
                    backgroundColor: 'rgba(232, 148, 90, 0.87)',
                  }}
                >
                  <ShoppingBag size={16} color={COLORS.text.white} />
                </Pressable>
              )}

              <View
                pointerEvents="none"
                className="absolute inset-0"
                style={{
                  borderWidth: 1.5,
                  borderColor: 'rgba(212, 168, 83, 0.31)',
                }}
              />
            </View>

            {/* Card content */}
            <View className="flex-1 px-3 pb-3 -mt-2 justify-between">
              <View>
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
                      {producer.name?.trim().replace(/\.\s*$/, '') || 'Producteur'}
                    </Text>
                    <Sparkles size={12} color={COLORS.primary.brightYellow} />
                  </View>
                  {producerReviews.length > 0 && (
                    <View className="flex-row items-center justify-center mt-1">
                      <View className="flex-row">
                        {[1, 2, 3, 4, 5].map((star) => (
                          <Star
                            key={star}
                            size={10}
                            color={star <= Math.round(averageRating) ? '#F59E0B' : '#4B5563'}
                            fill={star <= Math.round(averageRating) ? '#F59E0B' : 'transparent'}
                            style={{ marginRight: 1 }}
                          />
                        ))}
                      </View>
                      <Text style={{ color: COLORS.primary.brightYellow }} className="font-bold text-xs ml-1">
                        {averageRating.toFixed(1)}
                      </Text>
                    </View>
                  )}
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
                      {producer.city}
                    </Text>
                  </View>
                </View>

                {/* Terroir characteristics */}
                <View className="flex-row justify-center gap-2 mb-2">
                  {/* Soil info */}
                  {producer.soil?.type && (
                    <View
                      className="flex-row items-center px-2 py-1 rounded-full"
                      style={{ backgroundColor: 'rgba(90, 158, 90, 0.12)' }}
                    >
                      <Mountain size={10} color={COLORS.accent.hemp} />
                      <Text
                        className="text-[9px] font-semibold ml-1"
                        style={{ color: COLORS.accent.hemp }}
                        numberOfLines={1}
                      >
                        {producer.soil.type.length > 12 ? producer.soil.type.slice(0, 12) + '...' : producer.soil.type}
                      </Text>
                    </View>
                  )}
                  {/* Climate info */}
                  {producer.climate?.type && (
                    <View
                      className="flex-row items-center px-2 py-1 rounded-full"
                      style={{ backgroundColor: 'rgba(232, 201, 122, 0.12)' }}
                    >
                      <Thermometer size={10} color={COLORS.primary.paleGold} />
                      <Text
                        className="text-[9px] font-semibold ml-1"
                        style={{ color: COLORS.primary.paleGold }}
                        numberOfLines={1}
                      >
                        {producer.climate.type.length > 12 ? producer.climate.type.slice(0, 12) + '...' : producer.climate.type}
                      </Text>
                    </View>
                  )}
                </View>

                {/* Climate details (temp & rainfall) */}
                {(producer.climate?.avgTemp || producer.climate?.rainfall) && (
                  <View className="flex-row justify-center items-center gap-2 mb-2">
                    {producer.climate?.avgTemp && (
                      <View className="flex-row items-center">
                        <Text className="text-[9px]" style={{ color: COLORS.text.muted }}>
                          {producer.climate.avgTemp}
                        </Text>
                      </View>
                    )}
                    {producer.climate?.avgTemp && producer.climate?.rainfall && (
                      <CloudRain size={8} color={COLORS.text.muted} />
                    )}
                    {producer.climate?.rainfall && (
                      <View className="flex-row items-center">
                        <Text className="text-[9px]" style={{ color: COLORS.text.muted }}>
                          {producer.climate.rainfall}
                        </Text>
                      </View>
                    )}
                  </View>
                )}

                {/* Culture types icons */}
                {(producer.cultureOutdoor || producer.cultureGreenhouse || producer.cultureIndoor) && (
                  <View className="flex-row justify-center mb-2">
                    <CultureTypeIcons
                      outdoor={producer.cultureOutdoor}
                      greenhouse={producer.cultureGreenhouse}
                      indoor={producer.cultureIndoor}
                      size={16}
                      animated={false}
                    />
                  </View>
                )}

                {/* Product count */}
                <View className="items-center mb-1">
                  <Text style={{ color: COLORS.accent.hemp }} className="text-xs font-bold">
                    {producer.products.length} produit{producer.products.length > 1 ? 's' : ''}
                  </Text>
                </View>

                {/* Product type badges */}
                <View className="flex-row flex-wrap justify-center gap-1">
                  {productTypes.length > 0 ? (
                    productTypes.slice(0, 2).map((type) => (
                      <View
                        key={type}
                        className="px-2 py-0.5 rounded-full flex-row items-center"
                        style={{
                          backgroundColor: `${PRODUCT_TYPE_COLORS[type]}30`,
                          borderWidth: 1,
                          borderColor: `${PRODUCT_TYPE_COLORS[type]}50`,
                        }}
                      >
                        <Text
                          className="text-[9px] font-bold capitalize"
                          style={{ color: PRODUCT_TYPE_COLORS[type] }}
                        >
                          {type}
                        </Text>
                      </View>
                    ))
                  ) : null}
                </View>
              </View>

              {hasSocialLinks ? (
                <View className="flex-row items-center justify-center gap-2 mb-2">
                  {socialLinks?.instagram ? (
                    <Pressable
                      onPress={() => {
                        void safeOpenExternalUrl(socialLinks.instagram!);
                      }}
                      className="w-7 h-7 rounded-full items-center justify-center"
                      style={{ backgroundColor: '#E1306C20', borderWidth: 1, borderColor: '#E1306C40' }}
                    >
                      <Instagram size={14} color="#E1306C" />
                    </Pressable>
                  ) : null}
                  {socialLinks?.facebook ? (
                    <Pressable
                      onPress={() => {
                        void safeOpenExternalUrl(socialLinks.facebook!);
                      }}
                      className="w-7 h-7 rounded-full items-center justify-center"
                      style={{ backgroundColor: '#1877F220', borderWidth: 1, borderColor: '#1877F240' }}
                    >
                      <Facebook size={14} color="#1877F2" />
                    </Pressable>
                  ) : null}
                  {socialLinks?.twitter ? (
                    <Pressable
                      onPress={() => {
                        void safeOpenExternalUrl(socialLinks.twitter!);
                      }}
                      className="w-7 h-7 rounded-full items-center justify-center"
                      style={{ backgroundColor: '#1DA1F220', borderWidth: 1, borderColor: '#1DA1F240' }}
                    >
                      <Twitter size={14} color="#1DA1F2" />
                    </Pressable>
                  ) : null}
                  {socialLinks?.linkedin ? (
                    <Pressable
                      onPress={() => {
                        void safeOpenExternalUrl(socialLinks.linkedin!);
                      }}
                      className="w-7 h-7 rounded-full items-center justify-center"
                      style={{ backgroundColor: '#0A66C220', borderWidth: 1, borderColor: '#0A66C240' }}
                    >
                      <Linkedin size={14} color="#0A66C2" />
                    </Pressable>
                  ) : null}
                  {socialLinks?.tiktok ? (
                    <Pressable
                      onPress={() => {
                        void safeOpenExternalUrl(socialLinks.tiktok!);
                      }}
                      className="w-7 h-7 rounded-full items-center justify-center"
                      style={{ backgroundColor: '#FFFFFF12', borderWidth: 1, borderColor: '#FFFFFF2A' }}
                    >
                      <Text style={{ color: '#FFFFFF', fontSize: 10, fontWeight: 'bold' }}>TT</Text>
                    </Pressable>
                  ) : null}
                  {socialLinks?.youtube ? (
                    <Pressable
                      onPress={() => {
                        void safeOpenExternalUrl(socialLinks.youtube!);
                      }}
                      className="w-7 h-7 rounded-full items-center justify-center"
                      style={{ backgroundColor: '#FF000020', borderWidth: 1, borderColor: '#FF000040' }}
                    >
                      <Youtube size={14} color="#FF0000" />
                    </Pressable>
                  ) : null}
                  {socialLinks?.website ? (
                    <Pressable
                      onPress={() => {
                        void safeOpenExternalUrl(socialLinks.website!);
                      }}
                      className="w-7 h-7 rounded-full items-center justify-center"
                      style={{ backgroundColor: `${COLORS.primary.gold}20`, borderWidth: 1, borderColor: `${COLORS.primary.gold}40` }}
                    >
                      <Globe size={14} color={COLORS.primary.gold} />
                    </Pressable>
                  ) : null}
                </View>
              ) : null}

              {/* Shop button */}
              <Pressable
                onPress={() => {
                  router.push({ pathname: '/(tabs)/shop', params: { producerId: producer.id } });
                }}
                className="rounded-xl py-2 flex-row items-center justify-center active:opacity-80"
                style={{
                  backgroundColor: COLORS.accent.forest,
                }}
              >
                <ShoppingBag size={14} color={COLORS.text.white} />
                <Text
                  className="font-bold ml-1.5 text-xs"
                  style={{ color: COLORS.text.white }}
                >
                  Boutique
                </Text>
              </Pressable>
            </View>

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

export default function MapScreen() {
  const insets = useSafeAreaInsets();
  const [currentIndex, setCurrentIndex] = useState(0);
  const [selectedRegion, setSelectedRegion] = useState<string | null>(null);
  const flatListRef = useRef<FlatList>(null);
  const scrollX = useSharedValue(0);
  const isScrolling = useSharedValue(0);
  const currentIndexRef = useRef(0);
  const isHoldingRef = useRef(false);
  const scrollDirectionRef = useRef<'prev' | 'next' | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const currentOffsetRef = useRef(0);

  const customProducers = useProducerStore((s) => s.producers);
  const { role } = useUserIdentity();
  const { isAdmin } = usePermissions();
  const syncedProducers = useSupabaseSyncStore((s) => s.syncedProducers);
  const setSyncedProducers = useSupabaseSyncStore((s) => s.setSyncedProducers);

  useEffect(() => {
    const loadFromSupabase = async () => {
      if (!isAdmin && isSupabaseSyncConfigured()) {
        try {
          const producers = await fetchAllProducersWithProducts();
          if (producers.length > 0) {
            setSyncedProducers(producers);
          }
        } catch (error) {
          console.warn('Error loading from Supabase:', error);
        }
      }
    };
    loadFromSupabase();
  }, [isAdmin, setSyncedProducers]);

  const allProducers = useMemo(() => {
    let producers: Producer[] = [];

    if (isAdmin) {
      // Admin: use custom producers + samples
      const customIds = new Set(customProducers.map(p => p.id));
      const filteredSamples = SAMPLE_PRODUCERS.filter(p => !customIds.has(p.id));
      producers = [...customProducers, ...filteredSamples];
    } else if (syncedProducers.length > 0) {
      // For non-admin with synced data: merge synced with local custom producers
      // Local custom producers (from useProducerStore) may have fresher data
      // So we use synced as base, but override with custom if same ID exists
      // Create a lookup object for custom producers by ID
      const customProducersById: Record<string, Producer> = {};
      customProducers.forEach(p => {
        customProducersById[p.id] = p;
      });

      producers = syncedProducers.map(syncedProducer => {
        // If this producer exists in customProducers, use the custom version (fresher data)
        const customVersion = customProducersById[syncedProducer.id];
        if (customVersion) {
          return customVersion;
        }
        // Also check by profileId for producers linked to user profiles
        const customByProfileId = customProducers.find(p => p.profileId && p.profileId === syncedProducer.profileId);
        if (customByProfileId) {
          return customByProfileId;
        }
        return syncedProducer;
      });

      // Add any custom producers not in synced (new local producers)
      const syncedIds = new Set(syncedProducers.map(p => p.id));
      const syncedProfileIds = new Set(syncedProducers.map(p => p.profileId).filter(Boolean));
      const newLocalProducers = customProducers.filter(p =>
        !syncedIds.has(p.id) && (!p.profileId || !syncedProfileIds.has(p.profileId))
      );
      producers = [...producers, ...newLocalProducers];
    } else {
      // Fallback: custom producers + samples
      const customIds = new Set(customProducers.map(p => p.id));
      const filteredSamples = SAMPLE_PRODUCERS.filter(p => !customIds.has(p.id));
      producers = [...customProducers, ...filteredSamples];
    }

    // Dédupliquer par ID pour éviter les cartes en double dans le carrousel
    const uniqueProducers = producers.filter(
      (producer, index, self) => index === self.findIndex((p) => p.id === producer.id)
    );

    return uniqueProducers;
  }, [isAdmin, syncedProducers, customProducers]);

  // Compter les producteurs par région (avec mapping des anciennes régions)
  const producersByRegion = useMemo(() => {
    const counts: Record<string, number> = {};
    FRENCH_REGIONS.forEach(region => {
      counts[region] = allProducers.filter(p => {
        const mappedRegion = mapToOfficialRegion(p.region);
        return mappedRegion === region;
      }).length;
    });
    return counts;
  }, [allProducers]);

  // Comptage des producteurs sans région ou avec une région non reconnue
  const unmappedProducersCount = useMemo(() => {
    return allProducers.filter(p => {
      const mappedRegion = mapToOfficialRegion(p.region);
      return mappedRegion === null;
    }).length;
  }, [allProducers]);

  // Filtrer les producteurs par région sélectionnée (avec mapping)
  const filteredProducers = useMemo(() => {
    if (!selectedRegion) return [];

    // Cas spécial pour "Autres régions"
    if (selectedRegion === '__OTHER__') {
      return allProducers.filter(p => {
        const mappedRegion = mapToOfficialRegion(p.region);
        return mappedRegion === null;
      });
    }

    return allProducers.filter(p => {
      const mappedRegion = mapToOfficialRegion(p.region);
      return mappedRegion === selectedRegion;
    });
  }, [allProducers, selectedRegion]);

  // Reset l'index quand on change de région
  useEffect(() => {
    if (selectedRegion) {
      setCurrentIndex(0);
      currentIndexRef.current = 0;
      currentOffsetRef.current = 0;
      flatListRef.current?.scrollToOffset({ offset: 0, animated: false });
    }
  }, [selectedRegion]);

  const displayedProducers = selectedRegion ? filteredProducers : allProducers;

  const ITEM_WIDTH = CARD_WIDTH + CARD_SPACING;
  const TOTAL_WIDTH = ITEM_WIDTH * displayedProducers.length;
  const SCROLL_SPEED = 8; // pixels per frame

  const continuousScroll = () => {
    if (!isHoldingRef.current || !scrollDirectionRef.current) return;

    const direction = scrollDirectionRef.current === 'next' ? 1 : -1;
    let newOffset = currentOffsetRef.current + (SCROLL_SPEED * direction);

    // Loop around like a wheel
    if (newOffset >= TOTAL_WIDTH) {
      newOffset = 0;
    } else if (newOffset < 0) {
      newOffset = TOTAL_WIDTH - ITEM_WIDTH;
    }

    currentOffsetRef.current = newOffset;
    flatListRef.current?.scrollToOffset({ offset: newOffset, animated: false });

    // Update current index based on offset
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

    // Start the continuous animation
    animationFrameRef.current = requestAnimationFrame(continuousScroll);
  };

  const stopContinuousScroll = () => {
    isHoldingRef.current = false;
    scrollDirectionRef.current = null;

    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }

    // Snap to nearest card
    const nearestIndex = Math.round(currentOffsetRef.current / ITEM_WIDTH) % displayedProducers.length;
    const snapOffset = nearestIndex * ITEM_WIDTH;
    flatListRef.current?.scrollToOffset({ offset: snapOffset, animated: true });
    currentIndexRef.current = nearestIndex;
    setCurrentIndex(nearestIndex);

    isScrolling.value = withTiming(0, { duration: 200 });
  };

  // Keep currentIndexRef in sync
  React.useEffect(() => {
    currentIndexRef.current = currentIndex;
    currentOffsetRef.current = currentIndex * ITEM_WIDTH;
  }, [currentIndex, ITEM_WIDTH]);

  const onViewableItemsChanged = useRef(({ viewableItems }: { viewableItems: ViewToken[] }) => {
    if (viewableItems.length > 0 && viewableItems[0].index !== null) {
      setCurrentIndex(viewableItems[0].index);
    }
  }).current;

  const viewabilityConfig = useRef({
    viewAreaCoveragePercentThreshold: 50,
  }).current;

  if (role === 'client') {
    return <Redirect href="/(tabs)/marche-local" />;
  }

  if (allProducers.length === 0) {
    return (
      <View className="flex-1 items-center justify-center" style={{ backgroundColor: COLORS.background.nightSky }}>
        <Leaf size={48} color={COLORS.text.muted} />
        <Text style={{ color: COLORS.text.muted }} className="mt-4 text-lg">
          Aucun producteur disponible
        </Text>
      </View>
    );
  }

  return (
    <View className="flex-1" style={{ backgroundColor: COLORS.background.nightSky }}>
      {/* Background image - fixed illustration */}
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

      {/* Header */}
      <LinearGradient
        colors={[`${COLORS.background.nightSky}E6`, `${COLORS.background.nightSky}99`, 'transparent']}
        style={{
          paddingTop: insets.top + 10,
          paddingHorizontal: 20,
          paddingBottom: 20,
        }}
      >
        {/* Music controls removed on map view */}

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
          <Text style={{ color: COLORS.text.muted }} className="text-sm mt-2">
            {allProducers.length} producteur{allProducers.length > 1 ? 's' : ''}
          </Text>
        </Animated.View>
      </LinearGradient>

      {/* Cache status banner */}
      <CompactCacheStatus />

      {/* Contenu principal - Liste des régions OU Carrousel des producteurs */}
      {!selectedRegion ? (
        /* Liste des régions */
        <View className="flex-1">
          <ScrollView
            contentContainerStyle={{
              paddingHorizontal: 16,
              paddingTop: 8,
              paddingBottom: insets.bottom + 20,
            }}
            showsVerticalScrollIndicator={false}
          >
            <Animated.View entering={FadeInDown.duration(400)}>
              <View className="flex-row items-center justify-center mb-4">
                <Map size={20} color={COLORS.primary.gold} />
                <Text style={{ color: COLORS.primary.paleGold }} className="text-lg font-bold ml-2">
                  Sélectionnez une région
                </Text>
              </View>

              {FRENCH_REGIONS.map((region, index) => {
                const count = producersByRegion[region] || 0;
                const hasProducers = count > 0;

                return (
                  <Animated.View
                    key={region}
                    entering={FadeInDown.duration(300).delay(index * 50)}
                  >
                    <Pressable
                      onPress={() => hasProducers && setSelectedRegion(region)}
                      disabled={!hasProducers}
                      className="mb-3 rounded-2xl overflow-hidden"
                      style={{
                        opacity: hasProducers ? 1 : 0.6,
                      }}
                    >
                      <View
                        className="px-4 py-4 flex-row items-center justify-between"
                        style={{
                          backgroundColor: hasProducers
                            ? 'rgba(22, 34, 54, 0.75)'
                            : 'rgba(15, 20, 30, 0.6)',
                          borderWidth: 1.5,
                          borderColor: hasProducers
                            ? `${COLORS.primary.gold}40`
                            : 'rgba(255,255,255,0.05)',
                          borderRadius: 16,
                        }}
                      >
                        <View className="flex-row items-center flex-1">
                          <View
                            className="w-10 h-10 rounded-full items-center justify-center mr-3"
                            style={{
                              backgroundColor: hasProducers
                                ? `${COLORS.primary.gold}20`
                                : 'rgba(255,255,255,0.05)',
                            }}
                          >
                            <MapPin
                              size={20}
                              color={hasProducers ? COLORS.primary.gold : COLORS.text.muted}
                            />
                          </View>
                          <View className="flex-1">
                            <Text
                              style={{
                                color: hasProducers ? COLORS.text.cream : COLORS.text.muted,
                              }}
                              className="font-semibold text-base"
                              numberOfLines={1}
                            >
                              {region}
                            </Text>
                            {hasProducers && (
                              <Text style={{ color: COLORS.accent.hemp }} className="text-xs mt-0.5">
                                {count} producteur{count > 1 ? 's' : ''}
                              </Text>
                            )}
                          </View>
                        </View>

                        {hasProducers && (
                          <View
                            className="px-3 py-1.5 rounded-full"
                            style={{ backgroundColor: COLORS.accent.forest }}
                          >
                            <Text style={{ color: COLORS.text.white }} className="text-xs font-bold">
                              Voir
                            </Text>
                          </View>
                        )}
                      </View>
                    </Pressable>
                  </Animated.View>
                );
              })}

              {/* Option "Autres régions" pour les producteurs sans région mappable */}
              {unmappedProducersCount > 0 && (
                <Animated.View
                  entering={FadeInDown.duration(300).delay(FRENCH_REGIONS.length * 50)}
                >
                  <Pressable
                    onPress={() => setSelectedRegion('__OTHER__')}
                    className="mb-3 rounded-2xl overflow-hidden"
                  >
                    <View
                      className="px-4 py-4 flex-row items-center justify-between"
                      style={{
                        backgroundColor: 'rgba(22, 34, 54, 0.75)',
                        borderWidth: 1.5,
                        borderColor: `${COLORS.accent.warmBrown}40`,
                        borderRadius: 16,
                      }}
                    >
                      <View className="flex-row items-center flex-1">
                        <View
                          className="w-10 h-10 rounded-full items-center justify-center mr-3"
                          style={{
                            backgroundColor: `${COLORS.accent.warmBrown}20`,
                          }}
                        >
                          <MapPin
                            size={20}
                            color={COLORS.accent.warmBrown}
                          />
                        </View>
                        <View className="flex-1">
                          <Text
                            style={{
                              color: COLORS.text.cream,
                            }}
                            className="font-semibold text-base"
                            numberOfLines={1}
                          >
                            Autres régions
                          </Text>
                          <Text style={{ color: COLORS.accent.warmBrown }} className="text-xs mt-0.5">
                            {unmappedProducersCount} producteur{unmappedProducersCount > 1 ? 's' : ''}
                          </Text>
                        </View>
                      </View>

                      <View
                        className="px-3 py-1.5 rounded-full"
                        style={{ backgroundColor: COLORS.accent.warmBrown }}
                      >
                        <Text style={{ color: COLORS.text.white }} className="text-xs font-bold">
                          Voir
                        </Text>
                      </View>
                    </View>
                  </Pressable>
                </Animated.View>
              )}
            </Animated.View>
          </ScrollView>
        </View>
      ) : (
        /* Carrousel des producteurs de la région */
        <>
          {/* Header région sélectionnée */}
          <Animated.View
            entering={FadeInUp.duration(300)}
            className="px-4 pb-2"
          >
            <Pressable
              onPress={() => setSelectedRegion(null)}
              className="flex-row items-center justify-center py-2 px-4 rounded-xl self-center"
              style={{
                backgroundColor: 'rgba(22, 34, 54, 0.85)',
                borderWidth: 1.5,
                borderColor: `${COLORS.primary.gold}50`,
              }}
            >
              <X size={16} color={COLORS.primary.gold} />
              <Text style={{ color: COLORS.primary.paleGold }} className="font-bold ml-2">
                {selectedRegion === '__OTHER__' ? 'Autres régions' : selectedRegion}
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
                Aucun producteur dans cette région
              </Text>
              <Pressable
                onPress={() => setSelectedRegion(null)}
                className="mt-4 px-6 py-3 rounded-xl"
                style={{ backgroundColor: COLORS.accent.forest }}
              >
                <Text style={{ color: COLORS.text.white }} className="font-bold">
                  Retour aux régions
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
                  <ProducerCardItem
                    producer={item}
                    index={index}
                    scrollX={scrollX}
                    isScrolling={isScrolling}
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
