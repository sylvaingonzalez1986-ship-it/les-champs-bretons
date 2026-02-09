import { PromoProduct } from './store';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  SUPABASE_URL,
  getAuthenticatedHeaders,
  getHeaders,
  isNetworkOnline,
  isSupabaseSyncConfigured,
  supabaseFetch,
} from './supabase-sync-core';
import { getSignedImageUrl } from './storage-utils';

export interface SupabasePromoProduct {
  id: string;
  product_id: string;
  producer_id: string;
  product_name: string;
  producer_name: string;
  original_price: number;
  promo_price: number;
  discount_percent: number;
  image: string;
  valid_until: string;
  active: boolean;
  created_at: string;
  updated_at: string;
}

// Convert Supabase promo product to app PromoProduct format
function supabaseToPromoProduct(sp: SupabasePromoProduct): PromoProduct {
  return {
    id: sp.id,
    productId: sp.product_id,
    producerId: sp.producer_id,
    productName: sp.product_name,
    producerName: sp.producer_name,
    originalPrice: sp.original_price,
    promoPrice: sp.promo_price,
    discountPercent: sp.discount_percent,
    image: sp.image,
    validUntil: sp.valid_until,
    active: sp.active,
  };
}

// Convert app PromoProduct to Supabase format
function promoProductToSupabase(promo: PromoProduct): Omit<SupabasePromoProduct, 'created_at' | 'updated_at'> {
  return {
    id: promo.id,
    product_id: promo.productId,
    producer_id: promo.producerId,
    product_name: promo.productName,
    producer_name: promo.producerName,
    original_price: promo.originalPrice,
    promo_price: promo.promoPrice,
    discount_percent: promo.discountPercent,
    image: promo.image,
    valid_until: promo.validUntil,
    active: promo.active,
  };
}

// Fetch all promo products from Supabase
export async function fetchPromoProducts(): Promise<PromoProduct[]> {
  if (!isSupabaseSyncConfigured()) {
    return [];
  }

  const isOnline = await isNetworkOnline();
  if (!isOnline) {
    const cached = await AsyncStorage.getItem('cache_promo_products_v2');
    return cached ? (JSON.parse(cached) as PromoProduct[]) : [];
  }

  try {
    const response = await supabaseFetch(`${SUPABASE_URL}/rest/v1/promo_products?select=*&order=product_name.asc`, {
      method: 'GET',
      headers: getHeaders(),
    });

    if (!response.ok) {
      throw new Error('Erreur récupération promo products');
    }

    const data: SupabasePromoProduct[] = await response.json();
    const promos = data.map(supabaseToPromoProduct);
    return Promise.all(
      promos.map(async (promo) => ({
        ...promo,
        image: await getSignedImageUrl(promo.image),
      }))
    );
  } catch (error) {
    console.warn('Error fetching promo products from Supabase:', error);
    const cached = await AsyncStorage.getItem('cache_promo_products_v2');
    return cached ? (JSON.parse(cached) as PromoProduct[]) : [];
  }
}

// Add promo product to Supabase
export async function addPromoProductToSupabase(promo: PromoProduct): Promise<SupabasePromoProduct> {
  if (!isSupabaseSyncConfigured()) {
    throw new Error('Supabase non configuré');
  }

  const headers = await getAuthenticatedHeaders();
  const response = await supabaseFetch(`${SUPABASE_URL}/functions/v1/promo-products-mutations`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      action: 'create',
      promo: promoProductToSupabase(promo),
    }),
  });

  if (!response.ok) {
    throw new Error('Erreur ajout promo product');
  }

  const data = await response.json();
  return Array.isArray(data) ? data[0] : data;
}

// Update promo product in Supabase
export async function updatePromoProductInSupabase(id: string, promo: Partial<PromoProduct>): Promise<void> {
  if (!isSupabaseSyncConfigured()) {
    throw new Error('Supabase non configuré');
  }

  const updates: Record<string, unknown> = {};
  if (promo.productId !== undefined) updates.product_id = promo.productId;
  if (promo.producerId !== undefined) updates.producer_id = promo.producerId;
  if (promo.productName !== undefined) updates.product_name = promo.productName;
  if (promo.producerName !== undefined) updates.producer_name = promo.producerName;
  if (promo.originalPrice !== undefined) updates.original_price = promo.originalPrice;
  if (promo.promoPrice !== undefined) updates.promo_price = promo.promoPrice;
  if (promo.discountPercent !== undefined) updates.discount_percent = promo.discountPercent;
  if (promo.image !== undefined) updates.image = promo.image;
  if (promo.validUntil !== undefined) updates.valid_until = promo.validUntil;
  if (promo.active !== undefined) updates.active = promo.active;

  const headers = await getAuthenticatedHeaders();
  const response = await supabaseFetch(`${SUPABASE_URL}/functions/v1/promo-products-mutations`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      action: 'update',
      promoId: id,
      updates,
    }),
  });

  if (!response.ok) {
    throw new Error('Erreur mise à jour promo product');
  }
}

// Delete promo product from Supabase
export async function deletePromoProductFromSupabase(id: string): Promise<void> {
  if (!isSupabaseSyncConfigured()) {
    throw new Error('Supabase non configuré');
  }

  const headers = await getAuthenticatedHeaders();
  const response = await supabaseFetch(`${SUPABASE_URL}/functions/v1/promo-products-mutations`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      action: 'delete',
      promoId: id,
    }),
  });

  if (!response.ok) {
    throw new Error('Erreur suppression promo product');
  }
}

// Sync a promo product to Supabase
export async function syncPromoProductToSupabase(promo: PromoProduct): Promise<void> {
  if (!isSupabaseSyncConfigured()) {
    throw new Error('Supabase non configuré');
  }

  // Check if promo product already exists
  const response = await supabaseFetch(`${SUPABASE_URL}/rest/v1/promo_products?id=eq.${promo.id}&select=id`, {
    method: 'GET',
    headers: getHeaders(),
  });

  const existing = await response.json();

  if (existing && existing.length > 0) {
    // Update existing promo product
    await updatePromoProductInSupabase(promo.id, promo);
  } else {
    // Add new promo product
    await addPromoProductToSupabase(promo);
  }
}

// Sync all promo products to Supabase
export async function syncAllPromoProductsToSupabase(promoProducts: PromoProduct[]): Promise<void> {
  if (!isSupabaseSyncConfigured()) {
    throw new Error('Supabase non configuré');
  }

  for (const promo of promoProducts) {
    await syncPromoProductToSupabase(promo);
  }
}
