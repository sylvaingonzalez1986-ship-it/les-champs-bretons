# Security Architecture (2026)

This app follows a backend-first security model. Client code is a view layer only.

## Core rules
- Never trust client input. Validate on the server.
- No direct database writes from the client. Use Edge Functions for mutations.
- RLS is mandatory on all tables.
- Storage is private. Use signed URLs for access.
- Rate limit public and mutation endpoints.

## Supabase guidance
- RLS: keep policies restrictive and test with multiple roles.
- Functions: set `search_path` to empty for security-definer functions.
- Revoke public execute on sensitive functions and grant only to `service_role`.

## Storage
- Store file paths in the database, not public URLs.
- Resolve signed URLs at access time in the app.

## Auth + device binding
- Sessions are stored in secure storage.
- Device binding is enforced via Edge Functions where applicable.

## Network hardening
- SSL pinning is used for critical Supabase calls.
- Use timeouts and retry logic for auth calls.

## Where to look
- Auth client: [src/lib/supabase-auth.ts](../src/lib/supabase-auth.ts)
- Storage signed URLs: [src/lib/storage-utils.ts](../src/lib/storage-utils.ts)
- SSL pinning: [src/lib/ssl-pinning.ts](../src/lib/ssl-pinning.ts)
- Edge Functions: [supabase/functions](../supabase/functions)
- RLS docs: [database/RLS_DOCUMENTATION.md](../database/RLS_DOCUMENTATION.md)

## Operational checklist
- Confirm Edge Functions use rate limits and auth checks.
- Verify RLS on new tables and new policies documented.
- Ensure no public storage buckets for user content.
