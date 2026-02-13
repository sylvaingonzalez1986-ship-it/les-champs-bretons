import React, { useMemo, useState, useEffect, useCallback, useRef } from 'react';
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
import { ArrowLeft, Eye, ShoppingCart, Layers, MapPin, Sparkles, Truck, Store } from 'lucide-react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { COLORS } from '@/lib/colors';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '@/lib/supabase-auth';
import { useDirectSalesCart } from '@/lib/direct-sales-cart';
import { useAuth } from '@/lib/useAuth';
import { PriceTier, Producer, ProducerProduct } from '@/lib/producers';
import { ShopProductDetailModal } from '@/components/ShopProductDetailModal';
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
  type?: ProducerProduct['type'] | string;
  weight?: string;
  images?: string[];
  tva_rate?: number;
  is_on_promo?: boolean;
  promo_percent?: number;
  lab_analysis_url?: string;
  price_pro_tiers?: PriceTier[];
  status?: 'draft' | 'published' | 'archived';
  delivery_type?: 'flat' | 'min_order';
  delivery_flat_price?: number;
  delivery_min_order_amount?: number;
  ville_retrait?: string;
  video_url?: string;
  disponible_vente_directe: boolean;
  price_tiers?: PriceTier[];
  producer?: ProducerInfo;
}

interface ProducerInfo {
  id: string;
  name: string;
  city?: string;
  region?: string;
  department?: string;
  description?: string;
  image?: string;
  adresse_retrait?: string;
  horaires_retrait?: string;
  instructions_retrait?: string;
  shipping_enabled?: boolean | null;
  shipping_fee?: number | null;
  shipping_note?: string | null;
}

function normalizeProductType(type?: string): ProducerProduct['type'] {
  if (type === 'fleur' || type === 'huile' || type === 'resine' || type === 'infusion') {
    return type;
  }
  return 'fleur';
}

function toProducerProduct(product: DirectSalesProduct): ProducerProduct {
  return {
    id: product.id,
    name: product.name,
    type: normalizeProductType(product.type),
    cbdPercent: product.cbd_percent ?? 0,
    thcPercent: product.thc_percent ?? 0,
    price: product.price_public,
    pricePro: product.price_pro,
    weight: product.weight ?? '',
    image: product.image,
    images: product.images,
    videoUrl: product.video_url,
    description: product.description ?? '',
    tvaRate: product.tva_rate ?? 20,
    stock: product.stock,
    isOnPromo: product.is_on_promo ?? false,
    promoPercent: product.promo_percent ?? undefined,
    status: product.status,
    labAnalysisUrl: product.lab_analysis_url ?? undefined,
    priceTiers: product.price_tiers,
    priceProTiers: product.price_pro_tiers,
    disponible_vente_directe: product.disponible_vente_directe,
    ville_retrait: product.ville_retrait,
    delivery_type: product.delivery_type,
    delivery_flat_price: product.delivery_flat_price,
    delivery_min_order_amount: product.delivery_min_order_amount,
  };
}

function toProducer(producer: ProducerInfo): Producer {
  return {
    id: producer.id,
    name: producer.name,
    region: producer.region ?? 'Région inconnue',
    department: producer.department ?? 'Département inconnu',
    city: producer.city ?? 'Ville inconnue',
    image: producer.image ?? '',
    description: producer.description ?? '',
    coordinates: {
      latitude: 46.603354,
      longitude: 1.888334,
    },
    soil: {
      type: '',
      ph: '',
      characteristics: '',
    },
    climate: {
      type: '',
      avgTemp: '',
      rainfall: '',
    },
    products: [],
    vente_directe_ferme: true,
    adresse_retrait: producer.adresse_retrait,
    horaires_retrait: producer.horaires_retrait,
    instructions_retrait: producer.instructions_retrait,
    shipping_enabled: producer.shipping_enabled ?? undefined,
    shipping_fee: producer.shipping_fee ?? undefined,
    shipping_note: producer.shipping_note ?? undefined,
  };
}

export default function MarcheCatalogue() {
  const insets = useSafeAreaInsets();
  const { session } = useAuth();
  const cart = useDirectSalesCart((s) => s);
  const { producerId } = useLocalSearchParams<{ producerId: string }>();
  const [products, setProducts] = useState<DirectSalesProduct[]>([]);
  const [producer, setProducer] = useState<ProducerInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const pageRef = useRef(0);

  const PAGE_SIZE = 20;

  // Modal state
  const [detailModalVisible, setDetailModalVisible] = useState(false);
  const [detailProduct, setDetailProduct] = useState<DirectSalesProduct | null>(null);

  const detailModalProduct = useMemo<ProducerProduct | null>(
    () => (detailProduct ? toProducerProduct(detailProduct) : null),
    [detailProduct]
  );

  const detailModalProducer = useMemo<Producer | null>(
    () => (producer ? toProducer(producer) : null),
    [producer]
  );

  const loadProducts = useCallback(async (reset = false) => {
    if (!producerId) return;

    try {
      if (!reset) {
        setIsLoadingMore(true);
      }
      const nextPage = reset ? 0 : pageRef.current;
      const offset = nextPage * PAGE_SIZE;

      // Récupérer les produits du producteur avec disponible_vente_directe = true et price_tiers
      const response = await fetch(
        `${SUPABASE_URL}/functions/v1/public-catalog?action=productsByProducer&producerId=${producerId}&limit=${PAGE_SIZE}&offset=${offset}`,
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
        const next = Array.isArray(data?.products) ? data.products : [];
        setProducts((prev) => (reset ? next : [...prev, ...next]));
        setHasMore(Boolean(data?.hasMore));
        pageRef.current = reset ? 1 : pageRef.current + 1;

        if (reset && data?.producer) {
          setProducer(data.producer as ProducerInfo);
        }
      } else {
        if (reset) {
          setProducts([]);
        }
        setHasMore(false);
      }
    } catch {
      if (reset) {
        setProducts([]);
      }
    } finally {
      setLoading(false);
      setIsLoadingMore(false);
    }
  }, [producerId, PAGE_SIZE]);

  useEffect(() => {
    pageRef.current = 0;
    setHasMore(true);
    void loadProducts(true);
  }, [producerId, loadProducts]);

  const onRefresh = async () => {
    setRefreshing(true);
    setHasMore(true);
    pageRef.current = 0;
    await loadProducts(true);
    setRefreshing(false);
  };

  const onLoadMore = async () => {
    if (isLoadingMore || !hasMore) return;
    await loadProducts(false);
  };

  const handleOpenProductDetails = (product: DirectSalesProduct) => {
    setDetailProduct(product);
    setDetailModalVisible(true);
  };

  const handleAddToCartFromDetail = async (quantity: number) => {
    if (!detailProduct || !producerId) return;

    if (!session?.user.id || !session?.access_token) {
      router.push('/auth/login');
      return;
    }

    const safeQuantity = Math.max(1, Math.floor(quantity));

    await cart.addItem(session.user.id, session.access_token, {
      product_id: detailProduct.id,
      producer_id: producerId,
      producer_name: producer?.name ?? 'Producteur',
      product_name: detailProduct.name,
      price: detailProduct.price_public,
      quantity: safeQuantity,
      image: detailProduct.image,
    });
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
              producerName={producer?.name ?? 'Producteur'}
              onOpenDetails={() => handleOpenProductDetails(item)}
            />
          </View>
        )}
        contentContainerStyle={{ paddingBottom: 40 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.primary.gold} />}
        ListHeaderComponent={
          <View>
            {/* Header avec bouton retour */}
            <View style={{ paddingTop: insets.top + 16 }} className="px-4 mb-4 flex-row items-center">
              <Pressable
                onPress={() => router.back()}
                className="w-11 h-11 rounded-2xl items-center justify-center mr-3"
                style={{
                  backgroundColor: `${COLORS.background.nightSky}90`,
                  borderWidth: 1.5,
                  borderColor: `${COLORS.primary.gold}40`,
                }}
              >
                <ArrowLeft size={22} color={COLORS.primary.paleGold} />
              </Pressable>
              <View className="flex-1">
                <Text className="text-2xl font-bold" style={{ color: COLORS.text.cream }}>
                  Marche local
                </Text>
                <Text className="text-sm" style={{ color: COLORS.text.lightGray }}>
                  Boutique producteur
                </Text>
              </View>
            </View>

            {/* Hero image producteur */}
            <View className="mx-4 rounded-2xl overflow-hidden mb-4" style={{ backgroundColor: `${COLORS.text.white}08` }}>
              {producer?.image ? (
                <Image
                  source={{ uri: optimizeImageUrl(producer.image, 1200) }}
                  style={{ width: '100%', height: 190 }}
                  resizeMode="cover"
                />
              ) : (
                <View className="w-full h-[190px] items-center justify-center">
                  <Store size={52} color={COLORS.text.muted} />
                </View>
              )}
              <LinearGradient
                colors={['transparent', `${COLORS.background.nightSky}CC`, COLORS.background.nightSky]}
                style={{
                  position: 'absolute',
                  left: 0,
                  right: 0,
                  bottom: 0,
                  height: 120,
                }}
              />
            </View>

            {/* Fiche producteur */}
            <View className="px-4 mb-4">
              <View
                className="rounded-2xl p-4"
                style={{
                  backgroundColor: 'rgba(20, 29, 47, 0.78)',
                  borderWidth: 1.5,
                  borderColor: `${COLORS.primary.gold}35`,
                }}
              >
                <View className="flex-row items-center justify-center">
                  <Sparkles size={16} color={COLORS.primary.brightYellow} />
                  <Text style={{ color: COLORS.text.cream }} className="text-xl font-bold mx-2">
                    {producer?.name || 'Producteur'}
                  </Text>
                  <Sparkles size={16} color={COLORS.primary.brightYellow} />
                </View>

                <View className="flex-row items-center justify-center mt-2">
                  <MapPin size={14} color={COLORS.accent.hemp} />
                  <Text style={{ color: COLORS.accent.hemp }} className="text-sm font-semibold ml-1.5">
                    {[producer?.city, producer?.region].filter(Boolean).join(', ') || 'Localisation non renseignee'}
                  </Text>
                </View>

                {producer?.description ? (
                  <Text style={{ color: COLORS.text.lightGray }} className="text-sm text-center mt-3">
                    {producer.description}
                  </Text>
                ) : null}

                <View className="mt-3 gap-2">
                  {producer?.adresse_retrait ? (
                    <View
                      className="rounded-xl p-3"
                      style={{ backgroundColor: 'rgba(90, 158, 90, 0.14)', borderWidth: 1, borderColor: 'rgba(90, 158, 90, 0.3)' }}
                    >
                      <View className="flex-row items-center">
                        <Store size={14} color={COLORS.accent.hemp} />
                        <Text style={{ color: COLORS.accent.hemp }} className="text-xs font-bold ml-2">
                          Retrait sur place
                        </Text>
                      </View>
                      <Text style={{ color: COLORS.text.lightGray }} className="text-xs mt-1">
                        {producer.adresse_retrait}
                      </Text>
                      {producer.horaires_retrait ? (
                        <Text style={{ color: COLORS.text.muted }} className="text-xs mt-1">
                          Horaires: {producer.horaires_retrait}
                        </Text>
                      ) : null}
                    </View>
                  ) : null}

                  {producer?.shipping_enabled ? (
                    <View
                      className="rounded-xl p-3"
                      style={{ backgroundColor: 'rgba(74, 155, 155, 0.14)', borderWidth: 1, borderColor: 'rgba(74, 155, 155, 0.3)' }}
                    >
                      <View className="flex-row items-center">
                        <Truck size={14} color={COLORS.accent.teal} />
                        <Text style={{ color: COLORS.accent.teal }} className="text-xs font-bold ml-2">
                          Livraison disponible
                        </Text>
                      </View>
                      {typeof producer.shipping_fee === 'number' ? (
                        <Text style={{ color: COLORS.text.lightGray }} className="text-xs mt-1">
                          Frais de livraison: {producer.shipping_fee.toFixed(2)} EUR
                        </Text>
                      ) : null}
                      {producer.shipping_note ? (
                        <Text style={{ color: COLORS.text.muted }} className="text-xs mt-1">
                          {producer.shipping_note}
                        </Text>
                      ) : null}
                    </View>
                  ) : null}
                </View>
              </View>
            </View>

            <View className="px-4 mb-3">
              <Text className="text-sm font-bold" style={{ color: COLORS.primary.paleGold }}>
                Produits en vente directe
              </Text>
              <Text className="text-xs mt-1" style={{ color: COLORS.text.muted }}>
                {products.length} produit{products.length > 1 ? 's' : ''} disponible{products.length > 1 ? 's' : ''}
              </Text>
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

      <ShopProductDetailModal
        visible={detailModalVisible}
        onClose={() => {
          setDetailModalVisible(false);
          setDetailProduct(null);
        }}
        product={detailModalProduct}
        producer={detailModalProducer}
        onAddToCart={handleAddToCartFromDetail}
        isPro={false}
      />
    </LinearGradient>
  );
}

interface ProductCardProps {
  product: DirectSalesProduct;
  producerId: string;
  producerName: string;
  onOpenDetails: () => void;
}

function ProductCard({ product, producerId, producerName, onOpenDetails }: ProductCardProps) {
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
        producer_name: producerName,
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
                1 - {sortedTiers[0]?.minQuantity ? sortedTiers[0].minQuantity - 1 : 'âˆž'} unités
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
        <Pressable
          onPress={onOpenDetails}
          className="mb-3 flex-row items-center justify-center py-2.5 rounded-xl"
          style={{
            backgroundColor: `${COLORS.primary.gold}20`,
            borderWidth: 1,
            borderColor: `${COLORS.primary.gold}35`,
          }}
        >
          <Eye size={16} color={COLORS.primary.paleGold} />
          <Text className="ml-2 font-semibold" style={{ color: COLORS.primary.paleGold }}>
            Voir la fiche produit
          </Text>
        </Pressable>

        <View className="flex-row gap-3">
          {/* Bouton Ajouter au panier (seule action de commande depuis la fiche) */}
          <Pressable
            onPress={handleAddToCart}
            disabled={isOutOfStock}
            className="flex-1 flex-row items-center justify-center py-3 px-4 rounded-xl"
            style={{
              backgroundColor: addedToCart ? COLORS.accent.hemp : (isOutOfStock ? COLORS.text.muted : `${COLORS.accent.hemp}30`),
              opacity: isOutOfStock ? 0.5 : 1,
            }}
          >
            <ShoppingCart size={18} color={addedToCart ? COLORS.text.white : COLORS.accent.hemp} />
            <Text
              className="ml-2 font-bold"
              style={{ color: addedToCart ? COLORS.text.white : COLORS.accent.hemp }}
            >
              {addedToCart ? 'Ajoute' : 'Ajouter au panier'}
            </Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

