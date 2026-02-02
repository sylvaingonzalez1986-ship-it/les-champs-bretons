# Performance Fixes Quick Reference Guide
**Priority Implementation Order for Les Chanvriers**

---

## CRITICAL FIX #1: N+1 Query in Cart Enrichment
**Impact:** 8x performance improvement (2.5s → 300ms)
**File:** `c:\app-chanvriers\src\lib\direct-sales-cart.ts`

### Current Code (Lines 76-116):
```typescript
// BAD: Makes 2N+1 HTTP requests for N cart items
const enrichedItems: DirectSalesCartItem[] = await Promise.all(
  data.map(async (item: any) => {
    // N queries for products
    const productResponse = await fetch(
      `${SUPABASE_URL}/rest/v1/products?id=eq.${item.product_id}&select=name,price_public,image`,
      { headers }
    );
    const product = await productResponse.json();

    // N queries for producers
    const producerResponse = await fetch(
      `${SUPABASE_URL}/rest/v1/producers?id=eq.${item.producer_id}&select=name`,
      { headers }
    );
    const producer = await producerResponse.json();

    return { ...item, product_name: product[0]?.name, ... };
  })
);
```

### Fixed Code:
```typescript
// GOOD: Makes 1 HTTP request using Supabase foreign key expansion
const response = await fetch(
  `${SUPABASE_URL}/rest/v1/panier_vente_directe?user_id=eq.${userId}&order=created_at.desc&select=*,` +
  `product:products(id,name,price_public,image),` +
  `producer:producers(id,name)`,
  { headers }
);

const data = await response.json();

// Data structure changes: item.product is now nested object
const enrichedItems = data.map((item: any) => ({
  id: item.id,
  product_id: item.product_id,
  producer_id: item.producer_id,
  producer_name: item.producer?.name || 'Unknown',
  product_name: item.product?.name || 'Unknown',
  price: item.product?.price_public || 0,
  quantity: item.quantity,
  image: item.product?.image || '',
  created_at: item.created_at,
}));
```

### Testing:
```bash
# Before fix: Load cart with 20 items
time curl "https://your-project.supabase.co/rest/v1/panier_vente_directe?user_id=eq.USER_ID"
# Expected: ~2.5 seconds (41 requests)

# After fix: Load cart with foreign key expansion
time curl "https://your-project.supabase.co/rest/v1/panier_vente_directe?user_id=eq.USER_ID&select=*,product:products(*),producer:producers(*)"
# Expected: ~300ms (1 request)
```

---

## CRITICAL FIX #2: Add Pagination to Catalog
**Impact:** Prevents memory crashes, enables infinite scroll
**Files:** `c:\app-chanvriers\src\lib\supabase-sync.catalog.ts`

### Current Code (Line 118):
```typescript
// BAD: Fetches ALL producers (no limit)
export async function fetchProducers(): Promise<SupabaseProducer[]> {
  const response = await supabaseFetch(
    `${SUPABASE_URL}/rest/v1/producers?select=*,profile:profiles(company_name,business_name)&order=name.asc`,
    { method: 'GET', headers: getHeaders() }
  );
  return response.json();
}
```

### Fixed Code (Cursor-based pagination):
```typescript
// GOOD: Fetch producers with pagination
export async function fetchProducers(options?: {
  limit?: number;
  offset?: number;
  cursor?: string;
}): Promise<{ producers: SupabaseProducer[]; nextCursor: string | null }> {
  const limit = options?.limit || 20;
  const offset = options?.offset || 0;

  const response = await supabaseFetch(
    `${SUPABASE_URL}/rest/v1/producers?select=*,profile:profiles(company_name,business_name)&order=name.asc&limit=${limit}&offset=${offset}`,
    { method: 'GET', headers: getHeaders() }
  );

  const producers = await response.json();

  // Determine if there are more results
  const hasMore = producers.length === limit;
  const nextCursor = hasMore ? `${offset + limit}` : null;

  return { producers, nextCursor };
}
```

### React Query Integration:
```typescript
// In your component using producers
import { useInfiniteQuery } from '@tanstack/react-query';

const {
  data,
  fetchNextPage,
  hasNextPage,
  isFetchingNextPage,
} = useInfiniteQuery({
  queryKey: ['producers'],
  queryFn: ({ pageParam = 0 }) => fetchProducers({ limit: 20, offset: pageParam }),
  initialPageParam: 0,
  getNextPageParam: (lastPage) => lastPage.nextCursor,
});

// Flatten pages into single array
const allProducers = data?.pages.flatMap(page => page.producers) ?? [];
```

### Apply to:
- `fetchProducers()` - Line 118
- `fetchProducts()` - Line 337
- `fetchOrders()` - Line 140 in `supabase-sync.orders.ts`
- `fetchChatMessages()` - Line 88 in `supabase-sync.chat.ts` (already has limit, add cursor)

---

## CRITICAL FIX #3: Rate Limiting for Edge Functions
**Impact:** Prevents abuse, protects infrastructure
**Files:** Create `c:\app-chanvriers\supabase\functions\_shared\rate-limit.ts`

### New File: `supabase/functions/_shared/rate-limit.ts`
```typescript
/**
 * Rate Limiting Middleware for Supabase Edge Functions
 * Uses Upstash Redis for distributed rate limiting
 *
 * Install: npm install @upstash/ratelimit @upstash/redis
 */

import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';

// Initialize Redis client
const redis = new Redis({
  url: Deno.env.get('UPSTASH_REDIS_REST_URL')!,
  token: Deno.env.get('UPSTASH_REDIS_REST_TOKEN')!,
});

// Create rate limiters for different tiers
const rateLimiters = {
  // Standard rate limit: 10 requests per minute
  standard: new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(10, '1 m'),
    analytics: true,
  }),

  // Strict rate limit for sensitive operations: 5 per minute
  strict: new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(5, '1 m'),
    analytics: true,
  }),

  // Generous rate limit for reads: 100 per minute
  generous: new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(100, '1 m'),
    analytics: true,
  }),
};

export type RateLimitTier = 'standard' | 'strict' | 'generous';

/**
 * Check rate limit for a request
 * @param request - Incoming request object
 * @param tier - Rate limit tier to apply
 * @returns Response if rate limited, null if allowed
 */
export async function checkRateLimit(
  request: Request,
  tier: RateLimitTier = 'standard'
): Promise<Response | null> {
  // Extract identifier (user ID from JWT or IP address)
  const authHeader = request.headers.get('Authorization');
  let identifier = request.headers.get('x-forwarded-for') || 'anonymous';

  if (authHeader && authHeader.startsWith('Bearer ')) {
    try {
      const token = authHeader.replace('Bearer ', '');
      // Decode JWT to get user ID (simplified - use proper JWT library)
      const payload = JSON.parse(atob(token.split('.')[1]));
      identifier = payload.sub || identifier;
    } catch {
      // Invalid JWT, use IP
    }
  }

  // Check rate limit
  const limiter = rateLimiters[tier];
  const { success, limit, remaining, reset } = await limiter.limit(identifier);

  if (!success) {
    const resetDate = new Date(reset);
    return new Response(
      JSON.stringify({
        error: 'Rate limit exceeded',
        message: `Too many requests. Try again at ${resetDate.toISOString()}`,
        limit,
        remaining,
        reset: reset,
      }),
      {
        status: 429,
        headers: {
          'Content-Type': 'application/json',
          'X-RateLimit-Limit': limit.toString(),
          'X-RateLimit-Remaining': remaining.toString(),
          'X-RateLimit-Reset': reset.toString(),
          'Retry-After': Math.ceil((reset - Date.now()) / 1000).toString(),
        },
      }
    );
  }

  // Rate limit passed, add headers to response
  return null;
}

/**
 * Wrapper for Edge Functions with automatic rate limiting
 */
export function withRateLimit(
  handler: (req: Request) => Promise<Response>,
  tier: RateLimitTier = 'standard'
) {
  return async (req: Request): Promise<Response> => {
    // Check rate limit
    const rateLimitResponse = await checkRateLimit(req, tier);
    if (rateLimitResponse) {
      return rateLimitResponse;
    }

    // Proceed with handler
    return handler(req);
  };
}
```

### Apply to Edge Function:
```typescript
// Example: supabase/functions/create-direct-sale-orders/index.ts
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { withRateLimit } from '../_shared/rate-limit.ts';

async function handleRequest(req: Request): Promise<Response> {
  // Your existing logic here
  return new Response(JSON.stringify({ success: true }), {
    headers: { 'Content-Type': 'application/json' },
  });
}

// Wrap handler with rate limiting
serve(withRateLimit(handleRequest, 'strict'));
```

### Alternative: Supabase-native rate limiting (no external Redis)
```typescript
// supabase/functions/_shared/rate-limit-native.ts
// Uses Supabase database for rate limiting (less performant but no external deps)

interface RateLimitEntry {
  identifier: string;
  count: number;
  window_start: string;
}

export async function checkRateLimitNative(
  supabaseAdmin: any,
  identifier: string,
  limit: number = 10,
  windowMs: number = 60000
): Promise<boolean> {
  const now = new Date();
  const windowStart = new Date(now.getTime() - windowMs);

  // Atomic increment in database
  const { data, error } = await supabaseAdmin
    .rpc('increment_rate_limit', {
      p_identifier: identifier,
      p_window_start: windowStart.toISOString(),
      p_limit: limit,
    });

  if (error) {
    console.error('Rate limit check failed:', error);
    return true; // Allow request on error (fail open)
  }

  return data.count <= limit;
}
```

```sql
-- SQL function for atomic rate limiting
-- Run in Supabase SQL Editor
CREATE TABLE IF NOT EXISTS rate_limits (
  identifier TEXT PRIMARY KEY,
  count INTEGER DEFAULT 0,
  window_start TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_rate_limits_window ON rate_limits(window_start);

CREATE OR REPLACE FUNCTION increment_rate_limit(
  p_identifier TEXT,
  p_window_start TIMESTAMPTZ,
  p_limit INTEGER
) RETURNS TABLE(count INTEGER) AS $$
BEGIN
  -- Clean up old entries
  DELETE FROM rate_limits WHERE window_start < p_window_start;

  -- Insert or update rate limit entry
  INSERT INTO rate_limits (identifier, count, window_start)
  VALUES (p_identifier, 1, p_window_start)
  ON CONFLICT (identifier) DO UPDATE
  SET count = rate_limits.count + 1,
      updated_at = now()
  WHERE rate_limits.window_start >= p_window_start;

  RETURN QUERY SELECT rate_limits.count FROM rate_limits WHERE identifier = p_identifier;
END;
$$ LANGUAGE plpgsql;
```

---

## HIGH PRIORITY FIX #1: Optimize WebSocket Chat
**Impact:** Reduces connection overhead by 50%
**File:** `c:\app-chanvriers\src\lib\supabase-sync.chat.ts`

### Current Code (Lines 220-342):
```typescript
// BAD: Manual WebSocket management
function connectWebSocket(): void {
  const wsUrl = SUPABASE_URL.replace('https://', 'wss://');
  const realtimeUrl = `${wsUrl}/realtime/v1/websocket?apikey=${SUPABASE_ANON_KEY}`;
  realtimeSocket = new WebSocket(realtimeUrl);

  realtimeSocket.onopen = () => {
    // Manual join message
    const joinMessage = { topic: 'realtime:public:chat_messages', ... };
    realtimeSocket.send(JSON.stringify(joinMessage));

    // Manual heartbeat
    heartbeatInterval = setInterval(() => { ... }, 30000);
  };
}
```

### Fixed Code (Use Supabase Realtime client):
```typescript
// GOOD: Use Supabase Realtime client with connection pooling
import { createClient } from '@supabase/supabase-js';

// Create Supabase client (singleton)
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

export function subscribeToMessages(callback: (message: ChatMessage) => void): () => void {
  // Subscribe to changes
  const channel = supabase
    .channel('chat-room')
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'chat_messages',
      },
      (payload) => {
        const message = supabaseToChatMessage(payload.new as SupabaseChatMessage);
        callback(message);
      }
    )
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        setConnectionStatus('connected');
      } else if (status === 'CHANNEL_ERROR') {
        setConnectionStatus('error');
      }
    });

  // Return cleanup function
  return () => {
    supabase.removeChannel(channel);
  };
}
```

### Benefits:
- Automatic connection pooling (multiple subscriptions share 1 WebSocket)
- Built-in reconnection with exponential backoff
- Proper cleanup and memory management
- Better error handling

---

## HIGH PRIORITY FIX #2: Add Catalog Caching
**Impact:** Cold start improvement 1.2s → 500ms
**Files:** Components using catalog data

### React Query Configuration:
```typescript
// Update your QueryClient configuration
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Cache catalog data for 10 minutes
      staleTime: 1000 * 60 * 10,
      // Keep in memory for 1 hour
      gcTime: 1000 * 60 * 60,
      // Refetch in background when component mounts
      refetchOnMount: 'always',
      // Don't refetch on window focus (mobile doesn't have windows)
      refetchOnWindowFocus: false,
      // Retry failed requests 3 times
      retry: 3,
      // Exponential backoff
      retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 30000),
    },
  },
});
```

### Add ETag Support to Edge Functions:
```typescript
// supabase/functions/_shared/etag.ts
import { createHash } from 'https://deno.land/std@0.177.0/hash/mod.ts';

export function generateETag(data: any): string {
  const hash = createHash('md5');
  hash.update(JSON.stringify(data));
  return `"${hash.toString()}"`;
}

export function checkETag(req: Request, data: any): Response | null {
  const etag = generateETag(data);
  const clientETag = req.headers.get('If-None-Match');

  if (clientETag === etag) {
    return new Response(null, {
      status: 304,
      headers: {
        'ETag': etag,
        'Cache-Control': 'public, max-age=600', // 10 minutes
      },
    });
  }

  return null;
}

// Usage in Edge Function
import { checkETag, generateETag } from '../_shared/etag.ts';

serve(async (req) => {
  const producers = await fetchProducers();

  // Check if client has cached version
  const notModifiedResponse = checkETag(req, producers);
  if (notModifiedResponse) {
    return notModifiedResponse;
  }

  // Return fresh data with ETag
  return new Response(JSON.stringify(producers), {
    headers: {
      'Content-Type': 'application/json',
      'ETag': generateETag(producers),
      'Cache-Control': 'public, max-age=600',
    },
  });
});
```

---

## HIGH PRIORITY FIX #3: Parallelize Image Uploads
**Impact:** 5 images: 25s → 8s (3x faster)
**File:** `c:\app-chanvriers\src\lib\supabase-product-images.ts`

### Current Code (Lines 108-126):
```typescript
// BAD: Sequential uploads
export async function uploadMultipleProductImages(
  fileUris: string[],
  producerId: string,
  productId: string
): Promise<string[]> {
  const urls: string[] = [];

  for (const uri of fileUris) {
    try {
      const url = await uploadProductImage(uri, producerId, productId);
      urls.push(url);
    } catch (error) {
      console.warn('[ProductImages] Error uploading image:', error);
    }
  }

  return urls;
}
```

### Fixed Code (Parallel with concurrency limit):
```typescript
// GOOD: Parallel uploads with concurrency control
export async function uploadMultipleProductImages(
  fileUris: string[],
  producerId: string,
  productId: string,
  maxConcurrent: number = 3
): Promise<string[]> {
  const results: string[] = [];
  const errors: string[] = [];

  // Process uploads in batches of maxConcurrent
  for (let i = 0; i < fileUris.length; i += maxConcurrent) {
    const batch = fileUris.slice(i, i + maxConcurrent);

    // Upload batch in parallel
    const batchResults = await Promise.allSettled(
      batch.map((uri) => uploadProductImage(uri, producerId, productId))
    );

    // Collect results
    batchResults.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        results.push(result.value);
      } else {
        const uri = batch[index];
        errors.push(uri);
        console.warn(`[ProductImages] Failed to upload ${uri}:`, result.reason);
      }
    });
  }

  // Retry failed uploads once
  if (errors.length > 0) {
    console.log(`[ProductImages] Retrying ${errors.length} failed uploads...`);
    const retryResults = await Promise.allSettled(
      errors.map((uri) => uploadProductImage(uri, producerId, productId))
    );

    retryResults.forEach((result) => {
      if (result.status === 'fulfilled') {
        results.push(result.value);
      }
    });
  }

  return results;
}
```

---

## MEDIUM PRIORITY: Database Optimization
**Impact:** Producer order queries 1.8s → 200ms
**Requires:** Database schema migration

### Option 1: Add GIN Index (Quick fix)
```sql
-- Run in Supabase SQL Editor
-- Add GIN index for JSON containment queries
CREATE INDEX idx_orders_items_gin ON orders USING gin(items);

-- Analyze query performance
EXPLAIN ANALYZE
SELECT * FROM orders
WHERE items @> '[{"producer_id": "test-producer-1"}]'
ORDER BY created_at DESC
LIMIT 50;
```

### Option 2: Migrate to Junction Table (Recommended)
```sql
-- Step 1: Create junction table
CREATE TABLE order_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID REFERENCES orders(id) ON DELETE CASCADE,
  product_id UUID REFERENCES products(id),
  producer_id UUID REFERENCES producers(id),
  quantity INTEGER NOT NULL,
  unit_price DECIMAL(10,2) NOT NULL,
  total_price DECIMAL(10,2) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Step 2: Add indexes
CREATE INDEX idx_order_items_order ON order_items(order_id);
CREATE INDEX idx_order_items_producer ON order_items(producer_id);
CREATE INDEX idx_order_items_product ON order_items(product_id);

-- Step 3: Migrate existing data
INSERT INTO order_items (order_id, product_id, producer_id, quantity, unit_price, total_price)
SELECT
  o.id,
  (item->>'product_id')::UUID,
  (item->>'producer_id')::UUID,
  (item->>'quantity')::INTEGER,
  (item->>'unit_price')::DECIMAL,
  (item->>'total_price')::DECIMAL
FROM orders o, jsonb_array_elements(o.items) AS item;

-- Step 4: Update RLS policies
ALTER TABLE order_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own order items"
  ON order_items FOR SELECT
  USING (
    order_id IN (
      SELECT id FROM orders WHERE customer_id = auth.uid()
    )
  );

-- Step 5: Update queries in code
-- Before:
-- SELECT * FROM orders WHERE items @> '[{"producer_id": "abc"}]';

-- After:
-- SELECT DISTINCT o.* FROM orders o
-- JOIN order_items oi ON oi.order_id = o.id
-- WHERE oi.producer_id = 'abc'
-- ORDER BY o.created_at DESC;
```

---

## Testing Checklist

After implementing fixes:

- [ ] Run k6 baseline test: `k6 run load-tests/k6-baseline.js`
- [ ] Verify cart enrichment <500ms (was 2.5s)
- [ ] Verify catalog load <200ms (was 800ms)
- [ ] Run Artillery flash sale: `artillery run load-tests/artillery-flash-sale.yml`
- [ ] Verify order creation success rate >95%
- [ ] Run Locust producer dashboard: `locust -f load-tests/locust-producer-dashboard.py`
- [ ] Verify no slow queries (>1s)
- [ ] Check Supabase Dashboard > Database > Query Performance
- [ ] Monitor error rate <0.5%

---

## Performance Targets

| Metric | Before | Target | Achieved |
|--------|--------|--------|----------|
| Cold Start (P95) | 1.2s | 500ms | ⬜ |
| Catalog Load (P95) | 800ms | 200ms | ⬜ |
| Cart Enrichment (P95) | 2.5s | 300ms | ⬜ |
| Order Creation (P95) | 1.5s | 500ms | ⬜ |
| Producer Query (P95) | 1.8s | 200ms | ⬜ |
| Error Rate | 2-5% | <0.5% | ⬜ |
| Concurrent Users | 50-100 | 500+ | ⬜ |

---

## Next Steps

1. **Week 1:** Implement Critical Fixes (#1-#3)
2. **Week 2:** Implement High Priority Fixes + Load Testing
3. **Week 3:** Database optimization + Migration
4. **Week 4:** Final validation + Production deployment

---

**Last Updated:** 2026-02-02
**See Also:**
- `LOAD_TESTING_STRATEGY.md` - Complete strategy document
- `load-tests/README.md` - Load testing instructions
- Database optimization guide (to be created)
