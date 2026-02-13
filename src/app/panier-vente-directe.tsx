import React, { useState, useEffect, useMemo } from 'react';
import {
  View,
  ScrollView,
  Pressable,
  Image,
  TextInput,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { Text } from '@/components/ui';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { ArrowLeft, Trash2, Minus, Plus, ShoppingCart, AlertCircle, CheckCircle } from 'lucide-react-native';
import { router } from 'expo-router';
import { COLORS } from '@/lib/colors';
import { useDirectSalesCart, type DirectSalesCartItem } from '@/lib/direct-sales-cart';
import { useAuth } from '@/lib/useAuth';
import { SUPABASE_ANON_KEY, SUPABASE_URL, getValidSession } from '@/lib/supabase-auth';

export default function PanierVenteDirecte() {
  const insets = useSafeAreaInsets();
  const { session } = useAuth();
  const items = useDirectSalesCart((s) => s.items);
  const loadCart = useDirectSalesCart((s) => s.loadCart);
  const createOrders = useDirectSalesCart((s) => s.createOrders);
  const updateQuantity = useDirectSalesCart((s) => s.updateQuantity);
  const removeItem = useDirectSalesCart((s) => s.removeItem);
  const getProducerIds = useDirectSalesCart((s) => s.getProducerIds);
  const getItemsByProducer = useDirectSalesCart((s) => s.getItemsByProducer);
  const getTotalByProducer = useDirectSalesCart((s) => s.getTotalByProducer);
  const getGrandTotal = useDirectSalesCart((s) => s.getGrandTotal);
  const isMinimumMetByProducer = useDirectSalesCart((s) => s.isMinimumMet);
  const getProducersWithInsufficientAmount = useDirectSalesCart((s) => s.getProducersWithInsufficientAmount);
  const [loading, setLoading] = useState(true);
  const [validating, setValidating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [producerDeliveryOptions, setProducerDeliveryOptions] = useState<Record<string, 'pickup' | 'shipping'>>({});
  const [producerAddressSource, setProducerAddressSource] = useState<Record<string, 'profile' | 'custom'>>({});
  const [producerCustomAddress, setProducerCustomAddress] = useState<Record<string, string>>({});
  const [producerCustomPostalCode, setProducerCustomPostalCode] = useState<Record<string, string>>({});
  const [producerCustomCity, setProducerCustomCity] = useState<Record<string, string>>({});
  const [producerDeliveryInstructions, setProducerDeliveryInstructions] = useState<Record<string, string>>({});
  const [profileAddress, setProfileAddress] = useState<{ address: string; postalCode: string; city: string } | null>(null);

  useEffect(() => {
    const loadCartWithValidSession = async () => {
      const validSession = await getValidSession();
      if (validSession?.user?.id && validSession?.access_token) {
        await loadCart(validSession.user.id, validSession.access_token);
      }
      setLoading(false);
    };
    loadCartWithValidSession();
  }, [session?.user.id, loadCart]);

  useEffect(() => {
    const loadProfileAddress = async () => {
      if (!session?.user.id || !session?.access_token) {
        setProfileAddress(null);
        return;
      }

      try {
        const validSession = await getValidSession();
        if (!validSession?.user?.id || !validSession?.access_token) {
          setProfileAddress(null);
          return;
        }

        const response = await fetch(
          `${SUPABASE_URL}/rest/v1/profiles?id=eq.${validSession.user.id}&select=address,postal_code,city&limit=1`,
          {
            method: 'GET',
            headers: {
              'Content-Type': 'application/json',
              apikey: SUPABASE_ANON_KEY,
              Authorization: `Bearer ${validSession.access_token}`,
            },
          }
        );

        if (!response.ok) {
          setProfileAddress(null);
          return;
        }

        const data = await response.json() as { address?: string | null; postal_code?: string | null; city?: string | null }[];
        const row = data?.[0];
        const address = row?.address?.trim() ?? '';
        const postalCode = row?.postal_code?.trim() ?? '';
        const city = row?.city?.trim() ?? '';

        if (address && postalCode && city) {
          setProfileAddress({ address, postalCode, city });
        } else {
          setProfileAddress(null);
        }
      } catch {
        setProfileAddress(null);
      }
    };

    loadProfileAddress();
  }, [session?.user.id, session?.access_token]);

  const handleValidateOrder = async () => {
    const validSession = await getValidSession();
    if (!validSession?.user?.id || !validSession?.access_token) {
      setError('Veuillez vous connecter pour valider votre commande');
      return;
    }

    const producerOptions = producerIds.map((producerId) => {
      const deliveryMethod = producerDeliveryOptions[producerId] ?? 'pickup';
      const source = producerAddressSource[producerId] ?? (hasProfileAddress ? 'profile' : 'custom');
      const customAddress = (producerCustomAddress[producerId] ?? '').trim();
      const customPostalCode = (producerCustomPostalCode[producerId] ?? '').trim();
      const customCity = (producerCustomCity[producerId] ?? '').trim();
      const resolvedAddress = source === 'profile'
        ? `${profileAddress?.address ?? ''}, ${profileAddress?.postalCode ?? ''} ${profileAddress?.city ?? ''}`.trim()
        : `${customAddress}, ${customPostalCode} ${customCity}`.trim();
      return {
        producerId,
        deliveryMethod,
        deliveryAddress: deliveryMethod === 'shipping' ? resolvedAddress : undefined,
        deliveryInstructions: deliveryMethod === 'shipping'
          ? (producerDeliveryInstructions[producerId] ?? '').trim()
          : undefined,
        paymentMethod: deliveryMethod === 'shipping' ? 'payment_link' as const : 'on_site' as const,
      };
    });

    for (const option of producerOptions) {
      if (option.deliveryMethod !== 'shipping') continue;
      const source = producerAddressSource[option.producerId] ?? (hasProfileAddress ? 'profile' : 'custom');
      if (source === 'profile' && !hasProfileAddress) {
        const itemsByProducer = getItemsByProducer(option.producerId);
        setError(`Adresse profil incomplète pour ${itemsByProducer[0]?.producer_name || 'ce producteur'}`);
        return;
      }
      if (source === 'custom') {
        const address = (producerCustomAddress[option.producerId] ?? '').trim();
        const postalCode = (producerCustomPostalCode[option.producerId] ?? '').trim();
        const city = (producerCustomCity[option.producerId] ?? '').trim();
        if (!address || !postalCode || !city) {
          const itemsByProducer = getItemsByProducer(option.producerId);
          setError(`Adresse, code postal et ville requis pour ${itemsByProducer[0]?.producer_name || 'ce producteur'}`);
          return;
        }
      }
      if (!option.deliveryAddress) {
        const itemsByProducer = getItemsByProducer(option.producerId);
        setError(`Adresse de livraison requise pour ${itemsByProducer[0]?.producer_name || 'ce producteur'}`);
        return;
      }
    }

    setValidating(true);
    setError(null);

    try {
      const result = await createOrders(validSession.user.id, validSession.access_token, {
        producerOptions,
      });

      if (result.success && result.orderIds && result.orderIds.length > 0) {
        // Navigate to confirmation screen with order IDs
        router.push({
          pathname: '/commande-confirmation',
          params: {
            orderIds: result.orderIds.join(','),
          },
        });
      } else {
        const errorMessage = result.error || 'Une erreur est survenue lors de la création de la commande';
        setError(errorMessage);
        Alert.alert(
          'Erreur de commande',
          errorMessage,
          [{ text: 'OK', style: 'default' }]
        );
      }
    } catch (error) {
      console.error('Error validating order:', error);
      const errorMessage = 'Impossible de valider la commande. Vérifiez votre connexion internet.';
      setError(errorMessage);
      Alert.alert(
        'Erreur',
        errorMessage,
        [{ text: 'OK', style: 'default' }]
      );
    } finally {
      setValidating(false);
    }
  };

  const handleContinueShopping = () => {
    router.push('/(tabs)/marche-local');
  };

  const producerIds = getProducerIds();
  const grandTotal = getGrandTotal();
  const isMinimumMet = isMinimumMetByProducer();
  const insufficientProducers = getProducersWithInsufficientAmount();
  const shippingByProducer = useMemo(() => {
    const map: Record<string, { enabled: boolean; fee: number; note: string | null }> = {};
    producerIds.forEach((producerId) => {
      const firstItem = getItemsByProducer(producerId)[0];
      map[producerId] = {
        enabled: !!firstItem?.producer_shipping_enabled,
        fee: firstItem?.producer_shipping_fee ?? 0,
        note: firstItem?.producer_shipping_note ?? null,
      };
    });
    return map;
  }, [producerIds, getItemsByProducer]);
  const hasProfileAddress = !!profileAddress?.address && !!profileAddress?.postalCode && !!profileAddress?.city;
  const hasItems = items.length > 0;

  useEffect(() => {
    if (producerIds.length === 0) return;
    setProducerDeliveryOptions((prev) => {
      const next: Record<string, 'pickup' | 'shipping'> = {};
      producerIds.forEach((producerId) => {
        const canShip = shippingByProducer[producerId]?.enabled;
        const current = prev[producerId];
        next[producerId] = current
          ? (current === 'shipping' && !canShip ? 'pickup' : current)
          : 'pickup';
      });
      const sameSize = Object.keys(prev).length === Object.keys(next).length;
      const sameValues = sameSize && Object.keys(next).every((key) => prev[key] === next[key]);
      return sameValues ? prev : next;
    });
  }, [producerIds, shippingByProducer]);

  useEffect(() => {
    if (producerIds.length === 0) return;
    setProducerAddressSource((prev) => {
      const next: Record<string, 'profile' | 'custom'> = {};
      producerIds.forEach((producerId) => {
        const current = prev[producerId];
        if (current === 'profile' && !hasProfileAddress) {
          next[producerId] = 'custom';
          return;
        }
        if (current) {
          next[producerId] = current;
          return;
        }
        next[producerId] = hasProfileAddress ? 'profile' : 'custom';
      });
      const sameSize = Object.keys(prev).length === Object.keys(next).length;
      const sameValues = sameSize && Object.keys(next).every((key) => prev[key] === next[key]);
      return sameValues ? prev : next;
    });
  }, [producerIds, hasProfileAddress]);

  if (!session?.user.id) {
    return (
      <LinearGradient
        colors={[COLORS.background.nightSky, COLORS.background.mediumBlue]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        className="flex-1 items-center justify-center"
      >
        <Text style={{ color: COLORS.text.cream }} className="text-center">
          Veuillez vous connecter pour voir votre panier
        </Text>
      </LinearGradient>
    );
  }

  if (loading) {
    return (
      <LinearGradient
        colors={[COLORS.background.nightSky, COLORS.background.mediumBlue]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        className="flex-1 items-center justify-center"
      >
        <ActivityIndicator size="large" color={COLORS.primary.gold} />
      </LinearGradient>
    );
  }

  return (
    <LinearGradient
      colors={[COLORS.background.nightSky, COLORS.background.mediumBlue]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      className="flex-1"
    >
      <ScrollView className="flex-1" contentContainerStyle={{ paddingBottom: 40 }}>
        {/* Header */}
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
              Mon panier
            </Text>
            <Text className="text-sm" style={{ color: COLORS.text.lightGray }}>
              Vente directe à la ferme
            </Text>
          </View>
        </View>

        {/* Message d'erreur */}
        {error && (
          <View 
            className="mx-4 mb-4 p-4 rounded-xl flex-row items-center"
            style={{ backgroundColor: `${COLORS.accent.red}20`, borderWidth: 1, borderColor: COLORS.accent.red }}
          >
            <AlertCircle size={20} color={COLORS.accent.red} />
            <Text className="ml-3 flex-1" style={{ color: COLORS.accent.red }}>
              {error}
            </Text>
            <Pressable onPress={() => setError(null)}>
              <Text style={{ color: COLORS.accent.red, fontWeight: 'bold' }}>✕</Text>
            </Pressable>
          </View>
        )}

        {/* Panier vide */}
        {!hasItems ? (
          <View className="flex-1 items-center justify-center px-4 py-12">
            <ShoppingCart size={48} color={COLORS.text.muted} strokeWidth={1.5} />
            <Text className="text-center mt-4" style={{ color: COLORS.text.lightGray }}>
              Votre panier est vide
            </Text>
            <Text className="text-center text-sm mt-2" style={{ color: COLORS.text.muted }}>
              Commencez vos achats depuis le Marché local
            </Text>
            <Pressable
              onPress={handleContinueShopping}
              className="mt-6 px-6 py-3 rounded-xl flex-row items-center"
              style={{
                backgroundColor: `${COLORS.accent.forest}30`,
                borderWidth: 1,
                borderColor: COLORS.accent.forest,
              }}
            >
              <Text className="font-semibold" style={{ color: COLORS.accent.hemp }}>
                Voir les producteurs
              </Text>
            </Pressable>
          </View>
        ) : (
          <View className="px-4">
            {/* Alerte minimum insuffisant */}
            {insufficientProducers.length > 0 && (
              <View
                className="p-4 rounded-xl mb-4 flex-row"
                style={{ backgroundColor: `${COLORS.accent.red}20`, borderLeftWidth: 4, borderLeftColor: COLORS.accent.red }}
              >
                <AlertCircle size={20} color={COLORS.accent.red} className="mt-0.5 mr-3" />
                <View className="flex-1">
                  <Text className="font-bold" style={{ color: COLORS.accent.red }}>
                    Minimum 20€ non atteint
                  </Text>
                  {insufficientProducers.map((producer) => {
                    const needed = 20 - producer.amount;
                    return (
                      <Text key={producer.producerId} className="text-sm mt-1" style={{ color: COLORS.accent.red }}>
                        {producer.producerName}: Ajoutez {needed.toFixed(2)}€
                      </Text>
                    );
                  })}
                </View>
              </View>
            )}

            {/* Producteurs et articles */}
            {producerIds.map((producerId) => {
              const producerItems = getItemsByProducer(producerId);
              const producerTotal = getTotalByProducer(producerId);
              const producerName = producerItems[0]?.producer_name || 'Unknown';
              const isMinimumMetForProducer = producerTotal >= 20;
              const canShip = shippingByProducer[producerId]?.enabled;
              const shippingFee = shippingByProducer[producerId]?.fee ?? 0;
              const shippingNote = shippingByProducer[producerId]?.note;
              const deliveryMethod = producerDeliveryOptions[producerId] ?? 'pickup';
              const addressSource = producerAddressSource[producerId] ?? (hasProfileAddress ? 'profile' : 'custom');

              return (
                <View
                  key={producerId}
                  className="mb-6 p-4 rounded-2xl"
                  style={{ backgroundColor: `${COLORS.text.white}08` }}
                >
                  {/* En-tête producteur */}
                  <View className="mb-4 pb-4 border-b" style={{ borderBottomColor: `${COLORS.accent.hemp}30` }}>
                    <View className="flex-row items-center justify-between">
                      <Text className="text-lg font-bold" style={{ color: COLORS.text.cream }}>
                        {producerName}
                      </Text>
                      <View
                        className="px-3 py-1 rounded-full flex-row items-center"
                        style={{
                          backgroundColor: isMinimumMetForProducer ? `${COLORS.accent.hemp}30` : `${COLORS.accent.red}30`,
                        }}
                      >
                        {isMinimumMetForProducer ? (
                          <>
                            <CheckCircle size={14} color={COLORS.accent.hemp} />
                            <Text className="text-xs font-bold ml-1" style={{ color: COLORS.accent.hemp }}>
                              ✓ OK
                            </Text>
                          </>
                        ) : (
                          <>
                            <AlertCircle size={14} color={COLORS.accent.red} />
                            <Text className="text-xs font-bold ml-1" style={{ color: COLORS.accent.red }}>
                              Minimum
                            </Text>
                          </>
                        )}
                      </View>
                    </View>
                  </View>

                  {/* Articles */}
                  {producerItems.map((item) => (
                    <CartItemRow
                      key={item.id}
                      item={item}
                      onQuantityChange={(quantity) => {
                        if (session?.user.id && session?.access_token) {
                          updateQuantity(session.user.id, session.access_token, item.id, quantity);
                        }
                      }}
                      onRemove={() => {
                        if (session?.user.id && session?.access_token) {
                          removeItem(session.user.id, session.access_token, item.id);
                        }
                      }}
                    />
                  ))}

                  <View className="mt-3 p-3 rounded-xl" style={{ backgroundColor: `${COLORS.text.white}06` }}>
                    <Text className="mb-2 font-semibold" style={{ color: COLORS.text.cream }}>
                      Livraison pour ce producteur
                    </Text>
                    <View className="flex-row gap-2">
                      <Pressable
                        onPress={() => setProducerDeliveryOptions((prev) => ({ ...prev, [producerId]: 'pickup' }))}
                        className="flex-1 rounded-lg px-3 py-2"
                        style={{
                          backgroundColor: deliveryMethod === 'pickup' ? `${COLORS.accent.hemp}25` : `${COLORS.text.white}08`,
                          borderWidth: 1,
                          borderColor: deliveryMethod === 'pickup' ? COLORS.accent.hemp : `${COLORS.text.white}20`,
                        }}
                      >
                        <Text className="font-semibold text-center" style={{ color: deliveryMethod === 'pickup' ? COLORS.accent.hemp : COLORS.text.lightGray }}>
                          Retrait
                        </Text>
                      </Pressable>
                      <Pressable
                        disabled={!canShip}
                        onPress={() => setProducerDeliveryOptions((prev) => ({ ...prev, [producerId]: 'shipping' }))}
                        className="flex-1 rounded-lg px-3 py-2"
                        style={{
                          backgroundColor: deliveryMethod === 'shipping' ? `${COLORS.primary.gold}20` : `${COLORS.text.white}08`,
                          borderWidth: 1,
                          borderColor: deliveryMethod === 'shipping' ? COLORS.primary.gold : `${COLORS.text.white}20`,
                          opacity: canShip ? 1 : 0.45,
                        }}
                      >
                        <Text className="font-semibold text-center" style={{ color: deliveryMethod === 'shipping' ? COLORS.primary.gold : COLORS.text.lightGray }}>
                          Livraison ({shippingFee.toFixed(2)}€)
                        </Text>
                      </Pressable>
                    </View>
                    {!canShip && (
                      <Text className="text-xs mt-2" style={{ color: COLORS.text.muted }}>
                        Livraison non disponible pour ce producteur.
                      </Text>
                    )}
                    {canShip && shippingNote ? (
                      <Text className="text-xs mt-2" style={{ color: COLORS.text.muted }}>
                        {shippingNote}
                      </Text>
                    ) : null}
                    {deliveryMethod === 'shipping' && (
                      <View className="mt-3">
                        <Text className="mb-2 font-semibold" style={{ color: COLORS.text.lightGray }}>
                          Adresse de livraison
                        </Text>
                        <View className="flex-row gap-2 mb-2">
                          <Pressable
                            disabled={!hasProfileAddress}
                            onPress={() => setProducerAddressSource((prev) => ({ ...prev, [producerId]: 'profile' }))}
                            className="flex-1 rounded-lg px-3 py-2"
                            style={{
                              backgroundColor: addressSource === 'profile' ? `${COLORS.accent.hemp}25` : `${COLORS.text.white}08`,
                              borderWidth: 1,
                              borderColor: addressSource === 'profile' ? COLORS.accent.hemp : `${COLORS.text.white}20`,
                              opacity: hasProfileAddress ? 1 : 0.45,
                            }}
                          >
                            <Text className="text-center font-semibold" style={{ color: addressSource === 'profile' ? COLORS.accent.hemp : COLORS.text.lightGray }}>
                              Adresse profil
                            </Text>
                          </Pressable>
                          <Pressable
                            onPress={() => setProducerAddressSource((prev) => ({ ...prev, [producerId]: 'custom' }))}
                            className="flex-1 rounded-lg px-3 py-2"
                            style={{
                              backgroundColor: addressSource === 'custom' ? `${COLORS.primary.gold}20` : `${COLORS.text.white}08`,
                              borderWidth: 1,
                              borderColor: addressSource === 'custom' ? COLORS.primary.gold : `${COLORS.text.white}20`,
                            }}
                          >
                            <Text className="text-center font-semibold" style={{ color: addressSource === 'custom' ? COLORS.primary.gold : COLORS.text.lightGray }}>
                              Autre adresse
                            </Text>
                          </Pressable>
                        </View>
                        {addressSource === 'profile' ? (
                          <View className="rounded-lg px-3 py-2 mb-2" style={{ backgroundColor: `${COLORS.background.nightSky}80` }}>
                            <Text style={{ color: COLORS.text.cream }}>
                              {hasProfileAddress
                                ? `${profileAddress?.address}, ${profileAddress?.postalCode} ${profileAddress?.city}`
                                : 'Aucune adresse complète enregistrée dans le profil.'}
                            </Text>
                          </View>
                        ) : (
                          <>
                            <TextInput
                              value={producerCustomAddress[producerId] ?? ''}
                              onChangeText={(text) => setProducerCustomAddress((prev) => ({ ...prev, [producerId]: text }))}
                              placeholder="Adresse"
                              placeholderTextColor={COLORS.text.muted}
                              className="rounded-lg px-3 py-2 mb-2"
                              style={{ color: COLORS.text.cream, backgroundColor: `${COLORS.background.nightSky}80` }}
                            />
                            <View className="flex-row gap-2 mb-2">
                              <TextInput
                                value={producerCustomPostalCode[producerId] ?? ''}
                                onChangeText={(text) => setProducerCustomPostalCode((prev) => ({ ...prev, [producerId]: text }))}
                                placeholder="Code postal"
                                placeholderTextColor={COLORS.text.muted}
                                className="flex-1 rounded-lg px-3 py-2"
                                style={{ color: COLORS.text.cream, backgroundColor: `${COLORS.background.nightSky}80` }}
                              />
                              <TextInput
                                value={producerCustomCity[producerId] ?? ''}
                                onChangeText={(text) => setProducerCustomCity((prev) => ({ ...prev, [producerId]: text }))}
                                placeholder="Ville"
                                placeholderTextColor={COLORS.text.muted}
                                className="flex-1 rounded-lg px-3 py-2"
                                style={{ color: COLORS.text.cream, backgroundColor: `${COLORS.background.nightSky}80` }}
                              />
                            </View>
                          </>
                        )}
                        <TextInput
                          value={producerDeliveryInstructions[producerId] ?? ''}
                          onChangeText={(text) => setProducerDeliveryInstructions((prev) => ({ ...prev, [producerId]: text }))}
                          placeholder="Instructions de livraison (optionnel)"
                          placeholderTextColor={COLORS.text.muted}
                          className="rounded-lg px-3 py-2"
                          style={{ color: COLORS.text.cream, backgroundColor: `${COLORS.background.nightSky}80` }}
                        />
                      </View>
                    )}
                  </View>

                  {/* Total producteur */}
                  <View className="mt-4 pt-4 border-t" style={{ borderTopColor: `${COLORS.accent.hemp}30` }}>
                    <View className="flex-row justify-between items-center">
                      <Text style={{ color: COLORS.text.lightGray }}>Total:</Text>
                      <Text className="text-xl font-bold" style={{ color: COLORS.primary.gold }}>
                        {producerTotal.toFixed(2)}€
                      </Text>
                    </View>
                  </View>
                </View>
              );
            })}
          </View>
        )}
      </ScrollView>

      {/* Footer avec total et bouton */}
      {hasItems && (
        <View
          className="px-4 py-4 border-t"
          style={{
            backgroundColor: COLORS.background.charcoal,
            borderTopColor: COLORS.primary.gold,
            paddingBottom: insets.bottom + 16,
          }}
        >
          <View className="mb-4">
            <View className="flex-row justify-between items-center mb-2">
              <Text style={{ color: COLORS.text.lightGray }}>Grand Total:</Text>
              <Text className="text-2xl font-bold" style={{ color: COLORS.primary.gold }}>
                {grandTotal.toFixed(2)}€
              </Text>
            </View>
          </View>

          <View className="flex-row gap-3">
            <Pressable
              onPress={handleContinueShopping}
              className="flex-1 py-4 rounded-xl items-center justify-center"
              style={{
                backgroundColor: `${COLORS.accent.forest}25`,
                borderWidth: 1,
                borderColor: COLORS.accent.forest,
              }}
            >
              <Text className="font-bold" style={{ color: COLORS.accent.hemp }}>
                Continuer mes achats
              </Text>
            </Pressable>

            <Pressable
              disabled={!isMinimumMet || validating}
              onPress={handleValidateOrder}
              className="flex-1 py-4 rounded-xl flex-row items-center justify-center"
              style={{
                backgroundColor: isMinimumMet && !validating ? COLORS.accent.hemp : COLORS.text.muted,
                opacity: isMinimumMet && !validating ? 1 : 0.5,
              }}
            >
              {validating ? (
                <ActivityIndicator size="small" color={COLORS.text.white} />
              ) : (
                <>
                  <ShoppingCart size={20} color={COLORS.text.white} />
                  <Text className="ml-2 font-bold text-lg" style={{ color: COLORS.text.white }}>
                    Commander
                  </Text>
                </>
              )}
            </Pressable>
          </View>
          {/* Info paiement */}
          {isMinimumMet && (
            <Text className="text-center text-xs mt-3" style={{ color: COLORS.text.lightGray }}>
              💳 Vous recevrez un lien de paiement par email après validation
            </Text>
          )}

          {!isMinimumMet && (
            <Text className="text-center text-sm mt-3" style={{ color: COLORS.accent.red }}>
              Complétez vos commandes pour atteindre 20€ par producteur
            </Text>
          )}
        </View>
      )}
    </LinearGradient>
  );
}

interface CartItemRowProps {
  item: DirectSalesCartItem;
  onQuantityChange: (quantity: number) => void;
  onRemove: () => void;
}

function CartItemRow({ item, onQuantityChange, onRemove }: CartItemRowProps) {
  const subtotal = item.price * item.quantity;

  return (
    <View className="flex-row items-center mb-4 pb-4 border-b" style={{ borderBottomColor: `${COLORS.text.white}10` }}>
      {/* Image */}
      {item.image && (
        <Image
          source={{ uri: item.image }}
          className="w-16 h-16 rounded-lg mr-3 bg-gray-800"
        />
      )}

      {/* Info */}
      <View className="flex-1">
        <Text className="font-semibold" style={{ color: COLORS.text.cream }}>
          {item.product_name}
        </Text>
        <Text className="text-sm mt-1" style={{ color: COLORS.text.lightGray }}>
          {item.price.toFixed(2)}€ x {item.quantity} = {subtotal.toFixed(2)}€
        </Text>
      </View>

      {/* Quantité */}
      <View className="flex-row items-center mr-3">
        <Pressable
          onPress={() => onQuantityChange(item.quantity - 1)}
          className="p-1.5"
          style={{ backgroundColor: `${COLORS.text.white}10`, borderRadius: 6 }}
        >
          <Minus size={16} color={COLORS.text.cream} />
        </Pressable>

        <Text className="mx-2 font-bold w-6 text-center" style={{ color: COLORS.text.cream }}>
          {item.quantity}
        </Text>

        <Pressable
          onPress={() => onQuantityChange(item.quantity + 1)}
          className="p-1.5"
          style={{ backgroundColor: `${COLORS.text.white}10`, borderRadius: 6 }}
        >
          <Plus size={16} color={COLORS.text.cream} />
        </Pressable>
      </View>

      {/* Supprimer */}
      <Pressable
        onPress={onRemove}
        className="p-2"
        style={{ backgroundColor: `${COLORS.accent.red}20`, borderRadius: 8 }}
      >
        <Trash2 size={16} color={COLORS.accent.red} />
      </Pressable>
    </View>
  );
}
