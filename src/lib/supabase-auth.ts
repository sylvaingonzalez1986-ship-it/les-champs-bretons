/**
 * Supabase Auth Client - Les Chanvriers Unis
 * Client d'authentification avec support pour email/password et magic link
 * Utilise SecureStorage pour les tokens sensibles (chiffré sur toutes les plateformes)
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { fetchWithRetry, NetworkError } from './fetch-with-retry';
import SecureStorage, { initializeSecureStorage } from './secure-storage';
import { ensureDeviceId } from './device-id';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './env-validation';

const DEVICE_BINDING_ENDPOINT = '/functions/v1/bind-device';

// Re-export for backward compatibility (source: env-validation.ts)
export { SUPABASE_URL, SUPABASE_ANON_KEY };

// Configuration du retry pour les requêtes auth
const AUTH_RETRY_CONFIG = {
  timeout: 10000,
  maxRetries: 3,
  backoffMs: 1000,
};

// Helper pour les requêtes auth avec retry
async function authFetch(url: string, options: RequestInit = {}): Promise<Response> {
  return fetchWithRetry(url, {
    ...options,
    ...AUTH_RETRY_CONFIG,
  });
}

// Clés de stockage
const AUTH_SESSION_KEY = 'supabase-auth-session';
const SECURE_ACCESS_TOKEN_KEY = 'supabase-access-token';
const SECURE_REFRESH_TOKEN_KEY = 'supabase-refresh-token';

// Flag pour l'initialisation du stockage sécurisé
let secureStorageInitialized = false;

/**
 * Initialise le stockage sécurisé (à appeler au démarrage de l'app)
 */
export async function initializeAuthStorage(): Promise<void> {
  if (secureStorageInitialized) return;

  try {
    await initializeSecureStorage();
    secureStorageInitialized = true;
  } catch (error) {
    console.warn('[Auth] Erreur initialisation stockage sécurisé:', error);
  }
}

// Wrapper pour le stockage sécurisé
const secureGet = async (key: string): Promise<string | null> => {
  await initializeAuthStorage();
  return SecureStorage.getItem(key);
};

const secureSet = async (key: string, value: string): Promise<void> => {
  await initializeAuthStorage();
  return SecureStorage.setItem(key, value);
};

const secureDelete = async (key: string): Promise<void> => {
  await initializeAuthStorage();
  return SecureStorage.deleteItem(key);
};

// ============================================
// Rate Limiting System
// ============================================
const RATE_LIMIT_MAX_ATTEMPTS = 5;
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 60 seconds

interface RateLimitEntry {
  attempts: number;
  firstAttemptAt: number;
  blockedUntil: number | null;
}

// In-memory rate limit tracking (per action type)
const rateLimitStore: Map<string, RateLimitEntry> = new Map();

/**
 * Check if an action is rate limited
 * @param actionKey - Unique key for the action (e.g., 'signIn', 'magicLink', 'resetPassword')
 * @returns Object with isBlocked status and remaining seconds if blocked
 */
function checkRateLimit(actionKey: string): { isBlocked: boolean; remainingSeconds: number } {
  const now = Date.now();
  const entry = rateLimitStore.get(actionKey);

  if (!entry) {
    return { isBlocked: false, remainingSeconds: 0 };
  }

  // Check if currently blocked
  if (entry.blockedUntil && now < entry.blockedUntil) {
    const remainingSeconds = Math.ceil((entry.blockedUntil - now) / 1000);
    return { isBlocked: true, remainingSeconds };
  }

  // If block period has passed, reset
  if (entry.blockedUntil && now >= entry.blockedUntil) {
    rateLimitStore.delete(actionKey);
    return { isBlocked: false, remainingSeconds: 0 };
  }

  // Check if window has expired (reset attempts)
  if (now - entry.firstAttemptAt > RATE_LIMIT_WINDOW_MS) {
    rateLimitStore.delete(actionKey);
    return { isBlocked: false, remainingSeconds: 0 };
  }

  return { isBlocked: false, remainingSeconds: 0 };
}

/**
 * Record an attempt for rate limiting
 * @param actionKey - Unique key for the action
 * @returns Object with isBlocked status and remaining seconds if now blocked
 */
function recordAttempt(actionKey: string): { isBlocked: boolean; remainingSeconds: number } {
  const now = Date.now();
  let entry = rateLimitStore.get(actionKey);

  // Check if we need to reset due to expired window
  if (entry && now - entry.firstAttemptAt > RATE_LIMIT_WINDOW_MS) {
    rateLimitStore.delete(actionKey);
    entry = undefined;
  }

  if (!entry) {
    // First attempt
    rateLimitStore.set(actionKey, {
      attempts: 1,
      firstAttemptAt: now,
      blockedUntil: null,
    });
    return { isBlocked: false, remainingSeconds: 0 };
  }

  // Increment attempts
  entry.attempts += 1;

  // Check if we've exceeded the limit
  if (entry.attempts >= RATE_LIMIT_MAX_ATTEMPTS) {
    entry.blockedUntil = now + RATE_LIMIT_WINDOW_MS;
    console.warn(`[Auth] Rate limit exceeded for ${actionKey}. Blocked for 60 seconds.`);
    return { isBlocked: true, remainingSeconds: 60 };
  }

  return { isBlocked: false, remainingSeconds: 0 };
}

/**
 * Create a rate-limited error response
 */
function createRateLimitError(remainingSeconds: number): AuthError {
  return {
    message: `Trop de tentatives. Veuillez réessayer dans ${remainingSeconds} secondes.`,
    status: 429,
  };
}

// Types pour l'authentification
export interface AuthUser {
  id: string;
  email: string | null;
  email_confirmed_at: string | null;
  created_at: string;
  updated_at: string;
  user_metadata: Record<string, unknown>;
}

export interface AuthSession {
  access_token: string;
  refresh_token: string;
  expires_at: number;
  expires_in: number;
  token_type: string;
  user: AuthUser;
}

export interface UserProfile {
  id: string;
  role: 'client' | 'pro' | 'producer' | 'admin';
  category: 'restaurateur' | 'epicerie' | 'grossiste' | 'producteur_maraicher' | 'autre' | null;
  full_name: string | null;
  first_name: string | null;
  last_name: string | null;
  birth_date: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  postal_code: string | null;
  city: string | null;
  company_name: string | null;
  business_name: string | null;
  siret: string | null;
  tva_number: string | null;
  user_code: string | null;
  is_adult: boolean | null;
  age_verified_at: string | null;
  // Direct farm sales fields
  vente_directe_ferme?: boolean | null;
  adresse_retrait?: string | null;
  horaires_retrait?: string | null;
  instructions_retrait?: string | null;
  created_at: string;
  updated_at: string;
}

export interface AuthError {
  message: string;
  status?: number;
}

// Helpers pour les headers
const getPublicHeaders = () => ({
  'apikey': SUPABASE_ANON_KEY,
  'Content-Type': 'application/json',
});

const getAuthHeaders = (accessToken: string) => ({
  'apikey': SUPABASE_ANON_KEY,
  'Authorization': `Bearer ${accessToken}`,
  'Content-Type': 'application/json',
});

// Stockage de la session
let currentSession: AuthSession | null = null;

/**
 * Supprimer la session
 */
async function clearSession(): Promise<void> {
  try {
    currentSession = null;

    // Supprimer les tokens avec wrapper sécurisé
    await secureDelete(SECURE_ACCESS_TOKEN_KEY);
    await secureDelete(SECURE_REFRESH_TOKEN_KEY);

    // Supprimer les métadonnées d'AsyncStorage
    await AsyncStorage.removeItem(AUTH_SESSION_KEY);
  } catch (error) {
    console.warn('[Auth] Error clearing session:', error);
  }
}

/**
 * Sauvegarder la session (tokens sécurisés + métadonnées)
 */
async function saveSession(session: AuthSession): Promise<void> {
  try {
    currentSession = session;

    // Stocker les tokens dans SecureStorage (chiffré)
    await secureSet(SECURE_ACCESS_TOKEN_KEY, session.access_token);
    await secureSet(SECURE_REFRESH_TOKEN_KEY, session.refresh_token);

    // Stocker les métadonnées dans AsyncStorage (non sensible)
    const sessionMeta = {
      expires_at: session.expires_at,
      expires_in: session.expires_in,
      token_type: session.token_type,
      user: session.user,
    };
    await AsyncStorage.setItem(AUTH_SESSION_KEY, JSON.stringify(sessionMeta));

    // Bind device to session (best-effort, non-blocking)
    try {
      const deviceId = await ensureDeviceId();
      await fetch(`${SUPABASE_URL}${DEVICE_BINDING_ENDPOINT}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
          'X-Device-Id': deviceId,
        },
        body: JSON.stringify({}),
      });
    } catch (bindError) {
      console.warn('[Auth] Device binding skipped:', bindError);
    }
  } catch (error) {
    console.warn('[Auth] Error saving session:', error);
  }
}

/**
 * Charger la session stockée au démarrage de l'app
 */
export async function loadStoredSession(): Promise<AuthSession | null> {
  try {
    // Charger les tokens depuis SecureStorage
    const accessToken = await secureGet(SECURE_ACCESS_TOKEN_KEY);
    const refreshToken = await secureGet(SECURE_REFRESH_TOKEN_KEY);

    if (!accessToken || !refreshToken) {
      return null;
    }

    // Charger les métadonnées depuis AsyncStorage
    const sessionMetaStr = await AsyncStorage.getItem(AUTH_SESSION_KEY);
    if (!sessionMetaStr) {
      // Tokens présents mais pas de métadonnées - nettoyer
      await clearSession();
      return null;
    }

    const sessionMeta = JSON.parse(sessionMetaStr);

    // Reconstruire la session complète
    const session: AuthSession = {
      access_token: accessToken,
      refresh_token: refreshToken,
      expires_at: sessionMeta.expires_at,
      expires_in: sessionMeta.expires_in,
      token_type: sessionMeta.token_type,
      user: sessionMeta.user,
    };

    // Vérifier si la session est expirée
    const now = Math.floor(Date.now() / 1000);
    if (session.expires_at < now) {
      // Session expirée - essayer de rafraîchir
      console.log('[Auth] Session expirée, tentative de rafraîchissement...');
      const refreshed = await refreshSession(refreshToken);
      return refreshed;
    }

    // Session valide - la stocker en mémoire
    currentSession = session;
    try {
      await ensureDeviceId();
    } catch (deviceError) {
      console.warn('[Auth] Device ID init skipped:', deviceError);
    }
    return session;
  } catch (error) {
    console.warn('[Auth] Error loading stored session:', error);
    await clearSession();
    return null;
  }
}

/**
 * Obtenir la session actuelle
 */
export function getSession(): AuthSession | null {
  return currentSession;
}

/**
 * Obtenir une session valide (rafraîchit si expirée)
 */
export async function getValidSession(): Promise<AuthSession | null> {
  // Si pas de session en mémoire, essayer de charger depuis le stockage
  if (!currentSession) {
    const stored = await loadStoredSession();
    if (!stored) {
      console.warn('[getValidSession] Aucune session stockée');
      return null;
    }
    // loadStoredSession met à jour currentSession en interne
  }

  // Vérifier que currentSession existe maintenant
  if (!currentSession) {
    console.warn('[getValidSession] Session toujours null après chargement');
    return null;
  }

  // Check if token is expired or will expire in the next 5 minutes
  // Use a larger buffer to account for clock drift between client and server
  const expiresAt = currentSession.expires_at * 1000;
  const bufferTime = 5 * 60 * 1000; // 5 minutes buffer (increased from 60s to handle clock drift)
  const now = Date.now();

  console.log('[getValidSession] Check expiration:', {
    now: new Date(now).toISOString(),
    expiresAt: new Date(expiresAt).toISOString(),
    isExpired: now + bufferTime >= expiresAt,
  });

  if (now + bufferTime >= expiresAt) {
    console.log('[getValidSession] Token expiré ou bientôt expiré, rafraîchissement...');
    const refreshed = await refreshSession(currentSession.refresh_token);
    if (!refreshed) {
      console.warn('[getValidSession] Échec du rafraîchissement de session');
      return null;
    }
    console.log('[getValidSession] Session rafraîchie avec succès');
    return refreshed;
  }

  return currentSession;
}

/**
 * Obtenir l'utilisateur actuel
 */
export function getCurrentUser(): AuthUser | null {
  return currentSession?.user ?? null;
}

/**
 * Normalize and sanitize email address
 * Removes invisible characters, trims whitespace, and converts to lowercase
 */
function normalizeEmail(email: string): string {
  return email
    // Remove invisible/zero-width characters
    .replace(/[\u200B-\u200D\uFEFF\u00A0]/g, '')
    // Remove other control characters
    .replace(/[\x00-\x1F\x7F]/g, '')
    // Trim whitespace
    .trim()
    // Convert to lowercase
    .toLowerCase();
}

/**
 * Inscription avec email/password
 */
export async function signUp(
  email: string,
  password: string,
  metadata?: { full_name?: string; role?: string }
): Promise<{ session: AuthSession | null; user: AuthUser | null; error: AuthError | null }> {
  try {
    // Normalize email: remove invisible characters, trim whitespace, convert to lowercase
    const normalizedEmail = normalizeEmail(email);

    // URL de redirection après confirmation email
    // Note: Pour que cela fonctionne, cette URL doit être ajoutée dans
    // Supabase Dashboard > Authentication > URL Configuration > Redirect URLs
    const emailRedirectTo = 'vibecode://auth/email-confirmed';

    const response = await authFetch(`${SUPABASE_URL}/auth/v1/signup`, {
      method: 'POST',
      headers: getPublicHeaders(),
      body: JSON.stringify({
        email: normalizedEmail,
        password,
        data: metadata,
        gotrue_meta_security: {
          captcha_token: null,
        },
        code_challenge: null,
        code_challenge_method: null,
        // Le redirect_to doit être au niveau racine pour GoTrue API
        redirect_to: emailRedirectTo,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      // Provide more user-friendly error messages
      let errorMessage = data.error_description || data.msg || 'Erreur inscription';

      // Handle common Supabase errors with better messages
      if (errorMessage.includes('invalid') && errorMessage.toLowerCase().includes('email')) {
        errorMessage = 'Cette adresse email n\'est pas acceptée. Veuillez utiliser une autre adresse.';
      } else if (data.error === 'user_already_exists' || errorMessage.includes('already registered')) {
        errorMessage = 'Un compte existe déjà avec cette adresse email.';
      }

      return {
        session: null,
        user: null,
        error: { message: errorMessage, status: response.status },
      };
    }

    // Si email confirmation est désactivée, on a une session immédiatement
    if (data.access_token) {
      const session: AuthSession = {
        access_token: data.access_token,
        refresh_token: data.refresh_token,
        expires_at: Math.floor(Date.now() / 1000) + data.expires_in,
        expires_in: data.expires_in,
        token_type: data.token_type,
        user: data.user,
      };
      await saveSession(session);
      return { session, user: data.user, error: null };
    }

    // Email confirmation requis
    return { session: null, user: data.user || null, error: null };
  } catch (error) {
    return {
      session: null,
      user: null,
      error: { message: error instanceof Error ? error.message : 'Erreur réseau' },
    };
  }
}

/**
 * Connexion avec email/password
 * Rate limited: 5 attempts per 60 seconds
 */
export async function signIn(
  email: string,
  password: string
): Promise<{ session: AuthSession | null; error: AuthError | null }> {
  const normalizedEmail = normalizeEmail(email);
  const rateLimitKey = `signIn:${normalizedEmail}`;

  // Check if rate limited
  const { isBlocked, remainingSeconds } = checkRateLimit(rateLimitKey);
  if (isBlocked) {
    return { session: null, error: createRateLimitError(remainingSeconds) };
  }

  try {
    const response = await authFetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: getPublicHeaders(),
      body: JSON.stringify({ email: normalizedEmail, password }),
    });

    const data = await response.json();

    if (!response.ok) {
      // Record failed attempt
      const limitResult = recordAttempt(rateLimitKey);
      if (limitResult.isBlocked) {
        return { session: null, error: createRateLimitError(limitResult.remainingSeconds) };
      }

      // Améliorer les messages d'erreur
      let errorMessage = data.error_description || data.msg || 'Identifiants incorrects';
      const errorCode = data.error_code || data.error || '';

      // Supabase retourne "Invalid login credentials" pour plusieurs cas:
      // - Email non confirmé
      // - Mauvais mot de passe
      // - Compte inexistant
      if (data.error === 'invalid_grant' || errorMessage.toLowerCase().includes('invalid login credentials')) {
        // Vérifier si c'est spécifiquement un problème de confirmation email
        if (errorCode === 'email_not_confirmed' || data.error_description?.toLowerCase().includes('not confirmed')) {
          errorMessage = 'Votre email n\'est pas encore confirmé. Vérifiez votre boîte mail (y compris les spams) et cliquez sur le lien de confirmation.';
        } else {
          errorMessage = 'Identifiants incorrects. Vérifiez votre email et mot de passe.\n\nSi vous venez de créer votre compte:\n• Vérifiez avoir cliqué sur le lien de confirmation dans votre email\n• Vérifiez votre dossier spam\n• Le lien peut prendre quelques minutes à arriver';
        }
      } else if (errorMessage.toLowerCase().includes('email not confirmed') || errorCode === 'email_not_confirmed') {
        errorMessage = 'Votre email n\'est pas encore confirmé. Vérifiez votre boîte mail (y compris les spams) et cliquez sur le lien de confirmation.';
      }

      return {
        session: null,
        error: { message: errorMessage, status: response.status },
      };
    }

    // Success - clear rate limit for this email
    rateLimitStore.delete(rateLimitKey);

    const session: AuthSession = {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_at: Math.floor(Date.now() / 1000) + data.expires_in,
      expires_in: data.expires_in,
      token_type: data.token_type,
      user: data.user,
    };

    await saveSession(session);
    return { session, error: null };
  } catch (error) {
    return {
      session: null,
      error: { message: error instanceof Error ? error.message : 'Erreur réseau' },
    };
  }
}

/**
 * Connexion avec Magic Link (envoie un email)
 * Rate limited: 5 attempts per 60 seconds
 */
export async function signInWithMagicLink(
  email: string
): Promise<{ error: AuthError | null }> {
  const normalizedEmail = normalizeEmail(email);
  const rateLimitKey = `magicLink:${normalizedEmail}`;

  // Check if rate limited
  const { isBlocked, remainingSeconds } = checkRateLimit(rateLimitKey);
  if (isBlocked) {
    return { error: createRateLimitError(remainingSeconds) };
  }

  // Record attempt before making request (to prevent spam)
  const limitResult = recordAttempt(rateLimitKey);
  if (limitResult.isBlocked) {
    return { error: createRateLimitError(limitResult.remainingSeconds) };
  }

  try {
    const response = await authFetch(`${SUPABASE_URL}/auth/v1/otp`, {
      method: 'POST',
      headers: getPublicHeaders(),
      body: JSON.stringify({
        email: normalizedEmail,
        create_user: true,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      return {
        error: { message: data.error_description || data.msg || 'Erreur envoi magic link', status: response.status },
      };
    }

    return { error: null };
  } catch (error) {
    return {
      error: { message: error instanceof Error ? error.message : 'Erreur réseau' },
    };
  }
}

/**
 * Vérifier le code OTP (magic link)
 */
export async function verifyOtp(
  email: string,
  token: string,
  type: 'email' | 'magiclink' = 'magiclink'
): Promise<{ session: AuthSession | null; error: AuthError | null }> {
  try {
    const response = await authFetch(`${SUPABASE_URL}/auth/v1/verify`, {
      method: 'POST',
      headers: getPublicHeaders(),
      body: JSON.stringify({
        email,
        token,
        type,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      return {
        session: null,
        error: { message: data.error_description || data.msg || 'Code invalide', status: response.status },
      };
    }

    const session: AuthSession = {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_at: Math.floor(Date.now() / 1000) + data.expires_in,
      expires_in: data.expires_in,
      token_type: data.token_type,
      user: data.user,
    };

    await saveSession(session);
    return { session, error: null };
  } catch (error) {
    return {
      session: null,
      error: { message: error instanceof Error ? error.message : 'Erreur réseau' },
    };
  }
}

/**
 * Rafraîchir la session
 */
export async function refreshSession(
  refreshToken?: string
): Promise<AuthSession | null> {
  const token = refreshToken || currentSession?.refresh_token;
  if (!token) {
    console.warn('[refreshSession] Pas de refresh token disponible');
    return null;
  }

  try {
    console.log('[refreshSession] Tentative de rafraîchissement...');
    const response = await authFetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
      method: 'POST',
      headers: getPublicHeaders(),
      body: JSON.stringify({ refresh_token: token }),
    });

    const data = await response.json();

    if (!response.ok) {
      console.warn('[refreshSession] Échec:', response.status, data);
      await clearSession();
      return null;
    }

    const session: AuthSession = {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_at: Math.floor(Date.now() / 1000) + data.expires_in,
      expires_in: data.expires_in,
      token_type: data.token_type,
      user: data.user,
    };

    await saveSession(session);
    console.log('[refreshSession] Nouvelle session sauvegardée, expire dans', data.expires_in, 'secondes');
    return session;
  } catch (error) {
    console.warn('[refreshSession] Erreur rafraîchissement session:', error);
    return null;
  }
}

/**
 * Déconnexion
 */
export async function signOut(): Promise<{ error: AuthError | null }> {
  try {
    if (currentSession?.access_token) {
      await authFetch(`${SUPABASE_URL}/auth/v1/logout`, {
        method: 'POST',
        headers: getAuthHeaders(currentSession.access_token),
      });
    }
    await clearSession();
    return { error: null };
  } catch (error) {
    await clearSession();
    return {
      error: { message: error instanceof Error ? error.message : 'Erreur déconnexion' },
    };
  }
}

/**
 * Réinitialiser le mot de passe (envoie un email)
 * Rate limited: 5 attempts per 60 seconds
 */
export async function resetPassword(
  email: string
): Promise<{ error: AuthError | null }> {
  const normalizedEmail = normalizeEmail(email);
  const rateLimitKey = `resetPassword:${normalizedEmail}`;

  // Check if rate limited
  const { isBlocked, remainingSeconds } = checkRateLimit(rateLimitKey);
  if (isBlocked) {
    return { error: createRateLimitError(remainingSeconds) };
  }

  // Record attempt before making request (to prevent spam)
  const limitResult = recordAttempt(rateLimitKey);
  if (limitResult.isBlocked) {
    return { error: createRateLimitError(limitResult.remainingSeconds) };
  }

  try {
    // Construire l'URL de redirection vers l'app
    // Pour mobile: utilise le scheme de l'app (chanvriers://auth/reset-password)
    // Pour web: utilise l'URL du site Supabase configuré
    const redirectTo = 'chanvriers://auth/reset-password';

    const response = await authFetch(`${SUPABASE_URL}/auth/v1/recover`, {
      method: 'POST',
      headers: getPublicHeaders(),
      body: JSON.stringify({
        email: normalizedEmail,
        redirect_to: redirectTo,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      return {
        error: { message: data.error_description || data.msg || 'Erreur réinitialisation', status: response.status },
      };
    }

    return { error: null };
  } catch (error) {
    return {
      error: { message: error instanceof Error ? error.message : 'Erreur réseau' },
    };
  }
}

/**
 * Mettre à jour le mot de passe (utilisateur connecté)
 */
export async function updatePassword(
  newPassword: string
): Promise<{ error: AuthError | null }> {
  if (!currentSession?.access_token) {
    return { error: { message: 'Non authentifié' } };
  }

  try {
    const response = await authFetch(`${SUPABASE_URL}/auth/v1/user`, {
      method: 'PUT',
      headers: getAuthHeaders(currentSession.access_token),
      body: JSON.stringify({ password: newPassword }),
    });

    const data = await response.json();

    if (!response.ok) {
      return {
        error: { message: data.error_description || data.msg || 'Erreur mise à jour', status: response.status },
      };
    }

    return { error: null };
  } catch (error) {
    return {
      error: { message: error instanceof Error ? error.message : 'Erreur réseau' },
    };
  }
}

// ============================================================================
// FONCTIONS PROFIL
// ============================================================================

/**
 * Récupérer le profil de l'utilisateur connecté
 */
export async function fetchProfile(): Promise<{ profile: UserProfile | null; error: AuthError | null }> {
  if (!currentSession?.access_token) {
    return { profile: null, error: { message: 'Non authentifié' } };
  }

  try {
    // Utiliser authFetch avec timeout pour éviter un blocage infini (surtout sur Android)
    const response = await authFetch(
      `${SUPABASE_URL}/rest/v1/profiles?id=eq.${currentSession.user.id}&select=*`,
      {
        method: 'GET',
        headers: {
          ...getAuthHeaders(currentSession.access_token),
          'Prefer': 'return=representation',
        },
      }
    );

    const data = await response.json();

    if (!response.ok) {
      return {
        profile: null,
        error: { message: 'Erreur chargement profil', status: response.status },
      };
    }

    return { profile: Array.isArray(data) ? data[0] : null, error: null };
  } catch (error) {
    return {
      profile: null,
      error: { message: error instanceof Error ? error.message : 'Erreur réseau' },
    };
  }
}

/**
 * Mettre à jour le profil (utilise PATCH pour forcer la mise à jour)
 */
export async function updateProfile(
  updates: Partial<Omit<UserProfile, 'id' | 'created_at' | 'updated_at'>>
): Promise<{ profile: UserProfile | null; error: AuthError | null }> {
  if (!currentSession?.access_token) {
    console.warn('[Auth] updateProfile: No access token');
    return { profile: null, error: { message: 'Non authentifié' } };
  }

  const userId = currentSession.user.id;

  try {
    // Préparer les données de mise à jour
    const updateData = {
      ...updates,
      updated_at: new Date().toISOString(),
    };

    const requestBody = JSON.stringify(updateData);

    // Utiliser PATCH pour forcer la mise à jour des champs existants (y compris role)
    const response = await fetch(
      `${SUPABASE_URL}/rest/v1/profiles?id=eq.${userId}`,
      {
        method: 'PATCH',
        headers: {
          ...getAuthHeaders(currentSession.access_token),
          'Prefer': 'return=representation',
        },
        body: requestBody,
      }
    );

    const responseText = await response.text();

    let data;
    try {
      data = JSON.parse(responseText);
    } catch (e) {
      console.warn('[Auth] updateProfile: Failed to parse JSON response:', e);
      data = null;
    }

    if (!response.ok) {
      console.warn('[Auth] Profile update failed - status:', response.status);
      return {
        profile: null,
        error: { message: data?.message || 'Erreur mise à jour profil', status: response.status },
      };
    }

    const profile = Array.isArray(data) ? data[0] : data;

    // Synchroniser les champs de vente directe vers la table producers si nécessaire
    if (updates.vente_directe_ferme !== undefined ||
        updates.adresse_retrait !== undefined ||
        updates.horaires_retrait !== undefined ||
        updates.instructions_retrait !== undefined) {
      try {
        // Récupérer le producer_id lié à ce profil
        const producerResponse = await fetch(
          `${SUPABASE_URL}/rest/v1/producers?profile_id=eq.${userId}&select=id`,
          {
            method: 'GET',
            headers: getAuthHeaders(currentSession.access_token),
          }
        );

        if (producerResponse.ok) {
          const producers = await producerResponse.json();
          if (Array.isArray(producers) && producers.length > 0) {
            const producerId = producers[0].id;

            // Mettre à jour la table producers avec les infos de vente directe
            const producerUpdateData: Record<string, unknown> = {};
            if (updates.vente_directe_ferme !== undefined) {
              producerUpdateData.vente_directe_ferme = updates.vente_directe_ferme;
            }
            if (updates.adresse_retrait !== undefined) {
              producerUpdateData.adresse_retrait = updates.adresse_retrait;
            }
            if (updates.horaires_retrait !== undefined) {
              producerUpdateData.horaires_retrait = updates.horaires_retrait;
            }
            if (updates.instructions_retrait !== undefined) {
              producerUpdateData.instructions_retrait = updates.instructions_retrait;
            }

            const updateProducerResponse = await fetch(
              `${SUPABASE_URL}/rest/v1/producers?id=eq.${producerId}`,
              {
                method: 'PATCH',
                headers: {
                  ...getAuthHeaders(currentSession.access_token),
                  'Prefer': 'return=representation',
                },
                body: JSON.stringify(producerUpdateData),
              }
            );

            if (updateProducerResponse.ok) {
            } else {
              console.warn('[Auth] Failed to sync producer direct sales info:', updateProducerResponse.status);
            }
          }
        }
      } catch (syncError) {
        console.warn('[Auth] Error syncing producer direct sales info:', syncError);
      }
    }

    return { profile, error: null };
  } catch (error) {
    console.warn('[Auth] Profile update error');
    return {
      profile: null,
      error: { message: error instanceof Error ? error.message : 'Erreur réseau' },
    };
  }
}

/**
 * Lier un user_code existant au profil Supabase Auth
 */
export async function linkUserCode(
  userCode: string
): Promise<{ success: boolean; error: AuthError | null }> {
  if (!currentSession?.access_token) {
    return { success: false, error: { message: 'Non authentifié' } };
  }

  try {
    // Vérifier d'abord si le code n'est pas déjà utilisé par un autre compte
    const checkResponse = await fetch(
      `${SUPABASE_URL}/rest/v1/profiles?user_code=eq.${encodeURIComponent(userCode)}&id=neq.${currentSession.user.id}`,
      {
        method: 'GET',
        headers: getAuthHeaders(currentSession.access_token),
      }
    );

    const existingProfiles = await checkResponse.json();

    if (Array.isArray(existingProfiles) && existingProfiles.length > 0) {
      return {
        success: false,
        error: { message: 'Ce code utilisateur est déjà lié à un autre compte' },
      };
    }

    // Lier le code
    const response = await fetch(
      `${SUPABASE_URL}/rest/v1/profiles?id=eq.${currentSession.user.id}`,
      {
        method: 'PATCH',
        headers: {
          ...getAuthHeaders(currentSession.access_token),
          'Prefer': 'return=representation',
        },
        body: JSON.stringify({ user_code: userCode }),
      }
    );

    if (!response.ok) {
      return {
        success: false,
        error: { message: 'Erreur liaison du code', status: response.status },
      };
    }

    return { success: true, error: null };
  } catch (error) {
    return {
      success: false,
      error: { message: error instanceof Error ? error.message : 'Erreur réseau' },
    };
  }
}

/**
 * Vérifier si Supabase Auth est configuré
 */
export function isAuthConfigured(): boolean {
  return Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
}

/**
 * Renvoyer l'email de confirmation
 * Rate limited: 5 attempts per 60 seconds
 */
export async function resendConfirmationEmail(
  email: string
): Promise<{ error: AuthError | null }> {
  const normalizedEmail = normalizeEmail(email);
  const rateLimitKey = `resendConfirm:${normalizedEmail}`;

  // Check if rate limited
  const { isBlocked, remainingSeconds } = checkRateLimit(rateLimitKey);
  if (isBlocked) {
    return { error: createRateLimitError(remainingSeconds) };
  }

  // Record attempt before making request
  const limitResult = recordAttempt(rateLimitKey);
  if (limitResult.isBlocked) {
    return { error: createRateLimitError(limitResult.remainingSeconds) };
  }

  try {
    const response = await authFetch(`${SUPABASE_URL}/auth/v1/resend`, {
      method: 'POST',
      headers: getPublicHeaders(),
      body: JSON.stringify({
        type: 'signup',
        email: normalizedEmail,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      return {
        error: {
          message: data.error_description || data.msg || 'Impossible de renvoyer l\'email de confirmation',
          status: response.status,
        },
      };
    }
    return { error: null };
  } catch (error) {
    return {
      error: { message: error instanceof Error ? error.message : 'Erreur réseau' },
    };
  }
}
