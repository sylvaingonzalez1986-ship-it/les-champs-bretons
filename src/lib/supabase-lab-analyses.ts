/**
 * Supabase Lab Analyses Management
 * Handles lab analysis uploads (PDF or image) for products
 */

import { getSession, getValidSession, SUPABASE_URL, SUPABASE_ANON_KEY } from './supabase-auth';
import { ensureDeviceId } from './device-id';
import { generateSecureUUID } from './uuid';

export const LAB_ANALYSES_BUCKET = 'lab-analyses';

// Check if Supabase is configured
export function isLabAnalysesConfigured(): boolean {
  return Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
}

function getExtensionFromName(name: string | undefined): string {
  if (!name) return '';
  const parts = name.split('.');
  if (parts.length < 2) return '';
  return parts.pop()?.toLowerCase() || '';
}

function getExtensionFromMime(mimeType: string | undefined): string {
  if (!mimeType) return '';
  if (mimeType.includes('pdf')) return 'pdf';
  if (mimeType.includes('png')) return 'png';
  if (mimeType.includes('jpeg') || mimeType.includes('jpg')) return 'jpg';
  return '';
}

function normalizeExtension(ext: string): string {
  if (!ext) return 'pdf';
  if (ext === 'jpeg') return 'jpg';
  return ext;
}

function getContentType(ext: string, mimeType?: string): string {
  if (mimeType) return mimeType;
  if (ext === 'pdf') return 'application/pdf';
  if (ext === 'png') return 'image/png';
  return 'image/jpeg';
}

/**
 * Upload a lab analysis file to Supabase Storage
 * @param fileUri - Local file URI (file://...) or remote URL
 * @param producerId - ID of the producer
 * @param productId - ID of the product (can be temporary)
 * @param fileName - Optional original file name
 * @param mimeType - Optional mime type
 * @returns Storage path of the uploaded file (bucket/path)
 */
export async function uploadLabAnalysis(
  fileUri: string,
  producerId: string,
  productId: string,
  fileName?: string,
  mimeType?: string
): Promise<string> {
  if (!isLabAnalysesConfigured()) {
    throw new Error('Supabase non configurÃ©');
  }

  const session = await getValidSession();
  if (!session?.access_token) {
    throw new Error('Utilisateur non authentifiÃ©');
  }

  // Already a remote URL
  if (fileUri.startsWith('http://') || fileUri.startsWith('https://')) {
    return fileUri;
  }

  const extFromName = getExtensionFromName(fileName);
  const extFromUri = getExtensionFromName(fileUri);
  const extFromMime = getExtensionFromMime(mimeType);
  const ext = normalizeExtension(extFromName || extFromMime || extFromUri || 'pdf');
  const contentType = getContentType(ext, mimeType);

  // Read the file as blob
  const response = await fetch(fileUri);
  const blob = await response.blob();

  const id = generateSecureUUID();
  const finalName = `${producerId}/${productId}/${id}.${ext}`;

  const deviceId = await ensureDeviceId();
  const signedUrlResponse = await fetch(
    `${SUPABASE_URL}/functions/v1/lab-analyses-upload-url`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
        'X-Device-Id': deviceId,
      },
      body: JSON.stringify({
        path: finalName,
        contentType: contentType || blob.type || 'application/octet-stream',
        fileSize: blob.size,
      }),
    }
  );

  if (!signedUrlResponse.ok) {
    throw new Error('Erreur signature upload');
  }

  const signedPayload = await signedUrlResponse.json();
  const signedUrl = signedPayload?.signedUrl;
  const storedPath = signedPayload?.path;

  if (!signedUrl || !storedPath) {
    throw new Error('Erreur signature upload');
  }

  const uploadResponse = await fetch(
    signedUrl,
    {
      method: 'PUT',
      headers: {
        'Content-Type': contentType || blob.type || 'application/octet-stream',
      },
      body: blob,
    }
  );

  if (!uploadResponse.ok) {
    const errorText = await uploadResponse.text();
    console.warn('[LabAnalyses] Upload error:', errorText);
    throw new Error('Erreur upload analyse laboratoire');
  }

  return storedPath as string;
}

function isLabAnalysesUrl(url: string): boolean {
  return url.includes('/storage/v1/object/public/lab-analyses/')
    || url.includes('/storage/v1/object/lab-analyses/')
    || url.includes('/storage/v1/object/sign/lab-analyses/')
    || url.startsWith('lab-analyses/');
}

export async function getSignedLabAnalysisUrl(path: string, expiresIn = 3600): Promise<string> {
  if (!path) return '';

  const isRemote = path.startsWith('http://') || path.startsWith('https://');
  const isLocal = path.startsWith('file://') || path.startsWith('/data/') || path.includes('/cache/');
  if (isLocal) return path;

  if (path.includes('/storage/v1/object/sign/') || path.includes('token=')) {
    return path;
  }

  if (!isLabAnalysesUrl(path)) {
    return path;
  }

  const session = getSession();
  if (!session?.access_token) {
    return path;
  }

  const response = await fetch(`${SUPABASE_URL}/functions/v1/lab-analyses-url`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({ path, expiresIn }),
  });

  if (!response.ok) {
    return path;
  }

  const data = await response.json();
  return data?.url || path;
}
