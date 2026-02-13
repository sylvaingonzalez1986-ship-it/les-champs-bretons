import { getValidSession } from './supabase-auth';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  SUPABASE_URL,
  getAuthenticatedHeaders,
  getHeaders,
  isNetworkOnline,
  isSupabaseSyncConfigured,
  supabaseFetch,
} from './supabase-sync-core';
import { linkUserCode } from './supabase-sync.user';
import type { SupabaseUserLot } from './supabase-sync.user';
import { Lot, LotItem, Rarity } from './store';
import { generateSecureUUID } from './uuid';
import * as Crypto from 'expo-crypto';
import { getSignedImageUrl } from './storage-utils';

// ==================== LOTS (TIRAGE) ====================

export interface SupabaseLot {
  id: string;
  name: string;
  description: string;
  rarity: string;
  image: string;
  value: number;
  active: boolean;
  lot_type: string | null;
  discount_percent: number | null;
  discount_amount: number | null;
  min_order_amount: number | null;
  created_at: string;
  updated_at: string;
}

export interface SupabaseLotItem {
  id: string;
  lot_id: string;
  product_id: string;
  producer_id: string;
  product_name: string;
  producer_name: string;
  quantity: number;
  created_at: string;
}

// Convert Supabase lot to app Lot format
function supabaseToLot(sl: SupabaseLot, items: LotItem[]): Lot {
  return {
    id: sl.id,
    name: sl.name,
    description: sl.description,
    rarity: sl.rarity as Rarity,
    image: sl.image,
    items,
    value: sl.value,
    active: sl.active,
    lotType: sl.lot_type as 'product' | 'discount' | undefined,
    discountPercent: sl.discount_percent ?? undefined,
    discountAmount: sl.discount_amount ?? undefined,
    minOrderAmount: sl.min_order_amount ?? undefined,
  };
}


// Convert Supabase lot item to app format
function supabaseToLotItem(sli: SupabaseLotItem): LotItem {
  return {
    productId: sli.product_id,
    producerId: sli.producer_id,
    productName: sli.product_name,
    producerName: sli.producer_name,
    quantity: sli.quantity,
  };
}

async function resolveLotImages(lot: Lot): Promise<Lot> {
  const signedImage = await getSignedImageUrl(lot.image);
  return {
    ...lot,
    image: signedImage || lot.image,
  };
}

// Fetch all lots from Supabase
export async function fetchLots(): Promise<SupabaseLot[]> {
  if (!isSupabaseSyncConfigured()) {
    throw new Error('Supabase non configuré');
  }

  const response = await supabaseFetch(`${SUPABASE_URL}/rest/v1/lots?select=*&order=name.asc`, {
    method: 'GET',
    headers: getHeaders(),
  });

  if (!response.ok) {
    throw new Error('Erreur récupération lots');
  }

  return response.json();
}

// Fetch lot items from Supabase
export async function fetchLotItems(): Promise<SupabaseLotItem[]> {
  if (!isSupabaseSyncConfigured()) {
    throw new Error('Supabase non configuré');
  }

  const response = await supabaseFetch(`${SUPABASE_URL}/rest/v1/lot_items?select=*`, {
    method: 'GET',
    headers: getHeaders(),
  });

  if (!response.ok) {
    throw new Error('Erreur récupération lot items');
  }

  return response.json();
}

// Add lot to Supabase
export async function addLotToSupabase(lot: Lot): Promise<SupabaseLot> {
  if (!isSupabaseSyncConfigured()) {
    throw new Error('Supabase non configuré');
  }

  const headers = await getAuthenticatedHeaders();
  const response = await supabaseFetch(`${SUPABASE_URL}/functions/v1/lots-mutations`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      action: 'create',
      lot,
      items: lot.items,
    }),
  });

  if (!response.ok) {
    throw new Error('Erreur ajout lot');
  }

  const data = await response.json();
  return data?.lot ?? data;
}

// Add lot item to Supabase
export async function addLotItemToSupabase(item: LotItem, lotId: string): Promise<SupabaseLotItem> {
  if (!isSupabaseSyncConfigured()) {
    throw new Error('Supabase non configuré');
  }

  const headers = await getAuthenticatedHeaders();
  const response = await supabaseFetch(`${SUPABASE_URL}/functions/v1/lots-mutations`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      action: 'addItem',
      lotId,
      item,
    }),
  });

  if (!response.ok) {
    throw new Error('Erreur ajout lot item');
  }

  const data = await response.json();
  return data?.item ?? data;
}

// Update lot in Supabase
export async function updateLotInSupabase(id: string, lot: Partial<Lot>): Promise<void> {
  if (!isSupabaseSyncConfigured()) {
    throw new Error('Supabase non configuré');
  }

  const headers = await getAuthenticatedHeaders();
  const response = await supabaseFetch(`${SUPABASE_URL}/functions/v1/lots-mutations`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      action: 'update',
      lotId: id,
      updates: lot,
    }),
  });

  if (!response.ok) {
    throw new Error('Erreur mise à jour lot');
  }
}

// Delete lot from Supabase
export async function deleteLotFromSupabase(id: string): Promise<void> {
  if (!isSupabaseSyncConfigured()) {
    throw new Error('Supabase non configuré');
  }

  const headers = await getAuthenticatedHeaders();
  const response = await supabaseFetch(`${SUPABASE_URL}/functions/v1/lots-mutations`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      action: 'delete',
      lotId: id,
    }),
  });

  if (!response.ok) {
    throw new Error('Erreur suppression lot');
  }
}

// Fetch all lots with their items
export async function fetchAllLotsWithItems(): Promise<Lot[]> {
  if (!isSupabaseSyncConfigured()) {
    return [];
  }

  const isOnline = await isNetworkOnline();
  if (!isOnline) {
    const cached = await AsyncStorage.getItem('cache_lots_v2');
    return cached ? (JSON.parse(cached) as Lot[]) : [];
  }

  try {
    const [supabaseLots, supabaseLotItems] = await Promise.all([
      fetchLots(),
      fetchLotItems(),
    ]);

    // Group items by lot_id
    const itemsByLot = new Map<string, LotItem[]>();
    for (const sli of supabaseLotItems) {
      const items = itemsByLot.get(sli.lot_id) || [];
      items.push(supabaseToLotItem(sli));
      itemsByLot.set(sli.lot_id, items);
    }

    // Convert to Lot array
    const lots = supabaseLots.map((sl) =>
      supabaseToLot(sl, itemsByLot.get(sl.id) || [])
    );

    return Promise.all(lots.map(resolveLotImages));
  } catch (error) {
    console.warn('Error fetching lots from Supabase:', error);
    const cached = await AsyncStorage.getItem('cache_lots_v2');
    return cached ? (JSON.parse(cached) as Lot[]) : [];
  }
}

// Sync a lot to Supabase
export async function syncLotToSupabase(lot: Lot): Promise<void> {
  if (!isSupabaseSyncConfigured()) {
    throw new Error('Supabase non configuré');
  }

  // Check if lot already exists
  const response = await supabaseFetch(`${SUPABASE_URL}/rest/v1/lots?id=eq.${lot.id}&select=id`, {
    method: 'GET',
    headers: getHeaders(),
  });

  const existing = await response.json();

  if (existing && existing.length > 0) {
    // Update existing lot
    await updateLotInSupabase(lot.id, lot);

    // Replace items via Edge Function
    const headers = await getAuthenticatedHeaders();
    const replaceResponse = await supabaseFetch(`${SUPABASE_URL}/functions/v1/lots-mutations`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        action: 'replaceItems',
        lotId: lot.id,
        items: lot.items,
      }),
    });

    if (!replaceResponse.ok) {
      throw new Error('Erreur mise à jour lot items');
    }
  } else {
    // Add new lot
    await addLotToSupabase(lot);
  }
}

// ==================== USER LOTS (LOTS GAGNÉS PAR UTILISATEUR) ====================

export interface UserWonLot {
  id: string;
  userCode: string;
  lotId: string;
  lotName: string;
  lotDescription: string | null;
  lotRarity: Rarity;
  lotImage: string | null;
  lotType: 'product' | 'discount';
  lotValue: number | null;
  discountPercent: number | null;
  discountAmount: number | null;
  minOrderAmount: number | null;
  wonAt: string;
  used: boolean;
  usedAt: string | null;
  giftedTo: string | null;
  giftedAt: string | null;
  giftCode: string | null;
}

// Convert Supabase user lot to app format
function supabaseToUserLot(sul: SupabaseUserLot): UserWonLot {
  return {
    id: sul.id,
    userCode: sul.user_code,
    lotId: sul.lot_id,
    lotName: sul.lot_name,
    lotDescription: sul.lot_description,
    lotRarity: sul.lot_rarity as Rarity,
    lotImage: sul.lot_image,
    lotType: sul.lot_type as 'product' | 'discount',
    lotValue: sul.lot_value,
    discountPercent: sul.discount_percent,
    discountAmount: sul.discount_amount,
    minOrderAmount: sul.min_order_amount,
    wonAt: sul.won_at,
    used: sul.used,
    usedAt: sul.used_at,
    giftedTo: sul.gifted_to,
    giftedAt: sul.gifted_at,
    giftCode: sul.gift_code,
  };
}

// Record a won lot for a user - NEW VERSION WITH user_id
export async function recordUserWonLot(
  userCode: string,
  lot: Lot,
  lotType: 'product' | 'discount'
): Promise<UserWonLot | null> {
  if (!isSupabaseSyncConfigured()) {
    return null;
  }

  const giftCode = `GIFT-${generateSecureGiftCode()}`;

  try {
    const session = await getValidSession();
    const userId = session?.user?.id;

    // Si l'utilisateur est authentifié, utiliser user_id et lier le code
    if (userId) {
      // Lier le user_code à l'user_id (si pas déjà fait)
      await linkUserCode(userCode);

      const headers = await getAuthenticatedHeaders();

      const response = await supabaseFetch(`${SUPABASE_URL}/functions/v1/user-lots-mutations`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          action: 'recordWon',
          userCode,
          giftCode,
          lot: {
            lotId: lot.id,
            lotName: lot.name,
            lotDescription: lot.description || null,
            lotRarity: lot.rarity,
            lotImage: lot.image || null,
            lotType,
            lotValue: lot.value,
            discountPercent: lot.discountPercent ?? null,
            discountAmount: lot.discountAmount ?? null,
            minOrderAmount: lot.minOrderAmount ?? null,
          },
        }),
      });

      if (!response.ok) {
        console.warn('[recordUserWonLot] Error recording won lot');
        return null;
      }

      const result = await response.json();
      return supabaseToUserLot(Array.isArray(result) ? result[0] : result);
    } else {
      // User non authentifié - garder l'ancienne approche avec user_code

      const response = await supabaseFetch(`${SUPABASE_URL}/functions/v1/user-lots-mutations`, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({
          action: 'recordWon',
          userCode,
          giftCode,
          lot: {
            lotId: lot.id,
            lotName: lot.name,
            lotDescription: lot.description || null,
            lotRarity: lot.rarity,
            lotImage: lot.image || null,
            lotType,
            lotValue: lot.value,
            discountPercent: lot.discountPercent ?? null,
            discountAmount: lot.discountAmount ?? null,
            minOrderAmount: lot.minOrderAmount ?? null,
          },
        }),
      });

      if (!response.ok) {
        console.warn('[recordUserWonLot] Error recording won lot');
        return null;
      }

      const result = await response.json();
      return supabaseToUserLot(Array.isArray(result) ? result[0] : result);
    }
  } catch (error) {
    console.warn('[recordUserWonLot] Error:', error);
    return null;
  }
}

// Generate a cryptographically secure gift code
function generateSecureGiftCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const codeLength = 8;

  // Use expo-crypto for secure random bytes
  if (Crypto?.getRandomBytes) {
    const randomBytes = Crypto.getRandomBytes(codeLength);
    let code = '';
    for (let i = 0; i < codeLength; i++) {
      code += chars.charAt(randomBytes[i] % chars.length);
    }
    return code;
  }

  // Fallback to Web Crypto API
  const cryptoObj = globalThis.crypto as Crypto | undefined;
  if (cryptoObj?.getRandomValues) {
    const randomArray = new Uint8Array(codeLength);
    cryptoObj.getRandomValues(randomArray);
    let code = '';
    for (let i = 0; i < codeLength; i++) {
      code += chars.charAt(randomArray[i] % chars.length);
    }
    return code;
  }

  // Last resort fallback (logs warning) - uses secure UUID
  console.warn('[GiftCode] No secure random available, using UUID-based fallback');
  return generateSecureUUID().replace(/-/g, '').substring(0, 8).toUpperCase();
}

// Fetch user's won lots - WITH AUTHENTICATION
export async function fetchUserWonLots(userCode: string): Promise<UserWonLot[]> {
  if (!isSupabaseSyncConfigured()) {
    return [];
  }

  try {
    const session = await getValidSession();

    // Si authentifié, utiliser user_id + headers authentifiés
    if (session?.user?.id) {
      const headers = await getAuthenticatedHeaders();
      const response = await supabaseFetch(
        `${SUPABASE_URL}/rest/v1/user_lots?user_id=eq.${session.user.id}&order=won_at.desc`,
        {
          method: 'GET',
          headers,
        }
      );

      if (!response.ok) {
        return [];
      }

      const data: SupabaseUserLot[] = await response.json();
      return data.map(supabaseToUserLot);
    } else {
      // Non authentifié - utiliser user_code avec headers publics
      const response = await supabaseFetch(
        `${SUPABASE_URL}/rest/v1/user_lots?user_code=eq.${userCode}&order=won_at.desc`,
        {
          method: 'GET',
          headers: getHeaders(),
        }
      );

      if (!response.ok) {
        return [];
      }

      const data: SupabaseUserLot[] = await response.json();
      return data.map(supabaseToUserLot);
    }
  } catch (error) {
    console.warn('Error fetching user lots:', error);
    return [];
  }
}

// Mark a lot as used - WITH AUTHENTICATION
export async function markUserLotAsUsed(lotId: string): Promise<boolean> {
  if (!isSupabaseSyncConfigured()) {
    return false;
  }

  try {
    const headers = await getAuthenticatedHeaders();
    const response = await supabaseFetch(`${SUPABASE_URL}/functions/v1/user-lots-mutations`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        action: 'markUsed',
        lotId,
      }),
    });

    return response.ok;
  } catch (error) {
    console.warn('Error marking lot as used:', error);
    return false;
  }
}

// Gift a lot to another user - WITH AUTHENTICATION
export async function giftLotToUser(lotId: string, recipientCode: string): Promise<boolean> {
  if (!isSupabaseSyncConfigured()) {
    return false;
  }

  try {
    const headers = await getAuthenticatedHeaders();
    const response = await supabaseFetch(`${SUPABASE_URL}/functions/v1/user-lots-mutations`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        action: 'giftTo',
        lotId,
        recipientCode,
      }),
    });

    return response.ok;
  } catch (error) {
    console.warn('Error gifting lot:', error);
    return false;
  }
}

// Claim validation result type
export interface ClaimGiftResult {
  success: boolean;
  lot: UserWonLot | null;
  error?: 'not_found' | 'already_used' | 'already_claimed' | 'own_code' | 'invalid_format' | 'network_error';
  errorMessage?: string;
}

// Claim a gifted lot using gift code
export async function claimGiftedLot(giftCode: string, recipientCode: string): Promise<UserWonLot | null> {
  const result = await claimGiftedLotWithDetails(giftCode, recipientCode);
  return result.lot;
}

// Claim a gifted lot with detailed error information
export async function claimGiftedLotWithDetails(giftCode: string, recipientCode: string): Promise<ClaimGiftResult> {
  if (!isSupabaseSyncConfigured()) {
    return { success: false, lot: null, error: 'network_error', errorMessage: 'Supabase non configuré' };
  }

  // Validate gift code format (should be GIFT-XXXXXXXX)
  const normalizedCode = giftCode.trim().toUpperCase();
  if (!normalizedCode.startsWith('GIFT-') || normalizedCode.length < 10) {
    return {
      success: false,
      lot: null,
      error: 'invalid_format',
      errorMessage: 'Format de code invalide. Le code doit commencer par GIFT-'
    };
  }

  try {
    const response = await supabaseFetch(`${SUPABASE_URL}/functions/v1/user-lots-mutations`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({
        action: 'claimGift',
        giftCode: normalizedCode,
        recipientCode,
      }),
    });

    if (!response.ok) {
      const status = response.status;
      if (status === 404) {
        return { success: false, lot: null, error: 'not_found', errorMessage: 'Code introuvable. Vérifiez que le code est correct.' };
      }
      if (status === 400) {
        return { success: false, lot: null, error: 'own_code', errorMessage: 'Vous ne pouvez pas utiliser votre propre code cadeau.' };
      }
      if (status === 409) {
        return { success: false, lot: null, error: 'already_used', errorMessage: 'Ce code a déjà été utilisé.' };
      }
      return { success: false, lot: null, error: 'network_error', errorMessage: 'Erreur lors de la réclamation du cadeau' };
    }

    const payload = await response.json();
    const claimedLot = payload?.lot ? supabaseToUserLot(payload.lot) : null;
    return { success: true, lot: claimedLot };

  } catch (error) {
    console.warn('[claimGiftedLot] Error:', error instanceof Error ? error.message : 'Unknown error');
    return {
      success: false,
      lot: null,
      error: 'network_error',
      errorMessage: `Erreur: ${error instanceof Error ? error.message : 'Erreur inconnue'}`
    };
  }
}

// Fetch lots gifted to a user (pending claim)
export async function fetchGiftedLotsForUser(userCode: string): Promise<UserWonLot[]> {
  if (!isSupabaseSyncConfigured()) {
    return [];
  }

  try {
    const response = await supabaseFetch(
      `${SUPABASE_URL}/rest/v1/user_lots?gifted_to=eq.${userCode}&order=gifted_at.desc`,
      {
        method: 'GET',
        headers: getHeaders(),
      }
    );

    if (!response.ok) {
      return [];
    }

    const data: SupabaseUserLot[] = await response.json();
    return data.map(supabaseToUserLot);
  } catch (error) {
    console.warn('Error fetching gifted lots:', error);
    return [];
  }
}

// Find a user's won lot by collection item ID and get its gift code
export async function getGiftCodeForCollectionItem(userCode: string, lotId: string): Promise<string | null> {
  if (!isSupabaseSyncConfigured()) {
    return null;
  }

  try {
    // Find the lot in user_lots that matches this lot_id for this user
    const response = await supabaseFetch(
      `${SUPABASE_URL}/rest/v1/user_lots?user_code=eq.${userCode}&lot_id=eq.${lotId}&used=eq.false&gifted_to=is.null&select=gift_code`,
      {
        method: 'GET',
        headers: getHeaders(),
      }
    );

    if (!response.ok) {
      return null;
    }

    const data = await response.json();
    if (data && data.length > 0) {
      return data[0].gift_code;
    }
    return null;
  } catch (error) {
    console.warn('[getGiftCodeForCollectionItem] Error:', error);
    return null;
  }
}

// Mark a user lot as gifted (shared with someone)
export async function markLotAsGifted(userCode: string, lotId: string): Promise<boolean> {
  if (!isSupabaseSyncConfigured()) {
    return false;
  }

  try {
    // Find the lot first
    const findResponse = await supabaseFetch(
      `${SUPABASE_URL}/rest/v1/user_lots?user_code=eq.${userCode}&lot_id=eq.${lotId}&used=eq.false&gifted_to=is.null&select=id`,
      {
        method: 'GET',
        headers: getHeaders(),
      }
    );

    if (!findResponse.ok) {
      return false;
    }

    const lots = await findResponse.json();
    if (lots.length === 0) {
      return false;
    }

    // We don't actually need to update anything - the gift_code is already there
    // The lot will be claimed when someone uses the code
    return true;
  } catch (error) {
    console.warn('[markLotAsGifted] Error:', error);
    return false;
  }
}

