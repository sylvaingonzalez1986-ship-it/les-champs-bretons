// Supabase sync client for producers and products
// This syncs admin-configured data to all users

import { Producer, ProducerProduct } from './producers';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  SUPABASE_URL,
  SUPABASE_ANON_KEY,
  getAuthenticatedHeaders,
  getHeaders,
  isNetworkOnline,
  isSupabaseSyncConfigured,
  supabaseFetch,
} from './supabase-sync-core';
import { ensureDeviceId } from './device-id';
import { getValidSession } from './supabase-auth';
import { PriceTier } from './producers';
import { getSignedImageUrl, getSignedLabAnalysisUrl } from './storage-utils';

// ==================== PRODUCERS ====================

export interface SupabaseProducer {
  id: string;
  name: string;
  email: string | null;
  region: string;
  department: string;
  city: string;
  image: string;
  description: string;
  latitude: number;
  longitude: number;
  map_position_x: number | null;
  map_position_y: number | null;
  soil_type: string;
  soil_ph: string;
  soil_characteristics: string;
  climate_type: string;
  climate_avg_temp: string;
  climate_rainfall: string;
  culture_outdoor: boolean | null;
  culture_greenhouse: boolean | null;
  culture_indoor: boolean | null;
  vente_directe_ferme?: boolean | null;
  adresse_retrait?: string | null;
  horaires_retrait?: string | null;
  instructions_retrait?: string | null;
  instagram_url?: string | null;
  facebook_url?: string | null;
  twitter_url?: string | null;
  tiktok_url?: string | null;
  youtube_url?: string | null;
  website_url?: string | null;
  linkedin_url?: string | null;
  profile_id?: string | null;
  profile?: {
    company_name: string | null;
    business_name: string | null;
  } | null;
  created_at: string;
  updated_at: string;
}

const DEVICE_BIND_MIN_INTERVAL_MS = 60_000;
let lastBindAttemptAt = 0;

async function bindDeviceForSession(): Promise<{ ok: boolean; status: number; error?: string }> {
  const now = Date.now();
  if (now - lastBindAttemptAt < DEVICE_BIND_MIN_INTERVAL_MS) {
    return { ok: false, status: 429, error: 'RATE_LIMIT_BACKOFF' };
  }

  const session = await getValidSession();
  if (!session?.access_token) {
    return { ok: false, status: 401, error: 'NO_SESSION' };
  }

  lastBindAttemptAt = now;
  const deviceId = await ensureDeviceId();
  const response = await supabaseFetch(`${SUPABASE_URL}/functions/v1/bind-device`, {
    method: 'POST',
    headers: {
      'apikey': SUPABASE_ANON_KEY,
      'Authorization': `Bearer ${session.access_token}`,
      'Content-Type': 'application/json',
      'X-Device-Id': deviceId,
    },
    body: JSON.stringify({}),
  });

  let error: string | undefined;
  if (!response.ok) {
    try {
      const data = await response.json();
      error = typeof data?.error === 'string' ? data.error : 'BIND_FAILED';
    } catch {
      error = 'BIND_FAILED';
    }
    console.warn('[Producers] bind-device failed:', response.status, error);
  }

  return { ok: response.ok, status: response.status, error };
}

async function postProducerMutation(
  payload: Record<string, unknown>,
  retryAfterBind = true
): Promise<Response> {
  const headers = await getAuthenticatedHeaders();
  const response = await supabaseFetch(`${SUPABASE_URL}/functions/v1/producers-mutations`, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });

  if (response.status === 409 && retryAfterBind) {
    let data: { error?: string } | null = null;
    try {
      data = await response.clone().json();
    } catch {
      data = null;
    }

    const shouldBind = !data || data.error === 'DEVICE_NOT_BOUND';
    if (shouldBind) {
      const bindResult = await bindDeviceForSession();
      if (bindResult.ok) {
        return postProducerMutation(payload, false);
      }
      console.warn('[Producers] Device binding failed or denied:', bindResult.status, bindResult.error);
    }
  }

  return response;
}

// Convert Supabase producer to app Producer format
function supabaseToProducer(sp: SupabaseProducer, products: ProducerProduct[]): Producer {
  return {
    id: sp.id,
    name: sp.name,
    companyName: sp.profile?.company_name ?? undefined,
    businessName: sp.profile?.business_name ?? undefined,
    profileId: sp.profile_id ?? undefined, // Lien vers le profil utilisateur
    email: sp.email ?? undefined,
    region: sp.region,
    department: sp.department,
    city: sp.city,
    image: sp.image,
    description: sp.description,
    coordinates: {
      latitude: sp.latitude,
      longitude: sp.longitude,
    },
    mapPosition: sp.map_position_x !== null && sp.map_position_y !== null
      ? { x: sp.map_position_x, y: sp.map_position_y }
      : undefined,
    soil: {
      type: sp.soil_type,
      ph: sp.soil_ph,
      characteristics: sp.soil_characteristics,
    },
    climate: {
      type: sp.climate_type,
      avgTemp: sp.climate_avg_temp,
      rainfall: sp.climate_rainfall,
    },
    products,
    cultureOutdoor: sp.culture_outdoor ?? undefined,
    cultureGreenhouse: sp.culture_greenhouse ?? undefined,
    cultureIndoor: sp.culture_indoor ?? undefined,
    socialLinks: {
      instagram: sp.instagram_url ?? undefined,
      facebook: sp.facebook_url ?? undefined,
      twitter: sp.twitter_url ?? undefined,
      tiktok: sp.tiktok_url ?? undefined,
      youtube: sp.youtube_url ?? undefined,
      website: sp.website_url ?? undefined,
      linkedin: sp.linkedin_url ?? undefined,
    },
  };
}

// Convert app Producer to Supabase format
function producerToSupabase(p: Producer): Omit<SupabaseProducer, 'created_at' | 'updated_at'> {
  return {
    id: p.id,
    name: p.name,
    email: p.email ?? null,
    region: p.region,
    department: p.department,
    city: p.city,
    image: p.image,
    description: p.description,
    latitude: p.coordinates.latitude,
    longitude: p.coordinates.longitude,
    map_position_x: p.mapPosition?.x ?? null,
    map_position_y: p.mapPosition?.y ?? null,
    soil_type: p.soil.type,
    soil_ph: p.soil.ph,
    soil_characteristics: p.soil.characteristics,
    climate_type: p.climate.type,
    climate_avg_temp: p.climate.avgTemp,
    climate_rainfall: p.climate.rainfall,
    culture_outdoor: p.cultureOutdoor ?? null,
    culture_greenhouse: p.cultureGreenhouse ?? null,
    culture_indoor: p.cultureIndoor ?? null,
    instagram_url: p.socialLinks?.instagram ?? null,
    facebook_url: p.socialLinks?.facebook ?? null,
    twitter_url: p.socialLinks?.twitter ?? null,
    tiktok_url: p.socialLinks?.tiktok ?? null,
    youtube_url: p.socialLinks?.youtube ?? null,
    website_url: p.socialLinks?.website ?? null,
    linkedin_url: p.socialLinks?.linkedin ?? null,
    profile_id: p.profileId ?? p.id, // Use profileId if set, fallback to id
  };
}

// Fetch all producers from Supabase
export async function fetchProducers(): Promise<SupabaseProducer[]> {
  if (!isSupabaseSyncConfigured()) {
    throw new Error('Supabase non configuré');
  }

  // Joindre avec profiles pour récupérer company_name et business_name
  const response = await supabaseFetch(`${SUPABASE_URL}/rest/v1/producers?select=*,profile:profiles(company_name,business_name)&order=name.asc`, {
    method: 'GET',
    headers: getHeaders(),
  });

  if (!response.ok) {
    throw new Error('Erreur récupération producteurs');
  }

  const producers = await response.json();

  return producers;
}

// Fetch producers from Supabase with pagination
export async function fetchProducersPage(options?: {
  limit?: number;
  offset?: number;
}): Promise<{ producers: SupabaseProducer[]; nextOffset: number | null }> {
  if (!isSupabaseSyncConfigured()) {
    throw new Error('Supabase non configuré');
  }

  const limit = options?.limit ?? 20;
  const offset = options?.offset ?? 0;

  const response = await supabaseFetch(
    `${SUPABASE_URL}/rest/v1/producers?select=*,profile:profiles(company_name,business_name)&order=name.asc&limit=${limit}&offset=${offset}`,
    {
      method: 'GET',
      headers: getHeaders(),
    }
  );

  if (!response.ok) {
    throw new Error('Erreur récupération producteurs');
  }

  const producers = await response.json();
  const nextOffset = producers.length === limit ? offset + limit : null;

  return { producers, nextOffset };
}

// Add producer to Supabase - WITH AUTHENTICATION
export async function addProducerToSupabase(producer: Producer): Promise<SupabaseProducer> {
  if (!isSupabaseSyncConfigured()) {
    throw new Error('Supabase non configuré');
  }

  try {
    const response = await postProducerMutation({
      action: 'create',
      producer: producerToSupabase(producer),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      console.warn('[Producers] Erreur ajout:', response.status, errorText);
      throw new Error(`Erreur ajout producteur${errorText ? `: ${errorText}` : ''}`);
    }

    const data = await response.json();
    return Array.isArray(data) ? data[0] : data;
  } catch (error) {
    console.warn('[Producers] Erreur:', error);
    throw error;
  }
}

// Update producer in Supabase - WITH AUTHENTICATION
export async function updateProducerInSupabase(id: string, producer: Partial<Producer>): Promise<void> {
  if (!isSupabaseSyncConfigured()) {
    throw new Error('Supabase non configuré');
  }

  const updates: Record<string, unknown> = {};
  if (producer.name !== undefined) updates.name = producer.name;
  if (producer.email !== undefined) updates.email = producer.email;
  if (producer.region !== undefined) updates.region = producer.region;
  if (producer.department !== undefined) updates.department = producer.department;
  if (producer.city !== undefined) updates.city = producer.city;
  if (producer.image !== undefined) updates.image = producer.image;
  if (producer.description !== undefined) updates.description = producer.description;
  if (producer.coordinates !== undefined) {
    updates.latitude = producer.coordinates.latitude;
    updates.longitude = producer.coordinates.longitude;
  }
  if (producer.soil !== undefined) {
    updates.soil_type = producer.soil.type;
    updates.soil_ph = producer.soil.ph;
    updates.soil_characteristics = producer.soil.characteristics;
  }
  if (producer.climate !== undefined) {
    updates.climate_type = producer.climate.type;
    updates.climate_avg_temp = producer.climate.avgTemp;
    updates.climate_rainfall = producer.climate.rainfall;
  }
  // Culture types
  if (producer.cultureOutdoor !== undefined) updates.culture_outdoor = producer.cultureOutdoor;
  if (producer.cultureGreenhouse !== undefined) updates.culture_greenhouse = producer.cultureGreenhouse;
  if (producer.cultureIndoor !== undefined) updates.culture_indoor = producer.cultureIndoor;
  if (producer.socialLinks !== undefined) {
    if (producer.socialLinks.instagram !== undefined) updates.instagram_url = producer.socialLinks.instagram;
    if (producer.socialLinks.facebook !== undefined) updates.facebook_url = producer.socialLinks.facebook;
    if (producer.socialLinks.twitter !== undefined) updates.twitter_url = producer.socialLinks.twitter;
    if (producer.socialLinks.tiktok !== undefined) updates.tiktok_url = producer.socialLinks.tiktok;
    if (producer.socialLinks.youtube !== undefined) updates.youtube_url = producer.socialLinks.youtube;
    if (producer.socialLinks.website !== undefined) updates.website_url = producer.socialLinks.website;
    if (producer.socialLinks.linkedin !== undefined) updates.linkedin_url = producer.socialLinks.linkedin;
  }

  // Ensure profile_id is always set to link producer to user
  if (producer.profileId !== undefined) updates.profile_id = producer.profileId;

  updates.updated_at = new Date().toISOString();

  try {
    const response = await postProducerMutation({
      action: 'update',
      producerId: id,
      updates,
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      console.warn('[Producers] Erreur mise à jour:', response.status, errorText);
      throw new Error(`Erreur mise à jour producteur${errorText ? `: ${errorText}` : ''}`);
    }
  } catch (error) {
    console.warn('[Producers] Erreur:', error);
    throw error;
  }
}

async function findProducerIdByProfileId(profileId: string): Promise<string | null> {
  const response = await supabaseFetch(
    `${SUPABASE_URL}/rest/v1/producers?profile_id=eq.${profileId}&select=id&limit=1`,
    {
      method: 'GET',
      headers: getHeaders(),
    }
  );

  if (!response.ok) {
    return null;
  }

  const rows = await response.json();
  return Array.isArray(rows) && rows.length > 0 ? rows[0].id : null;
}

// Delete producer from Supabase - WITH AUTHENTICATION
export async function deleteProducerFromSupabase(id: string): Promise<void> {
  if (!isSupabaseSyncConfigured()) {
    throw new Error('Supabase non configuré');
  }

  try {
    const headers = await getAuthenticatedHeaders();
    const response = await supabaseFetch(`${SUPABASE_URL}/functions/v1/producers-mutations`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        action: 'delete',
        producerId: id,
      }),
    });

    if (!response.ok) {
      console.warn('[Producers] Erreur suppression');
      throw new Error('Erreur suppression producteur');
    }
  } catch (error) {
    console.warn('[Producers] Erreur:', error);
    throw error;
  }
}

// ==================== PRODUCTS ====================

export interface SupabaseProduct {
  id: string;
  producer_id: string;
  name: string;
  type: string;
  cbd_percent: number;
  thc_percent: number;
  price_public: number; // Prix public (client)
  price_pro: number | null; // Prix professionnel
  weight: string;
  image: string;
  images: string[] | null;
  description: string;
  tva_rate: number;
  stock: number | null;
  is_on_promo: boolean;
  promo_percent: number | null;
  visible_for_clients: boolean;
  visible_for_pros: boolean;
  status: 'draft' | 'published' | 'archived';
  lab_analysis_url: string | null;
  price_tiers: PriceTier[] | null; // Paliers de prix dégressifs clients
  price_pro_tiers: PriceTier[] | null; // Paliers de prix dégressifs pros
  created_at: string;
  updated_at: string;
}

// Convert Supabase product to app ProducerProduct format
function supabaseToProduct(sp: SupabaseProduct): ProducerProduct {
  return {
    id: sp.id,
    name: sp.name,
    type: sp.type as ProducerProduct['type'],
    cbdPercent: sp.cbd_percent,
    thcPercent: sp.thc_percent,
    price: sp.price_public,
    pricePro: sp.price_pro ?? undefined,
    weight: sp.weight,
    image: sp.image,
    images: sp.images || undefined,
    description: sp.description,
    tvaRate: sp.tva_rate,
    stock: sp.stock ?? undefined,
    isOnPromo: sp.is_on_promo,
    promoPercent: sp.promo_percent ?? undefined,
    visibleForClients: sp.visible_for_clients,
    visibleForPros: sp.visible_for_pros,
    status: sp.status,
    labAnalysisUrl: sp.lab_analysis_url ?? undefined,
    priceTiers: sp.price_tiers ?? undefined,
    priceProTiers: sp.price_pro_tiers ?? undefined,
  };
}

// Convert app ProducerProduct to Supabase format
function productToSupabase(p: ProducerProduct, producerId: string): Omit<SupabaseProduct, 'created_at' | 'updated_at'> {
  return {
    id: p.id,
    producer_id: producerId,
    name: p.name,
    type: p.type,
    cbd_percent: p.cbdPercent,
    thc_percent: p.thcPercent,
    price_public: p.price,
    price_pro: p.pricePro ?? null,
    weight: p.weight,
    image: p.image,
    images: p.images || null,
    description: p.description,
    tva_rate: p.tvaRate ?? 20,
    stock: p.stock ?? null,
    is_on_promo: p.isOnPromo ?? false,
    promo_percent: p.promoPercent ?? null,
    visible_for_clients: p.visibleForClients ?? true,
    visible_for_pros: p.visibleForPros ?? true,
    status: p.status ?? 'published',
    lab_analysis_url: p.labAnalysisUrl ?? null,
    price_tiers: p.priceTiers ?? null,
    price_pro_tiers: p.priceProTiers ?? null,
  };
}

// Fetch all products from Supabase
export async function fetchProducts(): Promise<SupabaseProduct[]> {
  if (!isSupabaseSyncConfigured()) {
    throw new Error('Supabase non configuré');
  }

  const response = await supabaseFetch(`${SUPABASE_URL}/rest/v1/products?select=*&order=name.asc`, {
    method: 'GET',
    headers: getHeaders(),
  });

  if (!response.ok) {
    throw new Error('Erreur récupération produits');
  }

  return response.json();
}

// Fetch products from Supabase with pagination
export async function fetchProductsPage(options?: {
  limit?: number;
  offset?: number;
}): Promise<{ products: SupabaseProduct[]; nextOffset: number | null }> {
  if (!isSupabaseSyncConfigured()) {
    throw new Error('Supabase non configuré');
  }

  const limit = options?.limit ?? 20;
  const offset = options?.offset ?? 0;

  const response = await supabaseFetch(
    `${SUPABASE_URL}/rest/v1/products?select=*&order=name.asc&limit=${limit}&offset=${offset}`,
    {
      method: 'GET',
      headers: getHeaders(),
    }
  );

  if (!response.ok) {
    throw new Error('Erreur récupération produits');
  }

  const products = await response.json();
  const nextOffset = products.length === limit ? offset + limit : null;

  return { products, nextOffset };
}

// Add product to Supabase - WITH AUTHENTICATION
export async function addProductToSupabase(product: ProducerProduct, producerId: string): Promise<SupabaseProduct> {
  if (!isSupabaseSyncConfigured()) {
    throw new Error('Supabase non configuré');
  }

  try {
    const headers = await getAuthenticatedHeaders();
    const response = await supabaseFetch(`${SUPABASE_URL}/functions/v1/products-mutations`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        action: 'create',
        product: productToSupabase(product, producerId),
      }),
    });

    if (!response.ok) {
      console.warn('[Products] Erreur ajout');
      throw new Error('Erreur ajout produit');
    }

    const data = await response.json();
    return Array.isArray(data) ? data[0] : data;
  } catch (error) {
    console.warn('[Products] Erreur:', error);
    throw error;
  }
}

// Update product in Supabase - WITH AUTHENTICATION
export async function updateProductInSupabase(id: string, product: Partial<ProducerProduct>): Promise<void> {
  if (!isSupabaseSyncConfigured()) {
    throw new Error('Supabase non configuré');
  }

  const updates: Record<string, unknown> = {};
  if (product.name !== undefined) updates.name = product.name;
  if (product.type !== undefined) updates.type = product.type;
  if (product.cbdPercent !== undefined) updates.cbd_percent = product.cbdPercent;
  if (product.thcPercent !== undefined) updates.thc_percent = product.thcPercent;
  if (product.price !== undefined) updates.price_public = product.price;
  if (product.pricePro !== undefined) updates.price_pro = product.pricePro;
  if (product.weight !== undefined) updates.weight = product.weight;
  if (product.image !== undefined) updates.image = product.image;
  if (product.images !== undefined) updates.images = product.images;
  if (product.description !== undefined) updates.description = product.description;
  if (product.tvaRate !== undefined) updates.tva_rate = product.tvaRate;
  if (product.stock !== undefined) updates.stock = product.stock;
  if (product.isOnPromo !== undefined) updates.is_on_promo = product.isOnPromo;
  if (product.promoPercent !== undefined) updates.promo_percent = product.promoPercent;
  if (product.labAnalysisUrl !== undefined) updates.lab_analysis_url = product.labAnalysisUrl;
  updates.updated_at = new Date().toISOString();

  try {
    const headers = await getAuthenticatedHeaders();
    const response = await supabaseFetch(`${SUPABASE_URL}/functions/v1/products-mutations`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        action: 'update',
        productId: id,
        updates,
      }),
    });

    if (!response.ok) {
      console.warn('[Products] Erreur mise à jour');
      throw new Error('Erreur mise à jour produit');
    }
  } catch (error) {
    console.warn('[Products] Erreur:', error);
    throw error;
  }
}

// Delete product from Supabase - WITH AUTHENTICATION
export async function deleteProductFromSupabase(id: string): Promise<void> {
  if (!isSupabaseSyncConfigured()) {
    throw new Error('Supabase non configuré');
  }

  try {
    const headers = await getAuthenticatedHeaders();
    const response = await supabaseFetch(`${SUPABASE_URL}/functions/v1/products-mutations`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        action: 'delete',
        productId: id,
      }),
    });

    if (!response.ok) {
      console.warn('[Products] Erreur suppression');
      throw new Error('Erreur suppression produit');
    }
  } catch (error) {
    console.warn('[Products] Erreur:', error);
    throw error;
  }
}

// ==================== FULL SYNC ====================

// Interface for the producers_catalog materialized view response
interface ProducersCatalogRow {
  id: string;
  name: string;
  email: string | null;
  region: string;
  department: string;
  city: string;
  image: string;
  description: string;
  latitude: number;
  longitude: number;
  map_position_x: number | null;
  map_position_y: number | null;
  soil_type: string;
  soil_ph: string;
  soil_characteristics: string;
  climate_type: string;
  climate_avg_temp: string;
  climate_rainfall: string;
  culture_outdoor: boolean | null;
  culture_greenhouse: boolean | null;
  culture_indoor: boolean | null;
  vente_directe_ferme: boolean | null;
  adresse_retrait: string | null;
  horaires_retrait: string | null;
  instructions_retrait: string | null;
  shipping_enabled: boolean | null;
  shipping_fee: number | null;
  shipping_note: string | null;
  instagram_url: string | null;
  facebook_url: string | null;
  twitter_url: string | null;
  tiktok_url: string | null;
  youtube_url: string | null;
  website_url: string | null;
  linkedin_url: string | null;
  profile_id: string | null;
  created_at: string;
  updated_at: string;
  profile: {
    company_name: string | null;
    business_name: string | null;
  } | null;
  products: SupabaseProduct[]; // JSONB array parsed by PostgREST
}

// Convert catalog row to Producer (with embedded products)
function catalogRowToProducer(row: ProducersCatalogRow): Producer {
  // Parse products from JSONB array
  const products: ProducerProduct[] = (row.products || []).map(supabaseToProduct);

  return {
    id: row.id,
    name: row.name,
    companyName: row.profile?.company_name ?? undefined,
    businessName: row.profile?.business_name ?? undefined,
    profileId: row.profile_id ?? undefined,
    email: row.email ?? undefined,
    region: row.region,
    department: row.department,
    city: row.city,
    image: row.image,
    description: row.description,
    coordinates: {
      latitude: row.latitude,
      longitude: row.longitude,
    },
    mapPosition: row.map_position_x !== null && row.map_position_y !== null
      ? { x: row.map_position_x, y: row.map_position_y }
      : undefined,
    soil: {
      type: row.soil_type,
      ph: row.soil_ph,
      characteristics: row.soil_characteristics,
    },
    climate: {
      type: row.climate_type,
      avgTemp: row.climate_avg_temp,
      rainfall: row.climate_rainfall,
    },
    products,
    cultureOutdoor: row.culture_outdoor ?? undefined,
    cultureGreenhouse: row.culture_greenhouse ?? undefined,
    cultureIndoor: row.culture_indoor ?? undefined,
    shipping_enabled: row.shipping_enabled ?? undefined,
    shipping_fee: row.shipping_fee ?? undefined,
    shipping_note: row.shipping_note ?? undefined,
    socialLinks: {
      instagram: row.instagram_url ?? undefined,
      facebook: row.facebook_url ?? undefined,
      twitter: row.twitter_url ?? undefined,
      tiktok: row.tiktok_url ?? undefined,
      youtube: row.youtube_url ?? undefined,
      website: row.website_url ?? undefined,
      linkedin: row.linkedin_url ?? undefined,
    },
  };
}

async function resolveProductImages(product: ProducerProduct): Promise<ProducerProduct> {
  const signedImage = await getSignedImageUrl(product.image);
  const signedImages = product.images
    ? await Promise.all(product.images.map((image) => getSignedImageUrl(image)))
    : undefined;
  const signedLab = product.labAnalysisUrl
    ? await getSignedLabAnalysisUrl(product.labAnalysisUrl)
    : undefined;

  return {
    ...product,
    image: signedImage || product.image,
    images: signedImages ?? product.images,
    labAnalysisUrl: signedLab || product.labAnalysisUrl,
  };
}

async function resolveProducerImages(producer: Producer): Promise<Producer> {
  const signedImage = await getSignedImageUrl(producer.image);
  const signedProducts = await Promise.all(producer.products.map(resolveProductImages));
  return {
    ...producer,
    image: signedImage || producer.image,
    products: signedProducts,
  };
}

// Fetch all data and return as Producer array
// OPTIMIZED: Uses materialized view (1 query instead of N+1 pattern)
export async function fetchAllProducersWithProducts(): Promise<Producer[]> {
  if (!isSupabaseSyncConfigured()) {
    return [];
  }

  const isOnline = await isNetworkOnline();
  if (!isOnline) {
    const cached = await AsyncStorage.getItem('cache_producers_v2');
    return cached ? (JSON.parse(cached) as Producer[]) : [];
  }

  try {
    // Single query to materialized view with pagination
    const allProducers: Producer[] = [];
    let offset = 0;
    const limit = 500; // Larger batches since data is pre-joined

    while (true) {
      const response = await supabaseFetch(
        `${SUPABASE_URL}/rest/v1/producers_catalog?order=name.asc&limit=${limit}&offset=${offset}`,
        {
          method: 'GET',
          headers: getHeaders(),
        }
      );

      if (!response.ok) {
        throw new Error('Erreur récupération catalogue producteurs');
      }

      const rows: ProducersCatalogRow[] = await response.json();

      // Convert to Producer format
      for (const row of rows) {
        const producer = catalogRowToProducer(row);
        allProducers.push(await resolveProducerImages(producer));
      }

      // Check if there are more pages
      if (rows.length < limit) {
        break;
      }
      offset += limit;
    }

    return allProducers;
  } catch (error) {
    console.warn('Error fetching from Supabase:', error);
    const cached = await AsyncStorage.getItem('cache_producers_v2');
    return cached ? (JSON.parse(cached) as Producer[]) : [];
  }
}

// Sync a producer and all its products to Supabase
export async function syncProducerToSupabase(producer: Producer): Promise<void> {
  if (!isSupabaseSyncConfigured()) {
    throw new Error('Supabase non configuré');
  }

  if (producer.profileId) {
    const producerId = await findProducerIdByProfileId(producer.profileId);
    if (producerId) {
      await updateProducerInSupabase(producerId, producer);
      return;
    }
  }

  // Check if producer already exists
  const response = await supabaseFetch(`${SUPABASE_URL}/rest/v1/producers?id=eq.${producer.id}&select=id`, {
    method: 'GET',
    headers: getHeaders(),
  });

  const existing = await response.json();

  if (existing && existing.length > 0) {
    // Update existing producer
    await updateProducerInSupabase(producer.id, producer);
  } else {
    // Add new producer
    await addProducerToSupabase(producer);
  }

  // Sync products
  for (const product of producer.products) {
    await syncProductToSupabase(product, producer.id);
  }
}

// Sync a single product to Supabase
export async function syncProductToSupabase(product: ProducerProduct, producerId: string): Promise<void> {
  if (!isSupabaseSyncConfigured()) {
    throw new Error('Supabase non configuré');
  }

  // Check if product already exists
  const response = await supabaseFetch(`${SUPABASE_URL}/rest/v1/products?id=eq.${product.id}&select=id`, {
    method: 'GET',
    headers: getHeaders(),
  });

  const existing = await response.json();

  if (existing && existing.length > 0) {
    // Update existing product
    await updateProductInSupabase(product.id, product);
  } else {
    // Add new product
    await addProductToSupabase(product, producerId);
  }
}
