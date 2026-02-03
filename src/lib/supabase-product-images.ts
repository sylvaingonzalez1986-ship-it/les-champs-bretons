/**
 * Supabase Product Images Management
 * Handles product image uploads for producers
 */

import { getSupabaseConfig } from './env-validation';
import { getSession } from './supabase-auth';

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL || '';
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || '';

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

  const uploadMetricStart = Date.now();

  // Read the file as blob
  const response = await fetch(fileUri);
  const blob = await response.blob();

  const MAX_IMAGE_BYTES = 10 * 1024 * 1024; // 10MB
  if (blob.size > MAX_IMAGE_BYTES) {
    throw new Error('Image trop volumineuse (max 10MB)');
  }

  // Generate unique filename with producer/product path
  const timestamp = Date.now();
  const ext = fileUri.split('.').pop()?.toLowerCase() || 'jpg';
  const finalName = `${producerId}/${productId}/${timestamp}.${ext}`;

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
          'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
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

  // Upload to Supabase Storage
  const uploadResponse = await fetch(
    `${SUPABASE_URL}/storage/v1/object/${PRODUCT_IMAGES_BUCKET}/${finalName}`,
    {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        'Content-Type': blob.type || 'image/jpeg',
        'x-upsert': 'true',
      },
      body: blob,
    }
  );

  if (!uploadResponse.ok) {
    console.warn('[ProductImages] Upload error');
    throw new Error('Erreur upload image');
  }

  // Return the public URL
  const publicUrl = `${SUPABASE_URL}/storage/v1/object/public/${PRODUCT_IMAGES_BUCKET}/${finalName}`;

  if (__DEV__) {
    const duration = Date.now() - uploadMetricStart;
    console.info('[Metrics] upload.product_image', { durationMs: duration });
  }

  return publicUrl;
}

/**
 * Delete a product image from Supabase Storage
 * @param imageUrl - Full URL of the image to delete
 */
export async function deleteProductImage(imageUrl: string): Promise<void> {
  if (!isProductImagesConfigured()) {
    throw new Error('Supabase non configuré');
  }

  // Extract file path from URL
  const pathMatch = imageUrl.match(new RegExp(`${PRODUCT_IMAGES_BUCKET}/(.+)$`));
  if (!pathMatch) {
    console.warn('[ProductImages] Could not extract path from URL:', imageUrl);
    return;
  }

  const filePath = pathMatch[1];

  const response = await fetch(
    `${SUPABASE_URL}/storage/v1/object/${PRODUCT_IMAGES_BUCKET}/${filePath}`,
    {
      method: 'DELETE',
      headers: {
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
      },
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

  const isRemote = path.startsWith('http://') || path.startsWith('https://');
  const isLocal = path.startsWith('file://') || path.startsWith('/data/') || path.includes('/cache/');
  if (isLocal) return path;

  if (!isProductImagesUrl(path)) {
    return path;
  }

  if (path.includes('/storage/v1/object/sign/') || path.includes('token=')) {
    return path;
  }

  const session = getSession();
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
