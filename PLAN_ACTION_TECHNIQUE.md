# 🔧 PLAN D'ACTION TECHNIQUE - CORRECTIONS PRIORITAIRES
## Application Les Chanvriers Unis

**Date**: 2026-01-28
**Durée estimée**: 7 jours
**Effort**: 1 développeur senior full-time

---

## 🎯 JOUR 1 - SÉCURITÉ CLÉS API

### 1.1 Révoquer les Clés Compromises

**Temps estimé**: 1h

```bash
# 1. OpenAI
# https://platform.openai.com/api-keys
# → Révoquer: sk-proj-...
# → Générer nouvelle clé
# → Noter: OPENAI_API_KEY (sans EXPO_PUBLIC_)

# 2. Anthropic
# https://console.anthropic.com/settings/keys
# → Révoquer: sk-ant-api03-...
# → Générer nouvelle clé
# → Noter: ANTHROPIC_API_KEY

# 3. Grok (xAI)
# https://console.x.ai/
# → Révoquer: xai-...
# → Générer nouvelle clé
# → Noter: GROK_API_KEY

# 4. ElevenLabs
# https://elevenlabs.io/app/settings/api-keys
# → Révoquer: ...
# → Générer nouvelle clé
# → Noter: ELEVENLABS_API_KEY

# 5. Google AI
# https://console.cloud.google.com/apis/credentials
# → Révoquer: ...
# → Générer nouvelle clé
# → Noter: GOOGLE_AI_API_KEY
```

### 1.2 Configurer Variables Supabase

**Temps estimé**: 30min

**Dashboard Supabase**:
1. Aller sur https://supabase.com/dashboard/project/[votre-projet]/settings/functions
2. Section "Environment variables"
3. Ajouter chaque clé:

```
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...
GROK_API_KEY=xai-...
GOOGLE_AI_API_KEY=...
ELEVENLABS_API_KEY=...
```

4. Redéployer les Edge Functions:
```bash
supabase functions deploy openai-proxy
supabase functions deploy anthropic-proxy
supabase functions deploy grok-proxy
supabase functions deploy google-proxy
supabase functions deploy elevenlabs-proxy
```

### 1.3 Nettoyer .env et Git

**Temps estimé**: 1h30

**Fichier**: `.env`
```bash
# SUPPRIMER ces lignes:
EXPO_PUBLIC_VIBECODE_OPENAI_API_KEY=...
EXPO_PUBLIC_VIBECODE_ANTHROPIC_API_KEY=...
EXPO_PUBLIC_VIBECODE_GROK_API_KEY=...
EXPO_PUBLIC_VIBECODE_GOOGLE_API_KEY=...
EXPO_PUBLIC_VIBECODE_ELEVENLABS_API_KEY=...

# GARDER uniquement:
EXPO_PUBLIC_SUPABASE_URL=https://...
EXPO_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOiJI...
EXPO_PUBLIC_ENCRYPTION_KEY=Xp9Qm2Rk8Lv3Hn7Jw4Zt6Gb1Yf5Dc0Sa=
```

**Fichier**: `.gitignore`
```bash
# Ajouter à la fin:
.env
.env.local
.env.*.local
*.key
*.pem
```

**Git cleanup**:
```bash
# 1. Commit les changements actuels
git add .gitignore
git commit -m "Add .env to gitignore"

# 2. Retirer .env du repo
git rm --cached .env
git commit -m "Remove .env from version control"

# 3. Nettoyer l'historique (ATTENTION: DESTRUCTIF)
git filter-branch --force --index-filter \
  'git rm --cached --ignore-unmatch .env' \
  --prune-empty --tag-name-filter cat -- --all

# 4. Force push (si repo privé)
git push origin --force --all

# 5. Vérifier qu'il n'y a plus de trace
git log --all --full-history -- .env
# Devrait être vide
```

### 1.4 Vérifier Edge Functions

**Temps estimé**: 30min

**Fichier**: `supabase/functions/openai-proxy/index.ts`
```typescript
// Vérifier ligne 15-20:
const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY'); // ✅ Sans EXPO_PUBLIC_

if (!OPENAI_API_KEY) {
  return new Response(JSON.stringify({
    error: 'Configuration error',
    message: 'OpenAI API key not configured'
  }), { status: 500 });
}
```

Répéter pour tous les proxies.

**Test manuel**:
```bash
# Dans l'app mobile, tester un appel AI
# Vérifier dans logs Supabase que la clé est utilisée côté serveur
```

---

## 🎯 JOUR 2 - MONITORING SENTRY

### 2.1 Installer Dépendances

**Temps estimé**: 30min

```bash
# Terminal
npx expo install @sentry/react-native

# iOS
cd ios && pod install && cd ..
```

### 2.2 Configuration Sentry

**Temps estimé**: 1h

**Créer compte Sentry**:
1. https://sentry.io/signup/
2. Créer organisation "Les Chanvriers Unis"
3. Créer projet "mobile-app" (React Native)
4. Noter le DSN: `https://xxx@xxx.ingest.sentry.io/xxx`

**Fichier**: `app.json`
```json
{
  "expo": {
    "plugins": [
      [
        "@sentry/react-native/expo",
        {
          "organization": "les-chanvriers",
          "project": "mobile-app"
        }
      ]
    ],
    "hooks": {
      "postPublish": [
        {
          "file": "sentry-expo/upload-sourcemaps",
          "config": {
            "organization": "les-chanvriers",
            "project": "mobile-app"
          }
        }
      ]
    }
  }
}
```

**Fichier**: `.env` (ajouter)
```bash
SENTRY_DSN=https://xxx@xxx.ingest.sentry.io/xxx
SENTRY_AUTH_TOKEN=... # De Sentry > Settings > Auth Tokens
```

**Fichier**: `src/app/_layout.tsx`
```typescript
// Ligne 1-10: Ajouter import
import * as Sentry from '@sentry/react-native';

// Ligne 43: Avant SplashScreen.preventAutoHideAsync()
Sentry.init({
  dsn: process.env.SENTRY_DSN,
  enableInExpoDevelopment: false,
  tracesSampleRate: 0.2,
  environment: __DEV__ ? 'development' : 'production',
  beforeSend(event) {
    // Supprimer données sensibles
    if (event.user) {
      delete event.user.email;
      delete event.user.ip_address;
    }
    return event;
  },
});

// Ligne 286: Wrapper root layout (remplacer export default)
export default Sentry.wrap(RootLayout);
```

### 2.3 Supprimer console.log

**Temps estimé**: 1h

**Fichier**: `babel.config.js`
```javascript
module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    plugins: [
      'react-native-reanimated/plugin',
      // AJOUTER:
      ['transform-remove-console', {
        exclude: ['error', 'warn', 'info']
      }]
    ],
  };
};
```

**Installer plugin**:
```bash
npm install --save-dev babel-plugin-transform-remove-console
```

**Fichier**: `metro.config.js`
```javascript
// Ligne 15-25: Ajouter dans transformer
module.exports = {
  transformer: {
    getTransformOptions: async () => ({
      transform: {
        experimentalImportSupport: false,
        inlineRequires: true,
      },
    }),
    // AJOUTER:
    minifierConfig: {
      compress: {
        drop_console: true, // Supprimer ALL console.*
        drop_debugger: true,
        pure_funcs: ['console.log', 'console.info', 'console.debug']
      }
    }
  },
};
```

### 2.4 Test Sentry

**Temps estimé**: 30min

**Créer bouton test** (temporaire):
```typescript
// src/app/(tabs)/map.tsx - Ajouter dans component
<Pressable
  onPress={() => {
    Sentry.captureException(new Error('Test Sentry'));
  }}
  className="bg-red-500 p-4 rounded"
>
  <Text className="text-white">Test Sentry</Text>
</Pressable>
```

**Vérifier**:
1. Build l'app: `npx expo run:android` ou `npx expo run:ios`
2. Appuyer sur bouton Test
3. Aller sur Sentry Dashboard: Issues
4. Vérifier que l'erreur apparaît avec stack trace
5. Retirer le bouton test

---

## 🎯 JOUR 3 - OPTIMISATION ASSETS

### 3.1 Convertir PNG → WebP

**Temps estimé**: 3h

**Installer outils**:
```bash
npm install --save-dev sharp imagemin imagemin-webp
```

**Script**: `scripts/convert-to-webp.js`
```javascript
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

async function convertToWebP(inputPath) {
  const outputPath = inputPath.replace(/\.(png|jpg|jpeg)$/i, '.webp');

  await sharp(inputPath)
    .webp({ quality: 80, effort: 6 })
    .toFile(outputPath);

  console.log(`Converted: ${inputPath} → ${outputPath}`);

  // Supprimer l'original
  fs.unlinkSync(inputPath);
}

async function processDirectory(dir) {
  const files = fs.readdirSync(dir, { withFileTypes: true });

  for (const file of files) {
    const fullPath = path.join(dir, file.name);

    if (file.isDirectory()) {
      await processDirectory(fullPath);
    } else if (/\.(png|jpg|jpeg)$/i.test(file.name)) {
      await convertToWebP(fullPath);
    }
  }
}

processDirectory('./assets');
```

**Exécuter**:
```bash
node scripts/convert-to-webp.js
```

### 3.2 Optimiser Images Restantes

**Temps estimé**: 1h

**Service en ligne** (si pas Node):
1. https://tinypng.com/ ou https://squoosh.app/
2. Upload toutes les images assets/
3. Télécharger compressées
4. Remplacer

**Ou CLI**:
```bash
# TinyPNG CLI
npm install -g tinify-cli
tinify-cli assets/**/*.{png,jpg,jpeg} --key YOUR_TINYPNG_KEY

# ImageOptim (Mac uniquement)
brew install imageoptim-cli
imageoptim --quality 80 assets/
```

### 3.3 Utiliser expo-image

**Temps estimé**: 2h

**Installer**:
```bash
npx expo install expo-image
```

**Remplacer Image par expo-image partout**:

**AVANT** (`ProductCard.tsx`, `ProducerProfile.tsx`, etc.):
```typescript
import { Image } from 'react-native';

<Image
  source={{ uri: product.image }}
  style={{ width: 100, height: 100 }}
/>
```

**APRÈS**:
```typescript
import { Image } from 'expo-image';

<Image
  source={{ uri: product.image }}
  style={{ width: 100, height: 100 }}
  contentFit="cover"
  transition={200}
  placeholder={require('./placeholder.png')} // Optionnel
  placeholderContentFit="cover"
/>
```

**Fichiers à modifier** (~40 fichiers):
```bash
# Trouver tous les fichiers avec Image de RN
grep -r "from 'react-native'" src/ | grep Image

# Remplacer manuellement ou avec sed:
find src -name "*.tsx" -exec sed -i '' 's/Image } from '\''react-native'\''/Image } from '\''expo-image'\''/g' {} +
```

### 3.4 Vérifier Bundle Size

**Temps estimé**: 30min

```bash
# Build Android
eas build --platform android --profile production

# Vérifier taille APK téléchargé
# Cible: < 50 MB

# Vérifier assets
du -sh assets/
# Cible: < 15 MB

# Assets avant: 74 MB
# Assets après: ~12 MB
# Gain: -62 MB (-84%)
```

---

## 🎯 JOUR 4-5 - ACCESSIBILITÉ

### 4.1 Audit Accessibilité

**Temps estimé**: 2h

**Fichiers prioritaires** (40+ composants):
```
src/components/ui/Button.tsx
src/components/ui/Card.tsx
src/components/ProductCard.tsx
src/components/ProducerCard.tsx
src/app/(tabs)/map.tsx
src/app/(tabs)/farming.tsx
src/app/(tabs)/_layout.tsx
... tous les screens
```

### 4.2 Ajouter Propriétés Accessibilité

**Temps estimé**: 8h (répartir sur 2 jours)

**Pattern général**:

**Boutons**:
```typescript
<Pressable
  onPress={handlePress}
  accessibilityLabel="Ajouter au panier" // Ce que fait le bouton
  accessibilityRole="button"
  accessibilityHint="Double-tap pour ajouter ce produit au panier" // Comment l'utiliser
  accessibilityState={{
    disabled: !available,
    selected: isSelected
  }}
>
  <Text>Ajouter</Text>
</Pressable>
```

**Images**:
```typescript
<Image
  source={{ uri: product.image }}
  accessibilityLabel={`Photo de ${product.name}`}
  accessibilityRole="image"
  accessible={true}
/>
```

**Text Important**:
```typescript
<Text
  accessibilityRole="header"
  accessibilityLevel={1} // h1, h2, etc.
>
  {producer.name}
</Text>
```

**Icons seuls**:
```typescript
<Pressable
  onPress={toggleFavorite}
  accessibilityLabel={isFavorite ? "Retirer des favoris" : "Ajouter aux favoris"}
  accessibilityRole="button"
>
  <Heart color={isFavorite ? "red" : "gray"} />
</Pressable>
```

**Tab Navigation** (`(tabs)/_layout.tsx`):
```typescript
<Tabs.Screen
  name="map"
  options={{
    title: 'Carte',
    tabBarAccessibilityLabel: "Carte des producteurs",
    tabBarIcon: ({ focused }) => (
      <Map
        size={24}
        color={focused ? COLORS.primary.gold : COLORS.text.muted}
      />
    ),
  }}
/>
```

### 4.3 Tester avec Lecteurs d'Écran

**Temps estimé**: 2h

**iOS VoiceOver**:
1. Settings > Accessibility > VoiceOver > ON
2. Swiper pour naviguer
3. Double-tap pour activer
4. Vérifier tous les écrans critiques:
   - Login/Signup
   - Carte producteurs
   - Détail produit
   - Panier
   - Commande

**Android TalkBack**:
1. Settings > Accessibility > TalkBack > ON
2. Même tests

**Checklist**:
- [ ] Tous les boutons ont un label
- [ ] Tous les inputs ont un label
- [ ] Images décoratives ont `accessible={false}`
- [ ] Images importantes ont `accessibilityLabel`
- [ ] Navigation fluide au swipe
- [ ] Pas d'éléments "non identifiés"

---

## 🎯 JOUR 6 - BACKUP & DATABASE

### 6.1 Documentation Backup

**Temps estimé**: 2h

**Créer**: `database/BACKUP_STRATEGY.md`
```markdown
# Stratégie de Backup

## RTO/RPO
- RTO (Recovery Time Objective): 4 heures
- RPO (Recovery Point Objective): 15 minutes

## Données Critiques
### Priorité 1 (Legal/Critique)
- profiles, orders, audit_log_entries, rgpd_requests

### Priorité 2 (Business)
- products, producers, user_lots, commandes_vente_directe

### Priorité 3 (Reconstruisible)
- app_data, music_tracks, packs, lots

## Méthodes
1. **Supabase Auto Backup**: Quotidien, retention 30j
2. **Manual Backup**: Hebdomadaire via pg_dump
3. **Pre-Migration Backup**: Automatique avant chaque migration

## Procédures
### Restauration Complète
1. Supabase Dashboard > Database > Backups
2. Sélectionner backup date
3. Confirmer (downtime ~10 min)

### Restauration Partielle
```bash
pg_restore -t table_name backup.dump
```

## Tests
- Fréquence: Mensuel
- Environnement: Staging uniquement
```

### 6.2 Script Backup Manuel

**Temps estimé**: 1h

**Créer**: `scripts/backup-database.sh`
```bash
#!/bin/bash

# Configuration
DATE=$(date +%Y%m%d_%H%M%S)
BACKUP_DIR="database/backups"
DATABASE_URL="postgresql://..." # De Supabase

mkdir -p $BACKUP_DIR

echo "🗄️  Creating backup: $DATE"

# Backup complet
pg_dump $DATABASE_URL \
  --no-owner \
  --no-acl \
  --format=custom \
  --file="$BACKUP_DIR/backup_$DATE.dump"

# Backup schema uniquement
pg_dump $DATABASE_URL \
  --schema-only \
  --no-owner \
  --no-acl \
  > "$BACKUP_DIR/schema_$DATE.sql"

# Compression
gzip "$BACKUP_DIR/schema_$DATE.sql"

# Stats
SIZE=$(du -h "$BACKUP_DIR/backup_$DATE.dump" | cut -f1)
echo "✅ Backup completed: $SIZE"
echo "📁 Location: $BACKUP_DIR/backup_$DATE.dump"

# Retention (garder seulement 10 derniers)
ls -t $BACKUP_DIR/backup_*.dump | tail -n +11 | xargs -r rm
echo "🧹 Old backups cleaned"
```

**Rendre exécutable**:
```bash
chmod +x scripts/backup-database.sh
```

**Tester**:
```bash
./scripts/backup-database.sh
```

### 6.3 Test de Restauration

**Temps estimé**: 1h

**Créer environnement staging** (Supabase):
1. Dashboard > New Project: "les-chanvriers-staging"
2. Noter le DATABASE_URL staging

**Tester restauration**:
```bash
# 1. Récupérer dernier backup
LATEST_BACKUP=$(ls -t database/backups/backup_*.dump | head -1)

# 2. Restaurer sur staging
pg_restore \
  --dbname="postgresql://staging-url" \
  --no-owner \
  --no-acl \
  $LATEST_BACKUP

# 3. Vérifier intégrité
psql "postgresql://staging-url" << EOF
-- Compter tables
SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public';

-- Vérifier RLS actif
SELECT tablename, rowsecurity FROM pg_tables WHERE schemaname='public';

-- Tester query
SELECT COUNT(*) FROM profiles;
SELECT COUNT(*) FROM orders;
EOF

# 4. Nettoyer staging après test
# (ou garder pour future utilisation)
```

### 6.4 Ajouter Index Composites

**Temps estimé**: 2h

**Créer**: `database/migrations/010_add_composite_indexes.sql`
```sql
-- =============================================================================
-- Migration 010: Add Composite Indexes
-- Date: 2026-01-28
-- Description: Optimiser queries fréquentes avec index composites
-- =============================================================================

-- 1. Products par producteur et statut
CREATE INDEX IF NOT EXISTS idx_products_producer_status
  ON products(producer_id, status)
  WHERE status = 'published';

-- 2. Commandes par utilisateur et statut
CREATE INDEX IF NOT EXISTS idx_orders_user_status_date
  ON orders(user_id, status, created_at DESC);

-- 3. Panier par utilisateur et producteur
CREATE INDEX IF NOT EXISTS idx_panier_user_producer
  ON panier_vente_directe(user_id, producer_id);

-- 4. Produits par type et catégorie
CREATE INDEX IF NOT EXISTS idx_products_type_category
  ON products(type, category);

-- 5. Orders items (GIN index pour JSONB)
CREATE INDEX IF NOT EXISTS idx_orders_items_gin
  ON orders USING GIN (items jsonb_path_ops);

-- Vérifier index créés
SELECT
  schemaname,
  tablename,
  indexname,
  indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND indexname LIKE 'idx_%'
ORDER BY tablename, indexname;
```

**Exécuter**:
1. Backup pré-migration
2. Supabase Dashboard > SQL Editor
3. Copier/coller le SQL
4. Run
5. Vérifier résultats

---

## 🎯 JOUR 7 - SÉCURITÉ MOBILE

### 7.1 Supprimer Permissions Inutilisées

**Temps estimé**: 1h

**Fichier**: `android/app/src/main/AndroidManifest.xml`
```xml
<!-- SUPPRIMER ces lignes si non utilisées: -->
<uses-permission android:name="android.permission.READ_CONTACTS"/>
<uses-permission android:name="android.permission.WRITE_CONTACTS"/>
<uses-permission android:name="android.permission.READ_CALENDAR"/>
<uses-permission android:name="android.permission.WRITE_CALENDAR"/>
<uses-permission android:name="android.permission.READ_PHONE_STATE"/>
<uses-permission android:name="android.permission.WRITE_SETTINGS"/>
<uses-permission android:name="android.permission.WRITE_EXTERNAL_STORAGE"/>

<!-- GARDER seulement: -->
<uses-permission android:name="android.permission.CAMERA"/>
<uses-permission android:name="android.permission.INTERNET"/>
<uses-permission android:name="android.permission.ACCESS_FINE_LOCATION"/>
<uses-permission android:name="android.permission.READ_MEDIA_IMAGES"/>
<uses-permission android:name="android.permission.RECORD_AUDIO"/> <!-- Si utilisé -->
```

### 7.2 Désactiver Cleartext HTTP Release

**Temps estimé**: 30min

**Créer**: `android/app/src/release/AndroidManifest.xml`
```xml
<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android">
  <application
    android:usesCleartextTraffic="false"
    android:networkSecurityConfig="@xml/network_security_config"
  />
</manifest>
```

**Créer**: `android/app/src/main/res/xml/network_security_config.xml`
```xml
<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
  <base-config cleartextTrafficPermitted="false">
    <trust-anchors>
      <certificates src="system" />
    </trust-anchors>
  </base-config>
</network-security-config>
```

### 7.3 Activer Obfuscation (ProGuard/R8)

**Temps estimé**: 2h

**Fichier**: `android/app/build.gradle`
```gradle
android {
  buildTypes {
    release {
      minifyEnabled true
      shrinkResources true
      proguardFiles getDefaultProguardFile('proguard-android-optimize.txt'), 'proguard-rules.pro'
    }
  }
}
```

**Créer**: `android/app/proguard-rules.pro`
```proguard
# React Native
-keep class com.facebook.react.** { *; }
-keep class com.facebook.hermes.** { *; }

# Expo
-keep class expo.modules.** { *; }

# Supabase
-keep class io.supabase.** { *; }

# Sentry
-keep class io.sentry.** { *; }

# Keep Crashlytics
-keepattributes SourceFile,LineNumberTable
-keep class com.crashlytics.** { *; }
```

**Tester**:
```bash
# Build release avec obfuscation
cd android && ./gradlew assembleRelease

# Vérifier APK size
ls -lh app/build/outputs/apk/release/

# Installer et tester
adb install app/build/outputs/apk/release/app-release.apk
```

### 7.4 Validation Finale

**Temps estimé**: 2h

**Checklist**:
```bash
# 1. Sécurité
[ ] Clés API révoquées et reconfigurées
[ ] .env non tracké par git
[ ] Historique Git nettoyé
[ ] Edge Functions utilisent Deno.env

# 2. Monitoring
[ ] Sentry configuré
[ ] Test crash envoyé avec succès
[ ] console.log supprimés (vérifier: grep -r "console\." src/ | wc -l = 0)

# 3. Assets
[ ] Images WebP (vérifier: ls assets/*.webp)
[ ] Bundle size < 15 MB (vérifier: du -sh assets/)
[ ] expo-image utilisé partout

# 4. Accessibilité
[ ] accessibilityLabel ajouté sur composants critiques
[ ] Testé VoiceOver/TalkBack
[ ] Navigation fluide

# 5. Backup
[ ] Documentation créée
[ ] Script backup testé
[ ] Test restauration réussi
[ ] Index composites ajoutés

# 6. Mobile
[ ] Permissions nettoyées
[ ] Cleartext HTTP désactivé release
[ ] Obfuscation activée
[ ] Build release testé
```

---

## 📊 VALIDATION FINALE

### Métriques à Atteindre

```bash
# Bundle Size
du -sh assets/
# Cible: < 15 MB
# Avant: 74 MB
# Après: ~12 MB ✅

# console.log
grep -r "console\.(log|debug|info)" src/ | wc -l
# Cible: 0
# Avant: 792
# Après: 0 ✅

# Accessibilité
grep -r "accessibilityLabel" src/ | wc -l
# Cible: > 100
# Avant: 0
# Après: 150+ ✅

# Sentry
curl -X GET https://sentry.io/api/0/projects/[org]/[project]/issues/
# Cible: Test error visible
# ✅

# Git .env
git log --all -- .env | wc -l
# Cible: 0 (après nettoyage)
# ✅
```

### Build Final

```bash
# 1. Clean
rm -rf node_modules ios/Pods android/build
bun install

# 2. iOS Build
eas build --platform ios --profile production

# 3. Android Build
eas build --platform android --profile production

# 4. Tester sur devices réels
# - iPhone (iOS 15+)
# - Android (API 31+)

# 5. Vérifier Sentry Dashboard
# Crashes? Stack traces?

# 6. Vérifier accessibilité
# VoiceOver/TalkBack fonctionnels?
```

---

## ✅ SIGN-OFF

Une fois toutes les actions complétées:

- [ ] **Toutes les checkboxes cochées**
- [ ] **Tests sur devices réels passés**
- [ ] **Sentry dashboard configuré**
- [ ] **Backup testé avec succès**
- [ ] **Review code pair programming effectuée**

**Prêt pour déploiement production**: ✅

---

**Document préparé par**: Claude Sonnet 4.5
**Date**: 2026-01-28
**Durée totale estimée**: 7 jours
**Effort**: 1 développeur senior full-time

---

## 🧩 PLAN D’ACTION — RÉDUCTION DETTE TECHNIQUE & ANTI‑SPAGHETTI

**Date**: 2026-02-01
**Objectif**: retrouver une architecture claire, testable et alignée “backend‑first”.

### Phase 1 (Semaine 1) — Stabilisation & Sécurité
1. **Mutations sensibles vers Edge Functions**
  - Priorité: `orders`, `products`, `user_lots`, `user_gifts`, `promo_products`, `packs`.
2. **Standardiser les erreurs**
  - Centraliser `toUserError()` et supprimer les messages DB bruts côté client.
3. **Réduire la surface directe REST**
  - Le client conserve uniquement la lecture publique.

### Phase 2 (Semaine 2) — Découpage des services
1. **Scinder `supabase-sync.ts` par domaines**
  - `supabase-sync.products.ts`
  - `supabase-sync.orders.ts`
  - `supabase-sync.lots.ts`
  - `supabase-sync.chat.ts`
2. **Créer un “Data Access Layer” unifié**
  - Un module `data/` unique consommé par les hooks et écrans.

### Phase 3 (Semaine 3) — UI Pure & Tests
1. **Écrans = UI + hooks**
  - Déplacer les appels réseau vers `useXxx()`.
2. **Ajouter tests unitaires sur les mappers**
  - Produits, commandes, lots, profils.
3. **Contrats d’API documentés**
  - Schémas d’entrée/sortie (Zod) partagés.

### Phase 4 (Semaine 4) — Performance & Observabilité
1. **Caches de lecture + invalidations claires**
2. **Instrumentation erreurs** (Sentry/Logs)
3. **Mesures de dette** (taille fichiers, cyclomatic, duplication)

### Livrables attendus
- **Architecture cible** documentée
- **Edge Functions** pour toutes les mutations sensibles
- **Codebase plus modulaire** (responsabilités isolées)
