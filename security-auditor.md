# Security Audit Report

Date: 2026-02-03

## Scope
- Auth flows and Supabase access
- Client-side data mutations
- Edge functions (orders)
- Storage uploads (images, lab analyses)

## Summary
- Overall risk: **High**
- Key risks: client-side writes to sensitive tables, public storage for lab analyses, weak rate limiting.

## Findings (by severity)

### 1) HIGH — Sensitive client-side writes (subscriptions/tickets)
**Evidence:** Direct PATCH/POST from client to `user_subscriptions`.
- [src/lib/supabase-sync.user.ts](src/lib/supabase-sync.user.ts#L128-L171)

**Impact:** Users can tamper with tickets and subscription tier if RLS is permissive or misconfigured (OWASP A01, A04).

**Recommendation:** Move to Edge Function with strict server-side validation. Make RLS read-only for non-admins on `user_subscriptions`.

---

### 2) HIGH — Sensitive client-side writes (user stats)
**Evidence:** Client increments `user_stats` directly.
- [src/lib/supabase-sync.user.ts](src/lib/supabase-sync.user.ts#L485-L528)

**Impact:** Users can falsify stats (OWASP A01).

**Recommendation:** Edge Function for stat mutation. Deny direct updates via RLS.

---

### 3) HIGH — Client-side CRUD for lots
**Evidence:** Client creates/updates lots and lot items via REST.
- [src/lib/supabase-sync.lots.ts](src/lib/supabase-sync.lots.ts#L133-L205)

**Impact:** Business data can be altered by non-admins if RLS is insufficient (OWASP A01).

**Recommendation:** Admin-only Edge Functions for lots. Lock down tables with RLS.

---

### 4) HIGH — Client-side creation of pro orders
**Evidence:** Client inserts directly into `pro_orders`.
- [src/lib/supabase-bourse.ts](src/lib/supabase-bourse.ts#L540-L567)

**Impact:** Quantity/price tampering, bypass of business rules (OWASP A01, A04).

**Recommendation:** Move to Edge Function; validate quantity and pricing server-side.

---

### 5) MEDIUM — Lab analysis uploads use public bucket
**Evidence:** Lab analyses upload returns public URL.
- [src/lib/supabase-lab-analyses.ts](src/lib/supabase-lab-analyses.ts#L1-L114)

**Impact:** Potential leak of compliance documents (OWASP A02).

**Recommendation:** Use private bucket + signed URLs. Store only object path in DB.

---

### 6) MEDIUM — Edge function rate limiting is in-memory
**Evidence:** In-memory map in `create-direct-sale-orders`.
- [supabase/functions/create-direct-sale-orders/index.ts](supabase/functions/create-direct-sale-orders/index.ts#L5-L67)

**Impact:** Rate limiting can be bypassed on cold start or multi-instance (OWASP A04).

**Recommendation:** Use shared store (Redis/KV) or Supabase rate-limit middleware.

---

### 7) LOW — CORS wildcard
**Evidence:** `Access-Control-Allow-Origin: *` in edge function.
- [supabase/functions/create-direct-sale-orders/index.ts](supabase/functions/create-direct-sale-orders/index.ts#L41-L54)

**Impact:** Broad exposure for web builds; not a primary control but increases attack surface.

**Recommendation:** Restrict origins if web is used; keep `*` only for mobile-only apps.

---

## Security Checklist
- [ ] Move all sensitive writes to Edge Functions
- [ ] Enforce RLS read-only on sensitive tables for non-admins
- [ ] Use private storage for lab analyses + signed URLs
- [ ] Replace in-memory rate limit with shared store
- [ ] Add audit logs for critical changes (orders, roles, tickets)

## Suggested Headers/CSP (web builds)
- Strict-Transport-Security
- X-Content-Type-Options
- Referrer-Policy
- Permissions-Policy
- CSP (adjust domains as needed)

```
default-src 'self';
connect-src 'self' https://*.supabase.co https://*.supabase.in;
img-src 'self' https: data:;
media-src 'self' https: data:;
style-src 'self' 'unsafe-inline';
script-src 'self' 'unsafe-eval';
frame-ancestors 'none';
```
