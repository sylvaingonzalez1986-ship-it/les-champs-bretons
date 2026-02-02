/**
 * k6 Load Test: Browse Products Scenario
 * Simulates users browsing the product catalog
 *
 * Run: k6 run tests/k6-browse-products.js
 *
 * Expected Results (after optimizations):
 * - p95 response time: < 500ms
 * - Error rate: < 0.1%
 * - Throughput: 50+ RPS
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';

// Custom metrics
const errorRate = new Rate('errors');
const productLoadTime = new Trend('product_load_time');
const catalogLoadTime = new Trend('catalog_load_time');

// Test configuration
export const options = {
  stages: [
    { duration: '1m', target: 50 },   // Warm up to 50 users
    { duration: '2m', target: 100 },  // Ramp up to 100 users
    { duration: '5m', target: 500 },  // Ramp up to target load
    { duration: '5m', target: 500 },  // Sustain 500 users
    { duration: '2m', target: 0 },    // Ramp down
  ],
  thresholds: {
    // 95% of requests should be below 500ms
    http_req_duration: ['p(95)<500'],

    // 99% of requests should be below 1000ms
    'http_req_duration{page:catalog}': ['p(99)<1000'],
    'http_req_duration{page:product}': ['p(99)<800'],

    // Error rate should be below 1%
    http_req_failed: ['rate<0.01'],
    errors: ['rate<0.01'],

    // Minimum throughput
    http_reqs: ['rate>50'], // At least 50 requests per second
  },
  ext: {
    loadimpact: {
      projectID: 3600000, // Replace with your k6 Cloud project ID
      name: 'Browse Products - Production Load Test'
    }
  }
};

// Environment variables
const SUPABASE_URL = __ENV.SUPABASE_URL || 'https://your-project.supabase.co';
const SUPABASE_ANON_KEY = __ENV.SUPABASE_ANON_KEY || 'your-anon-key';

// Test data
const PRODUCT_TYPES = ['fleur', 'huile', 'resine', 'infusion'];
const PAGE_SIZE = 20;

/**
 * Setup function - runs once per VU at start
 */
export function setup() {
  console.log('Starting Browse Products load test');
  console.log(`Target: ${SUPABASE_URL}`);
  console.log('Stages: 50 → 100 → 500 users over 15 minutes');

  // Verify connectivity
  const response = http.get(`${SUPABASE_URL}/rest/v1/`, {
    headers: {
      'apikey': SUPABASE_ANON_KEY,
      'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
    },
  });

  if (response.status !== 200) {
    console.error(`Setup failed: Unable to connect to Supabase (status ${response.status})`);
    return null;
  }

  console.log('Setup complete: Supabase is reachable');
  return { supabaseUrl: SUPABASE_URL, anonKey: SUPABASE_ANON_KEY };
}

/**
 * Main test scenario
 */
export default function (data) {
  if (!data) {
    console.error('Setup failed, aborting test');
    return;
  }

  const headers = {
    'apikey': data.anonKey,
    'Authorization': `Bearer ${data.anonKey}`,
    'Content-Type': 'application/json',
  };

  // User journey: Browse products → View details → Add to cart

  // Step 1: Browse catalog (paginated)
  const page = Math.floor(Math.random() * 5); // Random page 0-4
  const offset = page * PAGE_SIZE;

  const catalogStart = Date.now();
  const catalogResponse = http.get(
    `${data.supabaseUrl}/rest/v1/products?` +
    `select=id,name,price_public,description,image,stock,cbd_percent,thc_percent,disponible_vente_directe,producer:producers(id,name,city)&` +
    `status=eq.published&` +
    `visible_for_clients=eq.true&` +
    `order=name.asc&` +
    `limit=${PAGE_SIZE}&` +
    `offset=${offset}`,
    {
      headers,
      tags: { page: 'catalog' },
    }
  );
  const catalogDuration = Date.now() - catalogStart;
  catalogLoadTime.add(catalogDuration);

  const catalogSuccess = check(catalogResponse, {
    'catalog: status is 200': (r) => r.status === 200,
    'catalog: response time < 500ms': (r) => r.timings.duration < 500,
    'catalog: has products': (r) => {
      try {
        const products = JSON.parse(r.body);
        return Array.isArray(products) && products.length > 0;
      } catch (e) {
        return false;
      }
    },
  });

  if (!catalogSuccess) {
    errorRate.add(1);
    console.error(`Catalog load failed: ${catalogResponse.status} - ${catalogResponse.body.substring(0, 200)}`);
    sleep(Math.random() * 2 + 1);
    return;
  }

  errorRate.add(0);

  // Parse products
  let products = [];
  try {
    products = JSON.parse(catalogResponse.body);
  } catch (e) {
    console.error('Failed to parse catalog response');
    errorRate.add(1);
    return;
  }

  // User reads the catalog
  sleep(Math.random() * 3 + 2); // 2-5 seconds

  // Step 2: View product details (for 1-3 random products)
  const numProductsToView = Math.floor(Math.random() * 3) + 1;

  for (let i = 0; i < numProductsToView && i < products.length; i++) {
    const randomIndex = Math.floor(Math.random() * products.length);
    const product = products[randomIndex];

    if (!product || !product.id) continue;

    const productStart = Date.now();
    const productResponse = http.get(
      `${data.supabaseUrl}/rest/v1/products?` +
      `id=eq.${product.id}&` +
      `select=*,producer:producers(*)`,
      {
        headers,
        tags: { page: 'product' },
      }
    );
    const productDuration = Date.now() - productStart;
    productLoadTime.add(productDuration);

    const productSuccess = check(productResponse, {
      'product: status is 200': (r) => r.status === 200,
      'product: response time < 300ms': (r) => r.timings.duration < 300,
      'product: has data': (r) => {
        try {
          const data = JSON.parse(r.body);
          return Array.isArray(data) && data.length > 0;
        } catch (e) {
          return false;
        }
      },
    });

    if (!productSuccess) {
      errorRate.add(1);
    } else {
      errorRate.add(0);
    }

    // User reads product details
    sleep(Math.random() * 2 + 1); // 1-3 seconds
  }

  // Step 3: Browse by type filter (30% of users)
  if (Math.random() < 0.3) {
    const randomType = PRODUCT_TYPES[Math.floor(Math.random() * PRODUCT_TYPES.length)];

    const filterResponse = http.get(
      `${data.supabaseUrl}/rest/v1/products?` +
      `type=eq.${randomType}&` +
      `status=eq.published&` +
      `visible_for_clients=eq.true&` +
      `select=id,name,price_public,image&` +
      `order=name.asc&` +
      `limit=${PAGE_SIZE}`,
      {
        headers,
        tags: { page: 'catalog', filter: randomType },
      }
    );

    check(filterResponse, {
      'filter: status is 200': (r) => r.status === 200,
      'filter: response time < 600ms': (r) => r.timings.duration < 600,
    });

    sleep(Math.random() * 2 + 1);
  }

  // Step 4: Search producers (20% of users)
  if (Math.random() < 0.2) {
    const producersResponse = http.get(
      `${data.supabaseUrl}/rest/v1/producers?` +
      `select=id,name,city,region,image&` +
      `order=name.asc&` +
      `limit=20`,
      {
        headers,
        tags: { page: 'producers' },
      }
    );

    check(producersResponse, {
      'producers: status is 200': (r) => r.status === 200,
      'producers: response time < 400ms': (r) => r.timings.duration < 400,
    });

    sleep(Math.random() * 2 + 1);
  }

  // End of user session - think time before next iteration
  sleep(Math.random() * 3 + 2); // 2-5 seconds
}

/**
 * Teardown function - runs once at end of test
 */
export function teardown(data) {
  console.log('Browse Products load test complete');
  console.log('Check results above for performance metrics');
}

/**
 * Handle summary - custom report
 */
export function handleSummary(data) {
  return {
    'results/browse-products-summary.json': JSON.stringify(data, null, 2),
    stdout: textSummary(data, { indent: ' ', enableColors: true }),
  };
}

function textSummary(data, opts) {
  const { indent = '', enableColors = false } = opts || {};
  const colorReset = enableColors ? '\x1b[0m' : '';
  const colorGreen = enableColors ? '\x1b[32m' : '';
  const colorRed = enableColors ? '\x1b[31m' : '';
  const colorYellow = enableColors ? '\x1b[33m' : '';

  let summary = `\n${indent}Browse Products Load Test Summary\n`;
  summary += `${indent}${'='.repeat(60)}\n\n`;

  // Test execution
  summary += `${indent}Test Duration: ${data.state.testRunDurationMs / 1000}s\n`;

  // Requests
  const httpReqs = data.metrics.http_reqs;
  summary += `${indent}Total Requests: ${httpReqs.values.count}\n`;
  summary += `${indent}Requests/sec: ${httpReqs.values.rate.toFixed(2)}\n`;

  // Response times
  const httpDuration = data.metrics.http_req_duration;
  summary += `\n${indent}Response Times:\n`;
  summary += `${indent}  p50: ${httpDuration.values['p(50)'].toFixed(2)}ms\n`;
  summary += `${indent}  p95: ${httpDuration.values['p(95)'].toFixed(2)}ms\n`;
  summary += `${indent}  p99: ${httpDuration.values['p(99)'].toFixed(2)}ms\n`;

  // Success/failure
  const httpFailed = data.metrics.http_req_failed;
  const successRate = (1 - httpFailed.values.rate) * 100;
  const color = successRate > 99 ? colorGreen : successRate > 95 ? colorYellow : colorRed;
  summary += `\n${indent}Success Rate: ${color}${successRate.toFixed(2)}%${colorReset}\n`;

  // Thresholds
  summary += `\n${indent}Thresholds:\n`;
  Object.keys(data.thresholds || {}).forEach(name => {
    const t = data.thresholds[name];
    const passed = t.ok;
    const symbol = passed ? '✓' : '✗';
    const thresholdColor = passed ? colorGreen : colorRed;
    summary += `${indent}  ${thresholdColor}${symbol}${colorReset} ${name}\n`;
  });

  summary += `\n${indent}${'='.repeat(60)}\n`;

  return summary;
}
