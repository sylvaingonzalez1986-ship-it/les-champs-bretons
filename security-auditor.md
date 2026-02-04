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

## Applied Fixes (Code)
- Moved subscription mutations to Edge Function
	- [supabase/functions/user-subscriptions-mutations/index.ts](supabase/functions/user-subscriptions-mutations/index.ts)
	- [src/lib/supabase-sync.user.ts](src/lib/supabase-sync.user.ts#L117-L158)
- Moved user stats increment to Edge Function
	- [supabase/functions/user-stats-mutations/index.ts](supabase/functions/user-stats-mutations/index.ts)
	- [src/lib/supabase-sync.user.ts](src/lib/supabase-sync.user.ts#L470-L520)
- Bourse feature removed (pro orders no longer exist)
- Secured lots CRUD via Edge Function (admin only)
	- [supabase/functions/lots-mutations/index.ts](supabase/functions/lots-mutations/index.ts)
	- [src/lib/supabase-sync.lots.ts](src/lib/supabase-sync.lots.ts#L133-L227)
- Lab analyses now store storage path + signed URL resolution
	- [supabase/functions/lab-analyses-url/index.ts](supabase/functions/lab-analyses-url/index.ts)
	- [src/lib/supabase-lab-analyses.ts](src/lib/supabase-lab-analyses.ts#L1-L114)
	- [src/components/LabAnalysisViewer.tsx](src/components/LabAnalysisViewer.tsx#L300-L540)
	- [src/components/LabAnalysisUploader.tsx](src/components/LabAnalysisUploader.tsx#L311-L700)

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

### 4) ~~HIGH — Client-side creation of pro orders~~ RESOLVED
**Status:** Feature removed. La Bourse a été retirée de l'application.

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

## Remaining Manual Steps
- Make the `lab-analyses` bucket **private** in Supabase Storage.
- Add/verify RLS policies to **deny direct writes** for non-admins on:
	- `user_subscriptions`, `user_stats`, `lots`, `lot_items`, `pro_orders`
- Consider a shared rate-limit store (KV/Redis) for edge functions.

## RLS Migration Added
- [database/migrations/rls_lockdown_non_admin_writes_2026_02_03.sql](database/migrations/rls_lockdown_non_admin_writes_2026_02_03.sql)

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
