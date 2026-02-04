import { getValidSession } from './supabase-auth';
import {
  SUPABASE_URL,
  getAuthenticatedHeaders,
  isSupabaseSyncConfigured,
  supabaseFetch,
} from './supabase-sync-core';

// ==================== USER DATA SYNC ====================
// Synchronisation des données utilisateur (collection, tickets, parrainage)

// Types pour les données utilisateur Supabase
export interface SupabaseUserSubscription {
  id: string;
  user_id: string;
  subscription_tier: string;
  tickets: number;
  last_ticket_refresh: string | null;
  created_at: string;
  updated_at: string;
}

export interface SupabaseUserCollectionItem {
  id: string;
  user_id: string;
  product_id: string;
  product_name: string;
  product_rarity: string;
  product_value: number;
  product_image: string | null;
  lot_id: string | null;
  lot_type: string | null;
  discount_percent: number | null;
  discount_amount: number | null;
  min_order_amount: number | null;
  used: boolean;
  obtained_at: string;
  created_at: string;
}

export interface SupabaseUserReferral {
  id: string;
  user_id: string;
  referral_code: string;
  points: number;
  created_at: string;
  updated_at: string;
}

export interface SupabaseUserGift {
  id: string;
  sender_id: string;
  recipient_id: string | null;
  gift_code: string;
  collection_item_id: string | null;
  product_id: string;
  product_name: string;
  product_rarity: string | null;
  claimed_at: string | null;
  used: boolean;
  created_at: string;
}

export interface SupabaseUserStats {
  id: string;
  user_id: string;
  total_spins: number;
  created_at: string;
  updated_at: string;
}

export interface SupabaseUserLot {
  id: string;
  user_id?: string;
  user_code: string;
  lot_id: string;
  lot_name: string;
  lot_description: string | null;
  lot_rarity: string | null;
  lot_image: string | null;
  lot_type: string;
  lot_value: number | null;
  discount_percent: number | null;
  discount_amount: number | null;
  min_order_amount: number | null;
  won_at: string;
  used: boolean;
  used_at: string | null;
  gifted_to: string | null;
  gifted_at: string | null;
  gift_code: string | null;
  created_at: string;
}

// ==================== SUBSCRIPTIONS ====================

export async function fetchUserSubscription(): Promise<SupabaseUserSubscription | null> {
  if (!isSupabaseSyncConfigured()) return null;

  try {
    const headers = await getAuthenticatedHeaders();
    const response = await supabaseFetch(`${SUPABASE_URL}/rest/v1/user_subscriptions?select=*`, {
      method: 'GET',
      headers,
    });

    if (!response.ok) return null;

    const data = await response.json();
    return data[0] || null;
  } catch (error) {
    console.warn('[UserSync] Erreur fetch subscription:', error);
    return null;
  }
}

export async function upsertUserSubscription(
  tier: string,
  tickets: number,
  lastRefresh: string | null
): Promise<void> {
  if (!isSupabaseSyncConfigured()) return;

  try {
    const session = await getValidSession();
    if (!session?.user?.id) return;

    const headers = await getAuthenticatedHeaders();
    await supabaseFetch(`${SUPABASE_URL}/functions/v1/user-subscriptions-mutations`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        subscriptionTier: tier,
        tickets,
        lastTicketRefresh: lastRefresh,
      }),
    });
  } catch (error) {
    console.warn('[UserSync] Erreur upsert subscription:', error);
  }
}

// ==================== COLLECTION ====================

export async function fetchUserCollection(): Promise<SupabaseUserCollectionItem[]> {
  if (!isSupabaseSyncConfigured()) return [];

  try {
    const headers = await getAuthenticatedHeaders();
    const response = await supabaseFetch(
      `${SUPABASE_URL}/rest/v1/user_collection?select=*&order=obtained_at.desc`,
      {
        method: 'GET',
        headers,
      }
    );

    if (!response.ok) return [];

    return await response.json();
  } catch (error) {
    console.warn('[UserSync] Erreur fetch collection:', error);
    return [];
  }
}

export async function addToUserCollection(item: {
  productId: string;
  productName: string;
  productRarity: string;
  productValue: number;
  productImage?: string;
  lotId?: string;
  lotType?: string;
  discountPercent?: number;
  discountAmount?: number;
  minOrderAmount?: number;
}): Promise<string | null> {
  if (!isSupabaseSyncConfigured()) return null;

  try {
    const session = await getValidSession();
    if (!session?.user?.id) return null;

    const headers = await getAuthenticatedHeaders();
    const response = await supabaseFetch(`${SUPABASE_URL}/functions/v1/user-collection-mutations`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        action: 'add',
        item: {
          productId: item.productId,
          productName: item.productName,
          productRarity: item.productRarity,
          productValue: item.productValue,
          productImage: item.productImage || null,
          lotId: item.lotId || null,
          lotType: item.lotType || null,
          discountPercent: item.discountPercent || null,
          discountAmount: item.discountAmount || null,
          minOrderAmount: item.minOrderAmount || null,
        },
      }),
    });

    if (!response.ok) {
      console.warn('[UserSync] Erreur add collection');
      return null;
    }

    const result = await response.json();
    return result?.id || null;
  } catch (error) {
    console.warn('[UserSync] Erreur add collection:', error);
    return null;
  }
}

export async function markCollectionItemUsed(itemId: string): Promise<void> {
  if (!isSupabaseSyncConfigured()) return;

  try {
    const headers = await getAuthenticatedHeaders();
    await supabaseFetch(`${SUPABASE_URL}/functions/v1/user-collection-mutations`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        action: 'markUsed',
        itemId,
      }),
    });
  } catch (error) {
    console.warn('[UserSync] Erreur mark used:', error);
  }
}

export async function deleteCollectionItem(itemId: string): Promise<void> {
  if (!isSupabaseSyncConfigured()) return;

  try {
    const headers = await getAuthenticatedHeaders();
    await supabaseFetch(`${SUPABASE_URL}/functions/v1/user-collection-mutations`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        action: 'delete',
        itemId,
      }),
    });
  } catch (error) {
    console.warn('[UserSync] Erreur delete collection:', error);
  }
}

// ==================== REFERRALS ====================

export async function fetchUserReferral(): Promise<SupabaseUserReferral | null> {
  if (!isSupabaseSyncConfigured()) return null;

  try {
    const headers = await getAuthenticatedHeaders();
    const response = await supabaseFetch(`${SUPABASE_URL}/rest/v1/user_referrals?select=*`, {
      method: 'GET',
      headers,
    });

    if (!response.ok) return null;

    const data = await response.json();
    return data[0] || null;
  } catch (error) {
    console.warn('[UserSync] Erreur fetch referral:', error);
    return null;
  }
}

export async function upsertUserReferral(code: string, points: number): Promise<void> {
  if (!isSupabaseSyncConfigured()) return;

  try {
    const session = await getValidSession();
    if (!session?.user?.id) return;

    const headers = await getAuthenticatedHeaders();
    await supabaseFetch(`${SUPABASE_URL}/functions/v1/user-referrals-mutations`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        action: 'upsert',
        referralCode: code,
        points,
      }),
    });
  } catch (error) {
    console.warn('[UserSync] Erreur upsert referral:', error);
  }
}

export async function addReferralPoints(pointsToAdd: number): Promise<number> {
  if (!isSupabaseSyncConfigured()) return 0;

  try {
    const current = await fetchUserReferral();
    const newPoints = (current?.points || 0) + pointsToAdd;
    await upsertUserReferral(current?.referral_code || '', newPoints);
    return newPoints;
  } catch (error) {
    console.warn('[UserSync] Erreur add points:', error);
    return 0;
  }
}

// ==================== GIFTS ====================

export async function fetchUserGiftsSent(): Promise<SupabaseUserGift[]> {
  if (!isSupabaseSyncConfigured()) return [];

  try {
    const session = await getValidSession();
    if (!session?.user?.id) return [];

    const headers = await getAuthenticatedHeaders();
    const response = await supabaseFetch(
      `${SUPABASE_URL}/rest/v1/user_gifts?sender_id=eq.${session.user.id}&select=*&order=created_at.desc`,
      {
        method: 'GET',
        headers,
      }
    );

    if (!response.ok) return [];
    return await response.json();
  } catch (error) {
    console.warn('[UserSync] Erreur fetch gifts sent:', error);
    return [];
  }
}

export async function fetchUserGiftsReceived(): Promise<SupabaseUserGift[]> {
  if (!isSupabaseSyncConfigured()) return [];

  try {
    const session = await getValidSession();
    if (!session?.user?.id) return [];

    const headers = await getAuthenticatedHeaders();
    const response = await supabaseFetch(
      `${SUPABASE_URL}/rest/v1/user_gifts?recipient_id=eq.${session.user.id}&select=*&order=created_at.desc`,
      {
        method: 'GET',
        headers,
      }
    );

    if (!response.ok) return [];
    return await response.json();
  } catch (error) {
    console.warn('[UserSync] Erreur fetch gifts received:', error);
    return [];
  }
}

export async function createGift(gift: {
  giftCode: string;
  collectionItemId?: string;
  productId: string;
  productName: string;
  productRarity?: string;
}): Promise<string | null> {
  if (!isSupabaseSyncConfigured()) return null;

  try {
    const session = await getValidSession();
    if (!session?.user?.id) return null;

    const headers = await getAuthenticatedHeaders();
    const response = await supabaseFetch(`${SUPABASE_URL}/functions/v1/user-gifts-mutations`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        action: 'create',
        gift: {
          giftCode: gift.giftCode,
          collectionItemId: gift.collectionItemId || null,
          productId: gift.productId,
          productName: gift.productName,
          productRarity: gift.productRarity || null,
        },
      }),
    });

    if (!response.ok) return null;

    const result = await response.json();
    return result?.id || null;
  } catch (error) {
    console.warn('[UserSync] Erreur create gift:', error);
    return null;
  }
}

export async function claimGiftByCode(giftCode: string): Promise<SupabaseUserGift | null> {
  if (!isSupabaseSyncConfigured()) return null;

  try {
    const session = await getValidSession();
    if (!session?.user?.id) return null;

    const headers = await getAuthenticatedHeaders();

    const response = await supabaseFetch(`${SUPABASE_URL}/functions/v1/user-gifts-mutations`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        action: 'claim',
        giftCode,
      }),
    });

    if (!response.ok) return null;

    return await response.json();
  } catch (error) {
    console.warn('[UserSync] Erreur claim gift:', error);
    return null;
  }
}

// ==================== STATS ====================

export async function fetchUserStats(): Promise<SupabaseUserStats | null> {
  if (!isSupabaseSyncConfigured()) return null;

  try {
    const headers = await getAuthenticatedHeaders();
    const response = await supabaseFetch(`${SUPABASE_URL}/rest/v1/user_stats?select=*`, {
      method: 'GET',
      headers,
    });

    if (!response.ok) return null;

    const data = await response.json();
    return data[0] || null;
  } catch (error) {
    console.warn('[UserSync] Erreur fetch stats:', error);
    return null;
  }
}

export async function incrementUserSpins(): Promise<number> {
  if (!isSupabaseSyncConfigured()) return 0;

  try {
    const session = await getValidSession();
    if (!session?.user?.id) return 0;

    const headers = await getAuthenticatedHeaders();
    const response = await supabaseFetch(`${SUPABASE_URL}/functions/v1/user-stats-mutations`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        action: 'incrementSpins',
      }),
    });

    if (!response.ok) return 0;

    const data = await response.json();
    return data?.totalSpins ?? 0;
  } catch (error) {
    console.warn('[UserSync] Erreur increment spins:', error);
    return 0;
  }
}

// ==================== SYNC ALL USER DATA ====================

export interface UserSyncData {
  subscription: SupabaseUserSubscription | null;
  collection: SupabaseUserCollectionItem[];
  referral: SupabaseUserReferral | null;
  giftsSent: SupabaseUserGift[];
  giftsReceived: SupabaseUserGift[];
  stats: SupabaseUserStats | null;
}

export async function fetchAllUserData(): Promise<UserSyncData> {
  const [subscription, collection, referral, giftsSent, giftsReceived, stats] = await Promise.all([
    fetchUserSubscription(),
    fetchUserCollection(),
    fetchUserReferral(),
    fetchUserGiftsSent(),
    fetchUserGiftsReceived(),
    fetchUserStats(),
  ]);

  return {
    subscription,
    collection,
    referral,
    giftsSent,
    giftsReceived,
    stats,
  };
}

// ==================== USER_CODE MAPPING ====================

/**
 * Lier un user_code local à l'user_id authentifié
 * Appelé quand un utilisateur se connecte
 */
export async function linkUserCode(userCode: string): Promise<boolean> {
  if (!isSupabaseSyncConfigured()) return false;

  try {
    const session = await getValidSession();
    if (!session?.user?.id) return false;

    const headers = await getAuthenticatedHeaders();

    const response = await supabaseFetch(`${SUPABASE_URL}/functions/v1/user-code-mapping-mutations`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        action: 'link',
        userCode,
      }),
    });

    if (!response.ok) {
      if (response.status === 409) {
        return false;
      }
      console.warn('[UserSync] Erreur link code');
      return false;
    }
    return true;
  } catch (error) {
    console.warn('[UserSync] Erreur link code:', error);
    return false;
  }
}

/**
 * Récupérer le user_code mappé pour l'utilisateur actuel
 */
export async function getUserCodeMapping(): Promise<string | null> {
  if (!isSupabaseSyncConfigured()) return null;

  try {
    const session = await getValidSession();
    if (!session?.user?.id) return null;

    const headers = await getAuthenticatedHeaders();
    const response = await supabaseFetch(
      `${SUPABASE_URL}/rest/v1/user_code_mapping?user_id=eq.${session.user.id}&select=user_code`,
      {
        method: 'GET',
        headers,
      }
    );

    if (!response.ok) return null;

    const data = await response.json();
    return data[0]?.user_code || null;
  } catch (error) {
    console.warn('[UserSync] Erreur get code mapping:', error);
    return null;
  }
}

// ==================== USER_LOTS ====================

/**
 * Récupérer tous les lots de l'utilisateur
 */
export async function fetchUserLots(): Promise<SupabaseUserLot[]> {
  if (!isSupabaseSyncConfigured()) return [];

  try {
    const session = await getValidSession();
    if (!session?.user?.id) return [];

    const headers = await getAuthenticatedHeaders();
    const response = await supabaseFetch(
      `${SUPABASE_URL}/rest/v1/user_lots?user_id=eq.${session.user.id}&select=*&order=won_at.desc`,
      {
        method: 'GET',
        headers,
      }
    );

    if (!response.ok) return [];

    return await response.json();
  } catch (error) {
    console.warn('[UserSync] Erreur fetch user lots:', error);
    return [];
  }
}

/**
 * Ajouter un lot à l'utilisateur
 */
export async function addUserLot(lot: {
  lotId: string;
  lotName: string;
  lotDescription?: string;
  lotRarity?: string;
  lotImage?: string;
  lotValue?: number;
  lotType?: string;
  discountPercent?: number;
  discountAmount?: number;
  minOrderAmount?: number;
}): Promise<string | null> {
  if (!isSupabaseSyncConfigured()) return null;

  try {
    const session = await getValidSession();
    if (!session?.user?.id) return null;

    const headers = await getAuthenticatedHeaders();
    const response = await supabaseFetch(`${SUPABASE_URL}/functions/v1/user-lots-mutations`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        action: 'addLot',
        lot,
      }),
    });

    if (!response.ok) {
      console.warn('[UserSync] Erreur add lot');
      return null;
    }

    const result = await response.json();
    return result?.id || null;
  } catch (error) {
    console.warn('[UserSync] Erreur add lot:', error);
    return null;
  }
}

/**
 * Marquer un lot comme utilisé
 */
export async function markLotAsUsed(lotId: string): Promise<void> {
  if (!isSupabaseSyncConfigured()) return;

  try {
    const headers = await getAuthenticatedHeaders();
    await supabaseFetch(`${SUPABASE_URL}/functions/v1/user-lots-mutations`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        action: 'markUsed',
        lotId,
      }),
    });
  } catch (error) {
    console.warn('[UserSync] Erreur mark lot used:', error);
  }
}

