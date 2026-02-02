# 🔒 AUDIT DE SÉCURITÉ - Les Chanvriers Unis
## Date: 31 Janvier 2026

---

## 📊 RÉSUMÉ EXÉCUTIF

| Catégorie | Score | Statut |
|-----------|-------|--------|
| **Score Global** | **7.2/10** | ⚠️ Améliorations nécessaires |
| Authentification | 8/10 | ✅ Bon |
| RLS Policies | 9/10 | ✅ Excellent |
| Edge Functions | 8/10 | ✅ Bon |
| Input Validation | 8/10 | ✅ Bon |
| Gestion Secrets | 5/10 | ⚠️ À améliorer |
| Dépendances | 4/10 | ❌ Vulnérabilités |

---

## 🚨 VULNÉRABILITÉS CRITIQUES

### SEC-001: Clés API exposées (URGENT)
- **Sévérité**: CRITIQUE
- **OWASP**: A02:2021 - Cryptographic Failures
- **Statut**: ⚠️ PARTIELLEMENT RÉSOLU
- **Description**: Les clés Supabase ont été exposées dans la conversation. Les clés legacy ont été réactivées temporairement.
- **Recommandation**: 
  1. Contacter le support Supabase pour rotation complète
  2. Migrer vers les clés "publishable/secret" (ES256)
  3. Révoquer les anciennes clés une fois la migration complète

### SEC-002: Fichier .env non protégé
- **Sévérité**: HAUTE
- **OWASP**: A05:2021 - Security Misconfiguration
- **Fichier**: `.gitignore`
- **Description**: Le pattern `.env` n'est pas explicitement dans .gitignore (seulement `.env*.local`)
- **Recommandation**: Ajouter `.env` au .gitignore

```gitignore
# Ajouter ces lignes
.env
.env.*
!.env.example
```

### SEC-003: Dépendances vulnérables (9 vulnérabilités)
- **Sévérité**: MOYENNE (dépendances transitives)
- **OWASP**: A06:2021 - Vulnerable and Outdated Components
- **Statut**: ✅ PARTIELLEMENT RÉSOLU (npm audit fix exécuté)

| Package | Sévérité | Type | Impact Réel |
|---------|----------|------|-------------|
| fast-xml-parser | HIGH | DoS | FAIBLE (dev tools) |
| markdown-it | MODERATE | DoS | MODÉRÉ (pas de fix) |
| ~~tar~~ | ~~HIGH~~ | ~~Path Traversal~~ | ✅ CORRIGÉ |

**Note**: Les vulnérabilités restantes sont dans des dépendances transitives:
- `fast-xml-parser` → `@react-native-community/cli` (outils de build)
- `markdown-it` → `react-native-markdown-display` (pas de fix disponible)

**⚠️ NE PAS exécuter `npm audit fix --force`** - cela casserait React Native.

- **Recommandation**: Surveiller les mises à jour de ces dépendances

---

## ✅ POINTS POSITIFS

### Authentification (8/10)
- ✅ Rate limiting implémenté (5 tentatives/60s)
- ✅ SecureStorage utilisé pour tokens (AES-256-GCM)
- ✅ PBKDF2 avec 100,000 itérations pour dérivation de clé
- ✅ Tokens stockés dans expo-secure-store (iOS/Android)
- ✅ Validation email côté client et serveur

### RLS Policies (9/10)
- ✅ RLS activé sur toutes les tables sensibles
- ✅ FORCE ROW LEVEL SECURITY appliqué
- ✅ Fonctions helper SECURITY DEFINER avec `SET search_path = ''`
- ✅ Séparation des rôles (client, pro, producer, admin)
- ✅ Audit log table avec RLS

### Edge Functions (8/10)
- ✅ Validation Zod pour toutes les entrées
- ✅ Rate limiting par utilisateur
- ✅ CORS headers configurés
- ✅ Vérification rôle utilisateur
- ⚠️ Middleware inliné (dette technique acceptable)

### Input Validation (8/10)
- ✅ `isValidEmail()` avec regex cohérente client/serveur
- ✅ `sanitizeText()` supprime caractères de contrôle
- ✅ `escapeSqlLike()` pour requêtes LIKE
- ✅ `escapeHtml()` pour prévention XSS
- ✅ `checkPasswordStrength()` avec scoring

---

## ⚠️ DETTE TECHNIQUE

### DT-001: dangerouslySetInnerHTML (FAIBLE)
- **Fichier**: `src/app/+html.tsx` (ligne 22)
- **Risque**: XSS potentiel si contenu non sanitizé
- **Statut**: Acceptable (contenu statique CSS)

### DT-002: innerHTML dans composants
- **Fichiers**: 
  - `src/components/LabAnalysisUploader.tsx`
  - `src/components/LabAnalysisViewer.tsx`
- **Risque**: XSS si message d'erreur contient input utilisateur
- **Recommandation**: Utiliser textContent ou sanitizer

### DT-003: Logs contenant références "token"
- **Fichiers**: 
  - `src/app/auth/reset-password.tsx`
  - `src/components/AdminProducerOrders.tsx`
- **Risque**: Faible - logs de warning, pas de valeur exposée
- **Statut**: Acceptable

### DT-004: EXPO_PUBLIC_ENCRYPTION_KEY dupliquée
- **Fichier**: `.env` (lignes 2-3)
- **Description**: Variable définie deux fois
- **Recommandation**: Supprimer la ligne dupliquée

---

## 📋 CHECKLIST DE CONFORMITÉ OWASP TOP 10 (2021)

| # | Catégorie | Statut | Notes |
|---|-----------|--------|-------|
| A01 | Broken Access Control | ✅ OK | RLS policies complètes |
| A02 | Cryptographic Failures | ⚠️ | Rotation clés nécessaire |
| A03 | Injection | ✅ OK | Validation + paramètres Supabase |
| A04 | Insecure Design | ✅ OK | Architecture sécurisée |
| A05 | Security Misconfiguration | ⚠️ | .gitignore à corriger |
| A06 | Vulnerable Components | ❌ | 10 vulnérabilités npm |
| A07 | Auth Failures | ✅ OK | Rate limiting, SecureStorage |
| A08 | Software/Data Integrity | ✅ OK | Vérification signatures |
| A09 | Security Logging | ✅ OK | Audit log table |
| A10 | SSRF | ✅ OK | Pas de fetch dynamique |

---

## 🎯 PLAN D'ACTION PRIORITAIRE

### Immédiat (0-24h)
- [ ] Corriger `.gitignore` pour inclure `.env`
- [ ] Exécuter `npm audit fix`
- [ ] Supprimer la ligne dupliquée dans `.env`

### Court terme (1-7 jours)
- [ ] Contacter support Supabase pour rotation clés
- [ ] Migrer vers clés publishable/secret (ES256)
- [ ] Mettre à jour `react-native-markdown-display`

### Moyen terme (1-4 semaines)
- [ ] Remplacer innerHTML par textContent
- [ ] Ajouter CSP headers si déploiement web
- [ ] Automatiser `npm audit` dans CI/CD

---

## 📈 ÉVOLUTION DETTE TECHNIQUE

| Date | Score Sécurité | Vulnérabilités | Actions |
|------|----------------|----------------|---------|
| 2026-01-15 | 6.5/10 | 15 | Audit initial |
| 2026-01-31 | 7.2/10 | 10 | Edge Functions fixés |

---

## 🔐 CONFIGURATION SECRETS ACTUELLE

### Edge Functions (Supabase)
| Secret | Configuré | Notes |
|--------|-----------|-------|
| SUPABASE_URL | ✅ | Auto-injecté |
| SUPABASE_ANON_KEY | ✅ | Auto-injecté |
| SUPABASE_SERVICE_ROLE_KEY | ✅ | À surveiller |
| RESEND_API_KEY | ✅ | Pour emails |

### Application (.env)
| Variable | Statut |
|----------|--------|
| EXPO_PUBLIC_SUPABASE_URL | ✅ |
| EXPO_PUBLIC_SUPABASE_ANON_KEY | ⚠️ Exposée |
| EXPO_PUBLIC_ENCRYPTION_KEY | ⚠️ Dupliquée |

---

## 📝 CONCLUSION

L'application "Les Chanvriers Unis" présente une **architecture de sécurité solide** avec des RLS policies complètes, une validation d'entrée robuste, et un stockage sécurisé des tokens.

**Points d'attention prioritaires**:
1. Rotation des clés Supabase (exposition récente)
2. Mise à jour des dépendances vulnérables
3. Correction du .gitignore

**Score global: 7.2/10** - Sécurité acceptable avec améliorations ciblées nécessaires.

---

*Audit réalisé selon les standards OWASP Top 10 (2021)*
*Prochain audit recommandé: 2026-02-28*
