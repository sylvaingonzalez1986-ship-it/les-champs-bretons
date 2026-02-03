/**
 * Supabase Lab Analyses Management
 * Handles lab analysis uploads (PDF or image) for products
 */

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL || '';
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || '';

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

function generateId(): string {
  const cryptoObj = (globalThis as unknown as { crypto?: { randomUUID?: () => string } }).crypto;
  if (cryptoObj?.randomUUID) {
    return cryptoObj.randomUUID();
  }
  return `lab_${Date.now()}_${Math.floor(Math.random() * 1_000_000)}`;
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
    throw new Error('Supabase non configuré');
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

  const id = generateId();
  const finalName = `${producerId}/${productId}/${id}.${ext}`;

  const uploadResponse = await fetch(
    `${SUPABASE_URL}/storage/v1/object/${LAB_ANALYSES_BUCKET}/${finalName}`,
    {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        'Content-Type': contentType || blob.type || 'application/octet-stream',
        'x-upsert': 'true',
      },
      body: blob,
    }
  );

  if (!uploadResponse.ok) {
    const errorText = await uploadResponse.text();
    console.warn('[LabAnalyses] Upload error:', errorText);
    throw new Error('Erreur upload analyse laboratoire');
  }

  return `${LAB_ANALYSES_BUCKET}/${finalName}`;
}
