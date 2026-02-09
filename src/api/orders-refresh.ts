import { useQueryClient } from '@tanstack/react-query';

type RefreshOptions = {
  userId?: string | null;
  producerId?: string | null;
};

export function useOrdersRefresher() {
  const queryClient = useQueryClient();

  return async function refreshOrders({ userId, producerId }: RefreshOptions) {
    const tasks: Promise<unknown>[] = [];

    tasks.push(queryClient.invalidateQueries({ queryKey: ['orders', 'admin'] }));

    if (userId) {
      tasks.push(queryClient.invalidateQueries({ queryKey: ['local-market-orders', userId] }));
    }

    if (producerId) {
      tasks.push(queryClient.invalidateQueries({ queryKey: ['orders', 'pro', producerId] }));
      tasks.push(queryClient.invalidateQueries({ queryKey: ['orders', 'producer', 'paged', producerId] }));
      tasks.push(queryClient.invalidateQueries({ queryKey: ['orders', 'local-market', producerId] }));
      tasks.push(queryClient.invalidateQueries({ queryKey: ['local-market-orders', 'producer', producerId] }));
    }

    await Promise.all(tasks);
  };
}
