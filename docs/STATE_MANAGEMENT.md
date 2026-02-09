# State Management Audit (2026-02-07)

## Rules used
- Server/async state: React Query
- UI/local state: Zustand
- Avoid `useState` + manual fetch for server data

## Current findings (needs follow-up)

### Screens doing direct fetch
These should be moved to React Query or existing lib helpers when possible:
- src/app/gestion-commandes.tsx (direct REST fetch for producers/profiles)
- src/app/commande-confirmation.tsx (direct REST fetch for orders/producers)
- src/app/(tabs)/marche-local.tsx (public catalog fetch)
- src/app/(tabs)/marche-catalogue.tsx (public catalog fetch)

### Components doing direct fetch
- src/components/RGPDSection.tsx (RPC calls)
- src/components/LocalMarketOrderModal.tsx (producer email fetch)
- src/components/LabAnalysisViewer.tsx (signed URL fetch)
- src/components/LabAnalysisUploader.tsx (signed URL fetch)

### Auth flow fetches (intentional)
- src/app/auth/reset-password.tsx
- src/app/auth/email-confirmed.tsx
- src/app/age-verification.tsx

## Next steps
1) Convert screen-level REST fetches to React Query hooks.
2) Centralize RGPD RPC calls in a lib module and wrap with React Query mutations.
3) Keep auth flows as direct fetch (special-case) but standardize headers + error handling.
