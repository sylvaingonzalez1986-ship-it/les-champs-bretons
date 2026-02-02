# Load Testing Suite for Les Chanvriers

This directory contains load testing scripts for performance validation and capacity planning.

## Prerequisites

### 1. Install Load Testing Tools

#### k6 (Recommended for API testing)
```bash
# macOS
brew install k6

# Windows (Chocolatey)
choco install k6

# Linux
sudo gpg --no-default-keyring --keyring /usr/share/keyrings/k6-archive-keyring.gpg --keyserver hkp://keyserver.ubuntu.com:80 --recv-keys C5AD17C747E3415A3642D57D77C6C491D6AC1D69
echo "deb [signed-by=/usr/share/keyrings/k6-archive-keyring.gpg] https://dl.k6.io/deb stable main" | sudo tee /etc/apt/sources.list.d/k6.list
sudo apt-get update
sudo apt-get install k6
```

#### Artillery (Recommended for scenario testing)
```bash
npm install -g artillery
```

#### Locust (Python-based, for custom scenarios)
```bash
pip install locust
```

---

## 2. Environment Setup

### Create Test Users in Supabase

```sql
-- Run in Supabase SQL Editor

-- Create test admin user
INSERT INTO auth.users (id, email, email_confirmed_at, created_at, updated_at)
VALUES (
  gen_random_uuid(),
  'test@chanvriers.com',
  now(),
  now(),
  now()
);

-- Create test producer user
INSERT INTO auth.users (id, email, email_confirmed_at, created_at, updated_at)
VALUES (
  gen_random_uuid(),
  'producer@test.com',
  now(),
  now(),
  now()
);

-- Set passwords via Supabase Dashboard > Authentication > Users
-- Password: TestPassword123!
```

### Set Environment Variables

```bash
# Create .env.load-test file
cat > .env.load-test <<EOF
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-anon-key-here
TEST_USER_EMAIL=test@chanvriers.com
TEST_USER_PASSWORD=TestPassword123!
TEST_PRODUCER_EMAIL=producer@test.com
TEST_PRODUCER_PASSWORD=TestPassword123!
EOF

# Load environment variables
export $(cat .env.load-test | xargs)
```

---

## 3. Test Scenarios

### Test 1: Baseline User Browsing (k6)

**Goal:** Measure normal user behavior and identify baseline performance.

**What it tests:**
- Catalog loading (producers, products)
- Cart enrichment (N+1 query problem)
- Order creation

**Run:**
```bash
k6 run \
  --env SUPABASE_URL=$SUPABASE_URL \
  --env ANON_KEY=$SUPABASE_ANON_KEY \
  --env TEST_USER_EMAIL=$TEST_USER_EMAIL \
  --env TEST_USER_PASSWORD=$TEST_USER_PASSWORD \
  load-tests/k6-baseline.js
```

**Expected results:**
```
✓ http_req_duration...................: avg=324ms   p(95)=892ms
✓ catalog_load_time...................: avg=210ms   p(95)=450ms
✗ cart_enrichment_time................: avg=1.8s    p(95)=2.5s  ← BOTTLENECK
✓ errors..............................: 2.3%
```

**Metrics to watch:**
- `cart_enrichment_time` > 1s → N+1 query problem
- `errors` > 1% → Retry storms or rate limiting
- `http_req_duration` P95 > 1s → Slow queries

---

### Test 2: Flash Sale / Promo Launch (Artillery)

**Goal:** Test order creation surge (500 users in 60 seconds).

**What it tests:**
- Edge Function cold starts
- Database connection pool
- Concurrent order creation
- Payment validation

**Run:**
```bash
export SUPABASE_URL=$SUPABASE_URL
export SUPABASE_ANON_KEY=$SUPABASE_ANON_KEY
export TEST_USER_EMAIL=$TEST_USER_EMAIL
export TEST_USER_PASSWORD=$TEST_USER_PASSWORD

artillery run load-tests/artillery-flash-sale.yml
```

**Expected bottlenecks:**
- First 50 users see 3-5s delays (Edge Function cold start)
- Database connection pool exhaustion after 100 concurrent writes
- Rate limiting false positives (in-memory limiter bypassed on restart)

**Success criteria:**
- Order creation success rate >95%
- P95 latency <2s after warm-up
- Error rate <5%

---

### Test 3: Producer Dashboard (Locust)

**Goal:** Test producer-specific queries (especially JSON containment).

**What it tests:**
- Order queries filtered by producer_id (SLOW with current schema)
- Order status updates
- Product image uploads
- Real-time chat

**Run:**
```bash
# With web UI (recommended)
locust -f load-tests/locust-producer-dashboard.py

# Then open: http://localhost:8089
# Set: 20 users, spawn rate 2, host: $SUPABASE_URL

# Or headless mode
locust -f load-tests/locust-producer-dashboard.py \
  --users 20 \
  --spawn-rate 2 \
  --run-time 10m \
  --headless \
  --host $SUPABASE_URL
```

**Expected bottlenecks:**
- JSON containment queries (items @> '[{"producer_id":"..."}]') take >1s
- Image uploads saturate bandwidth
- Chat WebSocket connections exhaust limit (200 on Free tier)

**Success criteria:**
- Order query time <1s
- No slow queries (>2s)
- Image upload success rate >99%

---

## 4. Interpreting Results

### Key Metrics

#### Response Time
```
P50 (median):    Half of requests faster than this
P95:             95% of requests faster than this
P99:             99% of requests faster than this
```

**Targets:**
- P50 < 300ms
- P95 < 1000ms
- P99 < 2000ms

#### Error Rate
```
<0.5%:  Excellent
0.5-1%: Good
1-5%:   Acceptable (investigate)
>5%:    Critical (fix immediately)
```

#### Throughput
```
Requests/second: Number of requests handled per second
Concurrent Users: Number of simultaneous users
```

**Calculation:**
```
Max concurrent users = (Target RPS) / (Requests per user session)
Example: 1000 RPS / 10 req/session = 100 users
```

---

## 5. Common Bottlenecks & Solutions

### Bottleneck 1: N+1 Queries in Cart Enrichment

**Symptom:**
```
cart_enrichment_time: avg=2.5s, p(95)=4.2s
```

**Root cause:**
```typescript
// BAD: For each cart item, fetch product and producer separately
cartItems.forEach(async (item) => {
  await fetch(`/products?id=eq.${item.product_id}`);  // N queries
  await fetch(`/producers?id=eq.${item.producer_id}`); // N queries
});
```

**Solution:**
```typescript
// GOOD: Use Supabase foreign key expansion (1 query)
await fetch(
  `/panier_vente_directe?user_id=eq.${userId}&select=*,` +
  `product:products(id,name,price_public,image),` +
  `producer:producers(id,name)`
);
```

**Expected improvement:** 2.5s → 300ms (8x faster)

---

### Bottleneck 2: Slow JSON Containment Queries

**Symptom:**
```
/orders [producer_filter]: avg=1.8s, p(95)=3.2s
```

**Root cause:**
```sql
-- Requires full table scan without index
SELECT * FROM orders
WHERE items @> '[{"producer_id": "abc"}]';
```

**Solution Option 1: Add GIN index**
```sql
CREATE INDEX idx_orders_items_gin ON orders USING gin(items);
```

**Solution Option 2: Migrate to junction table (recommended)**
```sql
CREATE TABLE order_items (
  order_id UUID REFERENCES orders(id),
  producer_id UUID REFERENCES producers(id),
  product_id UUID REFERENCES products(id),
  quantity INTEGER,
  ...
);

CREATE INDEX idx_order_items_producer ON order_items(producer_id);

-- Query becomes:
SELECT DISTINCT o.* FROM orders o
JOIN order_items oi ON oi.order_id = o.id
WHERE oi.producer_id = 'abc';
```

**Expected improvement:** 1.8s → 200ms (9x faster)

---

### Bottleneck 3: Edge Function Cold Starts

**Symptom:**
```
First 50 requests: avg=4.2s
After warm-up:     avg=450ms
```

**Root cause:**
Edge Functions are initialized on-demand (cold start penalty).

**Solution:**
```typescript
// Pre-warm functions before load test
async function warmUpFunctions() {
  await fetch('/functions/v1/create-direct-sale-orders', { method: 'OPTIONS' });
  await fetch('/functions/v1/orders-update', { method: 'OPTIONS' });
  // ... other functions
}
```

**Alternative:** Use Supabase Pro plan (keeps functions warm longer)

---

### Bottleneck 4: Database Connection Pool Exhaustion

**Symptom:**
```
Error: "remaining connection slots are reserved"
```

**Root cause:**
Default connection pool size: 15 connections

**Solution:**
```typescript
// Use Supabase connection pooler (PgBouncer)
const supabase = createClient(
  SUPABASE_URL,
  SUPABASE_ANON_KEY,
  {
    db: {
      schema: 'public',
    },
    global: {
      headers: {
        'X-Supabase-Pool-Mode': 'transaction'
      }
    }
  }
);
```

**Alternative:** Upgrade Supabase plan for more connections

---

## 6. Load Testing Checklist

Before running load tests:

- [ ] Create test users in Supabase
- [ ] Set environment variables
- [ ] Seed test data (50 producers, 500 products, 1000 orders)
- [ ] Create Supabase branch for testing (optional but recommended)
- [ ] Enable Supabase query performance monitoring
- [ ] Set up error tracking (Sentry/DataDog)

During load tests:

- [ ] Monitor Supabase Dashboard > Database > Query Performance
- [ ] Watch for slow queries (>1s)
- [ ] Check database connection pool usage
- [ ] Monitor Edge Function invocation count
- [ ] Track error rate in real-time

After load tests:

- [ ] Analyze P95/P99 latencies
- [ ] Identify top 5 slowest queries
- [ ] Check error logs for patterns
- [ ] Compare results to baseline
- [ ] Create action plan for bottlenecks

---

## 7. CI/CD Integration

### GitHub Actions Example

```yaml
# .github/workflows/load-test.yml
name: Load Testing

on:
  schedule:
    - cron: '0 2 * * 1'  # Every Monday at 2am
  workflow_dispatch:      # Manual trigger

jobs:
  load-test:
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v3

      - name: Install k6
        run: |
          sudo gpg --no-default-keyring --keyring /usr/share/keyrings/k6-archive-keyring.gpg --keyserver hkp://keyserver.ubuntu.com:80 --recv-keys C5AD17C747E3415A3642D57D77C6C491D6AC1D69
          echo "deb [signed-by=/usr/share/keyrings/k6-archive-keyring.gpg] https://dl.k6.io/deb stable main" | sudo tee /etc/apt/sources.list.d/k6.list
          sudo apt-get update
          sudo apt-get install k6

      - name: Run baseline load test
        env:
          SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
          ANON_KEY: ${{ secrets.SUPABASE_ANON_KEY }}
          TEST_USER_EMAIL: ${{ secrets.TEST_USER_EMAIL }}
          TEST_USER_PASSWORD: ${{ secrets.TEST_USER_PASSWORD }}
        run: |
          k6 run --out json=load-test-results.json load-tests/k6-baseline.js

      - name: Upload results
        uses: actions/upload-artifact@v3
        with:
          name: load-test-results
          path: load-test-results.json

      - name: Check thresholds
        run: |
          # Fail if error rate > 1%
          jq -e '.metrics.errors.values.rate < 0.01' load-test-results.json
```

---

## 8. Resources

### Official Documentation
- [k6 Documentation](https://k6.io/docs/)
- [Artillery Documentation](https://www.artillery.io/docs)
- [Locust Documentation](https://docs.locust.io/)
- [Supabase Performance Tuning](https://supabase.com/docs/guides/platform/performance)

### Useful Tools
- [k6 Cloud](https://k6.io/cloud/) - Hosted load testing
- [Artillery Cloud](https://www.artillery.io/cloud) - Distributed load testing
- [Grafana k6 Dashboard](https://grafana.com/grafana/dashboards/2587-k6-load-testing-results/) - Visualization

### Related Files
- `../LOAD_TESTING_STRATEGY.md` - Overall strategy and bottleneck analysis
- `../src/lib/supabase-sync-core.ts` - Core sync infrastructure
- `../src/lib/direct-sales-cart.ts` - Cart enrichment (N+1 issue)
- `../src/lib/supabase-sync.orders.ts` - Order processing

---

## Support

For questions or issues:
1. Check `LOAD_TESTING_STRATEGY.md` for detailed analysis
2. Review Supabase Dashboard > Database > Query Performance
3. Check logs in `expo.log` for client-side errors
4. Monitor Supabase Dashboard > Edge Functions > Logs

**Last Updated:** 2026-02-02
