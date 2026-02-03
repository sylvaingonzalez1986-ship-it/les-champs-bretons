/**
 * Rate Limiting Middleware - Les Chanvriers Unis
 *
 * Provides configurable rate limiting for Edge Functions with:
 * - Per-user rate limits
 * - Configurable windows and limits
 * - Security logging for excessive attempts
 *
 * @module rate-limit
 */

// =============================================================================
// TYPES
// =============================================================================

export interface RateLimitConfig {
  /** Maximum requests per window */
  limit: number;
  /** Window duration in milliseconds */
  windowMs: number;
  /** Identifier for the rate limit (e.g., 'openai', 'anthropic') */
  identifier: string;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
  retryAfterSeconds?: number;
}

interface RateLimitEntry {
  count: number;
  resetAt: number;
  blocked: boolean;
  lastAttempt: number;
}

// =============================================================================
// RATE LIMIT STORE
// =============================================================================

// In-memory store (per-instance)
// Note: In production with multiple instances, use Redis or Supabase
const rateLimitStore = new Map<string, RateLimitEntry>();

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const RATE_LIMIT_TABLE = Deno.env.get('RATE_LIMIT_TABLE') ?? 'rate_limits';
const PERSISTENT_RATE_LIMIT_ENABLED = Deno.env.get('RATE_LIMIT_PERSISTENT') === 'true';

// Cleanup old entries periodically (every 5 minutes)
const CLEANUP_INTERVAL = 5 * 60 * 1000;
let lastCleanup = Date.now();

function cleanupExpiredEntries(): void {
  const now = Date.now();
  if (now - lastCleanup < CLEANUP_INTERVAL) return;

  for (const [key, entry] of rateLimitStore.entries()) {
    if (now > entry.resetAt + 60000) { // Expired + 1 minute buffer
      rateLimitStore.delete(key);
    }
  }
  lastCleanup = now;
}

function canUsePersistentStore(): boolean {
  return PERSISTENT_RATE_LIMIT_ENABLED && Boolean(SUPABASE_URL && SERVICE_ROLE_KEY);
}

function getServiceHeaders(): Record<string, string> {
  return {
    'apikey': SERVICE_ROLE_KEY,
    'Authorization': `Bearer ${SERVICE_ROLE_KEY}`,
    'Content-Type': 'application/json',
  };
}

async function fetchPersistentEntry(key: string): Promise<RateLimitEntry | null> {
  const url = `${SUPABASE_URL}/rest/v1/${RATE_LIMIT_TABLE}?select=key,count,reset_at,blocked,last_attempt&key=eq.${encodeURIComponent(key)}&limit=1`;
  const response = await fetch(url, { headers: getServiceHeaders() });
  if (!response.ok) {
    return null;
  }
  const data = await response.json();
  if (!Array.isArray(data) || data.length === 0) {
    return null;
  }

  const entry = data[0];
  return {
    count: Number(entry.count ?? 0),
    resetAt: new Date(entry.reset_at).getTime(),
    blocked: Boolean(entry.blocked),
    lastAttempt: new Date(entry.last_attempt ?? entry.reset_at).getTime(),
  };
}

async function upsertPersistentEntry(key: string, entry: RateLimitEntry): Promise<void> {
  const url = `${SUPABASE_URL}/rest/v1/${RATE_LIMIT_TABLE}?on_conflict=key`;
  const payload = {
    key,
    count: entry.count,
    reset_at: new Date(entry.resetAt).toISOString(),
    blocked: entry.blocked,
    last_attempt: new Date(entry.lastAttempt).toISOString(),
    updated_at: new Date().toISOString(),
  };

  await fetch(url, {
    method: 'POST',
    headers: {
      ...getServiceHeaders(),
      'Prefer': 'resolution=merge-duplicates,return=representation',
    },
    body: JSON.stringify(payload),
  });
}

// =============================================================================
// PRESET CONFIGURATIONS
// =============================================================================

export const RATE_LIMIT_PRESETS = {
  /** AI API calls - moderate limit */
  AI_API: {
    limit: 30,
    windowMs: 60 * 1000, // 1 minute
    identifier: 'ai-api',
  },
  /** AI API calls - hourly limit */
  AI_API_HOURLY: {
    limit: 100,
    windowMs: 60 * 60 * 1000, // 1 hour
    identifier: 'ai-api-hourly',
  },
  /** Authentication attempts */
  AUTH: {
    limit: 5,
    windowMs: 15 * 60 * 1000, // 15 minutes
    identifier: 'auth',
  },
  /** Order creation */
  ORDERS: {
    limit: 10,
    windowMs: 60 * 1000, // 1 minute
    identifier: 'orders',
  },
  /** General API */
  GENERAL: {
    limit: 60,
    windowMs: 60 * 1000, // 1 minute
    identifier: 'general',
  },
  /** File uploads */
  UPLOADS: {
    limit: 20,
    windowMs: 60 * 1000, // 1 minute
    identifier: 'uploads',
  },
} as const;

// =============================================================================
// RATE LIMIT FUNCTION
// =============================================================================

/**
 * Check rate limit for a user
 *
 * @param userId - User identifier (UUID or IP)
 * @param config - Rate limit configuration
 * @returns Rate limit result
 */
export async function checkRateLimit(
  userId: string,
  config: RateLimitConfig
): Promise<RateLimitResult> {
  cleanupExpiredEntries();

  const now = Date.now();
  const key = `${config.identifier}:${userId}`;

  if (!canUsePersistentStore()) {
    const entry = rateLimitStore.get(key);

    if (!entry || now > entry.resetAt) {
      rateLimitStore.set(key, {
        count: 1,
        resetAt: now + config.windowMs,
        blocked: false,
        lastAttempt: now,
      });
      return {
        allowed: true,
        remaining: config.limit - 1,
        resetAt: now + config.windowMs,
      };
    }

    entry.lastAttempt = now;

    if (entry.count >= config.limit) {
      entry.blocked = true;
      const retryAfterSeconds = Math.ceil((entry.resetAt - now) / 1000);
      return {
        allowed: false,
        remaining: 0,
        resetAt: entry.resetAt,
        retryAfterSeconds,
      };
    }

    entry.count++;
    return {
      allowed: true,
      remaining: config.limit - entry.count,
      resetAt: entry.resetAt,
    };
  }

  try {
    const entry = await fetchPersistentEntry(key);

    if (!entry || now > entry.resetAt) {
      const newEntry: RateLimitEntry = {
        count: 1,
        resetAt: now + config.windowMs,
        blocked: false,
        lastAttempt: now,
      };
      await upsertPersistentEntry(key, newEntry);
      return {
        allowed: true,
        remaining: config.limit - 1,
        resetAt: newEntry.resetAt,
      };
    }

    entry.lastAttempt = now;

    if (entry.count >= config.limit) {
      entry.blocked = true;
      await upsertPersistentEntry(key, entry);
      const retryAfterSeconds = Math.ceil((entry.resetAt - now) / 1000);
      return {
        allowed: false,
        remaining: 0,
        resetAt: entry.resetAt,
        retryAfterSeconds,
      };
    }

    entry.count++;
    await upsertPersistentEntry(key, entry);
    return {
      allowed: true,
      remaining: config.limit - entry.count,
      resetAt: entry.resetAt,
    };
  } catch (error) {
    console.warn('[RateLimit] Persistent store error, falling back to memory:', error);
    rateLimitStore.delete(key);
    const fallbackEntry = rateLimitStore.get(key);

    if (!fallbackEntry || now > fallbackEntry.resetAt) {
      rateLimitStore.set(key, {
        count: 1,
        resetAt: now + config.windowMs,
        blocked: false,
        lastAttempt: now,
      });
      return {
        allowed: true,
        remaining: config.limit - 1,
        resetAt: now + config.windowMs,
      };
    }

    fallbackEntry.lastAttempt = now;
    if (fallbackEntry.count >= config.limit) {
      fallbackEntry.blocked = true;
      const retryAfterSeconds = Math.ceil((fallbackEntry.resetAt - now) / 1000);
      return {
        allowed: false,
        remaining: 0,
        resetAt: fallbackEntry.resetAt,
        retryAfterSeconds,
      };
    }

    fallbackEntry.count++;
    return {
      allowed: true,
      remaining: config.limit - fallbackEntry.count,
      resetAt: fallbackEntry.resetAt,
    };
  }
}

/**
 * Create rate limit headers for HTTP response
 */
export function createRateLimitHeaders(
  result: RateLimitResult,
  config: RateLimitConfig
): Record<string, string> {
  const headers: Record<string, string> = {
    'X-RateLimit-Limit': String(config.limit),
    'X-RateLimit-Remaining': String(result.remaining),
    'X-RateLimit-Reset': String(Math.ceil(result.resetAt / 1000)),
  };

  if (!result.allowed && result.retryAfterSeconds) {
    headers['Retry-After'] = String(result.retryAfterSeconds);
  }

  return headers;
}

/**
 * Create a rate limit exceeded error response
 */
export function createRateLimitResponse(
  result: RateLimitResult,
  config: RateLimitConfig,
  corsHeaders: Record<string, string>
): Response {
  return new Response(
    JSON.stringify({
      error: 'RATE_LIMIT_EXCEEDED',
      message: `Rate limit exceeded. Maximum ${config.limit} requests per ${Math.ceil(config.windowMs / 1000)} seconds.`,
      retryAfter: result.retryAfterSeconds,
      resetAt: new Date(result.resetAt).toISOString(),
    }),
    {
      status: 429,
      headers: {
        ...corsHeaders,
        ...createRateLimitHeaders(result, config),
        'Content-Type': 'application/json',
      },
    }
  );
}

// =============================================================================
// SECURITY LOGGING
// =============================================================================

export interface SecurityLogEntry {
  timestamp: string;
  userId: string;
  action: string;
  endpoint: string;
  ip?: string;
  userAgent?: string;
  success: boolean;
  reason?: string;
}

const securityLogs: SecurityLogEntry[] = [];
const MAX_SECURITY_LOGS = 1000;

/**
 * Log a security event (rate limit violation, validation failure, etc.)
 */
export function logSecurityEvent(entry: Omit<SecurityLogEntry, 'timestamp'>): void {
  const logEntry: SecurityLogEntry = {
    ...entry,
    timestamp: new Date().toISOString(),
  };

  securityLogs.push(logEntry);

  // Keep only recent logs in memory
  if (securityLogs.length > MAX_SECURITY_LOGS) {
    securityLogs.shift();
  }

  // Console log for monitoring
  const prefix = entry.success ? '[SECURITY]' : '[SECURITY ALERT]';
  console.log(`${prefix} ${entry.action} - User: ${entry.userId} - ${entry.reason || 'OK'}`);
}

/**
 * Get recent security logs (for admin monitoring)
 */
export function getSecurityLogs(limit = 100): SecurityLogEntry[] {
  return securityLogs.slice(-limit);
}
