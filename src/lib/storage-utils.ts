import { getSupabaseConfig } from './env-validation';
import { getValidSession } from './supabase-auth';

const SIGNED_URL_MARKERS = ['/storage/v1/object/sign/', 'token='];
const LOCAL_PREFIXES = [
  'file://',
  '/data/',
  '/cache/',
  '/var/',
  '/private/',
  '/tmp/',
  '/documents/',
  '/caches/',
  'content://',
  'asset:',
  'ph://',
  'assets-library://',
];

function isRemoteUrl(path: string): boolean {
  return path.startsWith('http://') || path.startsWith('https://');
}

export function isLikelyLocalPath(path: string): boolean {
  const normalized = path.trim().toLowerCase();
  return LOCAL_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}

function isSignedUrl(path: string): boolean {
  return SIGNED_URL_MARKERS.some((marker) => path.includes(marker));
}

function normalizeStoragePath(inputPath: string): string {
  if (isRemoteUrl(inputPath)) {
    const marker = '/storage/v1/object/';
    const idx = inputPath.indexOf(marker);
    if (idx !== -1) {
      const rawPath = inputPath.slice(idx + marker.length);
      if (rawPath.startsWith('public/')) {
        return rawPath.slice('public/'.length);
      }
      if (rawPath.startsWith('sign/')) {
        return rawPath.slice('sign/'.length);
      }
      return rawPath;
    }
  }
  return inputPath.replace(/^\/+/, '');
}

async function fetchSignedUrl(
  functionName: string,
  body: Record<string, unknown>
): Promise<string | null> {
  const session = await getValidSession();
  if (!session?.access_token) {
    return null;
  }

  const { url, anonKey } = getSupabaseConfig();
  const response = await fetch(`${url}/functions/v1/${functionName}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: anonKey,
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    return null;
  }

  const data = await response.json();
  return data?.url ?? null;
}

export async function getSignedImageUrl(path: string, expiresIn = 3600): Promise<string> {
  if (!path) return '';
  if (isLikelyLocalPath(path)) return path;
  if (isSignedUrl(path)) return path;

  const normalized = normalizeStoragePath(path);
  if (normalized.startsWith('images/')) {
    const signed = await fetchSignedUrl('images-url', { path: normalized, expiresIn });
    return signed ?? path;
  }

  if (normalized.startsWith('product-images/')) {
    const signed = await fetchSignedUrl('product-images-url', { path: normalized, expiresIn });
    return signed ?? path;
  }

  return path;
}

/**
 * Le bucket lab-analyses est public (transparence).
 * Construit directement l'URL publique sans passer par l'edge function authentifiée.
 */
export function getLabAnalysisPublicUrl(path: string): string {
  if (!path) return '';
  if (isLikelyLocalPath(path)) return path;
  if (isRemoteUrl(path)) return path;

  const { url } = getSupabaseConfig();
  const normalized = normalizeStoragePath(path);
  const storagePath = normalized.startsWith('lab-analyses/') ? normalized : `lab-analyses/${normalized}`;
  return `${url}/storage/v1/object/public/${storagePath}`;
}

/** Alias async pour compatibilité avec les appels existants */
export async function getSignedLabAnalysisUrl(path: string, _expiresIn = 3600): Promise<string> {
  return getLabAnalysisPublicUrl(path);
}
