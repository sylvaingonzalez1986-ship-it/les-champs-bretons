/**
 * Écran Gestion des Commandes
 * Pour admin, pro et producteur
 * - Liste des commandes avec filtres (période, recherche)
 * - Détails commande avec génération facture PDF
 * - Export CSV/PDF
 */

import React, { useState, useMemo, useEffect, useCallback } from 'react';
import {
  View,
  ScrollView,
  Pressable,
  TextInput,
  Alert,
  ActivityIndicator,
  Platform,
} from 'react-native';
import { Skeleton, Text } from '@/components/ui';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import {
  ArrowLeft,
  Search,
  Download,
  FileText,
  Calendar,
  ChevronDown,
  ChevronUp,
  Eye,
  Printer,
  Mail,
  Store,
  Phone,
  Users,
  Truck,
  MapPin,
} from 'lucide-react-native';
import { router } from 'expo-router';
import { COLORS, withOpacity } from '@/lib/colors';
import { useOrdersStore, Order, ORDER_STATUS_CONFIG, useProducerStore, useSupabaseSyncStore } from '@/lib/store';
import { getStatusLabel, getStatusColor, type LocalMarketOrder } from '@/lib/local-market-orders';
import { usePermissions, useAuth } from '@/lib/useAuth';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '@/lib/supabase-auth';
import { useQueryClient } from '@tanstack/react-query';
import { useMyProducerQuery, useProducerLocalOrdersQuery, useProducerProOrdersQuery, useUserOrdersQuery } from '@/api/orders';
import { useLocalMarketOrdersInfinite } from '@/api/local-market';
import * as Haptics from 'expo-haptics';
import Animated, { FadeInDown } from 'react-native-reanimated';
import * as Sharing from 'expo-sharing';
import * as FileSystem from 'expo-file-system';
import * as Print from 'expo-print';
import * as MailComposer from 'expo-mail-composer';
import { getSafeMailtoUrl, getSafeTelUrl, safeOpenExternalUrl } from '@/lib/safe-linking';
import { useOrderQueueStore } from '@/lib/order-queue-store';
import { isSupabaseSyncConfigured } from '@/lib/supabase-sync';
import { getProducerDisplayName, Producer, SAMPLE_PRODUCERS } from '@/lib/producers';
import { Toast, useToast } from '@/components/Toast';

type PeriodFilter = 'all' | '1month' | '3months' | '6months' | '12months';
type GestionMode = 'producer' | 'pro' | 'admin';

const PERIOD_FILTERS: { value: PeriodFilter; label: string }[] = [
  { value: 'all', label: 'Depuis le départ' },
  { value: '1month', label: 'Dernier mois' },
  { value: '3months', label: '3 derniers mois' },
  { value: '6months', label: '6 derniers mois' },
  { value: '12months', label: '12 derniers mois' },
];

const PAYMENT_LINK_EMAIL = 'leschanvriersunis@gmail.com';

export default function GestionCommandesScreen({ mode }: { mode?: GestionMode }) {
  const insets = useSafeAreaInsets();
  const { isAdmin, isPro, isProducer } = usePermissions();
  const { session, profile } = useAuth();
  const ordersFromStore = useOrdersStore((s) => s.orders);
  const updateOrderStatus = useOrdersStore((s) => s.updateOrderStatus);
  const queryClient = useQueryClient();

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedPeriod, setSelectedPeriod] = useState<PeriodFilter>('all');
  const [showPeriodPicker, setShowPeriodPicker] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [isRequestingPaymentLink, setIsRequestingPaymentLink] = useState(false);
  const [showSuppliers, setShowSuppliers] = useState(false);
  const [producerOrdersView, setProducerOrdersView] = useState<'pro' | 'local'>('pro');
  const { toast, showToast, hideToast } = useToast();
  const { data: myProducer } = useMyProducerQuery();
  const producerId = myProducer?.id ?? '';
  const {
    data: producerProOrders = [],
    isLoading: isLoadingProOrders,
  } = useProducerProOrdersQuery(producerId);

  const roleMode: GestionMode | 'client' = mode ?? (isProducer ? 'producer' : isPro ? 'pro' : isAdmin ? 'admin' : 'client');
  const isProducerMode = roleMode === 'producer';
  const isProMode = roleMode === 'pro';
  const isAdminMode = roleMode === 'admin';

  const shouldLoadUserOrders = (isAdminMode || isProMode) && isSupabaseSyncConfigured();
  const {
    data: userOrders = [],
    isLoading: isLoadingUserOrders,
  } = useUserOrdersQuery(shouldLoadUserOrders);
  const {
    data: producerLocalOrders = [],
    isLoading: isLoadingLocalOrders,
  } = useProducerLocalOrdersQuery(producerId, session?.access_token ?? '');

  const {
    data: localMarketPages,
    isFetching: isLocalMarketFetching,
  } = useLocalMarketOrdersInfinite(
    isAdminMode || isProMode ? session?.user?.id : undefined,
    isAdminMode || isProMode ? session?.access_token : undefined,
    200
  );

  const localMarketOrders = useMemo(
    () => localMarketPages?.pages.flat() ?? [],
    [localMarketPages]
  );

  const pendingOrders = useOrderQueueStore((s) => s.pendingOrders);
  const customProducers = useProducerStore((s) => s.producers);
  const syncedProducers = useSupabaseSyncStore((s) => s.syncedProducers);
  const pendingOrdersForDisplay = useMemo(
    () =>
      pendingOrders
        .filter((pending) => pending.status === 'pending' || pending.status === 'failed')
        .map((pending) => pending.order),
    [pendingOrders]
  );
  const pendingOrderIds = useMemo(
    () => new Set(pendingOrdersForDisplay.map((order) => order.id)),
    [pendingOrdersForDisplay]
  );

  const suppliersListMax = 8;
  const supplierContacts = useMemo(() => {
    if (!isProMode) return [] as Array<{
      id: string;
      name: string;
      email?: string;
      phone?: string;
      city?: string;
      region?: string;
    }>;

    let baseProducers: Producer[] = [];
    if (isAdminMode) {
      const customIds = new Set(customProducers.map((producer) => producer.id));
      const filteredSamples = SAMPLE_PRODUCERS.filter((producer) => !customIds.has(producer.id));
      baseProducers = [...customProducers, ...filteredSamples];
    } else if (syncedProducers.length > 0) {
      baseProducers = syncedProducers;
    } else {
      const customIds = new Set(customProducers.map((producer) => producer.id));
      const filteredSamples = SAMPLE_PRODUCERS.filter((producer) => !customIds.has(producer.id));
      baseProducers = [...customProducers, ...filteredSamples];
    }

    const unique = new Map<string, Producer>();
    baseProducers.forEach((producer) => {
      if (!unique.has(producer.id)) {
        unique.set(producer.id, producer);
      }
    });

    return Array.from(unique.values()).map((producer) => ({
      id: producer.id,
      name: getProducerDisplayName(producer),
      email: producer.email?.trim() || undefined,
      phone: producer.phone?.trim() || undefined,
      city: producer.city?.trim() || undefined,
      region: producer.region?.trim() || undefined,
    }));
  }, [customProducers, isAdminMode, isProMode, syncedProducers]);

  const openSupplierMail = useCallback(async (email?: string) => {
    if (!email) {
      showToast('Contact indisponible', 'warning');
      return;
    }
    const mailUrl = getSafeMailtoUrl(email);
    if (!mailUrl) {
      showToast('Contact indisponible', 'warning');
      return;
    }
    const opened = await safeOpenExternalUrl(mailUrl, { allowMailto: true });
    if (!opened) {
      showToast('Contact indisponible', 'warning');
    }
  }, [showToast]);

  const openSupplierTel = useCallback(async (phone?: string) => {
    if (!phone) {
      showToast('Contact indisponible', 'warning');
      return;
    }
    const telUrl = getSafeTelUrl(phone);
    if (!telUrl) {
      showToast('Contact indisponible', 'warning');
      return;
    }
    const opened = await safeOpenExternalUrl(telUrl, { allowTel: true });
    if (!opened) {
      showToast('Contact indisponible', 'warning');
    }
  }, [showToast]);

  // Vérifier les permissions
  const hasAccess = isAdminMode || isProMode || isProducerMode;

  const isLoadingOrders = isProducerMode
    ? isLoadingProOrders || isLoadingLocalOrders
    : isLocalMarketFetching || (shouldLoadUserOrders && isLoadingUserOrders);

  const convertLocalOrders = useCallback((orders: LocalMarketOrder[]): Order[] => (
    orders.map((lo) => ({
      id: String(lo.id),
      customerInfo: {
        firstName: lo.customer_name.split(' ')[0] || lo.customer_name,
        lastName: lo.customer_name.split(' ').slice(1).join(' ') || '',
        email: lo.customer_email,
        phone: lo.customer_phone || '',
        address: lo.delivery_method === 'shipping'
          ? lo.delivery_address || ''
          : lo.pickup_location || '',
        postalCode: '',
        city: '',
      },
      items: [{
        productId: lo.product_id,
        productName: lo.product_name,
        productType: 'fleur' as const,
        producerId: lo.producer_id,
        producerName: lo.producer_name,
        quantity: lo.quantity,
        unitPrice: lo.unit_price,
        totalPrice: lo.total_amount,
        tvaRate: 20,
      }],
      subtotal: lo.total_amount - (lo.delivery_method === 'shipping' ? (lo.delivery_fee || 0) : 0),
      shippingFee: lo.delivery_method === 'shipping' ? (lo.delivery_fee || 0) : 0,
      total: lo.total_amount,
      status: (lo.status === 'completed' ? 'shipped' : lo.status === 'cancelled' ? 'cancelled' : 'pending') as Order['status'],
      createdAt: new Date(lo.created_at).getTime(),
      updatedAt: new Date(lo.updated_at).getTime(),
      notes: lo.customer_notes || lo.producer_notes || undefined,
      isProOrder: false,
      deliveryMethod: lo.delivery_method || 'pickup',
    }))
  ), []);

  const producerLocalOrdersConverted = useMemo(
    () => convertLocalOrders(producerLocalOrders),
    [convertLocalOrders, producerLocalOrders]
  );

  // Combiner les commandes boutique et marché local
  const allOrders = useMemo(() => {
    // Pour les producteurs, utiliser producerLocalOrders et producerProOrders
    // Pour admin/pro, utiliser localMarketOrders et ordersFromStore
    const localOrdersSource = isProducerMode ? producerLocalOrders : localMarketOrders;
    const baseProOrdersSource = isProducerMode
      ? producerProOrders
      : shouldLoadUserOrders
        ? userOrders
        : ordersFromStore;

    const proOrdersSource = isProducerMode
      ? baseProOrdersSource
      : [
          ...baseProOrdersSource,
          ...pendingOrdersForDisplay.filter(
            (pending) => !baseProOrdersSource.some((order) => order.id === pending.id)
          ),
        ];

    const localOrdersConverted = convertLocalOrders(localOrdersSource);

    return [...proOrdersSource, ...localOrdersConverted];
  }, [
    ordersFromStore,
    localMarketOrders,
    producerLocalOrders,
    producerProOrders,
    convertLocalOrders,
    isProducerMode,
    shouldLoadUserOrders,
    userOrders,
    pendingOrdersForDisplay,
  ]);

  const filterOrders = useCallback((orders: Order[]) => {
    const periodFiltered = (() => {
      if (selectedPeriod === 'all') return orders;

      const now = Date.now();
      const periodMs = {
        '1month': 30 * 24 * 60 * 60 * 1000,
        '3months': 90 * 24 * 60 * 60 * 1000,
        '6months': 180 * 24 * 60 * 60 * 1000,
        '12months': 365 * 24 * 60 * 60 * 1000,
      }[selectedPeriod];

      return orders.filter((order) => now - order.createdAt <= periodMs);
    })();

    if (!searchQuery.trim()) return periodFiltered;

    const query = searchQuery.toLowerCase();
    return periodFiltered.filter((order) => {
      const matchId = order.id.toLowerCase().includes(query);
      const matchCustomer =
        order.customerInfo.firstName?.toLowerCase().includes(query) ||
        order.customerInfo.lastName?.toLowerCase().includes(query) ||
        order.customerInfo.email?.toLowerCase().includes(query);
      const matchStatus = ORDER_STATUS_CONFIG[order.status].label.toLowerCase().includes(query);
      const matchProducts = order.items.some(
        (item) =>
          item.productName.toLowerCase().includes(query) ||
          item.producerName.toLowerCase().includes(query)
      );

      return matchId || matchCustomer || matchStatus || matchProducts;
    });
  }, [searchQuery, selectedPeriod]);

  const filteredOrders = useMemo(
    () => filterOrders(allOrders),
    [allOrders, filterOrders]
  );

  const filteredProducerProOrders = useMemo(
    () => filterOrders(producerProOrders),
    [filterOrders, producerProOrders]
  );

  const filteredProducerLocalOrders = useMemo(
    () => filterOrders(producerLocalOrdersConverted),
    [filterOrders, producerLocalOrdersConverted]
  );

  const computeStats = useCallback((orders: Order[]) => {
    const total = orders.length;
    const totalRevenue = orders.reduce((sum, order) => sum + order.total, 0);
    const pending = orders.filter((o) => o.status === 'pending').length;
    const completed = orders.filter((o) => o.status === 'shipped').length;

    // Calcul TVA cumulée - utilise le taux de chaque item ou 20% par défaut
    const totalTVA = orders.reduce((sum, order) => {
      const orderTVA = order.items.reduce((itemSum, item) => {
        const tvaRate = (item.tvaRate ?? 20) / 100;
        const tva = item.totalPrice - (item.totalPrice / (1 + tvaRate));
        return itemSum + tva;
      }, 0);
      return sum + orderTVA;
    }, 0);

    const totalHT = totalRevenue - totalTVA;

    return { total, totalRevenue, pending, completed, totalTVA, totalHT };
  }, []);

  // Statistiques
  const stats = useMemo(() => computeStats(filteredOrders), [computeStats, filteredOrders]);
  const producerProStats = useMemo(
    () => computeStats(filteredProducerProOrders),
    [computeStats, filteredProducerProOrders]
  );
  const producerLocalStats = useMemo(
    () => computeStats(filteredProducerLocalOrders),
    [computeStats, filteredProducerLocalOrders]
  );

  // Générer CSV
  const generateCSV = async () => {
    try {
      setIsExporting(true);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

      // En-têtes CSV
      const headers = [
        'ID Commande',
        'Date',
        'Client',
        'Email',
        'Téléphone',
        'Statut',
        'Montant HT',
        'TVA',
        'Montant TTC',
        'Produits',
      ].join(';');

      // Lignes de données
      const rows = filteredOrders.map((order) => {
        const date = new Date(order.createdAt).toLocaleDateString('fr-FR');
        const customer = `${order.customerInfo.firstName} ${order.customerInfo.lastName}`;
        const products = order.items.map((item) => `${item.productName} x${item.quantity}`).join(' | ');

        // Calcul TVA (20% par défaut)
        const tvaRate = 0.20;
        const totalHT = order.total / (1 + tvaRate);
        const totalTVA = order.total - totalHT;

        return [
          order.id,
          date,
          customer,
          order.customerInfo.email || '',
          order.customerInfo.phone || '',
          ORDER_STATUS_CONFIG[order.status].label,
          totalHT.toFixed(2),
          totalTVA.toFixed(2),
          order.total.toFixed(2),
          products,
        ].join(';');
      });

      const csvContent = [headers, ...rows].join('\n');

      // Sur le web, utiliser le téléchargement via blob
      if (Platform.OS === 'web') {
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.setAttribute('href', url);
        link.setAttribute('download', `commandes_${new Date().toISOString().split('T')[0]}.csv`);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
      } else {
        // Sur mobile, sauvegarder et partager
        const fileName = `commandes_${new Date().toISOString().split('T')[0]}.csv`;
        const fileUri = `${FileSystem.documentDirectory}${fileName}`;
        await FileSystem.writeAsStringAsync(fileUri, csvContent, {
          encoding: FileSystem.EncodingType.UTF8,
        });

        if (await Sharing.isAvailableAsync()) {
          await Sharing.shareAsync(fileUri, {
            mimeType: 'text/csv',
            dialogTitle: 'Exporter les commandes',
          });
        } else {
          Alert.alert('Succès', `Fichier sauvegardé: ${fileName}`);
        }
      }
    } catch (error) {
      console.error('[generateCSV]', error);
      Alert.alert('Erreur', "Impossible de générer le fichier CSV");
    } finally {
      setIsExporting(false);
    }
  };

  // Générer PDF liste commandes
  const generatePDFList = async () => {
    try {
      setIsExporting(true);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

      const ordersRows = filteredOrders
        .map(
          (order, index) => `
          <tr style="${index % 2 === 0 ? 'background-color: #f9fafb;' : ''}">
            <td style="padding: 12px; border: 1px solid #e5e7eb;">${order.id.slice(0, 8)}</td>
            <td style="padding: 12px; border: 1px solid #e5e7eb;">${new Date(order.createdAt).toLocaleDateString('fr-FR')}</td>
            <td style="padding: 12px; border: 1px solid #e5e7eb;">${order.customerInfo.firstName} ${order.customerInfo.lastName}</td>
            <td style="padding: 12px; border: 1px solid #e5e7eb;">${ORDER_STATUS_CONFIG[order.status].label}</td>
            <td style="padding: 12px; border: 1px solid #e5e7eb; text-align: right;">${order.total.toFixed(2)} €</td>
          </tr>
        `
        )
        .join('');

      const html = `
        <!DOCTYPE html>
        <html>
          <head>
            <meta charset="utf-8">
            <title>Liste des Commandes</title>
            <style>
              body {
                font-family: 'Helvetica', 'Arial', sans-serif;
                margin: 40px;
                color: #1f2937;
              }
              h1 {
                color: #111827;
                border-bottom: 3px solid #d4af37;
                padding-bottom: 10px;
                margin-bottom: 30px;
              }
              .stats {
                display: flex;
                gap: 20px;
                margin-bottom: 30px;
              }
              .stat-card {
                flex: 1;
                background: #f3f4f6;
                padding: 15px;
                border-radius: 8px;
              }
              .stat-value {
                font-size: 24px;
                font-weight: bold;
                color: #d4af37;
              }
              .stat-label {
                font-size: 14px;
                color: #6b7280;
                margin-top: 5px;
              }
              table {
                width: 100%;
                border-collapse: collapse;
                margin-top: 20px;
              }
              th {
                background-color: #111827;
                color: white;
                padding: 12px;
                text-align: left;
                border: 1px solid #374151;
              }
              td {
                padding: 12px;
                border: 1px solid #e5e7eb;
              }
              .footer {
                margin-top: 40px;
                padding-top: 20px;
                border-top: 1px solid #e5e7eb;
                text-align: center;
                color: #6b7280;
                font-size: 12px;
              }
            </style>
          </head>
          <body>
            <h1>Liste des Commandes</h1>

            <div class="stats">
              <div class="stat-card">
                <div class="stat-value">${stats.total}</div>
                <div class="stat-label">Total commandes</div>
              </div>
              <div class="stat-card">
                <div class="stat-value">${stats.totalRevenue.toFixed(2)} €</div>
                <div class="stat-label">Chiffre d'affaires</div>
              </div>
              <div class="stat-card">
                <div class="stat-value">${stats.pending}</div>
                <div class="stat-label">En attente</div>
              </div>
              <div class="stat-card">
                <div class="stat-value">${stats.completed}</div>
                <div class="stat-label">Complétées</div>
              </div>
            </div>

            <table>
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Date</th>
                  <th>Client</th>
                  <th>Statut</th>
                  <th style="text-align: right;">Montant</th>
                </tr>
              </thead>
              <tbody>
                ${ordersRows}
              </tbody>
            </table>

            <div class="footer">
              <p>Document généré le ${new Date().toLocaleDateString('fr-FR')} à ${new Date().toLocaleTimeString('fr-FR')}</p>
              <p>Les Chanvriers Unis - Gestion des Commandes</p>
            </div>
          </body>
        </html>
      `;

      const { uri } = await Print.printToFileAsync({ html });

      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, {
          mimeType: 'application/pdf',
          dialogTitle: 'Exporter la liste des commandes',
        });
      }
    } catch (error) {
      console.error('[generatePDFList]', error);
      Alert.alert('Erreur', "Impossible de générer le PDF");
    } finally {
      setIsExporting(false);
    }
  };

  // Voir le détail d'une commande
  const viewOrderDetail = (order: Order) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setSelectedOrder(order);
  };

  // Générer facture PDF pour une commande
  // Facture au nom du producteur avec toutes ses informations
  const generateInvoice = async (order: Order) => {
    try {
      setIsExporting(true);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

      // Récupérer les infos complètes du producteur
      // Priorité: profil du producteur connecté > infos depuis Supabase > fallback
      let producerInfo = {
        name: order.items[0]?.producerName || 'Producteur',
        companyName: '',
        siret: '',
        tvaNumber: '',
        address: '',
        postalCode: '',
        city: '',
        phone: '',
        email: '',
      };

      // Si c'est un producteur connecté, utiliser ses propres infos de profil
      if (isProducerMode && profile) {
        producerInfo = {
          name: profile.company_name || profile.business_name || profile.full_name || myProducer?.name || producerInfo.name,
          companyName: profile.company_name || profile.business_name || '',
          siret: profile.siret || '',
          tvaNumber: profile.tva_number || '',
          address: profile.address || '',
          postalCode: profile.postal_code || '',
          city: profile.city || '',
          phone: profile.phone || '',
          email: profile.email || '',
        };
      } else {
        // Sinon, récupérer depuis la table producers + profiles
        const producerId = order.items[0]?.producerId;
        if (producerId && session?.access_token) {
          try {
            // Récupérer le producer avec son profile_id
            const producerResponse = await fetch(
              `${SUPABASE_URL}/rest/v1/producers?id=eq.${producerId}&select=*`,
              {
                headers: {
                  'Content-Type': 'application/json',
                  'apikey': SUPABASE_ANON_KEY,
                  'Authorization': `Bearer ${session.access_token}`,
                },
              }
            );

            if (producerResponse.ok) {
              const producerData = await producerResponse.json();
              if (producerData && producerData[0]) {
                const producer = producerData[0];
                producerInfo.name = producer.name || producerInfo.name;
                producerInfo.siret = producer.siret || '';
                producerInfo.tvaNumber = producer.tva_number || '';
                producerInfo.city = producer.city || '';

                // Si on a un profile_id, récupérer les infos complètes du profil
                if (producer.profile_id) {
                  const profileResponse = await fetch(
                    `${SUPABASE_URL}/rest/v1/profiles?id=eq.${producer.profile_id}&select=*`,
                    {
                      headers: {
                        'Content-Type': 'application/json',
                        'apikey': SUPABASE_ANON_KEY,
                        'Authorization': `Bearer ${session.access_token}`,
                      },
                    }
                  );

                  if (profileResponse.ok) {
                    const profileData = await profileResponse.json();
                    if (profileData && profileData[0]) {
                      const producerProfile = profileData[0];
                      producerInfo.companyName = producerProfile.company_name || producerProfile.business_name || '';
                      producerInfo.siret = producerProfile.siret || producerInfo.siret;
                      producerInfo.tvaNumber = producerProfile.tva_number || producerInfo.tvaNumber;
                      producerInfo.address = producerProfile.address || '';
                      producerInfo.postalCode = producerProfile.postal_code || '';
                      producerInfo.city = producerProfile.city || producerInfo.city;
                      producerInfo.phone = producerProfile.phone || '';
                      producerInfo.email = producerProfile.email || '';
                    }
                  }
                }
              }
            }
          } catch (err) {
          }
        }
      }

      // Construire l'affichage du nom (entreprise prioritaire)
      const displayName = producerInfo.companyName || producerInfo.name;
      const displayAddress = [
        producerInfo.address,
        [producerInfo.postalCode, producerInfo.city].filter(Boolean).join(' ')
      ].filter(Boolean).join(', ');

      const itemsRows = order.items
        .map((item, index) => {
          const tvaRate = item.tvaRate || 20;
          const priceHT = item.unitPrice / (1 + tvaRate / 100);
          const totalHT = priceHT * item.quantity;
          const totalTVA = item.totalPrice - totalHT;

          return `
            <tr style="${index % 2 === 0 ? 'background-color: #f9fafb;' : ''}">
              <td style="padding: 12px; border: 1px solid #e5e7eb;">${item.productName}</td>
              <td style="padding: 12px; border: 1px solid #e5e7eb;">${item.producerName}</td>
              <td style="padding: 12px; border: 1px solid #e5e7eb; text-align: center;">${item.quantity}</td>
              <td style="padding: 12px; border: 1px solid #e5e7eb; text-align: right;">${priceHT.toFixed(2)} €</td>
              <td style="padding: 12px; border: 1px solid #e5e7eb; text-align: center;">${tvaRate}%</td>
              <td style="padding: 12px; border: 1px solid #e5e7eb; text-align: right;">${totalTVA.toFixed(2)} €</td>
              <td style="padding: 12px; border: 1px solid #e5e7eb; text-align: right; font-weight: bold;">${item.totalPrice.toFixed(2)} €</td>
            </tr>
          `;
        })
        .join('');

      // Calculs totaux
      const totalHT = order.items.reduce((sum, item) => {
        const tvaRate = item.tvaRate || 20;
        const priceHT = item.unitPrice / (1 + tvaRate / 100);
        return sum + priceHT * item.quantity;
      }, 0);
      const totalTVA = order.total - totalHT;
      const shippingHT = order.shippingFee / 1.2;
      const shippingTVA = order.shippingFee - shippingHT;

      const html = `
        <!DOCTYPE html>
        <html>
          <head>
            <meta charset="utf-8">
            <title>Facture ${order.id}</title>
            <style>
              body {
                font-family: 'Helvetica', 'Arial', sans-serif;
                margin: 40px;
                color: #1f2937;
              }
              .header {
                display: flex;
                justify-content: space-between;
                margin-bottom: 40px;
                padding-bottom: 20px;
                border-bottom: 3px solid #d4af37;
              }
              .company-info {
                flex: 1;
              }
              .company-name {
                font-size: 24px;
                font-weight: bold;
                color: #111827;
                margin-bottom: 10px;
              }
              .invoice-info {
                text-align: right;
              }
              .invoice-title {
                font-size: 32px;
                font-weight: bold;
                color: #d4af37;
                margin-bottom: 10px;
              }
              .invoice-number {
                font-size: 14px;
                color: #6b7280;
              }
              .customer-section {
                background: #f3f4f6;
                padding: 20px;
                border-radius: 8px;
                margin-bottom: 30px;
              }
              .customer-title {
                font-weight: bold;
                margin-bottom: 10px;
                color: #111827;
              }
              table {
                width: 100%;
                border-collapse: collapse;
                margin: 20px 0;
              }
              th {
                background-color: #111827;
                color: white;
                padding: 12px;
                text-align: left;
                border: 1px solid #374151;
              }
              td {
                padding: 12px;
                border: 1px solid #e5e7eb;
              }
              .totals {
                margin-top: 30px;
                text-align: right;
              }
              .total-row {
                display: flex;
                justify-content: flex-end;
                padding: 8px 0;
              }
              .total-label {
                width: 200px;
                text-align: right;
                padding-right: 20px;
                color: #6b7280;
              }
              .total-value {
                width: 150px;
                text-align: right;
                font-weight: bold;
              }
              .grand-total {
                border-top: 2px solid #d4af37;
                margin-top: 10px;
                padding-top: 10px;
                font-size: 20px;
                color: #d4af37;
              }
              .footer {
                margin-top: 60px;
                padding-top: 20px;
                border-top: 1px solid #e5e7eb;
                text-align: center;
                color: #6b7280;
                font-size: 12px;
              }
              .status-badge {
                display: inline-block;
                padding: 6px 12px;
                border-radius: 6px;
                font-size: 12px;
                font-weight: bold;
                background-color: ${ORDER_STATUS_CONFIG[order.status].color};
                color: white;
              }
            </style>
          </head>
          <body>
            <!-- En-tête avec slogan Les Chanvriers Unis -->
            <div style="text-align: center; margin-bottom: 20px; padding-bottom: 15px; border-bottom: 2px solid #d4af37;">
              <div style="font-size: 28px; font-weight: bold; color: #d4af37;">LES CHANVRIERS UNIS</div>
              <div style="font-size: 14px; color: #6b7280; font-style: italic; margin-top: 5px;">Ensemble pour une filière responsable</div>
            </div>

            <div class="header">
              <div class="company-info">
                <div class="company-name">${displayName}</div>
                <div style="color: #6b7280; font-size: 12px; margin-bottom: 8px;">Producteur partenaire Les Chanvriers Unis</div>
                ${displayAddress ? `<div style="margin-bottom: 4px;">${displayAddress}</div>` : ''}
                ${producerInfo.phone ? `<div style="margin-bottom: 4px;">Tél: ${producerInfo.phone}</div>` : ''}
                ${producerInfo.email ? `<div style="margin-bottom: 4px;">Email: ${producerInfo.email}</div>` : ''}
                <div style="margin-top: 8px; padding-top: 8px; border-top: 1px solid #e5e7eb;">
                  ${producerInfo.siret ? `<div>SIRET: ${producerInfo.siret}</div>` : '<div style="color: #9ca3af;">SIRET: Non renseigné</div>'}
                  ${producerInfo.tvaNumber ? `<div>N° TVA: ${producerInfo.tvaNumber}</div>` : '<div style="color: #9ca3af;">N° TVA: Non renseigné</div>'}
                </div>
              </div>
              <div class="invoice-info">
                <div class="invoice-title">FACTURE</div>
                <div class="invoice-number">N° ${order.id}</div>
                <div class="invoice-number">Date: ${new Date(order.createdAt).toLocaleDateString('fr-FR')}</div>
                <div style="margin-top: 10px;">
                  <span class="status-badge">${ORDER_STATUS_CONFIG[order.status].label}</span>
                </div>
              </div>
            </div>

            <div class="customer-section">
              <div class="customer-title">FACTURÉ À:</div>
              <div><strong>${order.customerInfo.firstName} ${order.customerInfo.lastName}</strong></div>
              ${order.customerInfo.email ? `<div>${order.customerInfo.email}</div>` : ''}
              ${order.customerInfo.phone ? `<div>${order.customerInfo.phone}</div>` : ''}
              ${order.customerInfo.address ? `<div>${order.customerInfo.address}</div>` : ''}
              ${order.customerInfo.postalCode && order.customerInfo.city ? `<div>${order.customerInfo.postalCode} ${order.customerInfo.city}</div>` : ''}
            </div>

            <table>
              <thead>
                <tr>
                  <th>Produit</th>
                  <th>Producteur</th>
                  <th style="text-align: center;">Qté</th>
                  <th style="text-align: right;">Prix HT</th>
                  <th style="text-align: center;">TVA</th>
                  <th style="text-align: right;">Montant TVA</th>
                  <th style="text-align: right;">Total TTC</th>
                </tr>
              </thead>
              <tbody>
                ${itemsRows}
              </tbody>
            </table>

            <div class="totals">
              <div class="total-row">
                <div class="total-label">Sous-total HT:</div>
                <div class="total-value">${totalHT.toFixed(2)} €</div>
              </div>
              <div class="total-row">
                <div class="total-label">TVA produits:</div>
                <div class="total-value">${totalTVA.toFixed(2)} €</div>
              </div>
              <div class="total-row">
                <div class="total-label">Frais de port HT:</div>
                <div class="total-value">${shippingHT.toFixed(2)} €</div>
              </div>
              <div class="total-row">
                <div class="total-label">TVA port (20%):</div>
                <div class="total-value">${shippingTVA.toFixed(2)} €</div>
              </div>
              <div class="total-row grand-total">
                <div class="total-label">TOTAL TTC:</div>
                <div class="total-value">${order.total.toFixed(2)} €</div>
              </div>
            </div>

            ${order.notes ? `
            <div style="margin-top: 30px; padding: 15px; background: #fef3c7; border-left: 4px solid #d4af37; border-radius: 4px;">
              <strong>Notes:</strong>
              <p>${order.notes}</p>
            </div>
            ` : ''}

            ${order.trackingNumber ? `
            <div style="margin-top: 20px; padding: 15px; background: #ecfdf5; border-left: 4px solid #22c55e; border-radius: 4px;">
              <strong>Suivi de commande:</strong>
              <p>Numéro de suivi: ${order.trackingNumber}</p>
            </div>
            ` : ''}

            <div class="footer">
              <p><strong>Conditions de paiement:</strong> Paiement à réception</p>
              <p>En cas de retard de paiement, indemnité forfaitaire pour frais de recouvrement : 40€ (article L.441-6 du code de commerce)</p>
              <p style="margin-top: 20px;">Merci pour votre confiance !</p>
            </div>
          </body>
        </html>
      `;

      const { uri } = await Print.printToFileAsync({ html });

      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, {
          mimeType: 'application/pdf',
          dialogTitle: `Facture ${order.id}`,
        });
      }
    } catch (error) {
      console.error('[generateInvoice]', error);
      Alert.alert('Erreur', "Impossible de générer la facture PDF");
    } finally {
      setIsExporting(false);
    }
  };

  const markPaymentLinkSent = (orderId: string) => {
    updateOrderStatus(orderId, 'payment_sent');
    if (isProducerMode && producerId) {
      queryClient.setQueryData<Order[]>(['orders', 'pro', producerId], (prev) =>
        prev ? prev.map((o) => (o.id === orderId ? { ...o, status: 'payment_sent' } : o)) : prev
      );
    }
    if (!isProducerMode && session?.user?.id) {
      queryClient.setQueryData<Order[]>(['orders', 'user', session.user.id], (prev) =>
        prev ? prev.map((o) => (o.id === orderId ? { ...o, status: 'payment_sent' } : o)) : prev
      );
    }
    setSelectedOrder((prev) => (prev && prev.id === orderId ? { ...prev, status: 'payment_sent' } : prev));
  };

  const requestPaymentLink = async (order: Order) => {
    if (!order.customerInfo.email) {
      Alert.alert('Email manquant', "Ajoutez l'email du client avant d'envoyer un lien de paiement.");
      return;
    }

    if (!order.isProOrder) {
      Alert.alert('Non disponible', "Le lien de paiement est disponible uniquement pour les commandes boutique.");
      return;
    }

    try {
      setIsRequestingPaymentLink(true);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

      const itemsSummary = order.items
        .map(
          (item) =>
            `- ${item.productName} (${item.quantity} x ${item.unitPrice.toFixed(2)}€) = ${item.totalPrice.toFixed(2)}€`
        )
        .join('\n');

      const clientName = `${order.customerInfo.firstName} ${order.customerInfo.lastName}`.trim();
      const emailSubject = `Demande lien de paiement - Commande ${order.id}`;
      const emailBody =
        `DEMANDE LIEN DE PAIEMENT\n` +
        `==========================\n\n` +
        `Commande: ${order.id}\n` +
        `Type: ${order.isProOrder ? 'PRO' : 'CLIENT'}\n` +
        `Montant TTC: ${order.total.toFixed(2)} EUR\n` +
        `Client: ${clientName || 'Non renseigné'}\n` +
        `Email client: ${order.customerInfo.email}\n` +
        `Téléphone: ${order.customerInfo.phone || 'Non renseigné'}\n\n` +
        `PRODUITS\n` +
        `--------\n` +
        `${itemsSummary}\n\n` +
        `Merci d'envoyer le lien de paiement au client à l'adresse ci-dessus.\n` +
        `\n` +
        `Mode DEV - Paiement externe (pas de paiement intégré dans l'app).\n`;

      const isAvailable = await MailComposer.isAvailableAsync();

      if (isAvailable) {
        const result = await MailComposer.composeAsync({
          recipients: [PAYMENT_LINK_EMAIL],
          subject: emailSubject,
          body: emailBody,
        });

        if (result.status !== MailComposer.MailComposerStatus.CANCELLED) {
          markPaymentLinkSent(order.id);
          Alert.alert('Email prêt', "Vérifiez et envoyez l'email pour déclencher le bot.");
        }
        return;
      }

      const mailtoUrl = `mailto:${PAYMENT_LINK_EMAIL}?subject=${encodeURIComponent(emailSubject)}&body=${encodeURIComponent(emailBody)}`;
      const opened = await safeOpenExternalUrl(mailtoUrl, { allowMailto: true });

      if (opened) {
        markPaymentLinkSent(order.id);
        Alert.alert('Email prêt', "Vérifiez et envoyez l'email pour déclencher le bot.");
        return;
      }

      Alert.alert('Erreur', "Impossible d'ouvrir l'email sur cet appareil.");
    } catch (error) {
      Alert.alert('Erreur', "Impossible de préparer l'email de demande de paiement.");
    } finally {
      setIsRequestingPaymentLink(false);
    }
  };

  if (!hasAccess) {
    return (
      <View style={{ flex: 1, backgroundColor: COLORS.background.nightSky }}>
        <LinearGradient
          colors={['#0F0F23', '#1a1a2e']}
          style={{
            paddingTop: insets.top + 20,
            paddingBottom: 20,
            paddingHorizontal: 20,
          }}
        >
          <Pressable
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              router.back();
            }}
            style={{ alignSelf: 'flex-start' }}
          >
            <ArrowLeft size={24} color={COLORS.primary.gold} />
          </Pressable>
        </LinearGradient>
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: 20 }}>
          <Text style={{ fontSize: 18, color: COLORS.text.muted, textAlign: 'center' }}>
            Accès réservé aux administrateurs, pros et producteurs
          </Text>
        </View>
      </View>
    );
  }

  // Modal détail commande
  if (selectedOrder) {
    return (
      <View style={{ flex: 1, backgroundColor: COLORS.background.nightSky }}>
        <LinearGradient
          colors={['#0F0F23', '#1a1a2e']}
          style={{
            paddingTop: insets.top + 20,
            paddingBottom: 20,
            paddingHorizontal: 20,
          }}
        >
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Pressable
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                setSelectedOrder(null);
              }}
            >
              <ArrowLeft size={24} color={COLORS.primary.gold} />
            </Pressable>
            <Text style={{ fontSize: 20, fontWeight: 'bold', color: COLORS.primary.gold }}>
              Détail Commande
            </Text>
            <View style={{ width: 24 }} />
          </View>
        </LinearGradient>

        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 20 }}>
          {/* En-tête commande */}
          <View
            style={{
              backgroundColor: COLORS.background.charcoal,
              borderRadius: 12,
              padding: 20,
              marginBottom: 20,
              borderWidth: 1,
              borderColor: COLORS.primary.gold,
            }}
          >
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 15 }}>
              <View>
                <Text style={{ fontSize: 12, color: COLORS.text.muted, marginBottom: 5 }}>
                  ID Commande
                </Text>
                <Text style={{ fontSize: 14, color: COLORS.text.white, fontFamily: 'monospace' }}>
                  {selectedOrder.id}
                </Text>
              </View>
              <View
                style={{
                  backgroundColor: ORDER_STATUS_CONFIG[selectedOrder.status].color,
                  paddingHorizontal: 12,
                  paddingVertical: 6,
                  borderRadius: 6,
                  alignSelf: 'flex-start',
                }}
              >
                <Text style={{ color: 'white', fontSize: 12, fontWeight: 'bold' }}>
                  {ORDER_STATUS_CONFIG[selectedOrder.status].label}
                </Text>
              </View>
            </View>

            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <View>
                <Text style={{ fontSize: 12, color: COLORS.text.muted, marginBottom: 5 }}>Date</Text>
                <Text style={{ fontSize: 14, color: COLORS.text.white }}>
                  {new Date(selectedOrder.createdAt).toLocaleDateString('fr-FR')}
                </Text>
              </View>
              <View>
                <Text style={{ fontSize: 12, color: COLORS.text.muted, marginBottom: 5 }}>Montant</Text>
                <Text style={{ fontSize: 18, color: COLORS.primary.gold, fontWeight: 'bold' }}>
                  {selectedOrder.total.toFixed(2)} €
                </Text>
              </View>
            </View>
          </View>

          {/* Informations client */}
          <View
            style={{
              backgroundColor: COLORS.background.charcoal,
              borderRadius: 12,
              padding: 20,
              marginBottom: 20,
            }}
          >
            <Text style={{ fontSize: 16, fontWeight: 'bold', color: COLORS.primary.gold, marginBottom: 15 }}>
              Informations Client
            </Text>

            {/* Badge mode de réception */}
            {selectedOrder.deliveryMethod && (
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 8,
                  backgroundColor: selectedOrder.deliveryMethod === 'shipping' ? 'rgba(59, 130, 246, 0.12)' : 'rgba(16, 185, 129, 0.12)',
                  paddingHorizontal: 12,
                  paddingVertical: 8,
                  borderRadius: 8,
                  marginBottom: 15,
                  borderWidth: 1,
                  borderColor: selectedOrder.deliveryMethod === 'shipping' ? 'rgba(59, 130, 246, 0.3)' : 'rgba(16, 185, 129, 0.3)',
                }}
              >
                {selectedOrder.deliveryMethod === 'shipping' ? (
                  <Truck size={16} color="#3B82F6" />
                ) : (
                  <MapPin size={16} color="#10B981" />
                )}
                <Text style={{ fontSize: 13, fontWeight: 'bold', color: selectedOrder.deliveryMethod === 'shipping' ? '#3B82F6' : '#10B981' }}>
                  {selectedOrder.deliveryMethod === 'shipping' ? 'Livraison postale' : 'Retrait sur place'}
                </Text>
              </View>
            )}
            <View style={{ gap: 10 }}>
              <View>
                <Text style={{ fontSize: 12, color: COLORS.text.muted }}>Nom</Text>
                <Text style={{ fontSize: 14, color: COLORS.text.white }}>
                  {selectedOrder.customerInfo.firstName} {selectedOrder.customerInfo.lastName}
                </Text>
              </View>
              {selectedOrder.customerInfo.email && (
                <View>
                  <Text style={{ fontSize: 12, color: COLORS.text.muted }}>Email</Text>
                  <Text style={{ fontSize: 14, color: COLORS.text.white }}>
                    {selectedOrder.customerInfo.email}
                  </Text>
                </View>
              )}
              {selectedOrder.customerInfo.phone && (
                <View>
                  <Text style={{ fontSize: 12, color: COLORS.text.muted }}>Téléphone</Text>
                  <Text style={{ fontSize: 14, color: COLORS.text.white }}>
                    {selectedOrder.customerInfo.phone}
                  </Text>
                </View>
              )}
              {selectedOrder.customerInfo.address && (
                <View>
                  <Text style={{ fontSize: 12, color: COLORS.text.muted }}>Adresse</Text>
                  <Text style={{ fontSize: 14, color: COLORS.text.white }}>
                    {selectedOrder.customerInfo.address}
                  </Text>
                  {selectedOrder.customerInfo.postalCode && selectedOrder.customerInfo.city && (
                    <Text style={{ fontSize: 14, color: COLORS.text.white }}>
                      {selectedOrder.customerInfo.postalCode} {selectedOrder.customerInfo.city}
                    </Text>
                  )}
                </View>
              )}
            </View>
          </View>

          {/* Produits */}
          <View
            style={{
              backgroundColor: COLORS.background.charcoal,
              borderRadius: 12,
              padding: 20,
              marginBottom: 20,
            }}
          >
            <Text style={{ fontSize: 16, fontWeight: 'bold', color: COLORS.primary.gold, marginBottom: 15 }}>
              Produits Commandés
            </Text>
            {selectedOrder.items.map((item, index) => (
              <View
                key={index}
                style={{
                  borderBottomWidth: index < selectedOrder.items.length - 1 ? 1 : 0,
                  borderBottomColor: COLORS.background.nightSky,
                  paddingVertical: 12,
                }}
              >
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 5 }}>
                  <Text style={{ fontSize: 14, color: COLORS.text.white, flex: 1 }}>
                    {item.productName}
                  </Text>
                  <Text style={{ fontSize: 14, color: COLORS.primary.gold, fontWeight: 'bold' }}>
                    {item.totalPrice.toFixed(2)} €
                  </Text>
                </View>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Text style={{ fontSize: 12, color: COLORS.text.muted }}>{item.producerName}</Text>
                  <Text style={{ fontSize: 12, color: COLORS.text.muted }}>
                    Qté: {item.quantity} × {item.unitPrice.toFixed(2)} €
                  </Text>
                </View>
              </View>
            ))}

            {/* Totaux */}
            <View style={{ marginTop: 20, paddingTop: 15, borderTopWidth: 2, borderTopColor: COLORS.primary.gold }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 }}>
                <Text style={{ color: COLORS.text.muted }}>Sous-total</Text>
                <Text style={{ color: COLORS.text.white }}>{selectedOrder.subtotal.toFixed(2)} €</Text>
              </View>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 }}>
                <Text style={{ color: COLORS.text.muted }}>Frais de port</Text>
                <Text style={{ color: COLORS.text.white }}>{selectedOrder.shippingFee.toFixed(2)} €</Text>
              </View>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text style={{ fontSize: 16, fontWeight: 'bold', color: COLORS.primary.gold }}>Total TTC</Text>
                <Text style={{ fontSize: 18, fontWeight: 'bold', color: COLORS.primary.gold }}>
                  {selectedOrder.total.toFixed(2)} €
                </Text>
              </View>
            </View>
          </View>

          {/* Suivi */}
          {selectedOrder.trackingNumber && (
            <View
              style={{
                backgroundColor: COLORS.background.charcoal,
                borderRadius: 12,
                padding: 20,
                marginBottom: 20,
              }}
            >
              <Text style={{ fontSize: 16, fontWeight: 'bold', color: COLORS.primary.gold, marginBottom: 10 }}>
                Suivi de livraison
              </Text>
              <Text style={{ fontSize: 14, color: COLORS.text.white }}>
                Numéro de suivi: {selectedOrder.trackingNumber}
              </Text>
            </View>
          )}

          {/* Notes */}
          {selectedOrder.notes && (
            <View
              style={{
                backgroundColor: COLORS.background.charcoal,
                borderRadius: 12,
                padding: 20,
                marginBottom: 20,
              }}
            >
              <Text style={{ fontSize: 16, fontWeight: 'bold', color: COLORS.primary.gold, marginBottom: 10 }}>
                Notes
              </Text>
              <Text style={{ fontSize: 14, color: COLORS.text.white }}>{selectedOrder.notes}</Text>
            </View>
          )}

          {/* Actions */}
          <View
            style={{
              backgroundColor: COLORS.background.charcoal,
              borderRadius: 12,
              padding: 16,
              marginBottom: 16,
              borderWidth: 1,
              borderColor: `${COLORS.primary.gold}25`,
            }}
          >
            <Text style={{ fontSize: 14, fontWeight: 'bold', color: COLORS.primary.gold, marginBottom: 6 }}>
              Paiement (DEV)
            </Text>
            <Text style={{ fontSize: 13, color: COLORS.text.muted }}>
              Aucun paiement intégré dans l'app. Le lien est envoyé par email via le bot.
            </Text>
          </View>

          <Pressable
            onPress={() => requestPaymentLink(selectedOrder)}
            disabled={isRequestingPaymentLink || !selectedOrder.customerInfo.email}
            style={{
              backgroundColor: COLORS.accent.hemp,
              padding: 16,
              borderRadius: 12,
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 10,
              opacity: isRequestingPaymentLink || !selectedOrder.customerInfo.email ? 0.6 : 1,
              marginBottom: 12,
            }}
          >
            {isRequestingPaymentLink ? (
              <ActivityIndicator color={COLORS.text.white} />
            ) : (
              <>
                <Mail size={20} color={COLORS.text.white} />
                <Text style={{ fontSize: 16, fontWeight: 'bold', color: COLORS.text.white }}>
                  Demander lien de paiement
                </Text>
              </>
            )}
          </Pressable>

          <Pressable
            onPress={() => generateInvoice(selectedOrder)}
            disabled={isExporting}
            style={{
              backgroundColor: COLORS.primary.gold,
              padding: 16,
              borderRadius: 12,
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 10,
            }}
          >
            {isExporting ? (
              <ActivityIndicator color={COLORS.background.nightSky} />
            ) : (
              <>
                <Printer size={20} color={COLORS.background.nightSky} />
                <Text style={{ fontSize: 16, fontWeight: 'bold', color: COLORS.background.nightSky }}>
                  Générer Facture PDF
                </Text>
              </>
            )}
          </Pressable>

          <View style={{ height: insets.bottom + 20 }} />
        </ScrollView>
        <Toast
          visible={toast.visible}
          message={toast.message}
          type={toast.type}
          onHide={hideToast}
          position="top"
        />
      </View>
    );
  }

  // Liste des commandes
  return (
    <View style={{ flex: 1, backgroundColor: COLORS.background.nightSky }}>
      {/* Header */}
      <LinearGradient
        colors={['#0F0F23', '#1a1a2e']}
        style={{
          paddingTop: insets.top + 20,
          paddingBottom: 20,
          paddingHorizontal: 20,
        }}
      >
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <Pressable
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              router.back();
            }}
          >
            <ArrowLeft size={24} color={COLORS.primary.gold} />
          </Pressable>
          <Text style={{ fontSize: 20, fontWeight: 'bold', color: COLORS.primary.gold }}>
            Gestion des Commandes
          </Text>
          <View style={{ width: 24 }} />
        </View>

        {/* Statistiques */}
        <View
          style={{
            flexDirection: 'row',
            flexWrap: 'wrap',
            gap: 8,
            marginBottom: 20,
          }}
        >
          <View style={{ width: '48%', backgroundColor: COLORS.background.charcoal, padding: 12, borderRadius: 8 }}>
            <Text style={{ fontSize: 18, fontWeight: 'bold', color: COLORS.primary.gold }}>
              {stats.total}
            </Text>
            <Text style={{ fontSize: 11, color: COLORS.text.muted }}>Commandes</Text>
          </View>
          <View style={{ width: '48%', backgroundColor: COLORS.background.charcoal, padding: 12, borderRadius: 8 }}>
            <Text style={{ fontSize: 18, fontWeight: 'bold', color: COLORS.primary.gold }}>
              {stats.totalRevenue.toFixed(0)} €
            </Text>
            <Text style={{ fontSize: 11, color: COLORS.text.muted }}>CA TTC</Text>
          </View>
          <View style={{ width: '48%', backgroundColor: COLORS.background.charcoal, padding: 12, borderRadius: 8 }}>
            <Text style={{ fontSize: 18, fontWeight: 'bold', color: '#10B981' }}>
              {stats.totalHT.toFixed(0)} €
            </Text>
            <Text style={{ fontSize: 11, color: COLORS.text.muted }}>CA HT</Text>
          </View>
          <View style={{ width: '48%', backgroundColor: 'rgba(199, 91, 91, 0.15)', padding: 12, borderRadius: 8, borderWidth: 1, borderColor: 'rgba(199, 91, 91, 0.3)' }}>
            <Text style={{ fontSize: 18, fontWeight: 'bold', color: '#C75B5B' }}>
              {stats.totalTVA.toFixed(2)} €
            </Text>
            <Text style={{ fontSize: 11, color: '#C75B5B' }}>TVA due</Text>
          </View>
        </View>

        {/* Barre de recherche */}
        <View
          style={{
            backgroundColor: COLORS.background.charcoal,
            borderRadius: 12,
            flexDirection: 'row',
            alignItems: 'center',
            paddingHorizontal: 15,
            marginBottom: 15,
          }}
        >
          <Search size={20} color={COLORS.text.muted} />
          <TextInput
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholder="Rechercher (ID, client, produit...)"
            placeholderTextColor={COLORS.text.muted}
            style={{
              flex: 1,
              padding: 15,
              color: COLORS.text.white,
              fontSize: 16,
            }}
          />
        </View>

        {/* Filtres */}
        <View style={{ flexDirection: 'row', gap: 10 }}>
          {/* Filtre période */}
          <Pressable
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              setShowPeriodPicker(!showPeriodPicker);
            }}
            style={{
              flex: 1,
              backgroundColor: COLORS.background.charcoal,
              padding: 12,
              borderRadius: 8,
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Calendar size={18} color={COLORS.primary.gold} />
              <Text style={{ color: COLORS.text.white, fontSize: 14 }}>
                {PERIOD_FILTERS.find((p) => p.value === selectedPeriod)?.label}
              </Text>
            </View>
            <ChevronDown size={18} color={COLORS.text.muted} />
          </Pressable>

          {/* Export CSV */}
          <Pressable
            onPress={generateCSV}
            disabled={isExporting || filteredOrders.length === 0}
            style={{
              backgroundColor: COLORS.background.charcoal,
              padding: 12,
              borderRadius: 8,
              opacity: filteredOrders.length === 0 ? 0.5 : 1,
            }}
          >
            <FileText size={20} color={COLORS.primary.gold} />
          </Pressable>

          {/* Export PDF */}
          <Pressable
            onPress={generatePDFList}
            disabled={isExporting || filteredOrders.length === 0}
            style={{
              backgroundColor: COLORS.background.charcoal,
              padding: 12,
              borderRadius: 8,
              opacity: filteredOrders.length === 0 ? 0.5 : 1,
            }}
          >
            <Download size={20} color={COLORS.primary.gold} />
          </Pressable>
        </View>

        {/* Dropdown filtre période */}
        {showPeriodPicker && (
          <View
            style={{
              backgroundColor: COLORS.background.charcoal,
              borderRadius: 8,
              marginTop: 10,
              overflow: 'hidden',
            }}
          >
            {PERIOD_FILTERS.map((period) => (
              <Pressable
                key={period.value}
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  setSelectedPeriod(period.value);
                  setShowPeriodPicker(false);
                }}
                style={{
                  padding: 15,
                  backgroundColor:
                    selectedPeriod === period.value ? withOpacity(COLORS.primary.gold, 0.2) : 'transparent',
                }}
              >
                <Text
                  style={{
                    color: selectedPeriod === period.value ? COLORS.primary.gold : COLORS.text.white,
                    fontWeight: selectedPeriod === period.value ? 'bold' : 'normal',
                  }}
                >
                  {period.label}
                </Text>
              </Pressable>
            ))}
          </View>
        )}
      </LinearGradient>

      {/* Liste des commandes */}
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 20 }}>
        {isProMode && (
          <View
            style={{
              backgroundColor: COLORS.background.charcoal,
              borderRadius: 12,
              padding: 14,
              marginBottom: 16,
              borderWidth: 1,
              borderColor: `${COLORS.accent.teal}30`,
            }}
          >
            <Pressable
              onPress={() => setShowSuppliers((prev) => !prev)}
              style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <View
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: 10,
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: `${COLORS.accent.teal}25`,
                  }}
                >
                  <Users size={18} color={COLORS.accent.teal} />
                </View>
                <View>
                  <Text style={{ color: COLORS.text.white, fontWeight: 'bold', fontSize: 14 }}>Fournisseurs</Text>
                  <Text style={{ color: COLORS.text.muted, fontSize: 11 }}>{supplierContacts.length} producteurs</Text>
                </View>
              </View>
              {showSuppliers ? (
                <ChevronUp size={18} color={COLORS.text.muted} />
              ) : (
                <ChevronDown size={18} color={COLORS.text.muted} />
              )}
            </Pressable>

            {showSuppliers && (
              <View style={{ marginTop: 12 }}>
                {supplierContacts.length === 0 ? (
                  <Text style={{ color: COLORS.text.muted, fontSize: 12, textAlign: 'center', paddingVertical: 8 }}>
                    Aucun fournisseur disponible
                  </Text>
                ) : (
                  supplierContacts.slice(0, suppliersListMax).map((supplier) => {
                    const mailUrl = supplier.email ? getSafeMailtoUrl(supplier.email) : null;
                    const telUrl = supplier.phone ? getSafeTelUrl(supplier.phone) : null;

                    return (
                      <View
                        key={supplier.id}
                        style={{
                          backgroundColor: 'rgba(255,255,255,0.04)',
                          borderRadius: 10,
                          padding: 10,
                          marginBottom: 8,
                          flexDirection: 'row',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                        }}
                      >
                        <View style={{ flex: 1, marginRight: 10 }}>
                          <Text style={{ color: COLORS.text.white, fontSize: 13, fontWeight: '600' }} numberOfLines={1}>
                            {supplier.name}
                          </Text>
                          <Text style={{ color: COLORS.text.muted, fontSize: 11 }} numberOfLines={1}>
                            {[supplier.city, supplier.region].filter(Boolean).join(' · ')}
                          </Text>
                          {supplier.email && (
                            <Text style={{ color: COLORS.text.muted, fontSize: 10 }} numberOfLines={1}>
                              {supplier.email}
                            </Text>
                          )}
                        </View>
                        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                          <Pressable
                            onPress={() => void openSupplierMail(supplier.email)}
                            style={{
                              width: 30,
                              height: 30,
                              borderRadius: 15,
                              alignItems: 'center',
                              justifyContent: 'center',
                              backgroundColor: `${COLORS.accent.teal}25`,
                              marginRight: 8,
                              opacity: mailUrl ? 1 : 0.4,
                            }}
                          >
                            <Mail size={14} color={mailUrl ? COLORS.accent.teal : COLORS.text.muted} />
                          </Pressable>
                          <Pressable
                            onPress={() => void openSupplierTel(supplier.phone)}
                            style={{
                              width: 30,
                              height: 30,
                              borderRadius: 15,
                              alignItems: 'center',
                              justifyContent: 'center',
                              backgroundColor: `${COLORS.accent.hemp}25`,
                              opacity: telUrl ? 1 : 0.4,
                            }}
                          >
                            <Phone size={14} color={telUrl ? COLORS.accent.hemp : COLORS.text.muted} />
                          </Pressable>
                        </View>
                      </View>
                    );
                  })
                )}
                {supplierContacts.length > suppliersListMax && (
                  <Text style={{ color: COLORS.text.muted, fontSize: 10, textAlign: 'center', marginTop: 4 }}>
                    +{supplierContacts.length - suppliersListMax} autres fournisseurs
                  </Text>
                )}
              </View>
            )}
          </View>
        )}
        {pendingOrdersForDisplay.length > 0 && !isProducerMode && (
          <View
            style={{
              backgroundColor: 'rgba(199, 91, 91, 0.12)',
              borderRadius: 12,
              padding: 14,
              marginBottom: 16,
              borderWidth: 1,
              borderColor: 'rgba(199, 91, 91, 0.3)',
            }}
          >
            <Text style={{ fontSize: 14, color: '#C75B5B', fontWeight: 'bold', marginBottom: 4 }}>
              {pendingOrdersForDisplay.length} commande{pendingOrdersForDisplay.length > 1 ? 's' : ''} en attente de synchronisation
            </Text>
            <Text style={{ fontSize: 12, color: COLORS.text.muted }}>
              Elles apparaissent ici mais ne sont pas encore confirmées sur le serveur.
            </Text>
          </View>
        )}
        {isLoadingOrders ? (
          <View style={{ paddingTop: 10 }}>
            {Array.from({ length: 5 }).map((_, index) => (
              <View
                key={`order-skeleton-${index}`}
                style={{
                  backgroundColor: COLORS.background.charcoal,
                  borderRadius: 12,
                  padding: 15,
                  borderLeftWidth: 4,
                  borderLeftColor: withOpacity(COLORS.primary.gold, 0.2),
                  marginBottom: 15,
                }}
              >
                <Skeleton width="55%" height={10} style={{ marginBottom: 8 }} />
                <Skeleton width="40%" height={16} style={{ marginBottom: 6 }} />
                <Skeleton width="30%" height={10} />

                <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 12 }}>
                  <Skeleton width="28%" height={10} />
                  <Skeleton width="20%" height={16} />
                </View>
              </View>
            ))}
          </View>
        ) : isProducerMode ? (
          (() => {
            const renderOrders = (orders: Order[], offset: number) => (
              orders.map((order, index) => (
                <Animated.View
                  key={`${order.id}-${index}`}
                  entering={FadeInDown.delay((index + offset) * 50)}
                  style={{ marginBottom: 15 }}
                >
                  <Pressable
                    onPress={() => viewOrderDetail(order)}
                    style={{
                      backgroundColor: COLORS.background.charcoal,
                      borderRadius: 12,
                      padding: 15,
                      borderLeftWidth: 4,
                      borderLeftColor: ORDER_STATUS_CONFIG[order.status].color,
                    }}
                  >
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 10 }}>
                      <View style={{ flex: 1 }}>
                        <Text style={{ fontSize: 12, color: COLORS.text.muted, fontFamily: 'monospace' }}>
                          {order.id.slice(0, 12)}...
                        </Text>
                        <Text style={{ fontSize: 16, color: COLORS.text.white, fontWeight: 'bold', marginTop: 5 }}>
                          {order.customerInfo.firstName} {order.customerInfo.lastName}
                        </Text>
                        <Text style={{ fontSize: 12, color: COLORS.text.muted, marginTop: 2 }}>
                          {new Date(order.createdAt).toLocaleDateString('fr-FR')}
                        </Text>
                      </View>
                      <View style={{ alignItems: 'flex-end' }}>
                        <View
                          style={{
                            backgroundColor: ORDER_STATUS_CONFIG[order.status].color,
                            paddingHorizontal: 10,
                            paddingVertical: 4,
                            borderRadius: 6,
                            marginBottom: 8,
                          }}
                        >
                          <Text style={{ color: 'white', fontSize: 10, fontWeight: 'bold' }}>
                            {ORDER_STATUS_CONFIG[order.status].label}
                          </Text>
                        </View>
                        {pendingOrderIds.has(order.id) && (
                          <View
                            style={{
                              backgroundColor: 'rgba(199, 91, 91, 0.2)',
                              paddingHorizontal: 8,
                              paddingVertical: 3,
                              borderRadius: 999,
                              marginBottom: 8,
                            }}
                          >
                            <Text style={{ color: '#C75B5B', fontSize: 10, fontWeight: 'bold' }}>
                              Sync en attente
                            </Text>
                          </View>
                        )}
                        <Text style={{ fontSize: 18, color: COLORS.primary.gold, fontWeight: 'bold' }}>
                          {order.total.toFixed(2)} €
                        </Text>
                      </View>
                    </View>

                    <View
                      style={{
                        borderTopWidth: 1,
                        borderTopColor: COLORS.background.nightSky,
                        paddingTop: 10,
                        flexDirection: 'row',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                      }}
                    >
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                        <Text style={{ fontSize: 12, color: COLORS.text.muted }}>
                          {order.items.length} produit{order.items.length > 1 ? 's' : ''}
                        </Text>
                        {order.deliveryMethod && (
                          <View
                            style={{
                              flexDirection: 'row',
                              alignItems: 'center',
                              gap: 4,
                              backgroundColor: order.deliveryMethod === 'shipping' ? 'rgba(59, 130, 246, 0.15)' : 'rgba(16, 185, 129, 0.15)',
                              paddingHorizontal: 8,
                              paddingVertical: 3,
                              borderRadius: 6,
                            }}
                          >
                            {order.deliveryMethod === 'shipping' ? (
                              <Truck size={12} color="#3B82F6" />
                            ) : (
                              <MapPin size={12} color="#10B981" />
                            )}
                            <Text style={{ fontSize: 10, fontWeight: 'bold', color: order.deliveryMethod === 'shipping' ? '#3B82F6' : '#10B981' }}>
                              {order.deliveryMethod === 'shipping' ? 'Livraison' : 'Retrait'}
                            </Text>
                          </View>
                        )}
                      </View>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                        <Eye size={16} color={COLORS.primary.gold} />
                        <Text style={{ fontSize: 12, color: COLORS.primary.gold }}>Voir détails</Text>
                      </View>
                    </View>
                  </Pressable>
                </Animated.View>
              ))
            );

            const viewIsPro = producerOrdersView === 'pro';
            const activeOrders = viewIsPro ? filteredProducerProOrders : filteredProducerLocalOrders;
            const activeStats = viewIsPro ? producerProStats : producerLocalStats;
            const titleColor = viewIsPro ? '#10B981' : '#F97316';
            const title = viewIsPro ? 'Commandes PRO' : 'Commandes Marche Local';

            return (
              <>
                <View style={{ flexDirection: 'row', marginBottom: 12 }}>
                  <Pressable
                    onPress={() => setProducerOrdersView('pro')}
                    style={{
                      flex: 1,
                      padding: 10,
                      borderRadius: 10,
                      alignItems: 'center',
                      marginRight: 6,
                      backgroundColor: viewIsPro ? 'rgba(16, 185, 129, 0.2)' : COLORS.background.charcoal,
                      borderWidth: viewIsPro ? 1 : 0,
                      borderColor: 'rgba(16, 185, 129, 0.45)',
                    }}
                  >
                    <Text style={{ color: viewIsPro ? '#10B981' : COLORS.text.muted, fontWeight: 'bold', fontSize: 12 }}>
                      PRO
                    </Text>
                  </Pressable>
                  <Pressable
                    onPress={() => setProducerOrdersView('local')}
                    style={{
                      flex: 1,
                      padding: 10,
                      borderRadius: 10,
                      alignItems: 'center',
                      marginLeft: 6,
                      backgroundColor: !viewIsPro ? 'rgba(249, 115, 22, 0.2)' : COLORS.background.charcoal,
                      borderWidth: !viewIsPro ? 1 : 0,
                      borderColor: 'rgba(249, 115, 22, 0.45)',
                    }}
                  >
                    <Text style={{ color: !viewIsPro ? '#F97316' : COLORS.text.muted, fontWeight: 'bold', fontSize: 12 }}>
                      MARCHE LOCAL
                    </Text>
                  </Pressable>
                </View>

                <View
                  style={{
                    backgroundColor: viewIsPro ? 'rgba(16, 185, 129, 0.12)' : 'rgba(249, 115, 22, 0.12)',
                    borderRadius: 12,
                    padding: 14,
                    marginBottom: 12,
                    borderWidth: 1,
                    borderColor: viewIsPro ? 'rgba(16, 185, 129, 0.3)' : 'rgba(249, 115, 22, 0.3)',
                  }}
                >
                  <Text style={{ fontSize: 14, color: titleColor, fontWeight: 'bold' }}>
                    {title}
                  </Text>
                  <Text style={{ fontSize: 12, color: COLORS.text.muted }}>
                    {activeOrders.length} commande{activeOrders.length > 1 ? 's' : ''}
                  </Text>
                </View>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
                  <View style={{ width: '48%', backgroundColor: COLORS.background.charcoal, padding: 10, borderRadius: 8 }}>
                    <Text style={{ fontSize: 16, fontWeight: 'bold', color: titleColor }}>
                      {activeStats.total}
                    </Text>
                    <Text style={{ fontSize: 11, color: COLORS.text.muted }}>Commandes</Text>
                  </View>
                  <View style={{ width: '48%', backgroundColor: COLORS.background.charcoal, padding: 10, borderRadius: 8 }}>
                    <Text style={{ fontSize: 16, fontWeight: 'bold', color: titleColor }}>
                      {activeStats.totalRevenue.toFixed(0)} €
                    </Text>
                    <Text style={{ fontSize: 11, color: COLORS.text.muted }}>CA TTC</Text>
                  </View>
                  <View style={{ width: '48%', backgroundColor: COLORS.background.charcoal, padding: 10, borderRadius: 8 }}>
                    <Text style={{ fontSize: 16, fontWeight: 'bold', color: '#10B981' }}>
                      {activeStats.totalHT.toFixed(0)} €
                    </Text>
                    <Text style={{ fontSize: 11, color: COLORS.text.muted }}>CA HT</Text>
                  </View>
                  <View style={{ width: '48%', backgroundColor: 'rgba(199, 91, 91, 0.15)', padding: 10, borderRadius: 8, borderWidth: 1, borderColor: 'rgba(199, 91, 91, 0.3)' }}>
                    <Text style={{ fontSize: 16, fontWeight: 'bold', color: '#C75B5B' }}>
                      {activeStats.totalTVA.toFixed(2)} €
                    </Text>
                    <Text style={{ fontSize: 11, color: '#C75B5B' }}>TVA due</Text>
                  </View>
                </View>

                {activeOrders.length > 0 ? (
                  renderOrders(activeOrders, 0)
                ) : (
                  <Text style={{ fontSize: 12, color: COLORS.text.muted, textAlign: 'center', marginBottom: 16 }}>
                    {searchQuery ? 'Aucune commande trouvée' : 'Aucune commande pour cette période'}
                  </Text>
                )}
              </>
            );
          })()
        ) : filteredOrders.length === 0 ? (
          <View style={{ alignItems: 'center', paddingTop: 60 }}>
            <Text style={{ fontSize: 16, color: COLORS.text.muted, textAlign: 'center' }}>
              {searchQuery ? 'Aucune commande trouvée' : 'Aucune commande pour cette période'}
            </Text>
          </View>
        ) : (
          filteredOrders.map((order, index) => (
            <Animated.View
              key={order.id}
              entering={FadeInDown.delay(index * 50)}
              style={{ marginBottom: 15 }}
            >
              <Pressable
                onPress={() => viewOrderDetail(order)}
                style={{
                  backgroundColor: COLORS.background.charcoal,
                  borderRadius: 12,
                  padding: 15,
                  borderLeftWidth: 4,
                  borderLeftColor: ORDER_STATUS_CONFIG[order.status].color,
                }}
              >
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 10 }}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 12, color: COLORS.text.muted, fontFamily: 'monospace' }}>
                      {order.id.slice(0, 12)}...
                    </Text>
                    <Text style={{ fontSize: 16, color: COLORS.text.white, fontWeight: 'bold', marginTop: 5 }}>
                      {order.customerInfo.firstName} {order.customerInfo.lastName}
                    </Text>
                    <Text style={{ fontSize: 12, color: COLORS.text.muted, marginTop: 2 }}>
                      {new Date(order.createdAt).toLocaleDateString('fr-FR')}
                    </Text>
                  </View>
                  <View style={{ alignItems: 'flex-end' }}>
                    <View
                      style={{
                        backgroundColor: ORDER_STATUS_CONFIG[order.status].color,
                        paddingHorizontal: 10,
                        paddingVertical: 4,
                        borderRadius: 6,
                        marginBottom: 8,
                      }}
                    >
                      <Text style={{ color: 'white', fontSize: 10, fontWeight: 'bold' }}>
                        {ORDER_STATUS_CONFIG[order.status].label}
                      </Text>
                    </View>
                    {pendingOrderIds.has(order.id) && (
                      <View
                        style={{
                          backgroundColor: 'rgba(199, 91, 91, 0.2)',
                          paddingHorizontal: 8,
                          paddingVertical: 3,
                          borderRadius: 999,
                          marginBottom: 8,
                        }}
                      >
                        <Text style={{ color: '#C75B5B', fontSize: 10, fontWeight: 'bold' }}>
                          Sync en attente
                        </Text>
                      </View>
                    )}
                    <Text style={{ fontSize: 18, color: COLORS.primary.gold, fontWeight: 'bold' }}>
                      {order.total.toFixed(2)} €
                    </Text>
                  </View>
                </View>

                <View
                  style={{
                    borderTopWidth: 1,
                    borderTopColor: COLORS.background.nightSky,
                    paddingTop: 10,
                    flexDirection: 'row',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                  }}
                >
                  <Text style={{ fontSize: 12, color: COLORS.text.muted }}>
                    {order.items.length} produit{order.items.length > 1 ? 's' : ''}
                  </Text>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                    <Eye size={16} color={COLORS.primary.gold} />
                    <Text style={{ fontSize: 12, color: COLORS.primary.gold }}>Voir détails</Text>
                  </View>
                </View>
              </Pressable>
            </Animated.View>
          ))
        )}

        <View style={{ height: insets.bottom + 20 }} />
      </ScrollView>
      <Toast
        visible={toast.visible}
        message={toast.message}
        type={toast.type}
        onHide={hideToast}
        position="top"
      />
    </View>
  );
}
