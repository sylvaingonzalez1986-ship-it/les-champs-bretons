import React, { useState, useEffect, useMemo } from 'react';
import {
  View,
  ScrollView,
  Pressable,
  Image,
  Modal,
  RefreshControl,
  TextInput as RNTextInput,
  Switch,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Alert,
} from 'react-native';
import { Text } from '@/components/ui';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import {
  Store,
  Plus,
  Edit3,
  Trash2,
  X,
  Check,
  Package,
  Eye,
  EyeOff,
  AlertCircle,
  Leaf,
  ChevronDown,
  Search,
  Save,
  ImagePlus,
  Camera,
  ShoppingBag,
  Truck,
  Clock,
  CheckCircle,
  XCircle,
  ChevronRight,
  User,
  MapPin,
  Phone,
  Mail,
  RefreshCw,
  Layers,
  TrendingUp,
} from 'lucide-react-native';
import Animated, { FadeInDown, FadeInUp } from 'react-native-reanimated';
import * as ImagePicker from 'expo-image-picker';
import { COLORS } from '@/lib/colors';
import { PRODUCT_TYPE_LABELS, PRODUCT_TYPE_COLORS, PriceTier } from '@/lib/producers';
import { usePermissions } from '@/lib/useAuth';
import {
  fetchMyProducer,
  fetchProducerProducts,
  createProduct,
  updateProduct,
  deleteProduct,
  ProducerProductDB,
  ProducerDB,
  ProductInsert,
} from '@/lib/supabase-producer';
import { uploadProductImage, isProductImagesConfigured } from '@/lib/supabase-product-images';
import { uploadLabAnalysis, isLabAnalysesConfigured } from '@/lib/supabase-lab-analyses';
import { LabAnalysisUploader } from '@/components/LabAnalysisUploader';
import { useOrdersStore, Order, OrderStatus, ORDER_STATUS_CONFIG } from '@/lib/store';
import { isSupabaseSyncConfigured, fetchOrdersForProducer, updateOrderInSupabase } from '@/lib/supabase-sync';
import { useLocalMarketOrders, LocalMarketOrder, getStatusLabel, getStatusColor } from '@/lib/local-market-orders';
import { useAuth } from '@/lib/useAuth';

type TabType = 'products' | 'orders' | 'direct_sales';

// Type pour les paliers de prix dans le formulaire
interface PriceTierForm {
  minQuantity: string;
  price: string;
}

// Types pour le formulaire
interface ProductFormData {
  name: string;
  type: string;
  cbd_percent: string;
  thc_percent: string;
  price_public: string;
  price_pro: string;
  weight: string;
  image: string;
  images: string[];
  description: string;
  stock: string;
  tva_rate: string;
  visible_for_clients: boolean;
  visible_for_pros: boolean;
  status: 'draft' | 'published' | 'archived';
  lab_analysis_url: string; // URL de l'analyse de laboratoire
  disponible_vente_directe: boolean; // Disponible en vente directe à la ferme
  // Tarification par paliers - Clients
  enablePriceTiers: boolean;
  priceTiers: PriceTierForm[];
  // Tarification par paliers - Pros
  enablePriceProTiers: boolean;
  priceProTiers: PriceTierForm[];
  // Bourse des produits
  availableOnBourse: boolean;
  bourseBasePrice: string;
}

const initialFormData: ProductFormData = {
  name: '',
  type: 'fleur',
  cbd_percent: '',
  thc_percent: '',
  price_public: '',
  price_pro: '',
  weight: '',
  image: '',
  images: [],
  description: '',
  stock: '',
  tva_rate: '20',
  visible_for_clients: true,
  visible_for_pros: false,
  status: 'draft',
  lab_analysis_url: '',
  disponible_vente_directe: false,
  // Tarification par paliers - Clients
  enablePriceTiers: false,
  priceTiers: [],
  // Tarification par paliers - Pros
  enablePriceProTiers: false,
  priceProTiers: [],
  // Bourse des produits
  availableOnBourse: false,
  bourseBasePrice: '',
};

const PRODUCT_TYPES = ['fleur', 'huile', 'resine', 'infusion'] as const;
const STATUS_OPTIONS = [
  { value: 'draft', label: 'Brouillon', color: COLORS.text.muted },
  { value: 'published', label: 'Publié', color: COLORS.accent.hemp },
  { value: 'archived', label: 'Archivé', color: COLORS.accent.red },
] as const;

export default function MaBoutiqueScreen() {
  const insets = useSafeAreaInsets();
  const { isProducer, isAdmin } = usePermissions();
  const { session } = useAuth();

  // Tab state
  const [activeTab, setActiveTab] = useState<TabType>('products');

  // États
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [producer, setProducer] = useState<ProducerDB | null>(null);
  const [products, setProducts] = useState<ProducerProductDB[]>([]);
  const [searchQuery, setSearchQuery] = useState('');

  // Orders state
  const orders = useOrdersStore((s) => s.orders);
  const setOrders = useOrdersStore((s) => s.setOrders);
  const updateOrderStatus = useOrdersStore((s) => s.updateOrderStatus);
  const updateOrderTrackingNumber = useOrdersStore((s) => s.updateOrderTrackingNumber);
  const [ordersLoading, setOrdersLoading] = useState(false);
  const [ordersLoadingMore, setOrdersLoadingMore] = useState(false);
  const [ordersHasMore, setOrdersHasMore] = useState(true);
  const [ordersPage, setOrdersPage] = useState(0);
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const ORDERS_PAGE_SIZE = 20;

  // Direct sales (Local Market) state
  const { loadOrdersForProducer, updateOrderStatus: updateLocalOrderStatus } = useLocalMarketOrders();
  const [directSalesOrders, setDirectSalesOrders] = useState<LocalMarketOrder[]>([]);
  const [directSalesLoading, setDirectSalesLoading] = useState(false);
  const [directSalesLoadingMore, setDirectSalesLoadingMore] = useState(false);
  const [directSalesHasMore, setDirectSalesHasMore] = useState(true);
  const [directSalesPage, setDirectSalesPage] = useState(0);
  const DIRECT_SALES_PAGE_SIZE = 20;
  const [selectedDirectOrder, setSelectedDirectOrder] = useState<LocalMarketOrder | null>(null);

  // Modal states
  const [showProductModal, setShowProductModal] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [editingProduct, setEditingProduct] = useState<ProducerProductDB | null>(null);
  const [productToDelete, setProductToDelete] = useState<ProducerProductDB | null>(null);
  const [formData, setFormData] = useState<ProductFormData>(initialFormData);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Image upload states
  const [uploadingImage, setUploadingImage] = useState(false);
  const [uploadingLabAnalysis, setUploadingLabAnalysis] = useState(false);

  // Toast
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  const isNoTva = formData.tva_rate === '0' || formData.tva_rate === '0.0';

  // Charger les données
  const loadData = async () => {
    try {
      const myProducer = await fetchMyProducer();
      setProducer(myProducer);

      if (myProducer) {
        const myProducts = await fetchProducerProducts(myProducer.id);
        setProducts(myProducts);
      }
    } catch (err) {
      console.error('[MaBoutique] Error loading data:', err);
      setError('Erreur lors du chargement des données');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const onRefresh = () => {
    setRefreshing(true);
    loadData();
    if (activeTab === 'orders') {
      setOrdersPage(0);
      setOrdersHasMore(true);
      loadOrdersFromSupabase(true);
    }
    if (activeTab === 'direct_sales') {
      setDirectSalesPage(0);
      setDirectSalesHasMore(true);
      loadDirectSalesOrders(true);
    }
  };

  const onLoadMoreOrders = () => {
    if (ordersLoadingMore || !ordersHasMore) {
      return;
    }
    loadOrdersFromSupabase(false);
  };

  // Load direct sales orders (Local Market)
  const loadDirectSalesOrders = async (reset = false) => {
    if (!producer?.id || !session?.access_token) {
      return;
    }

    if (reset) {
      setDirectSalesLoading(true);
    } else {
      setDirectSalesLoadingMore(true);
    }
    try {
      const nextPage = reset ? 0 : directSalesPage;
      const offset = nextPage * DIRECT_SALES_PAGE_SIZE;
      const orders = await loadOrdersForProducer(producer.id, session.access_token, {
        limit: DIRECT_SALES_PAGE_SIZE,
        offset,
      });
      setDirectSalesHasMore(orders.length === DIRECT_SALES_PAGE_SIZE);
      setDirectSalesPage((prev) => (reset ? 1 : prev + 1));
      setDirectSalesOrders((prev) => (reset ? orders : [...prev, ...orders]));
    } catch (error) {
      console.error('[MaBoutique] Error loading direct sales orders:', error);
    } finally {
      setDirectSalesLoading(false);
      setDirectSalesLoadingMore(false);
    }
  };

  const onLoadMoreDirectSales = () => {
    if (directSalesLoadingMore || !directSalesHasMore) return;
    loadDirectSalesOrders(false);
  };

  // Load direct sales when switching to tab
  useEffect(() => {
    if (activeTab === 'direct_sales' && producer?.id && session?.access_token) {
      setDirectSalesPage(0);
      setDirectSalesHasMore(true);
      loadDirectSalesOrders(true);
    }
  }, [activeTab, producer?.id, session?.access_token]);

  // Load orders from Supabase - filtered by producer for security
  const loadOrdersFromSupabase = async (reset = false) => {
    // PROTECTION: Ne JAMAIS appeler sans un producer valide
    if (!isSupabaseSyncConfigured()) {
      return;
    }

    if (!producer?.id) {
      return;
    }

    if (reset) {
      setOrdersLoading(true);
    } else {
      setOrdersLoadingMore(true);
    }
    try {
      // Server-side filtering by producer_id for security
      const nextPage = reset ? 0 : ordersPage;
      const offset = nextPage * ORDERS_PAGE_SIZE;
      const supabaseOrders = await fetchOrdersForProducer(producer.id, {
        limit: ORDERS_PAGE_SIZE,
        offset,
      });

      setOrdersHasMore(supabaseOrders.length === ORDERS_PAGE_SIZE);
      setOrdersPage((prev) => (reset ? 1 : prev + 1));

      // Toujours mettre à jour le store avec les données reçues (même vide = producteur sans commandes)
      setOrders((prev) => (reset ? supabaseOrders : [...prev, ...supabaseOrders]));
    } catch (error) {
      console.error('[MaBoutique] Error loading orders:', error);
    } finally {
      setOrdersLoading(false);
      setOrdersLoadingMore(false);
    }
  };

  // Load orders when switching to orders tab - only if producer is loaded
  useEffect(() => {
    if (activeTab === 'orders' && producer?.id) {
      setOrdersPage(0);
      setOrdersHasMore(true);
      loadOrdersFromSupabase(true);
    }
  }, [activeTab, producer?.id]);

  // Filter orders for this producer only
  const producerOrders = useMemo(() => {
    if (!producer) return [];
    return orders.filter((order) =>
      order.items.some((item) => item.producerId === producer.id)
    );
  }, [orders, producer]);

  // Count pending orders for badge
  const pendingOrdersCount = producerOrders.filter((o) => o.status === 'pending').length;

  // Handle order status change
  const handleOrderStatusChange = async (orderId: string, newStatus: OrderStatus) => {
    // Verify that the order contains products from this producer
    const orderToUpdate = orders.find(o => o.id === orderId);
    if (!orderToUpdate || !producer) {
      showToast('Commande introuvable', 'error');
      return;
    }

    const hasProducerItems = orderToUpdate.items.some(item => item.producerId === producer.id);
    if (!hasProducerItems) {
      showToast('Non autorisé - Cette commande ne contient pas vos produits', 'error');
      return;
    }

    updateOrderStatus(orderId, newStatus);

    // Sync to Supabase
    if (isSupabaseSyncConfigured()) {
      try {
        await updateOrderInSupabase(orderId, { status: newStatus });
        showToast('Statut mis à jour', 'success');
      } catch (error) {
        console.error('Erreur sync statut commande:', error);
        showToast('Erreur de synchronisation', 'error');
      }
    }
  };

  // Handle tracking number update
  const handleTrackingNumberUpdate = async (orderId: string, trackingNumber: string) => {
    // Verify that the order contains products from this producer
    const orderToUpdate = orders.find(o => o.id === orderId);
    if (!orderToUpdate || !producer) {
      showToast('Commande introuvable', 'error');
      return;
    }

    const hasProducerItems = orderToUpdate.items.some(item => item.producerId === producer.id);
    if (!hasProducerItems) {
      showToast('Non autorisé - Cette commande ne contient pas vos produits', 'error');
      return;
    }

    updateOrderTrackingNumber(orderId, trackingNumber);

    // Sync to Supabase
    if (isSupabaseSyncConfigured()) {
      try {
        await updateOrderInSupabase(orderId, { trackingNumber });
        showToast('Numéro de suivi enregistré', 'success');
      } catch (error) {
        console.error('Erreur sync tracking:', error);
      }
    }
  };

  // Filtrer les produits
  const filteredProducts = useMemo(() => {
    if (!searchQuery) return products;
    const query = searchQuery.toLowerCase();
    return products.filter(
      (p) =>
        p.name.toLowerCase().includes(query) ||
        PRODUCT_TYPE_LABELS[p.type as keyof typeof PRODUCT_TYPE_LABELS]?.toLowerCase().includes(query)
    );
  }, [products, searchQuery]);

  // Statistiques
  const stats = useMemo(() => {
    const published = products.filter((p) => p.status === 'published').length;
    const draft = products.filter((p) => p.status === 'draft').length;
    const archived = products.filter((p) => p.status === 'archived').length;
    return { total: products.length, published, draft, archived };
  }, [products]);

  // Ouvrir le formulaire pour un nouveau produit
  const handleAddProduct = () => {
    setEditingProduct(null);
    setFormData(initialFormData);
    setError(null);
    setShowProductModal(true);
  };

  // Ouvrir le formulaire pour éditer un produit
  const handleEditProduct = (product: ProducerProductDB) => {
    // Convertir les paliers de prix clients existants en format formulaire
    const existingTiers: PriceTierForm[] = ((product as any).price_tiers ?? []).map((tier: PriceTier) => ({
      minQuantity: tier.minQuantity.toString(),
      price: tier.price.toString(),
    }));
    // Convertir les paliers de prix pros existants en format formulaire
    const existingProTiers: PriceTierForm[] = ((product as any).price_pro_tiers ?? []).map((tier: PriceTier) => ({
      minQuantity: tier.minQuantity.toString(),
      price: tier.price.toString(),
    }));

    setEditingProduct(product);
    const existingImages = (product.images && product.images.length > 0)
      ? product.images
      : (product.image ? [product.image] : []);
    setFormData({
      name: product.name,
      type: product.type,
      cbd_percent: product.cbd_percent?.toString() || '',
      thc_percent: product.thc_percent?.toString() || '',
      price_public: product.price_public?.toString() || '',
      price_pro: product.price_pro?.toString() || '',
      weight: product.weight || '',
      image: existingImages[0] || '',
      images: existingImages,
      description: product.description || '',
      stock: product.stock?.toString() || '',
      tva_rate: product.tva_rate?.toString() || '20',
      visible_for_clients: product.visible_for_clients ?? true,
      visible_for_pros: product.visible_for_pros ?? false,
      status: product.status || 'draft',
      lab_analysis_url: product.lab_analysis_url || '',
      disponible_vente_directe: product.disponible_vente_directe ?? false,
      // Tarification par paliers - Clients
      enablePriceTiers: existingTiers.length > 0,
      priceTiers: existingTiers,
      // Tarification par paliers - Pros
      enablePriceProTiers: existingProTiers.length > 0,
      priceProTiers: existingProTiers,
      // Bourse des produits
      availableOnBourse: (product as any).available_on_bourse ?? false,
      bourseBasePrice: (product as any).bourse_base_price?.toString() || '',
    });
    setError(null);
    setShowProductModal(true);
  };

  // Confirmer la suppression
  const handleDeleteProduct = (product: ProducerProductDB) => {
    setProductToDelete(product);
    setShowDeleteConfirm(true);
  };

  // Fonctions pour gérer les paliers de prix
  const addPriceTier = () => {
    const lastTier = formData.priceTiers[formData.priceTiers.length - 1];
    const suggestedQty = lastTier ? (parseInt(lastTier.minQuantity, 10) || 0) + 10 : 5;
    const suggestedPrice = lastTier
      ? (parseFloat(lastTier.price) * 0.9).toFixed(2)
      : formData.price_public ? (parseFloat(formData.price_public) * 0.9).toFixed(2) : '';

    setFormData((prev) => ({
      ...prev,
      priceTiers: [...prev.priceTiers, { minQuantity: suggestedQty.toString(), price: suggestedPrice }],
    }));
  };

  const updatePriceTier = (index: number, field: 'minQuantity' | 'price', value: string) => {
    setFormData((prev) => ({
      ...prev,
      priceTiers: prev.priceTiers.map((tier, i) =>
        i === index ? { ...tier, [field]: value } : tier
      ),
    }));
  };

  const removePriceTier = (index: number) => {
    setFormData((prev) => ({
      ...prev,
      priceTiers: prev.priceTiers.filter((_, i) => i !== index),
    }));
  };

  // Fonctions pour gérer les paliers de prix PROS
  const addPriceProTier = () => {
    const lastTier = formData.priceProTiers[formData.priceProTiers.length - 1];
    const suggestedQty = lastTier ? (parseInt(lastTier.minQuantity, 10) || 0) + 10 : 5;
    const suggestedPrice = lastTier
      ? (parseFloat(lastTier.price) * 0.9).toFixed(2)
      : formData.price_pro ? (parseFloat(formData.price_pro) * 0.9).toFixed(2) : '';

    setFormData((prev) => ({
      ...prev,
      priceProTiers: [...prev.priceProTiers, { minQuantity: suggestedQty.toString(), price: suggestedPrice }],
    }));
  };

  const updatePriceProTier = (index: number, field: 'minQuantity' | 'price', value: string) => {
    setFormData((prev) => ({
      ...prev,
      priceProTiers: prev.priceProTiers.map((tier, i) =>
        i === index ? { ...tier, [field]: value } : tier
      ),
    }));
  };

  const removePriceProTier = (index: number) => {
    setFormData((prev) => ({
      ...prev,
      priceProTiers: prev.priceProTiers.filter((_, i) => i !== index),
    }));
  };

  // Exécuter la suppression
  const confirmDelete = async () => {
    if (!productToDelete) return;

    setSaving(true);
    const success = await deleteProduct(productToDelete.id);
    setSaving(false);

    if (success) {
      setProducts((prev) => prev.filter((p) => p.id !== productToDelete.id));
      showToast('Produit supprimé', 'success');
    } else {
      showToast('Erreur lors de la suppression', 'error');
    }

    setShowDeleteConfirm(false);
    setProductToDelete(null);
  };

  // Demander permission caméra
  const requestCameraPermission = async (): Promise<boolean> => {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert(
        'Permission requise',
        'Veuillez autoriser l\'accès à la caméra pour prendre des photos.',
        [{ text: 'OK' }]
      );
      return false;
    }
    return true;
  };

  // Demander permission galerie
  const requestMediaLibraryPermission = async (): Promise<boolean> => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert(
        'Permission requise',
        'Veuillez autoriser l\'accès à la galerie pour sélectionner des photos.',
        [{ text: 'OK' }]
      );
      return false;
    }
    return true;
  };

  const addImagesToForm = (uris: string[]) => {
    setFormData((prev) => {
      const nextImages = [...prev.images, ...uris].slice(0, 3);
      return {
        ...prev,
        images: nextImages,
        image: nextImages[0] || '',
      };
    });
  };

  const removeImageFromForm = (index: number) => {
    setFormData((prev) => {
      const nextImages = prev.images.filter((_, i) => i !== index);
      return {
        ...prev,
        images: nextImages,
        image: nextImages[0] || '',
      };
    });
  };

  // Prendre une photo
  const takePhoto = async () => {
    if (formData.images.length >= 3) {
      Alert.alert('Limite atteinte', 'Vous ne pouvez pas ajouter plus de 3 photos par produit.');
      return;
    }

    const hasPermission = await requestCameraPermission();
    if (!hasPermission) return;

    try {
      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.8,
      });

      if (!result.canceled && result.assets[0]) {
        addImagesToForm([result.assets[0].uri]);
      }
    } catch (error) {
      console.error('[MaBoutique] Camera error:', error);
      Alert.alert('Erreur', 'Impossible d\'ouvrir la caméra');
    }
  };

  // Choisir depuis la galerie
  const pickFromGallery = async () => {
    if (formData.images.length >= 3) {
      Alert.alert('Limite atteinte', 'Vous ne pouvez pas ajouter plus de 3 photos par produit.');
      return;
    }

    const hasPermission = await requestMediaLibraryPermission();
    if (!hasPermission) return;

    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsMultipleSelection: true,
        selectionLimit: 3 - formData.images.length,
        allowsEditing: false,
        quality: 0.8,
      });

      if (!result.canceled && result.assets.length > 0) {
        addImagesToForm(result.assets.map((asset) => asset.uri));
      }
    } catch (error) {
      console.error('[MaBoutique] Gallery error:', error);
      Alert.alert('Erreur', 'Impossible d\'ouvrir la galerie');
    }
  };

  // Upload des images et retourner les URLs
  const uploadImagesAndGetUrls = async (productId: string, images: string[]): Promise<string[]> => {
    if (!producer || images.length === 0) return [];

    setUploadingImage(true);
    try {
      const uploadedImages: string[] = [];

      for (const uri of images) {
        if (uri.startsWith('http')) {
          uploadedImages.push(uri);
          continue;
        }

        if (isProductImagesConfigured()) {
          const publicUrl = await uploadProductImage(uri, producer.id, productId);
          uploadedImages.push(publicUrl);
        } else {
          // Si Supabase n'est pas configuré, on garde l'URI locale (temporaire)
          uploadedImages.push(uri);
        }
      }

      return uploadedImages.slice(0, 3);
    } catch (error: any) {
      console.error('[MaBoutique] Upload error:', error);
      Alert.alert('Erreur upload', error?.message || 'Impossible d\'uploader les images');
      return images.slice(0, 3);
    } finally {
      setUploadingImage(false);
    }
  };

  // Sauvegarder le produit
  const handleSaveProduct = async () => {
    if (!producer) return;

    // Validation
    if (!formData.name.trim()) {
      setError('Le nom du produit est requis');
      return;
    }
    if (!formData.price_public || parseFloat(formData.price_public) <= 0) {
      setError('Le prix public doit être supérieur à 0');
      return;
    }

    setSaving(true);
    setError(null);

    // Générer un ID temporaire pour l'upload si c'est un nouveau produit
    const tempProductId = editingProduct?.id || `new-${Date.now()}`;

    // Upload des images si nécessaire
    const uploadedImages = await uploadImagesAndGetUrls(tempProductId, formData.images);
    const mainImageUrl = uploadedImages[0] || null;

    // Upload analyse labo si nécessaire
    let labAnalysisUrl = formData.lab_analysis_url || null;
    if (labAnalysisUrl && !(labAnalysisUrl.startsWith('http://') || labAnalysisUrl.startsWith('https://'))) {
      if (isLabAnalysesConfigured()) {
        try {
          setUploadingLabAnalysis(true);
          labAnalysisUrl = await uploadLabAnalysis(labAnalysisUrl, producer.id, tempProductId);
        } catch (error: any) {
          console.error('[MaBoutique] Lab analysis upload error:', error);
          Alert.alert('Erreur upload', error?.message || 'Impossible d\'uploader l\'analyse de laboratoire');
        } finally {
          setUploadingLabAnalysis(false);
        }
      }
    }

    // Parser les paliers de prix CLIENTS
    const parsedPriceTiers: PriceTier[] = formData.enablePriceTiers
      ? formData.priceTiers
          .filter((tier) => tier.minQuantity.trim() && tier.price.trim())
          .map((tier) => ({
            minQuantity: parseInt(tier.minQuantity, 10) || 0,
            price: parseFloat(tier.price) || 0,
          }))
          .filter((tier) => tier.minQuantity > 0 && tier.price > 0)
          .sort((a, b) => a.minQuantity - b.minQuantity)
      : [];

    // Parser les paliers de prix PROS
    const parsedPriceProTiers: PriceTier[] = formData.enablePriceProTiers
      ? formData.priceProTiers
          .filter((tier) => tier.minQuantity.trim() && tier.price.trim())
          .map((tier) => ({
            minQuantity: parseInt(tier.minQuantity, 10) || 0,
            price: parseFloat(tier.price) || 0,
          }))
          .filter((tier) => tier.minQuantity > 0 && tier.price > 0)
          .sort((a, b) => a.minQuantity - b.minQuantity)
      : [];

    // Données du produit à envoyer à Supabase
    const parsedTvaRate = Number.parseFloat(formData.tva_rate);
    const productData = {
      producer_id: producer.id,
      name: formData.name.trim(),
      type: formData.type,
      cbd_percent: formData.cbd_percent ? parseFloat(formData.cbd_percent) : null,
      thc_percent: formData.thc_percent ? parseFloat(formData.thc_percent) : null,
      price_public: parseFloat(formData.price_public),
      price_pro: formData.price_pro ? parseFloat(formData.price_pro) : null,
      weight: formData.weight || null,
      image: mainImageUrl,
      images: uploadedImages.length > 0 ? uploadedImages : null,
      description: formData.description || null,
      stock: formData.stock ? parseInt(formData.stock, 10) : null,
      tva_rate: Number.isNaN(parsedTvaRate) ? 20 : parsedTvaRate,
      is_on_promo: false,
      promo_percent: null,
      visible_for_clients: formData.visible_for_clients,
      visible_for_pros: formData.visible_for_pros,
      status: formData.status,
      lab_analysis_url: labAnalysisUrl,
      disponible_vente_directe: formData.disponible_vente_directe,
      price_tiers: parsedPriceTiers.length > 0 ? parsedPriceTiers : null,
      price_pro_tiers: parsedPriceProTiers.length > 0 ? parsedPriceProTiers : null,
      available_on_bourse: formData.availableOnBourse,
      bourse_base_price: formData.availableOnBourse && formData.bourseBasePrice.trim()
        ? parseFloat(formData.bourseBasePrice)
        : null,
    };

    try {
      if (editingProduct) {
        // Update
        const updated = await updateProduct(editingProduct.id, productData);
        if (updated) {
          setProducts((prev) =>
            prev.map((p) => (p.id === editingProduct.id ? { ...p, ...updated } : p))
          );
          showToast('Produit mis à jour', 'success');
          setShowProductModal(false);
        } else {
          setError('Erreur lors de la mise à jour');
        }
      } else {
        // Create
        const created = await createProduct(productData as ProductInsert);
        if (created) {
          setProducts((prev) => [created, ...prev]);
          showToast('Produit créé', 'success');
          setShowProductModal(false);
        } else {
          setError('Erreur lors de la création');
        }
      }
    } catch (err) {
      setError('Une erreur est survenue');
    } finally {
      setSaving(false);
    }
  };

  // Afficher un toast
  const showToast = (message: string, type: 'success' | 'error') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  // Render d'un produit dans la liste
  const renderProductCard = (product: ProducerProductDB, index: number) => {
    const statusConfig = STATUS_OPTIONS.find((s) => s.value === product.status);
    const mainImage = product.images && product.images.length > 0
      ? product.images[0]
      : product.image;

    return (
      <Animated.View
        key={product.id}
        entering={FadeInDown.duration(300).delay(index * 50)}
        className="mb-3"
      >
        <Pressable
          onPress={() => handleEditProduct(product)}
          className="rounded-2xl overflow-hidden"
          style={{
            backgroundColor: COLORS.background.charcoal,
            borderWidth: 1,
            borderColor: `${COLORS.primary.gold}20`,
          }}
        >
          <View className="flex-row">
            {/* Image */}
            <View className="w-24 h-24">
              {mainImage ? (
                <Image
                  source={{ uri: mainImage }}
                  className="w-full h-full"
                  resizeMode="cover"
                />
              ) : (
                <View
                  className="w-full h-full items-center justify-center"
                  style={{ backgroundColor: `${COLORS.text.muted}20` }}
                >
                  <Leaf size={32} color={COLORS.text.muted} />
                </View>
              )}
            </View>

            {/* Infos */}
            <View className="flex-1 p-3">
              <View className="flex-row items-start justify-between">
                <View className="flex-1 mr-2">
                  <Text
                    style={{ color: COLORS.text.cream }}
                    className="font-bold text-base"
                    numberOfLines={1}
                  >
                    {product.name}
                  </Text>
                  <View className="flex-row items-center mt-1">
                    <View
                      className="px-2 py-0.5 rounded mr-2"
                      style={{
                        backgroundColor: `${PRODUCT_TYPE_COLORS[product.type as keyof typeof PRODUCT_TYPE_COLORS]}30`,
                      }}
                    >
                      <Text
                        style={{
                          color: PRODUCT_TYPE_COLORS[product.type as keyof typeof PRODUCT_TYPE_COLORS],
                          fontSize: 10,
                        }}
                      >
                        {PRODUCT_TYPE_LABELS[product.type as keyof typeof PRODUCT_TYPE_LABELS]}
                      </Text>
                    </View>
                    <View
                      className="px-2 py-0.5 rounded"
                      style={{ backgroundColor: `${statusConfig?.color}30` }}
                    >
                      <Text style={{ color: statusConfig?.color, fontSize: 10 }}>
                        {statusConfig?.label}
                      </Text>
                    </View>
                  </View>
                </View>

                {/* Actions */}
                <View className="flex-row">
                  <Pressable
                    onPress={() => handleEditProduct(product)}
                    className="p-2 rounded-lg mr-1"
                    style={{ backgroundColor: `${COLORS.accent.sky}20` }}
                  >
                    <Edit3 size={16} color={COLORS.accent.sky} />
                  </Pressable>
                  <Pressable
                    onPress={() => handleDeleteProduct(product)}
                    className="p-2 rounded-lg"
                    style={{ backgroundColor: `${COLORS.accent.red}20` }}
                  >
                    <Trash2 size={16} color={COLORS.accent.red} />
                  </Pressable>
                </View>
              </View>

              {/* Prix et visibilité */}
              <View className="flex-row items-center justify-between mt-2">
                <View className="flex-row items-center">
                  <Text style={{ color: COLORS.primary.brightYellow }} className="font-bold">
                    {product.price_public?.toFixed(2)}€
                  </Text>
                  {product.price_pro && (
                    <Text style={{ color: COLORS.accent.teal, fontSize: 12 }} className="ml-2">
                      Pro: {product.price_pro.toFixed(2)}€
                    </Text>
                  )}
                </View>
                <View className="flex-row items-center">
                  {product.visible_for_clients && (
                    <View className="flex-row items-center mr-2">
                      <Eye size={12} color={COLORS.accent.hemp} />
                      <Text style={{ color: COLORS.accent.hemp, fontSize: 10 }} className="ml-1">
                        Client
                      </Text>
                    </View>
                  )}
                  {product.visible_for_pros && (
                    <View className="flex-row items-center">
                      <Eye size={12} color={COLORS.accent.teal} />
                      <Text style={{ color: COLORS.accent.teal, fontSize: 10 }} className="ml-1">
                        Pro
                      </Text>
                    </View>
                  )}
                </View>
              </View>

              {/* Stock */}
              {product.stock !== null && (
                <Text
                  style={{
                    color: product.stock > 0 ? COLORS.text.muted : COLORS.accent.red,
                    fontSize: 11,
                  }}
                  className="mt-1"
                >
                  Stock: {product.stock} unités
                </Text>
              )}
            </View>
          </View>
        </Pressable>
      </Animated.View>
    );
  };

  // Render du formulaire produit
  const renderProductForm = () => (
    <Modal
      visible={showProductModal}
      animationType="slide"
      transparent
      onRequestClose={() => setShowProductModal(false)}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 0}
      >
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.8)', justifyContent: 'flex-end' }}>
          <View
            style={{
              backgroundColor: COLORS.background.charcoal,
              paddingBottom: insets.bottom + 20,
              borderTopLeftRadius: 24,
              borderTopRightRadius: 24,
              flex: Platform.OS === 'android' ? 0.9 : undefined,
              maxHeight: Platform.OS === 'ios' ? '90%' : undefined,
            }}
          >
            {/* Header */}
            <View
              className="flex-row items-center justify-between px-5 py-4"
              style={{ borderBottomWidth: 1, borderBottomColor: `${COLORS.primary.gold}20` }}
            >
              <Text style={{ color: COLORS.text.cream }} className="text-xl font-bold">
                {editingProduct ? 'Modifier le produit' : 'Nouveau produit'}
              </Text>
              <Pressable onPress={() => setShowProductModal(false)}>
                <X size={24} color={COLORS.text.muted} />
              </Pressable>
            </View>

            <ScrollView
              style={{ paddingHorizontal: 20, paddingTop: 16 }}
              showsVerticalScrollIndicator={true}
              contentContainerStyle={{ paddingBottom: Platform.OS === 'android' ? 100 : 40 }}
              keyboardShouldPersistTaps="handled"
              nestedScrollEnabled={true}
              bounces={Platform.OS === 'ios'}
            >
              {/* Erreur */}
              {error && (
                <View
                  className="flex-row items-center p-3 rounded-xl mb-4"
                  style={{ backgroundColor: `${COLORS.accent.red}20` }}
                >
                  <AlertCircle size={18} color={COLORS.accent.red} />
                  <Text style={{ color: COLORS.accent.red }} className="ml-2 flex-1">
                    {error}
                  </Text>
                </View>
              )}

              {/* Nom */}
              <View className="mb-4">
                <Text style={{ color: COLORS.text.lightGray }} className="font-medium mb-2">
                  Nom du produit *
                </Text>
                <RNTextInput
                  className="px-4 py-3 rounded-xl"
                  style={{
                    backgroundColor: `${COLORS.text.white}10`,
                    color: COLORS.text.cream,
                  }}
                  placeholder="Ex: Amnesia Haze"
                  placeholderTextColor={COLORS.text.muted}
                  value={formData.name}
                  onChangeText={(text) => setFormData((f) => ({ ...f, name: text }))}
                />
              </View>

              {/* Type */}
              <View className="mb-4">
                <Text style={{ color: COLORS.text.lightGray }} className="font-medium mb-2">
                  Type de produit
                </Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                  {PRODUCT_TYPES.map((type) => (
                    <Pressable
                      key={type}
                      onPress={() => setFormData((f) => ({ ...f, type }))}
                      className="px-4 py-2 rounded-full mr-2"
                      style={{
                        backgroundColor:
                          formData.type === type
                            ? PRODUCT_TYPE_COLORS[type]
                            : `${COLORS.text.muted}20`,
                      }}
                    >
                      <Text
                        style={{
                          color: formData.type === type ? COLORS.text.white : COLORS.text.muted,
                        }}
                      >
                        {PRODUCT_TYPE_LABELS[type]}
                      </Text>
                    </Pressable>
                  ))}
                </ScrollView>
              </View>

              {/* CBD / THC */}
              <View className="flex-row mb-4">
                <View className="flex-1 mr-2">
                  <Text style={{ color: COLORS.text.lightGray }} className="font-medium mb-2">
                    CBD %
                  </Text>
                  <RNTextInput
                    className="px-4 py-3 rounded-xl"
                    style={{
                      backgroundColor: `${COLORS.text.white}10`,
                      color: COLORS.text.cream,
                    }}
                    placeholder="0"
                    placeholderTextColor={COLORS.text.muted}
                    keyboardType="decimal-pad"
                    value={formData.cbd_percent}
                    onChangeText={(text) => setFormData((f) => ({ ...f, cbd_percent: text }))}
                  />
                </View>
                <View className="flex-1 ml-2">
                  <Text style={{ color: COLORS.text.lightGray }} className="font-medium mb-2">
                    THC %
                  </Text>
                  <RNTextInput
                    className="px-4 py-3 rounded-xl"
                    style={{
                      backgroundColor: `${COLORS.text.white}10`,
                      color: COLORS.text.cream,
                    }}
                    placeholder="0"
                    placeholderTextColor={COLORS.text.muted}
                    keyboardType="decimal-pad"
                    value={formData.thc_percent}
                    onChangeText={(text) => setFormData((f) => ({ ...f, thc_percent: text }))}
                  />
                </View>
              </View>

              {/* Prix */}
              <View className="flex-row mb-4">
                <View className="flex-1 mr-2">
                  <Text style={{ color: COLORS.text.lightGray }} className="font-medium mb-2">
                    Prix public * (€)
                  </Text>
                  <RNTextInput
                    className="px-4 py-3 rounded-xl"
                    style={{
                      backgroundColor: `${COLORS.text.white}10`,
                      color: COLORS.text.cream,
                    }}
                    placeholder="0.00"
                    placeholderTextColor={COLORS.text.muted}
                    keyboardType="decimal-pad"
                    value={formData.price_public}
                    onChangeText={(text) => setFormData((f) => ({ ...f, price_public: text }))}
                  />
                </View>
                <View className="flex-1 ml-2">
                  <Text style={{ color: COLORS.text.lightGray }} className="font-medium mb-2">
                    Prix pro (€)
                  </Text>
                  <RNTextInput
                    className="px-4 py-3 rounded-xl"
                    style={{
                      backgroundColor: `${COLORS.text.white}10`,
                      color: COLORS.text.cream,
                    }}
                    placeholder="Optionnel"
                    placeholderTextColor={COLORS.text.muted}
                    keyboardType="decimal-pad"
                    value={formData.price_pro}
                    onChangeText={(text) => setFormData((f) => ({ ...f, price_pro: text }))}
                  />
                </View>
              </View>

              {/* TVA */}
              <View className="mb-4 p-4 rounded-xl" style={{ backgroundColor: `${COLORS.text.white}05`, borderWidth: 1.5, borderColor: `${COLORS.primary.gold}25` }}>
                <View className="flex-row items-center justify-between">
                  <View className="flex-1">
                    <Text style={{ color: COLORS.text.lightGray }} className="font-medium">
                      TVA (%)
                    </Text>
                    <Text style={{ color: COLORS.text.muted }} className="text-xs mt-1">
                      Activez “Sans TVA” si le producteur n’est pas assujetti
                    </Text>
                  </View>
                  <View className="flex-row items-center">
                    <Text style={{ color: COLORS.text.muted }} className="text-xs mr-2">
                      Sans TVA
                    </Text>
                    <Switch
                      value={isNoTva}
                      onValueChange={(v) => {
                        setFormData((f) => ({
                          ...f,
                          tva_rate: v ? '0' : (f.tva_rate && f.tva_rate !== '0' ? f.tva_rate : '20'),
                        }));
                      }}
                      trackColor={{ false: COLORS.text.muted, true: `${COLORS.accent.teal}80` }}
                      thumbColor={isNoTva ? COLORS.accent.teal : COLORS.text.lightGray}
                    />
                  </View>
                </View>

                <View className="mt-3">
                  <RNTextInput
                    className="px-4 py-3 rounded-xl"
                    style={{
                      backgroundColor: isNoTva ? `${COLORS.text.white}05` : `${COLORS.text.white}10`,
                      color: isNoTva ? COLORS.text.muted : COLORS.text.cream,
                    }}
                    placeholder="20"
                    placeholderTextColor={COLORS.text.muted}
                    keyboardType="decimal-pad"
                    value={formData.tva_rate}
                    editable={!isNoTva}
                    onChangeText={(text) => setFormData((f) => ({ ...f, tva_rate: text }))}
                  />
                </View>
              </View>

              {/* Poids et Stock */}
              <View className="flex-row mb-4">
                <View className="flex-1 mr-2">
                  <Text style={{ color: COLORS.text.lightGray }} className="font-medium mb-2">
                    Poids/Conditionnement
                  </Text>
                  <RNTextInput
                    className="px-4 py-3 rounded-xl"
                    style={{
                      backgroundColor: `${COLORS.text.white}10`,
                      color: COLORS.text.cream,
                    }}
                    placeholder="Ex: 5g, 10ml"
                    placeholderTextColor={COLORS.text.muted}
                    value={formData.weight}
                    onChangeText={(text) => setFormData((f) => ({ ...f, weight: text }))}
                  />
                </View>
                <View className="flex-1 ml-2">
                  <Text style={{ color: COLORS.text.lightGray }} className="font-medium mb-2">
                    Stock
                  </Text>
                  <RNTextInput
                    className="px-4 py-3 rounded-xl"
                    style={{
                      backgroundColor: `${COLORS.text.white}10`,
                      color: COLORS.text.cream,
                    }}
                    placeholder="Illimité"
                    placeholderTextColor={COLORS.text.muted}
                    keyboardType="number-pad"
                    value={formData.stock}
                    onChangeText={(text) => setFormData((f) => ({ ...f, stock: text }))}
                  />
                </View>
              </View>

              {/* Tarification par paliers (prix dégressifs) */}
              <View
                className="mb-4 p-4 rounded-xl"
                style={{
                  backgroundColor: formData.enablePriceTiers ? `${COLORS.primary.brightYellow}15` : `${COLORS.text.white}05`,
                  borderWidth: 1.5,
                  borderColor: formData.enablePriceTiers ? `${COLORS.primary.brightYellow}50` : `${COLORS.primary.gold}25`,
                }}
              >
                <View className="flex-row items-center justify-between">
                  <View className="flex-row items-center flex-1">
                    <Layers size={16} color={formData.enablePriceTiers ? COLORS.primary.brightYellow : COLORS.text.muted} />
                    <View className="ml-2 flex-1">
                      <Text
                        style={{ color: formData.enablePriceTiers ? COLORS.primary.brightYellow : COLORS.text.lightGray }}
                        className="text-sm font-bold"
                      >
                        Prix dégressifs selon quantité
                      </Text>
                      <Text style={{ color: COLORS.text.muted }} className="text-xs">
                        Offrez de meilleurs prix pour les grosses commandes
                      </Text>
                    </View>
                  </View>
                  <Switch
                    value={formData.enablePriceTiers}
                    onValueChange={(v) => {
                      setFormData((f) => ({ ...f, enablePriceTiers: v }));
                      if (v && formData.priceTiers.length === 0) {
                        addPriceTier();
                      }
                    }}
                    trackColor={{ false: COLORS.text.muted, true: `${COLORS.primary.brightYellow}80` }}
                    thumbColor={formData.enablePriceTiers ? COLORS.primary.brightYellow : COLORS.text.lightGray}
                  />
                </View>

                {formData.enablePriceTiers && (
                  <View className="mt-4">
                    {/* Info explicatif */}
                    <View
                      className="rounded-lg p-3 mb-3"
                      style={{ backgroundColor: `${COLORS.primary.gold}10` }}
                    >
                      <Text style={{ color: COLORS.text.muted }} className="text-xs">
                        Prix de base : {formData.price_public || '0'}€ / {formData.weight || 'unité'}
                      </Text>
                      <Text style={{ color: COLORS.text.muted }} className="text-xs mt-1">
                        Ajoutez des paliers pour offrir des réductions sur les quantités.
                      </Text>
                    </View>

                    {/* Liste des paliers */}
                    {formData.priceTiers.map((tier, index) => (
                      <View
                        key={index}
                        className="flex-row items-center mb-3"
                      >
                        <View className="flex-1 mr-2">
                          <Text style={{ color: COLORS.text.muted }} className="text-xs mb-1">
                            À partir de
                          </Text>
                          <RNTextInput
                            value={tier.minQuantity}
                            onChangeText={(v) => updatePriceTier(index, 'minQuantity', v)}
                            placeholder="5"
                            placeholderTextColor={COLORS.text.muted}
                            keyboardType="number-pad"
                            className="rounded-lg px-3 py-2.5"
                            style={{
                              backgroundColor: COLORS.background.charcoal,
                              borderWidth: 1.5,
                              borderColor: `${COLORS.primary.brightYellow}30`,
                              color: COLORS.text.cream,
                            }}
                          />
                        </View>
                        <View className="flex-1 mr-2">
                          <Text style={{ color: COLORS.text.muted }} className="text-xs mb-1">
                            Prix unitaire (€)
                          </Text>
                          <RNTextInput
                            value={tier.price}
                            onChangeText={(v) => updatePriceTier(index, 'price', v)}
                            placeholder="7.50"
                            placeholderTextColor={COLORS.text.muted}
                            keyboardType="decimal-pad"
                            className="rounded-lg px-3 py-2.5"
                            style={{
                              backgroundColor: COLORS.background.charcoal,
                              borderWidth: 1.5,
                              borderColor: `${COLORS.primary.brightYellow}30`,
                              color: COLORS.text.cream,
                            }}
                          />
                        </View>
                        <Pressable
                          onPress={() => removePriceTier(index)}
                          className="p-2 rounded-lg mt-4"
                          style={{ backgroundColor: `${COLORS.accent.red}20` }}
                        >
                          <Trash2 size={18} color={COLORS.accent.red} />
                        </Pressable>
                      </View>
                    ))}

                    {/* Bouton ajouter un palier */}
                    <Pressable
                      onPress={addPriceTier}
                      className="flex-row items-center justify-center py-3 rounded-xl"
                      style={{
                        backgroundColor: COLORS.background.charcoal,
                        borderWidth: 1.5,
                        borderColor: `${COLORS.primary.brightYellow}40`,
                        borderStyle: 'dashed',
                      }}
                    >
                      <Plus size={18} color={COLORS.primary.brightYellow} />
                      <Text style={{ color: COLORS.primary.brightYellow }} className="font-medium ml-2">
                        Ajouter un palier
                      </Text>
                    </Pressable>

                    {/* Prévisualisation des paliers */}
                    {formData.priceTiers.length > 0 && formData.price_public && (
                      <View
                        className="mt-4 rounded-lg p-3"
                        style={{ backgroundColor: `${COLORS.accent.hemp}15` }}
                      >
                        <Text style={{ color: COLORS.accent.hemp }} className="text-xs font-bold mb-2">
                          Récapitulatif des prix
                        </Text>
                        <View className="flex-row items-center mb-1">
                          <Text style={{ color: COLORS.text.muted }} className="text-xs flex-1">
                            1 - {formData.priceTiers[0]?.minQuantity ? parseInt(formData.priceTiers[0].minQuantity, 10) - 1 : '∞'} unités
                          </Text>
                          <Text style={{ color: COLORS.text.cream }} className="text-xs font-medium">
                            {formData.price_public}€ / unité
                          </Text>
                        </View>
                        {formData.priceTiers
                          .filter((t) => t.minQuantity && t.price)
                          .sort((a, b) => parseInt(a.minQuantity, 10) - parseInt(b.minQuantity, 10))
                          .map((tier, idx, arr) => {
                            const nextTier = arr[idx + 1];
                            const maxQty = nextTier ? parseInt(nextTier.minQuantity, 10) - 1 : '∞';
                            const basePrice = parseFloat(formData.price_public) || 0;
                            const tierPrice = parseFloat(tier.price) || 0;
                            const discount = basePrice > 0 ? Math.round((1 - tierPrice / basePrice) * 100) : 0;
                            return (
                              <View key={idx} className="flex-row items-center mb-1">
                                <Text style={{ color: COLORS.text.muted }} className="text-xs flex-1">
                                  {tier.minQuantity} - {maxQty} unités
                                </Text>
                                <Text style={{ color: COLORS.accent.hemp }} className="text-xs font-medium">
                                  {tier.price}€ / unité
                                  {discount > 0 && (
                                    <Text style={{ color: COLORS.accent.hemp }}> (-{discount}%)</Text>
                                  )}
                                </Text>
                              </View>
                            );
                          })}
                      </View>
                    )}
                  </View>
                )}
              </View>

              {/* Tarification par paliers PROS (prix dégressifs) */}
              <View
                className="mb-4 p-4 rounded-xl"
                style={{
                  backgroundColor: formData.enablePriceProTiers ? `#14B8A615` : `${COLORS.text.white}05`,
                  borderWidth: 1.5,
                  borderColor: formData.enablePriceProTiers ? `#14B8A650` : `${COLORS.primary.gold}25`,
                }}
              >
                <View className="flex-row items-center justify-between">
                  <View className="flex-row items-center flex-1">
                    <Layers size={16} color={formData.enablePriceProTiers ? '#14B8A6' : COLORS.text.muted} />
                    <View className="ml-2 flex-1">
                      <Text
                        style={{ color: formData.enablePriceProTiers ? '#14B8A6' : COLORS.text.lightGray }}
                        className="text-sm font-bold"
                      >
                        Prix dégressifs PROS
                      </Text>
                      <Text style={{ color: COLORS.text.muted }} className="text-xs">
                        Tarifs spéciaux pour les professionnels
                      </Text>
                    </View>
                  </View>
                  <Switch
                    value={formData.enablePriceProTiers}
                    onValueChange={(v) => {
                      setFormData((f) => ({ ...f, enablePriceProTiers: v }));
                      if (v && formData.priceProTiers.length === 0) {
                        addPriceProTier();
                      }
                    }}
                    trackColor={{ false: COLORS.text.muted, true: `#14B8A680` }}
                    thumbColor={formData.enablePriceProTiers ? '#14B8A6' : COLORS.text.lightGray}
                  />
                </View>

                {formData.enablePriceProTiers && (
                  <View className="mt-4">
                    {/* Info explicatif */}
                    <View
                      className="rounded-lg p-3 mb-3"
                      style={{ backgroundColor: `#14B8A610` }}
                    >
                      <Text style={{ color: COLORS.text.muted }} className="text-xs">
                        Prix de base Pro : {formData.price_pro || '0'}€ / {formData.weight || 'unité'}
                      </Text>
                      <Text style={{ color: COLORS.text.muted }} className="text-xs mt-1">
                        Ajoutez des paliers pour offrir des réductions aux pros sur les quantités.
                      </Text>
                    </View>

                    {/* Liste des paliers pros */}
                    {formData.priceProTiers.map((tier, index) => (
                      <View
                        key={index}
                        className="flex-row items-center mb-3"
                      >
                        <View className="flex-1 mr-2">
                          <Text style={{ color: COLORS.text.muted }} className="text-xs mb-1">
                            À partir de
                          </Text>
                          <RNTextInput
                            value={tier.minQuantity}
                            onChangeText={(v) => updatePriceProTier(index, 'minQuantity', v)}
                            placeholder="5"
                            placeholderTextColor={COLORS.text.muted}
                            keyboardType="number-pad"
                            className="rounded-lg px-3 py-2.5"
                            style={{
                              backgroundColor: COLORS.background.charcoal,
                              borderWidth: 1.5,
                              borderColor: `#14B8A630`,
                              color: COLORS.text.cream,
                            }}
                          />
                        </View>
                        <View className="flex-1 mr-2">
                          <Text style={{ color: COLORS.text.muted }} className="text-xs mb-1">
                            Prix unitaire (€)
                          </Text>
                          <RNTextInput
                            value={tier.price}
                            onChangeText={(v) => updatePriceProTier(index, 'price', v)}
                            placeholder="6.00"
                            placeholderTextColor={COLORS.text.muted}
                            keyboardType="decimal-pad"
                            className="rounded-lg px-3 py-2.5"
                            style={{
                              backgroundColor: COLORS.background.charcoal,
                              borderWidth: 1.5,
                              borderColor: `#14B8A630`,
                              color: COLORS.text.cream,
                            }}
                          />
                        </View>
                        <Pressable
                          onPress={() => removePriceProTier(index)}
                          className="p-2 rounded-lg mt-4"
                          style={{ backgroundColor: `${COLORS.accent.red}20` }}
                        >
                          <Trash2 size={18} color={COLORS.accent.red} />
                        </Pressable>
                      </View>
                    ))}

                    {/* Bouton ajouter un palier pro */}
                    <Pressable
                      onPress={addPriceProTier}
                      className="flex-row items-center justify-center py-3 rounded-xl"
                      style={{
                        backgroundColor: COLORS.background.charcoal,
                        borderWidth: 1.5,
                        borderColor: `#14B8A640`,
                        borderStyle: 'dashed',
                      }}
                    >
                      <Plus size={18} color="#14B8A6" />
                      <Text style={{ color: '#14B8A6' }} className="font-medium ml-2">
                        Ajouter un palier pro
                      </Text>
                    </Pressable>

                    {/* Prévisualisation des paliers pros */}
                    {formData.priceProTiers.length > 0 && formData.price_pro && (
                      <View
                        className="mt-4 rounded-lg p-3"
                        style={{ backgroundColor: `#14B8A615` }}
                      >
                        <Text style={{ color: '#14B8A6' }} className="text-xs font-bold mb-2">
                          Récapitulatif des prix PROS
                        </Text>
                        <View className="flex-row items-center mb-1">
                          <Text style={{ color: COLORS.text.muted }} className="text-xs flex-1">
                            1 - {formData.priceProTiers[0]?.minQuantity ? parseInt(formData.priceProTiers[0].minQuantity, 10) - 1 : '∞'} unités
                          </Text>
                          <Text style={{ color: COLORS.text.cream }} className="text-xs font-medium">
                            {formData.price_pro}€ / unité
                          </Text>
                        </View>
                        {formData.priceProTiers
                          .filter((t) => t.minQuantity && t.price)
                          .sort((a, b) => parseInt(a.minQuantity, 10) - parseInt(b.minQuantity, 10))
                          .map((tier, idx, arr) => {
                            const nextTier = arr[idx + 1];
                            const maxQty = nextTier ? parseInt(nextTier.minQuantity, 10) - 1 : '∞';
                            const basePrice = parseFloat(formData.price_pro) || 0;
                            const tierPrice = parseFloat(tier.price) || 0;
                            const discount = basePrice > 0 ? Math.round((1 - tierPrice / basePrice) * 100) : 0;
                            return (
                              <View key={idx} className="flex-row items-center mb-1">
                                <Text style={{ color: COLORS.text.muted }} className="text-xs flex-1">
                                  {tier.minQuantity} - {maxQty} unités
                                </Text>
                                <Text style={{ color: '#14B8A6' }} className="text-xs font-medium">
                                  {tier.price}€ / unité
                                  {discount > 0 && (
                                    <Text style={{ color: '#14B8A6' }}> (-{discount}%)</Text>
                                  )}
                                </Text>
                              </View>
                            );
                          })}
                      </View>
                    )}
                  </View>
                )}
              </View>

              {/* Photos du produit */}
              <View className="mb-4">
                <View className="flex-row items-center justify-between mb-2">
                  <Text style={{ color: COLORS.text.lightGray }} className="font-medium">
                    Photos du produit
                  </Text>
                  <Text style={{ color: COLORS.text.muted }} className="text-xs">
                    {formData.images.length}/3
                  </Text>
                </View>

                {/* Vignettes */}
                <View className="flex-row flex-wrap mb-3">
                  {formData.images.map((uri, index) => (
                    <View
                      key={`${uri}-${index}`}
                      className="mr-3 mb-3 rounded-xl overflow-hidden"
                      style={{
                        width: 96,
                        height: 96,
                        borderWidth: 2,
                        borderColor: `${COLORS.primary.gold}30`,
                      }}
                    >
                      <Image source={{ uri }} style={{ width: '100%', height: '100%' }} />
                      <Pressable
                        onPress={() => removeImageFromForm(index)}
                        className="absolute top-1 right-1 p-1.5 rounded-full"
                        style={{ backgroundColor: 'rgba(239, 68, 68, 0.9)' }}
                      >
                        <Trash2 size={14} color="#fff" />
                      </Pressable>
                      {index === 0 && (
                        <View
                          className="absolute bottom-0 left-0 right-0 py-1"
                          style={{ backgroundColor: 'rgba(0,0,0,0.6)' }}
                        >
                          <Text className="text-white text-xs text-center">Principale</Text>
                        </View>
                      )}
                    </View>
                  ))}

                  {formData.images.length < 3 && (
                    <View
                      className="items-center justify-center rounded-xl"
                      style={{
                        width: 96,
                        height: 96,
                        borderWidth: 2,
                        borderColor: `${COLORS.primary.gold}30`,
                        borderStyle: 'dashed',
                        backgroundColor: `${COLORS.background.charcoal}50`,
                      }}
                    >
                      <ImagePlus size={22} color={COLORS.text.muted} />
                      <Text style={{ color: COLORS.text.muted }} className="text-xs mt-1">
                        Ajouter
                      </Text>
                    </View>
                  )}
                </View>

                {/* Boutons d'action pour ajouter une image */}
                <View className="flex-row gap-2">
                  <Pressable
                    onPress={takePhoto}
                    className="flex-1 flex-row items-center justify-center py-3 rounded-xl"
                    style={{ backgroundColor: COLORS.primary.gold }}
                  >
                    <Camera size={18} color={COLORS.text.dark} />
                    <Text style={{ color: COLORS.text.dark }} className="font-bold ml-2">
                      Photo
                    </Text>
                  </Pressable>

                  <Pressable
                    onPress={pickFromGallery}
                    className="flex-1 flex-row items-center justify-center py-3 rounded-xl"
                    style={{
                      backgroundColor: `${COLORS.accent.teal}20`,
                      borderWidth: 2,
                      borderColor: COLORS.accent.teal,
                    }}
                  >
                    <ImagePlus size={18} color={COLORS.accent.teal} />
                    <Text style={{ color: COLORS.accent.teal }} className="font-bold ml-2">
                      Galerie
                    </Text>
                  </Pressable>
                </View>

                {uploadingImage && (
                  <View
                    className="flex-row items-center mt-2 p-2 rounded-lg"
                    style={{ backgroundColor: `${COLORS.accent.teal}15` }}
                  >
                    <ActivityIndicator size="small" color={COLORS.accent.teal} />
                    <Text style={{ color: COLORS.accent.teal }} className="text-xs ml-2">
                      Upload des photos en cours...
                    </Text>
                  </View>
                )}

                <View
                  className="mt-3 p-3 rounded-lg"
                  style={{ backgroundColor: `${COLORS.background.charcoal}50` }}
                >
                  <Text style={{ color: COLORS.text.muted }} className="text-xs text-center">
                    Ajoutez jusqu’à 3 photos par produit. La première sera utilisée comme image principale.
                  </Text>
                </View>
              </View>

              {/* Description */}
              <View className="mb-4">
                <Text style={{ color: COLORS.text.lightGray }} className="font-medium mb-2">
                  Description
                </Text>
                <RNTextInput
                  className="px-4 py-3 rounded-xl"
                  style={{
                    backgroundColor: `${COLORS.text.white}10`,
                    color: COLORS.text.cream,
                    minHeight: 80,
                  }}
                  placeholder="Décrivez votre produit..."
                  placeholderTextColor={COLORS.text.muted}
                  multiline
                  value={formData.description}
                  onChangeText={(text) => setFormData((f) => ({ ...f, description: text }))}
                />
              </View>

              {/* Analyse de laboratoire */}
              <LabAnalysisUploader
                value={formData.lab_analysis_url || null}
                uploading={uploadingLabAnalysis}
                onUpload={async (uri, fileName, mimeType) => {
                  if (!producer) {
                    setFormData((f) => ({ ...f, lab_analysis_url: uri }));
                    return;
                  }

                  try {
                    setUploadingLabAnalysis(true);
                    if (isLabAnalysesConfigured()) {
                      const tempProductId = editingProduct?.id || `new-${Date.now()}`;
                      const publicUrl = await uploadLabAnalysis(
                        uri,
                        producer.id,
                        tempProductId,
                        fileName,
                        mimeType
                      );
                      setFormData((f) => ({ ...f, lab_analysis_url: publicUrl }));
                    } else {
                      setFormData((f) => ({ ...f, lab_analysis_url: uri }));
                    }
                  } catch (error: any) {
                    console.error('[MaBoutique] Lab analysis upload error:', error);
                    Alert.alert('Erreur upload', error?.message || 'Impossible d\'uploader l\'analyse de laboratoire');
                    setFormData((f) => ({ ...f, lab_analysis_url: uri }));
                  } finally {
                    setUploadingLabAnalysis(false);
                  }
                }}
                onRemove={() => {
                  setFormData((f) => ({ ...f, lab_analysis_url: '' }));
                }}
              />

              {/* Statut */}
              <View className="mb-4">
                <Text style={{ color: COLORS.text.lightGray }} className="font-medium mb-2">
                  Statut
                </Text>
                <View className="flex-row">
                  {STATUS_OPTIONS.map((status) => (
                    <Pressable
                      key={status.value}
                      onPress={() => setFormData((f) => ({ ...f, status: status.value }))}
                      className="px-4 py-2 rounded-full mr-2"
                      style={{
                        backgroundColor:
                          formData.status === status.value ? status.color : `${COLORS.text.muted}20`,
                      }}
                    >
                      <Text
                        style={{
                          color:
                            formData.status === status.value ? COLORS.text.white : COLORS.text.muted,
                        }}
                      >
                        {status.label}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              </View>

              {/* Visibilité */}
              <View className="mb-6">
                <Text style={{ color: COLORS.text.lightGray }} className="font-medium mb-3">
                  Visibilité
                </Text>
                <View
                  className="flex-row items-center justify-between p-3 rounded-xl mb-2"
                  style={{ backgroundColor: `${COLORS.text.white}10` }}
                >
                  <View className="flex-row items-center">
                    <Eye size={18} color={COLORS.accent.hemp} />
                    <Text style={{ color: COLORS.text.cream }} className="ml-2">
                      Visible pour les clients
                    </Text>
                  </View>
                  <Switch
                    value={formData.visible_for_clients}
                    onValueChange={(value) =>
                      setFormData((f) => ({ ...f, visible_for_clients: value }))
                    }
                    trackColor={{ false: COLORS.text.muted, true: COLORS.accent.hemp }}
                    thumbColor={COLORS.text.white}
                  />
                </View>
                <View
                  className="flex-row items-center justify-between p-3 rounded-xl"
                  style={{ backgroundColor: `${COLORS.text.white}10` }}
                >
                  <View className="flex-row items-center">
                    <Eye size={18} color={COLORS.accent.teal} />
                    <Text style={{ color: COLORS.text.cream }} className="ml-2">
                      Visible pour les pros
                    </Text>
                  </View>
                  <Switch
                    value={formData.visible_for_pros}
                    onValueChange={(value) =>
                      setFormData((f) => ({ ...f, visible_for_pros: value }))
                    }
                    trackColor={{ false: COLORS.text.muted, true: COLORS.accent.teal }}
                    thumbColor={COLORS.text.white}
                  />
                </View>
              </View>

              {/* Vente directe à la ferme */}
              <View className="mb-6">
                <Text style={{ color: COLORS.text.lightGray }} className="font-medium mb-3">
                  Vente directe
                </Text>
                <View
                  className="flex-row items-center justify-between p-3 rounded-xl"
                  style={{ backgroundColor: `${COLORS.accent.hemp}20` }}
                >
                  <View className="flex-row items-center">
                    <Store size={18} color={COLORS.accent.hemp} />
                    <Text style={{ color: COLORS.text.cream }} className="ml-2">
                      Disponible à la ferme
                    </Text>
                  </View>
                  <Switch
                    value={formData.disponible_vente_directe}
                    onValueChange={(value) =>
                      setFormData((f) => ({ ...f, disponible_vente_directe: value }))
                    }
                    trackColor={{ false: COLORS.text.muted, true: COLORS.accent.hemp }}
                    thumbColor={COLORS.text.white}
                  />
                </View>
              </View>

              {/* Mettre en bourse */}
              <View className="mb-6">
                <Text style={{ color: COLORS.text.lightGray }} className="font-medium mb-3">
                  Bourse des produits
                </Text>
                <View
                  className="p-4 rounded-xl"
                  style={{
                    backgroundColor: formData.availableOnBourse ? `${COLORS.primary.gold}15` : `${COLORS.text.white}05`,
                    borderWidth: 1.5,
                    borderColor: formData.availableOnBourse ? `${COLORS.primary.gold}50` : `${COLORS.primary.gold}25`,
                  }}
                >
                  <View className="flex-row items-center justify-between">
                    <View className="flex-row items-center flex-1">
                      <TrendingUp size={18} color={formData.availableOnBourse ? COLORS.primary.gold : COLORS.text.muted} />
                      <View className="ml-2 flex-1">
                        <Text
                          style={{ color: formData.availableOnBourse ? COLORS.primary.gold : COLORS.text.cream }}
                          className="font-medium"
                        >
                          Mettre en bourse
                        </Text>
                        <Text style={{ color: COLORS.text.muted }} className="text-xs">
                          Rendre disponible sur la bourse pro
                        </Text>
                      </View>
                    </View>
                    <Switch
                      value={formData.availableOnBourse}
                      onValueChange={(value) =>
                        setFormData((f) => ({ ...f, availableOnBourse: value }))
                      }
                      trackColor={{ false: COLORS.text.muted, true: `${COLORS.primary.gold}80` }}
                      thumbColor={formData.availableOnBourse ? COLORS.primary.gold : COLORS.text.white}
                    />
                  </View>

                  {formData.availableOnBourse && (
                    <View className="mt-4">
                      <Text style={{ color: COLORS.primary.gold }} className="text-sm font-medium mb-2">
                        Prix de base bourse (€) - optionnel
                      </Text>
                      <Text style={{ color: COLORS.text.muted }} className="text-xs mb-2">
                        Laissez vide pour utiliser le prix pro
                      </Text>
                      <RNTextInput
                        value={formData.bourseBasePrice}
                        onChangeText={(v) => setFormData((f) => ({ ...f, bourseBasePrice: v }))}
                        placeholder={formData.price_pro || formData.price_public || "Prix de référence"}
                        placeholderTextColor={COLORS.text.muted}
                        keyboardType="decimal-pad"
                        className="rounded-xl px-4 py-3"
                        style={{
                          backgroundColor: COLORS.background.charcoal,
                          borderWidth: 1.5,
                          borderColor: `${COLORS.primary.gold}40`,
                          color: COLORS.text.cream,
                        }}
                      />
                      <Text style={{ color: COLORS.text.muted }} className="text-xs mt-2">
                        Le prix variera selon l'offre et la demande.
                      </Text>
                    </View>
                  )}
                </View>
              </View>

              {/* Bouton Sauvegarder */}
              <Pressable
                onPress={handleSaveProduct}
                disabled={saving}
                className="py-4 rounded-xl flex-row items-center justify-center mb-4"
                style={{
                  backgroundColor: saving ? COLORS.text.muted : COLORS.accent.forest,
                }}
              >
                {saving ? (
                  <ActivityIndicator color={COLORS.text.white} />
                ) : (
                  <>
                    <Save size={20} color={COLORS.text.white} />
                    <Text style={{ color: COLORS.text.white }} className="font-bold ml-2">
                      {editingProduct ? 'Enregistrer les modifications' : 'Créer le produit'}
                    </Text>
                  </>
                )}
              </Pressable>
            </ScrollView>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );

  // Render confirmation suppression
  const renderDeleteConfirm = () => (
    <Modal
      visible={showDeleteConfirm}
      transparent
      animationType="fade"
      onRequestClose={() => setShowDeleteConfirm(false)}
    >
      <View className="flex-1 bg-black/80 items-center justify-center px-6">
        <View
          className="w-full max-w-sm rounded-3xl p-6"
          style={{
            backgroundColor: COLORS.background.charcoal,
            borderWidth: 2,
            borderColor: COLORS.accent.red,
          }}
        >
          <View className="items-center mb-4">
            <View
              className="w-16 h-16 rounded-full items-center justify-center mb-3"
              style={{ backgroundColor: `${COLORS.accent.red}20` }}
            >
              <Trash2 size={32} color={COLORS.accent.red} />
            </View>
            <Text style={{ color: COLORS.text.cream }} className="text-xl font-bold text-center">
              Supprimer ce produit ?
            </Text>
          </View>
          <Text style={{ color: COLORS.text.muted }} className="text-center mb-2">
            {productToDelete?.name}
          </Text>
          <Text style={{ color: COLORS.text.muted }} className="text-center mb-6 text-sm">
            Cette action est irréversible.
          </Text>
          <View className="flex-row">
            <Pressable
              onPress={() => setShowDeleteConfirm(false)}
              className="flex-1 py-3 rounded-xl mr-2"
              style={{ backgroundColor: COLORS.background.mediumBlue }}
            >
              <Text style={{ color: COLORS.text.lightGray }} className="text-center font-semibold">
                Annuler
              </Text>
            </Pressable>
            <Pressable
              onPress={confirmDelete}
              disabled={saving}
              className="flex-1 py-3 rounded-xl ml-2"
              style={{ backgroundColor: COLORS.accent.red }}
            >
              {saving ? (
                <ActivityIndicator color={COLORS.text.white} />
              ) : (
                <Text style={{ color: COLORS.text.white }} className="text-center font-semibold">
                  Supprimer
                </Text>
              )}
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );

  // Render order card
  const renderOrderCard = (order: Order, index: number) => {
    const statusConfig = ORDER_STATUS_CONFIG[order.status];
    const orderDate = new Date(order.createdAt).toLocaleDateString('fr-FR', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });

    // Filter items for this producer only
    const producerItems = order.items.filter((item) => item.producerId === producer?.id);
    const producerTotal = producerItems.reduce((sum, item) => sum + item.totalPrice, 0);

    // Status icons based on status
    const getStatusIcon = (status: OrderStatus) => {
      switch (status) {
        case 'pending': return <Clock size={16} color={ORDER_STATUS_CONFIG[status].color} />;
        case 'payment_sent': return <Check size={16} color={ORDER_STATUS_CONFIG[status].color} />;
        case 'paid': return <CheckCircle size={16} color={ORDER_STATUS_CONFIG[status].color} />;
        case 'shipped': return <Truck size={16} color={ORDER_STATUS_CONFIG[status].color} />;
        case 'cancelled': return <XCircle size={16} color={ORDER_STATUS_CONFIG[status].color} />;
        default: return <Clock size={16} color={COLORS.text.muted} />;
      }
    };

    const customerName = `${order.customerInfo.firstName} ${order.customerInfo.lastName}`.trim() || 'Client';

    return (
      <Animated.View
        key={order.id}
        entering={FadeInDown.duration(300).delay(index * 50)}
        className="mb-3"
      >
        <Pressable
          onPress={() => setSelectedOrder(order)}
          className="rounded-2xl overflow-hidden"
          style={{
            backgroundColor: COLORS.background.charcoal,
            borderWidth: 1,
            borderColor: `${statusConfig.color}30`,
          }}
        >
          {/* Header */}
          <View
            className="flex-row items-center justify-between px-4 py-3"
            style={{ backgroundColor: `${statusConfig.color}15` }}
          >
            <View className="flex-row items-center">
              <View
                className="w-8 h-8 rounded-full items-center justify-center mr-2"
                style={{ backgroundColor: `${statusConfig.color}30` }}
              >
                {getStatusIcon(order.status)}
              </View>
              <View>
                <Text style={{ color: COLORS.text.cream }} className="font-bold">
                  #{order.id.slice(-6).toUpperCase()}
                </Text>
                <Text style={{ color: COLORS.text.muted }} className="text-xs">
                  {orderDate}
                </Text>
              </View>
            </View>
            <View
              className="px-3 py-1 rounded-full"
              style={{ backgroundColor: statusConfig.color }}
            >
              <Text style={{ color: COLORS.text.white, fontSize: 11, fontWeight: 'bold' }}>
                {statusConfig.label}
              </Text>
            </View>
          </View>

          {/* Client info */}
          <View className="px-4 py-3" style={{ borderBottomWidth: 1, borderBottomColor: `${COLORS.text.white}10` }}>
            <View className="flex-row items-center mb-1">
              <User size={14} color={COLORS.text.muted} />
              <Text style={{ color: COLORS.text.cream }} className="ml-2 font-medium">
                {customerName}
              </Text>
            </View>
            {order.customerInfo.city && (
              <View className="flex-row items-center">
                <MapPin size={12} color={COLORS.text.muted} />
                <Text style={{ color: COLORS.text.muted }} className="ml-2 text-xs">
                  {order.customerInfo.city}
                </Text>
              </View>
            )}
          </View>

          {/* Products (only this producer's) */}
          <View className="px-4 py-3">
            <Text style={{ color: COLORS.text.muted }} className="text-xs mb-2">
              {producerItems.length} produit{producerItems.length > 1 ? 's' : ''} de votre boutique
            </Text>
            {producerItems.slice(0, 2).map((item, idx) => (
              <View key={idx} className="flex-row items-center justify-between mb-1">
                <Text style={{ color: COLORS.text.lightGray }} className="text-sm flex-1" numberOfLines={1}>
                  {item.quantity}x {item.productName}
                </Text>
                <Text style={{ color: COLORS.primary.paleGold }} className="font-medium">
                  {item.totalPrice.toFixed(2)}€
                </Text>
              </View>
            ))}
            {producerItems.length > 2 && (
              <Text style={{ color: COLORS.text.muted }} className="text-xs">
                +{producerItems.length - 2} autre{producerItems.length - 2 > 1 ? 's' : ''} produit{producerItems.length - 2 > 1 ? 's' : ''}
              </Text>
            )}
          </View>

          {/* Footer with total */}
          <View
            className="flex-row items-center justify-between px-4 py-3"
            style={{ backgroundColor: `${COLORS.text.white}05` }}
          >
            <Text style={{ color: COLORS.text.muted }} className="text-sm">
              Total (vos produits)
            </Text>
            <Text style={{ color: COLORS.primary.brightYellow }} className="font-bold text-lg">
              {producerTotal.toFixed(2)}€
            </Text>
          </View>

          {/* Action hint */}
          <View className="flex-row items-center justify-center py-2" style={{ backgroundColor: `${COLORS.accent.teal}10` }}>
            <Text style={{ color: COLORS.accent.teal }} className="text-xs">
              Appuyer pour gérer la commande
            </Text>
            <ChevronRight size={14} color={COLORS.accent.teal} />
          </View>
        </Pressable>
      </Animated.View>
    );
  };

  // Render order detail modal
  const renderOrderDetailModal = () => {
    if (!selectedOrder) return null;

    const statusConfig = ORDER_STATUS_CONFIG[selectedOrder.status];
    const producerItems = selectedOrder.items.filter((item) => item.producerId === producer?.id);
    const producerTotal = producerItems.reduce((sum, item) => sum + item.totalPrice, 0);

    const statusOptions: OrderStatus[] = ['pending', 'payment_sent', 'paid', 'shipped', 'cancelled'];

    // Status icons based on status
    const getStatusIcon = (status: OrderStatus) => {
      switch (status) {
        case 'pending': return <Clock size={16} color={ORDER_STATUS_CONFIG[status].color} />;
        case 'payment_sent': return <Check size={16} color={ORDER_STATUS_CONFIG[status].color} />;
        case 'paid': return <CheckCircle size={16} color={ORDER_STATUS_CONFIG[status].color} />;
        case 'shipped': return <Truck size={16} color={ORDER_STATUS_CONFIG[status].color} />;
        case 'cancelled': return <XCircle size={16} color={ORDER_STATUS_CONFIG[status].color} />;
        default: return <Clock size={16} color={COLORS.text.muted} />;
      }
    };

    const customerName = `${selectedOrder.customerInfo.firstName} ${selectedOrder.customerInfo.lastName}`.trim() || 'Client';

    return (
      <Modal
        visible={!!selectedOrder}
        animationType="slide"
        transparent
        onRequestClose={() => setSelectedOrder(null)}
      >
        <View className="flex-1 bg-black/80 justify-end">
          <View
            className="rounded-t-3xl max-h-[90%]"
            style={{
              backgroundColor: COLORS.background.charcoal,
              paddingBottom: insets.bottom + 20,
            }}
          >
            {/* Header */}
            <View
              className="flex-row items-center justify-between px-5 py-4"
              style={{ borderBottomWidth: 1, borderBottomColor: `${COLORS.primary.gold}20` }}
            >
              <View>
                <Text style={{ color: COLORS.text.cream }} className="text-xl font-bold">
                  Commande #{selectedOrder.id.slice(-6).toUpperCase()}
                </Text>
                <Text style={{ color: COLORS.text.muted }} className="text-sm">
                  {new Date(selectedOrder.createdAt).toLocaleDateString('fr-FR', {
                    day: 'numeric',
                    month: 'long',
                    year: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </Text>
              </View>
              <Pressable
                onPress={() => setSelectedOrder(null)}
                className="w-10 h-10 rounded-full items-center justify-center"
                style={{ backgroundColor: `${COLORS.text.white}10` }}
              >
                <X size={20} color={COLORS.text.muted} />
              </Pressable>
            </View>

            <ScrollView className="px-5" showsVerticalScrollIndicator={false}>
              {/* Current Status */}
              <View className="py-4">
                <Text style={{ color: COLORS.text.lightGray }} className="font-medium mb-3">
                  Statut actuel
                </Text>
                <View
                  className="flex-row items-center p-4 rounded-xl"
                  style={{ backgroundColor: `${statusConfig.color}20` }}
                >
                  {getStatusIcon(selectedOrder.status)}
                  <Text style={{ color: statusConfig.color }} className="font-bold text-lg ml-3">
                    {statusConfig.label}
                  </Text>
                </View>
              </View>

              {/* Change Status */}
              <View className="py-4">
                <Text style={{ color: COLORS.text.lightGray }} className="font-medium mb-3">
                  Changer le statut
                </Text>
                <View className="flex-row flex-wrap" style={{ gap: 8 }}>
                  {statusOptions.map((status) => {
                    const config = ORDER_STATUS_CONFIG[status];
                    const isActive = selectedOrder.status === status;
                    return (
                      <Pressable
                        key={status}
                        onPress={() => {
                          handleOrderStatusChange(selectedOrder.id, status);
                          setSelectedOrder({ ...selectedOrder, status });
                        }}
                        className="px-4 py-2 rounded-full flex-row items-center"
                        style={{
                          backgroundColor: isActive ? config.color : `${config.color}20`,
                          borderWidth: isActive ? 0 : 1,
                          borderColor: `${config.color}50`,
                        }}
                      >
                        {getStatusIcon(status)}
                        <Text
                          style={{
                            color: isActive ? COLORS.text.white : config.color,
                            fontSize: 12,
                            fontWeight: 'bold',
                            marginLeft: 6,
                          }}
                        >
                          {config.label}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>

              {/* Customer Info */}
              <View className="py-4">
                <Text style={{ color: COLORS.text.lightGray }} className="font-medium mb-3">
                  Informations client
                </Text>
                <View
                  className="rounded-xl p-4"
                  style={{ backgroundColor: `${COLORS.text.white}05` }}
                >
                  <View className="flex-row items-center mb-3">
                    <User size={18} color={COLORS.accent.teal} />
                    <Text style={{ color: COLORS.text.cream }} className="font-medium ml-3">
                      {customerName}
                    </Text>
                  </View>
                  {selectedOrder.customerInfo.email && (
                    <View className="flex-row items-center mb-3">
                      <Mail size={16} color={COLORS.text.muted} />
                      <Text style={{ color: COLORS.text.lightGray }} className="ml-3">
                        {selectedOrder.customerInfo.email}
                      </Text>
                    </View>
                  )}
                  {selectedOrder.customerInfo.phone && (
                    <View className="flex-row items-center mb-3">
                      <Phone size={16} color={COLORS.text.muted} />
                      <Text style={{ color: COLORS.text.lightGray }} className="ml-3">
                        {selectedOrder.customerInfo.phone}
                      </Text>
                    </View>
                  )}
                  {selectedOrder.customerInfo.address && (
                    <View className="flex-row items-start">
                      <MapPin size={16} color={COLORS.text.muted} />
                      <Text style={{ color: COLORS.text.lightGray }} className="ml-3 flex-1">
                        {selectedOrder.customerInfo.address}
                        {selectedOrder.customerInfo.city && `, ${selectedOrder.customerInfo.city}`}
                        {selectedOrder.customerInfo.postalCode && ` ${selectedOrder.customerInfo.postalCode}`}
                      </Text>
                    </View>
                  )}
                </View>
              </View>

              {/* Products from this producer */}
              <View className="py-4">
                <Text style={{ color: COLORS.text.lightGray }} className="font-medium mb-3">
                  Vos produits dans cette commande
                </Text>
                <View
                  className="rounded-xl overflow-hidden"
                  style={{ backgroundColor: `${COLORS.text.white}05` }}
                >
                  {producerItems.map((item, idx) => (
                    <View
                      key={idx}
                      className="flex-row items-center justify-between px-4 py-3"
                      style={{
                        borderBottomWidth: idx < producerItems.length - 1 ? 1 : 0,
                        borderBottomColor: `${COLORS.text.white}10`,
                      }}
                    >
                      <View className="flex-1 mr-3">
                        <Text style={{ color: COLORS.text.cream }} className="font-medium">
                          {item.productName}
                        </Text>
                        <Text style={{ color: COLORS.text.muted }} className="text-xs">
                          {item.quantity} x {item.unitPrice.toFixed(2)}€
                        </Text>
                      </View>
                      <Text style={{ color: COLORS.primary.paleGold }} className="font-bold">
                        {item.totalPrice.toFixed(2)}€
                      </Text>
                    </View>
                  ))}
                  <View
                    className="flex-row items-center justify-between px-4 py-3"
                    style={{ backgroundColor: `${COLORS.primary.gold}10` }}
                  >
                    <Text style={{ color: COLORS.primary.gold }} className="font-bold">
                      Total (vos produits)
                    </Text>
                    <Text style={{ color: COLORS.primary.brightYellow }} className="font-bold text-lg">
                      {producerTotal.toFixed(2)}€
                    </Text>
                  </View>
                </View>
              </View>

              {/* Tracking Number */}
              {(selectedOrder.status === 'shipped' || selectedOrder.status === 'paid') && (
                <View className="py-4">
                  <Text style={{ color: COLORS.text.lightGray }} className="font-medium mb-3">
                    Numéro de suivi
                  </Text>
                  <View className="flex-row items-center">
                    <RNTextInput
                      className="flex-1 rounded-xl px-4 py-3 mr-2"
                      style={{
                        backgroundColor: `${COLORS.text.white}10`,
                        color: COLORS.text.cream,
                      }}
                      placeholder="Entrer le numéro de suivi..."
                      placeholderTextColor={COLORS.text.muted}
                      value={selectedOrder.trackingNumber || ''}
                      onChangeText={(text) => {
                        setSelectedOrder({ ...selectedOrder, trackingNumber: text });
                      }}
                      onBlur={() => {
                        if (selectedOrder.trackingNumber) {
                          handleTrackingNumberUpdate(selectedOrder.id, selectedOrder.trackingNumber);
                        }
                      }}
                    />
                    <Pressable
                      onPress={() => {
                        if (selectedOrder.trackingNumber) {
                          handleTrackingNumberUpdate(selectedOrder.id, selectedOrder.trackingNumber);
                        }
                      }}
                      className="w-12 h-12 rounded-xl items-center justify-center"
                      style={{ backgroundColor: COLORS.accent.forest }}
                    >
                      <Check size={20} color={COLORS.text.white} />
                    </Pressable>
                  </View>
                </View>
              )}

              <View style={{ height: 20 }} />
            </ScrollView>
          </View>
        </View>
      </Modal>
    );
  };

  // État de chargement
  if (loading) {
    return (
      <View
        className="flex-1 items-center justify-center"
        style={{ backgroundColor: COLORS.background.dark }}
      >
        <ActivityIndicator size="large" color={COLORS.primary.gold} />
        <Text style={{ color: COLORS.text.muted }} className="mt-4">
          Chargement...
        </Text>
      </View>
    );
  }

  // Pas de producteur lié
  if (!producer) {
    return (
      <View
        className="flex-1 items-center justify-center px-6"
        style={{ backgroundColor: COLORS.background.dark }}
      >
        <View
          className="w-24 h-24 rounded-full items-center justify-center mb-4"
          style={{ backgroundColor: `${COLORS.accent.red}20` }}
        >
          <AlertCircle size={48} color={COLORS.accent.red} />
        </View>
        <Text style={{ color: COLORS.text.cream }} className="text-xl font-bold text-center mb-2">
          Aucune boutique liée
        </Text>
        <Text style={{ color: COLORS.text.muted }} className="text-center">
          Votre compte n'est pas encore lié à une fiche producteur.
          Contactez un administrateur pour configurer votre boutique.
        </Text>
      </View>
    );
  }

  return (
    <View className="flex-1" style={{ backgroundColor: COLORS.background.dark }}>
      {/* Toast */}
      {toast && (
        <Animated.View
          entering={FadeInUp.duration(300)}
          className="absolute top-20 left-6 right-6 z-50"
        >
          <View
            className="rounded-2xl p-4 flex-row items-center"
            style={{
              backgroundColor: toast.type === 'success' ? COLORS.accent.forest : COLORS.accent.red,
            }}
          >
            {toast.type === 'success' ? (
              <Check size={24} color={COLORS.text.white} />
            ) : (
              <AlertCircle size={24} color={COLORS.text.white} />
            )}
            <Text style={{ color: COLORS.text.white }} className="font-bold ml-3">
              {toast.message}
            </Text>
          </View>
        </Animated.View>
      )}

      {/* Modals */}
      {renderProductForm()}
      {renderDeleteConfirm()}
      {selectedOrder && renderOrderDetailModal()}

      {/* Header */}
      <LinearGradient
        colors={[COLORS.background.nightSky, COLORS.background.charcoal]}
        style={{
          paddingTop: insets.top + 12,
          paddingHorizontal: 20,
          paddingBottom: 16,
        }}
      >
        <View className="flex-row items-center mb-4">
          <View
            className="w-12 h-12 rounded-2xl items-center justify-center mr-3"
            style={{ backgroundColor: `${COLORS.primary.gold}20` }}
          >
            <Store size={24} color={COLORS.primary.gold} />
          </View>
          <View className="flex-1">
            <Text style={{ color: COLORS.text.cream }} className="text-2xl font-bold">
              Ma Boutique
            </Text>
            <Text style={{ color: COLORS.primary.paleGold }} className="text-sm">
              {producer.name}
            </Text>
          </View>
          {activeTab === 'products' && (
            <Pressable
              onPress={handleAddProduct}
              className="px-4 py-2.5 rounded-xl flex-row items-center"
              style={{ backgroundColor: COLORS.accent.forest }}
            >
              <Plus size={18} color={COLORS.text.white} />
              <Text style={{ color: COLORS.text.white }} className="font-bold ml-1">
                Ajouter
              </Text>
            </Pressable>
          )}
          {activeTab === 'orders' && (
            <Pressable
              onPress={() => {
                setOrdersPage(0);
                setOrdersHasMore(true);
                loadOrdersFromSupabase(true);
              }}
              className="px-4 py-2.5 rounded-xl flex-row items-center"
              style={{ backgroundColor: `${COLORS.accent.teal}20` }}
            >
              {ordersLoading ? (
                <ActivityIndicator size="small" color={COLORS.accent.teal} />
              ) : (
                <>
                  <RefreshCw size={18} color={COLORS.accent.teal} />
                  <Text style={{ color: COLORS.accent.teal }} className="font-bold ml-1">
                    Actualiser
                  </Text>
                </>
              )}
            </Pressable>
          )}
          {activeTab === 'direct_sales' && (
            <Pressable
              onPress={loadDirectSalesOrders}
              className="px-4 py-2.5 rounded-xl flex-row items-center"
              style={{ backgroundColor: `${COLORS.accent.hemp}20` }}
            >
              {directSalesLoading ? (
                <ActivityIndicator size="small" color={COLORS.accent.hemp} />
              ) : (
                <>
                  <RefreshCw size={18} color={COLORS.accent.hemp} />
                  <Text style={{ color: COLORS.accent.hemp }} className="font-bold ml-1">
                    Actualiser
                  </Text>
                </>
              )}
            </Pressable>
          )}
        </View>

        {/* Tab Switcher */}
        <View className="flex-row mb-4">
          <Pressable
            onPress={() => setActiveTab('products')}
            className="flex-1 flex-row items-center justify-center py-3 rounded-xl mr-1"
            style={{
              backgroundColor: activeTab === 'products' ? COLORS.accent.forest : `${COLORS.text.white}10`,
            }}
          >
            <Package size={16} color={activeTab === 'products' ? COLORS.text.white : COLORS.text.muted} />
            <Text
              style={{ color: activeTab === 'products' ? COLORS.text.white : COLORS.text.muted, fontSize: 12 }}
              className="font-bold ml-1"
            >
              Produits
            </Text>
          </Pressable>
          <Pressable
            onPress={() => setActiveTab('orders')}
            className="flex-1 flex-row items-center justify-center py-3 rounded-xl mx-1"
            style={{
              backgroundColor: activeTab === 'orders' ? COLORS.accent.forest : `${COLORS.text.white}10`,
            }}
          >
            <ShoppingBag size={16} color={activeTab === 'orders' ? COLORS.text.white : COLORS.text.muted} />
            <Text
              style={{ color: activeTab === 'orders' ? COLORS.text.white : COLORS.text.muted, fontSize: 12 }}
              className="font-bold ml-1"
            >
              Boutique
            </Text>
            {pendingOrdersCount > 0 && (
              <View
                className="ml-1 px-1.5 py-0.5 rounded-full"
                style={{ backgroundColor: '#F59E0B' }}
              >
                <Text style={{ color: COLORS.text.white, fontSize: 10, fontWeight: 'bold' }}>
                  {pendingOrdersCount}
                </Text>
              </View>
            )}
          </Pressable>
          <Pressable
            onPress={() => setActiveTab('direct_sales')}
            className="flex-1 flex-row items-center justify-center py-3 rounded-xl ml-1"
            style={{
              backgroundColor: activeTab === 'direct_sales' ? COLORS.accent.hemp : `${COLORS.text.white}10`,
            }}
          >
            <Store size={16} color={activeTab === 'direct_sales' ? COLORS.text.white : COLORS.text.muted} />
            <Text
              style={{ color: activeTab === 'direct_sales' ? COLORS.text.white : COLORS.text.muted, fontSize: 12 }}
              className="font-bold ml-1"
            >
              Vente directe
            </Text>
            {directSalesOrders.filter(o => o.status === 'pending').length > 0 && (
              <View
                className="ml-1 px-1.5 py-0.5 rounded-full"
                style={{ backgroundColor: '#F59E0B' }}
              >
                <Text style={{ color: COLORS.text.white, fontSize: 10, fontWeight: 'bold' }}>
                  {directSalesOrders.filter(o => o.status === 'pending').length}
                </Text>
              </View>
            )}
          </Pressable>
        </View>

        {/* Stats - only show on products tab */}
        {activeTab === 'products' && (
          <>
            <View className="flex-row">
              <View
                className="flex-1 p-3 rounded-xl mr-2"
                style={{ backgroundColor: `${COLORS.text.white}10` }}
              >
                <Text style={{ color: COLORS.text.muted }} className="text-xs">
                  Total
                </Text>
                <Text style={{ color: COLORS.text.cream }} className="font-bold text-lg">
                  {stats.total}
                </Text>
              </View>
              <View
                className="flex-1 p-3 rounded-xl mr-2"
                style={{ backgroundColor: `${COLORS.accent.hemp}15` }}
              >
                <Text style={{ color: COLORS.accent.hemp }} className="text-xs">
                  Publiés
                </Text>
                <Text style={{ color: COLORS.accent.hemp }} className="font-bold text-lg">
                  {stats.published}
                </Text>
              </View>
              <View
                className="flex-1 p-3 rounded-xl"
                style={{ backgroundColor: `${COLORS.text.muted}15` }}
              >
                <Text style={{ color: COLORS.text.muted }} className="text-xs">
                  Brouillons
                </Text>
                <Text style={{ color: COLORS.text.muted }} className="font-bold text-lg">
                  {stats.draft}
                </Text>
              </View>
            </View>

            {/* Recherche */}
            <View
              className="flex-row items-center px-4 py-3 rounded-xl mt-4"
              style={{ backgroundColor: `${COLORS.text.white}10` }}
            >
              <Search size={18} color={COLORS.text.muted} />
              <RNTextInput
                className="flex-1 ml-3"
                style={{ color: COLORS.text.cream }}
                placeholder="Rechercher un produit..."
                placeholderTextColor={COLORS.text.muted}
                value={searchQuery}
                onChangeText={setSearchQuery}
              />
              {searchQuery ? (
                <Pressable onPress={() => setSearchQuery('')}>
                  <X size={18} color={COLORS.text.muted} />
                </Pressable>
              ) : null}
            </View>
          </>
        )}
      </LinearGradient>

      {/* Products Tab Content */}
      {activeTab === 'products' && (
        <ScrollView
          className="flex-1 px-4"
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingTop: 16, paddingBottom: 100 }}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={COLORS.primary.gold}
            />
          }
        >
          {filteredProducts.length === 0 ? (
            <View className="items-center py-20">
              <Package size={64} color={COLORS.text.muted} />
              <Text style={{ color: COLORS.text.muted }} className="text-center mt-4 text-lg">
                {searchQuery ? 'Aucun produit trouvé' : 'Aucun produit'}
              </Text>
              <Text style={{ color: COLORS.text.muted }} className="text-center mt-2 text-sm">
                {searchQuery
                  ? 'Essayez une autre recherche'
                  : 'Commencez par ajouter votre premier produit'}
              </Text>
              {!searchQuery && (
                <Pressable
                  onPress={handleAddProduct}
                  className="mt-6 px-6 py-3 rounded-xl flex-row items-center"
                  style={{ backgroundColor: COLORS.accent.forest }}
                >
                  <Plus size={20} color={COLORS.text.white} />
                  <Text style={{ color: COLORS.text.white }} className="font-bold ml-2">
                    Ajouter un produit
                  </Text>
                </Pressable>
              )}
            </View>
          ) : (
            filteredProducts.map((product, index) => renderProductCard(product, index))
          )}
        </ScrollView>
      )}

      {/* Orders Tab Content */}
      {activeTab === 'orders' && (
        <ScrollView
          className="flex-1 px-4"
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingTop: 16, paddingBottom: 100 }}
          refreshControl={
            <RefreshControl
              refreshing={ordersLoading}
              onRefresh={() => {
                setOrdersPage(0);
                setOrdersHasMore(true);
                loadOrdersFromSupabase(true);
              }}
              tintColor={COLORS.primary.gold}
            />
          }
        >
          {producerOrders.length === 0 ? (
            <View className="items-center py-20">
              <ShoppingBag size={64} color={COLORS.text.muted} />
              <Text style={{ color: COLORS.text.muted }} className="text-center mt-4 text-lg">
                Aucune commande
              </Text>
              <Text style={{ color: COLORS.text.muted }} className="text-center mt-2 text-sm">
                Les commandes contenant vos produits apparaîtront ici
              </Text>
            </View>
          ) : (
            <>
              {producerOrders.map((order, index) => renderOrderCard(order, index))}

              {ordersHasMore && (
                <View className="items-center my-6">
                  <Pressable
                    onPress={onLoadMoreOrders}
                    disabled={ordersLoadingMore}
                    className="px-4 py-2 rounded-full"
                    style={{ backgroundColor: `${COLORS.text.white}10` }}
                  >
                    <Text style={{ color: COLORS.text.lightGray }}>
                      {ordersLoadingMore ? 'Chargement...' : 'Charger plus'}
                    </Text>
                  </Pressable>
                </View>
              )}
            </>
          )}
        </ScrollView>
      )}

      {/* Direct Sales Tab Content */}
      {activeTab === 'direct_sales' && (
        <ScrollView
          className="flex-1 px-4"
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingTop: 16, paddingBottom: 100 }}
          refreshControl={
            <RefreshControl
              refreshing={directSalesLoading}
              onRefresh={() => {
                setDirectSalesPage(0);
                setDirectSalesHasMore(true);
                loadDirectSalesOrders(true);
              }}
              tintColor={COLORS.accent.hemp}
            />
          }
        >
          {directSalesLoading && directSalesOrders.length === 0 ? (
            <View className="items-center py-20">
              <ActivityIndicator size="large" color={COLORS.accent.hemp} />
              <Text style={{ color: COLORS.text.muted }} className="text-center mt-4">
                Chargement des commandes...
              </Text>
            </View>
          ) : directSalesOrders.length === 0 ? (
            <View className="items-center py-20">
              <Store size={64} color={COLORS.text.muted} />
              <Text style={{ color: COLORS.text.muted }} className="text-center mt-4 text-lg">
                Aucune commande vente directe
              </Text>
              <Text style={{ color: COLORS.text.muted }} className="text-center mt-2 text-sm">
                Les commandes du Marché Local apparaîtront ici
              </Text>
            </View>
          ) : (
            <>
              {directSalesOrders.map((order, index) => (
                <DirectSalesOrderCard
                  key={order.id}
                  order={order}
                  index={index}
                  onPress={() => setSelectedDirectOrder(order)}
                />
              ))}

              {directSalesHasMore && (
                <View className="items-center my-6">
                  <Pressable
                    onPress={onLoadMoreDirectSales}
                    disabled={directSalesLoadingMore}
                    className="px-4 py-2 rounded-full"
                    style={{ backgroundColor: `${COLORS.text.white}10` }}
                  >
                    <Text style={{ color: COLORS.text.lightGray }}>
                      {directSalesLoadingMore ? 'Chargement...' : 'Charger plus'}
                    </Text>
                  </Pressable>
                </View>
              )}
            </>
          )}
        </ScrollView>
      )}

      {/* Direct Sales Order Detail Modal */}
      {selectedDirectOrder && (
        <DirectSalesOrderModal
          order={selectedDirectOrder}
          onClose={() => setSelectedDirectOrder(null)}
          onStatusChange={async (status, notes) => {
            if (!session?.access_token) return;
            const result = await updateLocalOrderStatus(session.access_token, String(selectedDirectOrder.id), status, notes);
            if (result.success) {
              showToast('Statut mis à jour', 'success');
              setSelectedDirectOrder({ ...selectedDirectOrder, status, producer_notes: notes || selectedDirectOrder.producer_notes });
              // Recharger les commandes
              loadDirectSalesOrders();
            } else {
              showToast(result.error || 'Erreur', 'error');
            }
          }}
          insets={insets}
        />
      )}
    </View>
  );
}

// Composant carte commande vente directe
function DirectSalesOrderCard({ order, index, onPress }: { order: LocalMarketOrder; index: number; onPress: () => void }) {
  const statusColor = getStatusColor(order.status);
  const statusLabel = getStatusLabel(order.status);

  const formattedDate = new Date(order.created_at).toLocaleDateString('fr-FR', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });

  return (
    <Animated.View
      entering={FadeInDown.duration(300).delay(index * 50)}
      className="mb-3"
    >
      <Pressable
        onPress={onPress}
        className="rounded-2xl overflow-hidden"
        style={{
          backgroundColor: COLORS.background.charcoal,
          borderWidth: 1,
          borderColor: `${statusColor}30`,
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

        {/* Client info */}
        <View className="px-4 py-3" style={{ borderBottomWidth: 1, borderBottomColor: `${COLORS.text.white}10` }}>
          <View className="flex-row items-center mb-1">
            <User size={14} color={COLORS.text.muted} />
            <Text style={{ color: COLORS.text.cream }} className="ml-2 font-medium">
              {order.customer_name}
            </Text>
          </View>
          {order.customer_phone && (
            <View className="flex-row items-center">
              <Phone size={12} color={COLORS.text.muted} />
              <Text style={{ color: COLORS.text.muted }} className="ml-2 text-xs">
                {order.customer_phone}
              </Text>
            </View>
          )}
        </View>

        {/* Produit */}
        <View className="px-4 py-3">
          <View className="flex-row items-center justify-between">
            <View className="flex-1 mr-3">
              <Text style={{ color: COLORS.text.cream }} className="font-medium">
                {order.product_name}
              </Text>
              <Text style={{ color: COLORS.text.muted }} className="text-xs">
                {order.quantity} × {order.unit_price.toFixed(2)}€
              </Text>
            </View>
            <Text style={{ color: COLORS.primary.brightYellow }} className="font-bold text-lg">
              {order.total_amount.toFixed(2)}€
            </Text>
          </View>
        </View>

        {/* Code de retrait */}
        <View
          className="flex-row items-center justify-between px-4 py-2"
          style={{ backgroundColor: `${COLORS.primary.gold}10` }}
        >
          <Text style={{ color: COLORS.text.muted }} className="text-xs">
            Code retrait
          </Text>
          <Text style={{ color: COLORS.primary.gold }} className="font-bold">
            {order.pickup_code}
          </Text>
        </View>

        {/* Action hint */}
        <View className="flex-row items-center justify-center py-2" style={{ backgroundColor: `${COLORS.accent.hemp}10` }}>
          <Text style={{ color: COLORS.accent.hemp }} className="text-xs">
            Appuyer pour gérer
          </Text>
          <ChevronRight size={14} color={COLORS.accent.hemp} />
        </View>
      </Pressable>
    </Animated.View>
  );
}

// Modal détail commande vente directe
function DirectSalesOrderModal({
  order,
  onClose,
  onStatusChange,
  insets,
}: {
  order: LocalMarketOrder;
  onClose: () => void;
  onStatusChange: (status: LocalMarketOrder['status'], notes?: string) => void;
  insets: { bottom: number };
}) {
  const [producerNotes, setProducerNotes] = useState(order.producer_notes || '');
  const statusColor = getStatusColor(order.status);
  const statusLabel = getStatusLabel(order.status);

  const statusOptions: LocalMarketOrder['status'][] = ['pending', 'confirmed', 'ready', 'completed', 'cancelled'];

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View className="flex-1 bg-black/80 justify-end">
        <View
          className="rounded-t-3xl max-h-[90%]"
          style={{
            backgroundColor: COLORS.background.charcoal,
            paddingBottom: insets.bottom + 20,
          }}
        >
          {/* Header */}
          <View
            className="flex-row items-center justify-between px-5 py-4"
            style={{ borderBottomWidth: 1, borderBottomColor: `${COLORS.primary.gold}20` }}
          >
            <View>
              <Text style={{ color: COLORS.text.cream }} className="text-xl font-bold">
                Commande #{order.pickup_code}
              </Text>
              <Text style={{ color: COLORS.text.muted }} className="text-sm">
                {new Date(order.created_at).toLocaleDateString('fr-FR', {
                  day: 'numeric',
                  month: 'long',
                  year: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </Text>
            </View>
            <Pressable
              onPress={onClose}
              className="w-10 h-10 rounded-full items-center justify-center"
              style={{ backgroundColor: `${COLORS.text.white}10` }}
            >
              <X size={20} color={COLORS.text.muted} />
            </Pressable>
          </View>

          <ScrollView className="px-5" showsVerticalScrollIndicator={false}>
            {/* Statut actuel */}
            <View className="py-4">
              <Text style={{ color: COLORS.text.lightGray }} className="font-medium mb-3">
                Statut actuel
              </Text>
              <View
                className="flex-row items-center p-4 rounded-xl"
                style={{ backgroundColor: `${statusColor}20` }}
              >
                <View className="w-4 h-4 rounded-full mr-3" style={{ backgroundColor: statusColor }} />
                <Text style={{ color: statusColor }} className="font-bold text-lg">
                  {statusLabel}
                </Text>
              </View>
            </View>

            {/* Changer le statut */}
            <View className="py-4">
              <Text style={{ color: COLORS.text.lightGray }} className="font-medium mb-3">
                Changer le statut
              </Text>
              <View className="flex-row flex-wrap" style={{ gap: 8 }}>
                {statusOptions.map((status) => {
                  const color = getStatusColor(status);
                  const label = getStatusLabel(status);
                  const isActive = order.status === status;
                  return (
                    <Pressable
                      key={status}
                      onPress={() => onStatusChange(status, producerNotes)}
                      className="px-4 py-2 rounded-full"
                      style={{
                        backgroundColor: isActive ? color : `${color}20`,
                        borderWidth: isActive ? 0 : 1,
                        borderColor: `${color}50`,
                      }}
                    >
                      <Text
                        style={{
                          color: isActive ? COLORS.text.white : color,
                          fontSize: 12,
                          fontWeight: 'bold',
                        }}
                      >
                        {label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>

            {/* Infos client */}
            <View className="py-4">
              <Text style={{ color: COLORS.text.lightGray }} className="font-medium mb-3">
                Client
              </Text>
              <View className="rounded-xl p-4" style={{ backgroundColor: `${COLORS.text.white}05` }}>
                <View className="flex-row items-center mb-3">
                  <User size={18} color={COLORS.accent.teal} />
                  <Text style={{ color: COLORS.text.cream }} className="font-medium ml-3">
                    {order.customer_name}
                  </Text>
                </View>
                {order.customer_email && (
                  <View className="flex-row items-center mb-3">
                    <Mail size={16} color={COLORS.text.muted} />
                    <Text style={{ color: COLORS.text.lightGray }} className="ml-3">
                      {order.customer_email}
                    </Text>
                  </View>
                )}
                {order.customer_phone && (
                  <View className="flex-row items-center">
                    <Phone size={16} color={COLORS.text.muted} />
                    <Text style={{ color: COLORS.text.lightGray }} className="ml-3">
                      {order.customer_phone}
                    </Text>
                  </View>
                )}
              </View>
            </View>

            {/* Produit commandé */}
            <View className="py-4">
              <Text style={{ color: COLORS.text.lightGray }} className="font-medium mb-3">
                Produit commandé
              </Text>
              <View className="rounded-xl p-4" style={{ backgroundColor: `${COLORS.text.white}05` }}>
                <View className="flex-row items-center justify-between">
                  <View>
                    <Text style={{ color: COLORS.text.cream }} className="font-medium">
                      {order.product_name}
                    </Text>
                    <Text style={{ color: COLORS.text.muted }} className="text-xs mt-1">
                      {order.quantity} × {order.unit_price.toFixed(2)}€
                    </Text>
                  </View>
                  <Text style={{ color: COLORS.primary.brightYellow }} className="font-bold text-xl">
                    {order.total_amount.toFixed(2)}€
                  </Text>
                </View>
              </View>
            </View>

            {/* Notes client */}
            {order.customer_notes && (
              <View className="py-4">
                <Text style={{ color: COLORS.text.lightGray }} className="font-medium mb-3">
                  Message du client
                </Text>
                <View className="rounded-xl p-4" style={{ backgroundColor: `${COLORS.accent.teal}10` }}>
                  <Text style={{ color: COLORS.text.lightGray }} className="italic">
                    "{order.customer_notes}"
                  </Text>
                </View>
              </View>
            )}

            {/* Notes producteur */}
            <View className="py-4">
              <Text style={{ color: COLORS.text.lightGray }} className="font-medium mb-3">
                Votre message au client
              </Text>
              <RNTextInput
                className="rounded-xl px-4 py-3"
                style={{
                  backgroundColor: `${COLORS.text.white}10`,
                  color: COLORS.text.cream,
                  minHeight: 80,
                }}
                placeholder="Ex: Votre commande sera prête demain à 14h"
                placeholderTextColor={COLORS.text.muted}
                multiline
                value={producerNotes}
                onChangeText={setProducerNotes}
              />
            </View>

            <View style={{ height: 20 }} />
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}
