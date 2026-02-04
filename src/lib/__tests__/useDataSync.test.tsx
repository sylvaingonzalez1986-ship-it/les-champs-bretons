import React from 'react';
import { render, waitFor } from '@testing-library/react-native';
import { useDataSync, useSyncState } from '../useDataSync';

const syncMocks = {
  isSupabaseSyncConfigured: jest.fn().mockReturnValue(false),
  fetchAllProducersWithProducts: jest.fn(),
  fetchAllPacksWithItems: jest.fn(),
  fetchPromoProducts: jest.fn(),
  fetchAllLotsWithItems: jest.fn(),
};

jest.mock('../supabase-sync', () => syncMocks);

jest.mock('../store', () => ({
  useProducerStore: { setState: jest.fn() },
  usePacksStore: { setState: jest.fn() },
  usePromoProductsStore: { setState: jest.fn() },
  useLotsStore: { setState: jest.fn() },
}));

function TestProbe({ onChange }: { onChange: (state: ReturnType<typeof useSyncState>) => void }) {
  const state = useSyncState();
  useDataSync();

  React.useEffect(() => {
    onChange(state);
  }, [state, onChange]);

  return null;
}

describe('useDataSync', () => {
  it('does not call sync when Supabase is not configured', async () => {
    let snapshot: ReturnType<typeof useSyncState> | undefined;

    render(<TestProbe onChange={(value) => (snapshot = value)} />);

    await waitFor(() => {
      expect(snapshot?.status).toBe('idle');
    });

    expect(snapshot?.isUsingCache).toBe(true);
    expect(syncMocks.fetchAllProducersWithProducts).not.toHaveBeenCalled();
    expect(syncMocks.fetchAllPacksWithItems).not.toHaveBeenCalled();
    expect(syncMocks.fetchPromoProducts).not.toHaveBeenCalled();
    expect(syncMocks.fetchAllLotsWithItems).not.toHaveBeenCalled();
  });
});
