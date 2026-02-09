import { useInfiniteQuery, useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useAuth, usePermissions } from '@/lib/useAuth';
import { fetchMyProducer, type ProducerDB } from '@/lib/supabase-producer';
import { fetchOrders, fetchOrdersForProducer } from '@/lib/supabase-sync';
import { useLocalMarketOrders, type LocalMarketOrder } from '@/lib/local-market-orders';
import type { Order } from '@/lib/store';

export function useMyProducerQuery() {
  const { session } = useAuth();
  const { isProducer } = usePermissions();

  return useQuery<ProducerDB | null>({
    queryKey: ['producer', session?.user?.id],
    queryFn: fetchMyProducer,
    enabled: isProducer && !!session?.access_token,
    staleTime: 5 * 60 * 1000,
  });
}

export function useProducerProOrdersQuery(producerId: string) {
  return useQuery<Order[]>({
    queryKey: ['orders', 'pro', producerId],
    queryFn: () => fetchOrdersForProducer(producerId),
    enabled: !!producerId,
    staleTime: 60 * 1000,
  });
}

export function useProducerOrdersInfinite(
  producerId: string,
  pageSize: number,
  enabled: boolean
) {
  return useInfiniteQuery<Order[]>({
    queryKey: ['orders', 'producer', 'paged', producerId],
    enabled: enabled && !!producerId,
    initialPageParam: 0,
    queryFn: ({ pageParam }) => {
      const offset = typeof pageParam === 'number' ? pageParam : 0;
      return fetchOrdersForProducer(producerId, { limit: pageSize, offset });
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

export function useProducerLocalOrdersQuery(producerId: string, accessToken: string) {
  const loadOrdersForProducer = useLocalMarketOrders((s) => s.loadOrdersForProducer);

  return useQuery<LocalMarketOrder[]>({
    queryKey: ['orders', 'local-market', producerId],
    queryFn: () => loadOrdersForProducer(producerId, accessToken),
    enabled: !!producerId && !!accessToken,
    staleTime: 60 * 1000,
  });
}

export function useAdminOrdersQuery(enabled: boolean): UseQueryResult<Order[]> {
  return useQuery<Order[]>({
    queryKey: ['orders', 'admin'],
    queryFn: fetchOrders,
    enabled,
    staleTime: 30 * 1000,
    refetchInterval: enabled ? 30 * 1000 : false,
  });
}
