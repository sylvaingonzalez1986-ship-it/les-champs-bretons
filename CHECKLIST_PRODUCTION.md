# ✅ CHECKLIST PRE-PRODUCTION
## Application Les Chanvriers Unis

**Dernière mise à jour**: 2026-01-28
**À compléter avant**: Mise en production v1.0

---

## 🔴 BLOQUEURS CRITIQUES (OBLIGATOIRE)

### Sécurité des Clés API
- [ ] Toutes les clés `EXPO_PUBLIC_VIBECODE_*` retirées du .env
- [ ] Clés API déplacées vers Supabase Edge Functions variables
- [ ] Clés anciennes révoquées (OpenAI, Anthropic, Grok, ElevenLabs)
- [ ] Nouvelles clés générées et configurées
- [ ] .env ajouté au .gitignore
- [ ] Historique Git nettoyé (`git filter-branch`)
- [ ] Client utilise proxies Edge Functions (pas d'appels directs)

### Monitoring & Observabilité
- [ ] Sentry installé et configuré
- [ ] Test crash envoyé et visible dans Sentry Dashboard
- [ ] Tous les `console.log` supprimés en production
- [ ] transform-remove-console configuré dans babel.config.js
- [ ] Source maps uploadées vers Sentry

### Assets & Performance
- [ ] Images PNG converties en WebP
- [ ] Assets compressés (< 15 MB total)
- [ ] Taille bundle APK mesurée (< 50 MB)
- [ ] Cold start time mesuré (< 2s)

### Backup & Récupération
- [ ] Stratégie backup documentée (BACKUP_STRATEGY.md)
- [ ] Test de restauration effectué et réussi
- [ ] Backup automatique configuré (quotidien)
- [ ] RTO/RPO définis et acceptés

---

## 🟡 IMPORTANT (FORTEMENT RECOMMANDÉ)

### Accessibilité
- [ ] accessibilityLabel ajouté sur tous les boutons/contrôles
- [ ] accessibilityRole définis (button, header, image, etc.)
- [ ] Contraste couleurs vérifié (min 4.5:1)
- [ ] Touch targets min 44x44dp partout
- [ ] Testé avec VoiceOver (iOS) activé
- [ ] Testé avec TalkBack (Android) activé

### Sécurité Mobile
- [ ] usesCleartextTraffic=false en release (AndroidManifest.xml)
- [ ] Permissions inutilisées retirées (READ_CONTACTS, etc.)
- [ ] Code obfusqué activé (ProGuard/R8 en release)
- [ ] Certificate pinning implémenté

### Performance
- [ ] Listes virtualisées avec @shopify/flash-list (pas ScrollView.map)
- [ ] React.memo sur composants lourds (ProductCard, etc.)
- [ ] Index composites ajoutés en base de données
- [ ] AsyncStorage migré vers MMKV

### UX
- [ ] Nombre de tabs réduit à 5-6 maximum
- [ ] Pull-to-refresh sur toutes les listes
- [ ] Messages d'erreur user-friendly (pas "Failed to fetch")
- [ ] Loading states partout
- [ ] Feedback haptique sur actions importantes

---

## 🟢 NICE TO HAVE (OPTIONNEL)

### Code Quality
- [ ] Code splitting implémenté (lazy loading modals)
- [ ] Pattern Repository pour découplage modules
- [ ] Logger structuré remplace console.log
- [ ] Tests E2E critiques en place

### Documentation
- [ ] README.md à jour avec instructions setup
- [ ] SCHEMA.md créé avec diagramme ERD
- [ ] API documentation à jour
- [ ] Runbook incidents créé

### Analytics
- [ ] Posthog installé et configuré
- [ ] Events clés trackés (screen views, purchases, etc.)
- [ ] Funnel de conversion défini

### Infrastructure
- [ ] Assets migrés vers Supabase Storage + CDN
- [ ] Dashboard métriques temps réel (Grafana/DataDog)
- [ ] Alerts configurées (Supabase, Sentry)

---

## 📊 MÉTRIQUES À VÉRIFIER

### Performance
```bash
# Cold start time
expo-performance measure:coldStart
# Cible: < 2s

# Bundle size
eas build --platform android --profile production
# Cible: < 50 MB

# Assets size
du -sh assets/
# Cible: < 15 MB
```

### Sécurité
```bash
# Clés exposées
node src/lib/security-check.ts
# Cible: 0 warnings

# Vulnérabilités npm
npm audit --production
# Cible: 0 critical, 0 high

# console.log en production
grep -r "console\." src/ | wc -l
# Cible: 0 (sauf console.error/warn)
```

### Database
```sql
-- Tables sans RLS
SELECT tablename FROM pg_tables
WHERE schemaname='public'
AND tablename NOT IN (
  SELECT tablename FROM pg_tables
  WHERE schemaname='public' AND rowsecurity=true
);
-- Cible: liste vide

-- Index manquants sur FK
SELECT c.conrelid::regclass, a.attname
FROM pg_constraint c
JOIN pg_attribute a ON a.attnum = ANY(c.conkey)
WHERE c.contype = 'f'
AND NOT EXISTS (
  SELECT 1 FROM pg_index i
  WHERE i.indrelid = c.conrelid
  AND a.attnum = ANY(i.indkey)
);
-- Cible: Vérifier chaque résultat
```

---

## 🎯 VALIDATION FINALE

Avant de cocher "PRÊT POUR PRODUCTION", valider:

- [ ] **Tous les bloqueurs critiques (🔴) sont résolus**
- [ ] **Au moins 80% des "Important" (🟡) sont résolus**
- [ ] **Tests end-to-end passent sur iOS et Android**
- [ ] **Test utilisateur réalisé avec au moins 5 personnes**
- [ ] **Review sécurité par un tiers approuvée**
- [ ] **Backup testé avec succès dans les 7 derniers jours**

---

## 📝 SIGNATURES

| Rôle | Nom | Date | Signature |
|------|-----|------|-----------|
| Tech Lead | | | |
| DevOps | | | |
| Security | | | |
| Product Owner | | | |

---

## 📞 CONTACTS URGENCE

**En cas de problème critique en production**:

- Tech Lead: [téléphone]
- DevOps On-call: [téléphone]
- Supabase Support: support@supabase.io
- Sentry Dashboard: https://sentry.io/organizations/les-chanvriers

---

**Version**: 1.0
**Basé sur**: Audit complet 2026-01-28
