# Load Testing Strategy - Les Chanvriers Mobile App
**Date:** 2026-02-02
**Application:** React Native + Expo + Supabase Backend
**Focus:** Real-world user scenarios, API performance, and infrastructure scalability

---

## Executive Summary

This React Native mobile application has **critical performance bottlenecks** that will impact user experience under moderate load. The most concerning issues are:

1. **N+1 queries in cart enrichment** (1 product + 1 producer fetch per item = 2N queries)
2. **Lack of pagination** in chat, orders, and product fetches
3. **Missing rate limiting** on WebSocket connections and Edge Functions
4. **No caching strategy** for producer/product catalog data
5. **Sequential retry logic** that amplifies latency under network issues
6. **Inefficient real-time subscriptions** (WebSocket per user, no connection pooling)

**Estimated Breaking Point:** 50-100 concurrent users with current architecture.
**Recommended Target:** Support 500+ concurrent users with optimizations outlined below.

---

## 1. Current Architecture Analysis

### 1.1 Technology Stack
```
Frontend:
- React Native 0.79.6 + Expo SDK 53
- React Query 5.90.2 (server state management)
- Zustand 5.0.9 (local state persistence)
- Native networking (fetch API with retry wrapper)

Backend:
- Supabase (PostgreSQL + REST API + Edge Functions + Realtime)
- Edge Functions: Deno runtime
- Storage: Supabase Storage for images
- Auth: Supabase GoTrue with JWT tokens
```

### 1.2 Key API Patterns Identified

#### Authentication (`src/lib/supabase-auth.ts`)
```typescript
// GOOD: Rate limiting implemented (5 attempts per 60s)
- signIn: Rate limited ✓
- signUp: Rate limited ✓
- resetPassword: Rate limited ✓
- magicLink: Rate limited ✓

// CONCERN: In-memory rate limiting = bypassed on app restart
- rateLimitStore: Map<string, RateLimitEntry>
  → Should use Redis/Supabase for distributed state
```

**Load Test Focus:** Brute force attack simulation, concurrent login spikes.

#### Data Fetching (`src/lib/supabase-sync-*.ts`)
```typescript
// CRITICAL ISSUE: No pagination
fetchProducers(): Promise<SupabaseProducer[]>
fetchProducts(): Promise<SupabaseProduct[]>
fetchChatMessages(limit=50): Promise<ChatMessage[]>

// GOOD: Uses authenticated headers for security
// BAD: No cursor-based pagination for infinite scroll
```

**Load Test Focus:** Large dataset retrieval (1000+ products), memory consumption.

#### Cart Enrichment (`src/lib/direct-sales-cart.ts`)
```typescript
// CRITICAL N+1 QUERY PROBLEM:
loadCart: async (userId, accessToken) => {
  const cartItems = await fetch('/panier_vente_directe?user_id=eq.${userId}');

  // For each item, fetch product AND producer separately
  const enrichedItems = await Promise.all(
    cartItems.map(async (item) => {
      const product = await fetch(`/products?id=eq.${item.product_id}`); // N queries
      const producer = await fetch(`/producers?id=eq.${item.producer_id}`); // N queries
      return { ...item, product, producer };
    })
  );
}

// SOLUTION: Use Supabase foreign key select expansion:
// /panier_vente_directe?select=*,product:products(*),producer:producers(*)
```

**Load Test Focus:** Cart load with 20+ items (= 41 HTTP requests instead of 1).

#### Real-Time Chat (`src/lib/supabase-sync.chat.ts`)
```typescript
// CONCERN: WebSocket connection per user
subscribeToMessages(callback) {
  realtimeSocket = new WebSocket(REALTIME_URL);
  // Heartbeat every 30s
  // Exponential backoff on reconnect (max 10 attempts)
}

// GOOD: Offline message queue
// GOOD: Connection state management with auto-reconnect

// BAD: No rate limiting on message sends
sendChatMessage() → No throttling/debouncing
```

**Load Test Focus:** 100 concurrent users sending messages, WebSocket connection overhead.

#### Order Processing (`src/lib/supabase-sync.orders.ts`)
```typescript
// GOOD: Uses Edge Functions for mutations
createOrders() → POST /functions/v1/create-direct-sale-orders

// GOOD: RLS policies enforced server-side
// BAD: No order queue for offline mode (only cart is queued)

// PERFORMANCE RISK: JSON containment operator for producer filtering
fetchOrdersForProducer(producerId) {
  url += `&items=cs.[{"producer_id":"${producerId}"}]`;
}
// → This requires full table scan on JSONB field = slow at scale
```

**Load Test Focus:** Order creation bursts (e.g., promo launch), producer dashboard load.

#### Image Upload (`src/lib/supabase-product-images.ts`)
```typescript
uploadProductImage(fileUri, producerId, productId) {
  const blob = await fetch(fileUri).then(r => r.blob());
  // Direct upload to Supabase Storage (no size validation client-side!)
  return fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${path}`, {
    method: 'POST',
    body: blob
  });
}

// RISKS:
// - No image size limit (client-side)
// - No concurrent upload limit
// - Sequential uploads (uploadMultipleProductImages uses for-loop)
```

**Load Test Focus:** Concurrent image uploads (50MB+ files), bandwidth consumption.

#### Retry Logic (`src/lib/fetch-with-retry.ts`)
```typescript
// GOOD: Exponential backoff with jitter
// GOOD: Max 3 retries with 10s timeout

// CONCERN: All requests retry by default
// → Under network issues, 3x amplification of load
// → Example: 100 req/s becomes 300 req/s during outage
```

**Load Test Focus:** Partial network failure simulation, retry storm prevention.

---

## 2. Performance Bottlenecks by Priority

### 🔴 **CRITICAL (Fix Before Production)**

#### C1. N+1 Queries in Cart/Order Enrichment
**Impact:** 2N+1 HTTP requests per cart load (N = number of items)
**Example:** Cart with 20 items = 41 requests = 2-5 seconds load time

**Root Cause:**
```typescript
// BAD (current)
const product = await fetch(`/products?id=eq.${item.product_id}`);
const producer = await fetch(`/producers?id=eq.${item.producer_id}`);
```

**Solution:**
```typescript
// GOOD (use Supabase foreign key expansion)
const response = await fetch(
  `/panier_vente_directe?user_id=eq.${userId}&select=*,` +
  `product:products(id,name,price_public,image),` +
  `producer:producers(id,name)`
);
// → 1 HTTP request instead of 41
```

**Files to Fix:**
- `src/lib/direct-sales-cart.ts:76-116` (loadCart method)
- Consider Edge Function for complex enrichment

---

#### C2. Missing Pagination for Large Datasets
**Impact:** App crashes on devices with <2GB RAM when loading 500+ products

**Current Implementation:**
```typescript
fetchProducts(): Promise<SupabaseProduct[]> // Returns ALL products
fetchProducers(): Promise<SupabaseProducer[]> // Returns ALL producers
fetchOrders(): Promise<Order[]> // Returns ALL orders
```

**Solution:**
```typescript
// Cursor-based pagination with React Query
const { data, fetchNextPage, hasNextPage } = useInfiniteQuery({
  queryKey: ['products', filters],
  queryFn: ({ pageParam }) =>
    fetch(`/products?limit=20&offset=${pageParam}`),
  initialPageParam: 0,
  getNextPageParam: (lastPage, pages) =>
    lastPage.length === 20 ? pages.length * 20 : undefined
});
```

**Files to Fix:**
- `src/lib/supabase-sync.catalog.ts` (fetchProducts, fetchProducers)
- `src/lib/supabase-sync.orders.ts` (fetchOrders)
- `src/lib/supabase-sync.chat.ts` (already has limit=50, but needs cursor pagination)

---

#### C3. No Rate Limiting on Edge Functions
**Impact:** Malicious actors can spam order creation, email sending, etc.

**Current State:**
```typescript
// Edge Functions have NO rate limiting
POST /functions/v1/create-direct-sale-orders
POST /functions/v1/local-market-orders
POST /functions/v1/send-local-market-order-email
POST /functions/v1/products-mutations
```

**Solution:**
```typescript
// Add Upstash Rate Limit or Supabase-native solution
import { Ratelimit } from '@upstash/ratelimit';

const ratelimit = new Ratelimit({
  redis: redis,
  limiter: Ratelimit.slidingWindow(10, '1 m'), // 10 requests per minute
});

const identifier = req.headers.get('x-user-id') || req.headers.get('x-forwarded-for');
const { success } = await ratelimit.limit(identifier);

if (!success) {
  return new Response('Rate limit exceeded', { status: 429 });
}
```

**Files to Add:**
- Create `supabase/functions/_shared/rate-limit.ts`
- Apply to all Edge Functions in `supabase/functions/*/index.ts`

---

### 🟠 **HIGH (Fix Within 2 Weeks)**

#### H1. WebSocket Connection Overhead
**Current:** 1 WebSocket per user for chat = 100 users = 100 connections
**Recommended:** Use Supabase Realtime Presence for connection pooling

**Optimization:**
```typescript
// Instead of raw WebSocket, use Supabase Realtime client
import { createClient } from '@supabase/supabase-js';

const channel = supabase.channel('chat-room')
  .on('postgres_changes',
    { event: 'INSERT', schema: 'public', table: 'chat_messages' },
    (payload) => callback(payload.new)
  )
  .subscribe();

// Supabase handles connection pooling + reconnection
```

**Files to Refactor:**
- `src/lib/supabase-sync.chat.ts:220-342` (subscribeToMessages)

---

#### H2. No Caching for Catalog Data
**Impact:** Producers/products fetched on every app launch = 500ms+ cold start

**Current:** React Query with `staleTime: 0` (always refetch)
**Solution:** Aggressive caching with background revalidation

```typescript
useQuery({
  queryKey: ['producers'],
  queryFn: fetchProducers,
  staleTime: 1000 * 60 * 10, // 10 minutes
  gcTime: 1000 * 60 * 60, // 1 hour in cache
  refetchOnMount: 'always', // Background revalidation
});

// + Add ETag support in Edge Functions for conditional requests
```

**Files to Fix:**
- Add ETag logic to catalog Edge Functions
- Update React Query config in components using catalog data

---

#### H3. Sequential Image Uploads
**Current:** Upload images one-by-one (5 images = 25 seconds on 4G)
**Solution:** Parallel uploads with concurrency limit

```typescript
// Use Promise.allSettled with concurrency control
import pLimit from 'p-limit';

const limit = pLimit(3); // Max 3 concurrent uploads
const uploads = fileUris.map(uri =>
  limit(() => uploadProductImage(uri, producerId, productId))
);
await Promise.allSettled(uploads);
```

**Files to Fix:**
- `src/lib/supabase-product-images.ts:108-126` (uploadMultipleProductImages)

---

### 🟡 **MEDIUM (Nice to Have)**

#### M1. Add Request Deduplication
When multiple components request the same data simultaneously, React Query deduplicates by default, but we can optimize:

```typescript
// Add request deduplication key for identical requests
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Deduplicate requests within 500ms window
      staleTime: 500,
      refetchOnWindowFocus: false,
    },
  },
});
```

#### M2. Optimize JSON Containment Queries
Replace JSONB `@>` operator with indexed foreign key:

```sql
-- SLOW (current): Full table scan on JSONB
SELECT * FROM orders WHERE items @> '[{"producer_id": "abc"}]';

-- FAST: Create order_items junction table
CREATE TABLE order_items (
  order_id UUID REFERENCES orders(id),
  producer_id UUID REFERENCES producers(id),
  ...
);
CREATE INDEX idx_order_items_producer ON order_items(producer_id);

SELECT DISTINCT o.* FROM orders o
JOIN order_items oi ON oi.order_id = o.id
WHERE oi.producer_id = 'abc';
```

#### M3. Add GraphQL Subscription for Orders
Instead of polling, use GraphQL subscription for real-time order updates:

```typescript
const ordersSub = supabase
  .channel('orders-realtime')
  .on('postgres_changes', {
    event: '*',
    schema: 'public',
    table: 'orders',
    filter: `producer_id=eq.${producerId}`
  }, handleOrderUpdate)
  .subscribe();
```

---

## 3. Load Testing Scenarios

### Scenario 1: Normal User Browsing
**Goal:** Baseline performance metrics
**Load:** 100 concurrent users
**Duration:** 10 minutes

**User Journey:**
1. Launch app (cold start)
2. Fetch producers list (catalog)
3. Fetch products for 1 producer
4. Add 3 products to cart
5. View cart (enrichment)
6. Wait 30s (idle)
7. Repeat steps 2-6

**Metrics to Capture:**
- **Cold Start Time:** Time from app launch to catalog display
- **API Response Time:** P50, P95, P99 for each endpoint
- **Memory Usage:** Peak memory consumption per device
- **Network Bandwidth:** Total MB transferred per user session
- **Error Rate:** % of failed requests

**Expected Results (Before Optimization):**
```
Cold Start: 1.2s (P95)
Catalog Load: 800ms (P95)
Cart Enrichment (5 items): 2.5s (P95)
Error Rate: 2-5% (due to retry storms)
Peak Memory: 180MB
```

**Target Results (After Optimization):**
```
Cold Start: 500ms (P95)
Catalog Load: 200ms (P95) [with caching]
Cart Enrichment (5 items): 300ms (P95) [with join]
Error Rate: <0.5%
Peak Memory: 120MB
```

---

### Scenario 2: Flash Sale / Promo Launch
**Goal:** Test order creation surge
**Load:** 500 users in 60 seconds
**Duration:** 5 minutes

**User Journey:**
1. All users receive push notification
2. 70% open app simultaneously
3. Navigate to promo product
4. Add to cart
5. Create order (POST /create-direct-sale-orders)

**Critical Path:**
```
User → App Launch → Product Fetch → Add Cart → Create Order
  ↓         ↓             ↓            ↓            ↓
 0ms      200ms         500ms        600ms       800ms
```

**Metrics to Capture:**
- **Order Creation Success Rate:** % of orders successfully created
- **Edge Function Cold Start:** Time for first invocation
- **Database Connection Pool:** Supabase Postgres connection count
- **Payment Gateway Latency:** External API impact
- **Queue Depth:** Number of pending requests

**Expected Bottlenecks:**
1. **Edge Function cold starts** → First 50 users see 3-5s delays
2. **Database connection exhaustion** → After 100 concurrent writes
3. **Rate limiting false positives** → In-memory limiter bypassed

**Mitigation:**
```typescript
// Pre-warm Edge Functions
await fetch('/functions/v1/create-direct-sale-orders', {
  method: 'OPTIONS' // Trigger function deployment
});

// Use Supabase connection pooler (PgBouncer)
DATABASE_URL='postgres://...:6543/postgres?pgbouncer=true'
```

---

### Scenario 3: Producer Dashboard Load
**Goal:** Test producer-specific queries
**Load:** 20 producers checking orders simultaneously
**Duration:** 5 minutes

**User Journey:**
1. Producer logs in
2. Fetch orders for producer (with JSON containment filter)
3. Update 5 order statuses
4. Upload product images (3 images per product)
5. Send 10 chat messages

**Critical Path:**
```sql
-- SLOW QUERY (current)
SELECT * FROM orders
WHERE items @> '[{"producer_id": "abc"}]'
ORDER BY created_at DESC;

-- Time: 2.5s for 10,000 orders (no index on JSONB)
```

**Metrics to Capture:**
- **Query Execution Time:** PostgreSQL `pg_stat_statements`
- **Image Upload Throughput:** MB/s per user
- **WebSocket Message Latency:** Time from send to receive
- **Concurrent Mutation Conflicts:** Optimistic locking failures

**Optimization:**
1. Add GIN index on JSONB column (if keeping current schema)
2. Migrate to `order_items` junction table (recommended)
3. Implement cursor-based pagination for orders

---

### Scenario 4: Network Instability Simulation
**Goal:** Test retry logic and offline resilience
**Load:** 50 users with 30% packet loss
**Duration:** 10 minutes

**Network Conditions:**
- 30% packet loss
- 500ms added latency (3G simulation)
- Random 10s disconnections

**Metrics to Capture:**
- **Retry Storm:** Count of requests triggered by retries
- **Offline Queue:** Number of operations queued locally
- **Data Consistency:** % of successful syncs after reconnection
- **Battery Drain:** Power consumption during instability

**Expected Behavior:**
- Exponential backoff prevents retry storm ✓
- Offline queue stores failed mutations ✓
- React Query refetches after reconnection ✓

**Risk:**
- If 100 users hit retry storms simultaneously → 300 req/s → DDoS self

---

### Scenario 5: Security & Abuse Testing
**Goal:** Validate rate limiting and RLS policies
**Load:** 10 malicious actors
**Duration:** 5 minutes

**Attack Vectors:**
1. **Brute Force Login:** 1000 login attempts per minute
2. **Order Spam:** 500 order creation requests per minute
3. **Image Upload Bomb:** Upload 100MB files repeatedly
4. **Chat Spam:** Send 1000 messages per minute
5. **RLS Bypass Attempt:** Modify `user_id` in requests

**Expected Defenses:**
- Rate limiting blocks after 5 attempts (60s cooldown) ✓
- Edge Functions validate JWT claims ✓
- RLS policies prevent unauthorized access ✓
- File size limits reject oversized uploads ✗ (MISSING)

**Action Items:**
1. Add file size validation in Edge Functions
2. Implement distributed rate limiting (Redis/Upstash)
3. Add CAPTCHA for repeated login failures

---

## 4. Load Testing Tools & Setup

### Recommended Tools

#### Option 1: k6 (Recommended for API Testing)
```javascript
// k6-load-test.js
import http from 'k6/http';
import { check, sleep } from 'k6';

export let options = {
  stages: [
    { duration: '2m', target: 100 }, // Ramp up to 100 users
    { duration: '5m', target: 100 }, // Stay at 100 users
    { duration: '2m', target: 0 },   // Ramp down
  ],
  thresholds: {
    http_req_duration: ['p(95)<500'], // 95% of requests < 500ms
    http_req_failed: ['rate<0.01'],   // <1% error rate
  },
};

export default function () {
  const accessToken = 'YOUR_TEST_USER_TOKEN';

  // Test catalog fetch
  let producersRes = http.get(
    'https://YOUR_SUPABASE_URL/rest/v1/producers?select=*',
    {
      headers: {
        'apikey': 'YOUR_ANON_KEY',
        'Authorization': `Bearer ${accessToken}`,
      },
    }
  );
  check(producersRes, { 'producers loaded': (r) => r.status === 200 });

  // Test cart load (with N+1 problem)
  let cartRes = http.get(
    'https://YOUR_SUPABASE_URL/rest/v1/panier_vente_directe?user_id=eq.USER_ID',
    {
      headers: {
        'apikey': 'YOUR_ANON_KEY',
        'Authorization': `Bearer ${accessToken}`,
      },
    }
  );
  check(cartRes, { 'cart loaded': (r) => r.status === 200 });

  sleep(1);
}
```

**Run:**
```bash
k6 run --vus 100 --duration 5m k6-load-test.js
```

---

#### Option 2: Artillery (Recommended for Scenario Testing)
```yaml
# artillery-config.yml
config:
  target: "https://YOUR_SUPABASE_URL"
  phases:
    - duration: 300
      arrivalRate: 10 # 10 new users per second
      name: "Sustained load"
  variables:
    accessToken: "YOUR_TEST_TOKEN"

scenarios:
  - name: "User Browsing"
    flow:
      - get:
          url: "/rest/v1/producers?select=*"
          headers:
            apikey: "{{ $processEnvironment.SUPABASE_ANON_KEY }}"
            Authorization: "Bearer {{ accessToken }}"
      - think: 2
      - get:
          url: "/rest/v1/products?select=*&limit=20"
          headers:
            apikey: "{{ $processEnvironment.SUPABASE_ANON_KEY }}"
            Authorization: "Bearer {{ accessToken }}"
      - think: 5
      - post:
          url: "/functions/v1/create-direct-sale-orders"
          json:
            items: [{ productId: "test-123", quantity: 2 }]
          headers:
            Authorization: "Bearer {{ accessToken }}"
```

**Run:**
```bash
artillery run artillery-config.yml
```

---

#### Option 3: Locust (Python-based, good for custom scenarios)
```python
# locustfile.py
from locust import HttpUser, task, between

class ChanvriersUser(HttpUser):
    wait_time = between(1, 3)
    host = "https://YOUR_SUPABASE_URL"

    def on_start(self):
        # Login
        response = self.client.post("/auth/v1/token?grant_type=password", json={
            "email": "test@example.com",
            "password": "test123"
        })
        self.access_token = response.json()["access_token"]

    @task(3)
    def browse_producers(self):
        self.client.get("/rest/v1/producers?select=*", headers={
            "apikey": "YOUR_ANON_KEY",
            "Authorization": f"Bearer {self.access_token}"
        })

    @task(2)
    def browse_products(self):
        self.client.get("/rest/v1/products?select=*&limit=20", headers={
            "apikey": "YOUR_ANON_KEY",
            "Authorization": f"Bearer {self.access_token}"
        })

    @task(1)
    def load_cart(self):
        # This will trigger N+1 queries
        self.client.get(f"/rest/v1/panier_vente_directe?user_id=eq.{self.user_id}", headers={
            "apikey": "YOUR_ANON_KEY",
            "Authorization": f"Bearer {self.access_token}"
        })
```

**Run:**
```bash
locust -f locustfile.py --users 100 --spawn-rate 10 --run-time 10m
```

---

### Test Environment Setup

#### 1. Create Test Database
```sql
-- Supabase: Create test branch (recommended)
-- Dashboard > Project Settings > Branching > Create Branch
-- Or use local Supabase instance:
npx supabase start

-- Seed with realistic data
INSERT INTO producers (name, region, ...) VALUES
  ('Producer 1', 'Bretagne', ...),
  ('Producer 2', 'Normandie', ...),
  ... -- 50 producers

INSERT INTO products (name, producer_id, ...) VALUES
  ('Product 1', 'producer-1', ...),
  ... -- 500 products

INSERT INTO orders (customer_id, items, ...) VALUES
  ... -- 1000 orders
```

#### 2. Generate Test Users
```typescript
// scripts/create-test-users.ts
const users = [];
for (let i = 0; i < 100; i++) {
  const { data, error } = await supabase.auth.admin.createUser({
    email: `test-user-${i}@loadtest.com`,
    password: 'TestPassword123!',
    email_confirm: true,
  });
  users.push(data.user);
}
```

#### 3. Monitor During Tests
```typescript
// Supabase Dashboard > Database > Query Performance
SELECT query, calls, total_time, mean_time
FROM pg_stat_statements
ORDER BY total_time DESC
LIMIT 20;

// Monitor connection pool
SELECT count(*) FROM pg_stat_activity
WHERE state = 'active';

// Check slow queries
SELECT pid, now() - query_start AS duration, query
FROM pg_stat_activity
WHERE state = 'active' AND now() - query_start > interval '5 seconds';
```

---

## 5. Monitoring & Observability

### Key Metrics to Track

#### Application Metrics
```typescript
// Add to React Native app
import * as Sentry from '@sentry/react-native';

Sentry.init({
  dsn: 'YOUR_SENTRY_DSN',
  tracesSampleRate: 1.0, // 100% sampling during load test
});

// Track custom metrics
Sentry.metrics.gauge('cart.enrichment_time', duration);
Sentry.metrics.increment('order.created');
```

#### Supabase Metrics (Dashboard)
- **API Requests:** req/s, error rate, P95 latency
- **Database:** Active connections, query execution time
- **Edge Functions:** Invocations, cold starts, execution time
- **Storage:** Bandwidth, number of uploads
- **Realtime:** Active connections, messages/s

#### Infrastructure Metrics
```bash
# Monitor Supabase Postgres
SELECT
  datname,
  numbackends AS connections,
  xact_commit + xact_rollback AS transactions,
  blks_read + blks_hit AS disk_io
FROM pg_stat_database;

# Monitor Edge Function memory
SELECT
  function_name,
  avg(memory_mb) as avg_memory,
  max(memory_mb) as peak_memory
FROM function_metrics
GROUP BY function_name;
```

---

## 6. Capacity Planning

### Current Limits (Supabase Free Tier)
- **Database Size:** 500MB
- **File Storage:** 1GB
- **Monthly Active Users:** Unlimited
- **Realtime Concurrent Connections:** 200
- **Edge Function Invocations:** 500,000/month

### Projected Growth
```
Month 1: 100 users → 10,000 products viewed/day
Month 3: 500 users → 50,000 products viewed/day
Month 6: 2,000 users → 200,000 products viewed/day
```

### Scaling Recommendations

#### When to Upgrade Supabase Plan
| Metric | Free Tier Limit | Upgrade Trigger | Recommended Plan |
|--------|-----------------|-----------------|------------------|
| Database Size | 500MB | 400MB (80%) | Pro ($25/mo, 8GB) |
| Realtime Connections | 200 | 150 concurrent | Pro (500 connections) |
| Edge Function Calls | 500k/mo | 400k/mo | Pro (2M/mo) |
| API Requests | Unlimited | 10k req/min | Enterprise (custom) |

#### Database Optimization Checklist
```sql
-- Add indexes for common queries
CREATE INDEX idx_products_producer ON products(producer_id);
CREATE INDEX idx_orders_customer ON orders(customer_id);
CREATE INDEX idx_orders_created ON orders(created_at DESC);

-- Add GIN index for JSONB (if not migrating to junction table)
CREATE INDEX idx_orders_items_gin ON orders USING gin(items);

-- Partition large tables (1M+ rows)
CREATE TABLE orders_2026_01 PARTITION OF orders
FOR VALUES FROM ('2026-01-01') TO ('2026-02-01');

-- Analyze query performance
EXPLAIN ANALYZE SELECT * FROM orders WHERE customer_id = 'abc';
```

#### CDN for Static Assets
```typescript
// Move product images to CDN (Cloudflare Images)
const imageUrl = `https://imagedelivery.net/${ACCOUNT_HASH}/${IMAGE_ID}/public`;

// Enable Supabase CDN for storage
const { data } = supabase.storage
  .from('product-images')
  .getPublicUrl('path/to/image.jpg', {
    transform: {
      width: 300,
      height: 300,
      quality: 80,
    }
  });
```

---

## 7. Action Plan

### Week 1: Critical Fixes
- [ ] **Fix N+1 queries in cart enrichment** (C1)
  - Files: `src/lib/direct-sales-cart.ts`
  - Use Supabase foreign key expansion
  - Expected improvement: 2.5s → 300ms (8x faster)

- [ ] **Add pagination to catalog endpoints** (C2)
  - Files: `src/lib/supabase-sync.catalog.ts`
  - Implement cursor-based pagination
  - Expected improvement: Memory usage -40%

- [ ] **Implement rate limiting for Edge Functions** (C3)
  - Create: `supabase/functions/_shared/rate-limit.ts`
  - Apply to all mutation endpoints
  - Expected improvement: Prevent abuse attacks

### Week 2: High Priority Optimizations
- [ ] **Refactor WebSocket to use Supabase Realtime client** (H1)
  - Files: `src/lib/supabase-sync.chat.ts`
  - Expected improvement: Connection overhead -50%

- [ ] **Add aggressive caching for catalog data** (H2)
  - Update React Query config
  - Implement ETag support
  - Expected improvement: Cold start 1.2s → 500ms

- [ ] **Parallelize image uploads** (H3)
  - Files: `src/lib/supabase-product-images.ts`
  - Expected improvement: 5 images: 25s → 8s

### Week 3: Load Testing
- [ ] **Set up k6/Artillery test suite**
  - Create test scenarios 1-5
  - Generate test data (50 producers, 500 products, 100 users)

- [ ] **Run baseline tests** (before optimizations)
  - Document current performance metrics

- [ ] **Run optimized tests** (after fixes)
  - Compare before/after metrics
  - Validate improvements

### Week 4: Database Optimizations
- [ ] **Migrate orders schema** (M2)
  - Create `order_items` junction table
  - Add indexes on foreign keys
  - Test producer queries

- [ ] **Add monitoring dashboard**
  - Set up Sentry/DataDog
  - Create alert rules for critical metrics
  - Document runbook for incidents

---

## 8. Success Criteria

### Performance Targets
| Metric | Current | Target | Stretch Goal |
|--------|---------|--------|--------------|
| **Cold Start (P95)** | 1.2s | 500ms | 300ms |
| **Catalog Load (P95)** | 800ms | 200ms | 100ms |
| **Cart Enrichment (P95)** | 2.5s | 300ms | 200ms |
| **Order Creation (P95)** | 1.5s | 500ms | 300ms |
| **Error Rate** | 2-5% | <0.5% | <0.1% |
| **Memory Usage (Peak)** | 180MB | 120MB | 100MB |
| **Concurrent Users** | 50-100 | 500+ | 1000+ |

### Load Testing Acceptance
- ✅ 100 concurrent users for 10 minutes (0% errors)
- ✅ 500 users in flash sale scenario (order success rate >95%)
- ✅ 20 producers simultaneously (query time <1s)
- ✅ Network instability test (no retry storms)
- ✅ Security tests (rate limiting effective)

### Business Metrics
- **User Experience:** <3% crash rate during peak load
- **Revenue Impact:** 0 failed orders during promo launch
- **Infrastructure Cost:** Stay within Supabase Pro plan limits ($25/mo)

---

## 9. Risk Assessment

### High Risk
1. **Database connection pool exhaustion**
   - Mitigation: Use PgBouncer connection pooler
   - Fallback: Increase Supabase plan to Enterprise

2. **Edge Function cold starts during flash sale**
   - Mitigation: Pre-warm functions before promo
   - Fallback: Implement queue system (SQS/BullMQ)

3. **Realtime WebSocket connection limit (200 on Free tier)**
   - Mitigation: Upgrade to Pro (500 connections)
   - Fallback: Implement polling fallback

### Medium Risk
1. **React Query cache invalidation bugs**
   - Mitigation: Extensive testing of cache mutations
   - Fallback: Add manual refresh button

2. **Image upload failures**
   - Mitigation: Implement retry logic with exponential backoff
   - Fallback: Queue uploads for background processing

### Low Risk
1. **Chat message ordering issues**
   - Mitigation: Use server timestamps for ordering
   - Impact: Low (non-critical feature)

---

## 10. References

### Documentation
- [Supabase Performance Tuning](https://supabase.com/docs/guides/platform/performance)
- [React Query Best Practices](https://tanstack.com/query/latest/docs/framework/react/guides/important-defaults)
- [k6 Load Testing Guide](https://k6.io/docs/)

### Related Files
- `c:\app-chanvriers\src\lib\supabase-auth.ts` - Authentication with rate limiting
- `c:\app-chanvriers\src\lib\supabase-sync-core.ts` - Core sync infrastructure
- `c:\app-chanvriers\src\lib\supabase-sync.catalog.ts` - Product/producer fetching
- `c:\app-chanvriers\src\lib\supabase-sync.orders.ts` - Order processing
- `c:\app-chanvriers\src\lib\direct-sales-cart.ts` - Cart enrichment (N+1 issue)
- `c:\app-chanvriers\src\lib\local-market-orders.ts` - Local market orders
- `c:\app-chanvriers\src\lib\supabase-sync.chat.ts` - Real-time chat
- `c:\app-chanvriers\src\lib\fetch-with-retry.ts` - Retry logic

---

**Document Version:** 1.0
**Last Updated:** 2026-02-02
**Next Review:** After Week 3 load testing completion
