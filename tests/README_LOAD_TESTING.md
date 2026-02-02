# Load Testing Guide for Les Chanvriers

## Overview

This directory contains load testing scripts for the Les Chanvriers React Native application. The tests use k6, an open-source load testing tool optimized for developer experience and CI/CD integration.

## Prerequisites

### Install k6

**macOS:**
```bash
brew install k6
```

**Windows (Chocolatey):**
```bash
choco install k6
```

**Windows (Installer):**
Download from: https://k6.io/docs/getting-started/installation/

**Linux:**
```bash
sudo gpg -k
sudo gpg --no-default-keyring --keyring /usr/share/keyrings/k6-archive-keyring.gpg --keyserver hkp://keyserver.ubuntu.com:80 --recv-keys C5AD17C747E3415A3642D57D77C6C491D6AC1D69
echo "deb [signed-by=/usr/share/keyrings/k6-archive-keyring.gpg] https://dl.k6.io/deb stable main" | sudo tee /etc/apt/sources.list.d/k6.list
sudo apt-get update
sudo apt-get install k6
```

### Environment Setup

Create a `.env.k6` file in the project root (DO NOT commit this file):

```bash
# .env.k6
export SUPABASE_URL="https://your-project.supabase.co"
export SUPABASE_ANON_KEY="your-anon-key-here"
```

**Security Note:** Never commit your Supabase keys to version control.

## Test Scenarios

### 1. Browse Products (`k6-browse-products.js`)

Simulates users browsing the product catalog.

**User Journey:**
- Browse paginated catalog
- View 1-3 product details
- Filter by product type (30% of users)
- Search producers (20% of users)

**Target Load:** 500 concurrent users
**Expected Duration:** 15 minutes
**Expected RPS:** 50+ requests/second

**Run Test:**
```bash
# Source environment variables
source .env.k6

# Run test
k6 run tests/k6-browse-products.js

# Or inline:
SUPABASE_URL="https://your-project.supabase.co" \
SUPABASE_ANON_KEY="your-key" \
k6 run tests/k6-browse-products.js
```

**Expected Results (After Optimizations):**
- p95 response time: < 500ms ✅
- p99 response time: < 1000ms ✅
- Error rate: < 0.1% ✅
- Success rate: > 99.9% ✅

---

### 2. Bourse Trading (`k6-bourse-trading.js`)

Simulates professional users trading on the bourse (market).

**User Journey:**
- Load market data (50 products)
- Fetch price updates
- Create 1-3 buy orders (30% of users)
- Check order status
- Poll for price updates (20% of users)

**Target Load:** 100 concurrent pro traders
**Expected Duration:** 15 minutes
**Expected RPS:** 10+ requests/second

**Run Test:**
```bash
source .env.k6
k6 run tests/k6-bourse-trading.js
```

**Expected Results (After Optimizations):**
- Bourse load p95: < 500ms ✅
- Order creation p95: < 300ms ✅
- Price update p95: < 100ms ✅
- Error rate: < 0.1% ✅

---

### 3. Stress Test (Find Breaking Point)

**Coming Soon:** `k6-stress-test.js`

Gradually increases load to find the application's breaking point.

**Stages:**
- 500 users (target load)
- 1000 users (2x load)
- 1500 users (3x load)
- 2000 users (4x load - expected to fail)

**Purpose:** Identify infrastructure limits before production incidents.

---

## Running Tests

### Basic Test Run

```bash
# Simple run
k6 run tests/k6-browse-products.js

# With custom VUs and duration
k6 run --vus 100 --duration 5m tests/k6-browse-products.js

# Quiet mode (less output)
k6 run --quiet tests/k6-browse-products.js
```

### Advanced Options

```bash
# Run with custom thresholds
k6 run --thresholds 'http_req_duration=p(95)<400' tests/k6-browse-products.js

# Output results to file
k6 run --out json=results.json tests/k6-browse-products.js

# Run with specific stages
k6 run --stage '2m:100,5m:500,2m:0' tests/k6-browse-products.js
```

### Cloud Testing (k6 Cloud)

k6 Cloud provides distributed testing and advanced analytics.

**Sign up:** https://app.k6.io/account/register

**Run cloud test:**
```bash
# Login to k6 Cloud
k6 login cloud

# Run test in cloud
k6 cloud tests/k6-browse-products.js
```

**Benefits:**
- Distributed load from multiple locations
- Real-time metrics dashboard
- Result storage and comparison
- Team collaboration

---

## Interpreting Results

### Key Metrics

#### HTTP Request Duration
```
http_req_duration..........: avg=245ms min=50ms med=200ms max=2.5s p(90)=400ms p(95)=500ms
```
- **avg:** Average response time
- **p(90):** 90% of requests faster than this
- **p(95):** Target metric (should be < 500ms)
- **p(99):** Worst 1% (should be < 1000ms)

#### HTTP Request Failed
```
http_req_failed............: 0.15% ✓ 25 ✗ 16475
```
- Should be < 1% (ideally < 0.1%)
- High failure rate indicates errors

#### Requests per Second
```
http_reqs..................: 16500 (55/s)
```
- Total requests made during test
- RPS = throughput capacity

### Success Criteria

| Metric | Target | Status |
|--------|--------|--------|
| p95 Response Time | < 500ms | ✅ / ❌ |
| Error Rate | < 0.1% | ✅ / ❌ |
| Throughput | > 50 RPS | ✅ / ❌ |
| Success Rate | > 99.9% | ✅ / ❌ |

### Threshold Failures

If thresholds fail, you'll see output like:
```
ERRO[0315] some thresholds have failed
  ✗ http_req_duration: p(95) should be < 500ms (was 752.43ms)
```

This means the test failed and optimizations are needed.

---

## CI/CD Integration

### GitHub Actions

Create `.github/workflows/load-test.yml`:

```yaml
name: Load Tests

on:
  pull_request:
    branches: [main, master]
  schedule:
    - cron: '0 2 * * *'  # Daily at 2 AM
  workflow_dispatch:     # Manual trigger

jobs:
  load-test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3

      - name: Setup k6
        uses: grafana/setup-k6-action@v1

      - name: Run Browse Products Test
        run: |
          k6 run tests/k6-browse-products.js \
            --env SUPABASE_URL=${{ secrets.SUPABASE_URL }} \
            --env SUPABASE_ANON_KEY=${{ secrets.SUPABASE_ANON_KEY }} \
            --out json=browse-results.json

      - name: Upload Results
        uses: actions/upload-artifact@v3
        with:
          name: k6-results
          path: browse-results.json

      - name: Check Thresholds
        run: |
          if grep -q '"ok": false' browse-results.json; then
            echo "Load test thresholds failed"
            exit 1
          fi
```

### GitLab CI

Create `.gitlab-ci.yml`:

```yaml
load-test:
  stage: test
  image: grafana/k6:latest
  script:
    - k6 run tests/k6-browse-products.js
  only:
    - merge_requests
    - schedules
  artifacts:
    paths:
      - results/
    expire_in: 1 week
```

---

## Analyzing Results

### HTML Report

Install k6-reporter:
```bash
npm install -g k6-to-junit
```

Generate report:
```bash
k6 run --out json=results.json tests/k6-browse-products.js
k6-to-junit results.json > results.xml
```

### Grafana Dashboard

For real-time monitoring, use k6 with InfluxDB + Grafana.

**Setup:**
```bash
# Start InfluxDB
docker run -d -p 8086:8086 influxdb:1.8

# Run k6 with InfluxDB output
k6 run --out influxdb=http://localhost:8086/k6 tests/k6-browse-products.js

# View in Grafana (pre-built k6 dashboard available)
```

### Compare Runs

```bash
# Save baseline
k6 run --out json=baseline.json tests/k6-browse-products.js

# After optimization
k6 run --out json=optimized.json tests/k6-browse-products.js

# Compare (requires jq)
jq '.metrics.http_req_duration.values["p(95)"]' baseline.json
jq '.metrics.http_req_duration.values["p(95)"]' optimized.json
```

---

## Troubleshooting

### Test Fails to Connect

**Error:** `ERRO[0000] connection refused`

**Solutions:**
1. Verify Supabase URL is correct
2. Check internet connectivity
3. Verify API keys are valid
4. Check if Supabase project is paused (free tier)

### High Error Rate (>5%)

**Possible Causes:**
- Rate limiting triggered
- Database connection pool exhausted
- Timeout issues
- Network problems

**Debug:**
```bash
# Increase verbosity
k6 run --verbose tests/k6-browse-products.js

# Check specific error messages in output
```

### Performance Worse Than Expected

**Checklist:**
1. ✅ Database indexes applied?
2. ✅ Pagination implemented?
3. ✅ N+1 queries fixed?
4. ✅ Connection pooling enabled?
5. ✅ Running on production plan (not free tier)?

### Memory Issues on Test Machine

**Error:** `not enough memory`

**Solutions:**
- Reduce number of VUs: `--vus 250`
- Use k6 Cloud for distributed testing
- Upgrade test machine RAM

---

## Best Practices

### Before Testing

1. **Test on Staging First:** Never run load tests on production
2. **Notify Team:** Load tests can trigger alerts
3. **Check Baseline:** Run a single user test first
4. **Warm Up:** Let database caches warm up

### During Testing

1. **Monitor Infrastructure:** Watch CPU, memory, connections
2. **Check Logs:** Look for errors in application logs
3. **Document Results:** Save results for comparison
4. **Test Gradually:** Ramp up load slowly

### After Testing

1. **Analyze Results:** Compare against SLAs
2. **Fix Issues:** Address failures immediately
3. **Retest:** Verify fixes work
4. **Update Docs:** Document findings

---

## Performance Targets (SLAs)

### Latency

| Operation | p50 | p95 | p99 |
|-----------|-----|-----|-----|
| Product Catalog | < 100ms | < 300ms | < 500ms |
| Product Detail | < 50ms | < 200ms | < 300ms |
| Bourse Market Data | < 150ms | < 500ms | < 1000ms |
| Order Creation | < 100ms | < 300ms | < 500ms |
| Cart Operations | < 50ms | < 200ms | < 300ms |

### Availability

- **Uptime:** 99.9% (< 43 minutes downtime per month)
- **Error Rate:** < 0.1% (1 error per 1000 requests)
- **Success Rate:** > 99.9%

### Capacity

- **Concurrent Users:** 500+
- **Requests per Second:** 50+ (normal), 100+ (peak)
- **Database Connections:** < 80% of pool
- **CPU Usage:** < 70% sustained

---

## Resources

### Documentation
- k6 Official Docs: https://k6.io/docs/
- k6 Examples: https://k6.io/docs/examples/
- k6 Best Practices: https://k6.io/docs/testing-guides/running-large-tests/

### Community
- k6 Community Forum: https://community.k6.io/
- k6 GitHub: https://github.com/grafana/k6
- Grafana k6 Blog: https://k6.io/blog/

### Tools
- k6 Cloud: https://app.k6.io/
- k6 Extensions: https://k6.io/docs/extensions/
- k6 Operator (Kubernetes): https://github.com/grafana/k6-operator

---

## Contact

For questions about load testing:
- Check the main project documentation: `LOAD_TESTING_PERFORMANCE_ANALYSIS.md`
- Review database optimizations: `database/migrations/add_performance_indexes_2026_02_02.sql`
- See implementation notes in code comments

---

**Last Updated:** 2026-02-02
**Version:** 1.0
