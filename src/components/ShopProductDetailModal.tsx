/**
 * ShopProductDetailModal - Modal de détail produit pour la boutique
 * Affiche les infos du produit avec tarifs dégressifs selon le rôle (client/pro)
 */

import React, { useState, useEffect, useMemo } from 'react';
import {
  View,
  Modal,
  Pressable,
  Image,
  ScrollView,
  Dimensions,
} from 'react-native';
import { Text } from '@/components/ui';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import {
  X,
  Minus,
  Plus,
  ShoppingCart,
  Leaf,
  Building2,
  MapPin,
  Truck,
  ChevronLeft,
  ChevronRight,
  Package,
  FlaskConical,
  Droplets,
  Scale,
  Tag,
  Video,
  Layers,
  Briefcase,
  User,
} from 'lucide-react-native';
import Animated, { FadeInDown, FadeInUp } from 'react-native-reanimated';
import { COLORS } from '@/lib/colors';
import { getSignedProductImageUrl } from '@/lib/supabase-product-images';
import {
  Producer,
  ProducerProduct,
  PRODUCT_TYPE_LABELS,
  PRODUCT_TYPE_COLORS,
  getPriceForQuantity,
  getNextPriceTier,
} from '@/lib/producers';
import { LabAnalysisViewer } from '@/components/LabAnalysisViewer';
import { WebView } from 'react-native-webview';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

const ALLOWED_VIDEO_HOSTS = new Set([
  'www.youtube.com',
  'youtube.com',
  'youtu.be',
  'player.vimeo.com',
  'vimeo.com',
]);

function isAllowedVideoUrl(urlString: string): boolean {
  try {
    const url = new URL(urlString);
    return url.protocol === 'https:' && ALLOWED_VIDEO_HOSTS.has(url.hostname);
  } catch {
    return false;
  }
}

interface ShopProductDetailModalProps {
  visible: boolean;
  onClose: () => void;
  product: ProducerProduct | null;
  producer: Producer | null;
  onAddToCart: (quantity: number) => void;
  isPro?: boolean;
}

export function ShopProductDetailModal({
  visible,
  onClose,
  product,
  producer,
  onAddToCart,
  isPro = false,
}: ShopProductDetailModalProps) {
  const insets = useSafeAreaInsets();
  const [quantity, setQuantity] = useState(1);
  const [currentImageIndex, setCurrentImageIndex] = useState(0);
  const [showVideo, setShowVideo] = useState(false);

  // Images
  const images = useMemo(() => {
    if (product?.images?.length) return product.images;
    if (product?.image) return [product.image];
    return [];
  }, [product?.images, product?.image]);
  const [resolvedImages, setResolvedImages] = useState<string[]>(images);
  const displayImages = resolvedImages.length > 0 ? resolvedImages : images;
  const hasMultipleImages = displayImages.length > 1;

  const safeVideoUrl = useMemo(() => {
    if (!product?.videoUrl) return null;
    return isAllowedVideoUrl(product.videoUrl) ? product.videoUrl : null;
  }, [product?.videoUrl]);

  useEffect(() => {
    let isMounted = true;

    const resolveImages = async () => {
      if (images.length === 0) {
        setResolvedImages([]);
        return;
      }

      const signed = await Promise.all(images.map((image) => getSignedProductImageUrl(image)));
      if (isMounted) {
        const next = signed.map((url, idx) => url || images[idx]).filter(Boolean);
        setResolvedImages(next);
      }
    };

    resolveImages();

    return () => {
      isMounted = false;
    };
  }, [images]);

  useEffect(() => {
    if (!safeVideoUrl) {
      setShowVideo(false);
    }
  }, [safeVideoUrl]);

  if (!product || !producer) return null;

  // Prix de base selon le rôle
  const basePrice = isPro && product.pricePro !== undefined ? product.pricePro : product.price;
  const originalPublicPrice = product.price;

  // Obtenir le prix selon la quantité (avec paliers)
  const currentUnitPrice = getPriceForQuantity(product, quantity, isPro);
  const nextTier = getNextPriceTier(product, quantity, isPro);

  // Paliers de prix selon le rôle - uniquement ceux correspondant au rôle de l'utilisateur
  const currentUserTiers = isPro ? product.priceProTiers : product.priceTiers;
  const hasCurrentUserTiers = currentUserTiers && currentUserTiers.length > 0;

  // Calculer la réduction par rapport au prix de base
  const hasDiscount = currentUnitPrice < basePrice && basePrice > 0;
  const discountPercent = hasDiscount
    ? Math.round(((basePrice - currentUnitPrice) / basePrice) * 100)
    : 0;

  // Promo
  const isOnPromo = !!(product.isOnPromo && product.promoPercent && product.promoPercent > 0);
  const promoPrice = isOnPromo ? currentUnitPrice * (1 - (product.promoPercent ?? 0) / 100) : currentUnitPrice;
  const finalUnitPrice = isOnPromo ? promoPrice : currentUnitPrice;

  // Stock
  const isOutOfStock = typeof product.stock === 'number' && product.stock <= 0;
  const stockAvailable = product.stock ?? Infinity;
  const maxQuantity = Math.min(stockAvailable, 100);

  // Calculs avec le prix final
  const totalPrice = finalUnitPrice * quantity;
  const tvaRate = product.tvaRate ?? 20;
  const tvaAmount = totalPrice * (tvaRate / 100);
  const totalHT = totalPrice - tvaAmount;

  // Économie réalisée grâce aux paliers
  const savingsAmount = hasCurrentUserTiers ? (basePrice - currentUnitPrice) * quantity : 0;

  // Gestion quantité
  const decreaseQuantity = () => {
    if (quantity > 1) setQuantity(quantity - 1);
  };

  const increaseQuantity = () => {
    if (quantity < maxQuantity) setQuantity(quantity + 1);
  };

  // Navigation images
  const nextImage = () => {
    setCurrentImageIndex((prev) => (prev + 1) % displayImages.length);
  };

  const prevImage = () => {
    setCurrentImageIndex((prev) => (prev - 1 + displayImages.length) % displayImages.length);
  };

  // Reset state quand on ferme
  const handleClose = () => {
    setQuantity(1);
    setCurrentImageIndex(0);
    setShowVideo(false);
    onClose();
  };

  // Ajouter au panier
  const handleAddToCart = () => {
    onAddToCart(quantity);
    handleClose();
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={handleClose}
    >
      <View className="flex-1" style={{ backgroundColor: COLORS.background.dark }}>
        {/* Header avec image */}
        <View style={{ height: 280 }}>
          {showVideo && safeVideoUrl ? (
            <WebView
              source={{ uri: safeVideoUrl }}
              style={{ flex: 1 }}
              allowsFullscreenVideo
              originWhitelist={['https://*']}
              onShouldStartLoadWithRequest={(request) => isAllowedVideoUrl(request.url)}
            />
                ) : displayImages.length > 0 ? (
            <>
                  <Image
                    source={{ uri: displayImages[currentImageIndex] }}
                style={{ width: '100%', height: '100%' }}
                resizeMode="cover"
              />
              {/* Navigation images */}
              {hasMultipleImages && (
                <>
                  <Pressable
                    onPress={prevImage}
                    className="absolute left-4 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full items-center justify-center"
                    style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}
                  >
                    <ChevronLeft size={24} color="#fff" />
                  </Pressable>
                  <Pressable
                    onPress={nextImage}
                    className="absolute right-4 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full items-center justify-center"
                    style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}
                  >
                    <ChevronRight size={24} color="#fff" />
                  </Pressable>
                  {/* Indicateurs */}
                      <View className="absolute bottom-4 left-0 right-0 flex-row justify-center">
                        {displayImages.map((_, index) => (
                      <View
                        key={index}
                        className="w-2 h-2 rounded-full mx-1"
                        style={{
                          backgroundColor: index === currentImageIndex ? '#fff' : 'rgba(255,255,255,0.4)',
                        }}
                      />
                    ))}
                  </View>
                </>
              )}
            </>
          ) : (
            <View
              className="w-full h-full items-center justify-center"
              style={{ backgroundColor: COLORS.background.charcoal }}
            >
              <Leaf size={64} color={COLORS.text.muted} />
            </View>
          )}

          {/* Overlay gradient */}
          <LinearGradient
            colors={['rgba(0,0,0,0.6)', 'transparent', 'rgba(0,0,0,0.8)']}
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
            }}
          />

          {/* Bouton fermer */}
          <Pressable
            onPress={handleClose}
            className="absolute top-4 right-4 w-10 h-10 rounded-full items-center justify-center"
            style={{
              backgroundColor: 'rgba(0,0,0,0.5)',
              marginTop: insets.top,
            }}
          >
            <X size={24} color="#fff" />
          </Pressable>

          {/* Bouton vidéo si disponible */}
          {safeVideoUrl && (
            <Pressable
              onPress={() => setShowVideo(!showVideo)}
              className="absolute top-4 left-4 px-3 py-2 rounded-full flex-row items-center"
              style={{
                backgroundColor: showVideo ? COLORS.accent.teal : 'rgba(0,0,0,0.5)',
                marginTop: insets.top,
              }}
            >
              <Video size={16} color="#fff" />
              <Text style={{ color: '#fff' }} className="font-medium text-sm ml-2">
                {showVideo ? 'Photo' : 'Vidéo'}
              </Text>
            </Pressable>
          )}

          {/* Badges */}
          <View className="absolute bottom-4 left-4 flex-row flex-wrap" style={{ maxWidth: SCREEN_WIDTH - 32 }}>
            {/* Badge type */}
            <View
              className="px-3 py-1.5 rounded-full mr-2 mb-1"
              style={{ backgroundColor: PRODUCT_TYPE_COLORS[product.type] }}
            >
              <Text style={{ color: '#fff' }} className="font-bold text-sm">
                {PRODUCT_TYPE_LABELS[product.type]}
              </Text>
            </View>
            {/* Badge rôle */}
            <View
              className="px-3 py-1.5 rounded-full mr-2 mb-1 flex-row items-center"
              style={{ backgroundColor: isPro ? COLORS.accent.teal : COLORS.primary.brightYellow }}
            >
              {isPro ? <Briefcase size={12} color="#fff" /> : <User size={12} color={COLORS.text.dark} />}
              <Text style={{ color: isPro ? '#fff' : COLORS.text.dark }} className="font-bold text-sm ml-1">
                {isPro ? 'PRO' : 'Client'}
              </Text>
            </View>
            {/* Badge promo */}
            {isOnPromo && (
              <View
                className="px-3 py-1.5 rounded-full mr-2 mb-1"
                style={{ backgroundColor: '#EF4444' }}
              >
                <Text style={{ color: '#fff' }} className="font-bold text-sm">
                  -{product.promoPercent}%
                </Text>
              </View>
            )}
            {/* Badge réduction palier */}
            {hasDiscount && !isOnPromo && (
              <View
                className="px-3 py-1.5 rounded-full mb-1"
                style={{ backgroundColor: COLORS.accent.hemp }}
              >
                <Text style={{ color: '#fff' }} className="font-bold text-sm">
                  -{discountPercent}%
                </Text>
              </View>
            )}
          </View>
        </View>

        {/* Contenu scrollable */}
        <ScrollView
          className="flex-1"
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: 220 }}
        >
          <View className="px-5 pt-5">
            {/* Nom et producteur */}
            <Animated.View entering={FadeInDown.duration(300)}>
              <Text style={{ color: COLORS.text.cream }} className="text-2xl font-bold mb-2">
                {product.name}
              </Text>
              <Pressable className="flex-row items-center mb-4">
                <Building2 size={16} color={COLORS.accent.teal} />
                <Text style={{ color: COLORS.accent.teal }} className="font-medium ml-2">
                  {producer.companyName || producer.name}
                </Text>
                <Text style={{ color: COLORS.text.muted }} className="ml-2">
                  • {producer.region}
                </Text>
              </Pressable>
            </Animated.View>

            {/* Prix */}
            <Animated.View
              entering={FadeInDown.duration(300).delay(50)}
              className="mb-6"
            >
              <View className="flex-row items-baseline flex-wrap">
                <Text style={{ color: isPro ? COLORS.accent.teal : COLORS.primary.brightYellow }} className="text-3xl font-bold">
                  {finalUnitPrice.toFixed(2)}€
                </Text>
                {(hasDiscount || isOnPromo) && (
                  <Text
                    style={{
                      color: COLORS.text.muted,
                      textDecorationLine: 'line-through',
                      marginLeft: 12,
                      fontSize: 18,
                    }}
                  >
                    {basePrice.toFixed(2)}€
                  </Text>
                )}
                {product.weight && (
                  <Text style={{ color: COLORS.text.muted }} className="ml-3">
                    / {product.weight}
                  </Text>
                )}
              </View>

              {/* Prix pro vs client */}
              {isPro && product.pricePro !== undefined && product.pricePro < originalPublicPrice && (
                <View className="flex-row items-center mt-2">
                  <Briefcase size={14} color={COLORS.accent.teal} />
                  <Text style={{ color: COLORS.accent.teal }} className="text-sm ml-2">
                    Prix pro : économie de {(originalPublicPrice - product.pricePro).toFixed(2)}€ vs prix public
                  </Text>
                </View>
              )}

              {/* Indicateur du prochain palier */}
              {nextTier && (
                <View
                  className="mt-3 px-3 py-2 rounded-lg flex-row items-center"
                  style={{ backgroundColor: `${COLORS.primary.brightYellow}15` }}
                >
                  <Layers size={14} color={COLORS.primary.brightYellow} />
                  <Text style={{ color: COLORS.primary.brightYellow }} className="text-xs ml-2">
                    À partir de {nextTier.minQuantity} unités : {nextTier.price.toFixed(2)}€/unité
                  </Text>
                </View>
              )}
            </Animated.View>

            {/* Grilles de tarifs dégressifs - afficher uniquement selon le rôle */}
            {hasCurrentUserTiers && currentUserTiers && (
              <Animated.View
                entering={FadeInDown.duration(300).delay(75)}
                className="mb-6"
              >
                <View className="flex-row items-center mb-3">
                  <Layers size={18} color={COLORS.primary.paleGold} />
                  <Text style={{ color: COLORS.primary.paleGold }} className="font-bold ml-2">
                    Tarifs dégressifs
                  </Text>
                </View>

                {/* Grille selon le rôle - Clients voient tarifs clients, Pros voient tarifs pros */}
                <View
                  className="p-3 rounded-xl"
                  style={{
                    backgroundColor: isPro ? `${COLORS.accent.teal}10` : `${COLORS.primary.brightYellow}10`,
                    borderWidth: 1,
                    borderColor: isPro ? COLORS.accent.teal : COLORS.primary.brightYellow,
                  }}
                >
                  <View className="flex-row items-center mb-2">
                    {isPro ? (
                      <Briefcase size={14} color={COLORS.accent.teal} />
                    ) : (
                      <User size={14} color={COLORS.primary.brightYellow} />
                    )}
                    <Text style={{ color: isPro ? COLORS.accent.teal : COLORS.primary.brightYellow }} className="text-sm font-bold ml-2">
                      {isPro ? 'Tarifs Professionnels' : 'Tarifs Clients'}
                    </Text>
                    <View className="ml-2 px-2 py-0.5 rounded-full" style={{ backgroundColor: isPro ? COLORS.accent.teal : COLORS.primary.brightYellow }}>
                      <Text style={{ color: isPro ? '#fff' : COLORS.text.dark }} className="text-xs font-bold">Votre tarif</Text>
                    </View>
                  </View>
                  <View className="flex-row items-center justify-between py-1 mb-1" style={{ borderBottomWidth: 1, borderBottomColor: isPro ? `${COLORS.accent.teal}20` : `${COLORS.primary.brightYellow}20` }}>
                    <Text style={{ color: COLORS.text.muted }} className="text-xs font-medium">Quantité</Text>
                    <Text style={{ color: COLORS.text.muted }} className="text-xs font-medium">Prix unitaire</Text>
                  </View>
                  <View className="flex-row items-center justify-between py-1">
                    <Text style={{ color: COLORS.text.lightGray }} className="text-xs">
                      {isPro ? 'Prix pro de base' : 'Prix de base'}
                    </Text>
                    <Text style={{ color: isPro ? COLORS.accent.teal : COLORS.primary.brightYellow }} className="text-xs font-bold">
                      {basePrice.toFixed(2)}€
                    </Text>
                  </View>
                  {[...currentUserTiers]
                    .sort((a, b) => a.minQuantity - b.minQuantity)
                    .map((tier, idx) => {
                      const isCurrentTier = currentUnitPrice === tier.price;
                      const accentColor = isPro ? COLORS.accent.teal : COLORS.primary.brightYellow;
                      return (
                        <View
                          key={idx}
                          className="flex-row items-center justify-between py-1"
                          style={{
                            backgroundColor: isCurrentTier ? `${accentColor}20` : 'transparent',
                            marginHorizontal: -8,
                            paddingHorizontal: 8,
                            borderRadius: 4,
                          }}
                        >
                          <Text style={{ color: isCurrentTier ? accentColor : COLORS.text.lightGray }} className="text-xs">
                            Dès {tier.minQuantity} unités
                          </Text>
                          <Text style={{ color: accentColor }} className="text-xs font-bold">
                            {tier.price.toFixed(2)}€
                          </Text>
                        </View>
                      );
                    })}
                </View>
              </Animated.View>
            )}

            {/* Caractéristiques */}
            <Animated.View
              entering={FadeInDown.duration(300).delay(100)}
              className="flex-row flex-wrap mb-6"
            >
              {/* CBD */}
              <View
                className="flex-row items-center px-3 py-2 rounded-xl mr-2 mb-2"
                style={{ backgroundColor: `${COLORS.accent.hemp}20` }}
              >
                <FlaskConical size={16} color={COLORS.accent.hemp} />
                <Text style={{ color: COLORS.accent.hemp }} className="font-semibold ml-2">
                  CBD {product.cbdPercent}%
                </Text>
              </View>
              {/* THC */}
              <View
                className="flex-row items-center px-3 py-2 rounded-xl mr-2 mb-2"
                style={{ backgroundColor: `${COLORS.text.muted}20` }}
              >
                <Droplets size={16} color={COLORS.text.muted} />
                <Text style={{ color: COLORS.text.muted }} className="font-semibold ml-2">
                  THC {product.thcPercent}%
                </Text>
              </View>
              {/* Poids */}
              {product.weight && (
                <View
                  className="flex-row items-center px-3 py-2 rounded-xl mr-2 mb-2"
                  style={{ backgroundColor: `${COLORS.primary.gold}20` }}
                >
                  <Scale size={16} color={COLORS.primary.gold} />
                  <Text style={{ color: COLORS.primary.gold }} className="font-semibold ml-2">
                    {product.weight}
                  </Text>
                </View>
              )}
              {/* TVA */}
              <View
                className="flex-row items-center px-3 py-2 rounded-xl mr-2 mb-2"
                style={{ backgroundColor: `${COLORS.accent.sky}20` }}
              >
                <Tag size={16} color={COLORS.accent.sky} />
                <Text style={{ color: COLORS.accent.sky }} className="font-semibold ml-2">
                  TVA {tvaRate}%
                </Text>
              </View>
              {/* Stock */}
              {typeof product.stock === 'number' && (
                <View
                  className="flex-row items-center px-3 py-2 rounded-xl mr-2 mb-2"
                  style={{
                    backgroundColor: isOutOfStock ? `${COLORS.accent.red}20` : `${COLORS.accent.teal}20`,
                  }}
                >
                  <Package size={16} color={isOutOfStock ? COLORS.accent.red : COLORS.accent.teal} />
                  <Text
                    style={{ color: isOutOfStock ? COLORS.accent.red : COLORS.accent.teal }}
                    className="font-semibold ml-2"
                  >
                    {isOutOfStock ? 'Rupture' : `${product.stock} en stock`}
                  </Text>
                </View>
              )}
            </Animated.View>

            {/* Description */}
            {product.description && (
              <Animated.View entering={FadeInDown.duration(300).delay(150)} className="mb-6">
                <Text style={{ color: COLORS.text.lightGray }} className="font-semibold mb-2">
                  Description
                </Text>
                <Text style={{ color: COLORS.text.muted }} className="leading-6">
                  {product.description}
                </Text>
              </Animated.View>
            )}

            {/* Analyse de laboratoire */}
            {product.labAnalysisUrl && (
              <Animated.View entering={FadeInDown.duration(300).delay(200)} className="mb-6">
                <Text style={{ color: COLORS.text.lightGray }} className="font-semibold mb-3">
                  Analyse de laboratoire
                </Text>
                <LabAnalysisViewer url={product.labAnalysisUrl} />
              </Animated.View>
            )}

            {/* Livraison */}
            {(product.delivery_type || product.disponible_vente_directe) && (
              <Animated.View
                entering={FadeInDown.duration(300).delay(250)}
                className="rounded-2xl p-4 mb-6"
                style={{
                  backgroundColor: `${COLORS.accent.sky}10`,
                  borderWidth: 1,
                  borderColor: `${COLORS.accent.sky}30`,
                }}
              >
                <View className="flex-row items-center mb-3">
                  <Truck size={18} color={COLORS.accent.sky} />
                  <Text style={{ color: COLORS.text.cream }} className="font-semibold ml-2">
                    Options de livraison
                  </Text>
                </View>
                {product.delivery_type === 'flat' && product.delivery_flat_price !== undefined && (
                  <Text style={{ color: COLORS.text.muted }} className="mb-2">
                    • Livraison à {product.delivery_flat_price.toFixed(2)}€
                  </Text>
                )}
                {product.delivery_type === 'min_order' && product.delivery_min_order_amount !== undefined && (
                  <Text style={{ color: COLORS.text.muted }} className="mb-2">
                    • Livraison gratuite dès {product.delivery_min_order_amount.toFixed(2)}€ d'achat
                  </Text>
                )}
                {product.disponible_vente_directe && (
                  <>
                    <View className="flex-row items-center mt-2">
                      <MapPin size={14} color={COLORS.accent.hemp} />
                      <Text style={{ color: COLORS.accent.hemp }} className="font-medium ml-2">
                        Retrait à la ferme disponible
                      </Text>
                    </View>
                    {product.ville_retrait && (
                      <Text style={{ color: COLORS.text.muted }} className="ml-6 text-sm">
                        {product.ville_retrait}
                      </Text>
                    )}
                  </>
                )}
              </Animated.View>
            )}

            {/* Info producteur */}
            <Animated.View
              entering={FadeInDown.duration(300).delay(300)}
              className="rounded-2xl p-4"
              style={{
                backgroundColor: COLORS.background.charcoal,
                borderWidth: 1,
                borderColor: `${COLORS.text.muted}20`,
              }}
            >
              <Text style={{ color: COLORS.text.cream }} className="font-semibold mb-3">
                À propos du producteur
              </Text>
              <View className="flex-row items-center mb-2">
                <Building2 size={16} color={COLORS.text.muted} />
                <Text style={{ color: COLORS.text.lightGray }} className="ml-2">
                  {producer.companyName || producer.name}
                </Text>
              </View>
              <View className="flex-row items-center mb-2">
                <MapPin size={16} color={COLORS.text.muted} />
                <Text style={{ color: COLORS.text.muted }} className="ml-2">
                  {producer.city}, {producer.department}
                </Text>
              </View>
              {producer.description && (
                <Text style={{ color: COLORS.text.muted }} className="text-sm mt-2">
                  {producer.description.substring(0, 150)}
                  {producer.description.length > 150 ? '...' : ''}
                </Text>
              )}
            </Animated.View>
          </View>
        </ScrollView>

        {/* Footer avec quantité et bouton acheter */}
        <Animated.View
          entering={FadeInUp.duration(300)}
          className="absolute bottom-0 left-0 right-0"
          style={{
            backgroundColor: COLORS.background.charcoal,
            borderTopWidth: 1,
            borderTopColor: `${COLORS.text.muted}20`,
            paddingBottom: insets.bottom + 10,
            paddingTop: 16,
            paddingHorizontal: 20,
          }}
        >
          {/* Indicateur d'économie si paliers actifs */}
          {savingsAmount > 0 && (
            <View
              className="flex-row items-center justify-center mb-3 py-2 rounded-lg"
              style={{ backgroundColor: `${COLORS.accent.hemp}15` }}
            >
              <Layers size={14} color={COLORS.accent.hemp} />
              <Text style={{ color: COLORS.accent.hemp }} className="text-sm font-medium ml-2">
                Économie : {savingsAmount.toFixed(2)}€ grâce au tarif dégressif
              </Text>
            </View>
          )}

          {/* Indicateur du prochain palier dans le footer */}
          {nextTier && (
            <View
              className="flex-row items-center justify-center mb-3 py-2 rounded-lg"
              style={{ backgroundColor: `${COLORS.primary.brightYellow}15` }}
            >
              <Text style={{ color: COLORS.primary.brightYellow }} className="text-xs">
                +{nextTier.minQuantity - quantity} unité{nextTier.minQuantity - quantity > 1 ? 's' : ''} pour {nextTier.price.toFixed(2)}€/unité
              </Text>
            </View>
          )}

          {/* Récapitulatif prix */}
          <View className="flex-row justify-between mb-3">
            <View>
              <Text style={{ color: COLORS.text.muted }} className="text-sm">
                {quantity}x {finalUnitPrice.toFixed(2)}€ = Total HT: {totalHT.toFixed(2)}€
              </Text>
              <Text style={{ color: COLORS.text.muted }} className="text-sm">
                TVA ({tvaRate}%): {tvaAmount.toFixed(2)}€
              </Text>
            </View>
            <View className="items-end">
              <Text style={{ color: COLORS.text.muted }} className="text-sm">
                Total TTC
              </Text>
              <Text style={{ color: isPro ? COLORS.accent.teal : COLORS.primary.brightYellow }} className="text-2xl font-bold">
                {totalPrice.toFixed(2)}€
              </Text>
            </View>
          </View>

          {/* Sélecteur de quantité et bouton */}
          <View className="flex-row items-center">
            {/* Quantité */}
            <View
              className="flex-row items-center rounded-xl px-2"
              style={{ backgroundColor: `${COLORS.text.muted}20` }}
            >
              <Pressable
                onPress={decreaseQuantity}
                disabled={quantity <= 1}
                className="p-3"
                style={{ opacity: quantity <= 1 ? 0.3 : 1 }}
              >
                <Minus size={20} color={COLORS.text.cream} />
              </Pressable>
              <Text
                style={{ color: COLORS.text.cream, minWidth: 40, textAlign: 'center' }}
                className="text-xl font-bold"
              >
                {quantity}
              </Text>
              <Pressable
                onPress={increaseQuantity}
                disabled={quantity >= maxQuantity}
                className="p-3"
                style={{ opacity: quantity >= maxQuantity ? 0.3 : 1 }}
              >
                <Plus size={20} color={COLORS.text.cream} />
              </Pressable>
            </View>

            {/* Bouton ajouter */}
            <Pressable
              onPress={handleAddToCart}
              disabled={isOutOfStock}
              className="flex-1 flex-row items-center justify-center py-4 rounded-xl ml-4"
              style={{
                backgroundColor: isOutOfStock ? COLORS.text.muted : (isPro ? COLORS.accent.teal : COLORS.accent.forest),
              }}
            >
              <ShoppingCart size={20} color="#fff" />
              <Text style={{ color: '#fff' }} className="font-bold text-lg ml-3">
                {isOutOfStock ? 'Rupture de stock' : 'Ajouter au panier'}
              </Text>
            </Pressable>
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}
