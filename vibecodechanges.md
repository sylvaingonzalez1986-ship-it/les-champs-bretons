# Vibecode Changes — Load Testing Fixes (Step by Step)

Below is the exact, step-by-step checklist to apply across apps. Each step has the goal, where to change, and what to implement.

---

## Step 1 — Fix N+1 cart enrichment (CRITICAL)
**Goal:** Reduce cart load to 1 request instead of 2N+1.

**Where:**
- src/lib/direct-sales-cart.ts

**Change:**
- Replace per-item product/producer fetches with a single Supabase select expansion:
  - /panier_vente_directe?select=*,product:products(...),producer:producers(...)
- Map `item.product` and `item.producer` directly.

**Status in this app:** ✅ Implemented.

---

## Step 1b — Fix N+1 in catalog (CRITICAL)
**Goal:** Avoid a second producer fetch per catalog load.

**Where:**
- src/app/(tabs)/marche-catalogue.tsx

**Change:**
- Embed producer data in products query (`producer:producers(...)`).
- Use embedded producer from first product and remove separate producer request.

**Status in this app:** ✅ Implemented.

---

## Step 2 — Use Supabase Realtime client for chat (HIGH)
**Goal:** Reduce WebSocket overhead and improve reconnection handling.

**Where:**
- src/lib/supabase-sync.chat.ts

**Change:**
- Replace manual WebSocket management with `@supabase/supabase-js` Realtime channel:
  - `supabase.channel('chat-room').on('postgres_changes', ...)`
- Keep connection status updates and reuse existing callback pattern.

**Status in this app:** ✅ Implemented.

---

## Step 3 — Parallelize image uploads (HIGH)
**Goal:** Upload multiple images faster with a concurrency limit.

**Where:**
- src/lib/supabase-product-images.ts

**Change:**
- Use batched `Promise.allSettled` with configurable `maxConcurrent`.
- Keep partial success behavior (don’t fail whole batch on one error).

**Status in this app:** ✅ Implemented.

---

## Step 3b — Virtualize large lists (HIGH)
**Goal:** Avoid rendering huge lists at once on mobile.

**Where:**
- src/app/(tabs)/marche-catalogue.tsx

**Change:**
- Replace ScrollView + `.map()` with FlatList (virtualized list).
- Keep header, empty state, and “Charger plus” footer in FlatList components.

**Status in this app:** ✅ Implemented.

---

## Step 3c — Virtualize Bourse grid (HIGH)
**Goal:** Avoid rendering all bourse bubbles at once.

**Where:**
- src/components/BourseBubbleGrid.tsx

**Change:**
- Replace ScrollView grid with FlatList (virtualized).
- Move summary/legend to ListHeader/ListFooter.

**Status in this app:** ✅ Implemented.

---

## Step 3d — Prevent Local Market orders memory growth (MEDIUM)
**Goal:** Avoid unbounded memory growth in local orders store.

**Where:**
- src/lib/local-market-orders.ts

**Change:**
- Cap stored orders list to a max size when loading/paginating.

**Status in this app:** ✅ Implemented.

---

## Step 4 — Add pagination helpers (CRITICAL)
**Goal:** Avoid loading entire datasets into memory.

**Where:**
- src/lib/supabase-sync.catalog.ts (fetchProducers, fetchProducts)
- src/lib/supabase-sync.orders.ts (fetchOrders)
- src/lib/supabase-sync.chat.ts (fetchChatMessages)

**Change:**
- Add optional `limit` + `offset` (or cursor) parameters.
- Return `nextCursor` so UI can fetch the next page.

**Status in this app:** ✅ Helpers added (UI still needs to use them).

---

## Step 4c — Use pagination in full sync (MEDIUM)
**Goal:** Avoid single massive producers/products fetch.

**Where:**
- src/lib/supabase-sync.catalog.ts

**Change:**
- Page through producers/products in `fetchAllProducersWithProducts()`.

**Status in this app:** ✅ Implemented.

---

## Step 4b — Add pagination + batch demand in Bourse (CRITICAL)
**Goal:** Avoid loading all bourse products and remove N+1 demand queries.

**Where:**
- src/lib/supabase-bourse.ts
- src/lib/bourse-store.ts
- src/app/(tabs)/bourse.tsx
- src/components/BourseBubbleGrid.tsx

**Change:**
- Implement cursor-based pagination in `fetchBourseProducts({ limit, cursor, type })`.
- Batch fetch pro demand with a single `pro_orders` query using `in.(...)`.
- Add `nextCursor`, `isLoadingMore`, and `loadMoreMarketData()` to the store.
- Surface “Charger plus” in the bourse grid to load the next page.

**Status in this app:** ✅ Implemented.

---

## Step 5 — Update UI to use pagination (CRITICAL)
**Goal:** Actually consume pagination in screens (infinite scroll / load more).

**Where:**
- src/app/(tabs)/marche-local.tsx
- src/app/(tabs)/marche-catalogue.tsx
- src/app/(tabs)/ma-boutique.tsx (orders)
- src/app/(tabs)/chat-producteurs.tsx

**Change:**
- Use React Query `useInfiniteQuery` or local page state.
- Append results and request next page when user scrolls.

**Status in this app:** ✅ Implemented (chat + marche-catalogue + ma-boutique orders + marche-local pagination added).

---

## Step 5b — Paginate Local Market orders (HIGH)
**Goal:** Avoid loading all local market orders at once.

**Where:**
- src/lib/local-market-orders.ts
- src/app/mes-commandes-marche-local.tsx

**Change:**
- Add `limit/offset` support to `loadOrders()` with append mode.
- Use a simple “Charger plus” flow on the user’s local market orders screen.

**Status in this app:** ✅ Implemented.

---

## Step 5c — Paginate Producer Direct Sales (HIGH)
**Goal:** Avoid loading all producer direct-sale orders at once.

**Where:**
- src/lib/local-market-orders.ts
- src/app/(tabs)/ma-boutique.tsx

**Change:**
- Add `limit/offset` usage for producer orders.
- Add “Charger plus” in the producer direct sales tab.

**Status in this app:** ✅ Implemented.

---

## Step 6 — Cache catalog data (HIGH)
**Goal:** Reduce cold-start time and repeated fetches.

**Where:**
- React Query initialization (QueryClient defaultOptions)
- Screens that load producers/products

**Change:**
- `staleTime: 10 minutes`, `gcTime: 1 hour` for catalog queries.
- Keep background revalidation enabled.

**Status in this app:** ✅ Implemented (global defaults updated).

---

## Step 7 — Rate-limit Edge Functions (CRITICAL)
**Goal:** Prevent abuse and spikes on mutations.

**Where:**
- supabase/functions/*/index.ts
- supabase/functions/_shared/middleware.ts

**Change:**
- Ensure all mutation functions use `createValidatedHandler` with `RATE_LIMIT_PRESETS`.

**Status in this app:** ✅ Implemented (added to products/packs/orders/promo/exports/app-data-admin/user-gifts/user-lots).

---

## Step 8 — Reduce retry amplification (HIGH)
**Goal:** Avoid retry storms during outages.

**Where:**
- src/lib/supabase-sync-core.ts

**Change:**
- Lower default retries for Supabase fetches from 3 → 2.

**Status in this app:** ✅ Implemented.

---

## Step 8b — Optimize image URLs (MEDIUM)
**Goal:** Reduce image payload sizes for list views.

**Where:**
- src/lib/image-utils.ts
- src/app/(tabs)/marche-catalogue.tsx
- src/app/(tabs)/marche-local.tsx

**Change:**
- Add a helper to transform Supabase/Unsplash URLs to sized, compressed variants.
- Use optimized URLs for product and producer images in list views.

**Status in this app:** ✅ Implemented.

---

## Step 9 — Throttle chat message sends (HIGH)
**Goal:** Reduce message burst load on realtime.

**Where:**
- src/lib/supabase-sync.chat.ts

**Change:**
- Client-side throttle: max 5 messages per 10 seconds per sender.

**Status in this app:** ✅ Implemented.

---

## Step 10 — Reduce JSON containment queries (MEDIUM)
**Goal:** Avoid slow `items @> [...]` scans.

**Where:**
- database schema (orders)
- src/lib/supabase-sync.orders.ts

**Change:**
- Create `order_items` junction table + indexes.
- Replace JSONB filter with indexed join.

**Status in this app:** ✅ Implemented (migration added + query updated with fallback).

---

## Step 10b — Add missing performance indexes (HIGH)
**Goal:** Speed up bourse, cart, and local market queries.

**Where:**
- supabase/migrations/20260202_add_performance_indexes.sql

**Change:**
- Add indexes for bourse pagination, pro_orders demand, cart load, product stock lookup, and local market orders.

**Status in this app:** ✅ Implemented (migration added).

---

## Step 11 — Add monitoring hooks (MEDIUM)
**Goal:** Track performance under load.

**Where:**
- App initialization (Sentry)
- Key flows (cart, order creation, uploads)

**Change:**
- Add custom metrics for cart enrichment, order creation, upload duration.

**Status in this app:** ⚠️ Partially implemented (local logging + edge metrics pipeline; external monitoring still pending).

---

## Step 11b — Persist performance metrics (MEDIUM)
**Goal:** Store performance metrics server-side for later analysis.

**Where:**
- supabase/migrations/20260202_create_perf_metrics_table.sql
- supabase/functions/perf-metrics/index.ts
- src/lib/perf-metrics.ts

**Change:**
- Add `perf_metrics` table (RLS enabled, service role inserts).
- Add `perf-metrics` Edge Function with rate limiting.
- Batch-send metrics from app to Edge Function.

**Status in this app:** ✅ Implemented.

---

## Step 12 — Validate upload size server-side (MEDIUM)
**Goal:** Block oversized uploads and protect bandwidth.

**Where:**
- Supabase Edge Functions or storage upload validation

**Change:**
- Enforce file size limits and MIME checks server-side.

**Status in this app:** ✅ Implemented (Supabase migration added + client RPC call).

---

# Summary
Completed: Steps 1–5, 6–10, 12, 1b, 3b, 3c, 3d, 4b, 4c, 5b, 5c, 8b, 10b, 11b.
Partially completed: Step 11.
Remaining: External monitoring setup (Step 11).

Estimated completion: ~99% (core fixes done; external monitoring/pooling still pending).
