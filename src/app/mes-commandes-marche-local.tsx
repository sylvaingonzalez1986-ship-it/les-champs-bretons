/**
 * Écran Mes Commandes Marché Local
 * Affiche l'historique des commandes directes auprès des producteurs locaux
 */

import React, { useMemo } from 'react';
import {
  View,
  ScrollView,
  Pressable,
  RefreshControl,
  ActivityIndicator,
} from 'react-native';
import { Text } from '@/components/ui';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { ArrowLeft, Package, MapPin, Clock, Phone, Mail, AlertCircle, Check, X } from 'lucide-react-native';
import { router } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { COLORS } from '@/lib/colors';
import { useLocalMarketOrders, LocalMarketOrder, getStatusLabel, getStatusColor } from '@/lib/local-market-orders';
import { useAuth } from '@/lib/useAuth';
import * as Haptics from 'expo-haptics';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { useLocalMarketOrdersInfinite } from '@/api/local-market';

export default function MesCommandesMarcheLocal() {
  const insets = useSafeAreaInsets();
  const { session } = useAuth();
  const cancelOrder = useLocalMarketOrders((s) => s.cancelOrder);
  const queryClient = useQueryClient();

  const [refreshing, setRefreshing] = React.useState(false);
  const [cancellingId, setCancellingId] = React.useState<string | null>(null);
  const PAGE_SIZE = 20;

  const {
    data,
    isLoading,
    isFetchingNextPage,
    hasNextPage,
    fetchNextPage,
    refetch,
    error,
  } = useLocalMarketOrdersInfinite(session?.user?.id, session?.access_token, PAGE_SIZE);

  const orders = useMemo(
    () => data?.pages.flat() ?? [],
    [data]
  );

  const errorMessage = useMemo(() => {
    if (!error) return null;
    return error instanceof Error ? error.message : 'Erreur de connexion au serveur';
  }, [error]);

  const onRefresh = async () => {
    setRefreshing(true);
    if (session?.user?.id) {
      queryClient.resetQueries({ queryKey: ['local-market-orders', session.user.id] });
    }
    await refetch();
    setRefreshing(false);
  };

  const onLoadMore = async () => {
    if (!hasNextPage || isFetchingNextPage) return;
    await fetchNextPage();
  };

  const handleCancelOrder = async (orderId: string) => {
    if (!session?.user?.id || !session?.access_token) return;

    setCancellingId(orderId);
    const result = await cancelOrder(session.user.id, session.access_token, orderId);

    if (result.success) {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } else {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    }
    setCancellingId(null);
  };

  // Grouper les commandes par statut
  const pendingOrders = orders.filter(o => o.status === 'pending' || o.status === 'confirmed');
  const readyOrders = orders.filter(o => o.status === 'ready');
  const completedOrders = orders.filter(o => o.status === 'completed' || o.status === 'cancelled');

  if (isLoading && orders.length === 0) {
    return (
      <LinearGradient
        colors={[COLORS.background.nightSky, COLORS.background.mediumBlue]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}
      >
        <ActivityIndicator size="large" color={COLORS.primary.gold} />
        <Text className="mt-4" style={{ color: COLORS.text.lightGray }}>
          Chargement de vos commandes...
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
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: 40 }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={COLORS.primary.gold}
          />
        }
      >
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
            <Text className="text-2xl font-bold" style={{ color: COLORS.text.cream }}>
              Mes commandes
            </Text>
            <Text className="text-sm" style={{ color: COLORS.text.lightGray }}>
              Marché Local
            </Text>
          </View>
        </View>

        {/* Erreur */}
        {errorMessage && (
          <View className="mx-4 mb-4 p-3 rounded-xl flex-row items-center" style={{ backgroundColor: `${COLORS.accent.red}20` }}>
            <AlertCircle size={18} color={COLORS.accent.red} />
            <Text className="ml-2 flex-1" style={{ color: COLORS.accent.red }}>
              {errorMessage}
            </Text>
          </View>
        )}

        {/* Aucune commande */}
        {orders.length === 0 && !isLoading && (
          <View className="flex-1 items-center justify-center px-4 py-12">
            <Package size={48} color={COLORS.text.muted} strokeWidth={1.5} />
            <Text className="text-center mt-4 text-lg font-semibold" style={{ color: COLORS.text.lightGray }}>
              Aucune commande
            </Text>
            <Text className="text-center mt-2 text-sm" style={{ color: COLORS.text.muted }}>
              Vos commandes Marché Local apparaîtront ici
            </Text>
            <Pressable
              onPress={() => router.push('/(tabs)/marche-local')}
              className="mt-6 px-6 py-3 rounded-xl"
              style={{ backgroundColor: COLORS.accent.hemp }}
            >
              <Text className="font-bold" style={{ color: COLORS.text.white }}>
                Découvrir le Marché Local
              </Text>
            </Pressable>
          </View>
        )}

        {/* Commandes prêtes */}
        {readyOrders.length > 0 && (
          <OrderSection
            title="Prêtes à retirer"
            orders={readyOrders}
            onCancel={handleCancelOrder}
            cancellingId={cancellingId}
            highlightColor={COLORS.accent.hemp}
          />
        )}

        {/* Commandes en cours */}
        {pendingOrders.length > 0 && (
          <OrderSection
            title="En cours"
            orders={pendingOrders}
            onCancel={handleCancelOrder}
            cancellingId={cancellingId}
          />
        )}

        {/* Commandes terminées */}
        {completedOrders.length > 0 && (
          <OrderSection
            title="Historique"
            orders={completedOrders}
            onCancel={handleCancelOrder}
            cancellingId={cancellingId}
            collapsed
          />
        )}

        {hasNextPage && (
          <View className="items-center my-6">
            <Pressable
              onPress={onLoadMore}
              disabled={isFetchingNextPage}
              className="px-4 py-2 rounded-full"
              style={{ backgroundColor: `${COLORS.text.white}10` }}
            >
              <Text style={{ color: COLORS.text.lightGray }}>
                {isFetchingNextPage ? 'Chargement...' : 'Charger plus'}
              </Text>
            </Pressable>
          </View>
        )}
      </ScrollView>
    </LinearGradient>
  );
}

interface OrderSectionProps {
  title: string;
  orders: LocalMarketOrder[];
  onCancel: (orderId: string) => void;
  cancellingId: string | null;
  highlightColor?: string;
  collapsed?: boolean;
}

function OrderSection({ title, orders, onCancel, cancellingId, highlightColor, collapsed }: OrderSectionProps) {
  const [isExpanded, setIsExpanded] = React.useState(!collapsed);

  return (
    <View className="mb-6 px-4">
      <Pressable
        onPress={() => setIsExpanded(!isExpanded)}
        className="flex-row items-center justify-between mb-3"
      >
        <Text className="text-lg font-bold" style={{ color: highlightColor || COLORS.text.cream }}>
          {title} ({orders.length})
        </Text>
        <Text style={{ color: COLORS.text.muted }}>
          {isExpanded ? '▼' : '▶'}
        </Text>
      </Pressable>

      {isExpanded && (
        <View className="gap-3">
          {orders.map((order, index) => (
            <OrderCard
              key={order.id}
              order={order}
              index={index}
              onCancel={onCancel}
              cancellingId={cancellingId}
            />
          ))}
        </View>
      )}
    </View>
  );
}

interface OrderCardProps {
  order: LocalMarketOrder;
  index: number;
  onCancel: (orderId: string) => void;
  cancellingId: string | null;
}

function OrderCard({ order, index, onCancel, cancellingId }: OrderCardProps) {
  const statusColor = getStatusColor(order.status);
  const statusLabel = getStatusLabel(order.status);
  const canCancel = order.status === 'pending';
  const isCancelling = cancellingId === order.id;

  const formattedDate = new Date(order.created_at).toLocaleDateString('fr-FR', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  return (
    <Animated.View
      entering={FadeInDown.duration(300).delay(index * 50)}
      className="rounded-xl overflow-hidden"
      style={{
        backgroundColor: `${COLORS.text.white}08`,
        borderWidth: 1,
        borderColor: order.status === 'ready' ? `${COLORS.accent.hemp}50` : `${COLORS.text.white}10`,
      }}
    >
      {/* Header avec statut */}
      <View
        className="flex-row items-center justify-between px-4 py-3"
        style={{ backgroundColor: `${statusColor}15` }}
      >
        <View className="flex-row items-center">
          <View
            className="w-3 h-3 rounded-full mr-2"
            style={{ backgroundColor: statusColor }}
          />
          <Text className="font-semibold" style={{ color: statusColor }}>
            {statusLabel}
          </Text>
        </View>
        <Text className="text-xs" style={{ color: COLORS.text.muted }}>
          {formattedDate}
        </Text>
      </View>

      {/* Contenu */}
      <View className="p-4">
        {/* Produit et montant */}
        <View className="flex-row items-start justify-between mb-3">
          <View className="flex-1 mr-3">
            <Text className="font-bold" style={{ color: COLORS.text.cream }}>
              {order.product_name}
            </Text>
            <Text className="text-sm mt-1" style={{ color: COLORS.text.muted }}>
              Quantité: {order.quantity} × {order.unit_price.toFixed(2)}€
            </Text>
          </View>
          <View className="items-end">
            <Text className="text-xl font-bold" style={{ color: COLORS.primary.gold }}>
              {order.total_amount.toFixed(2)}€
            </Text>
            {order.is_paid && (
              <View className="flex-row items-center mt-1">
                <Check size={12} color={COLORS.accent.hemp} />
                <Text className="text-xs ml-1" style={{ color: COLORS.accent.hemp }}>
                  Payé
                </Text>
              </View>
            )}
          </View>
        </View>

        {/* Code de retrait */}
        {order.status !== 'cancelled' && (
          <View
            className="p-3 rounded-lg mb-3"
            style={{ backgroundColor: `${COLORS.primary.gold}15` }}
          >
            <Text className="text-xs mb-1" style={{ color: COLORS.text.muted }}>
              Code de retrait
            </Text>
            <Text className="text-2xl font-bold tracking-widest" style={{ color: COLORS.primary.gold }}>
              {order.pickup_code}
            </Text>
          </View>
        )}

        {/* Producteur */}
        <View className="mb-3">
          <Text className="text-xs mb-1" style={{ color: COLORS.text.muted }}>
            Producteur
          </Text>
          <Text className="font-semibold" style={{ color: COLORS.text.cream }}>
            {order.producer_name}
          </Text>
        </View>

        {/* Lieu de retrait */}
        {order.pickup_location && (
          <View className="flex-row items-start mb-2">
            <MapPin size={14} color={COLORS.text.muted} />
            <Text className="ml-2 text-sm flex-1" style={{ color: COLORS.text.lightGray }}>
              {order.pickup_location}
            </Text>
          </View>
        )}

        {/* Instructions */}
        {order.pickup_instructions && (
          <View className="flex-row items-start mb-2">
            <Clock size={14} color={COLORS.text.muted} />
            <Text className="ml-2 text-sm flex-1" style={{ color: COLORS.text.lightGray }}>
              {order.pickup_instructions}
            </Text>
          </View>
        )}

        {/* Contact producteur */}
        {order.producer_email && (
          <View className="flex-row items-center mb-2">
            <Mail size={14} color={COLORS.text.muted} />
            <Text className="ml-2 text-sm" style={{ color: COLORS.text.lightGray }}>
              {order.producer_email}
            </Text>
          </View>
        )}

        {order.producer_phone && (
          <View className="flex-row items-center mb-2">
            <Phone size={14} color={COLORS.text.muted} />
            <Text className="ml-2 text-sm" style={{ color: COLORS.text.lightGray }}>
              {order.producer_phone}
            </Text>
          </View>
        )}

        {/* Notes client */}
        {order.customer_notes && (
          <View
            className="p-3 rounded-lg mt-2"
            style={{ backgroundColor: `${COLORS.text.white}05` }}
          >
            <Text className="text-xs mb-1" style={{ color: COLORS.text.muted }}>
              Votre message
            </Text>
            <Text className="text-sm italic" style={{ color: COLORS.text.lightGray }}>
              "{order.customer_notes}"
            </Text>
          </View>
        )}

        {/* Notes producteur */}
        {order.producer_notes && (
          <View
            className="p-3 rounded-lg mt-2"
            style={{ backgroundColor: `${COLORS.accent.hemp}10` }}
          >
            <Text className="text-xs mb-1" style={{ color: COLORS.accent.hemp }}>
              Message du producteur
            </Text>
            <Text className="text-sm" style={{ color: COLORS.text.lightGray }}>
              {order.producer_notes}
            </Text>
          </View>
        )}

        {/* Bouton annuler */}
        {canCancel && (
          <Pressable
            onPress={() => onCancel(String(order.id))}
            disabled={isCancelling}
            className="mt-4 py-3 rounded-xl flex-row items-center justify-center"
            style={{
              backgroundColor: `${COLORS.accent.red}15`,
              opacity: isCancelling ? 0.5 : 1,
            }}
          >
            {isCancelling ? (
              <ActivityIndicator size="small" color={COLORS.accent.red} />
            ) : (
              <>
                <X size={16} color={COLORS.accent.red} />
                <Text className="ml-2 font-semibold" style={{ color: COLORS.accent.red }}>
                  Annuler la commande
                </Text>
              </>
            )}
          </Pressable>
        )}
      </View>
    </Animated.View>
  );
}
