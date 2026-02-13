/**
 * Supabase Music Library Management
 * Handles music tracks stored in Supabase Storage and database
 */

import { isSupabaseConfigured, getSupabaseConfig } from './env-validation';
import { getValidSession } from './supabase-auth';
import { ensureDeviceId } from './device-id';

// Bucket names
export const MUSIC_AUDIO_BUCKET = 'music-audio';
export const MUSIC_COVERS_BUCKET = 'music-covers';

export interface MusicTrack {
  id: string;
  title: string;
  artist: string;
  album?: string;
  cover_url?: string;
  audio_url: string;
  position: number; // Order in playlist
  duration_ms?: number;
  created_at: string;
  updated_at: string;
}

export interface MusicTrackInsert {
  title: string;
  artist: string;
  album?: string;
  cover_url?: string;
  audio_url: string;
  position: number;
  duration_ms?: number;
}

const getHeaders = () => {
  const { anonKey } = getSupabaseConfig();
  return {
    'apikey': anonKey,
    'Authorization': `Bearer ${anonKey}`,
    'Content-Type': 'application/json',
    'Prefer': 'return=representation',
  };
};

const getAdminHeaders = async () => {
  const session = await getValidSession();
  if (!session?.access_token) {
    throw new Error('Utilisateur non authentifié');
  }

  const deviceId = await ensureDeviceId();
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${session.access_token}`,
    'X-Device-Id': deviceId,
  };
};

// Check if music API is configured
export function isMusicApiConfigured(): boolean {
  return isSupabaseConfigured();
}

// Fetch all music tracks ordered by position
export async function fetchMusicTracks(): Promise<MusicTrack[]> {
  if (!isMusicApiConfigured()) {
    return [];
  }

  const { url } = getSupabaseConfig();

  try {
    const response = await fetch(
      `${url}/rest/v1/music_tracks?select=*&order=position.asc`,
      {
        method: 'GET',
        headers: getHeaders(),
      }
    );

    if (!response.ok) {
      // Silently handle missing table - this is expected if not configured
      const errorText = await response.text();
      if (errorText.includes('music_tracks') || errorText.includes('PGRST')) {
        return [];
      }
      return [];
    }

    return response.json();
  } catch {
    return [];
  }
}

// Add a new music track
export async function addMusicTrack(track: MusicTrackInsert): Promise<MusicTrack | null> {
  if (!isMusicApiConfigured()) {
    throw new Error('Supabase non configuré');
  }

  const { url } = getSupabaseConfig();
  const headers = await getAdminHeaders();

  const response = await fetch(`${url}/functions/v1/music-tracks-admin`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      action: 'create',
      track,
    }),
  });

  if (!response.ok) {
    throw new Error("Erreur lors de l'ajout");
  }

  const data = await response.json();
  return Array.isArray(data) ? data[0] : data;
}

// Update a music track
export async function updateMusicTrack(
  id: string,
  updates: Partial<MusicTrackInsert>
): Promise<MusicTrack | null> {
  if (!isMusicApiConfigured()) {
    throw new Error('Supabase non configuré');
  }

  const { url } = getSupabaseConfig();
  const headers = await getAdminHeaders();

  const response = await fetch(`${url}/functions/v1/music-tracks-admin`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      action: 'update',
      id,
      updates,
    }),
  });

  if (!response.ok) {
    throw new Error('Erreur lors de la mise à jour');
  }

  const data = await response.json();
  return Array.isArray(data) ? data[0] : data;
}

// Delete a music track
export async function deleteMusicTrack(id: string): Promise<void> {
  if (!isMusicApiConfigured()) {
    throw new Error('Supabase non configuré');
  }

  const { url } = getSupabaseConfig();
  const headers = await getAdminHeaders();

  const response = await fetch(`${url}/functions/v1/music-tracks-admin`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      action: 'delete',
      id,
    }),
  });

  if (!response.ok) {
    throw new Error('Erreur lors de la suppression');
  }
}

// Reorder tracks (update positions)
export async function reorderMusicTracks(
  trackIds: string[]
): Promise<void> {
  if (!isMusicApiConfigured()) {
    throw new Error('Supabase non configuré');
  }

  // Update each track's position in parallel
  const updates = trackIds.map((id, index) =>
    updateMusicTrack(id, { position: index })
  );

  await Promise.all(updates);
}

// Upload audio file to Supabase Storage
export async function uploadAudioFile(
  fileUri: string,
  fileName: string
): Promise<string> {
  if (!isMusicApiConfigured()) {
    throw new Error('Supabase non configuré');
  }

  const { url } = getSupabaseConfig();
  const headers = await getAdminHeaders();

  // Read the file as blob
  const response = await fetch(fileUri);
  const blob = await response.blob();

  // Generate unique filename
  const timestamp = Date.now();
  const sanitizedName = fileName.replace(/[^a-zA-Z0-9.-]/g, '_');
  const finalName = `${timestamp}_${sanitizedName}`;

  const signedResponse = await fetch(`${url}/functions/v1/music-storage-upload-url`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      bucket: MUSIC_AUDIO_BUCKET,
      path: finalName,
      contentType: blob.type || 'audio/mpeg',
      fileSize: blob.size,
    }),
  });

  if (!signedResponse.ok) {
    throw new Error('Erreur signature upload audio');
  }

  const signedPayload = await signedResponse.json();
  const signedUrl = signedPayload?.signedUrl;

  if (!signedUrl) {
    throw new Error('Erreur signature upload audio');
  }

  const uploadResponse = await fetch(signedUrl, {
    method: 'PUT',
    headers: {
      'Content-Type': blob.type || 'audio/mpeg',
    },
    body: blob,
  });

  if (!uploadResponse.ok) {
    throw new Error('Erreur upload audio');
  }

  return `${MUSIC_AUDIO_BUCKET}/${finalName}`;
}

// Upload cover image to Supabase Storage
export async function uploadCoverImage(
  fileUri: string,
  fileName: string
): Promise<string> {
  if (!isMusicApiConfigured()) {
    throw new Error('Supabase non configuré');
  }

  const { url } = getSupabaseConfig();
  const headers = await getAdminHeaders();

  // Read the file as blob
  const response = await fetch(fileUri);
  const blob = await response.blob();

  // Generate unique filename
  const timestamp = Date.now();
  const sanitizedName = fileName.replace(/[^a-zA-Z0-9.-]/g, '_');
  const finalName = `${timestamp}_${sanitizedName}`;

  const signedResponse = await fetch(`${url}/functions/v1/music-storage-upload-url`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      bucket: MUSIC_COVERS_BUCKET,
      path: finalName,
      contentType: blob.type || 'image/jpeg',
      fileSize: blob.size,
    }),
  });

  if (!signedResponse.ok) {
    throw new Error('Erreur signature upload cover');
  }

  const signedPayload = await signedResponse.json();
  const signedUrl = signedPayload?.signedUrl;

  if (!signedUrl) {
    throw new Error('Erreur signature upload cover');
  }

  const uploadResponse = await fetch(signedUrl, {
    method: 'PUT',
    headers: {
      'Content-Type': blob.type || 'image/jpeg',
    },
    body: blob,
  });

  if (!uploadResponse.ok) {
    throw new Error('Erreur upload cover');
  }

  return `${MUSIC_COVERS_BUCKET}/${finalName}`;
}

// Delete file from storage
function normalizeMusicPath(path: string): string {
  if (path.startsWith('http://') || path.startsWith('https://')) {
    const marker = '/storage/v1/object/';
    const idx = path.indexOf(marker);
    if (idx !== -1) {
      return path.slice(idx + marker.length);
    }
  }
  return path.replace(/^\/+/, '');
}

async function getSignedMusicUrl(bucket: typeof MUSIC_AUDIO_BUCKET | typeof MUSIC_COVERS_BUCKET, path: string): Promise<string> {
  if (!isMusicApiConfigured()) {
    throw new Error('Supabase non configuré');
  }

  if (!path) {
    return '';
  }

  if (path.includes('/storage/v1/object/sign/') || path.includes('token=')) {
    return path;
  }

  const normalized = normalizeMusicPath(path);
  if (!normalized.startsWith(`${bucket}/`)) {
    return path;
  }

  const { url } = getSupabaseConfig();
  let headers: Record<string, string>;
  try {
    headers = await getAdminHeaders();
  } catch {
    return path;
  }

  const response = await fetch(
    `${url}/functions/v1/music-storage-signed-url`,
    {
      method: 'POST',
      headers,
      body: JSON.stringify({
        bucket,
        path: normalized,
        expiresIn: 3600,
      }),
    }
  );

  if (!response.ok) {
    return path;
  }

  const data = await response.json();
  return data?.url || path;
}

export async function deleteStorageFile(
  bucket: string,
  filePath: string
): Promise<void> {
  if (!isMusicApiConfigured()) {
    throw new Error('Supabase non configuré');
  }

  const { url } = getSupabaseConfig();
  const headers = await getAdminHeaders();

  const normalized = normalizeMusicPath(filePath);
  const path = normalized.startsWith(`${bucket}/`) ? normalized : `${bucket}/${normalized}`;

  const response = await fetch(`${url}/functions/v1/music-storage-mutations`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      action: 'delete',
      bucket,
      path,
    }),
  });

  if (!response.ok) {
    console.error('[MusicAPI] Error deleting file');
  }
}

// Get signed URL for private audio files
export async function getSignedAudioUrl(filePath: string): Promise<string> {
  return getSignedMusicUrl(MUSIC_AUDIO_BUCKET, filePath);
}

export async function getSignedCoverUrl(filePath: string): Promise<string> {
  return getSignedMusicUrl(MUSIC_COVERS_BUCKET, filePath);
}
