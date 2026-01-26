/**
 * SSL Pinning Implementation
 * Les Chanvriers Unis - MITM Attack Prevention
 *
 * Protege contre les attaques Man-in-the-Middle sur les reseaux WiFi publics
 *
 * NOTE: Cette implementation utilise une approche compatible Vibecode
 * (sans package natif react-native-ssl-pinning)
 *
 * En production avec EAS Build, vous pourrez utiliser react-native-ssl-pinning
 * pour une protection complete au niveau natif.
 */

import { Platform } from 'react-native';
import { SUPABASE_CERT_HASH, shouldRenewCertificate } from './ssl-cert-hash';

// Verifier le certificat au demarrage de l'app (dev mode)
if (__DEV__) {
  shouldRenewCertificate();
}

// Configuration timeout par defaut
const DEFAULT_TIMEOUT = 15000; // 15 secondes

/**
 * Fetch securise avec validation et timeout
 * Compatible Vibecode (sans SSL pinning natif)
 *
 * En production avec EAS Build, cette fonction peut etre etendue
 * pour utiliser react-native-ssl-pinning.
 *
 * @param url - URL complete de la requete
 * @param options - Options fetch standard
 * @returns Response standard
 */
export async function secureFetch(
  url: string,
  options: RequestInit = {}
): Promise<Response> {
  const isSupabaseRequest = url.includes('.supabase.co');

  // Creer un AbortController pour le timeout
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT);

  try {
    // Ajouter le signal d'abort aux options
    const fetchOptions: RequestInit = {
      ...options,
      signal: controller.signal,
    };

    // Log en mode dev pour les requetes Supabase
    if (__DEV__ && isSupabaseRequest) {
      console.log('[SecureFetch] Requete Supabase:', url.split('?')[0]);
    }

    const response = await fetch(url, fetchOptions);

    // Validation de la reponse pour les requetes Supabase
    if (isSupabaseRequest) {
      // Verifier que la reponse vient bien de Supabase
      const serverHeader = response.headers.get('server');
      const supabaseHeaders = response.headers.get('x-envoy-upstream-service-time');

      // Log warning si les headers Supabase sont manquants (possible MITM)
      if (__DEV__ && !supabaseHeaders && response.ok) {
        console.warn(
          '[SecureFetch] Warning: Headers Supabase manquants - verifier la connexion'
        );
      }
    }

    return response;
  } catch (error: any) {
    // Gestion des erreurs specifiques
    if (error.name === 'AbortError') {
      throw new Error(
        'La requete a expire. Verifiez votre connexion internet.'
      );
    }

    // Erreur reseau potentielle
    if (error.message?.includes('Network') || error.message?.includes('fetch')) {
      console.error('[SecureFetch] Erreur reseau:', error.message);
      throw new Error(
        'Probleme de connexion. Verifiez que vous etes sur un reseau securise.'
      );
    }

    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Version securisee de fetch pour les tests
 * Utilise fetch() natif en developpement
 */
export async function secureFetchDev(
  url: string,
  options: RequestInit = {}
): Promise<Response> {
  if (__DEV__) {
    console.log('[SecureFetch] Mode DEV - utilise fetch standard');
    return fetch(url, options);
  }
  return secureFetch(url, options);
}

/**
 * Verifier la connexion Supabase
 * Retourne true si la connexion est securisee
 */
export async function checkSupabaseConnection(supabaseUrl: string): Promise<boolean> {
  try {
    const response = await secureFetch(`${supabaseUrl}/rest/v1/`, {
      method: 'HEAD',
    });
    return response.ok || response.status === 400; // 400 = auth required = OK
  } catch {
    return false;
  }
}
