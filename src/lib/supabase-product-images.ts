/**
 * Supabase Product Images Management
 * Handles product image uploads for producers
 */

import { getSupabaseConfig, SUPABASE_URL, SUPABASE_ANON_KEY } from './env-validation';
import { getValidSession } from './supabase-auth';
import { ensureDeviceId } from './device-id';
import { isLikelyLocalPath } from './storage-utils';
import * as Crypto from 'expo-crypto';

export const PRODUCT_IMAGES_BUCKET = 'product-images';

// Check if Supabase is configured
export function isProductImagesConfigured(): boolean {
  return Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
}

/**
 * Upload a product image to Supabase Storage
 * @param fileUri - Local file URI from camera or gallery
 * @param producerId - ID of the producer
 * @param productId - ID of the product
 * @returns Public URL of the uploaded image
 */
export async function uploadProductImage(
  fileUri: string,
  producerId: string,
  productId: string
): Promise<string> {
  if (!isProductImagesConfigured()) {
    throw new Error('Supabase non configuré');
  }

  const session = await getValidSession();
  if (!session?.access_token) {
    throw new Error('Utilisateur non authentifié');
  }

  const uploadMetricStart = Date.now();

  // Read the file as blob
  const response = await fetch(fileUri);
  const blob = await response.blob();

  const MAX_IMAGE_BYTES = 10 * 1024 * 1024; // 10MB
  if (blob.size > MAX_IMAGE_BYTES) {
    throw new Error('Image trop volumineuse (max 10MB)');
  }

  // Generate unique filename with producer/product path
  const uuid = Crypto.randomUUID();
  const ext = fileUri.split('.').pop()?.toLowerCase() || 'jpg';
  const finalName = `${producerId}/${productId}/${uuid}.${ext}`;

  // Validate upload server-side (RPC)
  try {
    let isInvalid = false;
    let invalidReason = 'Validation upload refusée';
    const validationResponse = await fetch(
      `${SUPABASE_URL}/rest/v1/rpc/validate_file_upload`,
      {
        method: 'POST',
        headers: {
          'apikey': SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          p_bucket_name: PRODUCT_IMAGES_BUCKET,
          p_file_path: finalName,
          p_file_size: blob.size,
          p_mime_type: blob.type || 'image/jpeg',
          p_file_header: null,
        }),
      }
    );

    if (validationResponse.ok) {
      const validationResult = await validationResponse.json();
      if (!validationResult?.valid) {
        isInvalid = true;
        invalidReason = validationResult?.reason || invalidReason;
      }
    }

    if (isInvalid) {
      throw new Error(invalidReason);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Validation upload refusée';
    if (message) {
      throw new Error(message);
    }
    console.warn('[ProductImages] Validation upload error:', error);
  }

  const deviceId = await ensureDeviceId();
  const signedUrlResponse = await fetch(
    `${SUPABASE_URL}/functions/v1/product-images-upload-url`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
        'X-Device-Id': deviceId,
      },
      body: JSON.stringify({
        path: finalName,
        contentType: blob.type || 'image/jpeg',
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

  const uploadResponse = await fetch(signedUrl, {
    method: 'PUT',
    headers: {
      'Content-Type': blob.type || 'image/jpeg',
    },
    body: blob,
  });

  if (!uploadResponse.ok) {
    console.warn('[ProductImages] Upload error');
    throw new Error('Erreur upload image');
  }

  if (__DEV__) {
    const duration = Date.now() - uploadMetricStart;
    console.info('[Metrics] upload.product_image', { durationMs: duration });
  }

  return storedPath as string;
}

/**
 * Delete a product image from Supabase Storage
 * @param imageUrl - Full URL of the image to delete
 */
export async function deleteProductImage(imageUrl: string): Promise<void> {
  if (!isProductImagesConfigured()) {
    throw new Error('Supabase non configuré');
  }

  const session = await getValidSession();
  if (!session?.access_token) {
    throw new Error('Utilisateur non authentifié');
  }

  const deviceId = await ensureDeviceId();

  const response = await fetch(
    `${SUPABASE_URL}/functions/v1/product-images-mutations`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
        'X-Device-Id': deviceId,
      },
      body: JSON.stringify({
        action: 'delete',
        path: imageUrl,
      }),
    }
  );

  if (!response.ok) {
    console.warn('[ProductImages] Delete error');
  }
}

function isProductImagesUrl(url: string): boolean {
  return url.includes('/storage/v1/object/public/product-images/')
    || url.includes('/storage/v1/object/product-images/')
    || url.includes('/storage/v1/object/sign/product-images/')
    || url.startsWith('product-images/');
}

export async function getSignedProductImageUrl(path: string, expiresIn = 3600): Promise<string> {
  if (!path) return '';

  const isLocal = isLikelyLocalPath(path);
  if (isLocal) return path;

  if (!isProductImagesUrl(path)) {
    return path;
  }

  if (path.includes('/storage/v1/object/sign/') || path.includes('token=')) {
    return path;
  }

  const session = await getValidSession();
  if (!session?.access_token) {
    return path;
  }

  try {
    const { url, anonKey } = getSupabaseConfig();
    const response = await fetch(`${url}/functions/v1/product-images-url`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': anonKey,
        'Authorization': `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ path, expiresIn }),
    });

    if (!response.ok) {
      return path;
    }

    const data = await response.json();
    return data?.url || path;
  } catch {
    return path;
  }
}

/**
 * Upload multiple product images
 * @param fileUris - Array of local file URIs
 * @param producerId - ID of the producer
 * @param productId - ID of the product
 * @returns Array of public URLs
 */
export async function uploadMultipleProductImages(
  fileUris: string[],
  producerId: string,
  productId: string,
  maxConcurrent: number = 3
): Promise<string[]> {
  const urls: string[] = [];

  for (let i = 0; i < fileUris.length; i += maxConcurrent) {
    const batch = fileUris.slice(i, i + maxConcurrent);
    const results = await Promise.allSettled(
      batch.map((uri) => uploadProductImage(uri, producerId, productId))
    );

    results.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        urls.push(result.value);
      } else {
        console.warn('[ProductImages] Error uploading image:', result.reason, batch[index]);
      }
    });
  }

  return urls;
}
