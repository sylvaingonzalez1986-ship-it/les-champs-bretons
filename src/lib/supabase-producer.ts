/**
 * Supabase Producer API - CRUD pour les produits d'un producteur
 * Ces fonctions utilisent le token d'authentification de l'utilisateur connecté
 * Les RLS policies protègent l'accès aux données
 *
 * Phase 3 - Sécurité:
 * - Validation Zod des entrées/sorties
 * - Masquage des erreurs techniques
 * - Timeouts globaux
 */

import { getSession, getValidSession } from './supabase-auth';
import { getSupabaseConfig } from './env-validation';
import {
  productSchema,
  productInsertSchema,
  productUpdateSchema,
  producerSchema,
  validateSafe,
  validateArraySafe,
  toUserError,
  USER_ERROR_MESSAGES,
  sanitizeString,
} from './validation';
import { PriceTier } from './producers';

// Utilise getSupabaseConfig() pour une validation centralisée
const { url: SUPABASE_URL, anonKey: SUPABASE_ANON_KEY } = getSupabaseConfig();

// Timeout global pour les requêtes (15 secondes)
const REQUEST_TIMEOUT = 15000;

// Types
export interface ProducerProductDB {
  id: string;
  producer_id: string;
  name: string;
  type: string;
  cbd_percent: number | null;
  thc_percent: number | null;
  price_public: number;
  price_pro: number | null;
  weight: string | null;
  image: string | null;
  images: string[] | null;
  description: string | null;
  tva_rate: number;
  stock: number | null;
  is_on_promo: boolean;
  promo_percent: number | null;
  visible_for_clients: boolean;
  visible_for_pros: boolean;
  status: 'draft' | 'published' | 'archived';
  lab_analysis_url: string | null; // URL de l'analyse de laboratoire
  disponible_vente_directe: boolean; // Disponible en vente directe à la ferme
  price_tiers: PriceTier[] | null; // Paliers de prix dégressifs clients
  price_pro_tiers: PriceTier[] | null; // Paliers de prix dégressifs pros
  created_at: string;
  updated_at: string;
}

export interface ProducerDB {
  id: string;
  name: string;
  profile_id: string | null;
  region: string | null;
  department: string | null;
  city: string | null;
  image: string | null;
  description: string | null;
  siret: string | null;
  tva_number: string | null;
  culture_outdoor: boolean | null;
  culture_greenhouse: boolean | null;
  culture_indoor: boolean | null;
}

// Types pour insert/update (sans les champs auto-générés)
export type ProductInsert = Omit<ProducerProductDB, 'id' | 'created_at' | 'updated_at'>;
export type ProductUpdate = Partial<Omit<ProducerProductDB, 'id' | 'producer_id' | 'created_at' | 'updated_at'>>;

// Helper pour obtenir les headers authentifiés (synchrone, pour les appels rapides)
const getAuthHeaders = (accessToken?: string) => {
  const session = getSession();
  const token = accessToken || session?.access_token || SUPABASE_ANON_KEY;
  return {
    'apikey': SUPABASE_ANON_KEY,
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json',
    'Prefer': 'return=representation',
  };
};

// Helper asynchrone qui rafraîchit le token si nécessaire
const getValidAuthHeaders = async () => {
  const session = await getValidSession();
  const token = session?.access_token || SUPABASE_ANON_KEY;
  return {
    'apikey': SUPABASE_ANON_KEY,
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json',
    'Prefer': 'return=representation',
  };
};

/**
 * Helper pour les requêtes avec timeout
 */
async function fetchWithTimeout(
  url: string,
  options: RequestInit,
  timeout: number = REQUEST_TIMEOUT
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    return response;
  } catch (error) {
    clearTimeout(timeoutId);
    if ((error as Error).name === 'AbortError') {
      throw new Error('Timeout: Le serveur ne répond pas');
    }
    throw error;
  }
}

/**
 * Récupère le producteur lié au profil de l'utilisateur connecté
 */
export async function fetchMyProducer(): Promise<ProducerDB | null> {
  const session = await getValidSession();
  if (!session?.user?.id) {
    console.log('[fetchMyProducer] No authenticated user');
    return null;
  }

  try {
    const response = await fetchWithTimeout(
      `${SUPABASE_URL}/rest/v1/producers?profile_id=eq.${encodeURIComponent(session.user.id)}&select=*`,
      {
        method: 'GET',
        headers: getAuthHeaders(session.access_token),
      }
    );

    if (!response.ok) {
      console.warn('[fetchMyProducer] HTTP error:', response.status);
      return null;
    }

    const data = await response.json();
    const producer = Array.isArray(data) && data.length > 0 ? data[0] : null;

    // Valider les données
    if (producer) {
      const validated = validateSafe(producerSchema, producer);
      return validated as ProducerDB;
    }

    return null;
  } catch (error) {
    console.warn('[fetchMyProducer] Error:', toUserError(error, 'fetchMyProducer'));
    return null;
  }
}

/**
 * Récupère tous les produits d'un producteur
 */
export async function fetchProducerProducts(producerId: string): Promise<ProducerProductDB[]> {
  // Valider l'entrée
  if (!producerId || typeof producerId !== 'string') {
    console.warn('[fetchProducerProducts] Invalid producerId');
    return [];
  }

  try {
    const headers = await getValidAuthHeaders();
    const response = await fetchWithTimeout(
      `${SUPABASE_URL}/rest/v1/products?producer_id=eq.${encodeURIComponent(producerId)}&select=*&order=created_at.desc`,
      {
        method: 'GET',
        headers,
      }
    );

    if (!response.ok) {
      console.warn('[fetchProducerProducts] HTTP error:', response.status);
      return [];
    }

    const data = await response.json();

    // Valider les données
    const validated = validateArraySafe(productSchema, data);
    return validated as ProducerProductDB[];
  } catch (error) {
    console.warn('[fetchProducerProducts] Error:', toUserError(error, 'fetchProducerProducts'));
    return [];
  }
}

/**
 * Crée un nouveau produit
 */
export async function createProduct(product: ProductInsert): Promise<ProducerProductDB | null> {
  // Valider les données d'entrée
  const validation = productInsertSchema.safeParse(product);
  if (!validation.success) {
    console.warn('[createProduct] Validation error:', validation.error.issues);
    return null;
  }

  try {
    const headers = await getValidAuthHeaders();

    // Sanitize les champs texte
    const sanitizedProduct = {
      ...validation.data,
      name: sanitizeString(validation.data.name),
      description: validation.data.description ? sanitizeString(validation.data.description) : null,
      id: `product-${Date.now()}`,
    };

    const response = await fetchWithTimeout(
      `${SUPABASE_URL}/rest/v1/products`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify(sanitizedProduct),
      }
    );

    if (!response.ok) {
      console.warn('[createProduct] HTTP error:', response.status);
      return null;
    }

    const data = await response.json();
    const result = Array.isArray(data) ? data[0] : data;

    // Valider la réponse
    const validated = validateSafe(productSchema, result);
    return validated as ProducerProductDB;
  } catch (error) {
    console.warn('[createProduct] Error:', toUserError(error, 'createProduct'));
    return null;
  }
}

/**
 * Met à jour un produit existant
 * Vérifie que le produit appartient bien au producteur connecté
 */
export async function updateProduct(
  productId: string,
  updates: ProductUpdate
): Promise<ProducerProductDB | null> {
  // Valider l'ID
  if (!productId || typeof productId !== 'string') {
    console.warn('[updateProduct] Invalid productId');
    return null;
  }

  // Valider les mises à jour
  const validation = productUpdateSchema.safeParse(updates);
  if (!validation.success) {
    console.warn('[updateProduct] Validation error:', validation.error.issues);
    return null;
  }

  try {
    // Récupérer le producteur de l'utilisateur connecté
    const myProducer = await fetchMyProducer();
    if (!myProducer) {
      console.warn('[updateProduct] User is not linked to any producer');
      return null;
    }

    // Récupérer le produit pour vérifier sa propriété
    const headers = await getValidAuthHeaders();
    const getResponse = await fetchWithTimeout(
      `${SUPABASE_URL}/rest/v1/products?id=eq.${encodeURIComponent(productId)}&select=producer_id`,
      {
        method: 'GET',
        headers,
      }
    );

    if (!getResponse.ok) {
      console.warn('[updateProduct] Error fetching product:', getResponse.status);
      return null;
    }

    const products = await getResponse.json();
    if (!products || products.length === 0) {
      console.warn('[updateProduct] Product not found:', productId);
      return null;
    }

    // Vérifier que le produit appartient au producteur connecté
    if (products[0].producer_id !== myProducer.id) {
      console.warn('[updateProduct] Unauthorized: Product belongs to different producer');
      return null;
    }

    // Sanitize les champs texte si présents
    const sanitizedUpdates: Record<string, unknown> = { ...validation.data };
    if (sanitizedUpdates.name) sanitizedUpdates.name = sanitizeString(sanitizedUpdates.name as string);
    if (sanitizedUpdates.description) sanitizedUpdates.description = sanitizeString(sanitizedUpdates.description as string);

    // Le produit appartient au bon producteur, effectuer la mise à jour
    const response = await fetchWithTimeout(
      `${SUPABASE_URL}/rest/v1/products?id=eq.${encodeURIComponent(productId)}`,
      {
        method: 'PATCH',
        headers,
        body: JSON.stringify(sanitizedUpdates),
      }
    );

    if (!response.ok) {
      console.warn('[updateProduct] HTTP error:', response.status);
      return null;
    }

    const data = await response.json();
    const result = Array.isArray(data) ? data[0] : data;

    // Valider la réponse
    const validated = validateSafe(productSchema, result);
    return validated as ProducerProductDB;
  } catch (error) {
    console.warn('[updateProduct] Error:', toUserError(error, 'updateProduct'));
    return null;
  }
}

/**
 * Supprime un produit
 * Vérifie que le produit appartient bien au producteur connecté
 */
export async function deleteProduct(productId: string): Promise<boolean> {
  // Valider l'ID
  if (!productId || typeof productId !== 'string') {
    console.warn('[deleteProduct] Invalid productId');
    return false;
  }

  try {
    // Récupérer le producteur de l'utilisateur connecté
    const myProducer = await fetchMyProducer();
    if (!myProducer) {
      console.warn('[deleteProduct] User is not linked to any producer');
      return false;
    }

    // Récupérer le produit pour vérifier sa propriété
    const headers = await getValidAuthHeaders();
    const getResponse = await fetchWithTimeout(
      `${SUPABASE_URL}/rest/v1/products?id=eq.${encodeURIComponent(productId)}&select=producer_id`,
      {
        method: 'GET',
        headers,
      }
    );

    if (!getResponse.ok) {
      console.warn('[deleteProduct] Error fetching product:', getResponse.status);
      return false;
    }

    const products = await getResponse.json();
    if (!products || products.length === 0) {
      console.warn('[deleteProduct] Product not found:', productId);
      return false;
    }

    // Vérifier que le produit appartient au producteur connecté
    if (products[0].producer_id !== myProducer.id) {
      console.warn('[deleteProduct] Unauthorized: Product belongs to different producer');
      return false;
    }

    // Le produit appartient au bon producteur, effectuer la suppression
    const response = await fetchWithTimeout(
      `${SUPABASE_URL}/rest/v1/products?id=eq.${encodeURIComponent(productId)}`,
      {
        method: 'DELETE',
        headers,
      }
    );

    if (!response.ok) {
      console.warn('[deleteProduct] HTTP error:', response.status);
      return false;
    }

    return true;
  } catch (error) {
    console.warn('[deleteProduct] Error:', toUserError(error, 'deleteProduct'));
    return false;
  }
}

/**
 * Met à jour les infos du producteur
 * Vérifie que le producteur appartient bien à l'utilisateur connecté
 */
export async function updateMyProducer(
  producerId: string,
  updates: Partial<ProducerDB>
): Promise<ProducerDB | null> {
  // Valider l'ID
  if (!producerId || typeof producerId !== 'string') {
    console.warn('[updateMyProducer] Invalid producerId');
    return null;
  }

  try {
    // Récupérer le producteur de l'utilisateur connecté
    const myProducer = await fetchMyProducer();
    if (!myProducer) {
      console.warn('[updateMyProducer] User is not linked to any producer');
      return null;
    }

    // Vérifier que le producteur à modifier appartient à l'utilisateur connecté
    if (myProducer.id !== producerId) {
      console.warn('[updateMyProducer] Unauthorized: Producer does not belong to user');
      return null;
    }

    // Sanitize les champs texte si présents
    const sanitizedUpdates: Record<string, unknown> = {};
    if (updates.name !== undefined) sanitizedUpdates.name = sanitizeString(updates.name);
    if (updates.description !== undefined) sanitizedUpdates.description = sanitizeString(updates.description);
    if (updates.region !== undefined) sanitizedUpdates.region = sanitizeString(updates.region);
    if (updates.department !== undefined) sanitizedUpdates.department = sanitizeString(updates.department);
    if (updates.city !== undefined) sanitizedUpdates.city = sanitizeString(updates.city);
    if (updates.siret !== undefined) sanitizedUpdates.siret = sanitizeString(updates.siret);
    if (updates.tva_number !== undefined) sanitizedUpdates.tva_number = sanitizeString(updates.tva_number);
    if (updates.image !== undefined) sanitizedUpdates.image = updates.image;
    if (updates.culture_outdoor !== undefined) sanitizedUpdates.culture_outdoor = updates.culture_outdoor;
    if (updates.culture_greenhouse !== undefined) sanitizedUpdates.culture_greenhouse = updates.culture_greenhouse;
    if (updates.culture_indoor !== undefined) sanitizedUpdates.culture_indoor = updates.culture_indoor;

    // Le producteur appartient au bon utilisateur, effectuer la mise à jour
    const headers = await getValidAuthHeaders();
    const response = await fetchWithTimeout(
      `${SUPABASE_URL}/rest/v1/producers?id=eq.${encodeURIComponent(producerId)}`,
      {
        method: 'PATCH',
        headers,
        body: JSON.stringify(sanitizedUpdates),
      }
    );

    if (!response.ok) {
      console.warn('[updateMyProducer] HTTP error:', response.status);
      return null;
    }

    const data = await response.json();
    const result = Array.isArray(data) ? data[0] : data;

    // Valider la réponse
    const validated = validateSafe(producerSchema, result);
    return validated as ProducerDB;
  } catch (error) {
    console.warn('[updateMyProducer] Error:', toUserError(error, 'updateMyProducer'));
    return null;
  }
}

/**
 * Décrémente le stock d'un produit dans Supabase
 * Utilisé après une vente pour mettre à jour le stock en base de données
 */
export async function decrementProductStockInSupabase(
  productId: string,
  quantity: number
): Promise<boolean> {
  // Valider les entrées
  if (!productId || typeof productId !== 'string') {
    console.warn('[decrementProductStockInSupabase] Invalid productId');
    return false;
  }

  if (typeof quantity !== 'number' || quantity < 0 || !Number.isInteger(quantity)) {
    console.warn('[decrementProductStockInSupabase] Invalid quantity');
    return false;
  }

  try {
    const headers = await getValidAuthHeaders();
    // D'abord récupérer le stock actuel
    const getResponse = await fetchWithTimeout(
      `${SUPABASE_URL}/rest/v1/products?id=eq.${encodeURIComponent(productId)}&select=id,stock`,
      {
        method: 'GET',
        headers,
      }
    );

    if (!getResponse.ok) {
      console.warn('[decrementProductStockInSupabase] Error fetching product:', getResponse.status);
      return false;
    }

    const products = await getResponse.json();
    if (!products || products.length === 0) {
      console.log('[decrementProductStockInSupabase] Product not found:', productId);
      return false;
    }

    const currentStock = products[0].stock;

    // Si le stock est null (illimité), on ne fait rien
    if (currentStock === null) {
      console.log('[decrementProductStockInSupabase] Stock is unlimited for product:', productId);
      return true;
    }

    const newStock = Math.max(0, currentStock - quantity);

    // Mettre à jour le stock
    const updateResponse = await fetchWithTimeout(
      `${SUPABASE_URL}/rest/v1/products?id=eq.${encodeURIComponent(productId)}`,
      {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ stock: newStock }),
      }
    );

    if (!updateResponse.ok) {
      console.warn('[decrementProductStockInSupabase] Error updating stock:', updateResponse.status);
      return false;
    }

    console.log(`[decrementProductStockInSupabase] Stock updated: ${productId}, ${currentStock} -> ${newStock}`);
    return true;
  } catch (error) {
    console.warn('[decrementProductStockInSupabase] Error:', toUserError(error, 'decrementProductStockInSupabase'));
    return false;
  }
}
