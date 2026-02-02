/**
 * k6 Load Test - Baseline User Browsing
 * Tests normal user behavior: browse products, add to cart, view cart
 *
 * Run: k6 run --env SUPABASE_URL=your_url --env ANON_KEY=your_key load-tests/k6-baseline.js
 */

import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { Rate, Trend, Counter } from 'k6/metrics';

// Environment variables
const SUPABASE_URL = __ENV.SUPABASE_URL || 'https://your-project.supabase.co';
const ANON_KEY = __ENV.ANON_KEY || 'your-anon-key';
const TEST_USER_EMAIL = __ENV.TEST_USER_EMAIL || 'test@example.com';
const TEST_USER_PASSWORD = __ENV.TEST_USER_PASSWORD || 'test123';

// Custom metrics
const cartEnrichmentTime = new Trend('cart_enrichment_time');
const catalogLoadTime = new Trend('catalog_load_time');
const errorRate = new Rate('errors');
const successfulOrders = new Counter('successful_orders');

// Load test configuration
export const options = {
  stages: [
    { duration: '2m', target: 20 },   // Ramp up to 20 users
    { duration: '5m', target: 50 },   // Ramp up to 50 users
    { duration: '5m', target: 100 },  // Ramp up to 100 users
    { duration: '5m', target: 100 },  // Stay at 100 users
    { duration: '2m', target: 0 },    // Ramp down
  ],
  thresholds: {
    // 95% of requests should be below 1s
    http_req_duration: ['p(95)<1000'],
    // Less than 1% errors
    errors: ['rate<0.01'],
    // 95% of catalog loads should be below 500ms
    catalog_load_time: ['p(95)<500'],
    // 95% of cart enrichments should be below 2s (will improve with fixes)
    cart_enrichment_time: ['p(95)<2000'],
  },
  // Disable cert validation for local testing
  insecureSkipTLSVerify: true,
};

// Generate unique test user ID
function generateUserId() {
  return `test-user-${__VU}-${__ITER}`;
}

// Setup: Login and get access token (runs once per VU)
export function setup() {
  console.log('🚀 Starting load test setup...');

  // Test auth endpoint availability
  const healthCheck = http.get(`${SUPABASE_URL}/rest/v1/`);
  if (healthCheck.status !== 200 && healthCheck.status !== 404) {
    console.error(`❌ Supabase not reachable. Status: ${healthCheck.status}`);
    throw new Error('Supabase endpoint not available');
  }

  console.log('✅ Supabase endpoint is reachable');

  // Login to get access token
  const loginResponse = http.post(
    `${SUPABASE_URL}/auth/v1/token?grant_type=password`,
    JSON.stringify({
      email: TEST_USER_EMAIL,
      password: TEST_USER_PASSWORD,
    }),
    {
      headers: {
        'Content-Type': 'application/json',
        'apikey': ANON_KEY,
      },
    }
  );

  if (loginResponse.status === 200) {
    const loginData = JSON.parse(loginResponse.body);
    console.log('✅ Successfully authenticated test user');
    return {
      accessToken: loginData.access_token,
      userId: loginData.user.id,
    };
  } else {
    console.warn('⚠️ Could not authenticate - using anonymous access');
    return {
      accessToken: ANON_KEY,
      userId: 'anonymous',
    };
  }
}

// Main test scenario
export default function (data) {
  const headers = {
    'Content-Type': 'application/json',
    'apikey': ANON_KEY,
    'Authorization': `Bearer ${data.accessToken}`,
  };

  // Scenario 1: Browse Producers Catalog
  group('Browse Producers', () => {
    const startTime = Date.now();

    const producersResponse = http.get(
      `${SUPABASE_URL}/rest/v1/producers?select=*&order=name.asc&limit=20`,
      { headers }
    );

    const duration = Date.now() - startTime;
    catalogLoadTime.add(duration);

    const success = check(producersResponse, {
      'producers loaded': (r) => r.status === 200,
      'producers has data': (r) => {
        if (r.status !== 200) return false;
        const producers = JSON.parse(r.body);
        return Array.isArray(producers) && producers.length > 0;
      },
    });

    errorRate.add(!success);

    if (success) {
      const producers = JSON.parse(producersResponse.body);
      console.log(`📦 Loaded ${producers.length} producers in ${duration}ms`);
    }
  });

  sleep(1); // User reads producer list

  // Scenario 2: Browse Products
  group('Browse Products', () => {
    const productsResponse = http.get(
      `${SUPABASE_URL}/rest/v1/products?select=*&order=name.asc&limit=20`,
      { headers }
    );

    const success = check(productsResponse, {
      'products loaded': (r) => r.status === 200,
      'products has data': (r) => {
        if (r.status !== 200) return false;
        const products = JSON.parse(r.body);
        return Array.isArray(products);
      },
    });

    errorRate.add(!success);
  });

  sleep(2); // User browses products

  // Scenario 3: Add to Cart (simulated)
  group('Add to Cart', () => {
    // Simulate adding 3 products to cart
    const testProductId = 'test-product-1';
    const testProducerId = 'test-producer-1';

    const cartAddResponse = http.post(
      `${SUPABASE_URL}/rest/v1/panier_vente_directe`,
      JSON.stringify({
        user_id: data.userId,
        product_id: testProductId,
        producer_id: testProducerId,
        quantity: 1,
      }),
      { headers }
    );

    check(cartAddResponse, {
      'item added to cart': (r) => r.status === 201 || r.status === 200,
    });
  });

  sleep(1);

  // Scenario 4: Load Cart (N+1 query problem test)
  group('Load Cart with Enrichment', () => {
    const startTime = Date.now();

    // Load cart items
    const cartResponse = http.get(
      `${SUPABASE_URL}/rest/v1/panier_vente_directe?user_id=eq.${data.userId}&order=created_at.desc`,
      { headers }
    );

    if (cartResponse.status === 200) {
      const cartItems = JSON.parse(cartResponse.body);

      // Simulate N+1 problem: for each item, fetch product and producer
      // This is the BOTTLENECK we want to fix
      cartItems.forEach((item) => {
        // Fetch product details (N queries)
        http.get(
          `${SUPABASE_URL}/rest/v1/products?id=eq.${item.product_id}&select=name,price_public,image`,
          { headers }
        );

        // Fetch producer details (N queries)
        http.get(
          `${SUPABASE_URL}/rest/v1/producers?id=eq.${item.producer_id}&select=name`,
          { headers }
        );
      });

      const duration = Date.now() - startTime;
      cartEnrichmentTime.add(duration);

      console.log(`🛒 Cart with ${cartItems.length} items loaded in ${duration}ms (N+1 problem)`);
    }
  });

  sleep(3); // User reviews cart

  // Scenario 5: Create Order (Edge Function test)
  group('Create Order', () => {
    const orderPayload = {
      items: [
        {
          productId: 'test-product-1',
          producerId: 'test-producer-1',
          quantity: 2,
        },
      ],
    };

    const orderResponse = http.post(
      `${SUPABASE_URL}/functions/v1/create-direct-sale-orders`,
      JSON.stringify(orderPayload),
      { headers }
    );

    const success = check(orderResponse, {
      'order created': (r) => r.status === 200,
    });

    if (success) {
      successfulOrders.add(1);
    } else {
      errorRate.add(1);
      console.error(`❌ Order creation failed: ${orderResponse.status} - ${orderResponse.body}`);
    }
  });

  sleep(5); // User waits before next action
}

// Teardown: Print summary
export function teardown(data) {
  console.log('');
  console.log('='.repeat(60));
  console.log('🏁 Load Test Complete');
  console.log('='.repeat(60));
  console.log(`Test User: ${data.userId}`);
  console.log('');
  console.log('📊 Key Findings:');
  console.log('- Check cart_enrichment_time metric for N+1 query impact');
  console.log('- Compare catalog_load_time before/after caching');
  console.log('- Monitor error rate - should be <1%');
  console.log('');
  console.log('Next Steps:');
  console.log('1. Fix N+1 queries in cart enrichment (use Supabase foreign key expansion)');
  console.log('2. Add pagination to catalog endpoints');
  console.log('3. Implement caching for frequently accessed data');
  console.log('='.repeat(60));
}
