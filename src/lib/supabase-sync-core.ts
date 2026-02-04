import { getValidSession } from './supabase-auth';
import { ensureDeviceId } from './device-id';
import { fetchWithRetry, NetworkError } from './fetch-with-retry';
import NetInfo from '@react-native-community/netinfo';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './env-validation';

// Re-export for backward compatibility (source: env-validation.ts)
export { SUPABASE_URL, SUPABASE_ANON_KEY };

// Configuration du retry pour les requêtes Supabase
const RETRY_CONFIG = {
  timeout: 10000, // 10 secondes
  maxRetries: 2,
  backoffMs: 1000,
};

export const getHeaders = () => ({
  'apikey': SUPABASE_ANON_KEY,
  'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
  'Content-Type': 'application/json',
  'Prefer': 'return=representation',
});

// Erreur personnalisée pour session expirée
export class SessionExpiredError extends Error {
  constructor(message = 'Session expirée, veuillez vous reconnecter') {
    super(message);
    this.name = 'SessionExpiredError';
  }
}

// Headers authentifiés avec le token JWT de l'utilisateur pour les requêtes sécurisées (orders)
// Lève SessionExpiredError si pas de session valide
export const getAuthenticatedHeaders = async () => {
  const session = await getValidSession();
  
  if (!session?.access_token) {
    console.warn('[getAuthenticatedHeaders] Pas de session valide - utilisateur non connecté');
    throw new SessionExpiredError();
  }
  
  // Log pour debug (masquer le token complet)
  const tokenPreview = session.access_token.substring(0, 20) + '...';
  console.log('[getAuthenticatedHeaders] Token obtenu:', tokenPreview, 'expire:', new Date(session.expires_at * 1000).toISOString());
  
  const deviceId = await ensureDeviceId();
  return {
    'apikey': SUPABASE_ANON_KEY,
    'Authorization': `Bearer ${session.access_token}`,
    'Content-Type': 'application/json',
    'Prefer': 'return=representation',
    'X-Device-Id': deviceId,
  };
};

// Helper pour les requêtes Supabase avec retry
export async function supabaseFetch(url: string, options: RequestInit = {}): Promise<Response> {
  return fetchWithRetry(url, {
    ...options,
    ...RETRY_CONFIG,
  });
}

// Helper pour les requêtes Supabase avec retry (retourne null en cas d'échec)
export async function supabaseFetchOrNull(url: string, options: RequestInit = {}): Promise<Response | null> {
  try {
    return await supabaseFetch(url, options);
  } catch (error) {
    if (error instanceof NetworkError) {
      console.warn(`[Supabase] Échec après ${error.attempts} tentatives:`, error.message);
    } else {
      console.warn('[Supabase] Erreur inattendue:', String(error));
    }
    return null;
  }
}

export function isSupabaseSyncConfigured(): boolean {
  return Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
}

export async function isNetworkOnline(): Promise<boolean> {
  try {
    const state = await NetInfo.fetch();
    return state.isConnected === true && state.isInternetReachable !== false;
  } catch {
    return true;
  }
}
