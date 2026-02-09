/**
 * ProResourcePokemonCard — Pokémon-style card for pro resources/suppliers
 *
 * Two modes:
 * 1. Mini card (grid tile) — compact preview with logo + name
 * 2. Full modal — detailed view with glow, animations, actions
 */

import React from 'react';
import {
  View,
  Pressable,
  Image,
  Dimensions,
  Linking,
  ScrollView,
} from 'react-native';
import { Text } from '@/components/ui';
import {
  X,
  Sparkles,
  Star,
  ChevronLeft,
  ChevronRight,
  Globe,
  Mail,
  Phone,
  MapPin,
} from 'lucide-react-native';
import type { LucideIcon } from 'lucide-react-native';
import Animated, {
  FadeIn,
  FadeOut,
  ZoomIn,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { COLORS } from '@/lib/colors';
import type { ProResource } from '@/types/pro-resources';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const CARD_WIDTH = SCREEN_WIDTH - 60;
const CARD_HEIGHT = CARD_WIDTH * 1.45;

// ---------------------------------------------------------------------------
// Mini Card (grid tile)
// ---------------------------------------------------------------------------

interface MiniCardProps {
  resource: ProResource;
  categoryColor: string;
  categoryIcon: LucideIcon;
  onPress: () => void;
}

export function ProResourceMiniCard({
  resource,
  categoryColor,
  categoryIcon: IconComp,
  onPress,
}: MiniCardProps) {
  return (
    <Pressable onPress={onPress} className="overflow-hidden rounded-2xl" style={{ flex: 1 }}>
      <LinearGradient
        colors={[`${categoryColor}90`, COLORS.primary.gold, `${categoryColor}90`]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={{ padding: 2.5, borderRadius: 16 }}
      >
        <View
          className="rounded-[14px] overflow-hidden"
          style={{ backgroundColor: COLORS.background.nightSky }}
        >
          {/* Image / logo area */}
          <View className="h-24 items-center justify-center relative" style={{ backgroundColor: `${categoryColor}12` }}>
            {resource.logo_url ? (
              <Image
                source={{ uri: resource.logo_url }}
                className="w-full h-full"
                resizeMode="cover"
              />
            ) : (
              <View className="w-16 h-16 rounded-2xl items-center justify-center" style={{ backgroundColor: `${categoryColor}20` }}>
                <Text style={{ color: categoryColor, fontSize: 28, fontWeight: 'bold' }}>
                  {resource.name.charAt(0).toUpperCase()}
                </Text>
              </View>
            )}
            {/* Sparkle */}
            <View className="absolute top-2 right-2">
              <Sparkles size={12} color={COLORS.primary.brightYellow} />
            </View>
            {/* Featured star */}
            {resource.featured && (
              <View
                className="absolute top-2 left-2 px-1.5 py-0.5 rounded-full flex-row items-center"
                style={{ backgroundColor: `${COLORS.primary.gold}40` }}
              >
                <Star size={10} color={COLORS.primary.brightYellow} fill={COLORS.primary.brightYellow} />
              </View>
            )}
            {/* Gradient overlay */}
            <LinearGradient
              colors={['transparent', COLORS.background.nightSky]}
              style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 30 }}
            />
          </View>

          {/* Name + location */}
          <View className="px-3 py-2.5">
            <Text
              style={{ color: COLORS.text.cream }}
              className="font-bold text-sm"
              numberOfLines={1}
            >
              {resource.name}
            </Text>
            {(resource.city || resource.region) && (
              <View className="flex-row items-center mt-1">
                <MapPin size={10} color={COLORS.text.muted} />
                <Text style={{ color: COLORS.text.muted }} className="text-xs ml-1" numberOfLines={1}>
                  {[resource.city, resource.region].filter(Boolean).join(', ')}
                </Text>
              </View>
            )}
          </View>
        </View>
      </LinearGradient>
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
// Full-screen Modal Card
// ---------------------------------------------------------------------------

interface ModalCardProps {
  resource: ProResource;
  visible: boolean;
  categoryColor: string;
  categoryIcon: LucideIcon;
  categoryName: string;
  onClose: () => void;
  onPrevious?: () => void;
  onNext?: () => void;
  currentIndex?: number;
  totalCount?: number;
}

export function ProResourcePokemonCard({
  resource,
  visible,
  categoryColor,
  categoryIcon: IconComp,
  categoryName,
  onClose,
  onPrevious,
  onNext,
  currentIndex = 0,
  totalCount = 0,
}: ModalCardProps) {
  // Glow animation
  const glowOpacity = useSharedValue(0.4);
  const starRotation = useSharedValue(0);

  React.useEffect(() => {
    glowOpacity.value = withRepeat(
      withSequence(
        withTiming(0.8, { duration: 2000 }),
        withTiming(0.4, { duration: 2000 })
      ),
      -1,
      true
    );
    starRotation.value = withRepeat(
      withTiming(360, { duration: 8000 }),
      -1,
      false
    );
  }, [glowOpacity, starRotation]);

  const glowStyle = useAnimatedStyle(() => ({
    opacity: glowOpacity.value,
  }));

  const starStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${starRotation.value}deg` }],
  }));

  const openUrl = (url: string) => Linking.openURL(url).catch(() => {});

  if (!visible) return null;

  const hasActions = Boolean(resource.website_url || resource.email || resource.phone);

  return (
    <Animated.View
      entering={FadeIn.duration(300)}
      exiting={FadeOut.duration(200)}
      className="absolute inset-0 items-center justify-center z-50"
      style={{ backgroundColor: 'rgba(15, 26, 46, 0.95)' }}
    >
      {/* Backdrop */}
      <Pressable className="absolute inset-0" onPress={onClose} />

      {/* Navigation arrows */}
      {onPrevious && (
        <Pressable
          onPress={onPrevious}
          className="absolute left-2 z-20 w-12 h-12 rounded-full items-center justify-center active:scale-95"
          style={{
            backgroundColor: `${COLORS.background.nightSky}E0`,
            borderWidth: 2,
            borderColor: categoryColor,
            shadowColor: categoryColor,
            shadowOffset: { width: 0, height: 2 },
            shadowOpacity: 0.5,
            shadowRadius: 8,
          }}
        >
          <ChevronLeft size={28} color={categoryColor} />
        </Pressable>
      )}
      {onNext && (
        <Pressable
          onPress={onNext}
          className="absolute right-2 z-20 w-12 h-12 rounded-full items-center justify-center active:scale-95"
          style={{
            backgroundColor: `${COLORS.background.nightSky}E0`,
            borderWidth: 2,
            borderColor: categoryColor,
            shadowColor: categoryColor,
            shadowOffset: { width: 0, height: 2 },
            shadowOpacity: 0.5,
            shadowRadius: 8,
          }}
        >
          <ChevronRight size={28} color={categoryColor} />
        </Pressable>
      )}

      {/* Counter */}
      {totalCount > 1 && (
        <View
          className="absolute bottom-8 px-4 py-2 rounded-full"
          style={{
            backgroundColor: `${COLORS.background.nightSky}E0`,
            borderWidth: 1.5,
            borderColor: `${categoryColor}50`,
          }}
        >
          <Text style={{ color: COLORS.primary.paleGold }} className="font-bold text-sm">
            {currentIndex + 1} / {totalCount}
          </Text>
        </View>
      )}

      {/* Glow effects */}
      <Animated.View
        style={[
          glowStyle,
          {
            position: 'absolute',
            width: CARD_WIDTH + 30,
            height: CARD_HEIGHT + 30,
            borderRadius: 32,
            backgroundColor: COLORS.primary.gold,
            shadowColor: COLORS.primary.brightYellow,
            shadowOffset: { width: 0, height: 0 },
            shadowOpacity: 1,
            shadowRadius: 40,
          },
        ]}
      />
      <Animated.View
        style={[
          glowStyle,
          {
            position: 'absolute',
            width: CARD_WIDTH + 20,
            height: CARD_HEIGHT + 20,
            borderRadius: 30,
            backgroundColor: categoryColor,
            shadowColor: categoryColor,
            shadowOffset: { width: 0, height: 0 },
            shadowOpacity: 0.6,
            shadowRadius: 30,
            opacity: 0.3,
          },
        ]}
      />

      {/* Floating stars */}
      <Animated.View style={[starStyle, { position: 'absolute', top: '15%', left: '10%' }]}>
        <Star size={16} color={COLORS.primary.brightYellow} fill={COLORS.primary.brightYellow} />
      </Animated.View>
      <Animated.View style={[starStyle, { position: 'absolute', top: '20%', right: '15%' }]}>
        <Sparkles size={14} color={COLORS.clouds.golden} />
      </Animated.View>

      {/* Main Card */}
      <Animated.View
        entering={ZoomIn.springify().damping(14)}
        style={{
          width: CARD_WIDTH,
          maxHeight: CARD_HEIGHT,
          borderRadius: 28,
          overflow: 'hidden',
        }}
      >
        <LinearGradient
          colors={[categoryColor, COLORS.primary.gold, categoryColor]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={{ flex: 1, padding: 4 }}
        >
          <View
            className="flex-1 rounded-[24px] overflow-hidden"
            style={{ backgroundColor: COLORS.background.nightSky }}
          >
            {/* Close button */}
            <Pressable
              onPress={onClose}
              className="absolute top-3 right-3 z-10 w-9 h-9 rounded-full items-center justify-center"
              style={{
                backgroundColor: `${COLORS.background.nightSky}90`,
                borderWidth: 1.5,
                borderColor: `${categoryColor}50`,
              }}
            >
              <X size={18} color={COLORS.primary.paleGold} />
            </Pressable>

            {/* Image area — 35% */}
            <View className="h-[35%] relative">
              {resource.logo_url ? (
                <Image
                  source={{ uri: resource.logo_url }}
                  className="w-full h-full"
                  resizeMode="cover"
                />
              ) : (
                <View
                  className="w-full h-full items-center justify-center"
                  style={{ backgroundColor: `${categoryColor}12` }}
                >
                  <View
                    className="w-20 h-20 rounded-3xl items-center justify-center"
                    style={{ backgroundColor: `${categoryColor}25` }}
                  >
                    <Text style={{ color: categoryColor, fontSize: 42, fontWeight: 'bold' }}>
                      {resource.name.charAt(0).toUpperCase()}
                    </Text>
                  </View>
                </View>
              )}
              {/* Gradient overlay */}
              <LinearGradient
                colors={['transparent', `${COLORS.background.nightSky}99`, COLORS.background.nightSky]}
                style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 80 }}
              />
              {/* Sparkle */}
              <View className="absolute top-4 left-4">
                <Sparkles size={20} color={COLORS.primary.brightYellow} />
              </View>
              {/* Category badge */}
              <View
                className="absolute top-4 left-14 px-2.5 py-1 rounded-full flex-row items-center"
                style={{ backgroundColor: `${categoryColor}40` }}
              >
                <IconComp size={12} color={categoryColor} />
                <Text style={{ color: categoryColor }} className="text-xs font-bold ml-1">
                  {categoryName}
                </Text>
              </View>
              {/* Featured badge */}
              {resource.featured && (
                <View
                  className="absolute top-12 left-4 px-2 py-1 rounded-full flex-row items-center"
                  style={{ backgroundColor: `${COLORS.primary.gold}40` }}
                >
                  <Star size={12} color={COLORS.primary.brightYellow} fill={COLORS.primary.brightYellow} />
                  <Text style={{ color: COLORS.primary.brightYellow }} className="text-xs font-bold ml-1">
                    Recommandé
                  </Text>
                </View>
              )}
              {/* Border shine */}
              <View
                pointerEvents="none"
                className="absolute inset-0"
                style={{ borderWidth: 2, borderColor: `${categoryColor}50` }}
              />
            </View>

            {/* Content area — scrollable */}
            <ScrollView
              className="flex-1 px-5 -mt-3"
              showsVerticalScrollIndicator={false}
              contentContainerStyle={{ paddingBottom: 16 }}
            >
              {/* Name banner */}
              <View
                className="rounded-2xl px-4 py-3 mb-3"
                style={{
                  backgroundColor: `${categoryColor}20`,
                  borderWidth: 2,
                  borderColor: `${categoryColor}45`,
                  shadowColor: categoryColor,
                  shadowOffset: { width: 0, height: 2 },
                  shadowOpacity: 0.3,
                  shadowRadius: 8,
                }}
              >
                <View className="flex-row items-center justify-center">
                  <Sparkles size={16} color={COLORS.primary.brightYellow} />
                  <Text
                    className="text-lg font-bold text-center mx-2"
                    style={{ color: COLORS.primary.paleGold }}
                    numberOfLines={2}
                  >
                    {resource.name}
                  </Text>
                  <Sparkles size={16} color={COLORS.primary.brightYellow} />
                </View>
              </View>

              {/* Location pill */}
              {(resource.city || resource.region) && (
                <View className="flex-row items-center justify-center mb-3">
                  <View
                    className="flex-row items-center px-3 py-1.5 rounded-full"
                    style={{ backgroundColor: 'rgba(147, 112, 219, 0.2)' }}
                  >
                    <MapPin size={14} color="#9370DB" />
                    <Text className="text-sm ml-1.5 font-semibold" style={{ color: '#9370DB' }}>
                      {[resource.city, resource.region].filter(Boolean).join(', ')}
                    </Text>
                  </View>
                </View>
              )}

              {/* Description */}
              {resource.description && (
                <View
                  className="rounded-xl px-4 py-3 mb-3"
                  style={{
                    backgroundColor: `${COLORS.text.white}05`,
                    borderWidth: 1,
                    borderColor: `${COLORS.primary.gold}15`,
                  }}
                >
                  <Text style={{ color: COLORS.text.lightGray }} className="text-sm leading-5">
                    {resource.description}
                  </Text>
                </View>
              )}

              {/* Tags */}
              {resource.tags.length > 0 && (
                <View className="flex-row flex-wrap justify-center gap-2 mb-3">
                  {resource.tags.map((tag) => (
                    <View
                      key={tag}
                      className="px-3 py-1.5 rounded-full"
                      style={{
                        backgroundColor: `${categoryColor}20`,
                        borderWidth: 1,
                        borderColor: `${categoryColor}40`,
                      }}
                    >
                      <Text style={{ color: categoryColor }} className="text-xs font-bold">
                        {tag}
                      </Text>
                    </View>
                  ))}
                </View>
              )}

              {/* Action buttons */}
              {hasActions && (
                <View className="gap-2.5 mt-1">
                  {resource.website_url && (
                    <Pressable
                      onPress={() => openUrl(resource.website_url!)}
                      className="flex-row items-center justify-center py-3 rounded-2xl active:opacity-80"
                      style={{
                        backgroundColor: COLORS.accent.forest,
                        shadowColor: COLORS.accent.hemp,
                        shadowOffset: { width: 0, height: 4 },
                        shadowOpacity: 0.4,
                        shadowRadius: 12,
                      }}
                    >
                      <Globe size={18} color={COLORS.text.white} />
                      <Text className="font-bold ml-2" style={{ color: COLORS.text.white }}>
                        Visiter le site web
                      </Text>
                      <Sparkles size={14} color={COLORS.primary.brightYellow} style={{ marginLeft: 8 }} />
                    </Pressable>
                  )}
                  <View className="flex-row gap-2.5">
                    {resource.email && (
                      <Pressable
                        onPress={() => openUrl(`mailto:${resource.email}`)}
                        className="flex-1 flex-row items-center justify-center py-3 rounded-2xl active:opacity-80"
                        style={{
                          backgroundColor: `${COLORS.primary.gold}15`,
                          borderWidth: 1.5,
                          borderColor: `${COLORS.primary.gold}30`,
                        }}
                      >
                        <Mail size={16} color={COLORS.primary.gold} />
                        <Text style={{ color: COLORS.primary.gold }} className="font-semibold text-sm ml-1.5">
                          Email
                        </Text>
                      </Pressable>
                    )}
                    {resource.phone && (
                      <Pressable
                        onPress={() => openUrl(`tel:${resource.phone}`)}
                        className="flex-1 flex-row items-center justify-center py-3 rounded-2xl active:opacity-80"
                        style={{
                          backgroundColor: `${COLORS.accent.hemp}15`,
                          borderWidth: 1.5,
                          borderColor: `${COLORS.accent.hemp}30`,
                        }}
                      >
                        <Phone size={16} color={COLORS.accent.hemp} />
                        <Text style={{ color: COLORS.accent.hemp }} className="font-semibold text-sm ml-1.5">
                          Appeler
                        </Text>
                      </Pressable>
                    )}
                  </View>
                </View>
              )}
            </ScrollView>

            {/* Card border shine */}
            <View
              pointerEvents="none"
              className="absolute inset-0 rounded-[24px]"
              style={{ borderWidth: 2, borderColor: `${categoryColor}40` }}
            />
          </View>
        </LinearGradient>
      </Animated.View>
    </Animated.View>
  );
}
