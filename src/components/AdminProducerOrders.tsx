import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  ScrollView,
  Pressable,
  Modal,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { useFocusEffect } from 'expo-router';
import { Text } from '@/components/ui';
import {
  ShoppingBag,
  X,
  Clock,
  CheckCircle,
  Package,
  UserCheck,
  XCircle,
  ChevronRight,
  MapPin,
  Mail,
  Phone,
  User,
  Filter,
  AlertTriangle,
  Hash,
} from 'lucide-react-native';
import { COLORS } from '@/lib/colors';
import { useAuth } from '@/lib/useAuth';
import { SUPABASE_URL, getValidSession } from '@/lib/supabase-auth';
import { useLocalMarketOrders, type LocalMarketOrder, getStatusLabel, getStatusColor } from '@/lib/local-market-orders';
import { ensureDeviceId } from '@/lib/device-id';

// Types
type OrderStatus = 'en_attente' | 'confirmee' | 'prete' | 'recuperee' | 'annulee';
type LocalOrderStatus = 'pending' | 'confirmed' | 'ready' | 'completed' | 'cancelled';

interface DirectSaleOrder {
  id: string;
  user_id: string;
  producer_id: string;
  pickup_code?: string | null;
  total: number;
  statut: OrderStatus;
  adresse_retrait: string;
  horaires_retrait: string;
  instructions_retrait: string | null;
  created_at: string;
  updated_at: string;
}

interface OrderLine {
  id: string;
  commande_id: string;
  product_id: string;
  quantite: number;
  prix_unitaire: number;
  sous_total: number;
  product_name?: string;
}

interface CustomerInfo {
  id: string;
  email: string | null;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
}

interface DirectSaleOrdersProducerIdResponse {
  producerId: string | null;
}

interface DirectSaleOrdersListResponse {
  orders: DirectSaleOrder[];
}

interface DirectSaleOrderDetailsResponse {
  order?: DirectSaleOrder;
  lines?: OrderLine[];
  customer?: CustomerInfo | null;
}

interface DirectSaleOrderUpdateResponse {
  order?: DirectSaleOrder;
}

// Unified order type for display
interface UnifiedOrder {
  id: string;
  type: 'direct_sale' | 'local_market';
  created_at: string;
  total: number;
  status: string;
  statusLabel: string;
  statusColor: string;
  customerName?: string;
  customerEmail?: string;
  customerPhone?: string;
  productName?: string;
  quantity?: number;
  pickupCode?: string;
  originalOrder: DirectSaleOrder | LocalMarketOrder;
}

// Status configuration
const STATUS_CONFIG: Record<OrderStatus, { label: string; color: string; icon: React.ReactNode }> = {
  en_attente: {
    label: 'En attente',
    color: '#f59e0b',
    icon: <Clock size={16} color="#f59e0b" />,
  },
  confirmee: {
    label: 'Confirmée',
    color: '#3b82f6',
    icon: <CheckCircle size={16} color="#3b82f6" />,
  },
  prete: {
    label: 'Prête',
    color: '#8b5cf6',
    icon: <Package size={16} color="#8b5cf6" />,
  },
  recuperee: {
    label: 'Récupérée',
    color: '#22c55e',
    icon: <UserCheck size={16} color="#22c55e" />,
  },
  annulee: {
    label: 'Annulée',
    color: '#ef4444',
    icon: <XCircle size={16} color="#ef4444" />,
  },
};

const STATUS_FILTERS: { value: OrderStatus | 'all'; label: string }[] = [
  { value: 'all', label: 'Toutes' },
  { value: 'en_attente', label: 'En attente' },
  { value: 'confirmee', label: 'Confirmées' },
  { value: 'prete', label: 'Prêtes' },
  { value: 'recuperee', label: 'Récupérées' },
  { value: 'annulee', label: 'Annulées' },
];

// Helper function to safely format order ID
const formatOrderId = (id: unknown): string => {
  if (!id) return 'N/A';
  const idStr = String(id);
  return idStr.slice(0, 8).toUpperCase();
};

export function AdminProducerOrders() {
  const { session, refresh } = useAuth();
  const { loadOrdersForProducer, updateOrderStatus: updateLocalOrderStatus } = useLocalMarketOrders();
  const [producerId, setProducerId] = useState<string | null>(null);
  const [unifiedOrders, setUnifiedOrders] = useState<UnifiedOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [statusFilter, setStatusFilter] = useState<OrderStatus | 'all'>('all');
  const [selectedOrder, setSelectedOrder] = useState<DirectSaleOrder | null>(null);
  const [selectedLocalOrder, setSelectedLocalOrder] = useState<LocalMarketOrder | null>(null);
  const [orderLines, setOrderLines] = useState<OrderLine[]>([]);
  const [customerInfo, setCustomerInfo] = useState<CustomerInfo | null>(null);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [updatingStatus, setUpdatingStatus] = useState(false);
  const [localOrderError, setLocalOrderError] = useState<string | null>(null);

  // Helper to get a valid access token (refreshes if expired)
  const getAccessToken = useCallback(async (): Promise<string | null> => {
    try {
      const validSession = await getValidSession();
      if (validSession?.access_token) {
        return validSession.access_token;
      }
      // If getValidSession returns null but we have a session, try to refresh
      if (session?.refresh_token) {
        const newSession = await refresh();
        return newSession?.access_token ?? null;
      }
      return null;
    } catch (error) {
      console.error('[AdminProducerOrders] Error getting valid token:', error);
      return null;
    }
  }, [session?.refresh_token, refresh]);

  const callDirectSaleOrders = useCallback(<T extends unknown>(
    payload: Record<string, unknown>,
    retryAfterBind = true
  ): Promise<T | null> => (async () => {
    const accessToken = await getAccessToken();
    if (!accessToken) {
      return null;
    }

    const deviceId = await ensureDeviceId();
    const response = await fetch(`${SUPABASE_URL}/functions/v1/direct-sale-orders`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
        'X-Device-Id': deviceId,
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      // Handle DEVICE_NOT_BOUND by attempting to bind and retry once
      if (response.status === 409 && retryAfterBind) {
        let errorData: { error?: string } | null = null;
        try { errorData = await response.json(); } catch { /* ignore */ }
        if (errorData?.error === 'DEVICE_NOT_BOUND') {
          const bindResponse = await fetch(`${SUPABASE_URL}/functions/v1/bind-device`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${accessToken}`,
              'X-Device-Id': deviceId,
            },
            body: JSON.stringify({}),
          });
          if (bindResponse.ok) {
            return callDirectSaleOrders<T>(payload, false);
          }
        }
      }
      const errorText = await response.text().catch(() => '');
      throw new Error(errorText || 'Erreur chargement commandes');
    }

    const data = (await response.json()) as T;
    return data;
  })(), [getAccessToken]);

  // Fetch the producer_id linked to this user's profile
  const fetchProducerId = useCallback(async () => {
    if (!session?.user?.id) return;

    try {
      const result = await callDirectSaleOrders<DirectSaleOrdersProducerIdResponse>({ action: 'producerId' });
      setProducerId(result?.producerId || null);
    } catch (error) {
      console.error('Error fetching producer id:', error);
    }
  }, [session?.user?.id, callDirectSaleOrders]);

  useEffect(() => {
    fetchProducerId();
  }, [fetchProducerId]);

  // Fetch orders for this producer (both direct sales and local market orders)
  const fetchOrders = useCallback(async (showLoading = true) => {
    if (!producerId) {
      return;
    }

    const accessToken = await getAccessToken();
    if (!accessToken) {
      return;
    }

    if (showLoading) setLoading(true);

    try {
      // Fetch both types of orders in parallel
      const [directSalesData, localMarketData] = await Promise.all([
        // 1. Fetch commandes_vente_directe via Edge Function
        (async () => {
          const result = await callDirectSaleOrders<DirectSaleOrdersListResponse>({
            action: 'list',
            producerId,
            status: statusFilter === 'all' ? undefined : statusFilter,
            limit: 200,
            offset: 0,
          });
          return Array.isArray(result?.orders) ? result.orders : [];
        })(),
        // 2. Fetch local_market_orders (commande directe)
        loadOrdersForProducer(producerId, accessToken),
      ]);

      // Create unified orders list for display
      const unified: UnifiedOrder[] = [];

      // Add direct sale orders (with validation)
      for (const order of directSalesData) {
        // Skip orders without valid ID
        if (!order?.id) {
          continue;
        }
        const statusConfig = STATUS_CONFIG[order.statut as OrderStatus];
        unified.push({
          id: order.id,
          type: 'direct_sale',
          created_at: order.created_at || new Date().toISOString(),
          total: order.total || 0,
          status: order.statut || 'en_attente',
          statusLabel: statusConfig?.label || order.statut || 'En attente',
          statusColor: statusConfig?.color || '#6B7280',
          pickupCode: order.pickup_code ?? undefined,
          originalOrder: order,
        });
      }

      // Add local market orders (filter by status if needed)
      for (const order of localMarketData) {
        // Skip orders without valid ID
        if (!order?.id) {
          continue;
        }

        // Map local market status to direct sale status for filtering
        const statusMap: Record<LocalOrderStatus, OrderStatus> = {
          pending: 'en_attente',
          confirmed: 'confirmee',
          ready: 'prete',
          completed: 'recuperee',
          cancelled: 'annulee',
        };

        const mappedStatus = statusMap[order.status as LocalOrderStatus];
        if (statusFilter !== 'all' && mappedStatus !== statusFilter) {
          continue;
        }

        unified.push({
          id: String(order.id),
          type: 'local_market',
          created_at: order.created_at || new Date().toISOString(),
          total: order.total_amount || 0,
          status: order.status || 'pending',
          statusLabel: getStatusLabel(order.status),
          statusColor: getStatusColor(order.status),
          customerName: order.customer_name,
          customerEmail: order.customer_email,
          customerPhone: order.customer_phone || undefined,
          productName: order.product_name,
          quantity: order.quantity,
          pickupCode: order.pickup_code,
          originalOrder: order,
        });
      }

      // Sort by created_at descending
      unified.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
      setUnifiedOrders(unified);
    } catch (error) {
      console.error('[AdminProducerOrders] Error fetching producer orders:', error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [producerId, statusFilter, loadOrdersForProducer, getAccessToken, callDirectSaleOrders]);

  useEffect(() => {
    if (producerId) {
      fetchOrders();
    }
  }, [fetchOrders, producerId]);

  // Auto-refresh when screen comes into focus (helps with sync issues on Android)
  useFocusEffect(
    useCallback(() => {
      if (producerId) {
        fetchOrders(false); // Don't show loading indicator for background refresh
      }
    }, [producerId, fetchOrders])
  );

  // Fetch order details (lines + customer info)
  const fetchOrderDetails = async (order: DirectSaleOrder) => {
    setDetailsLoading(true);
    setSelectedOrder(order);

    try {
      const result = await callDirectSaleOrders<DirectSaleOrderDetailsResponse>({ action: 'details', orderId: order.id });
      if (result?.order) {
        setSelectedOrder(result.order);
      }
      setOrderLines(Array.isArray(result?.lines) ? result.lines : []);
      setCustomerInfo(result?.customer || null);
    } catch (error) {
      console.error('Error fetching order details:', error);
    } finally {
      setDetailsLoading(false);
    }
  };

  // Update order status
  const updateOrderStatus = async (newStatus: OrderStatus) => {
    if (!selectedOrder) return;

    setUpdatingStatus(true);

    try {
      const result = await callDirectSaleOrders<DirectSaleOrderUpdateResponse>({
        action: 'updateStatus',
        orderId: selectedOrder.id,
        status: newStatus,
      });

      const accessToken = await getAccessToken();
      if (accessToken) {
        try {
          await fetch(`${SUPABASE_URL}/functions/v1/notify-order-status`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${accessToken}`,
            },
            body: JSON.stringify({
              commandeId: selectedOrder.id,
              newStatus,
              userId: selectedOrder.user_id,
              producerId: selectedOrder.producer_id,
            }),
          });
        } catch (emailError) {
          console.error('Error sending notification email:', emailError);
        }
      }

      const updatedOrder = result?.order ? result.order : { ...selectedOrder, statut: newStatus };
      setSelectedOrder(updatedOrder);
      setUnifiedOrders((prev) =>
        prev.map((order) =>
          order.type === 'direct_sale' && order.id === selectedOrder.id
            ? {
                ...order,
                status: newStatus,
                statusLabel: STATUS_CONFIG[newStatus].label,
                statusColor: STATUS_CONFIG[newStatus].color,
                originalOrder: { ...(order.originalOrder as DirectSaleOrder), statut: newStatus },
              }
            : order
        )
      );
    } catch (error) {
      console.error('Error updating order status:', error);
    } finally {
      setUpdatingStatus(false);
    }
  };

  const onRefresh = () => {
    setRefreshing(true);
    fetchOrders(false);
  };

  const closeDetails = () => {
    setSelectedOrder(null);
    setOrderLines([]);
    setCustomerInfo(null);
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('fr-FR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  // Count orders by status (from unified orders)
  const pendingCount = unifiedOrders.filter((o) =>
    o.status === 'en_attente' || o.status === 'pending'
  ).length;

  // No producer linked
  if (!producerId && !loading) {
    return (
      <View className="flex-1 items-center justify-center py-12 px-4">
        <AlertTriangle size={48} color={COLORS.accent.red} strokeWidth={1.5} />
        <Text className="mt-4 text-center text-lg font-bold" style={{ color: COLORS.text.cream }}>
          Aucun producteur lié
        </Text>
        <Text className="mt-2 text-center" style={{ color: COLORS.text.lightGray }}>
          Votre compte n'est pas encore associé à un producteur. Contactez un administrateur pour faire le lien.
        </Text>
      </View>
    );
  }

  if (loading) {
    return (
      <View className="flex-1 items-center justify-center py-12">
        <ActivityIndicator size="large" color={COLORS.primary.gold} />
        <Text className="mt-4" style={{ color: COLORS.text.lightGray }}>
          Chargement des commandes...
        </Text>
      </View>
    );
  }

  return (
    <View className="flex-1">
      {/* Header with stats */}
      <View className="mb-4 p-4 rounded-xl" style={{ backgroundColor: 'rgba(90, 158, 90, 0.1)' }}>
        <View className="flex-row items-center justify-between">
          <View className="flex-row items-center">
            <ShoppingBag size={24} color={COLORS.accent.hemp} />
            <Text className="ml-3 text-lg font-bold" style={{ color: COLORS.text.cream }}>
              Mes commandes vente directe
            </Text>
          </View>
          {pendingCount > 0 && (
            <View className="px-3 py-1 rounded-full" style={{ backgroundColor: '#f59e0b' }}>
              <Text className="text-xs font-bold text-white">
                {pendingCount} en attente
              </Text>
            </View>
          )}
        </View>
      </View>

      {/* Status filter */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        className="mb-4"
        contentContainerStyle={{ paddingHorizontal: 4 }}
      >
        {STATUS_FILTERS.map((filter) => (
          <Pressable
            key={filter.value}
            onPress={() => setStatusFilter(filter.value)}
            className="mr-2 px-4 py-2 rounded-full flex-row items-center"
            style={{
              backgroundColor:
                statusFilter === filter.value ? COLORS.primary.gold : 'rgba(255, 255, 255, 0.06)',
            }}
          >
            <Filter
              size={14}
              color={statusFilter === filter.value ? COLORS.text.white : COLORS.text.muted}
            />
            <Text
              className="ml-2 text-sm font-medium"
              style={{
                color: statusFilter === filter.value ? COLORS.text.white : COLORS.text.muted,
              }}
            >
              {filter.label}
            </Text>
          </Pressable>
        ))}
      </ScrollView>

      {/* Orders list */}
      <ScrollView
        className="flex-1"
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={COLORS.primary.gold}
          />
        }
        contentContainerStyle={{ paddingBottom: 100 }}
      >
        {unifiedOrders.length === 0 ? (
          <View className="items-center justify-center py-12">
            <ShoppingBag size={48} color={COLORS.text.muted} strokeWidth={1.5} />
            <Text className="mt-4 text-center" style={{ color: COLORS.text.lightGray }}>
              Aucune commande {statusFilter !== 'all' ? STATUS_CONFIG[statusFilter].label.toLowerCase() : ''}
            </Text>
          </View>
        ) : (
          unifiedOrders.map((order) => {
            const isLocalMarket = order.type === 'local_market';
            return (
              <Pressable
                key={order.id}
                onPress={() => {
                  if (isLocalMarket) {
                    setSelectedLocalOrder(order.originalOrder as LocalMarketOrder);
                  } else {
                    fetchOrderDetails(order.originalOrder as DirectSaleOrder);
                  }
                }}
                className="mb-3 p-4 rounded-xl"
                style={{ backgroundColor: 'rgba(255, 255, 255, 0.08)' }}
              >
                <View className="flex-row items-center justify-between mb-3">
                  <View className="flex-row items-center">
                    <View
                      className="w-4 h-4 rounded-full mr-2"
                      style={{ backgroundColor: order.statusColor }}
                    />
                    <Text className="font-bold" style={{ color: order.statusColor }}>
                      {order.statusLabel}
                    </Text>
                    {isLocalMarket && (
                      <View
                        className="ml-2 px-2 py-0.5 rounded"
                        style={{ backgroundColor: 'rgba(232, 148, 90, 0.19)' }}
                      >
                        <Text className="text-xs" style={{ color: COLORS.primary.orange }}>
                          Direct
                        </Text>
                      </View>
                    )}
                  </View>
                  <Text className="text-xs" style={{ color: COLORS.text.muted }}>
                    #{formatOrderId(order.id)}
                  </Text>
                </View>

                {/* Show product name and pickup code for local market orders */}
                {isLocalMarket && order.productName && (
                  <View className="mb-2">
                    <Text className="text-sm" style={{ color: COLORS.text.cream }}>
                      {order.productName} x{order.quantity}
                    </Text>
                    {order.pickupCode && (
                      <View className="flex-row items-center mt-1">
                        <Hash size={12} color={COLORS.primary.gold} />
                        <Text className="ml-1 text-xs font-mono font-bold" style={{ color: COLORS.primary.gold }}>
                          Code: {order.pickupCode}
                        </Text>
                      </View>
                    )}
                  </View>
                )}

                {!isLocalMarket && order.pickupCode && (
                  <View className="mb-2 flex-row items-center">
                    <Hash size={12} color={COLORS.primary.gold} />
                    <Text className="ml-1 text-xs font-mono font-bold" style={{ color: COLORS.primary.gold }}>
                      Code: {order.pickupCode}
                    </Text>
                  </View>
                )}

                {/* Customer info for local market */}
                {isLocalMarket && order.customerName && (
                  <View className="flex-row items-center mb-2">
                    <User size={12} color={COLORS.text.muted} />
                    <Text className="ml-1 text-xs" style={{ color: COLORS.text.lightGray }}>
                      {order.customerName}
                    </Text>
                  </View>
                )}

                <View className="flex-row items-center justify-between">
                  <View>
                    <Text className="text-sm" style={{ color: COLORS.text.lightGray }}>
                      {formatDate(order.created_at)}
                    </Text>
                    <Text className="text-lg font-bold mt-1" style={{ color: COLORS.primary.gold }}>
                      {order.total.toFixed(2)}€
                    </Text>
                  </View>
                  <ChevronRight size={20} color={COLORS.text.muted} />
                </View>
              </Pressable>
            );
          })
        )}
      </ScrollView>

      {/* Order Details Modal */}
      <Modal
        visible={selectedOrder !== null}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={closeDetails}
      >
        <View className="flex-1" style={{ backgroundColor: COLORS.background.nightSky }}>
          {/* Modal Header */}
          <View
            className="flex-row items-center justify-between px-4 py-4 border-b"
            style={{ borderBottomColor: 'rgba(255, 255, 255, 0.06)' }}
          >
            <Text className="text-xl font-bold" style={{ color: COLORS.text.cream }}>
              Détails commande
            </Text>
            <Pressable onPress={closeDetails} className="p-2">
              <X size={24} color={COLORS.text.cream} />
            </Pressable>
          </View>

          {detailsLoading ? (
            <View className="flex-1 items-center justify-center">
              <ActivityIndicator size="large" color={COLORS.primary.gold} />
            </View>
          ) : selectedOrder ? (
            <ScrollView className="flex-1 px-4 pt-4" contentContainerStyle={{ paddingBottom: 100 }}>
              {/* Order Info */}
              <View className="mb-4 p-4 rounded-xl" style={{ backgroundColor: 'rgba(255, 255, 255, 0.05)' }}>
                <View className="flex-row items-center justify-between mb-3">
                  <Text className="font-bold" style={{ color: COLORS.text.cream }}>
                    #{formatOrderId(selectedOrder.id)}
                  </Text>
                  <View
                    className="px-3 py-1 rounded-full flex-row items-center"
                    style={{ backgroundColor: `${STATUS_CONFIG[selectedOrder.statut].color}20` }}
                  >
                    {STATUS_CONFIG[selectedOrder.statut].icon}
                    <Text
                      className="ml-2 text-xs font-bold"
                      style={{ color: STATUS_CONFIG[selectedOrder.statut].color }}
                    >
                      {STATUS_CONFIG[selectedOrder.statut].label}
                    </Text>
                  </View>
                </View>
                <Text className="text-sm" style={{ color: COLORS.text.lightGray }}>
                  {formatDate(selectedOrder.created_at)}
                </Text>
              </View>

              {selectedOrder.pickup_code && (
                <View className="mb-4 p-4 rounded-xl items-center" style={{ backgroundColor: 'rgba(212, 168, 83, 0.1)', borderWidth: 2, borderColor: COLORS.primary.gold }}>
                  <Text className="text-sm mb-1" style={{ color: COLORS.text.muted }}>
                    Code de retrait
                  </Text>
                  <Text className="text-3xl font-bold font-mono tracking-widest" style={{ color: COLORS.primary.gold }}>
                    {selectedOrder.pickup_code}
                  </Text>
                </View>
              )}

              {/* Customer Info */}
              <View className="mb-4 p-4 rounded-xl" style={{ backgroundColor: 'rgba(255, 255, 255, 0.05)' }}>
                <Text className="font-bold mb-3" style={{ color: COLORS.accent.hemp }}>
                  Informations client
                </Text>
                {customerInfo ? (
                  <View className="space-y-2">
                    <View className="flex-row items-center">
                      <User size={16} color={COLORS.text.muted} />
                      <Text className="ml-3" style={{ color: COLORS.text.cream }}>
                        {customerInfo.first_name || ''} {customerInfo.last_name || 'Client'}
                      </Text>
                    </View>
                    {customerInfo.email && (
                      <View className="flex-row items-center">
                        <Mail size={16} color={COLORS.text.muted} />
                        <Text className="ml-3" style={{ color: COLORS.text.cream }}>
                          {customerInfo.email}
                        </Text>
                      </View>
                    )}
                    {customerInfo.phone && (
                      <View className="flex-row items-center">
                        <Phone size={16} color={COLORS.text.muted} />
                        <Text className="ml-3" style={{ color: COLORS.text.cream }}>
                          {customerInfo.phone}
                        </Text>
                      </View>
                    )}
                  </View>
                ) : (
                  <Text style={{ color: COLORS.text.muted }}>Informations non disponibles</Text>
                )}
              </View>

              {/* Products */}
              <View className="mb-4 p-4 rounded-xl" style={{ backgroundColor: 'rgba(255, 255, 255, 0.05)' }}>
                <Text className="font-bold mb-3" style={{ color: COLORS.accent.hemp }}>
                  Produits commandés
                </Text>
                {orderLines.map((line) => (
                  <View
                    key={line.id}
                    className="flex-row items-center justify-between py-2 border-b"
                    style={{ borderBottomColor: 'rgba(255, 255, 255, 0.06)' }}
                  >
                    <View className="flex-1">
                      <Text style={{ color: COLORS.text.cream }}>{line.product_name}</Text>
                      <Text className="text-xs" style={{ color: COLORS.text.muted }}>
                        {line.prix_unitaire.toFixed(2)}€ x {line.quantite}
                      </Text>
                    </View>
                    <Text className="font-bold" style={{ color: COLORS.primary.gold }}>
                      {line.sous_total.toFixed(2)}€
                    </Text>
                  </View>
                ))}
                <View className="flex-row items-center justify-between pt-3">
                  <Text className="font-bold" style={{ color: COLORS.text.cream }}>
                    Total
                  </Text>
                  <Text className="text-xl font-bold" style={{ color: COLORS.primary.gold }}>
                    {selectedOrder.total.toFixed(2)}€
                  </Text>
                </View>
              </View>

              {/* Pickup Info */}
              <View className="mb-4 p-4 rounded-xl" style={{ backgroundColor: 'rgba(255, 255, 255, 0.05)' }}>
                <Text className="font-bold mb-3" style={{ color: COLORS.accent.hemp }}>
                  Lieu de retrait
                </Text>
                <View className="space-y-2">
                  <View className="flex-row">
                    <MapPin size={16} color={COLORS.text.muted} className="mt-0.5" />
                    <Text className="ml-3 flex-1" style={{ color: COLORS.text.cream }}>
                      {selectedOrder.adresse_retrait}
                    </Text>
                  </View>
                  <View className="flex-row">
                    <Clock size={16} color={COLORS.text.muted} className="mt-0.5" />
                    <Text className="ml-3 flex-1" style={{ color: COLORS.text.cream }}>
                      {selectedOrder.horaires_retrait}
                    </Text>
                  </View>
                  {selectedOrder.instructions_retrait && (
                    <View className="mt-2 p-3 rounded-lg" style={{ backgroundColor: 'rgba(212, 168, 83, 0.06)' }}>
                      <Text className="text-sm" style={{ color: COLORS.text.lightGray }}>
                        {selectedOrder.instructions_retrait}
                      </Text>
                    </View>
                  )}
                </View>
              </View>

              {/* Actions */}
              <View className="mb-4 p-4 rounded-xl" style={{ backgroundColor: 'rgba(255, 255, 255, 0.05)' }}>
                <Text className="font-bold mb-3" style={{ color: COLORS.accent.hemp }}>
                  Actions
                </Text>
                <View className="space-y-2">
                  {selectedOrder.statut === 'en_attente' && (
                    <Pressable
                      onPress={() => updateOrderStatus('confirmee')}
                      disabled={updatingStatus}
                      className="py-3 rounded-xl flex-row items-center justify-center"
                      style={{ backgroundColor: '#3b82f6' }}
                    >
                      {updatingStatus ? (
                        <ActivityIndicator size="small" color="white" />
                      ) : (
                        <>
                          <CheckCircle size={18} color="white" />
                          <Text className="ml-2 font-bold text-white">Confirmer la commande</Text>
                        </>
                      )}
                    </Pressable>
                  )}

                  {selectedOrder.statut === 'confirmee' && (
                    <Pressable
                      onPress={() => updateOrderStatus('prete')}
                      disabled={updatingStatus}
                      className="py-3 rounded-xl flex-row items-center justify-center"
                      style={{ backgroundColor: '#8b5cf6' }}
                    >
                      {updatingStatus ? (
                        <ActivityIndicator size="small" color="white" />
                      ) : (
                        <>
                          <Package size={18} color="white" />
                          <Text className="ml-2 font-bold text-white">Marquer comme prête</Text>
                        </>
                      )}
                    </Pressable>
                  )}

                  {selectedOrder.statut === 'prete' && (
                    <Pressable
                      onPress={() => updateOrderStatus('recuperee')}
                      disabled={updatingStatus}
                      className="py-3 rounded-xl flex-row items-center justify-center"
                      style={{ backgroundColor: '#22c55e' }}
                    >
                      {updatingStatus ? (
                        <ActivityIndicator size="small" color="white" />
                      ) : (
                        <>
                          <UserCheck size={18} color="white" />
                          <Text className="ml-2 font-bold text-white">Marquer comme récupérée</Text>
                        </>
                      )}
                    </Pressable>
                  )}

                  {selectedOrder.statut !== 'recuperee' && selectedOrder.statut !== 'annulee' && (
                    <Pressable
                      onPress={() => updateOrderStatus('annulee')}
                      disabled={updatingStatus}
                      className="py-3 rounded-xl flex-row items-center justify-center"
                      style={{ backgroundColor: 'rgba(199, 91, 91, 0.12)' }}
                    >
                      {updatingStatus ? (
                        <ActivityIndicator size="small" color={COLORS.accent.red} />
                      ) : (
                        <>
                          <XCircle size={18} color={COLORS.accent.red} />
                          <Text className="ml-2 font-bold" style={{ color: COLORS.accent.red }}>
                            Annuler la commande
                          </Text>
                        </>
                      )}
                    </Pressable>
                  )}

                  {(selectedOrder.statut === 'recuperee' || selectedOrder.statut === 'annulee') && (
                    <View className="py-3 px-4 rounded-xl" style={{ backgroundColor: 'rgba(255, 255, 255, 0.03)' }}>
                      <Text className="text-center" style={{ color: COLORS.text.muted }}>
                        Cette commande est {selectedOrder.statut === 'recuperee' ? 'terminée' : 'annulée'}
                      </Text>
                    </View>
                  )}
                </View>
              </View>
            </ScrollView>
          ) : null}
        </View>
      </Modal>

      {/* Local Market Order Details Modal */}
      <Modal
        visible={selectedLocalOrder !== null}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setSelectedLocalOrder(null)}
      >
        <View className="flex-1" style={{ backgroundColor: COLORS.background.nightSky }}>
          {/* Modal Header */}
          <View
            className="flex-row items-center justify-between px-4 py-4 border-b"
            style={{ borderBottomColor: 'rgba(255, 255, 255, 0.06)' }}
          >
            <Text className="text-xl font-bold" style={{ color: COLORS.text.cream }}>
              Commande directe
            </Text>
            <Pressable onPress={() => setSelectedLocalOrder(null)} className="p-2">
              <X size={24} color={COLORS.text.cream} />
            </Pressable>
          </View>

          {selectedLocalOrder && (
            <ScrollView className="flex-1 px-4 pt-4" contentContainerStyle={{ paddingBottom: 100 }}>
              {/* Order Info */}
              <View className="mb-4 p-4 rounded-xl" style={{ backgroundColor: 'rgba(255, 255, 255, 0.05)' }}>
                <View className="flex-row items-center justify-between mb-3">
                  <Text className="font-bold" style={{ color: COLORS.text.cream }}>
                    #{formatOrderId(selectedLocalOrder.id)}
                  </Text>
                  <View
                    className="px-3 py-1 rounded-full"
                    style={{ backgroundColor: `${getStatusColor(selectedLocalOrder.status)}20` }}
                  >
                    <Text
                      className="text-xs font-bold"
                      style={{ color: getStatusColor(selectedLocalOrder.status) }}
                    >
                      {getStatusLabel(selectedLocalOrder.status)}
                    </Text>
                  </View>
                </View>
                <Text className="text-sm" style={{ color: COLORS.text.muted }}>
                  {formatDate(selectedLocalOrder.created_at)}
                </Text>
              </View>

              {/* Pickup Code */}
              <View className="mb-4 p-4 rounded-xl items-center" style={{ backgroundColor: 'rgba(212, 168, 83, 0.1)', borderWidth: 2, borderColor: COLORS.primary.gold }}>
                <Text className="text-sm mb-1" style={{ color: COLORS.text.muted }}>
                  Code de retrait
                </Text>
                <Text className="text-3xl font-bold font-mono tracking-widest" style={{ color: COLORS.primary.gold }}>
                  {selectedLocalOrder.pickup_code}
                </Text>
              </View>

              {/* Customer Info */}
              <View className="mb-4 p-4 rounded-xl" style={{ backgroundColor: 'rgba(255, 255, 255, 0.05)' }}>
                <Text className="font-bold mb-3" style={{ color: COLORS.accent.hemp }}>
                  Client
                </Text>
                <View className="space-y-2">
                  <View className="flex-row items-center">
                    <User size={16} color={COLORS.text.muted} />
                    <Text className="ml-3" style={{ color: COLORS.text.cream }}>
                      {selectedLocalOrder.customer_name}
                    </Text>
                  </View>
                  <View className="flex-row items-center">
                    <Mail size={16} color={COLORS.text.muted} />
                    <Text className="ml-3" style={{ color: COLORS.text.cream }}>
                      {selectedLocalOrder.customer_email}
                    </Text>
                  </View>
                  {selectedLocalOrder.customer_phone && (
                    <View className="flex-row items-center">
                      <Phone size={16} color={COLORS.text.muted} />
                      <Text className="ml-3" style={{ color: COLORS.text.cream }}>
                        {selectedLocalOrder.customer_phone}
                      </Text>
                    </View>
                  )}
                </View>
              </View>

              {/* Product */}
              <View className="mb-4 p-4 rounded-xl" style={{ backgroundColor: 'rgba(255, 255, 255, 0.05)' }}>
                <Text className="font-bold mb-3" style={{ color: COLORS.accent.hemp }}>
                  Produit commandé
                </Text>
                <View className="flex-row items-center justify-between py-2">
                  <View className="flex-1">
                    <Text style={{ color: COLORS.text.cream }}>{selectedLocalOrder.product_name}</Text>
                    <Text className="text-xs" style={{ color: COLORS.text.muted }}>
                      {selectedLocalOrder.unit_price.toFixed(2)}€ x {selectedLocalOrder.quantity}
                    </Text>
                  </View>
                  <Text className="font-bold" style={{ color: COLORS.primary.gold }}>
                    {selectedLocalOrder.total_amount.toFixed(2)}€
                  </Text>
                </View>
              </View>

              {/* Pickup Info */}
              {selectedLocalOrder.pickup_location && (
                <View className="mb-4 p-4 rounded-xl" style={{ backgroundColor: 'rgba(255, 255, 255, 0.05)' }}>
                  <Text className="font-bold mb-3" style={{ color: COLORS.accent.hemp }}>
                    Lieu de retrait
                  </Text>
                  <View className="flex-row">
                    <MapPin size={16} color={COLORS.text.muted} className="mt-0.5" />
                    <Text className="ml-3 flex-1" style={{ color: COLORS.text.cream }}>
                      {selectedLocalOrder.pickup_location}
                    </Text>
                  </View>
                  {selectedLocalOrder.pickup_instructions && (
                    <View className="mt-2 p-3 rounded-lg" style={{ backgroundColor: 'rgba(212, 168, 83, 0.06)' }}>
                      <Text className="text-sm" style={{ color: COLORS.text.lightGray }}>
                        {selectedLocalOrder.pickup_instructions}
                      </Text>
                    </View>
                  )}
                </View>
              )}

              {/* Customer Notes */}
              {selectedLocalOrder.customer_notes && (
                <View className="mb-4 p-4 rounded-xl" style={{ backgroundColor: 'rgba(255, 255, 255, 0.05)' }}>
                  <Text className="font-bold mb-3" style={{ color: COLORS.accent.hemp }}>
                    Notes du client
                  </Text>
                  <Text className="text-sm" style={{ color: COLORS.text.lightGray }}>
                    {selectedLocalOrder.customer_notes}
                  </Text>
                </View>
              )}

              {/* Actions */}
              <View className="mb-4 p-4 rounded-xl" style={{ backgroundColor: 'rgba(255, 255, 255, 0.05)' }}>
                <Text className="font-bold mb-3" style={{ color: COLORS.accent.hemp }}>
                  Actions
                </Text>
                <View className="space-y-2">
                  {selectedLocalOrder.status === 'pending' && (
                    <Pressable
                      onPress={async () => {
                        const accessToken = await getAccessToken();
                        if (!accessToken) return;
                        setUpdatingStatus(true);
                        setLocalOrderError(null);
                        const orderIdentifier = selectedLocalOrder.pickup_code || String(selectedLocalOrder.id);
                        const result = await updateLocalOrderStatus(accessToken, orderIdentifier, 'confirmed');
                        if (result.success) {
                          setSelectedLocalOrder({ ...selectedLocalOrder, status: 'confirmed' });
                          fetchOrders(false);
                        } else {
                          setLocalOrderError(result.error || 'Erreur lors de la mise à jour');
                        }
                        setUpdatingStatus(false);
                      }}
                      disabled={updatingStatus}
                      className="py-3 rounded-xl flex-row items-center justify-center"
                      style={{ backgroundColor: '#3b82f6' }}
                    >
                      {updatingStatus ? (
                        <ActivityIndicator size="small" color="white" />
                      ) : (
                        <>
                          <CheckCircle size={18} color="white" />
                          <Text className="ml-2 font-bold text-white">Confirmer la commande</Text>
                        </>
                      )}
                    </Pressable>
                  )}

                  {selectedLocalOrder.status === 'confirmed' && (
                    <Pressable
                      onPress={async () => {
                        const accessToken = await getAccessToken();
                        if (!accessToken) return;
                        setUpdatingStatus(true);
                        setLocalOrderError(null);
                        const orderIdentifier = selectedLocalOrder.pickup_code || String(selectedLocalOrder.id);
                        const result = await updateLocalOrderStatus(accessToken, orderIdentifier, 'ready');
                        if (result.success) {
                          setSelectedLocalOrder({ ...selectedLocalOrder, status: 'ready' });
                          fetchOrders(false);
                        } else {
                          setLocalOrderError(result.error || 'Erreur lors de la mise à jour');
                        }
                        setUpdatingStatus(false);
                      }}
                      disabled={updatingStatus}
                      className="py-3 rounded-xl flex-row items-center justify-center"
                      style={{ backgroundColor: '#8b5cf6' }}
                    >
                      {updatingStatus ? (
                        <ActivityIndicator size="small" color="white" />
                      ) : (
                        <>
                          <Package size={18} color="white" />
                          <Text className="ml-2 font-bold text-white">Marquer comme prête</Text>
                        </>
                      )}
                    </Pressable>
                  )}

                  {selectedLocalOrder.status === 'ready' && (
                    <Pressable
                      onPress={async () => {
                        const accessToken = await getAccessToken();
                        if (!accessToken) return;
                        setUpdatingStatus(true);
                        setLocalOrderError(null);
                        const orderIdentifier = selectedLocalOrder.pickup_code || String(selectedLocalOrder.id);
                        const result = await updateLocalOrderStatus(accessToken, orderIdentifier, 'completed');
                        if (result.success) {
                          setSelectedLocalOrder({ ...selectedLocalOrder, status: 'completed' });
                          fetchOrders(false);
                        } else {
                          setLocalOrderError(result.error || 'Erreur lors de la mise à jour');
                        }
                        setUpdatingStatus(false);
                      }}
                      disabled={updatingStatus}
                      className="py-3 rounded-xl flex-row items-center justify-center"
                      style={{ backgroundColor: '#22c55e' }}
                    >
                      {updatingStatus ? (
                        <ActivityIndicator size="small" color="white" />
                      ) : (
                        <>
                          <UserCheck size={18} color="white" />
                          <Text className="ml-2 font-bold text-white">Marquer comme récupérée</Text>
                        </>
                      )}
                    </Pressable>
                  )}

                  {selectedLocalOrder.status !== 'completed' && selectedLocalOrder.status !== 'cancelled' && (
                    <Pressable
                      onPress={async () => {
                        const accessToken = await getAccessToken();
                        if (!accessToken) return;
                        setUpdatingStatus(true);
                        setLocalOrderError(null);
                        const orderIdentifier = selectedLocalOrder.pickup_code || String(selectedLocalOrder.id);
                        const result = await updateLocalOrderStatus(accessToken, orderIdentifier, 'cancelled');
                        if (result.success) {
                          setSelectedLocalOrder({ ...selectedLocalOrder, status: 'cancelled' });
                          fetchOrders(false);
                        } else {
                          setLocalOrderError(result.error || 'Erreur lors de la mise à jour');
                        }
                        setUpdatingStatus(false);
                      }}
                      disabled={updatingStatus}
                      className="py-3 rounded-xl flex-row items-center justify-center"
                      style={{ backgroundColor: 'rgba(199, 91, 91, 0.12)' }}
                    >
                      {updatingStatus ? (
                        <ActivityIndicator size="small" color={COLORS.accent.red} />
                      ) : (
                        <>
                          <XCircle size={18} color={COLORS.accent.red} />
                          <Text className="ml-2 font-bold" style={{ color: COLORS.accent.red }}>
                            Annuler la commande
                          </Text>
                        </>
                      )}
                    </Pressable>
                  )}

                  {(selectedLocalOrder.status === 'completed' || selectedLocalOrder.status === 'cancelled') && (
                    <View className="py-3 px-4 rounded-xl" style={{ backgroundColor: 'rgba(255, 255, 255, 0.03)' }}>
                      <Text className="text-center" style={{ color: COLORS.text.muted }}>
                        Cette commande est {selectedLocalOrder.status === 'completed' ? 'terminée' : 'annulée'}
                      </Text>
                    </View>
                  )}

                  {localOrderError && (
                    <View className="mt-3 px-3 py-2 rounded-lg" style={{ backgroundColor: 'rgba(255, 107, 107, 0.12)' }}>
                      <Text className="text-sm" style={{ color: COLORS.accent.red }}>
                        {localOrderError}
                      </Text>
                    </View>
                  )}
                </View>
              </View>
            </ScrollView>
          )}
        </View>
      </Modal>
    </View>
  );
}
