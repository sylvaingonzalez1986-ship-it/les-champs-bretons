import React, { useMemo } from 'react';
import { View, ScrollView, Pressable, ActivityIndicator } from 'react-native';
import { Text } from '@/components/ui';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { CheckCircle, ArrowRight, MapPin, Clock } from 'lucide-react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { COLORS } from '@/lib/colors';
import { useAuth } from '@/lib/useAuth';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '@/lib/supabase-auth';

interface OrderData {
  id: string;
  producer_id: string;
  pickup_code?: string | null;
  total: number;
  statut: string;
  adresse_retrait: string;
  horaires_retrait: string;
  instructions_retrait: string | null;
}

interface ProducerData {
  id: string;
  name: string;
}

function useDirectSaleOrdersByIds(orderIds: string[]) {
  const { session } = useAuth();
  const sortedOrderIds = useMemo(() => {
    const uniqueIds = Array.from(new Set(orderIds.map((id) => id.trim()).filter(Boolean)));
    return uniqueIds.sort();
  }, [orderIds]);

  return useQuery<(OrderData & { producer_name: string })[]>({
    queryKey: ['direct-sale-orders', sortedOrderIds, session?.access_token],
    enabled: sortedOrderIds.length > 0 && !!session?.access_token,
    queryFn: async () => {
      if (!session?.access_token || sortedOrderIds.length === 0) {
        return [];
      }

      const idsFilter = sortedOrderIds.map((id) => encodeURIComponent(id)).join(',');
      const ordersResponse = await fetch(
        `${SUPABASE_URL}/rest/v1/commandes_vente_directe?id=in.(${idsFilter})&select=id,producer_id,pickup_code,total,statut,adresse_retrait,horaires_retrait,instructions_retrait`,
        {
          headers: {
            'Content-Type': 'application/json',
            apikey: SUPABASE_ANON_KEY,
            Authorization: `Bearer ${session.access_token}`,
          },
        }
      );

      if (!ordersResponse.ok) {
        return [];
      }

      const ordersData = (await ordersResponse.json()) as OrderData[];
      if (!Array.isArray(ordersData) || ordersData.length === 0) {
        return [];
      }

      const producerIds = Array.from(new Set(ordersData.map((order) => order.producer_id).filter(Boolean)));
      let producersById = new Map<string, string>();

      if (producerIds.length > 0) {
        const producersFilter = producerIds.map((id) => encodeURIComponent(id)).join(',');
        const producersResponse = await fetch(
          `${SUPABASE_URL}/rest/v1/producers?id=in.(${producersFilter})&select=id,name`,
          {
            headers: {
              'Content-Type': 'application/json',
              apikey: SUPABASE_ANON_KEY,
              Authorization: `Bearer ${session.access_token}`,
            },
          }
        );

        if (producersResponse.ok) {
          const producersData = (await producersResponse.json()) as ProducerData[];
          if (Array.isArray(producersData)) {
            producersById = new Map(
              producersData.map((producer) => [producer.id, producer.name ?? 'Unknown Producer'])
            );
          }
        }
      }

      return ordersData.map((order) => ({
        ...order,
        producer_name: producersById.get(order.producer_id) ?? 'Unknown Producer',
      }));
    },
  });
}

export default function CommandeConfirmation() {
  const insets = useSafeAreaInsets();
  const { orderIds: orderIdsParam } = useLocalSearchParams();
  const orderIds = useMemo(() => {
    if (typeof orderIdsParam !== 'string') {
      return [];
    }

    return orderIdsParam.split(',').map((id) => id.trim()).filter(Boolean);
  }, [orderIdsParam]);

  const { data: orders = [], isLoading } = useDirectSaleOrdersByIds(orderIds);

  if (isLoading) {
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

  const grandTotal = orders.reduce((sum, order) => sum + order.total, 0);

  return (
    <LinearGradient
      colors={[COLORS.background.nightSky, COLORS.background.mediumBlue]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      className="flex-1"
    >
      <ScrollView className="flex-1" contentContainerStyle={{ paddingBottom: 40 }}>
        {/* Header Success */}
        <View style={{ paddingTop: insets.top + 40 }} className="px-4 items-center mb-8">
          <View className="mb-4">
            <CheckCircle size={64} color={COLORS.accent.hemp} strokeWidth={1.5} />
          </View>
          <Text className="text-3xl font-bold text-center" style={{ color: COLORS.text.cream }}>
            Commande validée!
          </Text>
          <Text className="text-base mt-2 text-center" style={{ color: COLORS.text.lightGray }}>
            Vos commandes ont été créées avec succès
          </Text>
        </View>

        {/* Orders List */}
        <View className="px-4">
          {orders.map((order) => (
            <View
              key={order.id}
              className="mb-4 p-4 rounded-2xl"
              style={{ backgroundColor: `${COLORS.text.white}08` }}
            >
              {/* Producer Header */}
              <View className="mb-4 pb-4 border-b" style={{ borderBottomColor: `${COLORS.accent.hemp}30` }}>
                <Text className="text-lg font-bold" style={{ color: COLORS.text.cream }}>
                  {order.producer_name}
                </Text>
                <Text className="text-sm mt-1" style={{ color: COLORS.text.lightGray }}>
                  Commande #{(order.pickup_code || order.id.slice(0, 8).toUpperCase())}
                </Text>
              </View>

              {order.pickup_code && (
                <View className="mb-4 p-3 rounded-xl" style={{ backgroundColor: `${COLORS.primary.gold}15` }}>
                  <Text className="text-xs" style={{ color: COLORS.text.muted }}>
                    Code de retrait
                  </Text>
                  <Text className="text-lg font-bold" style={{ color: COLORS.primary.gold, letterSpacing: 1 }}>
                    {order.pickup_code}
                  </Text>
                </View>
              )}

              {/* Total */}
              <View className="mb-4 pb-4 border-b" style={{ borderBottomColor: `${COLORS.accent.hemp}30` }}>
                <View className="flex-row justify-between items-center">
                  <Text style={{ color: COLORS.text.lightGray }}>Total:</Text>
                  <Text className="text-xl font-bold" style={{ color: COLORS.primary.gold }}>
                    {order.total.toFixed(2)}€
                  </Text>
                </View>
              </View>

              {/* Pickup Info */}
              <View className="space-y-3">
                {/* Address */}
                <View className="flex-row">
                  <MapPin size={18} color={COLORS.accent.hemp} className="mr-3 mt-0.5" />
                  <View className="flex-1">
                    <Text className="text-xs" style={{ color: COLORS.text.muted }}>
                      Adresse de retrait
                    </Text>
                    <Text className="text-sm mt-1" style={{ color: COLORS.text.cream }}>
                      {order.adresse_retrait}
                    </Text>
                  </View>
                </View>

                {/* Hours */}
                <View className="flex-row">
                  <Clock size={18} color={COLORS.accent.hemp} className="mr-3 mt-0.5" />
                  <View className="flex-1">
                    <Text className="text-xs" style={{ color: COLORS.text.muted }}>
                      Horaires d'ouverture
                    </Text>
                    <Text className="text-sm mt-1" style={{ color: COLORS.text.cream }}>
                      {order.horaires_retrait}
                    </Text>
                  </View>
                </View>

                {/* Instructions if any */}
                {order.instructions_retrait && (
                  <View className="flex-row mt-2">
                    <View className="flex-1">
                      <Text className="text-xs" style={{ color: COLORS.text.muted }}>
                        Instructions spéciales
                      </Text>
                      <Text className="text-sm mt-1" style={{ color: COLORS.text.cream }}>
                        {order.instructions_retrait}
                      </Text>
                    </View>
                  </View>
                )}
              </View>

              {/* Status Badge */}
              <View className="mt-4 pt-4 border-t" style={{ borderTopColor: `${COLORS.accent.hemp}30` }}>
                <View
                  className="px-3 py-2 rounded-lg flex-row items-center justify-between"
                  style={{ backgroundColor: `${COLORS.accent.hemp}20` }}
                >
                  <Text className="text-xs font-bold" style={{ color: COLORS.accent.hemp }}>
                    Statut: En attente de paiement
                  </Text>
                  <Text className="text-xs" style={{ color: COLORS.accent.hemp }}>
                    Lien de paiement à venir
                  </Text>
                </View>
              </View>
            </View>
          ))}
        </View>

        {/* Grand Total */}
        {orders.length > 1 && (
          <View className="mx-4 mt-6 p-4 rounded-2xl" style={{ backgroundColor: `${COLORS.primary.gold}15` }}>
            <View className="flex-row justify-between items-center">
              <Text className="font-bold" style={{ color: COLORS.text.lightGray }}>
                Grand Total:
              </Text>
              <Text className="text-2xl font-bold" style={{ color: COLORS.primary.gold }}>
                {grandTotal.toFixed(2)}€
              </Text>
            </View>
          </View>
        )}

        {/* Info Box */}
        <View className="mx-4 mt-6 p-4 rounded-2xl" style={{ backgroundColor: `${COLORS.accent.hemp}15` }}>
          <Text className="font-bold mb-2" style={{ color: COLORS.accent.hemp }}>
            Prochaine étape
          </Text>
          <Text className="text-sm" style={{ color: COLORS.text.lightGray }}>
            Les producteurs recevront votre commande et vous enverront un lien de paiement sécurisé par email. Une fois le paiement effectué, votre commande sera préparée pour le retrait.
          </Text>
        </View>

        {/* Payment Info */}
        <View className="mx-4 mt-4 p-4 rounded-2xl" style={{ backgroundColor: `${COLORS.primary.gold}10` }}>
          <Text className="font-bold mb-2" style={{ color: COLORS.primary.gold }}>
            💳 Paiement
          </Text>
          <Text className="text-sm" style={{ color: COLORS.text.lightGray }}>
            Vous recevrez un lien de paiement par email sous peu. Surveillez votre boîte de réception (et vos spams).
          </Text>
        </View>
      </ScrollView>

      {/* Footer Buttons */}
      <View
        className="px-4 py-4 border-t gap-3"
        style={{
          backgroundColor: COLORS.background.charcoal,
          borderTopColor: COLORS.primary.gold,
          paddingBottom: insets.bottom + 16,
        }}
      >
        <Pressable
          onPress={() => router.push('/(tabs)/marche-local')}
          className="py-4 rounded-xl flex-row items-center justify-center"
          style={{ backgroundColor: COLORS.accent.hemp }}
        >
          <Text className="font-bold text-lg" style={{ color: COLORS.text.white }}>
            Continuer les achats
          </Text>
          <ArrowRight size={18} color={COLORS.text.white} className="ml-2" />
        </Pressable>

        <Pressable
          onPress={() => router.push('/(tabs)/profile')}
          className="py-4 rounded-xl flex-row items-center justify-center"
          style={{ backgroundColor: `${COLORS.text.white}10` }}
        >
          <Text className="font-bold text-lg" style={{ color: COLORS.text.cream }}>
            Voir mes commandes
          </Text>
        </Pressable>
      </View>
    </LinearGradient>
  );
}
