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
  const cryptoObj = (globalThis as unknown as { crypto?: { randomUUID?: () => string; getRandomValues?: (array: Uint8Array) => Uint8Array } }).crypto;
  if (cryptoObj?.randomUUID) {
    return cryptoObj.randomUUID();
  }

  // 3. Use Web Crypto getRandomValues to build UUIDv4
  if (cryptoObj?.getRandomValues) {
    const bytes = new Uint8Array(16);
    cryptoObj.getRandomValues(bytes);

    // Set version (4) and variant (10)
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;

    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0'));
    return `${hex.slice(0, 4).join('')}-${hex.slice(4, 6).join('')}-${hex.slice(6, 8).join('')}-${hex.slice(8, 10).join('')}-${hex.slice(10, 16).join('')}`;
  }

  // No secure source available: fail fast
  throw new Error('[UUID] No secure random source available');
}

/**
 * Generate a prefixed ID for specific use cases
 * @param prefix - Prefix for the ID (e.g., 'lab', 'img', 'order')
 * @returns Prefixed UUID string
 */
export function generatePrefixedId(prefix: string): string {
  return `${prefix}_${generateSecureUUID()}`;
}
