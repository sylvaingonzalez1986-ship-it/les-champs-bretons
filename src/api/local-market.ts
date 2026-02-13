import { useInfiniteQuery } from '@tanstack/react-query';
import { SUPABASE_ANON_KEY, SUPABASE_URL } from '@/lib/supabase-auth';
import type { LocalMarketOrder } from '@/lib/local-market-orders';

export interface DirectSaleOrderLine {
  id: string;
  commande_id: string;
  product_id: string;
  quantite: number;
  prix_unitaire: number;
  sous_total: number;
  product?: { name?: string | null } | { name?: string | null }[] | null;
}

export interface DirectSaleOrder {
  id: string;
  user_id: string;
  producer_id: string;
  pickup_code?: string | null;
  total: number;
  statut: 'en_attente' | 'confirmee' | 'prete' | 'recuperee' | 'annulee';
  created_at: string;
  updated_at: string;
  delivery_method?: 'pickup' | 'shipping' | null;
  payment_method?: 'payment_link' | 'on_site' | null;
  producer?: { name?: string | null } | { name?: string | null }[] | null;
  lines?: DirectSaleOrderLine[] | null;
}

export interface ProducerDirectSaleOrder {
  id: string;
  user_id: string;
  producer_id: string;
  pickup_code?: string | null;
  total: number;
  statut: 'en_attente' | 'confirmee' | 'prete' | 'recuperee' | 'annulee';
  created_at: string;
  updated_at: string;
  delivery_method?: 'pickup' | 'shipping' | null;
  payment_method?: 'payment_link' | 'on_site' | null;
  delivery_address?: string | null;
  delivery_instructions?: string | null;
  customer?: {
    first_name?: string | null;
    last_name?: string | null;
    email?: string | null;
    phone?: string | null;
  } | {
    first_name?: string | null;
    last_name?: string | null;
    email?: string | null;
    phone?: string | null;
  }[] | null;
  lines?: DirectSaleOrderLine[] | null;
}

export function useLocalMarketOrdersInfinite(
  userId: string | undefined,
  accessToken: string | undefined,
  pageSize: number
) {
  return useInfiniteQuery<LocalMarketOrder[]>({
    queryKey: ['local-market-orders', userId, accessToken, pageSize],
    enabled: !!userId && !!accessToken,
    initialPageParam: 0,
    queryFn: async ({ pageParam }) => {
      if (!userId || !accessToken) {
        return [];
      }

      const offset = typeof pageParam === 'number' ? pageParam : 0;
      let url = `${SUPABASE_URL}/rest/v1/local_market_orders?customer_id=eq.${userId}&order=created_at.desc&select=*`;
      url += `&limit=${pageSize}&offset=${offset}`;

      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          apikey: SUPABASE_ANON_KEY,
          Authorization: `Bearer ${accessToken}`,
          Prefer: 'return=representation',
        },
      });

      const responseText = await response.text();

      if (!response.ok) {
        if (response.status === 401) {
          throw new Error('Session expiree, veuillez vous reconnecter');
        }
        if (response.status === 404 || response.status === 400 || response.status === 403) {
          return [];
        }
        throw new Error(`Erreur ${response.status}`);
      }

      try {
        return responseText ? (JSON.parse(responseText) as LocalMarketOrder[]) : [];
      } catch {
        throw new Error('Erreur de format des donnees');
      }
    },
    getNextPageParam: (lastPage, allPages) => {
      if (!lastPage || lastPage.length < pageSize) {
        return undefined;
      }

      return allPages.length * pageSize;
    },
    staleTime: 60 * 1000,
  });
}

export function useProducerLocalMarketOrdersInfinite(
  producerId: string | undefined,
  accessToken: string | undefined,
  pageSize: number,
  enabled: boolean
) {
  return useInfiniteQuery<LocalMarketOrder[]>({
    queryKey: ['local-market-orders', 'producer', producerId, accessToken, pageSize],
    enabled: enabled && !!producerId && !!accessToken,
    initialPageParam: 0,
    queryFn: async ({ pageParam }) => {
      if (!producerId || !accessToken) {
        return [];
      }

      const offset = typeof pageParam === 'number' ? pageParam : 0;
      let url = `${SUPABASE_URL}/rest/v1/local_market_orders?producer_id=eq.${producerId}&order=created_at.desc&select=*`;
      url += `&limit=${pageSize}&offset=${offset}`;

      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          apikey: SUPABASE_ANON_KEY,
          Authorization: `Bearer ${accessToken}`,
          Prefer: 'return=representation',
        },
      });

      const responseText = await response.text();

      if (!response.ok) {
        if (response.status === 401) {
          throw new Error('Session expiree, veuillez vous reconnecter');
        }
        if (response.status === 404 || response.status === 400 || response.status === 403) {
          return [];
        }
        throw new Error(`Erreur ${response.status}`);
      }

      try {
        return responseText ? (JSON.parse(responseText) as LocalMarketOrder[]) : [];
      } catch {
        throw new Error('Erreur de format des donnees');
      }
    },
    getNextPageParam: (lastPage, allPages) => {
      if (!lastPage || lastPage.length < pageSize) {
        return undefined;
      }

      return allPages.length * pageSize;
    },
    staleTime: 60 * 1000,
  });
}

export function useProducerDirectSaleOrdersInfinite(
  producerId: string | undefined,
  accessToken: string | undefined,
  pageSize: number,
  enabled: boolean
) {
  return useInfiniteQuery<ProducerDirectSaleOrder[]>({
    queryKey: ['direct-sale-orders', 'producer', producerId, accessToken, pageSize],
    enabled: enabled && !!producerId && !!accessToken,
    initialPageParam: 0,
    queryFn: async ({ pageParam }) => {
      if (!producerId || !accessToken) {
        return [];
      }

      const offset = typeof pageParam === 'number' ? pageParam : 0;
      let url = `${SUPABASE_URL}/rest/v1/commandes_vente_directe?producer_id=eq.${producerId}&order=created_at.desc`;
      url += '&select=id,user_id,producer_id,pickup_code,total,statut,created_at,updated_at,delivery_method,payment_method,delivery_address,delivery_instructions';
      url += `&limit=${pageSize}&offset=${offset}`;

      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          apikey: SUPABASE_ANON_KEY,
          Authorization: `Bearer ${accessToken}`,
          Prefer: 'return=representation',
        },
      });

      const responseText = await response.text();

      if (!response.ok) {
        if (response.status === 401) {
          throw new Error('Session expiree, veuillez vous reconnecter');
        }
        if (response.status === 404 || response.status === 400 || response.status === 403) {
          return [];
        }
        throw new Error(`Erreur ${response.status}`);
      }

      let orders: ProducerDirectSaleOrder[] = [];
      try {
        orders = responseText ? (JSON.parse(responseText) as ProducerDirectSaleOrder[]) : [];
      } catch {
        throw new Error('Erreur de format des donnees');
      }

      if (!Array.isArray(orders) || orders.length === 0) {
        return [];
      }

      const orderIds = Array.from(new Set(orders.map((order) => order.id).filter(Boolean)));
      const userIds = Array.from(new Set(orders.map((order) => order.user_id).filter(Boolean)));

      let linesByOrder = new Map<string, DirectSaleOrderLine[]>();
      if (orderIds.length > 0) {
        const idsFilter = orderIds.map((id) => encodeURIComponent(id)).join(',');
        const linesResponse = await fetch(
          `${SUPABASE_URL}/rest/v1/lignes_commande_vente_directe?commande_id=in.(${idsFilter})&select=id,commande_id,product_id,quantite,prix_unitaire,sous_total`,
          {
            method: 'GET',
            headers: {
              'Content-Type': 'application/json',
              apikey: SUPABASE_ANON_KEY,
              Authorization: `Bearer ${accessToken}`,
              Prefer: 'return=representation',
            },
          }
        );

        if (linesResponse.ok) {
          const linesData = (await linesResponse.json()) as DirectSaleOrderLine[];
          const productIds = Array.from(new Set((Array.isArray(linesData) ? linesData : []).map((line) => line.product_id).filter(Boolean)));
          let productNameById = new Map<string, string>();

          if (productIds.length > 0) {
            const productsFilter = productIds.map((id) => encodeURIComponent(id)).join(',');
            const productsResponse = await fetch(
              `${SUPABASE_URL}/rest/v1/products?id=in.(${productsFilter})&select=id,name`,
              {
                method: 'GET',
                headers: {
                  'Content-Type': 'application/json',
                  apikey: SUPABASE_ANON_KEY,
                  Authorization: `Bearer ${accessToken}`,
                  Prefer: 'return=representation',
                },
              }
            );

            if (productsResponse.ok) {
              const products = (await productsResponse.json()) as { id: string; name: string }[];
              productNameById = new Map((Array.isArray(products) ? products : []).map((product) => [product.id, product.name]));
            }
          }

          linesByOrder = (Array.isArray(linesData) ? linesData : []).reduce((acc, line) => {
            const existing = acc.get(line.commande_id) ?? [];
            existing.push({
              ...line,
              product: { name: productNameById.get(line.product_id) ?? null },
            });
            acc.set(line.commande_id, existing);
            return acc;
          }, new Map<string, DirectSaleOrderLine[]>());
        }
      }

      let customerById = new Map<string, { first_name?: string | null; last_name?: string | null; email?: string | null; phone?: string | null }>();
      if (userIds.length > 0) {
        const usersFilter = userIds.map((id) => encodeURIComponent(id)).join(',');
        const profilesResponse = await fetch(
          `${SUPABASE_URL}/rest/v1/profiles?id=in.(${usersFilter})&select=id,first_name,last_name,email,phone`,
          {
            method: 'GET',
            headers: {
              'Content-Type': 'application/json',
              apikey: SUPABASE_ANON_KEY,
              Authorization: `Bearer ${accessToken}`,
              Prefer: 'return=representation',
            },
          }
        );

        if (profilesResponse.ok) {
          const profiles = (await profilesResponse.json()) as {
            id: string;
            first_name?: string | null;
            last_name?: string | null;
            email?: string | null;
            phone?: string | null;
          }[];
          customerById = new Map((Array.isArray(profiles) ? profiles : []).map((profile) => [profile.id, profile]));
        }
      }

      return orders.map((order) => ({
        ...order,
        lines: linesByOrder.get(order.id) ?? [],
        customer: customerById.get(order.user_id) ?? null,
      }));
    },
    getNextPageParam: (lastPage, allPages) => {
      if (!lastPage || lastPage.length < pageSize) {
        return undefined;
      }

      return allPages.length * pageSize;
    },
    staleTime: 60 * 1000,
  });
}

export function useDirectSaleOrdersInfinite(
  userId: string | undefined,
  accessToken: string | undefined,
  pageSize: number
) {
  return useInfiniteQuery<DirectSaleOrder[]>({
    queryKey: ['direct-sale-orders', userId, accessToken, pageSize],
    enabled: !!userId && !!accessToken,
    initialPageParam: 0,
    queryFn: async ({ pageParam }) => {
      if (!userId || !accessToken) {
        return [];
      }

      const offset = typeof pageParam === 'number' ? pageParam : 0;
      let url = `${SUPABASE_URL}/rest/v1/commandes_vente_directe?user_id=eq.${userId}&order=created_at.desc`;
      url += '&select=id,user_id,producer_id,pickup_code,total,statut,created_at,updated_at,delivery_method,payment_method,producer:producers(name),lines:lignes_commande_vente_directe(id,commande_id,product_id,quantite,prix_unitaire,sous_total,product:products(name))';
      url += `&limit=${pageSize}&offset=${offset}`;

      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          apikey: SUPABASE_ANON_KEY,
          Authorization: `Bearer ${accessToken}`,
          Prefer: 'return=representation',
        },
      });

      const responseText = await response.text();

      if (!response.ok) {
        if (response.status === 401) {
          throw new Error('Session expiree, veuillez vous reconnecter');
        }
        if (response.status === 404 || response.status === 400 || response.status === 403) {
          return [];
        }
        throw new Error(`Erreur ${response.status}`);
      }

      try {
        return responseText ? (JSON.parse(responseText) as DirectSaleOrder[]) : [];
      } catch {
        throw new Error('Erreur de format des donnees');
      }
    },
    getNextPageParam: (lastPage, allPages) => {
      if (!lastPage || lastPage.length < pageSize) {
        return undefined;
      }

      return allPages.length * pageSize;
    },
    staleTime: 60 * 1000,
  });
}
