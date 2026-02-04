/**
 * Public Catalog Edge Function
 *
 * Provides read-only catalog access with server-side validation and rate limiting.
 * Used by public catalog screens to avoid direct REST queries from the client.
 */

import { serve } from 'https://deno.land/std@0.208.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.38.0';
import { z } from 'https://deno.land/x/zod@v3.22.4/mod.ts';

// =============================================================================
// CORS (local copy to avoid bundler issues with _shared)
// =============================================================================

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

function isOriginAllowed(origin?: string | null): boolean {
  if (!origin) return true;
  const allowlist = parseAllowlist(Deno.env.get('CORS_ALLOWLIST'));
  if (allowlist.length === 0) return false;
  return allowlist.includes(origin);
}

function buildCorsHeaders(origin?: string): Record<string, string> {
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

function getCorsHeaders(req?: Request): Record<string, string> {
  const origin = req?.headers?.get('origin') ?? undefined;
  return buildCorsHeaders(origin);
}

// =============================================================================
// RATE LIMIT (local copy to avoid bundler issues with _shared)
// =============================================================================

const rateLimitStore = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT = { limit: 60, windowMs: 60 * 1000, identifier: 'public-catalog' };

function checkRateLimit(key: string): { allowed: boolean; remaining: number; resetAt: number } {
  const now = Date.now();
  const entry = rateLimitStore.get(key);

  if (!entry || now > entry.resetAt) {
    rateLimitStore.set(key, { count: 1, resetAt: now + RATE_LIMIT.windowMs });
    return { allowed: true, remaining: RATE_LIMIT.limit - 1, resetAt: now + RATE_LIMIT.windowMs };
  }

  if (entry.count >= RATE_LIMIT.limit) {
    return { allowed: false, remaining: 0, resetAt: entry.resetAt };
  }

  entry.count += 1;
  return { allowed: true, remaining: RATE_LIMIT.limit - entry.count, resetAt: entry.resetAt };
}

function createRateLimitResponse(result: { resetAt: number }, headers: Record<string, string>): Response {
  const retryAfterSeconds = Math.ceil((result.resetAt - Date.now()) / 1000);
  return new Response(
    JSON.stringify({
      error: 'RATE_LIMITED',
      message: 'Too many requests',
      retryAfterSeconds,
    }),
    {
      status: 429,
      headers: {
        ...headers,
        'Content-Type': 'application/json',
        'Retry-After': `${retryAfterSeconds}`,
      },
    }
  );
}

// =============================================================================
// VALIDATION SCHEMA
// =============================================================================

const uuidSchema = z.string().uuid('Invalid UUID format');

const publicCatalogSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('producers'),
    limit: z.coerce.number().int().min(1).max(50).default(20),
    offset: z.coerce.number().int().min(0).default(0),
  }),
  z.object({
    action: z.literal('productsByProducer'),
    producerId: uuidSchema,
    limit: z.coerce.number().int().min(1).max(50).default(20),
    offset: z.coerce.number().int().min(0).default(0),
  }),
]);

type PublicCatalogInput = z.infer<typeof publicCatalogSchema>;

// =============================================================================
// MAIN HANDLER
// =============================================================================

serve(async (req: Request): Promise<Response> => {
  const responseCorsHeaders = getCorsHeaders(req);
  const origin = req.headers.get('Origin');

  if (!isOriginAllowed(origin)) {
    return new Response(JSON.stringify({ error: 'FORBIDDEN', message: 'Invalid origin' }), {
      status: 403,
      headers: { ...responseCorsHeaders, 'Content-Type': 'application/json' },
    });
  }

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: responseCorsHeaders });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
  if (!supabaseUrl || !supabaseAnonKey) {
    return new Response(JSON.stringify({ error: 'SERVER_ERROR', message: 'Supabase not configured' }), {
      status: 500,
      headers: { ...responseCorsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const authHeader = req.headers.get('Authorization') ?? undefined;
  const supabase = createClient(
    supabaseUrl,
    supabaseAnonKey,
    authHeader ? { global: { headers: { Authorization: authHeader } } } : undefined
  );

  const ip = req.headers.get('x-forwarded-for')?.split(',')[0] || 'unknown';
  let rateLimitKey = ip;

  if (authHeader) {
    const { data } = await supabase.auth.getUser();
    if (data?.user?.id) {
      rateLimitKey = data.user.id;
    }
  }

  const rateLimitResult = checkRateLimit(`${RATE_LIMIT.identifier}:${rateLimitKey}`);
  if (!rateLimitResult.allowed) {
    return createRateLimitResponse(rateLimitResult, responseCorsHeaders);
  }

  let body: unknown;
  try {
    const url = new URL(req.url);
    body = Object.fromEntries(url.searchParams.entries());
  } catch {
    return new Response(JSON.stringify({ error: 'PARSE_ERROR', message: 'Invalid query' }), {
      status: 400,
      headers: { ...responseCorsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const validation = publicCatalogSchema.safeParse(body);
  if (!validation.success) {
    return new Response(
      JSON.stringify({
        error: 'VALIDATION_ERROR',
        message: 'Request validation failed',
        details: validation.error.errors.map((err) => ({
          path: err.path.join('.'),
          message: err.message,
        })),
      }),
      {
        status: 400,
        headers: { ...responseCorsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }

  const data: PublicCatalogInput = validation.data;

  try {
    if (data.action === 'producers') {
      const limit = data.limit ?? 20;
      const offset = data.offset ?? 0;

      const { data: productsData, error: productsError } = await supabase
        .from('products')
        .select('producer_id')
        .eq('disponible_vente_directe', true)
        .eq('status', 'published')
        .range(offset, offset + limit - 1);

      if (productsError) {
        return new Response(
          JSON.stringify({ error: 'CATALOG_ERROR', message: productsError.message }),
          { status: 500, headers: { ...responseCorsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const producerIds = Array.from(
        new Set((productsData || []).map((p) => p.producer_id).filter(Boolean))
      ) as string[];

      if (producerIds.length === 0) {
        return new Response(
          JSON.stringify({ producers: [], hasMore: false }),
          { status: 200, headers: { ...responseCorsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const { data: producersData, error: producersError } = await supabase
        .from('producers')
        .select(
          'id,name,city,region,department,image,vente_directe_ferme,adresse_retrait,horaires_retrait,instructions_retrait,soil_type,climate_type,culture_outdoor,culture_greenhouse,culture_indoor,profile_id,profile:profiles(company_name,business_name)'
        )
        .in('id', producerIds)
        .order('name', { ascending: true });

      if (producersError) {
        return new Response(
          JSON.stringify({ error: 'CATALOG_ERROR', message: producersError.message }),
          { status: 500, headers: { ...responseCorsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const { data: productsForProducers, error: productsForProducersError } = await supabase
        .from('products')
        .select('id,name,price_public,price_pro,image,description,producer_id,disponible_vente_directe,stock,price_tiers')
        .in('producer_id', producerIds)
        .eq('disponible_vente_directe', true)
        .eq('status', 'published');

      if (productsForProducersError) {
        return new Response(
          JSON.stringify({ error: 'CATALOG_ERROR', message: productsForProducersError.message }),
          { status: 500, headers: { ...responseCorsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const productsByProducer = new Map<string, unknown[]>();
      (productsForProducers || []).forEach((product) => {
        const list = productsByProducer.get(product.producer_id) ?? [];
        list.push(product);
        productsByProducer.set(product.producer_id, list);
      });

      const producers = (producersData || []).map((producer) => ({
        ...producer,
        products: productsByProducer.get(producer.id) ?? [],
      }));

      return new Response(
        JSON.stringify({
          producers,
          hasMore: (productsData || []).length === limit,
        }),
        {
          status: 200,
          headers: {
            ...responseCorsHeaders,
            'Content-Type': 'application/json',
            'Cache-Control': 'public, max-age=60, s-maxage=300, stale-while-revalidate=300',
            'X-Cache-Policy': 'catalog-short-ttl',
          },
        }
      );
    }

    if (data.action === 'productsByProducer') {
      const limit = data.limit ?? 20;
      const offset = data.offset ?? 0;

      const { data: products, error: productsError } = await supabase
        .from('products')
        .select(
          'id,name,price_public,price_pro,description,image,stock,cbd_percent,thc_percent,disponible_vente_directe,price_tiers,producer:producers(id,name,city,region,adresse_retrait,horaires_retrait,instructions_retrait)'
        )
        .eq('producer_id', data.producerId)
        .eq('disponible_vente_directe', true)
        .eq('status', 'published')
        .order('name', { ascending: true })
        .range(offset, offset + limit - 1);

      if (productsError) {
        return new Response(
          JSON.stringify({ error: 'CATALOG_ERROR', message: productsError.message }),
          { status: 500, headers: { ...responseCorsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const producer = products && products.length > 0 ? (products[0] as any).producer ?? null : null;

      return new Response(
        JSON.stringify({
          products: products || [],
          producer,
          hasMore: (products || []).length === limit,
        }),
        {
          status: 200,
          headers: {
            ...responseCorsHeaders,
            'Content-Type': 'application/json',
            'Cache-Control': 'public, max-age=60, s-maxage=300, stale-while-revalidate=300',
            'X-Cache-Policy': 'catalog-short-ttl',
          },
        }
      );
    }

    return new Response(
      JSON.stringify({ error: 'INVALID_ACTION', message: 'Unknown action' }),
      { status: 400, headers: { ...responseCorsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('[public-catalog] Error:', error);
    return new Response(
      JSON.stringify({ error: 'INTERNAL_ERROR', message: 'Unexpected error' }),
      { status: 500, headers: { ...responseCorsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
