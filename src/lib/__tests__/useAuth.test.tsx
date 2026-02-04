import React from 'react';
import { render, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useAuth } from '../useAuth';

jest.mock('../supabase-auth', () => ({
  loadStoredSession: jest.fn().mockResolvedValue(null),
  signIn: jest.fn(),
  signUp: jest.fn(),
  signOut: jest.fn(),
  signInWithMagicLink: jest.fn(),
  verifyOtp: jest.fn(),
  resetPassword: jest.fn(),
  updatePassword: jest.fn(),
  fetchProfile: jest.fn().mockResolvedValue({ profile: null, error: null }),
  updateProfile: jest.fn(),
  linkUserCode: jest.fn(),
  getSession: jest.fn(),
  getCurrentUser: jest.fn(),
  refreshSession: jest.fn().mockResolvedValue(null),
  resendConfirmationEmail: jest.fn(),
}));

jest.mock('../store', () => ({
  useReferralStore: { getState: () => ({ resetStore: jest.fn() }) },
  useCollectionStore: { getState: () => ({ resetStore: jest.fn() }) },
  useSubscriptionStore: { getState: () => ({ resetStore: jest.fn() }) },
}));

function TestProbe({ onChange }: { onChange: (value: ReturnType<typeof useAuth>) => void }) {
  const auth = useAuth();

  React.useEffect(() => {
    onChange(auth);
  }, [auth, onChange]);

  return null;
}

describe('useAuth', () => {
  it('initializes with no session', async () => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    });

    let snapshot: ReturnType<typeof useAuth> | undefined;

    render(
      <QueryClientProvider client={queryClient}>
        <TestProbe onChange={(value) => (snapshot = value)} />
      </QueryClientProvider>
    );

    await waitFor(() => {
      expect(snapshot?.isInitialized).toBe(true);
    });

    expect(snapshot?.isAuthenticated).toBe(false);
    expect(snapshot?.user).toBeNull();
  });
});
