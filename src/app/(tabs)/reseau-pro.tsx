/**
 * Réseau Pro Screen — Producer-only resource directory
 * Categories: Formation, Semences, Vie du Sol, Outillage (configurable via DB)
 * Displays suppliers as Pokémon-style cards in a 2-column grid with full-screen modal detail.
 */

import React, { useState, useCallback, useMemo } from 'react';
import {
  View,
  ScrollView,
  Pressable,
  ActivityIndicator,
  RefreshControl,
  Linking,
} from 'react-native';
import { Text } from '@/components/ui';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, { FadeInUp, FadeInDown } from 'react-native-reanimated';
import {
  Handshake,
  GraduationCap,
  Sprout,
  Bug,
  Wrench,
  Sparkles,
  Search,
  X,
  Folder,
  Users,
} from 'lucide-react-native';
import type { LucideIcon } from 'lucide-react-native';
import { COLORS } from '@/lib/colors';
import { usePermissions } from '@/lib/useAuth';
import { useProResourceCategories, useProResources } from '@/lib/hooks/useProResources';
import { ProResourceMiniCard, ProResourcePokemonCard } from '@/components/ProResourcePokemonCard';
import type { ProResourceCategory, ProResource } from '@/types/pro-resources';

/**
 * Slug → Icon mapping. If admin adds a new category via DB,
 * it gets the fallback Folder icon. No runtime crash.
 */
const SIGNAL_GROUP_URL = 'https://signal.group/#CjQKIL5CUggt4OrebPgc7zjsc_h_AzrSw8I6k3QPM2l4MTkAEhDN8aN4Rmj_6F7NA8Dkved1';

const CATEGORY_ICONS: Record<string, LucideIcon> = {
  formation: GraduationCap,
  semences: Sprout,
  'vie-du-sol': Bug,
  outillage: Wrench,
};

function getCategoryIcon(slug: string): LucideIcon {
  return CATEGORY_ICONS[slug] ?? Folder;
}

export default function ReseauProScreen() {
  const insets = useSafeAreaInsets();
  const { isPro, isProducer, isAdmin } = usePermissions();

  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null);
  const [selectedResource, setSelectedResource] = useState<ProResource | null>(null);

  const {
    data: categories,
    isLoading: loadingCategories,
    refetch: refetchCategories,
  } = useProResourceCategories();

  // Fetch all resources once — filter client-side for instant category switching
  const {
    data: allResources,
    isLoading: loadingResources,
    refetch: refetchResources,
  } = useProResources();

  const isLoading = loadingCategories || loadingResources;

  const selectedCategory = useMemo(
    () => categories?.find((c) => c.id === selectedCategoryId) ?? null,
    [categories, selectedCategoryId]
  );

  // Filter resources by selected category
  const displayedResources = useMemo(() => {
    if (!allResources) return [];
    if (!selectedCategoryId) return allResources;
    return allResources.filter((r) => r.category_id === selectedCategoryId);
  }, [allResources, selectedCategoryId]);

  // Count resources per category (always from full dataset)
  const getCategoryCount = useCallback(
    (catId: string) => allResources?.filter((r) => r.category_id === catId).length ?? 0,
    [allResources]
  );

  const handleRefresh = useCallback(async () => {
    await Promise.all([refetchCategories(), refetchResources()]);
  }, [refetchCategories, refetchResources]);

  const handleCategoryPress = (cat: ProResourceCategory) => {
    setSelectedCategoryId((prev) => (prev === cat.id ? null : cat.id));
  };

  // Resolve category info for a resource
  const getCategoryForResource = useCallback(
    (resource: ProResource) => categories?.find((c) => c.id === resource.category_id) ?? null,
    [categories]
  );

  // Modal navigation
  const selectedResourceIndex = selectedResource
    ? displayedResources.findIndex((r) => r.id === selectedResource.id)
    : -1;

  const handlePrevious = selectedResourceIndex > 0
    ? () => setSelectedResource(displayedResources[selectedResourceIndex - 1])
    : undefined;

  const handleNext = selectedResourceIndex < displayedResources.length - 1
    ? () => setSelectedResource(displayedResources[selectedResourceIndex + 1])
    : undefined;

  const modalCategory = selectedResource ? getCategoryForResource(selectedResource) : null;

  // Guard: pros, producers and admins only
  if (!isPro && !isProducer && !isAdmin) {
    return (
      <View className="flex-1 items-center justify-center" style={{ backgroundColor: COLORS.background.nightSky }}>
        <Text style={{ color: COLORS.text.muted }}>Accès réservé aux professionnels</Text>
      </View>
    );
  }

  return (
    <View className="flex-1" style={{ backgroundColor: COLORS.background.nightSky }}>
      {/* Background gradient */}
      <LinearGradient
        colors={[`${COLORS.accent.forest}20`, 'transparent', `${COLORS.primary.gold}08`]}
        style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 350 }}
      />

      {/* Header */}
      <View style={{ paddingTop: insets.top }}>
        <Animated.View
          entering={FadeInDown.duration(400)}
          className="px-5 pt-4 pb-3"
          style={{ borderBottomWidth: 2, borderBottomColor: `${COLORS.accent.forest}30` }}
        >
          <View className="flex-row items-center">
            <View
              className="w-11 h-11 rounded-2xl items-center justify-center mr-3"
              style={{
                backgroundColor: `${COLORS.accent.forest}20`,
                borderWidth: 1.5,
                borderColor: `${COLORS.accent.forest}40`,
              }}
            >
              <Handshake size={22} color={COLORS.accent.hemp} />
            </View>
            <View className="flex-1">
              <View className="flex-row items-center">
                <Text style={{ color: COLORS.text.cream }} className="text-2xl font-bold">
                  Réseau Pro
                </Text>
                <Sparkles size={16} color={COLORS.primary.brightYellow} style={{ marginLeft: 8 }} />
              </View>
              <Text style={{ color: COLORS.text.muted }} className="text-sm">
                Fournisseurs, formations & ressources
              </Text>
            </View>
          </View>
        </Animated.View>
      </View>

      <ScrollView
        className="flex-1"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: insets.bottom + 40 }}
        refreshControl={
          <RefreshControl
            refreshing={false}
            onRefresh={handleRefresh}
            tintColor={COLORS.primary.gold}
            colors={[COLORS.primary.gold]}
          />
        }
      >
        {/* Categories grid */}
        <View className="px-5 pt-5">
          <Animated.View entering={FadeInUp.duration(400).delay(100)}>
            <Text style={{ color: COLORS.primary.paleGold }} className="text-lg font-bold mb-3">
              Catégories
            </Text>
          </Animated.View>

          {loadingCategories ? (
            <ActivityIndicator size="small" color={COLORS.primary.gold} />
          ) : (
            <View className="flex-row flex-wrap gap-3">
              {categories?.map((cat, index) => {
                const IconComp = getCategoryIcon(cat.slug);
                const isSelected = selectedCategoryId === cat.id;
                const count = getCategoryCount(cat.id);

                return (
                  <Animated.View
                    key={cat.id}
                    entering={FadeInUp.duration(400).delay(150 + index * 80)}
                    style={{ width: '47%' }}
                  >
                    <Pressable
                      onPress={() => handleCategoryPress(cat)}
                      className="rounded-2xl p-4"
                      style={{
                        backgroundColor: isSelected
                          ? `${cat.color}25`
                          : COLORS.background.charcoal,
                        borderWidth: 2,
                        borderColor: isSelected ? `${cat.color}60` : `${COLORS.primary.gold}15`,
                        minHeight: 110,
                      }}
                    >
                      <View
                        className="w-10 h-10 rounded-xl items-center justify-center mb-2"
                        style={{ backgroundColor: `${cat.color}20` }}
                      >
                        <IconComp size={22} color={cat.color} />
                      </View>
                      <Text
                        style={{ color: isSelected ? cat.color : COLORS.text.cream }}
                        className="font-bold text-sm"
                        numberOfLines={1}
                      >
                        {cat.name}
                      </Text>
                      <Text style={{ color: COLORS.text.muted }} className="text-xs mt-0.5">
                        {count} fournisseur{count !== 1 ? 's' : ''}
                      </Text>
                    </Pressable>
                  </Animated.View>
                );
              })}
            </View>
          )}
        </View>

        {/* Active filter chip */}
        {selectedCategory && (
          <Animated.View entering={FadeInUp.duration(300)} className="px-5 mt-4">
            <View className="flex-row items-center">
              <View
                className="flex-row items-center px-3 py-1.5 rounded-full mr-2"
                style={{ backgroundColor: `${selectedCategory.color}20` }}
              >
                <Text style={{ color: selectedCategory.color }} className="text-sm font-semibold">
                  {selectedCategory.name}
                </Text>
                <Pressable onPress={() => setSelectedCategoryId(null)} className="ml-2">
                  <X size={14} color={selectedCategory.color} />
                </Pressable>
              </View>
            </View>
          </Animated.View>
        )}

        {/* Resources grid — Pokémon mini-cards */}
        <View className="px-5 mt-5">
          <Animated.View entering={FadeInUp.duration(400).delay(300)}>
            <Text style={{ color: COLORS.primary.paleGold }} className="text-lg font-bold mb-3">
              {selectedCategory ? selectedCategory.name : 'Tous les fournisseurs'}
            </Text>
          </Animated.View>

          {isLoading ? (
            <View className="py-8 items-center">
              <ActivityIndicator size="large" color={COLORS.primary.gold} />
            </View>
          ) : displayedResources.length > 0 ? (
            <View className="flex-row flex-wrap gap-3">
              {displayedResources.map((resource, index) => {
                const cat = getCategoryForResource(resource);
                const catColor = cat?.color ?? COLORS.primary.gold;
                const CatIcon = getCategoryIcon(cat?.slug ?? '');

                return (
                  <Animated.View
                    key={resource.id}
                    entering={FadeInUp.duration(400).delay(350 + index * 60)}
                    style={{ width: '47%' }}
                  >
                    <ProResourceMiniCard
                      resource={resource}
                      categoryColor={catColor}
                      categoryIcon={CatIcon}
                      onPress={() => setSelectedResource(resource)}
                    />
                  </Animated.View>
                );
              })}
            </View>
          ) : (
            <View
              className="rounded-2xl p-6 items-center"
              style={{
                backgroundColor: COLORS.background.charcoal,
                borderWidth: 1.5,
                borderColor: `${COLORS.primary.gold}15`,
              }}
            >
              <Search size={32} color={COLORS.text.muted} />
              <Text style={{ color: COLORS.text.muted }} className="text-center mt-3">
                {selectedCategory
                  ? `Aucun fournisseur dans "${selectedCategory.name}" pour le moment`
                  : 'Aucun fournisseur enregistré pour le moment'}
              </Text>
              <Text style={{ color: COLORS.text.muted }} className="text-xs text-center mt-1">
                De nouveaux partenaires seront ajoutés prochainement
              </Text>
            </View>
          )}
        </View>

        {/* Signal Group CTA */}
        <Animated.View entering={FadeInUp.duration(400).delay(500)} className="px-5 mt-6">
          <View
            className="rounded-2xl p-4"
            style={{
              backgroundColor: 'rgba(16, 185, 129, 0.12)',
              borderWidth: 1.5,
              borderColor: 'rgba(16, 185, 129, 0.35)',
            }}
          >
            <View className="flex-row items-start">
              <View
                className="w-10 h-10 rounded-full items-center justify-center mr-3"
                style={{ backgroundColor: 'rgba(16, 185, 129, 0.25)' }}
              >
                <Users size={20} color="#10B981" />
              </View>
              <View className="flex-1">
                <Text style={{ color: COLORS.text.cream }} className="font-semibold">
                  Des questions ? Des idées ? Besoin d'aide ?
                </Text>
                <Text className="text-emerald-200 text-sm mt-1">
                  Rejoins la commu sur Signal
                </Text>
              </View>
            </View>
            <Pressable
              onPress={() => Linking.openURL(SIGNAL_GROUP_URL)}
              className="mt-3 py-2.5 rounded-xl items-center justify-center active:opacity-80"
              style={{ backgroundColor: '#10B981' }}
            >
              <Text style={{ color: '#fff' }} className="font-bold">
                Rejoindre le groupe Signal
              </Text>
            </Pressable>
          </View>
        </Animated.View>
      </ScrollView>

      {/* Full-screen Pokémon card modal */}
      {selectedResource && modalCategory && (
        <ProResourcePokemonCard
          resource={selectedResource}
          visible
          categoryColor={modalCategory.color}
          categoryIcon={getCategoryIcon(modalCategory.slug)}
          categoryName={modalCategory.name}
          onClose={() => setSelectedResource(null)}
          onPrevious={handlePrevious}
          onNext={handleNext}
          currentIndex={selectedResourceIndex}
          totalCount={displayedResources.length}
        />
      )}
      {/* Fallback modal when category not found (e.g. "Tous les fournisseurs" view) */}
      {selectedResource && !modalCategory && (
        <ProResourcePokemonCard
          resource={selectedResource}
          visible
          categoryColor={COLORS.primary.gold}
          categoryIcon={Folder}
          categoryName="Fournisseur"
          onClose={() => setSelectedResource(null)}
          onPrevious={handlePrevious}
          onNext={handleNext}
          currentIndex={selectedResourceIndex}
          totalCount={displayedResources.length}
        />
      )}
    </View>
  );
}
