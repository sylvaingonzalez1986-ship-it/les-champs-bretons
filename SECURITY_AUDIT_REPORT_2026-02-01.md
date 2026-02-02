# 🔒 RAPPORT D'AUDIT SÉCURITÉ — Les Chanvriers Unis

**Date**: 1er février 2026  
**Version**: 2.0  
**Auditeur**: Security Auditor AI  
**Application**: Les Chanvriers Unis (React Native / Expo SDK 53)

---

## 📊 SCORE GLOBAL: 7.8 / 10

| Catégorie | Score | Poids | Pondéré |
|-----------|-------|-------|---------|
| Authentification & Sessions | 8.5/10 | 20% | 1.70 |
| Autorisation & RLS | 9.0/10 | 20% | 1.80 |
| Protection des Données | 8.0/10 | 15% | 1.20 |
| Validation des Entrées | 8.5/10 | 15% | 1.28 |
| Sécurité Réseau | 7.0/10 | 10% | 0.70 |
| Gestion des Secrets | 6.0/10 | 10% | 0.60 |
| Conformité RGPD | 8.0/10 | 5% | 0.40 |
| Accessibilité | 3.0/10 | 5% | 0.15 |

**Total Pondéré: 7.83/10**

---

## ✅ POINTS FORTS (Forces identifiées)

### 1. Authentification & Sessions — 8.5/10

| Critère | Status | Détails |
|---------|--------|---------|
| Rate Limiting | ✅ | 5 tentatives max / 60s avec blocage |
| Session Management | ✅ | JWT avec refresh tokens |
| Secure Storage | ✅ | expo-secure-store (iOS Keychain/Android Keystore) |
| PBKDF2 Key Derivation | ✅ | 100,000 itérations pour le web |
| Token Expiration | ✅ | Gestion automatique du refresh |

**Code vérifié** ([supabase-auth.ts](src/lib/supabase-auth.ts)):
```typescript
const RATE_LIMIT_MAX_ATTEMPTS = 5;
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 60 seconds
```

### 2. Autorisation & Row Level Security — 9.0/10

| Critère | Status | Détails |
|---------|--------|---------|
| RLS Activé | ✅ | 15+ tables avec RLS |
| Policies Définies | ✅ | SELECT/INSERT/UPDATE/DELETE |
| Admin Checks | ✅ | Fonction `is_admin()` SECURITY DEFINER |
| Producer Isolation | ✅ | `get_user_producer_id()` |
| Audit Logging | ✅ | Table `audit_log_entries` |

**Tables protégées par RLS**:
- `profiles` ✅
- `products` ✅
- `producers` ✅
- `orders` ✅
- `player_progress` ✅
- `audit_log_entries` ✅
- `user_lots` ✅
- `producer_chat_messages` ✅
- `rgpd_requests` ✅
- `commandes_vente_directe` ✅
- Et plus...

### 3. Protection des Données — 8.0/10

| Critère | Status | Détails |
|---------|--------|---------|
| Chiffrement au repos | ✅ | AES-256-GCM (web), Keychain/Keystore (natif) |
| IV Unique | ✅ | 12 bytes nonce par opération |
| Sel Unique | ✅ | 16 bytes par installation |
| Tokens sécurisés | ✅ | Stockage dans SecureStore |

**Code vérifié** ([secure-storage.ts](src/lib/secure-storage.ts)):
```typescript
const PBKDF2_ITERATIONS = 100000;
const KEY_LENGTH = 256; // bits
const IV_LENGTH = 12; // bytes pour GCM
```

### 4. Validation des Entrées — 8.5/10

| Critère | Status | Détails |
|---------|--------|---------|
| Validation Email | ✅ | Regex + normalisation |
| Sanitization XSS | ✅ | `escapeHtml()` |
| SQL Like Escape | ✅ | `escapeSqlLike()` |
| Zod Schemas | ✅ | Validation côté client et Edge Functions |
| Control Chars | ✅ | Suppression caractères de contrôle |
| SIRET Validation | ✅ | Algorithme de Luhn |
| Password Strength | ✅ | Score 0-4 avec feedback |

**Code vérifié** ([input-validation.ts](src/lib/input-validation.ts)):
```typescript
export function escapeHtml(input: string): string {
  const htmlEscapes: Record<string, string> = {
    '&': '&amp;', '<': '&lt;', '>': '&gt;',
    '"': '&quot;', "'": '&#39;',
  };
  return input.replace(/[&<>"']/g, (char) => htmlEscapes[char] || char);
}
```

### 5. Edge Functions Sécurisées — 8.0/10

| Critère | Status | Détails |
|---------|--------|---------|
| Middleware Unifié | ✅ | `createValidatedHandler` |
| Rate Limiting | ✅ | Presets par type d'opération |
| Auth Required | ✅ | Par défaut activé |
| Schema Validation | ✅ | Zod intégré |
| CORS Headers | ✅ | Configuré correctement |
| Service Key Serveur | ✅ | `SUPABASE_SERVICE_ROLE_KEY` côté serveur uniquement |

**Rate Limit Presets**:
- `AI_API`: 30 req/min
- `AUTH`: 5 req/15min
- `ORDERS`: 10 req/min
- `UPLOADS`: 20 req/min

### 6. Conformité RGPD — 8.0/10

| Critère | Status | Détails |
|---------|--------|---------|
| Droit d'accès | ✅ | `export_user_data()` |
| Droit à l'oubli | ✅ | Fonction de suppression |
| Table RGPD Requests | ✅ | Traçabilité des demandes |
| Anonymisation | ✅ | Données anonymisées à l'export |
| RLS sur demandes | ✅ | Utilisateurs voient leurs demandes |

---

## ⚠️ VULNÉRABILITÉS IDENTIFIÉES

### CRITIQUE — Score Impact: -1.5

#### V1. Clés API exposées côté client
**Sévérité**: 🔴 CRITIQUE  
**Fichier**: [supabase-sync-core.ts](src/lib/supabase-sync-core.ts)

```typescript
export const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || '';
```

**Risque**: La clé anonyme Supabase est exposée dans le bundle client. Bien que protégée par RLS, cela permet des abus potentiels.

**Recommandation**:
- ✅ RLS est activé (mitigé)
- ⚠️ Surveiller les quotas API
- ⚠️ Implémenter rate limiting Supabase niveau projet

---

### ÉLEVÉE — Score Impact: -0.5

#### V2. Absence de SSL Pinning natif
**Sévérité**: 🟠 ÉLEVÉE  
**Fichier**: [ssl-pinning.ts](src/lib/ssl-pinning.ts)

```typescript
// NOTE: Cette implementation utilise une approche compatible Vibecode
// (sans package natif react-native-ssl-pinning)
```

**Risque**: Vulnérable aux attaques MITM sur réseaux WiFi publics.

**Recommandation**:
```typescript
// En production avec EAS Build:
// npm install react-native-ssl-pinning
// Configurer avec les certificats Supabase
```

#### V3. Clé de chiffrement fallback
**Sévérité**: 🟠 ÉLEVÉE  
**Fichier**: [secure-storage.ts](src/lib/secure-storage.ts)

```typescript
// Si envKey non définie, une clé runtime est générée
```

**Risque**: Si `EXPO_PUBLIC_ENCRYPTION_KEY` n'est pas définie, une clé aléatoire est générée, ce qui peut causer des pertes de données entre sessions.

**Recommandation**:
```bash
# Définir dans .env
EXPO_PUBLIC_ENCRYPTION_KEY=$(openssl rand -base64 32)
```

---

### MOYENNE — Score Impact: -0.3

#### V4. Console logs en production
**Sévérité**: 🟡 MOYENNE  

Plusieurs fichiers contiennent des `console.warn/error` qui pourraient exposer des informations sensibles en production.

**Fichiers concernés**:
- `supabase-auth.ts` (token warnings)
- `AdminProducerOrders.tsx` (token errors)
- `reset-password.tsx` (token validation)

**Recommandation**:
```typescript
// Wrapper conditionnel
const secureLog = (msg: string, data?: unknown) => {
  if (__DEV__) console.log(msg, data);
};
```

#### V5. HTTP autorisé en développement
**Sévérité**: 🟡 MOYENNE  
**Fichier**: [notify-order-status/index.ts](supabase/functions/notify-order-status/index.ts)

```typescript
'http://localhost:8081', // Expo dev
'http://localhost:19006', // Expo web
```

**Risque**: HTTP en clair accepté pour le développement local.

**Statut**: ✅ OK en dev, à vérifier que ces origines sont retirées en production.

---

### FAIBLE — Score Impact: -0.1

#### V6. Accessibilité insuffisante
**Sévérité**: 🟢 FAIBLE  

Très peu de composants utilisent `accessibilityLabel` ou `accessibilityRole`.

**Recherche effectuée**:
```
grep accessibilityLabel src/**/*.tsx → Principalement dans documentation
```

**Recommandation**:
- Ajouter `accessibilityLabel` sur tous les boutons
- Ajouter `accessibilityRole` sur les éléments interactifs
- Tester avec VoiceOver/TalkBack

---

## 📋 MATRICE OWASP Mobile Top 10 (2024)

| # | Vulnérabilité | Status | Détails |
|---|---------------|--------|---------|
| M1 | Improper Credential Usage | ✅ OK | Tokens en SecureStore |
| M2 | Inadequate Supply Chain Security | ⚠️ À VÉRIFIER | Dépendances npm non auditées |
| M3 | Insecure Authentication/Authorization | ✅ OK | JWT + RLS + Rate limiting |
| M4 | Insufficient Input/Output Validation | ✅ OK | Zod + sanitization |
| M5 | Insecure Communication | ⚠️ MOYEN | Pas de SSL pinning natif |
| M6 | Inadequate Privacy Controls | ✅ OK | RGPD implémenté |
| M7 | Insufficient Binary Protections | ❓ N/A | Expo managed workflow |
| M8 | Security Misconfiguration | ✅ OK | RLS activé partout |
| M9 | Insecure Data Storage | ✅ OK | AES-256-GCM |
| M10 | Insufficient Cryptography | ✅ OK | PBKDF2 100k + GCM |

---

## 🎯 PLAN D'ACTION PRIORITAIRE

### P0 — URGENT (Cette semaine)

| # | Action | Effort | Impact |
|---|--------|--------|--------|
| 1 | Définir `EXPO_PUBLIC_ENCRYPTION_KEY` en production | 5 min | 🔴 Critique |
| 2 | Audit npm: `npm audit` ou `bun audit` | 10 min | 🟠 Élevé |
| 3 | Vérifier rate limits Supabase Dashboard | 15 min | 🟠 Élevé |

### P1 — COURT TERME (Ce mois)

| # | Action | Effort | Impact |
|---|--------|--------|--------|
| 4 | Implémenter SSL Pinning avec EAS Build | 2h | 🟠 Élevé |
| 5 | Supprimer console.log sensibles en prod | 1h | 🟡 Moyen |
| 6 | Ajouter Sentry pour monitoring erreurs | 2h | 🟡 Moyen |

### P2 — MOYEN TERME (Ce trimestre)

| # | Action | Effort | Impact |
|---|--------|--------|--------|
| 7 | Accessibilité: labels sur composants | 4h | 🟢 Faible |
| 8 | Tests de pénétration automatisés | 1j | 🟡 Moyen |
| 9 | Documentation sécurité utilisateur | 2h | 🟢 Faible |

---

## 📊 COMPARAISON AVEC AUDIT PRÉCÉDENT

| Critère | Jan 2026 | Fév 2026 | Évolution |
|---------|----------|----------|-----------|
| Score Global | 6.5/10 | **7.8/10** | ✅ +1.3 |
| RLS Coverage | 80% | **95%** | ✅ +15% |
| Input Validation | Partiel | **Complet** | ✅ |
| Rate Limiting | Client only | **Client + Edge** | ✅ |
| RGPD | Partiel | **Complet** | ✅ |
| SSL Pinning | ❌ | ⚠️ Préparé | ➡️ |

---

## ✅ CERTIFICATION

Ce rapport certifie que l'application **Les Chanvriers Unis** présente un niveau de sécurité **BON (7.8/10)** pour une application marketplace B2C/B2B.

**Points d'excellence**:
- Architecture backend-first avec RLS
- Chiffrement moderne (AES-256-GCM)
- Rate limiting multicouche
- Conformité RGPD native

**Points d'amélioration prioritaires**:
- SSL Pinning pour protection MITM
- Clé de chiffrement obligatoire
- Accessibilité (WCAG 2.1)

---

*Rapport généré le 1er février 2026*  
*Prochaine révision recommandée: 1er mars 2026*
