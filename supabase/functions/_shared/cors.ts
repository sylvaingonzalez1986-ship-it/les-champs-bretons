/**
 * CORS Headers - Les Chanvriers Unis
 *
 * Shared CORS configuration for all Edge Functions
 */

const DEFAULT_ALLOW_HEADERS = 'authorization, x-client-info, apikey, content-type';
const DEFAULT_ALLOW_METHODS = 'GET, POST, PUT, PATCH, DELETE, OPTIONS';

const securityHeaders = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Permissions-Policy': 'interest-cohort=()',
  'Cross-Origin-Resource-Policy': 'same-site',
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
};

function parseAllowlist(value?: string | null): string[] {
  if (!value) return [];
  return value
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}

export function buildCorsHeaders(origin?: string): Record<string, string> {
  const allowlist = parseAllowlist(Deno.env.get('CORS_ALLOWLIST'));
  const allowOrigin = allowlist.length === 0
    ? '*'
    : (origin && allowlist.includes(origin) ? origin : 'null');

  const varyHeader = allowlist.length > 0 ? { Vary: 'Origin' } : {};

  return {
    ...securityHeaders,
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Headers': DEFAULT_ALLOW_HEADERS,
    'Access-Control-Allow-Methods': DEFAULT_ALLOW_METHODS,
    'Access-Control-Max-Age': '86400',
    ...varyHeader,
  };
}

export function getCorsHeaders(req?: Request): Record<string, string> {
  const origin = req?.headers?.get('origin') ?? undefined;
  return buildCorsHeaders(origin);
}

export const corsHeaders = buildCorsHeaders();
