"""
Locust Load Test - Producer Dashboard Scenario
Tests producer-specific features: view orders, update status, upload images, chat
Validates query performance with JSON containment filters

Run: locust -f load-tests/locust-producer-dashboard.py --users 20 --spawn-rate 2
Web UI: http://localhost:8089
"""

import os
import time
import json
import random
from locust import HttpUser, task, between, events
from locust.exception import StopUser

# Environment variables
SUPABASE_URL = os.getenv('SUPABASE_URL', 'https://your-project.supabase.co')
ANON_KEY = os.getenv('SUPABASE_ANON_KEY', 'your-anon-key')
PRODUCER_EMAIL = os.getenv('TEST_PRODUCER_EMAIL', 'producer@test.com')
PRODUCER_PASSWORD = os.getenv('TEST_PRODUCER_PASSWORD', 'test123')

# Test data
SAMPLE_PRODUCER_IDS = [
    'producer-1', 'producer-2', 'producer-3', 'producer-4', 'producer-5',
    'producer-6', 'producer-7', 'producer-8', 'producer-9', 'producer-10'
]

ORDER_STATUSES = ['pending', 'confirmed', 'ready', 'completed']

# Global metrics
successful_order_queries = 0
failed_order_queries = 0
slow_queries = []

class ProducerUser(HttpUser):
    """Simulates a producer using the dashboard"""

    wait_time = between(2, 5)  # Wait 2-5 seconds between tasks
    host = SUPABASE_URL

    def on_start(self):
        """Login as producer when user starts"""
        self.login()
        self.producer_id = random.choice(SAMPLE_PRODUCER_IDS)
        self.access_token = None

    def login(self):
        """Authenticate as producer"""
        response = self.client.post(
            "/auth/v1/token?grant_type=password",
            json={
                "email": PRODUCER_EMAIL,
                "password": PRODUCER_PASSWORD
            },
            headers={
                "apikey": ANON_KEY,
                "Content-Type": "application/json"
            },
            name="/auth/login"
        )

        if response.status_code == 200:
            data = response.json()
            self.access_token = data['access_token']
            self.user_id = data['user']['id']
            print(f"✅ Producer {self.user_id} logged in")
        else:
            print(f"❌ Login failed: {response.status_code}")
            raise StopUser()

    def get_headers(self):
        """Get authenticated headers"""
        return {
            "apikey": ANON_KEY,
            "Authorization": f"Bearer {self.access_token}",
            "Content-Type": "application/json"
        }

    @task(5)
    def view_orders_for_producer(self):
        """
        CRITICAL PATH: Query orders filtered by producer_id
        Tests JSON containment query performance
        This is the SLOW QUERY we want to optimize
        """
        start_time = time.time()

        # Current implementation: uses JSONB containment operator
        # This requires full table scan without proper indexing
        response = self.client.get(
            f"/rest/v1/orders?items=cs.[{{\"producer_id\":\"{self.producer_id}\"}}]&order=created_at.desc&limit=50",
            headers=self.get_headers(),
            name="/orders [producer_filter]"
        )

        duration = (time.time() - start_time) * 1000  # Convert to ms

        global successful_order_queries, failed_order_queries, slow_queries

        if response.status_code == 200:
            orders = response.json()
            successful_order_queries += 1

            # Track slow queries (>1s)
            if duration > 1000:
                slow_queries.append({
                    'producer_id': self.producer_id,
                    'duration_ms': duration,
                    'order_count': len(orders)
                })
                print(f"🐌 SLOW QUERY: {duration:.0f}ms for {len(orders)} orders (producer: {self.producer_id})")

            return orders
        else:
            failed_order_queries += 1
            print(f"❌ Order query failed: {response.status_code}")
            return []

    @task(3)
    def view_order_details(self):
        """View details of a specific order"""
        # First get orders list
        orders = self.view_orders_for_producer()

        if orders:
            order_id = orders[0]['id']

            self.client.get(
                f"/rest/v1/orders?id=eq.{order_id}&select=*",
                headers=self.get_headers(),
                name="/orders [single]"
            )

    @task(2)
    def update_order_status(self):
        """Update order status (producer confirms/rejects order)"""
        # Get a pending order
        response = self.client.get(
            f"/rest/v1/orders?items=cs.[{{\"producer_id\":\"{self.producer_id}\"}}]&status=eq.pending&limit=1",
            headers=self.get_headers(),
            name="/orders [pending]"
        )

        if response.status_code == 200:
            orders = response.json()
            if orders:
                order_id = orders[0]['id']
                new_status = random.choice(['confirmed', 'ready'])

                # Update order status via Edge Function
                self.client.post(
                    "/functions/v1/orders-update",
                    json={
                        "id": order_id,
                        "updates": {
                            "status": new_status,
                            "updated_at": time.strftime("%Y-%m-%dT%H:%M:%S.000Z")
                        }
                    },
                    headers=self.get_headers(),
                    name="/functions/orders-update"
                )

    @task(1)
    def upload_product_image(self):
        """
        Simulate product image upload
        Tests storage bandwidth and concurrent upload limits
        """
        # Simulate a 2MB image (random bytes)
        fake_image = b"0" * (2 * 1024 * 1024)  # 2MB of zeros

        product_id = f"product-{random.randint(1, 100)}"
        timestamp = int(time.time() * 1000)
        file_path = f"{self.producer_id}/{product_id}/{timestamp}.jpg"

        # Upload to Supabase Storage
        self.client.post(
            f"/storage/v1/object/product-images/{file_path}",
            data=fake_image,
            headers={
                "apikey": ANON_KEY,
                "Authorization": f"Bearer {self.access_token}",
                "Content-Type": "image/jpeg",
                "x-upsert": "true"
            },
            name="/storage/upload [image]",
            timeout=30  # Longer timeout for uploads
        )

    @task(2)
    def send_chat_message(self):
        """Send a message in producer chat"""
        messages = [
            "Bonjour, nouvelle récolte disponible !",
            "Stock mis à jour",
            "Livraison prévue demain",
            "Produits bio disponibles",
            "Question sur les commandes ?"
        ]

        self.client.post(
            "/rest/v1/chat_messages",
            json={
                "sender_id": self.user_id,
                "sender_name": f"Producteur {self.producer_id}",
                "producer_name": f"Producteur {self.producer_id}",
                "message": random.choice(messages)
            },
            headers=self.get_headers(),
            name="/chat/send"
        )

    @task(1)
    def fetch_chat_messages(self):
        """Fetch recent chat messages"""
        self.client.get(
            "/rest/v1/chat_messages?order=created_at.desc&limit=50",
            headers=self.get_headers(),
            name="/chat/fetch"
        )

    @task(4)
    def view_producer_profile(self):
        """View own producer profile"""
        self.client.get(
            f"/rest/v1/producers?id=eq.{self.producer_id}&select=*",
            headers=self.get_headers(),
            name="/producers [profile]"
        )

    @task(3)
    def view_products_catalog(self):
        """View products in catalog"""
        self.client.get(
            f"/rest/v1/products?producer_id=eq.{self.producer_id}&select=*&order=name.asc",
            headers=self.get_headers(),
            name="/products [catalog]"
        )

# Event listeners for custom reporting
@events.test_stop.add_listener
def on_test_stop(environment, **kwargs):
    """Print summary when test stops"""
    print("\n" + "="*60)
    print("🏁 Producer Dashboard Load Test Complete")
    print("="*60)
    print(f"✅ Successful order queries: {successful_order_queries}")
    print(f"❌ Failed order queries: {failed_order_queries}")

    if slow_queries:
        print(f"\n🐌 SLOW QUERIES DETECTED: {len(slow_queries)}")
        print("\nSlowest queries:")
        sorted_slow = sorted(slow_queries, key=lambda x: x['duration_ms'], reverse=True)[:5]
        for i, query in enumerate(sorted_slow, 1):
            print(f"  {i}. {query['duration_ms']:.0f}ms - Producer: {query['producer_id']} - Orders: {query['order_count']}")

        print("\n⚠️  ACTION REQUIRED:")
        print("   - Add GIN index on orders.items JSONB column")
        print("   - OR migrate to order_items junction table")
        print("   - SQL: CREATE INDEX idx_orders_items_gin ON orders USING gin(items);")
    else:
        print("\n✅ No slow queries detected (all queries <1s)")

    print("="*60)

# Custom reporting during test
@events.request.add_listener
def on_request(request_type, name, response_time, response_length, exception, **kwargs):
    """Monitor requests in real-time"""
    if exception:
        print(f"❌ Request failed: {name} - {exception}")
    elif response_time > 2000:
        print(f"⚠️  Slow request: {name} - {response_time:.0f}ms")

if __name__ == "__main__":
    print("""
    🚀 Producer Dashboard Load Test
    --------------------------------
    This test simulates 20 producers using the dashboard simultaneously.

    What it tests:
    - Order queries with JSON containment filters (SLOW - needs optimization)
    - Order status updates
    - Product image uploads
    - Chat functionality
    - Producer profile views

    Expected bottlenecks:
    - JSON containment queries will be SLOW (>1s) with large datasets
    - Image uploads may saturate bandwidth
    - Database connection pool may be exhausted

    Run with:
    locust -f load-tests/locust-producer-dashboard.py --users 20 --spawn-rate 2 --run-time 10m

    Or with web UI:
    locust -f load-tests/locust-producer-dashboard.py
    Then open: http://localhost:8089
    """)
