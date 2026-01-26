/**
 * ProProductDetailModal - Modal de détail produit pour l'espace pro
 * Affiche toutes les infos du produit avec sélection de quantité
 */

import React, { useState } from 'react';
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
  FileText,
  ChevronLeft,
  ChevronRight,
  Check,
  Package,
  FlaskConical,
  Droplets,
  Scale,
  Tag,
  Video,
  Layers,
} from 'lucide-react-native';
import Animated, { FadeIn, FadeInDown, FadeInUp } from 'react-native-reanimated';
import { COLORS } from '@/lib/colors';
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

interface ProProductDetailModalProps {
  visible: boolean;
  onClose: () => void;
  product: ProducerProduct | null;
  producer: Producer | null;
  onAddToCart: (quantity: number) => void;
}

export function ProProductDetailModal({
  visible,
  onClose,
  product,
  producer,
  onAddToCart,
}: ProProductDetailModalProps) {
  const insets = useSafeAreaInsets();
  const [quantity, setQuantity] = useState(1);
  const [currentImageIndex, setCurrentImageIndex] = useState(0);
  const [showVideo, setShowVideo] = useState(false);

  if (!product || !producer) return null;

  // Prix pro avec paliers - utilise uniquement les paliers pro
  const baseProPrice = (product as any).pricePro ?? product.price ?? 0;
  const originalPrice = product.price ?? 0;

  // Obtenir le prix selon la quantité (avec paliers pro)
  const currentUnitPrice = getPriceForQuantity(product, quantity, true);
  const nextTier = getNextPriceTier(product, quantity, true);

  // Uniquement les paliers pro pour l'espace pro
  const proTiers = product.priceProTiers;
  const hasProTiers = (proTiers?.length ?? 0) > 0;

  // Calculer la réduction par rapport au prix de base
  const hasDiscount = currentUnitPrice < baseProPrice && baseProPrice > 0;
  const discountPercent = hasDiscount
    ? Math.round(((baseProPrice - currentUnitPrice) / baseProPrice) * 100)
    : 0;

  // Stock
  const isOutOfStock = typeof product.stock === 'number' && product.stock <= 0;
  const stockAvailable = product.stock ?? Infinity;
  const maxQuantity = Math.min(stockAvailable, 100);

  // Images
  const images = product.images?.length ? product.images : product.image ? [product.image] : [];
  const hasMultipleImages = images.length > 1;

  // Calculs avec le prix par palier
  const totalPrice = currentUnitPrice * quantity;
  const tvaRate = product.tvaRate ?? 20;
  const tvaAmount = totalPrice * (tvaRate / 100);
  const totalHT = totalPrice - tvaAmount;

  // Économie réalisée grâce aux paliers
  const savingsAmount = hasProTiers ? (baseProPrice - currentUnitPrice) * quantity : 0;

  // Gestion quantité
  const decreaseQuantity = () => {
    if (quantity > 1) setQuantity(quantity - 1);
  };

  const increaseQuantity = () => {
    if (quantity < maxQuantity) setQuantity(quantity + 1);
  };

  // Navigation images
  const nextImage = () => {
    setCurrentImageIndex((prev) => (prev + 1) % images.length);
  };

  const prevImage = () => {
    setCurrentImageIndex((prev) => (prev - 1 + images.length) % images.length);
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
        <View style={{ height: 300 }}>
          {showVideo && product.videoUrl ? (
            <WebView
              source={{ uri: product.videoUrl }}
              style={{ flex: 1 }}
              allowsFullscreenVideo
            />
          ) : images.length > 0 ? (
            <>
              <Image
                source={{ uri: images[currentImageIndex] }}
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
                    {images.map((_, index) => (
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
          {product.videoUrl && (
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
          <View className="absolute bottom-4 left-4 flex-row">
            {/* Badge type */}
            <View
              className="px-3 py-1.5 rounded-full mr-2"
              style={{ backgroundColor: PRODUCT_TYPE_COLORS[product.type] }}
            >
              <Text style={{ color: '#fff' }} className="font-bold text-sm">
                {PRODUCT_TYPE_LABELS[product.type]}
              </Text>
            </View>
            {/* Badge PRO */}
            <View
              className="px-3 py-1.5 rounded-full"
              style={{ backgroundColor: COLORS.accent.teal }}
            >
              <Text style={{ color: '#fff' }} className="font-bold text-sm">
                PRO
              </Text>
            </View>
            {/* Badge réduction */}
            {hasDiscount && (
              <View
                className="px-3 py-1.5 rounded-full ml-2"
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
          contentContainerStyle={{ paddingBottom: 200 }}
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
              <View className="flex-row items-baseline">
                <Text style={{ color: COLORS.accent.teal }} className="text-3xl font-bold">
                  {currentUnitPrice.toFixed(2)}€
                </Text>
                {hasDiscount && (
                  <Text
                    style={{
                      color: COLORS.text.muted,
                      textDecorationLine: 'line-through',
                      marginLeft: 12,
                      fontSize: 18,
                    }}
                  >
                    {baseProPrice.toFixed(2)}€
                  </Text>
                )}
                {product.weight && (
                  <Text style={{ color: COLORS.text.muted }} className="ml-3">
                    / {product.weight}
                  </Text>
                )}
                {hasDiscount && (
                  <View
                    className="ml-3 px-2 py-1 rounded-full"
                    style={{ backgroundColor: `${COLORS.accent.hemp}30` }}
                  >
                    <Text style={{ color: COLORS.accent.hemp }} className="text-xs font-bold">
                      -{discountPercent}%
                    </Text>
                  </View>
                )}
              </View>

              {/* Indicateur du prochain palier */}
              {nextTier && (
                <View
                  className="mt-2 px-3 py-2 rounded-lg flex-row items-center"
                  style={{ backgroundColor: `${COLORS.primary.brightYellow}15` }}
                >
                  <Layers size={14} color={COLORS.primary.brightYellow} />
                  <Text style={{ color: COLORS.primary.brightYellow }} className="text-xs ml-2">
                    À partir de {nextTier.minQuantity} unités : {nextTier.price.toFixed(2)}€/unité
                  </Text>
                </View>
              )}

              {/* Paliers de prix pro uniquement */}
              {hasProTiers && proTiers && proTiers.length > 0 && (
                <View
                  className="mt-3 p-3 rounded-xl"
                  style={{ backgroundColor: `${COLORS.accent.teal}10`, borderWidth: 1, borderColor: `${COLORS.accent.teal}30` }}
                >
                  <Text style={{ color: COLORS.accent.teal }} className="text-xs font-bold mb-2">
                    Tarifs dégressifs PRO
                  </Text>
                  {proTiers
                    .sort((a, b) => a.minQuantity - b.minQuantity)
                    .map((tier, idx) => {
                      const isCurrentTier = currentUnitPrice === tier.price;
                      return (
                        <View
                          key={idx}
                          className="flex-row items-center justify-between py-1"
                          style={{
                            backgroundColor: isCurrentTier ? `${COLORS.accent.teal}20` : 'transparent',
                            marginHorizontal: -8,
                            paddingHorizontal: 8,
                            borderRadius: 6,
                          }}
                        >
                          <Text style={{ color: isCurrentTier ? COLORS.accent.teal : COLORS.text.muted }} className="text-xs">
                            À partir de {tier.minQuantity} unités
                          </Text>
                          <Text style={{ color: isCurrentTier ? COLORS.accent.teal : COLORS.text.lightGray }} className="text-xs font-medium">
                            {tier.price.toFixed(2)}€/unité
                          </Text>
                        </View>
                      );
                    })}
                </View>
              )}
            </Animated.View>

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
                    {product.adresse_retrait && (
                      <Text style={{ color: COLORS.text.muted }} className="ml-6 text-sm">
                        {product.adresse_retrait}
                      </Text>
                    )}
                    {product.horaires_retrait && (
                      <Text style={{ color: COLORS.text.muted }} className="ml-6 text-sm">
                        Horaires: {product.horaires_retrait}
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
                {quantity}x {currentUnitPrice.toFixed(2)}€ = Total HT: {totalHT.toFixed(2)}€
              </Text>
              <Text style={{ color: COLORS.text.muted }} className="text-sm">
                TVA ({tvaRate}%): {tvaAmount.toFixed(2)}€
              </Text>
            </View>
            <View className="items-end">
              <Text style={{ color: COLORS.text.muted }} className="text-sm">
                Total TTC
              </Text>
              <Text style={{ color: COLORS.accent.teal }} className="text-2xl font-bold">
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
                backgroundColor: isOutOfStock ? COLORS.text.muted : COLORS.accent.teal,
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
