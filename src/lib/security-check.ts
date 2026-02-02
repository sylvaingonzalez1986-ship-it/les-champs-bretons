/**
 * Security Check - Verify no secrets are exposed in client bundle
 *
 * This module provides runtime checks to ensure sensitive API keys
 * are not accidentally exposed in the client-side code.
 *
 * Run this at app startup in development mode.
 */

// List of environment variable prefixes that should NEVER be exposed client-side
const FORBIDDEN_PREFIXES = [
  'SUPABASE_SERVICE_ROLE',
  'SERVICE_ROLE',
  'SECRET_KEY',
  'PRIVATE_KEY',
  'API_SECRET',
];

// List of sensitive keys that should only be in Edge Functions
const SENSITIVE_KEYS_PATTERNS = [
  /openai.*key/i,
  /anthropic.*key/i,
  /elevenlabs.*key/i,
  /stripe.*secret/i,
  /twilio.*auth/i,
];

interface SecurityCheckResult {
  isSecure: boolean;
  warnings: string[];
  errors: string[];
}

/**
 * Check for exposed secrets in environment variables
 * Should be called at app startup in __DEV__ mode
 */
export function checkForExposedSecrets(): SecurityCheckResult {
  const warnings: string[] = [];
  const errors: string[] = [];

  // Get all EXPO_PUBLIC_ variables (these are exposed to client)
  const exposedVars = Object.keys(process.env).filter(
    (key) => key.startsWith('EXPO_PUBLIC_')
  );

  // Check for forbidden prefixes
  for (const key of exposedVars) {
    const upperKey = key.toUpperCase();

    for (const forbidden of FORBIDDEN_PREFIXES) {
      if (upperKey.includes(forbidden)) {
        errors.push(
          `CRITICAL: ${key} contains forbidden pattern "${forbidden}" and is exposed to client!`
        );
      }
    }

    // Check for sensitive patterns
    for (const pattern of SENSITIVE_KEYS_PATTERNS) {
      if (pattern.test(key)) {
        warnings.push(
          `WARNING: ${key} matches sensitive pattern and should be moved to Edge Functions`
        );
      }
    }
  }

  // Check specifically for known sensitive Vibecode keys
  // Access each key statically to comply with Expo's no-dynamic-env-var rule
  const vibecodeSensitiveChecks = [
    { key: 'EXPO_PUBLIC_VIBECODE_OPENAI_API_KEY', value: process.env.EXPO_PUBLIC_VIBECODE_OPENAI_API_KEY },
    { key: 'EXPO_PUBLIC_VIBECODE_ANTHROPIC_API_KEY', value: process.env.EXPO_PUBLIC_VIBECODE_ANTHROPIC_API_KEY },
    { key: 'EXPO_PUBLIC_VIBECODE_ELEVENLABS_API_KEY', value: process.env.EXPO_PUBLIC_VIBECODE_ELEVENLABS_API_KEY },
    { key: 'EXPO_PUBLIC_VIBECODE_GROK_API_KEY', value: process.env.EXPO_PUBLIC_VIBECODE_GROK_API_KEY },
  ];

  for (const { key, value } of vibecodeSensitiveChecks) {
    if (value && value.length > 0 && value !== 'undefined') {
      warnings.push(
        `${key} is exposed in client bundle. Consider using Edge Functions as proxy.`
      );
    }
  }

  const isSecure = errors.length === 0;

  return {
    isSecure,
    warnings,
    errors,
  };
}

/**
 * Log security check results
 * Only logs in development mode
 */
export function logSecurityCheck(): void {
  if (!__DEV__) return;

  const result = checkForExposedSecrets();

  if (result.errors.length > 0) {
    console.error('\n🚨 SECURITY ERRORS DETECTED:');
    result.errors.forEach((err) => console.error(`  ❌ ${err}`));
  }

  if (result.warnings.length > 0) {
    console.warn('\n⚠️ Security Warnings:');
    result.warnings.forEach((warn) => console.warn(`  ⚠️ ${warn}`));
  }

  if (result.isSecure && result.warnings.length === 0) {
  }
}

/**
 * Validate that a value looks like an API key (for Edge Functions)
 * Does NOT expose the key - just checks format
 */
export function isValidApiKeyFormat(key: string | undefined): boolean {
  if (!key || typeof key !== 'string') return false;

  // Most API keys are at least 20 characters
  if (key.length < 20) return false;

  // Should not be a placeholder
  const placeholders = ['your-key-here', 'xxx', 'undefined', 'null', ''];
  if (placeholders.includes(key.toLowerCase())) return false;

  return true;
}

/**
 * Mask an API key for safe logging (shows only first/last 4 chars)
 */
export function maskApiKey(key: string | undefined): string {
  if (!key || key.length < 12) return '***';
  return `${key.slice(0, 4)}...${key.slice(-4)}`;
}
