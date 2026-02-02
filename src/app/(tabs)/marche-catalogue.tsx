import React, { useState, useEffect } from 'react';
import {
  View,
  FlatList,
  Pressable,
  Image,
  RefreshControl,
  ActivityIndicator,
} from 'react-native';
import { Text } from '@/components/ui';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { ArrowLeft, ShoppingCart, Layers, Zap } from 'lucide-react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { COLORS } from '@/lib/colors';
import { SUPABASE_URL, SUPABASE_ANON_KEY, getValidSession } from '@/lib/supabase-auth';
import { useDirectSalesCart } from '@/lib/direct-sales-cart';
import { useAuth } from '@/lib/useAuth';
import { PriceTier } from '@/lib/producers';
import LocalMarketOrderModal from '@/components/LocalMarketOrderModal';
import * as Haptics from 'expo-haptics';
import { optimizeImageUrl } from '@/lib/image-utils';

interface DirectSalesProduct {
  id: string;
  name: string;
  price_public: number;
  price_pro?: number;
  description: string;
  image: string;
  stock?: number;
  cbd_percent?: number;
  thc_percent?: number;
  disponible_vente_directe: boolean;
  price_tiers?: PriceTier[];
  producer?: ProducerInfo;
}

interface ProducerInfo {
  id: string;
  name: string;
  city?: string;
  region?: string;
  adresse_retrait?: string;
  horaires_retrait?: string;
  instructions_retrait?: string;
}

export default function MarcheCatalogue() {
  const insets = useSafeAreaInsets();
  const { producerId } = useLocalSearchParams<{ producerId: string }>();
  const [products, setProducts] = useState<DirectSalesProduct[]>([]);
  const [producer, setProducer] = useState<ProducerInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [page, setPage] = useState(0);

  const PAGE_SIZE = 20;

  // Modal state
  const [orderModalVisible, setOrderModalVisible] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<DirectSalesProduct | null>(null);

  const loadProducts = async (reset = false) => {
    if (!producerId) return;

    try {
      if (!reset) {
        setIsLoadingMore(true);
      }
      const nextPage = reset ? 0 : page;
      const offset = nextPage * PAGE_SIZE;

      // Récupérer les produits du producteur avec disponible_vente_directe = true et price_tiers
      const response = await fetch(
        `${SUPABASE_URL}/rest/v1/products?select=id,name,price_public,price_pro,description,image,stock,cbd_percent,thc_percent,disponible_vente_directe,price_tiers,producer:producers(id,name,city,region,adresse_retrait,horaires_retrait,instructions_retrait)&producer_id=eq.${producerId}&disponible_vente_directe=eq.true&status=eq.published&order=name.asc&limit=${PAGE_SIZE}&offset=${offset}`,
        {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
            apikey: SUPABASE_ANON_KEY,
            Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
          },
        }
      );

      if (response.ok) {
        const data = await response.json();
        const next = Array.isArray(data) ? data : [];
        setProducts((prev) => (reset ? next : [...prev, ...next]));
        setHasMore(next.length === PAGE_SIZE);
        setPage((prev) => (reset ? 1 : prev + 1));

        if (reset && next[0]?.producer) {
          setProducer(next[0].producer);
        }
      } else {
        if (reset) {
          setProducts([]);
        }
        setHasMore(false);
      }
    } catch (error) {
      if (reset) {
        setProducts([]);
      }
    } finally {
      setLoading(false);
      setIsLoadingMore(false);
    }
  };

  useEffect(() => {
    setPage(0);
    setHasMore(true);
    loadProducts(true);
  }, [producerId]);

  const onRefresh = async () => {
    setRefreshing(true);
    setPage(0);
    setHasMore(true);
    await loadProducts(true);
    setRefreshing(false);
  };

  const onLoadMore = async () => {
    if (isLoadingMore || !hasMore) return;
    await loadProducts(false);
  };

  // Handler pour ouvrir le modal de commande directe
  const handleDirectOrder = async (product: DirectSalesProduct) => {
    const session = await getValidSession();
    if (!session?.user?.id || !session?.access_token) {
      router.push('/auth/login');
      return;
    }

    setSelectedProduct(product);
    setOrderModalVisible(true);
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  };

  if (loading) {
    return (
      <LinearGradient
        colors={[COLORS.background.nightSky, COLORS.background.mediumBlue]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}
      >
        <ActivityIndicator size="large" color={COLORS.primary.gold} />
        <Text className="mt-4" style={{ color: COLORS.text.lightGray }}>
          Chargement des produits...
        </Text>
      </LinearGradient>
    );
  }

  return (
    <LinearGradient
      colors={[COLORS.background.nightSky, COLORS.background.mediumBlue]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={{ flex: 1 }}
    >
      <FlatList
        data={products}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <View className="px-4">
            <ProductCard
              product={item}
              producerId={producerId || ''}
              onDirectOrder={() => handleDirectOrder(item)}
            />
          </View>
        )}
        contentContainerStyle={{ paddingBottom: 40 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.primary.gold} />}
        ListHeaderComponent={
          <View>
            {/* Header avec bouton retour */}
            <View style={{ paddingTop: insets.top + 16 }} className="px-4 mb-6 flex-row items-center">
              <Pressable
                onPress={() => router.back()}
                className="p-2 rounded-lg mr-3"
                style={{ backgroundColor: `${COLORS.text.white}10` }}
              >
                <ArrowLeft size={24} color={COLORS.text.cream} />
              </Pressable>
              <View className="flex-1">
                <Text className="text-3xl font-bold" style={{ color: COLORS.text.cream }}>
                  Marché local
                </Text>
                <Text className="text-sm" style={{ color: COLORS.text.lightGray }}>
                  {producer?.name || 'Vente directe'}
                </Text>
              </View>
            </View>
          </View>
        }
        ListEmptyComponent={
          !loading ? (
            <View className="flex-1 items-center justify-center px-4 py-12">
              <ShoppingCart size={48} color={COLORS.text.muted} strokeWidth={1.5} />
              <Text className="text-center mt-4" style={{ color: COLORS.text.lightGray }}>
                Aucun produit disponible en vente directe pour le moment.
              </Text>
            </View>
          ) : null
        }
        ListFooterComponent={
          hasMore ? (
            <View className="items-center my-6">
              <Pressable
                onPress={onLoadMore}
                disabled={isLoadingMore}
                className="px-4 py-2 rounded-full"
                style={{ backgroundColor: `${COLORS.text.white}10` }}
              >
                <Text style={{ color: COLORS.text.lightGray }}>
                  {isLoadingMore ? 'Chargement...' : 'Charger plus'}
                </Text>
              </Pressable>
            </View>
          ) : (
            <View className="h-2" />
          )
        }
      />

      {/* Modal de commande directe */}
      {selectedProduct && producer && (
        <LocalMarketOrderModal
          visible={orderModalVisible}
          onClose={() => {
            setOrderModalVisible(false);
            setSelectedProduct(null);
          }}
          product={{
            id: selectedProduct.id,
            name: selectedProduct.name,
            price_public: selectedProduct.price_public,
            description: selectedProduct.description,
            image: selectedProduct.image,
            stock: selectedProduct.stock,
            price_tiers: selectedProduct.price_tiers,
          }}
          producer={{
            id: producer.id,
            name: producer.name,
            city: producer.city,
            region: producer.region,
            adresse_retrait: producer.adresse_retrait,
            horaires_retrait: producer.horaires_retrait,
            instructions_retrait: producer.instructions_retrait,
          }}
          onOrderSuccess={() => {}}
        />
      )}
    </LinearGradient>
  );
}

interface ProductCardProps {
  product: DirectSalesProduct;
  producerId: string;
  onDirectOrder: () => void;
}

function ProductCard({ product, producerId, onDirectOrder }: ProductCardProps) {
  const { session } = useAuth();
  const cart = useDirectSalesCart((s) => s);
  const [addedToCart, setAddedToCart] = useState(false);

  // Tarifs dégressifs
  const hasTieredPricing = product.price_tiers && product.price_tiers.length > 0;
  const sortedTiers = hasTieredPricing && product.price_tiers
    ? [...product.price_tiers].sort((a, b) => a.minQuantity - b.minQuantity)
    : [];
  const lowestTierPrice = sortedTiers.length > 0
    ? Math.min(...sortedTiers.map(t => t.price))
    : null;

  const handleAddToCart = async () => {
    if (!session?.user.id || !session?.access_token) {
      alert('Veuillez vous connecter pour ajouter au panier');
      return;
    }

    if (!product.stock || product.stock > 0) {
      await cart.addItem(session.user.id, session.access_token, {
        product_id: product.id,
        producer_id: producerId,
        producer_name: '',
        product_name: product.name,
        price: product.price_public,
        quantity: 1,
        image: product.image,
      });

      setAddedToCart(true);
      setTimeout(() => setAddedToCart(false), 2000);
    }
  };

  // Vérifier si le produit est en rupture de stock
  const isOutOfStock = typeof product.stock === 'number' && product.stock <= 0;

  return (
    <View
      className="mb-4 rounded-2xl overflow-hidden"
      style={{ backgroundColor: `${COLORS.text.white}08` }}
    >
      {/* Image */}
      {product.image && (
        <Image
          source={{ uri: optimizeImageUrl(product.image, 800) }}
          className="w-full h-48 bg-gray-800"
        />
      )}

      {/* Contenu */}
      <View className="p-4">
        {/* Header - Nom et Prix */}
        <View className="flex-row items-start justify-between mb-2">
          <View className="flex-1 mr-3">
            <Text className="text-lg font-bold" style={{ color: COLORS.text.cream }}>
              {product.name}
            </Text>
            {product.cbd_percent || product.thc_percent ? (
              <View className="flex-row items-center mt-1">
                {product.cbd_percent ? (
                  <Text className="text-xs" style={{ color: COLORS.accent.hemp }}>
                    CBD {product.cbd_percent}%
                  </Text>
                ) : null}
                {product.cbd_percent && product.thc_percent ? (
                  <Text className="text-xs mx-1" style={{ color: COLORS.text.muted }}>
                    •
                  </Text>
                ) : null}
                {product.thc_percent ? (
                  <Text className="text-xs" style={{ color: COLORS.accent.red }}>
                    THC {product.thc_percent}%
                  </Text>
                ) : null}
              </View>
            ) : null}
          </View>
          <View className="items-end">
            <Text className="text-2xl font-bold" style={{ color: COLORS.primary.gold }}>
              {product.price_public.toFixed(2)}€
            </Text>
            {hasTieredPricing && lowestTierPrice && (
              <View className="flex-row items-center mt-1">
                <Layers size={12} color={COLORS.accent.hemp} />
                <Text className="text-xs ml-1" style={{ color: COLORS.accent.hemp }}>
                  dès {lowestTierPrice.toFixed(2)}€
                </Text>
              </View>
            )}
          </View>
        </View>

        {/* Description */}
        {product.description && (
          <Text
            className="text-sm mb-3 leading-5"
            style={{ color: COLORS.text.lightGray }}
            numberOfLines={2}
          >
            {product.description}
          </Text>
        )}

        {/* Tarifs dégressifs */}
        {hasTieredPricing && sortedTiers.length > 0 && (
          <View
            className="mb-3 p-3 rounded-xl"
            style={{
              backgroundColor: `${COLORS.primary.gold}10`,
              borderWidth: 1,
              borderColor: `${COLORS.primary.gold}25`,
            }}
          >
            <View className="flex-row items-center mb-2">
              <Layers size={14} color={COLORS.primary.paleGold} />
              <Text className="ml-2 text-xs font-bold" style={{ color: COLORS.primary.paleGold }}>
                Tarifs dégressifs
              </Text>
            </View>
            <View className="flex-row items-center justify-between mb-1">
              <Text className="text-xs" style={{ color: COLORS.text.muted }}>
                1 - {sortedTiers[0]?.minQuantity ? sortedTiers[0].minQuantity - 1 : '∞'} unités
              </Text>
              <Text className="text-xs font-semibold" style={{ color: COLORS.primary.gold }}>
                {product.price_public.toFixed(2)}€
              </Text>
            </View>
            {sortedTiers.map((tier, index) => (
              <View key={index} className="flex-row items-center justify-between mb-1">
                <Text className="text-xs" style={{ color: COLORS.text.muted }}>
                  {tier.minQuantity}+ unités
                </Text>
                <Text className="text-xs font-semibold" style={{ color: COLORS.accent.hemp }}>
                  {tier.price.toFixed(2)}€
                </Text>
              </View>
            ))}
          </View>
        )}

        {/* Stock */}
        {product.stock !== undefined && (
          <View className="mb-3">
            <Text className="text-xs" style={{ color: COLORS.text.muted }}>
              {isOutOfStock ? (
                <Text style={{ color: COLORS.accent.red }}>Rupture de stock</Text>
              ) : (
                <>Stock: {product.stock} disponible</>
              )}
            </Text>
          </View>
        )}

        {/* Boutons */}
        <View className="flex-row gap-3">
          {/* Bouton Commander */}
          <Pressable
            onPress={onDirectOrder}
            disabled={isOutOfStock}
            className="flex-1 flex-row items-center justify-center py-3 rounded-xl"
            style={{
              backgroundColor: isOutOfStock ? COLORS.text.muted : COLORS.primary.orange,
              opacity: isOutOfStock ? 0.5 : 1,
            }}
          >
            <Zap size={18} color={COLORS.text.white} />
            <Text className="ml-2 font-bold" style={{ color: COLORS.text.white }}>
              Commander
            </Text>
          </Pressable>

          {/* Bouton Ajouter au panier */}
          <Pressable
            onPress={handleAddToCart}
            disabled={isOutOfStock}
            className="flex-row items-center justify-center py-3 px-4 rounded-xl"
            style={{
              backgroundColor: addedToCart ? COLORS.accent.hemp : (isOutOfStock ? COLORS.text.muted : `${COLORS.accent.hemp}30`),
              opacity: isOutOfStock ? 0.5 : 1,
            }}
          >
            <ShoppingCart size={18} color={addedToCart ? COLORS.text.white : COLORS.accent.hemp} />
            {addedToCart && (
              <Text className="ml-2 font-bold" style={{ color: COLORS.text.white }}>
                ✓
              </Text>
            )}
          </Pressable>
        </View>
      </View>
    </View>
  );
}
