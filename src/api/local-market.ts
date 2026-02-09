import { useInfiniteQuery } from '@tanstack/react-query';
import { SUPABASE_ANON_KEY, SUPABASE_URL } from '@/lib/supabase-auth';
import type { LocalMarketOrder } from '@/lib/local-market-orders';

export function useLocalMarketOrdersInfinite(
  userId: string | undefined,
  accessToken: string | undefined,
  pageSize: number
) {
  return useInfiniteQuery<LocalMarketOrder[]>({
    queryKey: ['local-market-orders', userId],
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
      } catch (parseError) {
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
    queryKey: ['local-market-orders', 'producer', producerId],
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
      } catch (parseError) {
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
