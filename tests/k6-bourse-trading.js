/**
 * k6 Load Test: Bourse (Market) Trading Scenario
 * Simulates professional users trading on the bourse
 *
 * Run: k6 run tests/k6-bourse-trading.js
 *
 * Expected Results (after optimizations):
 * - p95 response time: < 500ms
 * - Bourse price updates: < 100ms
 * - Order creation: < 300ms
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend, Counter } from 'k6/metrics';

// Custom metrics
const errorRate = new Rate('errors');
const bourseLoadTime = new Trend('bourse_load_time');
const orderCreateTime = new Trend('order_create_time');
const priceUpdateTime = new Trend('price_update_time');
const totalOrders = new Counter('total_orders_created');

// Test configuration for professional users
export const options = {
  stages: [
    { duration: '1m', target: 20 },   // Warm up to 20 pros
    { duration: '2m', target: 50 },   // Ramp up to 50 pros
    { duration: '5m', target: 100 },  // Target: 100 concurrent pro traders
    { duration: '5m', target: 100 },  // Sustain load
    { duration: '2m', target: 0 },    // Ramp down
  ],
  thresholds: {
    // Bourse market data load should be fast
    'http_req_duration{endpoint:bourse}': ['p(95)<500', 'p(99)<1000'],

    // Order creation is critical
    'http_req_duration{endpoint:order_create}': ['p(95)<300', 'p(99)<500'],

    // Price updates should be near real-time
    'http_req_duration{endpoint:price_update}': ['p(95)<100', 'p(99)<200'],

    // Overall error rate
    http_req_failed: ['rate<0.01'],
    errors: ['rate<0.01'],

    // Minimum throughput for bourse
    http_reqs: ['rate>10'],
  },
};

const SUPABASE_URL = __ENV.SUPABASE_URL || 'https://your-project.supabase.co';
const SUPABASE_ANON_KEY = __ENV.SUPABASE_ANON_KEY || 'your-anon-key';

// Mock authenticated users (in real test, would use actual JWT tokens)
const PRO_USERS = Array.from({ length: 100 }, (_, i) => ({
  id: `pro-user-${i}`,
  email: `pro${i}@chanvriers.com`,
  token: SUPABASE_ANON_KEY, // In reality, would be actual JWT
}));

export function setup() {
  console.log('Starting Bourse Trading load test');
  console.log(`Target: ${SUPABASE_URL}`);
  console.log('Simulating 100 concurrent professional traders');

  const response = http.get(`${SUPABASE_URL}/rest/v1/`, {
    headers: {
      'apikey': SUPABASE_ANON_KEY,
      'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
    },
  });

  if (response.status !== 200) {
    console.error(`Setup failed: Unable to connect (status ${response.status})`);
    return null;
  }

  console.log('Setup complete: Ready to trade');
  return {
    supabaseUrl: SUPABASE_URL,
    anonKey: SUPABASE_ANON_KEY,
    users: PRO_USERS,
  };
}

export default function (data) {
  if (!data) {
    console.error('Setup failed, aborting test');
    return;
  }

  // Each VU picks a random pro user
  const userIndex = Math.floor(Math.random() * data.users.length);
  const user = data.users[userIndex];

  const headers = {
    'apikey': data.anonKey,
    'Authorization': `Bearer ${user.token}`,
    'Content-Type': 'application/json',
  };

  // Trading session flow

  // Step 1: Load bourse market data (paginated with cursor)
  const limit = 50;
  const cursor = ''; // In real test, would implement cursor-based pagination

  const bourseStart = Date.now();
  const bourseResponse = http.get(
    `${data.supabaseUrl}/rest/v1/products?` +
    `visible_for_pros=eq.true&` +
    `status=eq.published&` +
    `select=id,name,type,base_price,stock_available,cbd_percent,thc_percent,producer:producers(id,name)&` +
    `order=id.asc&` +
    `limit=${limit}`,
    {
      headers,
      tags: { endpoint: 'bourse' },
    }
  );
  const bourseDuration = Date.now() - bourseStart;
  bourseLoadTime.add(bourseDuration);

  const bourseSuccess = check(bourseResponse, {
    'bourse: status is 200': (r) => r.status === 200,
    'bourse: response time < 500ms': (r) => r.timings.duration < 500,
    'bourse: has products': (r) => {
      try {
        const products = JSON.parse(r.body);
        return Array.isArray(products) && products.length > 0;
      } catch (e) {
        return false;
      }
    },
  });

  if (!bourseSuccess) {
    errorRate.add(1);
    console.error(`Bourse load failed: ${bourseResponse.status}`);
    sleep(5);
    return;
  }

  errorRate.add(0);

  let products = [];
  try {
    products = JSON.parse(bourseResponse.body);
  } catch (e) {
    errorRate.add(1);
    return;
  }

  // Step 2: Fetch pro_orders demand for pricing (batch query)
  // This simulates the optimized batch query instead of N+1
  const productIds = products.map(p => p.id).slice(0, 20); // Take first 20

  if (productIds.length > 0) {
    const priceStart = Date.now();
    const demandResponse = http.get(
      `${data.supabaseUrl}/rest/v1/pro_orders?` +
      `product_id=in.(${productIds.join(',')})&` +
      `status=eq.pending&` +
      `select=product_id,quantity`,
      {
        headers,
        tags: { endpoint: 'price_update' },
      }
    );
    const priceDuration = Date.now() - priceStart;
    priceUpdateTime.add(priceDuration);

    check(demandResponse, {
      'demand: status is 200': (r) => r.status === 200,
      'demand: response time < 100ms': (r) => r.timings.duration < 100,
    });
  }

  // User analyzes market data
  sleep(Math.random() * 10 + 5); // 5-15 seconds

  // Step 3: Create buy orders (30% of users place orders)
  if (Math.random() < 0.3 && products.length > 0) {
    const numOrders = Math.floor(Math.random() * 3) + 1; // 1-3 orders

    for (let i = 0; i < numOrders && i < products.length; i++) {
      const randomProduct = products[Math.floor(Math.random() * products.length)];
      const quantity = Math.floor(Math.random() * 10) + 1; // 1-10 units

      const orderStart = Date.now();
      const orderResponse = http.post(
        `${data.supabaseUrl}/rest/v1/pro_orders`,
        JSON.stringify({
          product_id: randomProduct.id,
          pro_user_id: user.id,
          type: 'buy_request',
          quantity: quantity,
          unit_price: randomProduct.base_price || 10,
          status: 'pending',
        }),
        {
          headers: {
            ...headers,
            'Prefer': 'return=representation',
          },
          tags: { endpoint: 'order_create' },
        }
      );
      const orderDuration = Date.now() - orderStart;
      orderCreateTime.add(orderDuration);

      const orderSuccess = check(orderResponse, {
        'order: status is 201': (r) => r.status === 201 || r.status === 200,
        'order: response time < 300ms': (r) => r.timings.duration < 300,
        'order: has id': (r) => {
          try {
            const data = JSON.parse(r.body);
            return Array.isArray(data) ? data[0]?.id : data?.id;
          } catch (e) {
            return false;
          }
        },
      });

      if (orderSuccess) {
        totalOrders.add(1);
        errorRate.add(0);
      } else {
        errorRate.add(1);
        console.error(`Order creation failed: ${orderResponse.status} - ${orderResponse.body.substring(0, 100)}`);
      }

      sleep(Math.random() * 2 + 1); // 1-3 seconds between orders
    }
  }

  // Step 4: Check my orders status (50% of users)
  if (Math.random() < 0.5) {
    const myOrdersResponse = http.get(
      `${data.supabaseUrl}/rest/v1/pro_orders?` +
      `pro_user_id=eq.${user.id}&` +
      `order=created_at.desc&` +
      `limit=20&` +
      `select=id,product_id,quantity,unit_price,status,created_at`,
      {
        headers,
        tags: { endpoint: 'my_orders' },
      }
    );

    check(myOrdersResponse, {
      'my_orders: status is 200': (r) => r.status === 200,
      'my_orders: response time < 400ms': (r) => r.timings.duration < 400,
    });

    sleep(Math.random() * 3 + 2);
  }

  // Step 5: Poll for price updates (simulate WebSocket polling)
  // 20% of users poll for updates
  if (Math.random() < 0.2) {
    for (let poll = 0; poll < 3; poll++) {
      sleep(10); // Poll every 10 seconds

      const updateStart = Date.now();
      const updateResponse = http.get(
        `${data.supabaseUrl}/rest/v1/products?` +
        `visible_for_pros=eq.true&` +
        `status=eq.published&` +
        `select=id,base_price,stock_available&` +
        `limit=50`,
        {
          headers,
          tags: { endpoint: 'price_update' },
        }
      );
      const updateDuration = Date.now() - updateStart;
      priceUpdateTime.add(updateDuration);

      check(updateResponse, {
        'poll: status is 200': (r) => r.status === 200,
        'poll: response time < 100ms': (r) => r.timings.duration < 100,
      });
    }
  }

  // End of trading session
  sleep(Math.random() * 5 + 3); // 3-8 seconds before next iteration
}

export function teardown(data) {
  console.log('Bourse Trading load test complete');
  console.log(`Total orders created: ${totalOrders.count || 0}`);
}

export function handleSummary(data) {
  const summary = {
    'results/bourse-trading-summary.json': JSON.stringify(data, null, 2),
  };

  // Console output
  let output = '\n═══════════════════════════════════════════════════════════\n';
  output += '           Bourse Trading Load Test Summary\n';
  output += '═══════════════════════════════════════════════════════════\n\n';

  output += `Test Duration: ${(data.state.testRunDurationMs / 1000).toFixed(2)}s\n`;
  output += `VUs: ${data.metrics.vus?.values?.value || 0}\n\n`;

  // Requests
  const httpReqs = data.metrics.http_reqs;
  output += `Total Requests: ${httpReqs?.values?.count || 0}\n`;
  output += `Requests/sec: ${httpReqs?.values?.rate?.toFixed(2) || 0}\n\n`;

  // Response times by endpoint
  output += 'Response Times by Endpoint:\n';
  output += '───────────────────────────────────────────────────────────\n';

  const endpoints = ['bourse', 'order_create', 'price_update', 'my_orders'];
  endpoints.forEach(endpoint => {
    const metric = data.metrics[`http_req_duration{endpoint:${endpoint}}`];
    if (metric) {
      output += `  ${endpoint.padEnd(15)} p95: ${metric.values['p(95)']?.toFixed(2)}ms  `;
      output += `p99: ${metric.values['p(99)']?.toFixed(2)}ms\n`;
    }
  });

  output += '\n';

  // Success rate
  const httpFailed = data.metrics.http_req_failed;
  const successRate = httpFailed ? (1 - httpFailed.values.rate) * 100 : 100;
  output += `Success Rate: ${successRate.toFixed(2)}%\n\n`;

  // Business metrics
  if (data.metrics.total_orders_created) {
    output += `Orders Created: ${data.metrics.total_orders_created.values.count}\n`;
    output += `Orders/sec: ${data.metrics.total_orders_created.values.rate?.toFixed(2) || 0}\n\n`;
  }

  // Thresholds
  output += 'Thresholds:\n';
  output += '───────────────────────────────────────────────────────────\n';
  Object.keys(data.thresholds || {}).forEach(name => {
    const t = data.thresholds[name];
    const passed = t.ok ? '✓' : '✗';
    output += `  ${passed} ${name}\n`;
  });

  output += '\n═══════════════════════════════════════════════════════════\n';

  summary.stdout = output;
  return summary;
}
