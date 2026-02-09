import { getSupabaseConfig } from './env-validation';
import { getSession } from './supabase-auth';

const SIGNED_URL_MARKERS = ['/storage/v1/object/sign/', 'token='];
const LOCAL_PREFIXES = ['file://', '/data/', 'content://', 'asset:'];

function isRemoteUrl(path: string): boolean {
  return path.startsWith('http://') || path.startsWith('https://');
}

function isLocalPath(path: string): boolean {
  return LOCAL_PREFIXES.some((prefix) => path.startsWith(prefix));
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
  const session = getSession();
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
  if (isLocalPath(path)) return path;
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

export async function getSignedLabAnalysisUrl(path: string, expiresIn = 3600): Promise<string> {
  if (!path) return '';
  if (isLocalPath(path)) return path;
  if (isSignedUrl(path)) return path;

  const normalized = normalizeStoragePath(path);
  if (!normalized.startsWith('lab-analyses/')) {
    return path;
  }

  const signed = await fetchSignedUrl('lab-analyses-url', { path: normalized, expiresIn });
  return signed ?? path;
}
