/**
 * Input Validation Utilities - Les Chanvriers Unis
 * Provides client-side validation and sanitization for security
 *
 * IMPORTANT: Server-side validation (RLS + SQL functions) is the primary defense.
 * This module provides defense-in-depth on the client side.
 */

// =============================================================================
// EMAIL VALIDATION
// =============================================================================

/**
 * Validates email format
 * Matches the server-side is_valid_email() function
 */
export function isValidEmail(email: string): boolean {
  if (!email || typeof email !== 'string') return false;

  // Same regex as server-side for consistency
  const emailRegex = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/i;
  return emailRegex.test(email.trim());
}

/**
 * Normalizes email address
 * - Removes invisible characters
 * - Trims whitespace
 * - Converts to lowercase
 */
export function normalizeEmail(email: string): string {
  if (!email || typeof email !== 'string') return '';

  return email
    // Remove invisible/zero-width characters
    .replace(/[\u200B-\u200D\uFEFF\u00A0]/g, '')
    // Remove control characters
    .replace(/[\x00-\x1F\x7F]/g, '')
    // Trim whitespace
    .trim()
    // Convert to lowercase
    .toLowerCase();
}


// =============================================================================
// TEXT SANITIZATION
// =============================================================================

/**
 * Sanitizes text input by removing control characters
 * Preserves newlines and tabs for text fields
 */
export function sanitizeText(input: string | null | undefined): string {
  if (input == null) return '';
  if (typeof input !== 'string') return '';

  // Remove control characters except \n (10) and \t (9)
  // Regex: [\x00-\x08\x0B\x0C\x0E-\x1F\x7F]
  return input.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
}

/**
 * Sanitizes text and also removes newlines (for single-line inputs)
 */
export function sanitizeSingleLine(input: string | null | undefined): string {
  if (input == null) return '';
  if (typeof input !== 'string') return '';

  // Remove all control characters including newlines
  return input.replace(/[\x00-\x1F\x7F]/g, '').trim();
}


// =============================================================================
// SQL INJECTION PREVENTION (for search/filter inputs)
// =============================================================================

/**
 * Escapes special characters that could be used in SQL injection
 * NOTE: This is for extra safety - Supabase uses parameterized queries
 */
export function escapeSqlLike(input: string): string {
  if (!input || typeof input !== 'string') return '';

  // Escape special characters used in LIKE patterns
  return input
    .replace(/\\/g, '\\\\')
    .replace(/%/g, '\\%')
    .replace(/_/g, '\\_');
}


// =============================================================================
// XSS PREVENTION
// =============================================================================

/**
 * Escapes HTML special characters to prevent XSS
 * Use this when displaying user-generated content
 */
export function escapeHtml(input: string | null | undefined): string {
  if (input == null) return '';
  if (typeof input !== 'string') return '';

  const htmlEscapes: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  };

  return input.replace(/[&<>"']/g, (char) => htmlEscapes[char] || char);
}


// =============================================================================
// PHONE NUMBER VALIDATION (French format)
// =============================================================================

/**
 * Validates French phone number format
 * Accepts formats: 0612345678, +33612345678, 06 12 34 56 78
 */
export function isValidFrenchPhone(phone: string): boolean {
  if (!phone || typeof phone !== 'string') return false;

  // Remove spaces and dashes
  const cleaned = phone.replace(/[\s\-\.]/g, '');

  // French mobile: 06 or 07
  // French landline: 01-05, 09
  // International format: +33
  const frenchPhoneRegex = /^(?:(?:\+33|0033|0)[1-9](?:[0-9]{8}))$/;
  return frenchPhoneRegex.test(cleaned);
}

/**
 * Normalizes French phone number to standard format
 */
export function normalizeFrenchPhone(phone: string): string {
  if (!phone || typeof phone !== 'string') return '';

  // Remove spaces, dashes, dots
  let cleaned = phone.replace(/[\s\-\.]/g, '');

  // Convert +33 or 0033 to 0
  if (cleaned.startsWith('+33')) {
    cleaned = '0' + cleaned.slice(3);
  } else if (cleaned.startsWith('0033')) {
    cleaned = '0' + cleaned.slice(4);
  }

  return cleaned;
}


// =============================================================================
// SIRET/SIREN VALIDATION (French business numbers)
// =============================================================================

/**
 * Validates SIRET number (14 digits) using Luhn algorithm
 */
export function isValidSiret(siret: string): boolean {
  if (!siret || typeof siret !== 'string') return false;

  // Remove spaces
  const cleaned = siret.replace(/\s/g, '');

  // Must be exactly 14 digits
  if (!/^\d{14}$/.test(cleaned)) return false;

  // Luhn algorithm for SIRET
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    let digit = parseInt(cleaned[i], 10);
    if (i % 2 === 0) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
  }

  return sum % 10 === 0;
}


// =============================================================================
// PASSWORD STRENGTH
// =============================================================================

export interface PasswordStrength {
  score: number; // 0-4
  isStrong: boolean;
  feedback: string[];
}

/**
 * Evaluates password strength
 */
export function checkPasswordStrength(password: string): PasswordStrength {
  const feedback: string[] = [];
  let score = 0;

  if (!password) {
    return { score: 0, isStrong: false, feedback: ['Mot de passe requis'] };
  }

  // Length checks
  if (password.length >= 8) score++;
  else feedback.push('Au moins 8 caractères');

  if (password.length >= 12) score++;

  // Character variety
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score++;
  else feedback.push('Majuscules et minuscules');

  if (/\d/.test(password)) score++;
  else feedback.push('Au moins un chiffre');

  if (/[!@#$%^&*(),.?":{}|<>]/.test(password)) score++;
  else feedback.push('Caractère spécial recommandé');

  // Common patterns to avoid
  const commonPatterns = [
    /^123456/,
    /password/i,
    /azerty/i,
    /qwerty/i,
  ];

  if (commonPatterns.some((p) => p.test(password))) {
    score = Math.max(0, score - 2);
    feedback.push('Évitez les mots de passe courants');
  }

  return {
    score: Math.min(4, score),
    isStrong: score >= 3,
    feedback,
  };
}


// =============================================================================
// URL VALIDATION
// =============================================================================

/**
 * Validates URL format (for image URLs, etc.)
 */
export function isValidUrl(url: string): boolean {
  if (!url || typeof url !== 'string') return false;

  try {
    const parsed = new URL(url);
    return ['http:', 'https:'].includes(parsed.protocol);
  } catch {
    return false;
  }
}


// =============================================================================
// VALIDATION HELPERS
// =============================================================================

/**
 * Validates and sanitizes profile update data
 */
export interface ProfileUpdateData {
  full_name?: string;
  first_name?: string;
  last_name?: string;
  phone?: string;
  address?: string;
  postal_code?: string;
  city?: string;
  company_name?: string;
  siret?: string;
}

export function validateProfileUpdate(data: ProfileUpdateData): {
  isValid: boolean;
  errors: string[];
  sanitized: ProfileUpdateData;
} {
  const errors: string[] = [];
  const sanitized: ProfileUpdateData = {};

  // Sanitize text fields
  if (data.full_name !== undefined) {
    sanitized.full_name = sanitizeSingleLine(data.full_name);
  }
  if (data.first_name !== undefined) {
    sanitized.first_name = sanitizeSingleLine(data.first_name);
  }
  if (data.last_name !== undefined) {
    sanitized.last_name = sanitizeSingleLine(data.last_name);
  }
  if (data.address !== undefined) {
    sanitized.address = sanitizeText(data.address);
  }
  if (data.city !== undefined) {
    sanitized.city = sanitizeSingleLine(data.city);
  }
  if (data.company_name !== undefined) {
    sanitized.company_name = sanitizeSingleLine(data.company_name);
  }

  // Validate and normalize phone
  if (data.phone !== undefined && data.phone !== '') {
    if (!isValidFrenchPhone(data.phone)) {
      errors.push('Numéro de téléphone invalide');
    } else {
      sanitized.phone = normalizeFrenchPhone(data.phone);
    }
  } else {
    sanitized.phone = data.phone;
  }

  // Validate postal code (French: 5 digits)
  if (data.postal_code !== undefined && data.postal_code !== '') {
    const cleanedPostal = data.postal_code.replace(/\s/g, '');
    if (!/^\d{5}$/.test(cleanedPostal)) {
      errors.push('Code postal invalide (5 chiffres)');
    } else {
      sanitized.postal_code = cleanedPostal;
    }
  } else {
    sanitized.postal_code = data.postal_code;
  }

  // Validate SIRET
  if (data.siret !== undefined && data.siret !== '') {
    if (!isValidSiret(data.siret)) {
      errors.push('Numéro SIRET invalide');
    } else {
      sanitized.siret = data.siret.replace(/\s/g, '');
    }
  } else {
    sanitized.siret = data.siret;
  }

  return {
    isValid: errors.length === 0,
    errors,
    sanitized,
  };
}
