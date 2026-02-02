import { getValidSession } from './supabase-auth';
import { fetchWithRetry, NetworkError } from './fetch-with-retry';

export const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL || '';
export const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || '';

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

// Headers authentifiés avec le token JWT de l'utilisateur pour les requêtes sécurisées (orders)
export const getAuthenticatedHeaders = async () => {
  const session = await getValidSession();
  const token = session?.access_token || SUPABASE_ANON_KEY;
  return {
    'apikey': SUPABASE_ANON_KEY,
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json',
    'Prefer': 'return=representation',
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
