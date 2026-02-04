/**
 * UUID Generation Utility - Les Chanvriers Unis
 *
 * Single source of truth for UUID generation across the app.
 * Uses cryptographically secure methods with fallback.
 */

import * as Crypto from 'expo-crypto';

/**
 * Generate a cryptographically secure UUID v4
 *
 * Priority:
 * 1. expo-crypto (mobile - most reliable)
 * 2. globalThis.crypto.randomUUID (web)
 * 3. Fallback (NOT cryptographically secure - logs warning)
 *
 * @returns UUID v4 string
 */
export function generateSecureUUID(): string {
  // 1. Try expo-crypto (mobile)
  if (Crypto?.randomUUID) {
    return Crypto.randomUUID();
  }

  // 2. Try Web Crypto API
  const cryptoObj = (globalThis as unknown as { crypto?: { randomUUID?: () => string } }).crypto;
  if (cryptoObj?.randomUUID) {
    return cryptoObj.randomUUID();
  }

  // 3. Fallback (NOT secure - for edge cases only)
  console.warn('[UUID] Fallback to non-secure UUID generation');
  return `${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 11)}-${Math.random().toString(36).substring(2, 11)}`;
}

/**
 * Generate a prefixed ID for specific use cases
 * @param prefix - Prefix for the ID (e.g., 'lab', 'img', 'order')
 * @returns Prefixed UUID string
 */
export function generatePrefixedId(prefix: string): string {
  return `${prefix}_${generateSecureUUID()}`;
}
