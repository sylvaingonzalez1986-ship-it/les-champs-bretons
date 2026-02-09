import { Pack, PackItem } from './store';
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

export interface SupabasePack {
  id: string;
  name: string;
  description: string;
  price: number;
  original_price: number;
  image: string;
  tag: string | null;
  color: string;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface SupabasePackItem {
  id: string;
  pack_id: string;
  name: string;
  quantity: string;
  value: number;
  images: string[] | null;
  producer_name: string | null;
  created_at: string;
}

// Convert Supabase pack to app Pack format
function supabaseToPack(sp: SupabasePack, items: PackItem[]): Pack {
  return {
    id: sp.id,
    name: sp.name,
    description: sp.description,
    price: sp.price,
    originalPrice: sp.original_price,
    image: sp.image,
    items,
    tag: sp.tag ?? undefined,
    color: sp.color,
    active: sp.active,
  };
}

// Convert app Pack to Supabase format
function packToSupabase(pack: Pack): Omit<SupabasePack, 'created_at' | 'updated_at'> {
  return {
    id: pack.id,
    name: pack.name,
    description: pack.description,
    price: pack.price,
    original_price: pack.originalPrice,
    image: pack.image,
    tag: pack.tag ?? null,
    color: pack.color,
    active: pack.active,
  };
}

// Convert Supabase pack item to app format
function supabaseToPackItem(spi: SupabasePackItem): PackItem {
  return {
    name: spi.name,
    quantity: spi.quantity,
    value: spi.value,
    images: spi.images ?? undefined,
    producerName: spi.producer_name ?? undefined,
  };
}

async function resolvePackImages(pack: Pack): Promise<Pack> {
  const signedImage = await getSignedImageUrl(pack.image);
  const signedItems = await Promise.all(
    pack.items.map(async (item) => {
      if (!item.images || item.images.length === 0) {
        return item;
      }
      const signedImages = await Promise.all(item.images.map((image) => getSignedImageUrl(image)));
      return { ...item, images: signedImages };
    })
  );

  return {
    ...pack,
    image: signedImage || pack.image,
    items: signedItems,
  };
}

// Fetch all packs from Supabase
export async function fetchPacks(): Promise<SupabasePack[]> {
  if (!isSupabaseSyncConfigured()) {
    throw new Error('Supabase non configuré');
  }

  const response = await supabaseFetch(`${SUPABASE_URL}/rest/v1/packs?select=*&order=name.asc`, {
    method: 'GET',
    headers: getHeaders(),
  });

  if (!response.ok) {
    throw new Error('Erreur récupération packs');
  }

  return response.json();
}

// Fetch pack items from Supabase
export async function fetchPackItems(): Promise<SupabasePackItem[]> {
  if (!isSupabaseSyncConfigured()) {
    throw new Error('Supabase non configuré');
  }

  const response = await supabaseFetch(`${SUPABASE_URL}/rest/v1/pack_items?select=*`, {
    method: 'GET',
    headers: getHeaders(),
  });

  if (!response.ok) {
    throw new Error('Erreur récupération pack items');
  }

  return response.json();
}

// Fetch all packs with their items
export async function fetchAllPacksWithItems(): Promise<Pack[]> {
  if (!isSupabaseSyncConfigured()) {
    return [];
  }

  const isOnline = await isNetworkOnline();
  if (!isOnline) {
    const cached = await AsyncStorage.getItem('cache_packs_v2');
    return cached ? (JSON.parse(cached) as Pack[]) : [];
  }

  try {
    const [supabasePacks, supabasePackItems] = await Promise.all([
      fetchPacks(),
      fetchPackItems(),
    ]);

    // Group items by pack_id
    const itemsByPack = new Map<string, PackItem[]>();
    for (const spi of supabasePackItems) {
      const items = itemsByPack.get(spi.pack_id) || [];
      items.push(supabaseToPackItem(spi));
      itemsByPack.set(spi.pack_id, items);
    }

    // Convert to Pack array
    const packs = supabasePacks.map((sp) =>
      supabaseToPack(sp, itemsByPack.get(sp.id) || [])
    );

    return Promise.all(packs.map(resolvePackImages));
  } catch (error) {
    console.warn('Error fetching packs from Supabase:', error);
    const cached = await AsyncStorage.getItem('cache_packs_v2');
    return cached ? (JSON.parse(cached) as Pack[]) : [];
  }
}

// Add pack to Supabase
export async function addPackToSupabase(pack: Pack): Promise<SupabasePack> {
  if (!isSupabaseSyncConfigured()) {
    throw new Error('Supabase non configuré');
  }

  const headers = await getAuthenticatedHeaders();
  const response = await supabaseFetch(`${SUPABASE_URL}/functions/v1/packs-mutations`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      action: 'create',
      pack: {
        ...packToSupabase(pack),
        items: pack.items.map((item) => ({
          name: item.name,
          quantity: item.quantity,
          value: item.value,
          images: item.images ?? null,
          producer_name: item.producerName ?? null,
        })),
      },
    }),
  });

  if (!response.ok) {
    throw new Error('Erreur ajout pack');
  }

  const data = await response.json();
  return Array.isArray(data) ? data[0] : data;
}

export async function addPackItemToSupabase(_item: PackItem, _packId: string): Promise<SupabasePackItem> {
  throw new Error('addPackItemToSupabase déplacé vers packs-mutations');
}

// Update pack in Supabase
export async function updatePackInSupabase(id: string, pack: Partial<Pack>): Promise<void> {
  if (!isSupabaseSyncConfigured()) {
    throw new Error('Supabase non configuré');
  }

  const updates: Record<string, unknown> = {};
  if (pack.name !== undefined) updates.name = pack.name;
  if (pack.description !== undefined) updates.description = pack.description;
  if (pack.price !== undefined) updates.price = pack.price;
  if (pack.originalPrice !== undefined) updates.original_price = pack.originalPrice;
  if (pack.image !== undefined) updates.image = pack.image;
  if (pack.tag !== undefined) updates.tag = pack.tag;
  if (pack.color !== undefined) updates.color = pack.color;
  if (pack.active !== undefined) updates.active = pack.active;

  const headers = await getAuthenticatedHeaders();
  const response = await supabaseFetch(`${SUPABASE_URL}/functions/v1/packs-mutations`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      action: 'update',
      packId: id,
      pack: {
        ...updates,
        ...(pack.items
          ? {
              items: pack.items.map((item) => ({
                name: item.name,
                quantity: item.quantity,
                value: item.value,
                images: item.images ?? null,
                producer_name: item.producerName ?? null,
              })),
            }
          : {}),
      },
    }),
  });

  if (!response.ok) {
    throw new Error('Erreur mise à jour pack');
  }
}

// Delete pack from Supabase
export async function deletePackFromSupabase(id: string): Promise<void> {
  if (!isSupabaseSyncConfigured()) {
    throw new Error('Supabase non configuré');
  }

  const headers = await getAuthenticatedHeaders();
  const response = await supabaseFetch(`${SUPABASE_URL}/functions/v1/packs-mutations`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      action: 'delete',
      packId: id,
    }),
  });

  if (!response.ok) {
    throw new Error('Erreur suppression pack');
  }
}

// Sync a pack to Supabase
export async function syncPackToSupabase(pack: Pack): Promise<void> {
  if (!isSupabaseSyncConfigured()) {
    throw new Error('Supabase non configuré');
  }

  // Check if pack already exists
  const response = await supabaseFetch(`${SUPABASE_URL}/rest/v1/packs?id=eq.${pack.id}&select=id`, {
    method: 'GET',
    headers: getHeaders(),
  });

  const existing = await response.json();

  if (existing && existing.length > 0) {
    // Update existing pack (inclut items)
    await updatePackInSupabase(pack.id, pack);
  } else {
    // Add new pack
    await addPackToSupabase(pack);
  }
}

// Sync all packs to Supabase
export async function syncAllPacksToSupabase(packs: Pack[]): Promise<void> {
  if (!isSupabaseSyncConfigured()) {
    throw new Error('Supabase non configuré');
  }

  for (const pack of packs) {
    await syncPackToSupabase(pack);
  }
}
