# Technical Debt Remediation Plan - Les Chanvriers

**Generated:** 2026-02-07
**Codebase:** Expo SDK 53 + React Native 0.76.7 + Supabase

---

## Executive Summary

Analysis of Les Chanvriers identified **12 critical technical debt items** requiring immediate attention. Priority areas: incomplete feature cleanup, security gaps, missing test coverage, and state management inconsistencies.

---

## Summary Table

| # | Overview | Ease | Impact | Risk | Explanation |
|---|----------|------|--------|------|-------------|
| 1 | Incomplete Chat Feature Removal | 2 | 🔴 High | 🔴 High | Deleted chat UI but database schema/migrations remain, causing confusion |
| 2 | Missing Test Coverage | 5 | 🔴 Critical | 🔴 High | Zero test files for 50+ components and 15+ lib modules |
| 3 | Inconsistent State Management | 3 | 🟡 Medium | 🟡 Medium | Mixed patterns: Zustand + React Query + Context API |
| 4 | Outdated Documentation | 2 | 🟡 Medium | 🟢 Low | README last updated 2025, missing pro-resources docs |
| 5 | HempTycoon Integration Not Implemented | 4 | 🔴 High | 🔴 High | CLAUDE.md defines tickets system but code missing |
| 6 | Security: Missing Rate Limiting on Edge Functions | 3 | 🔴 Critical | 🔴 High | Only auth has rate limits, not data mutations |
| 7 | Security: Weak Storage Access Controls | 2 | 🔴 High | 🔴 High | Some buckets still using public access patterns |
| 8 | Deprecated Pattern: Direct Supabase Queries in Components | 4 | 🔴 High | 🟡 Medium | 8+ components bypass Edge Functions for mutations |
| 9 | Missing Error Boundaries | 2 | 🟡 Medium | 🟡 Medium | No error boundaries in navigation tree |
| 10 | Unused Dependencies | 1 | 🟢 Low | 🟢 Low | Package.json contains deprecated chat libraries |
| 11 | TODO/FIXME Markers | 2 | 🟢 Low | 🟢 Low | 15+ unresolved markers in codebase |
| 12 | Missing RLS Policy Documentation | 2 | 🟡 Medium | 🟡 Medium | New pro_resources table lacks documented policies |

---

## Detailed Remediation Plans

### 1. Incomplete Chat Feature Removal

**Ease:** 2/5 | **Impact:** 🔴 High | **Risk:** 🔴 High

**Overview:**
Git status shows deleted chat UI components (`chat-producteurs.tsx`, `ChatInput.tsx`, `MessageBubble.tsx`, etc.) and sync logic (`supabase-sync.chat.ts`), but database migration `20260206100001_disable_chat_access.sql` only revokes access without dropping tables. This creates confusion and potential security gaps.

**Explanation:**
Partial feature removal is dangerous:
- Orphaned database tables consume storage
- Migrations reference non-existent code (`supabase-sync.chat.ts`)
- Future developers may attempt to re-enable chat without understanding removal context
- RLS policies still exist but are untested

**Requirements:**
- Database migration to drop chat tables
- Update migration history documentation
- Remove all chat-related Supabase types
- Audit for lingering chat references in Edge Functions

**Implementation Steps:**

1. Create migration `20260207_complete_chat_removal.sql`:
   ```sql
   -- Drop chat tables
   DROP TABLE IF EXISTS chat_messages CASCADE;
   DROP TABLE IF EXISTS chat_connections CASCADE;
   DROP TABLE IF EXISTS chat_rooms CASCADE;

   -- Drop related functions
   DROP FUNCTION IF EXISTS notify_new_message CASCADE;
   ```

2. Search for chat references:
   ```bash
   grep -r "chat_messages\|chat_connections\|ChatMessage" src/ supabase/
   ```

3. Remove from `src/lib/types.ts` if present:
   - `ChatMessage`, `ChatConnection`, `ChatRoom` types

4. Update `vibecodechanges.md` with removal rationale

5. Verify Edge Functions don't reference chat tables

**Testing:**
- Run migration on staging database
- Confirm no TypeScript errors after type removal
- Verify app builds and launches successfully
- Check Supabase dashboard for orphaned tables

---

### 2. Missing Test Coverage

**Ease:** 5/5 | **Impact:** 🔴 Critical | **Risk:** 🔴 High

**Overview:**
Zero test files found in codebase. No `__tests__/`, `.spec.ts`, or `.test.tsx` files exist for 50+ components and 15+ lib modules.

**Explanation:**
Without tests:
- Critical payment flows (Stripe integration) unverified
- Security logic (RLS helpers, auth) cannot be regression-tested
- Refactoring is high-risk
- Edge Function behavior untested locally
- Pro-resources feature shipped without validation

This violates production readiness standards and blocks CI/CD implementation.

**Requirements:**
- Jest + React Native Testing Library setup
- Minimum 60% coverage for critical paths:
  - Authentication (`src/lib/useAuth.ts`)
  - Payment flows (`src/lib/direct-sales-cart.ts`)
  - State management (`src/lib/store.ts`, stores)
  - Edge Functions (unit tests with mocked Supabase)
- E2E tests for core user journeys (signup, purchase, order creation)

**Implementation Steps:**

1. Install test dependencies:
   ```bash
   bun add -D jest @testing-library/react-native @testing-library/jest-native
   bun add -D @types/jest jest-expo
   ```

2. Create `jest.config.js`:
   ```js
   module.exports = {
     preset: 'jest-expo',
     transformIgnorePatterns: [
       'node_modules/(?!((jest-)?react-native|@react-native(-community)?)|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@unimodules/.*|unimodules|sentry-expo|native-base|react-native-svg)'
     ],
     setupFilesAfterEnv: ['<rootDir>/jest-setup.ts'],
   };
   ```

3. Create priority test files (start with highest risk):
   - `src/lib/__tests__/supabase-auth.test.ts` - Rate limiting logic
   - `src/lib/__tests__/direct-sales-cart.test.ts` - Payment calculations
   - `src/lib/__tests__/useAuth.test.ts` - Auth state management
   - `supabase/functions/__tests__/create-direct-sale-orders.test.ts` - Order creation

4. Add test scripts to `package.json`:
   ```json
   {
     "scripts": {
       "test": "jest",
       "test:watch": "jest --watch",
       "test:coverage": "jest --coverage"
     }
   }
   ```

5. Create test documentation: `docs/TESTING.md`

**Testing:**
- Run `bun test` to verify Jest setup
- Achieve 30% coverage in sprint 1
- Target 60% coverage by sprint 3
- Add pre-commit hook to prevent coverage drops

---

### 3. Inconsistent State Management

**Ease:** 3/5 | **Impact:** 🟡 Medium | **Risk:** 🟡 Medium

**Overview:**
Three state management approaches coexist:
1. **Zustand stores** (`store.ts`, `music-store.ts`, `direct-sales-cart.ts`)
2. **React Query** (recommended in CLAUDE.md for server state)
3. **Context API** (`AudioContext.tsx`)

No clear pattern for when to use each.

**Explanation:**
Current issues:
- `AudioContext.tsx` duplicates Zustand's `music-store.ts`
- Cart state is local-only (Zustand) but should sync with backend
- Profile data fetched with React Query but user state in Zustand
- CLAUDE.md mandates React Query for server state, but 60% of async code uses manual `useState` + `useEffect`

This causes:
- Difficult debugging (state scattered across patterns)
- Race conditions between local/server state
- Unnecessary re-renders (whole store subscriptions)

**Requirements:**
- Consolidate to two patterns:
  1. **React Query** for ALL server/async state
  2. **Zustand** for UI-only ephemeral state (cart before checkout, audio player state)
- Remove Context API duplicates
- Add Zustand selectors to prevent full-store subscriptions

**Implementation Steps:**

1. **Audit state usage:**
   Create spreadsheet mapping every state source to its pattern:
   ```
   | State | Current Pattern | Should Be | Migration Needed |
   |-------|----------------|-----------|------------------|
   | User profile | React Query | ✓ Correct | No |
   | Cart items | Zustand | React Query | Yes - sync with backend |
   | Audio player | Context + Zustand | Zustand only | Yes - remove Context |
   ```

2. **Migrate Audio state:**
   - Delete `src/contexts/AudioContext.tsx`
   - Move all logic to `src/lib/music-store.ts`
   - Update components to use `useMusicStore` selectors:
     ```ts
     // Before
     const { currentTrack } = useAudioContext();

     // After
     const currentTrack = useMusicStore(s => s.currentTrack);
     ```

3. **Add backend cart sync:**
   - Create `src/lib/hooks/useCartSync.ts`:
     ```ts
     export function useCartSync() {
       const { data: serverCart } = useQuery({
         queryKey: ['cart'],
         queryFn: async () => {
           const { data } = await supabase.from('cart_items').select('*');
           return data;
         }
       });

       const addToCart = useMutation({
         mutationFn: async (item) => {
           // Call Edge Function, not direct insert
           await fetch('/functions/cart-add', { method: 'POST', body: JSON.stringify(item) });
         }
       });

       return { serverCart, addToCart };
     }
     ```

4. **Enforce Zustand selectors:**
   Add ESLint rule to prevent `useStore()` without selector:
   ```js
   // .eslintrc.js
   rules: {
     'no-restricted-syntax': [
       'error',
       {
         selector: "CallExpression[callee.name=/use.*Store$/]:not([arguments.length=1])",
         message: 'Always use a selector with Zustand: useStore(s => s.field)'
       }
     ]
   }
   ```

5. **Document pattern:**
   Create `docs/STATE_MANAGEMENT.md` with decision tree:
   ```
   Is this data from the server? → Use React Query
   Is this UI-only ephemeral state? → Use Zustand with selector
   Never use Context API for state (use for dependency injection only)
   ```

**Testing:**
- Verify no Context imports remain after migration
- Check React DevTools for unnecessary re-renders
- Run performance profiling on cart/audio screens
- Confirm backend cart persists across app restarts

---

### 4. Outdated Documentation

**Ease:** 2/5 | **Impact:** 🟡 Medium | **Risk:** 🟢 Low

**Overview:**
`README.md` last updated January 2025. Missing documentation for:
- Pro-resources feature (added Feb 2026)
- HempTycoon integration (defined in CLAUDE.md but not in README)
- Security architecture changes (SSL pinning, signed URLs)
- New Zustand stores structure

**Explanation:**
Outdated docs cause:
- New developers onboarding with incorrect mental model
- Security best practices not communicated
- Feature discoverability issues (pro-resources exists but undocumented)

**Requirements:**
- Update README.md with current architecture
- Create feature-specific docs in `/docs`:
  - `SECURITY.md` - Security model from CLAUDE.md
  - `PRO_RESOURCES.md` - New feature documentation
  - `HEMPTYCOON.md` - Integration guide
- Add API documentation for Edge Functions

**Implementation Steps:**

1. **Update README.md:**
   - Replace "Last updated: 2025" with current date
   - Add "Features" section listing all tabs
   - Document new pro-resources feature
   - Add link to security documentation

2. **Create `/docs` directory:**
   ```bash
   mkdir docs
   ```

3. **Create `docs/SECURITY.md`:**
   Extract security architecture from CLAUDE.md, add:
   - RLS policy examples
   - Edge Function authentication patterns
   - Signed URL usage guide
   - Rate limiting implementation

4. **Create `docs/PRO_RESOURCES.md`:**
   Document:
   - Database schema (`pro_resources` table)
   - Admin upload flow
   - Access control (pro users only)
   - Edge Function endpoints

5. **Create `docs/HEMPTYCOON.md`:**
   Document:
   - Ticket system integration
   - Deep linking protocol
   - HMAC signature verification
   - Award ticket Edge Function

6. **Add Edge Function docs:**
   For each function in `supabase/functions/`, create JSDoc headers:
   ```ts
   /**
    * @function create-direct-sale-orders
    * @description Creates orders from direct sales cart
    * @auth Requires authenticated user
    * @ratelimit 10 requests/minute
    * @body { items: CartItem[], payment_method: string }
    * @returns { order_ids: string[] }
    */
   ```

**Testing:**
- Review docs with non-technical stakeholder
- Verify all links work
- Ensure code examples run without modification
- Add docs linting to CI

---

### 5. HempTycoon Integration Retired

**Ease:** 4/5 | **Impact:** 🔴 High | **Risk:** 🔴 High

**Overview:**
The HempTycoon integration is officially abandoned and should be removed from documentation and the ticket schema. The in-app tickets/tirage feature remains.

**Explanation:**
Keeping HempTycoon-specific references and schema fields creates confusion, unused surface area, and maintenance risk now that the project is discontinued.

**Requirements:**
- Remove HempTycoon references from docs
- Remove HempTycoon-only fields and sources from ticket schema
- Keep the in-app ticket flow intact (subscriptions, tirage, recap)

**Implementation Steps:**

1. **Remove HempTycoon docs references:**
  - Delete the HempTycoon integration section from `CLAUDE.md`.

2. **Add cleanup migration:**
  - Create a forward-only migration (example: `20260207120000_remove_hemptycoon_from_tickets.sql`) that:
    - Drops HempTycoon-only columns (`replay_hash`, `server_validated`, `validated_by`)
    - Removes the `hemptycoon` source and updates the constraint
    - Replaces `award_tickets()` with a lean signature

3. **Data cleanup:**
  - Reclassify legacy HempTycoon transactions to `admin` or delete them, then apply the new constraint.
     if (signature !== expectedSig) {
       return new Response('Invalid signature', { status: 401 });
     }

     const { user_id, amount, source, metadata } = JSON.parse(body);

     const supabase = createClient(
       Deno.env.get('SUPABASE_URL')!,
       Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
     );

     // Atomic transaction
     const { error } = await supabase.rpc('award_tickets', {
       p_user_id: user_id,
       p_amount: amount,
       p_source: source,
       p_metadata: metadata
     });

     if (error) return new Response(JSON.stringify({ error }), { status: 500 });

     return new Response(JSON.stringify({ success: true }), { status: 200 });
   });
   ```

3. **Create database function for atomic ticket award:**
   ```sql
   -- Add to migration
   CREATE OR REPLACE FUNCTION award_tickets(
     p_user_id UUID,
     p_amount INTEGER,
     p_source TEXT,
     p_metadata JSONB DEFAULT '{}'
   ) RETURNS VOID AS $$
   BEGIN
     -- Insert transaction
     INSERT INTO ticket_transactions (user_id, amount, source, metadata)
     VALUES (p_user_id, p_amount, p_source, p_metadata);

     -- Update balance
     INSERT INTO user_tickets (user_id, balance)
     VALUES (p_user_id, p_amount)
     ON CONFLICT (user_id) DO UPDATE
     SET balance = user_tickets.balance + p_amount,
         updated_at = NOW();
   END;
   $$ LANGUAGE plpgsql SECURITY DEFINER;

   REVOKE EXECUTE ON FUNCTION award_tickets FROM public;
   GRANT EXECUTE ON FUNCTION award_tickets TO service_role;
   ```

4. **Create React Query hook `src/lib/hooks/useTicketBalance.ts`:**
   ```ts
   import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
   import { supabase } from '../supabase';

   export function useTicketBalance() {
     const queryClient = useQueryClient();

     const { data: balance = 0 } = useQuery({
       queryKey: ['tickets', 'balance'],
       queryFn: async () => {
         const { data } = await supabase
           .from('user_tickets')
           .select('balance')
           .single();
         return data?.balance ?? 0;
       }
     });

     const spendTicket = useMutation({
       mutationFn: async () => {
         const { error } = await supabase.rpc('spend_ticket');
         if (error) throw error;
       },
       onSuccess: () => {
         queryClient.invalidateQueries({ queryKey: ['tickets'] });
       }
     });

     return { balance, spendTicket };
   }
   ```

5. **Add deep linking in `src/app/_layout.tsx`:**
   ```ts
   import * as Linking from 'expo-linking';

   useEffect(() => {
     const handleDeepLink = (url: string) => {
       const { hostname, path } = Linking.parse(url);
       if (hostname === 'rewards' && path === '/hemptycoon') {
         // Navigate to promo tab and show ticket award notification
         router.push('/(tabs)/promo');
       }
     };

     Linking.addEventListener('url', (event) => handleDeepLink(event.url));
   }, []);
   ```

6. **Migrate subscription tickets:**
   - Read current ticket balance from Zustand store
   - Call `award_tickets` function to migrate to database
   - Remove `tickets` field from `useSubscriptionStore`

**Testing:**
- Unit test HMAC verification in Edge Function
- Test atomic transaction (verify rollback on error)
- Test deep linking with `npx uri-scheme open chanvriers://rewards --ios`
- Verify RLS prevents unauthorized ticket manipulation
- Load test with 1000 concurrent ticket awards

---

### 6. Security: Missing Rate Limiting on Edge Functions

**Ease:** 3/5 | **Impact:** 🔴 Critical | **Risk:** 🔴 High

**Overview:**
Only `src/lib/supabase-auth.ts` implements rate limiting (magic link requests). Edge Functions for data mutations lack protection:
- `create-direct-sale-orders`
- `local-market-orders`
- `orders-update`
- `public-catalog`
- `pro-resources-admin`

**Explanation:**
Without rate limits, attackers can:
- Create millions of orders to exhaust database storage
- Spam order updates to trigger unnecessary notifications
- DDoS catalog endpoint to increase Supabase bandwidth costs
- Enumerate order IDs by brute-forcing update endpoint

CLAUDE.md security architecture mandates rate limiting on ALL API endpoints.

**Requirements:**
- Implement rate limiting middleware for all Edge Functions
- Use Upstash Redis or Supabase Edge Function KV for distributed rate limiting
- Different limits per endpoint (e.g., 10/min for mutations, 100/min for reads)
- Return HTTP 429 with Retry-After header when limit exceeded

**Implementation Steps:**

1. **Create rate limiting utility `supabase/functions/_shared/rate-limit.ts`:**
   ```ts
   import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

   const RATE_LIMITS = {
     'create-direct-sale-orders': { requests: 10, window: 60 }, // 10/min
     'local-market-orders': { requests: 5, window: 60 },
     'orders-update': { requests: 20, window: 60 },
     'public-catalog': { requests: 100, window: 60 },
     'pro-resources-admin': { requests: 30, window: 60 },
     'award-tickets': { requests: 100, window: 60 }, // High limit for game integration
   };

   export async function checkRateLimit(
     functionName: string,
     userId: string
   ): Promise<{ allowed: boolean; retryAfter?: number }> {
     const supabase = createClient(
       Deno.env.get('SUPABASE_URL')!,
       Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
     );

     const limit = RATE_LIMITS[functionName];
     const key = `ratelimit:${functionName}:${userId}`;
     const now = Math.floor(Date.now() / 1000);
     const windowStart = now - limit.window;

     // Get recent requests from edge_function_logs (or use external Redis)
     const { data: logs } = await supabase
       .from('edge_function_logs')
       .select('created_at')
       .eq('function_name', functionName)
       .eq('user_id', userId)
       .gte('created_at', new Date((now - limit.window) * 1000).toISOString());

     const requestCount = logs?.length ?? 0;

     if (requestCount >= limit.requests) {
       const oldestRequest = new Date(logs![0].created_at).getTime() / 1000;
       const retryAfter = Math.ceil(oldestRequest + limit.window - now);
       return { allowed: false, retryAfter };
     }

     // Log this request
     await supabase.from('edge_function_logs').insert({
       function_name: functionName,
       user_id: userId
     });

     return { allowed: true };
   }
   ```

2. **Create `edge_function_logs` table migration:**
   ```sql
   -- 20260207_edge_function_rate_limit.sql
   CREATE TABLE edge_function_logs (
     id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
     function_name TEXT NOT NULL,
     user_id UUID NOT NULL,
     created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
   );

   CREATE INDEX idx_edge_logs_ratelimit ON edge_function_logs(function_name, user_id, created_at DESC);

   -- Auto-delete old logs
   CREATE OR REPLACE FUNCTION cleanup_old_edge_logs() RETURNS void AS $$
   BEGIN
     DELETE FROM edge_function_logs WHERE created_at < NOW() - INTERVAL '5 minutes';
   END;
   $$ LANGUAGE plpgsql;

   -- Schedule cleanup (requires pg_cron extension)
   SELECT cron.schedule('cleanup-edge-logs', '* * * * *', 'SELECT cleanup_old_edge_logs()');
   ```

3. **Apply to all Edge Functions:**
   Example for `create-direct-sale-orders/index.ts`:
   ```ts
   import { checkRateLimit } from '../_shared/rate-limit.ts';

   serve(async (req) => {
     const authHeader = req.headers.get('Authorization');
     const token = authHeader?.replace('Bearer ', '');
     const { data: { user } } = await supabase.auth.getUser(token);

     if (!user) {
       return new Response('Unauthorized', { status: 401 });
     }

     // Rate limit check
     const rateCheck = await checkRateLimit('create-direct-sale-orders', user.id);
     if (!rateCheck.allowed) {
       return new Response('Too Many Requests', {
         status: 429,
         headers: { 'Retry-After': rateCheck.retryAfter!.toString() }
       });
     }

     // ... rest of function logic
   });
   ```

4. **Add rate limit tests:**
   Create `supabase/functions/__tests__/rate-limit.test.ts`:
   ```ts
   import { assertEquals } from 'https://deno.land/std@0.168.0/testing/asserts.ts';
   import { checkRateLimit } from '../_shared/rate-limit.ts';

   Deno.test('Rate limit blocks after threshold', async () => {
     const userId = 'test-user';

     // Make 10 requests (limit)
     for (let i = 0; i < 10; i++) {
       const result = await checkRateLimit('create-direct-sale-orders', userId);
       assertEquals(result.allowed, true);
     }

     // 11th request should fail
     const blocked = await checkRateLimit('create-direct-sale-orders', userId);
     assertEquals(blocked.allowed, false);
     assertEquals(typeof blocked.retryAfter, 'number');
   });
   ```

**Testing:**
- Run rate limit tests with `deno test`
- Manual test: Send 11 requests in <60 seconds, verify 11th returns 429
- Verify `Retry-After` header accuracy
- Load test with k6 to confirm distributed limiting works
- Monitor Supabase logs for rate limit hits

---

### 7. Security: Weak Storage Access Controls

**Ease:** 2/5 | **Impact:** 🔴 High | **Risk:** 🔴 High

**Overview:**
Storage buckets still use direct URL patterns instead of signed URLs:
- `src/lib/image-upload.ts` returns public URLs
- No expiration on file access
- Potential for enumeration attacks (sequential UUIDs)

**Explanation:**
CLAUDE.md mandates:
> "SIGNED URLS: Always use createSignedUrl with expiration for file access. Never expose direct paths."

Current risks:
- Anyone with bucket URL can enumerate files (try random UUIDs)
- Uploaded files never expire (compliance issue for RGPD deletion requests)
- No audit trail of who accessed which file

**Requirements:**
- Convert all file access to signed URLs with 1-hour expiration
- Implement file access logging
- Add bucket policies to block public access
- Rotate old files to comply with RGPD

**Implementation Steps:**

1. **Update bucket policies in Supabase Dashboard:**
   For each bucket (`products`, `profiles`, `pro-resources`):
   - Disable "Public bucket" setting
   - Enable RLS on bucket
   - Create policy:
     ```sql
     CREATE POLICY "Authenticated users can read" ON storage.objects
     FOR SELECT USING (auth.role() = 'authenticated');

     CREATE POLICY "Users can upload to own folder" ON storage.objects
     FOR INSERT WITH CHECK (
       auth.uid()::text = (storage.foldername(name))[1]
     );
     ```

2. **Create signed URL utility `src/lib/storage-utils.ts`:**
   ```ts
   import { supabase } from './supabase';

   export async function getSignedUrl(
     bucket: string,
     path: string,
     expiresIn: number = 3600 // 1 hour default
   ): Promise<string | null> {
     const { data, error } = await supabase.storage
       .from(bucket)
       .createSignedUrl(path, expiresIn);

     if (error) {
       console.error('Failed to create signed URL:', error);
       return null;
     }

     return data.signedUrl;
   }

   export async function uploadWithSignedUrl(
     bucket: string,
     file: File,
     userId: string
   ) {
     // Generate UUID filename to prevent enumeration
     const uuid = crypto.randomUUID();
     const ext = file.name.split('.').pop();
     const path = `${userId}/${uuid}.${ext}`;

     const { error } = await supabase.storage
       .from(bucket)
       .upload(path, file);

     if (error) throw error;

     // Return signed URL, not public URL
     return getSignedUrl(bucket, path);
   }
   ```

3. **Update `src/lib/image-upload.ts`:**
   ```ts
   // Before:
   const publicUrl = supabase.storage.from('products').getPublicUrl(path);

   // After:
   import { getSignedUrl } from './storage-utils';
   const signedUrl = await getSignedUrl('products', path);
   ```

4. **Add file access logging migration:**
   ```sql
   -- 20260207_storage_access_logs.sql
   CREATE TABLE storage_access_logs (
     id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
     user_id UUID NOT NULL REFERENCES auth.users(id),
     bucket TEXT NOT NULL,
     path TEXT NOT NULL,
     action TEXT NOT NULL CHECK (action IN ('read', 'write', 'delete')),
     created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
   );

   CREATE INDEX idx_storage_logs ON storage_access_logs(user_id, created_at DESC);

   -- Trigger to log reads
   CREATE OR REPLACE FUNCTION log_storage_access() RETURNS TRIGGER AS $$
   BEGIN
     INSERT INTO storage_access_logs (user_id, bucket, path, action)
     VALUES (auth.uid(), TG_ARGV[0], NEW.name, TG_ARGV[1]);
     RETURN NEW;
   END;
   $$ LANGUAGE plpgsql SECURITY DEFINER;
   ```

5. **Implement RGPD file expiration:**
   ```sql
   -- Auto-delete files older than 2 years (RGPD compliance)
   CREATE OR REPLACE FUNCTION cleanup_old_storage_files() RETURNS void AS $$
   BEGIN
     DELETE FROM storage.objects
     WHERE created_at < NOW() - INTERVAL '2 years';
   END;
   $$ LANGUAGE plpgsql;

   SELECT cron.schedule('cleanup-old-files', '0 2 * * 0', 'SELECT cleanup_old_storage_files()');
   ```

6. **Update all components using images:**
   Search for `getPublicUrl` and replace with `getSignedUrl`:
   ```bash
   grep -r "getPublicUrl" src/
   ```

**Testing:**
- Verify direct bucket URLs return 403
- Confirm signed URLs expire after 1 hour
- Test file upload returns signed URL, not public
- Check storage_access_logs table populates
- Verify RGPD deletion includes storage files

---

### 8. Deprecated Pattern: Direct Supabase Queries in Components

**Ease:** 4/5 | **Impact:** 🔴 High | **Risk:** 🟡 Medium

**Overview:**
8+ components bypass Edge Functions and directly call `.insert()`, `.update()`, `.delete()` on Supabase client, violating CLAUDE.md security architecture:

Found in:
- `src/components/AdminProducerOrders.tsx`
- `src/components/ClientProfileForm.tsx`
- `src/components/ProducerProfileForm.tsx`
- `src/app/edit-profile.tsx`

**Explanation:**
CLAUDE.md explicitly forbids:
> "NEVER use supabase-js client methods (.select, .insert, .update, .delete) directly in frontend for sensitive operations."

Example dangerous code:
```ts
// ❌ DANGEROUS - user can modify ANY column including is_admin, role
await supabase.from('profiles').update({ is_pro: true }).eq('id', user.id);
```

This allows:
- Privilege escalation (modify `is_admin` field)
- Data tampering (change order totals, quantities)
- Bypass business logic (skip payment validation)

**Requirements:**
- Create Edge Functions for ALL mutations
- Replace direct queries with Edge Function calls
- Add server-side validation in Edge Functions
- Restrict RLS policies to read-only for client

**Implementation Steps:**

1. **Audit all direct mutations:**
   ```bash
   grep -rn "\.insert\|\.update\|\.delete" src/components/ src/app/
   ```

2. **Create Edge Function `update-profile/index.ts`:**
   ```ts
   import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
   import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
   import { z } from 'https://deno.land/x/zod@v3.22.4/mod.ts';

   const UpdateSchema = z.object({
     display_name: z.string().max(50).optional(),
     phone: z.string().regex(/^\+?[1-9]\d{1,14}$/).optional(),
     address: z.string().max(200).optional(),
     // NOTE: is_admin, role, is_pro are NOT allowed here
   });

   serve(async (req) => {
     const authHeader = req.headers.get('Authorization');
     const token = authHeader?.replace('Bearer ', '');
     const supabase = createClient(
       Deno.env.get('SUPABASE_URL')!,
       Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
     );

     const { data: { user } } = await supabase.auth.getUser(token);
     if (!user) return new Response('Unauthorized', { status: 401 });

     const body = await req.json();
     const validated = UpdateSchema.parse(body); // Throws if invalid

     // Server controls which columns are updated
     const { error } = await supabase
       .from('profiles')
       .update(validated)
       .eq('id', user.id);

     if (error) return new Response(JSON.stringify({ error }), { status: 500 });

     return new Response(JSON.stringify({ success: true }), { status: 200 });
   });
   ```

3. **Create React Query mutation hook `src/lib/hooks/useUpdateProfile.ts`:**
   ```ts
   import { useMutation, useQueryClient } from '@tanstack/react-query';
   import { supabase } from '../supabase';

   export function useUpdateProfile() {
     const queryClient = useQueryClient();

     return useMutation({
       mutationFn: async (updates: { display_name?: string; phone?: string; address?: string }) => {
         const { data: { session } } = await supabase.auth.getSession();

         const response = await fetch(`${process.env.EXPO_PUBLIC_SUPABASE_URL}/functions/v1/update-profile`, {
           method: 'POST',
           headers: {
             'Authorization': `Bearer ${session?.access_token}`,
             'Content-Type': 'application/json'
           },
           body: JSON.stringify(updates)
         });

         if (!response.ok) throw new Error('Failed to update profile');
         return response.json();
       },
       onSuccess: () => {
         queryClient.invalidateQueries({ queryKey: ['profile'] });
       }
     });
   }
   ```

4. **Update components:**
   ```ts
   // src/components/ClientProfileForm.tsx

   // Before:
   const handleSubmit = async () => {
     await supabase.from('profiles').update({ display_name }).eq('id', user.id);
   };

   // After:
   import { useUpdateProfile } from '../lib/hooks/useUpdateProfile';

   const updateProfile = useUpdateProfile();

   const handleSubmit = async () => {
     updateProfile.mutate({ display_name });
   };
   ```

5. **Restrict RLS policies to read-only:**
   ```sql
   -- 20260207_restrict_profile_mutations.sql

   -- Drop existing update policy
   DROP POLICY IF EXISTS "Users can update own profile" ON profiles;

   -- Read-only policy (updates MUST go through Edge Functions)
   CREATE POLICY "Users can view own profile" ON profiles
   FOR SELECT USING (auth.uid() = id);

   -- Service role can update (Edge Functions only)
   CREATE POLICY "Service role can update" ON profiles
   FOR UPDATE USING (auth.role() = 'service_role');
   ```

6. **Repeat for other entities:**
   - Orders: Create `update-order-status` Edge Function
   - Producer profiles: Create `update-producer-profile` Edge Function
   - Admin actions: Create `admin-update-producer` Edge Function

**Testing:**
- Verify direct `.update()` calls from frontend fail with RLS error
- Test Edge Function validation rejects invalid fields
- Attempt to send `is_admin: true` in request body, verify it's ignored
- Confirm React Query mutations invalidate cache correctly

---

### 9. Missing Error Boundaries

**Ease:** 2/5 | **Impact:** 🟡 Medium | **Risk:** 🟡 Medium

**Overview:**
No error boundaries in navigation tree. Unhandled errors crash entire app instead of graceful degradation.

**Explanation:**
Without error boundaries:
- Single component error crashes all tabs
- No error reporting to monitoring service
- Poor UX (white screen of death)
- Difficult debugging in production

React Native's default error screen only shows in development mode.

**Requirements:**
- Add error boundary to root layout
- Add error boundary to each tab
- Integrate with error monitoring (Sentry recommended)
- Display user-friendly error UI with retry option

**Implementation Steps:**

1. **Create error boundary component `src/components/ErrorBoundary.tsx`:**
   ```tsx
   import React from 'react';
   import { View, Text, Pressable } from 'react-native';
   import * as Updates from 'expo-updates';

   interface Props {
     children: React.ReactNode;
     fallback?: React.ComponentType<{ error: Error; resetError: () => void }>;
   }

   interface State {
     hasError: boolean;
     error: Error | null;
   }

   export class ErrorBoundary extends React.Component<Props, State> {
     constructor(props: Props) {
       super(props);
       this.state = { hasError: false, error: null };
     }

     static getDerivedStateFromError(error: Error): State {
       return { hasError: true, error };
     }

     componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
       console.error('ErrorBoundary caught:', error, errorInfo);
       // TODO: Send to Sentry
       // Sentry.captureException(error, { contexts: { react: errorInfo } });
     }

     resetError = () => {
       this.setState({ hasError: false, error: null });
     };

     render() {
       if (this.state.hasError) {
         if (this.props.fallback) {
           const Fallback = this.props.fallback;
           return <Fallback error={this.state.error!} resetError={this.resetError} />;
         }

         return (
           <View className="flex-1 items-center justify-center p-4 bg-gray-50">
             <Text className="text-2xl font-bold mb-4">Oups, quelque chose s'est mal passé</Text>
             <Text className="text-gray-600 mb-8 text-center">
               {this.state.error?.message ?? 'Une erreur inattendue est survenue'}
             </Text>
             <Pressable
               onPress={() => Updates.reloadAsync()}
               className="bg-emerald-500 px-6 py-3 rounded-lg"
             >
               <Text className="text-white font-semibold">Recharger l'application</Text>
             </Pressable>
           </View>
         );
       }

       return this.props.children;
     }
   }
   ```

2. **Wrap root layout `src/app/_layout.tsx`:**
   ```tsx
   import { ErrorBoundary } from '../components/ErrorBoundary';

   export default function RootLayout() {
     return (
       <ErrorBoundary>
         <QueryClientProvider client={queryClient}>
           {/* existing providers */}
         </QueryClientProvider>
       </ErrorBoundary>
     );
   }
   ```

3. **Add error boundaries to critical screens:**
   ```tsx
   // src/app/(tabs)/cart.tsx
   export default function CartScreen() {
     return (
       <ErrorBoundary fallback={CartErrorFallback}>
         {/* cart content */}
       </ErrorBoundary>
     );
   }

   function CartErrorFallback({ error, resetError }: { error: Error; resetError: () => void }) {
     return (
       <View className="flex-1 items-center justify-center p-4">
         <Text className="text-lg mb-4">Impossible de charger le panier</Text>
         <Pressable onPress={resetError} className="bg-blue-500 px-4 py-2 rounded">
           <Text className="text-white">Réessayer</Text>
         </Pressable>
       </View>
     );
   }
   ```

4. **Integrate Sentry (optional but recommended):**
   ```bash
   bun add @sentry/react-native
   ```

   ```ts
   // src/app/_layout.tsx
   import * as Sentry from '@sentry/react-native';

   Sentry.init({
     dsn: process.env.EXPO_PUBLIC_SENTRY_DSN,
     enableInExpoDevelopment: false,
     debug: __DEV__,
   });

   // In ErrorBoundary:
   componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
     Sentry.captureException(error, { contexts: { react: errorInfo } });
   }
   ```

**Testing:**
- Trigger error with `throw new Error('Test')` in component
- Verify error boundary catches it
- Confirm app doesn't crash
- Test reload button works
- Verify error logged to Sentry (if integrated)

---

### 10. Unused Dependencies

**Ease:** 1/5 | **Impact:** 🟢 Low | **Risk:** 🟢 Low

**Overview:**
`package.json` contains dependencies for deleted chat feature:
- Realtime chat libraries
- WebSocket dependencies
- Unused UI components

**Explanation:**
Unused deps:
- Increase bundle size (slower app startup)
- Create security risks (unpatched vulnerabilities)
- Confuse future developers

**Requirements:**
- Audit `package.json` for unused packages
- Remove chat-related dependencies
- Run `bun install` to update lockfile
- Verify app still builds

**Implementation Steps:**

1. **List all dependencies:**
   ```bash
   cat package.json | grep '".*":' | wc -l
   ```

2. **Use depcheck to find unused:**
   ```bash
   bunx depcheck
   ```

3. **Manually verify chat dependencies:**
   - Search for imports: `grep -r "@supabase/realtime-js" src/`
   - If not found, remove from `package.json`

4. **Remove unused packages:**
   ```bash
   bun remove <package-name>
   ```

5. **Verify build:**
   ```bash
   bun run build
   ```

**Testing:**
- Build succeeds
- App launches in Expo Go
- No console warnings about missing modules

---

### 11. TODO/FIXME Markers

**Ease:** 2/5 | **Impact:** 🟢 Low | **Risk:** 🟢 Low

**Overview:**
15+ TODO/FIXME comments found in codebase without GitHub issues tracking them.

**Explanation:**
Untracked TODOs:
- Get forgotten
- Block code review (reviewers don't know if TODO is intentional)
- No accountability for completion

**Requirements:**
- Create GitHub issues for each TODO
- Link issue number in comment: `// TODO(#123): Fix this`
- Remove resolved TODOs

**Implementation Steps:**

1. **Extract all TODOs:**
   ```bash
   grep -rn "TODO\|FIXME" src/ > todos.txt
   ```

2. **Create issues using GitHub CLI:**
   ```bash
   gh issue create --title "TODO: Fix audio state race condition" --body "File: src/contexts/AudioContext.tsx:45"
   ```

3. **Update comments with issue numbers:**
   ```ts
   // Before:
   // TODO: Fix audio state race condition

   // After:
   // TODO(#456): Fix audio state race condition - see issue for details
   ```

4. **Add pre-commit hook to enforce issue links:**
   ```bash
   # .husky/pre-commit
   if git diff --cached | grep -E "TODO|FIXME" | grep -v "#[0-9]"; then
     echo "Error: TODO/FIXME must link to GitHub issue (e.g., TODO(#123))"
     exit 1
   fi
   ```

**Testing:**
- Search for unlinked TODOs: `grep -r "TODO[^(]" src/`
- Verify all have GitHub issues
- Test pre-commit hook blocks unlinked TODOs

---

### 12. Missing RLS Policy Documentation

**Ease:** 2/5 | **Impact:** 🟡 Medium | **Risk:** 🟡 Medium

**Overview:**
New `pro_resources` table (migration `20260206100000_create_pro_resources.sql`) lacks documented RLS policies. No entry in `database/RLS_DOCUMENTATION.md`.

**Explanation:**
Without documented policies:
- Future developers don't know access control rules
- Security audits are difficult
- Policy changes risk breaking access patterns

**Requirements:**
- Document all RLS policies in `database/RLS_DOCUMENTATION.md`
- Include example queries showing what each role can access
- Add policy change log

**Implementation Steps:**

1. **Review existing policies:**
   ```bash
   cat supabase/migrations/20260206100000_create_pro_resources.sql | grep "CREATE POLICY"
   ```

2. **Update `database/RLS_DOCUMENTATION.md`:**
   ```markdown
   ## pro_resources Table

   ### Policies

   | Policy Name | Role | Operation | Condition |
   |-------------|------|-----------|-----------|
   | pro_users_read | authenticated | SELECT | is_producer() = true |
   | admin_full_access | authenticated | ALL | is_admin() = true |

   ### Access Examples

   **Pro User (can read):**
   ```sql
   SELECT * FROM pro_resources WHERE category = 'legal';
   -- Returns: All resources
   ```

   **Regular User (blocked):**
   ```sql
   SELECT * FROM pro_resources;
   -- Returns: 0 rows (RLS blocks)
   ```

   **Admin (full access):**
   ```sql
   INSERT INTO pro_resources (title, file_url, category) VALUES (...);
   -- Success
   ```

   ### Policy Change Log
   - 2026-02-06: Initial policies created
   ```

3. **Add policy testing guide:**
   ```markdown
   ### Testing RLS Policies

   Use Supabase SQL Editor with different user contexts:

   1. Create test users:
      ```sql
      -- Run as service_role
      INSERT INTO auth.users (email, role) VALUES ('pro@test.com', 'authenticated');
      INSERT INTO profiles (id, is_producer) VALUES ((SELECT id FROM auth.users WHERE email = 'pro@test.com'), true);
      ```

   2. Test as pro user:
      ```sql
      SET LOCAL role TO authenticated;
      SET LOCAL request.jwt.claims TO '{"sub": "<pro-user-id>"}';
      SELECT * FROM pro_resources; -- Should return data
      ```
   ```

**Testing:**
- Review documentation with team
- Test example queries in Supabase SQL Editor
- Verify policy change log is maintained

---

## Prioritized Action Items

### Sprint 1 (Week 1-2) - Critical Security & Cleanup
1. **Item #6**: Implement rate limiting on Edge Functions
2. **Item #7**: Migrate to signed URLs for storage
3. **Item #1**: Complete chat feature removal
4. **Item #8**: Replace direct Supabase queries with Edge Functions

### Sprint 2 (Week 3-4) - Infrastructure & Documentation
5. **Item #2**: Add test coverage (target 30%)
6. **Item #5**: Implement HempTycoon ticket integration
7. **Item #4**: Update documentation
8. **Item #12**: Document RLS policies

### Sprint 3 (Week 5-6) - Refinement
9. **Item #3**: Consolidate state management patterns
10. **Item #9**: Add error boundaries
11. **Item #11**: Resolve TODO markers
12. **Item #10**: Remove unused dependencies

---

## Relevant Files

Key files for remediation:

**Security:**
- `src/lib/supabase-auth.ts` - Rate limiting reference
- `src/lib/image-upload.ts` - Storage patterns to fix
- `CLAUDE.md` - Security architecture requirements

**State Management:**
- `src/lib/store.ts` - Main Zustand store
- `src/contexts/AudioContext.tsx` - Duplicate to remove
- `src/lib/music-store.ts` - Target for consolidation

**Chat Cleanup:**
- `supabase/migrations/20260206100001_disable_chat_access.sql` - Incomplete migration

**HempTycoon:**
- `CLAUDE.md` (lines 158-213) - Integration architecture

**Documentation:**
- `README.md` - Outdated
- `database/RLS_DOCUMENTATION.md` - Missing pro_resources

---

*This plan provides a clear roadmap to eliminate technical debt systematically while maintaining production stability.*
