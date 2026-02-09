# Les Chanvriers Unis

Application de tirage au sort de produits chanvre français. Les utilisateurs peuvent ouvrir des box mystères pour recevoir des produits aléatoires de producteurs français, avec un systeme de rarete.

Derniere mise a jour: 2026-02-07

## Liens utiles
- Docs securite: [docs/SECURITY.md](docs/SECURITY.md)
- Docs reseau pro: [docs/PRO_RESOURCES.md](docs/PRO_RESOURCES.md)
- Audit securite: [docs/SECURITY_AUDIT_REPORT.md](docs/SECURITY_AUDIT_REPORT.md)
- RLS policies: [database/RLS_DOCUMENTATION.md](database/RLS_DOCUMENTATION.md)

## Vue d'ensemble technique (2026)
- Stack: Expo SDK 53, React Native 0.76.7, React Query, Zustand, Supabase
- Donnees sensibles: mutations via Edge Functions uniquement (pas de writes directes en client)
- Stockage: buckets prives + URLs signees a l'acces
- Rate limiting applique aux fonctions publiques
- SSL pinning sur les appels Supabase critiques

## Fonctionnalites majeures
- Tirage / box mysteres
- Boutique + marche local
- Reseau Pro (ressources producteurs)
- Admin: gestion produits, ressources pro, commandes
- Audio / musique integrée

## Phase 5.5 - Tarifs dégressifs sur le Marché Local (2026-01-25)

### Amélioration : Tarifs dégressifs visibles sur le Marché Local

Les tarifs dégressifs sont maintenant visibles et fonctionnels sur le marché local, comme dans les boutiques.

#### Nouveautés
- **Indicateur de tarif dégressif** : Un badge s'affiche sur les produits ayant des paliers de prix dans le carrousel du marché local
- **Prix minimum affiché** : Le prix le plus bas possible (avec palier) est affiché à côté du prix de base
- **Grille complète dans le catalogue** : La page de catalogue marché local affiche tous les paliers de prix
- **Modal de commande avec tarifs** : Le modal de commande directe affiche les paliers et applique automatiquement le prix selon la quantité
- **Bouton "Commander"** : Ajout d'un bouton de commande directe dans le catalogue avec accès aux tarifs dégressifs

#### Fichiers modifiés
- `src/app/(tabs)/marche-local.tsx` - Ajout de price_tiers dans les requêtes et affichage des badges
- `src/app/(tabs)/marche-catalogue.tsx` - Affichage complet des tarifs dégressifs et modal de commande
- `src/components/LocalMarketOrderModal.tsx` - (déjà fonctionnel avec les paliers)

---

## Phase 5.4 - Audit de Sécurité Supabase (2026-01-25)

### Amélioration : Configuration des tarifs dégressifs pour producteurs

Les producteurs peuvent maintenant configurer deux grilles de tarifs dégressifs distinctes dans le formulaire d'ajout/édition de produit.

#### Nouveautés
- **Prix Pro séparé** : Un champ optionnel permet de définir un prix de base différent pour les professionnels
- **Deux sections de paliers** :
  - **Prix dégressifs CLIENTS** (jaune) : Configuration des paliers pour les clients particuliers
  - **Prix dégressifs PROS** (turquoise) : Configuration des paliers pour les professionnels
- **Prévisualisation** : Chaque section affiche un récapitulatif des paliers avec le pourcentage de réduction
- **Suggestions automatiques** : Lors de l'ajout d'un palier, le système suggère une quantité et un prix

#### Fichiers modifiés
- `src/components/AddProductModal.tsx` - Ajout des champs pricePro, enablePriceProTiers, priceProTiers

---

### Amélioration : Fiche produit avec tarifs dégressifs distincts

Les clients et les professionnels peuvent désormais voir une fiche produit complète en cliquant sur un article dans la boutique.

#### Nouveautés
- **Fiche produit cliquable** : Cliquer sur un produit ouvre un modal de détail complet
- **Deux grilles de tarifs distinctes** :
  - **Tarifs Clients** (jaune) : affiche le prix de base + paliers dégressifs pour les particuliers
  - **Tarifs Professionnels** (turquoise) : affiche le prix pro de base + paliers dégressifs pour les pros
- **Badge "Votre tarif"** : Le type de tarif applicable à l'utilisateur connecté est mis en évidence
- **Calcul dynamique** : Le prix s'ajuste en temps réel selon la quantité sélectionnée
- **Indicateur de prochain palier** : Montre combien d'unités ajouter pour atteindre le palier suivant
- **Économies affichées** : Montre l'économie réalisée grâce aux tarifs dégressifs

#### Fichiers créés/modifiés
- `src/components/ShopProductDetailModal.tsx` - Nouveau composant de fiche produit
- `src/app/(tabs)/shop.tsx` - Intégration du modal et gestion du clic sur les produits

---

### Amélioration : Affichage des tarifs dégressifs dans la boutique

Les clients et les professionnels peuvent désormais voir les tarifs dégressifs directement depuis la liste des produits dans la boutique, sans avoir besoin d'ouvrir le détail du produit.

#### Nouveautés
- **Badge "Tarifs dégressifs"** : Un indicateur jaune s'affiche sur les produits ayant des paliers de prix configurés
- **Liste expandable** : En cliquant sur le badge, les utilisateurs voient tous les paliers avec les prix correspondants
- **Adapté au type d'utilisateur** : Les pros voient les paliers pro (`priceProTiers`), les clients voient les paliers clients (`priceTiers`)

#### Fichiers modifiés
- `src/app/(tabs)/shop.tsx` - Ajout de l'affichage des tarifs dégressifs sur les cartes produits

---

## Phase 5.4 - Audit de Sécurité Supabase (2026-01-25)

### Corrections de sécurité appliquées

Suite à un audit complet de la base de données Supabase, les corrections suivantes ont été appliquées :

#### 1. Politiques RLS renforcées
- **RLS activé sur toutes les tables** avec `FORCE ROW LEVEL SECURITY`
- Nouvelles politiques pour `panier_vente_directe` et `commandes_vente_directe`
- Protection des audit logs (immuables : pas de UPDATE/DELETE possible)

#### 2. Index de performance ajoutés
- Index sur `profiles` : role, user_code, email
- Index sur `producers` : profile_id, region, department
- Index sur `products` : producer_id, status, type, visible_for_clients/pros
- Index sur `orders` : user_id, customer_email, status, created_at

#### 3. Fonctions SQL sécurisées
- Toutes les fonctions helper utilisent `SET search_path = ''`
- Fonctions concernées : `is_admin()`, `is_producer()`, `is_pro()`, `get_user_producer_id()`, `get_current_user_email()`

#### 4. Validation côté client
- Nouveau module `src/lib/input-validation.ts`
- Fonctions : validation email/téléphone/SIRET, sanitization texte, échappement SQL/HTML

### Migration requise
Exécuter dans l'éditeur SQL Supabase :
```
supabase/migrations/20260125_security_audit_fixes.sql
```

### Vérification post-déploiement
```sql
-- Vérifier RLS activé sur toutes les tables
SELECT tablename, rowsecurity FROM pg_tables WHERE schemaname = 'public';

-- Vérifier les politiques
SELECT tablename, policyname, cmd FROM pg_policies WHERE schemaname = 'public';
```

### Documentation
- `database/RLS_DOCUMENTATION.md` - Documentation complète mise à jour

---

## Phase 5.3 - Tarification par paliers (2026-01-25)

### Nouvelle fonctionnalité : Prix dégressifs selon la quantité

Les producteurs peuvent maintenant configurer des paliers de prix pour offrir des réductions automatiques en fonction de la quantité commandée.

#### Fonctionnalités

- **Configuration des paliers** : Dans le modal d'ajout/édition de produit, les producteurs peuvent activer la tarification par paliers et définir plusieurs seuils de quantité avec des prix dégressifs
- **Calcul automatique** : Le prix s'ajuste automatiquement quand le client ou le pro modifie la quantité dans le panier ou le modal produit
- **Affichage visuel** : Les clients voient clairement les paliers disponibles et leurs économies potentielles
- **Indicateur de prochain palier** : Un message indique combien d'unités ajouter pour atteindre le palier suivant

#### Fichiers modifiés
- `src/lib/producers.ts` - Ajout du type `PriceTier` et des fonctions helper `getPriceForQuantity()` et `getNextPriceTier()`
- `src/lib/supabase-producer.ts` - Ajout du champ `price_tiers` dans `ProducerProductDB`
- `src/components/AddProductModal.tsx` - Interface de configuration des paliers pour les producteurs
- `src/components/ProProductDetailModal.tsx` - Affichage des paliers et calcul dynamique du prix
- `src/app/(tabs)/cart.tsx` - Calcul du prix avec paliers dans le panier
- `src/app/(tabs)/ma-boutique.tsx` - Interface de configuration des paliers dans "Ma boutique"

#### Migration Supabase requise
Ajouter la colonne `price_tiers` à la table `producer_products` :
```sql
ALTER TABLE producer_products
ADD COLUMN price_tiers JSONB DEFAULT NULL;
```

#### Exemple d'utilisation
Un producteur peut configurer :
- Prix de base : 8€/unité
- À partir de 5 unités : 7.50€/unité (-6%)
- À partir de 10 unités : 7€/unité (-12%)
- À partir de 20 unités : 6.50€/unité (-19%)

---

## Phase 5.2 - Corrections Authentification (2026-01-23)

### Corrections appliquées

#### CORRECTION 1: Erreur "invalid login credentials" après confirmation email
- **Amélioration des messages d'erreur** : Messages plus explicites distinguant les différents cas (email non confirmé, mauvais mot de passe, compte inexistant)
- **Logs de diagnostic** : Ajout de logs détaillés pour faciliter le débogage des problèmes d'authentification
- **Détection automatique** : Le système détecte si l'erreur est liée à la confirmation email

#### CORRECTION 2: Bouton "Renvoyer l'email de confirmation"
- **Nouvelle fonction** : `resendConfirmationEmail()` dans supabase-auth.ts
- **Intégration useAuth** : Hook mis à jour avec `resendConfirmationEmail`, `isResendingConfirmation`, etc.
- **Interface utilisateur** : Bouton visible sur l'écran de connexion quand l'erreur suggère un problème de confirmation
- **Feedback visuel** : Message de succès "Email de confirmation renvoyé !"

#### CORRECTION 3: Gestion du rôle à l'inscription (rappel migration SQL)
- La migration `20260123_fix_signup_role.sql` doit être appliquée dans Supabase
- Le trigger `handle_new_user` lit maintenant le rôle depuis `raw_user_meta_data`

### Fichiers modifiés
- `src/lib/supabase-auth.ts` - Amélioration messages d'erreur + fonction resendConfirmationEmail
- `src/lib/useAuth.ts` - Exposition de la nouvelle mutation
- `src/app/auth/login.tsx` - Bouton renvoyer email de confirmation

### Configuration Supabase requise

#### Site URL
Dans Supabase Dashboard > Authentication > URL Configuration:
- **Site URL**: `https://votre-projet.supabase.co` (ou votre domaine personnalisé)
- **Redirect URLs**: Ajouter `com.leschanvriersunis.app://` pour les deep links

---

## Phase 5.1 - Corrections Gestion des Commandes (2026-01-22)

### Corrections appliquées

#### CORRECTION 1: Permissions boutons "Commandes"
- **admin.tsx**: Bouton visible uniquement pour `isAdmin || isProducer`
- **pro.tsx**: Bouton visible uniquement pour `isPro || isAdmin || isProApproved`
- Les utilisateurs non autorisés ne voient plus le bouton

#### CORRECTION 2: Intégration commandes Marché Local
- Import et utilisation de `useLocalMarketOrders` et `useAuth`
- Chargement automatique des commandes marché local au montage (admin/producteur)
- Fusion des commandes boutique + marché local dans `allOrders`
- Conversion `LocalMarketOrder` → format `Order` unifié
- Mapping des statuts: `completed` → `shipped`, `cancelled` → `cancelled`, autres → `pending`

#### CORRECTION 3: TVA sur factures (vérification)
Le code était déjà correct avec:
- Colonnes tableau: Prix HT, TVA %, Montant TVA, Total TTC
- Section totaux: Sous-total HT, TVA produits, Frais port HT, TVA port (20%), TOTAL TTC

### Fichiers modifiés
- `src/app/gestion-commandes.tsx` - Intégration marché local
- `src/app/(tabs)/admin.tsx` - Permissions bouton Commandes
- `src/app/(tabs)/pro.tsx` - Permissions bouton Commandes

---

## Phase 5 - Gestion des Commandes (2026-01-22)

### Nouvel écran: Gestion des Commandes

Système complet de gestion des commandes pour admin, pro et producteur.

#### Fichiers créés
- `src/app/gestion-commandes.tsx` - Écran de gestion des commandes

#### Fichiers modifiés
- `src/app/(tabs)/admin.tsx` - Ajout bouton "Commandes" dans le header
- `src/app/(tabs)/pro.tsx` - Ajout bouton "Commandes" dans le header
- `src/app/_layout.tsx` - Enregistrement de la route

#### Fonctionnalités
- **Liste des commandes** avec barre de recherche (ID, client, produit, statut)
- **Filtres temporels** : Depuis le départ, 1/3/6/12 mois
- **Statistiques** : Total commandes, CA total, en attente, complétées
- **Détail commande** : Informations client, produits, totaux, suivi
- **Export CSV** : Toutes les commandes filtrées au format CSV
- **Export PDF** : Liste récapitulative avec statistiques
- **Facture PDF** : Génération de factures professionnelles avec calculs HT/TTC

#### Permissions
- Admin : Accès complet
- Pro : Accès complet
- Producteur : Accès complet

#### Navigation
- Admin → Bouton "Commandes" en haut à droite
- Espace Pro → Bouton "Commandes" en haut à droite

---

## Phase 4 - SSL Pinning & Sync Producteurs (2026-01-22)

### SSL Pinning (Protection MITM)

Protection contre les attaques Man-in-the-Middle sur les reseaux WiFi publics.

#### Fichiers crees
- `src/lib/ssl-pinning.ts` - Implementation secureFetch avec timeout
- `assets/supabase-cert.pem` - Certificat DigiCert Global G2

#### Fonctionnalites
- **secureFetch()** remplace fetch() pour toutes les requetes Supabase
- Timeout de 15 secondes sur toutes les requetes
- Validation des headers Supabase en mode dev
- Alerte automatique 30 jours avant expiration du certificat (juin 2026)

#### Utilisation
```typescript
import { secureFetch } from '@/lib/ssl-pinning';

const response = await secureFetch(url, { method: 'GET', headers });
```

### Synchronisation Producteurs

Les ecrans PRO utilisent maintenant les producteurs synchronises depuis Supabase.

#### Logique de selection
- **Admin**: Utilise les producteurs locaux + SAMPLE_PRODUCERS
- **Non-admin**: Utilise `syncedProducers` de Supabase si disponible, sinon fallback local

#### Fichiers modifies
- `src/app/(tabs)/regions.tsx` - Utilise useSupabaseSyncStore
- `src/app/(tabs)/pro.tsx` - Utilise useSupabaseSyncStore
- `src/app/(tabs)/_layout.tsx` - Safe Area insets pour Android

### Tab Bar Android

Correction de la hauteur de la tab bar sur Android avec appareils a navigation gestuelle.
- Utilise `useSafeAreaInsets()` pour calculer la hauteur dynamiquement
- `height: 70 + insets.bottom` sur Android
- `paddingBottom: Math.max(10, insets.bottom)` pour garantir un minimum

### Validation Zod

Ajout des champs vente directe au schema `userProfileSchema`:
- `vente_directe_ferme: boolean`
- `adresse_retrait: string`
- `horaires_retrait: string`
- `instructions_retrait: string`

---

## Phase 3 - Securite TypeScript (2026-01-22)

### Implémentations de sécurité

#### 1. Validation Zod (`src/lib/validation.ts`)
- **Schemas de validation** pour tous les types de données (UserProfile, Producer, Product, Order)
- **Fonctions de validation sécurisées** : `validateSafe()`, `validateArraySafe()`, `validateWithError()`
- **Sanitization** : `sanitizeString()`, `sanitizeObject()` pour éviter les injections
- **Masquage des erreurs techniques** : `toUserError()` convertit les erreurs techniques en messages utilisateur génériques

#### 2. Timeouts globaux avec AbortController
- Toutes les requêtes API ont un timeout de 15 secondes
- Helper `fetchWithTimeout()` utilisé dans toutes les fonctions Supabase
- Évite les blocages infinis en cas de réseau lent

#### 3. Messages d'erreur utilisateur (`USER_ERROR_MESSAGES`)
- `GENERIC`: "Une erreur est survenue. Veuillez réessayer."
- `NETWORK`: "Problème de connexion. Vérifiez votre réseau."
- `AUTH`: "Session expirée. Veuillez vous reconnecter."
- `PERMISSION`: "Vous n'avez pas les permissions nécessaires."
- `NOT_FOUND`: "Élément introuvable."
- `VALIDATION`: "Données invalides. Vérifiez votre saisie."
- `SERVER`: "Le serveur rencontre un problème. Réessayez plus tard."

#### 4. Fichiers mis à jour
- `src/lib/validation.ts` - Module de validation centralisé (nouveau)
- `src/lib/supabase-users.ts` - Validation + timeouts + masquage erreurs
- `src/lib/supabase-producer.ts` - Validation + timeouts + masquage erreurs

### Phases de sécurité précédentes (SQL)
- **Phase 1**: Migration des IDs vers `auth.uid()`
- **Phase 2**: RLS policies sécurisées sur `profiles`, `orders`, `producers`
- **Correction récursion infinie**: `is_admin()` avec `SECURITY DEFINER`

---

## Audit & Refonte Architecture (2026-01-21)

### Changements majeurs appliqués

#### 1. Error Boundary Global
- Nouveau composant `src/components/ErrorBoundary.tsx`
- Capture les erreurs JS et affiche un écran de fallback avec bouton "Réessayer"
- En mode dev, affiche les détails de l'erreur pour le debugging

#### 2. Root Layout Robuste (`src/app/_layout.tsx`)
**Améliorations :**
- Timeout de 5s pour le chargement des fonts (fallback si réseau lent)
- Timeout de 10s pour l'AuthGuard (évite l'écran noir infini)
- Error Boundary global qui enveloppe toute l'app
- `SafeAudioWrapper` qui capture les erreurs audio sans crasher l'app
- `DataSyncWrapper` séparé pour isoler les hooks de synchronisation
- Logs conditionnels (`__DEV__` only) pour le debugging

#### 3. Tabs Layout Optimisé (`src/app/(tabs)/_layout.tsx`)
**Améliorations :**
- `useSafePermissions()` avec try/catch et valeurs par défaut
- `useTabVisibility()` hook séparé avec memoization
- Composants `TabBadge` et `TabIcon` factorisés
- `screenOptions` memoizé pour éviter les recréations
- Imports nettoyés (suppression de LinearGradient inutilisé)

#### 4. Configuration Native Validée
- **app.json** : Pas de `kotlinVersion` override (source des crashs Kotlin)
- **newArchEnabled: true** : Supporté par toutes les libs actuelles
- **@react-native-menu/menu** : Présent dans package.json mais non importé → OK

### TODO Priorités

**P1 - Bloquants (à faire maintenant) :**
- [x] Supprimer `@react-native-menu/menu` du package.json (inutilisé)
- [x] Remplacer `@expo-google-fonts/fredoka-one` (deprecated) par `@expo-google-fonts/fredoka`
- [ ] Tester sur émulateur Android après `npx expo prebuild --clean`

**P2 - Recommandés :**
- [x] Migrer les menus contextuels vers `zeego` (N/A : aucun menu contextuel détecté)
- [x] Ajouter des tests unitaires pour les hooks critiques (useAuth, useDataSync)
- [x] Documenter les variables d'environnement requises

**P3 - Améliorations futures :**
- [ ] Implémenter un système de logging centralisé (Sentry ou similaire)
- [x] Ajouter des animations de skeleton pendant les chargements
- [x] Optimiser les re-renders avec React DevTools Profiler

---

## Correctifs Récents (2026-01-19)

### Bug Android - Fiche producteur qui se vide
**Problème**: Sur Android, quand un producteur enregistre sa fiche, elle semble ne pas s'enregistrer et se revide après redémarrage.

**Cause identifiée**:
- Le champ `profile_id` n'était pas inclus lors de la synchronisation avec Supabase
- Sans ce lien, la fiche n'était pas associée au profil utilisateur
- Lors de la synchronisation automatique, l'app ne retrouvait pas la fiche du producteur car elle cherchait par `p.id === profile.id` mais l'ID du producteur Supabase est différent de l'ID du profil

**Correctifs appliqués**:
1. Ajout du champ `profileId` dans l'interface `Producer` (src/lib/producers.ts)
2. Mapping du `profile_id` dans `supabaseToProducer()` (src/lib/supabase-sync.ts)
3. Inclusion du `profileId` lors de la sauvegarde (src/app/producer-profile.tsx)
4. Recherche du producteur par `profileId` en priorité (src/app/producer-profile.tsx:62-64)
5. Synchronisation Supabase AVANT le store local pour garantir la source de vérité
6. Ajout de logs détaillés pour le debugging

**À tester**: Demander à un bêta-testeur Android de créer/modifier sa fiche producteur et vérifier qu'elle persiste après fermeture/réouverture de l'app.

---

### Bug - Photos des producteurs n'apparaissent pas
**Problème**: Les photos des producteurs n'apparaissent pas dans les cartes Pokémon et leur boutique (Marché local, Map).

**Diagnostic en cours**:
- Ajout de logs `onError` et `onLoad` sur les composants `<Image>` pour diagnostiquer
- Logs ajoutés dans `PokemonCard.tsx` et `marche-local.tsx`
- Vérifier dans les logs si l'URL de l'image est correcte et si elle charge

**Causes possibles**:
1. **Bucket Supabase Storage non public**: Les images uploadées sur Supabase ne sont pas accessibles publiquement
2. **URLs Supabase Storage malformées**: Les URLs retournées par l'upload ne sont pas correctes
3. **Problème de CORS**: Le bucket Supabase Storage bloque les requêtes depuis l'app mobile
4. **Images locales vs cloud**: Les images "asset:" fonctionnent (bundled) mais les URLs Supabase échouent

**Prochaines étapes**:
1. Consulter les logs dans l'onglet LOGS de Vibecode pour voir les erreurs de chargement d'images
2. Vérifier que le bucket Supabase Storage "images" existe et est configuré en public
3. Si le bucket n'est pas public, le rendre public ou utiliser des URLs signées
4. Tester avec un bêta-testeur et vérifier les logs d'erreur

## Features

- **Tirage au Sort**: Animation de tirage avec shake et révélation
- **Ticket System**: Chaque tirage requiert un ticket
- **Flux de commande avec tickets**:
  - Envoi d'email de commande
  - Dialog de remerciement après envoi réussi
  - Écran récapitulatif avec détails de la commande
  - Option de récupérer les tickets et aller au tirage
  - Crédit automatique des tickets (1 ticket par 20€ dépensés)
- **Abonnements**: 3 formules (Basic 30€, Premium 60€, VIP 90€) = 1/2/3 tickets par mois
- **Rarity System**: 4 tiers - Commun (60%), Rare (25%), Épique (12%), Légendaire (3%)
- **Product Reveal**: Beautiful card reveal with rarity-specific colors and glow effects
- **Collection Gallery**: View all products you've collected with value tracking
- **Probability Info**: Transparent odds display for each rarity tier
- **Interactive Map**: Whimsical France map with animated producer pins
- **Producer Cards**: Pokemon-style cards with magical glow effects, producer details, soil/climate info
- **Custom Producers**: Add your own producers with full terroir characteristics
- **Shopping Cart**: Add products to cart from producer boutiques
- **Ma vie de chanvrier**: Mini-jeu de simulation agricole pixel art 8-bit style Stardew Valley
- **Inventaire de Lots**: Les lots gagnés au tirage sont stockés dans l'inventaire et utilisables lors des commandes
  - Lots produits: produits physiques qui s'ajoutent à la commande (cumulables)
  - Lots réduction: réductions sur le total de la commande (1 seule par commande)
- **Admin Backend**: Full administration panel to manage:
  - Commandes: Gestion des commandes clients avec suivi de statut
  - **Stock/Inventaire**: Gestion complète du stock produits
    - Ajouter/modifier/supprimer des produits en stock
    - Suivi des quantités, prix de vente et d'achat
    - Taux de TVA par produit
    - Seuil d'alerte stock bas
    - Décrémentation automatique du stock lors de l'expédition des commandes
  - Lots/prizes with 4 rarity levels (Commun 60%, Rare 25%, Épique 12%, Légendaire 3%)
  - Producers and their products
  - Dropdown options (regions, soil types, climate types, product types)

## Screens

1. **Home (Tirage)**: Main screen with animated box and spin functionality
2. **Map**: Interactive whimsical France map with glowing producer pins and Pokemon-style cards
3. **Shop**: Producer boutique with product cards and add-to-cart functionality
4. **Cart**: Shopping cart with quantity controls, grouped by producer
5. **Marché local**: Marketplace pour la vente directe à la ferme avec:
   - Organisation par département avec liste cliquable
   - Carrousel de producteurs style carte Pokémon par département
   - **Affichage du nom de l'entreprise** (company_name) sur les cartes Pokémon au lieu du nom personnel du producteur
   - Ville de retrait affichée sur la carte du producteur
   - Affichage de l'adresse de retrait et horaires d'ouverture
   - Catalogue des produits disponibles en vente directe
   - Filtrage automatique pour afficher uniquement les produits avec `disponible_vente_directe = true`
   - Visible pour tous les utilisateurs (clients, pros, producteurs, admins)
6. **Ma vie de chanvrier** (Farming Game): Mini-jeu de simulation agricole pixel art style Stardew Valley avec:
   - **Grille de culture 8x6**: 48 parcelles de chanvre à cultiver
   - **4 variétés de chanvre**: Sativa, Indica, Hybride, CBD Rich - chacune avec des caractéristiques uniques
   - **Phases de croissance réalistes**: Germination → Jeune pousse → Végétative → Floraison → Récolte
   - **Cycle jour/nuit dynamique**: Le temps passe en jeu avec météo variable (☀️ Ensoleillé, ☁️ Nuageux, 🌧️ Pluvieux, ⛈️ Orageux, 🌫️ Brumeux)
   - **4 saisons**: Printemps, Été, Automne, Hiver - affectent la croissance et les récoltes
   - **Système d'outils**: Main, Houe, Arrosoir, Graines, Faucille, Engrais
   - **Gestion des ressources**: Eau, santé des plantes, qualité (1-5 étoiles)
   - **Boutique intégrée**: Acheter graines et engrais avec les pièces gagnées
   - **Système de niveau et XP**: Progressez et débloquez des bonus
   - **Mode accéléré**: Pour tester rapidement les fonctionnalités
6. **Profile**: User stats, collection gallery integration, subscriptions, and settings
   - Ma Collection: Accès direct à la galerie de collection avec stats par rareté
   - **Mes Commandes**: Suivi des commandes avec synchronisation automatique depuis Supabase
     - Actualisation du statut en temps réel (toutes les 10 secondes)
     - Indicateur de chargement pendant la synchronisation
     - Affichage du numéro de suivi Mondial Relay quand expédié
7. **Admin**: Backend administration with tabs for:
   - Commandes: Gestion des commandes clients avec suivi de statut
   - Stock: Gestion complète de l'inventaire produits
   - **Produits**: Gestion complète des produits par producteur (anciennement un onglet séparé)
     - Voir tous les produits groupés par producteur
     - Ajouter/modifier/supprimer des produits
     - Gestion des promotions avec badges visuels
     - **Synchronisation automatique des promotions**: Quand un produit est mis en promotion, il apparaît automatiquement dans l'onglet Promotions
   - Producteurs: Add/manage producers with photo picker
   - Lots: Create prizes with rarity levels
   - Promos: Gestion des produits en promotion
   - Codes: Codes promo avec pourcentage de réduction
   - Onglets: Configurer la visibilité des onglets avec:
     - Toggles pour chaque rôle (Client, Pro, Producteur)
     - Bouton "Sauvegarder" avec feedback visuel
     - Les changements sont sauvegardés automatiquement dans AsyncStorage
   - Régions: Manage French regions
   - Sols: Manage soil types
   - Climats: Manage climate types
   - Types: Manage product types with colors
   - **Supabase**: Gestion des données partagées via Supabase (CRUD complet)
     - Ajouter/modifier/supprimer des produits (nom, description, valeur)
     - Actualisation automatique toutes les 5 secondes
     - Bouton de rafraîchissement manuel

## Security Features

The application implements comprehensive security measures to protect user data and prevent unauthorized access:

### Admin Access Control
- **Admin Screen Protection**: Only users with `role='admin'` can access the administration panel
- Permission check implemented at component level with user-friendly "Unauthorized" message
- Uses `usePermissions()` hook to verify admin status

### Product Management Security
- **Product Ownership Verification**: Producers can only modify/delete their own products
- `updateProduct()` function verifies that the product belongs to the connected producer before allowing modifications
- `deleteProduct()` function applies the same ownership verification
- Prevents producers from modifying or deleting products belonging to other producers

### Order Management Security
- **Producer Order Verification**: Producers can only manage order status for orders containing their products
- `handleOrderStatusChange()` and `handleTrackingNumberUpdate()` verify that the order contains at least one product from the connected producer
- Prevents unauthorized modification of orders from other producers

### Admin Functions Security
- **Admin-Only Operations**: Functions that modify user roles, approve pro accounts, and delete users are protected
- `updateUserRole()`, `updateProStatus()`, and `deleteUser()` all verify that the caller has `role='admin'`
- Returns "Non autorisé" error if non-admin user attempts these operations

### Authentication & Token Storage
- **Secure Token Storage**: Authentication tokens are stored in `expo-secure-store` (native OS keychain)
- **Web Encryption**: On web platform, tokens are encrypted with AES-256-GCM using Web Crypto API
- **SecureStorage Module**: Unified secure storage abstraction (`src/lib/secure-storage.ts`)
  - iOS/Android: Uses native Keychain/Keystore
  - Web: PBKDF2 key derivation + AES-256-GCM encryption
  - Unique salt per installation for additional security
- **Force Re-authentication on Failure**: If SecureStore fails, the system forces logout and requires user re-authentication
- Prevents token exposure through application logs or device inspection

### File Upload Security
- **Server-side Validation**: Files are validated via Supabase RPC function before upload
- **MIME Type Verification**: Real MIME type checked against magic bytes/file signatures
- **Size Limits**: Maximum file sizes enforced per file type (images: 10MB, documents: 5MB)
- **Allowed Types**: Only specific MIME types allowed (image/jpeg, image/png, image/webp, image/gif, application/pdf)
- **Upload Logging**: All upload attempts logged for security audit
- **Client Validation**: First-line validation on client before server validation
- See `database/migrations/validate_file_uploads.sql` for server-side implementation

### RGPD Compliance
- **Data Export (Article 15)**: Users can export all their personal data in JSON format
  - Profile information
  - Order history (anonymized payment data)
  - Products created (if producer)
  - Lots won
  - Activity log
- **Right to be Forgotten (Article 17)**: Two-step account deletion process
  - Preview of data to be deleted
  - Confirmation required: "SUPPRIMER MON COMPTE"
  - Orders anonymized (legal retention requirement)
  - Products and profile deleted
  - RGPD request logged for audit
- **UI Component**: `src/components/RGPDSection.tsx` in Settings
- See `database/migrations/rgpd_functions.sql` for database functions

### Logging & Data Privacy
- **Sensitive Data Redaction**: Personal data (email, phone, address, SIRET, names) is not logged
- **ID-Only Logging**: Logs contain only IDs for debugging purposes
- Prevents accidental exposure of sensitive information in logs

### Row-Level Security (RLS)
- **Database-Level Protection**: Comprehensive RLS policies in `SECURITY_RLS_POLICIES.sql`
- **Producer Data Isolation**: Producers can only see their own products and linked accounts
- **User Data Privacy**: Users can only access their own profile and orders
- **Admin Privileges**: Admins can access all data for management purposes
- **Public Data**: Published products visible to all authenticated users

### RLS Policy Coverage
- **products table**: Producers restricted to own products; clients see published items
- **producers table**: Producers can update own info; public data visible to all
- **profiles table**: Users access own profile; admins can manage all profiles
- **pro_orders table**: Users see own orders; producers see orders with their products
- **pro_order_items table**: Access controlled through order-level permissions

## Espace Professionnel (PRO)

Les utilisateurs avec le rôle PRO ont accès à des fonctionnalités spéciales:

### Bourse Produits
- **Prix dynamiques**: Les prix varient de ±30% selon l'offre et la demande
- **Interface bulles**: Visualisation intuitive avec des bulles animées
  - Taille = niveau de prix (plus grande = plus cher)
  - Couleur = tendance (vert = hausse, rouge = baisse, gris = stable)
- **Commandes PRO**: Passer des demandes d'achat aux prix du marché

### Régions (Liste par région)
- **Liste interactive**: Liste des 13 régions de France métropolitaine
- **Producteurs par région**: Cliquez sur une région pour voir les producteurs
- **Carrousel producteurs**: Navigation horizontale avec infos détaillées
  - Nom, localisation, type de sol, climat
  - Nombre de produits disponibles
  - Accès direct à la boutique du producteur
- **Statistiques**: Vue d'ensemble (producteurs, régions actives, produits)

### Pas de musique pour les PRO
- Les utilisateurs PRO n'ont pas de bande son (silence complet)
- La musique est réservée aux clients standard

### Demande d'échantillons
- **Bouton visible uniquement pour les PRO approuvés** dans la boutique du producteur
- **Email automatique**: Cliquer sur le bouton ouvre l'application mail avec un message pré-rempli
- **Liste des produits incluse**: L'email contient automatiquement la liste des produits du producteur
- **Confirmation visuelle**: Après envoi, le bouton affiche "Demande envoyée"

## Images System

L'app utilise un système d'images partagées pour que tous les utilisateurs voient les mêmes images.

### Sélecteur d'images amélioré
- **Barre de recherche**: Rechercher une image par son nom
- **Filtres par catégorie**: Toutes, Images, Fonds, Icônes, Autres
- **Compteur d'images**: Affiche le nombre d'images filtrées vs total

### Ajouter de nouvelles images
1. Uploadez vos images dans l'onglet "IMAGES" de Vibecode
2. Les images sont stockées dans `/assets/` ou `/public/`
3. Le script `generate-asset-images.js` génère automatiquement la liste des images disponibles
4. Relancez l'app pour voir les nouvelles images

### Régénérer la liste manuellement (si besoin)
```bash
bun run scripts/generate-asset-images.js
```

8. **Produits (Données Partagées)**: Écran public en lecture seule affichant les données Supabase
   - Liste des produits CBD/tisanes avec nom, description et valeur
   - Pull-to-refresh et actualisation auto toutes les 5s
   - Accessible depuis l'onglet "Produits" dans la barre de navigation

## Supabase Integration

L'application peut se connecter à Supabase pour stocker et partager des données entre utilisateurs. Cela permet de synchroniser les producteurs et produits pour que tous les utilisateurs voient les mêmes données.

### Configuration - Variables d'Environnement

#### Variables REQUISES (côté client)
Ajoutez ces variables dans l'onglet ENV de Vibecode:

| Variable | Description | Exemple |
|----------|-------------|---------|
| `EXPO_PUBLIC_SUPABASE_URL` | URL du projet Supabase | `https://xxx.supabase.co` |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | Clé anonyme Supabase (publique) | `eyJhbGciOiJIUzI1...` |

#### Variables OPTIONNELLES (côté client)
| Variable | Description |
|----------|-------------|
| `EXPO_PUBLIC_ENCRYPTION_KEY` | Clé pour chiffrement local (32 caractères) |

#### Variables SERVEUR UNIQUEMENT (Edge Functions)
Ces variables doivent être configurées dans Supabase Dashboard > Edge Functions > Secrets :

| Variable | Description | Ne jamais exposer côté client |
|----------|-------------|-------------------------------|
| `SUPABASE_SERVICE_ROLE_KEY` | Clé service role (accès complet) | **CRITIQUE** |
| `OPENAI_API_KEY` | Clé API OpenAI | Oui |
| `ANTHROPIC_API_KEY` | Clé API Anthropic | Oui |
| `ELEVENLABS_API_KEY` | Clé API ElevenLabs | Oui |

#### Sécurité des secrets
- **Ne jamais** mettre de clés API dans le `.env` côté client en production
- **Supprimer** les variables `EXPO_PUBLIC_VIBECODE_*` après déploiement des Edge Functions
- Les clés préfixées `EXPO_PUBLIC_` sont exposées dans le bundle client
- Utiliser les Edge Functions comme proxy pour les APIs tierces

#### Rotation des secrets
1. Générer une nouvelle clé dans le service concerné
2. Mettre à jour dans Supabase Dashboard > Edge Functions > Secrets
3. Invalider l'ancienne clé après vérification

### Tables Supabase requises

#### Table `app_data` (données simples)
```sql
CREATE TABLE app_data (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  nom text,
  description text,
  valeur text,
  created_at timestamptz DEFAULT now()
);
```

#### Table `producers` (producteurs)
```sql
CREATE TABLE producers (
  id text PRIMARY KEY,
  name text NOT NULL,
  email text,
  region text,
  department text,
  city text,
  image text,
  description text,
  latitude numeric,
  longitude numeric,
  map_position_x numeric,
  map_position_y numeric,
  soil_type text,
  soil_ph text,
  soil_characteristics text,
  climate_type text,
  climate_avg_temp text,
  climate_rainfall text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
```

#### Table `products` (produits)
```sql
CREATE TABLE products (
  id text PRIMARY KEY,
  producer_id text REFERENCES producers(id) ON DELETE CASCADE,
  name text NOT NULL,
  type text,
  cbd_percent numeric,
  thc_percent numeric,
  price_public numeric,
  price_pro numeric,
  weight text,
  image text,
  images jsonb,
  description text,
  tva_rate numeric DEFAULT 20,
  stock integer,
  is_on_promo boolean DEFAULT false,
  promo_percent numeric,
  visible_for_clients boolean DEFAULT true,
  visible_for_pros boolean DEFAULT false,
  status text DEFAULT 'draft',
  lab_analysis_url text,
  disponible_vente_directe boolean DEFAULT false,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
```

### Synchronisation Admin -> Tous les utilisateurs
1. Allez dans Admin > onglet "Sync"
2. Configurez vos producteurs, produits, lots, packs et promos localement
3. Cliquez sur "Envoyer vers Supabase" pour synchroniser
4. Tous les utilisateurs verront automatiquement les données synchronisées sur la carte, dans les boutiques, dans le tirage, les packs et les promos

**Synchronisation automatique**: L'application charge automatiquement les données depuis Supabase au démarrage et toutes les 5 minutes.

**Upload automatique des images**: Les images sélectionnées depuis l'appareil sont automatiquement uploadées vers Supabase Storage lors de la sauvegarde. Cela permet à tous les utilisateurs de voir les mêmes images. Pour que cette fonctionnalité fonctionne, vous devez créer un bucket "images" dans Supabase Storage avec des politiques publiques en lecture.

#### Configuration Supabase Storage
1. Allez dans Storage dans votre projet Supabase
2. Créez un bucket nommé "images"
3. Activez les politiques de lecture publique pour ce bucket:
```sql
CREATE POLICY "Public Access" ON storage.objects FOR SELECT USING (bucket_id = 'images');
CREATE POLICY "Authenticated Upload" ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'images');
```

#### Table `lots` (lots du tirage)
```sql
CREATE TABLE lots (
  id text PRIMARY KEY,
  name text NOT NULL,
  description text,
  rarity text NOT NULL,
  image text,
  value numeric DEFAULT 0,
  active boolean DEFAULT true,
  lot_type text,
  discount_percent numeric,
  discount_amount numeric,
  min_order_amount numeric,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
```

#### Table `lot_items` (produits dans les lots)
```sql
CREATE TABLE lot_items (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  lot_id text REFERENCES lots(id) ON DELETE CASCADE,
  product_id text,
  producer_id text,
  product_name text,
  producer_name text,
  quantity integer DEFAULT 1,
  created_at timestamptz DEFAULT now()
);
```

#### Table `user_lots` (lots gagnés par utilisateur)
```sql
CREATE TABLE user_lots (
  id text PRIMARY KEY,
  user_code text NOT NULL,
  lot_id text,
  lot_name text,
  lot_description text,
  lot_rarity text,
  lot_image text,
  lot_type text,
  lot_value numeric,
  discount_percent numeric,
  discount_amount numeric,
  min_order_amount numeric,
  won_at timestamptz DEFAULT now(),
  used boolean DEFAULT false,
  used_at timestamptz,
  gifted_to text,
  gifted_at timestamptz,
  gift_code text UNIQUE,
  created_at timestamptz DEFAULT now()
);
```

#### Table `packs` (packs de produits)
```sql
CREATE TABLE packs (
  id text PRIMARY KEY,
  name text NOT NULL,
  description text,
  price numeric NOT NULL,
  original_price numeric,
  image text,
  tag text,
  color text,
  active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
```

#### Table `pack_items` (produits dans les packs)
```sql
CREATE TABLE pack_items (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  pack_id text REFERENCES packs(id) ON DELETE CASCADE,
  name text NOT NULL,
  quantity text,
  value numeric DEFAULT 0,
  images jsonb,
  producer_name text,
  created_at timestamptz DEFAULT now()
);
```

#### Table `promo_products` (produits en promotion)
```sql
CREATE TABLE promo_products (
  id text PRIMARY KEY,
  product_id text NOT NULL,
  producer_id text NOT NULL,
  product_name text NOT NULL,
  producer_name text NOT NULL,
  original_price numeric NOT NULL,
  promo_price numeric NOT NULL,
  discount_percent numeric NOT NULL,
  image text,
  valid_until text,
  active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
```

#### Table `orders` (commandes clients)
```sql
CREATE TABLE orders (
  id text PRIMARY KEY,
  customer_first_name text NOT NULL,
  customer_last_name text NOT NULL,
  customer_email text NOT NULL,
  customer_phone text,
  customer_address text,
  customer_city text,
  customer_postal_code text,
  items jsonb NOT NULL,
  subtotal numeric NOT NULL,
  shipping_fee numeric DEFAULT 0,
  total numeric NOT NULL,
  status text DEFAULT 'pending',
  tracking_number text,
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
```

#### Activer Row Level Security (RLS)
Pour que les utilisateurs puissent enregistrer leurs lots gagnés, activez RLS avec ces politiques:
```sql
-- Activer RLS
ALTER TABLE user_lots ENABLE ROW LEVEL SECURITY;

-- Permettre à tous de lire les lots gagnés
CREATE POLICY "user_lots_select" ON user_lots FOR SELECT USING (true);

-- Permettre à tous d'insérer de nouveaux lots gagnés
CREATE POLICY "user_lots_insert" ON user_lots FOR INSERT WITH CHECK (true);

-- Permettre la mise à jour (pour marquer comme utilisé ou offert)
CREATE POLICY "user_lots_update" ON user_lots FOR UPDATE USING (true);

-- Activer RLS pour les autres tables
ALTER TABLE lots ENABLE ROW LEVEL SECURITY;
ALTER TABLE lot_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "lots_select" ON lots FOR SELECT USING (true);
CREATE POLICY "lots_all" ON lots USING (true);

CREATE POLICY "lot_items_select" ON lot_items FOR SELECT USING (true);
CREATE POLICY "lot_items_all" ON lot_items USING (true);

-- Activer RLS pour les packs
ALTER TABLE packs ENABLE ROW LEVEL SECURITY;
ALTER TABLE pack_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "packs_select" ON packs FOR SELECT USING (true);
CREATE POLICY "packs_all" ON packs USING (true);

CREATE POLICY "pack_items_select" ON pack_items FOR SELECT USING (true);
CREATE POLICY "pack_items_all" ON pack_items USING (true);

-- Activer RLS pour les promo products
ALTER TABLE promo_products ENABLE ROW LEVEL SECURITY;

CREATE POLICY "promo_products_select" ON promo_products FOR SELECT USING (true);
CREATE POLICY "promo_products_all" ON promo_products USING (true);

-- Activer RLS pour les commandes
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "orders_select" ON orders FOR SELECT USING (true);
CREATE POLICY "orders_insert" ON orders FOR INSERT WITH CHECK (true);
CREATE POLICY "orders_update" ON orders FOR UPDATE USING (true);
CREATE POLICY "orders_delete" ON orders FOR DELETE USING (true);
```

## Gestion des Stocks

Chaque produit peut avoir un stock défini:
- **Stock optionnel**: Laisser vide pour un stock illimité
- **Affichage du stock**: Visible sur chaque produit dans la boutique producteur
- **Rupture de stock**: Les produits à 0 ne peuvent plus être ajoutés au panier
- **Décrémentation automatique**: Le stock diminue automatiquement après chaque commande validée

## Diagnostic & Solution - Problème Inscription Android

**Build Expo concernée**: https://expo.dev/accounts/les-champs-bretons/projects/les-chanvriers-unis/builds/79cdfe89-fdab-4af2-a965-61b765e4355d

**Problème**: Le profil utilisateur ne se crée pas lors de l'inscription sur Android.

**Cause Identifiée**: Erreur Foreign Key 23503 - Le trigger était configuré BEFORE INSERT au lieu de AFTER INSERT.

### 🚀 Solution Immédiate

**Fichier**: `supabase/migrations/20260115_fix_fk_trigger_timing.sql`

Exécuter dans Supabase SQL Editor:
1. Ouvrir Supabase → SQL Editor
2. Copier le contenu de `supabase/migrations/20260115_fix_fk_trigger_timing.sql`
3. Exécuter la migration complète
4. Vérifier: `SELECT action_timing FROM information_schema.triggers WHERE trigger_name = 'on_auth_user_created';`
   - Doit retourner: `AFTER`

### 📋 Fichiers de Diagnostic
- `SOLUTION_FK_TRIGGER.md` - Explique la cause et la solution en détail
- `DEBUG_SIGNUP_ISSUE.md` - Guide complet de dépannage supplémentaire
- `supabase/migrations/20260115_diagnostic_signup_issue.sql` - Requêtes SQL pour diagnostiquer
- Logs améliorés dans `src/lib/supabase-auth.ts` et `src/app/auth/signup.tsx`

### ✅ Tests Après Correction
```sql
-- Vérifier que le trigger est maintenant AFTER INSERT
SELECT action_timing FROM information_schema.triggers
WHERE trigger_name = 'on_auth_user_created';
-- Résultat attendu: AFTER

-- Chercher les utilisateurs sans profil (doit être vide)
SELECT u.id, u.email FROM auth.users u
LEFT JOIN public.profiles p ON u.id = p.id
WHERE p.id IS NULL;
-- Résultat attendu: 0 lignes
```

### Logs à Vérifier
```
[Signup] selectedRole: client
[Auth] updateProfile: userId = ...
[Auth] updateProfile: sending request to https://vosqgjsaujsayhrrhthf.supabase.co/rest/v1/profiles
[Auth] updateProfile: response status = 201 (ou 200)
[Auth] updateProfile: SUCCESS
```

## Authentication (Supabase Auth)

L'application supporte maintenant l'authentification Supabase avec migration progressive depuis le système de codes locaux.

### Modes d'identification

1. **Mode local** (système actuel): Les utilisateurs sont identifiés par un `user_code` unique stocké dans AsyncStorage
2. **Mode Supabase Auth**: Les utilisateurs s'authentifient avec email/password ou magic link
3. **Mode migration**: Les utilisateurs authentifiés peuvent lier leur ancien `user_code` à leur compte Supabase

### Configuration de l'authentification

Exécutez le script SQL `SUPABASE_AUTH_SETUP.sql` dans le SQL Editor de Supabase pour créer:
- Types enum: `user_role` (client, pro, producer, admin), `user_category` (restaurateur, epicerie, grossiste, producteur_maraicher, autre)
- Table `profiles` avec RLS activé
- Triggers pour création automatique des profils
- Fonctions utilitaires (is_admin, link_user_code, get_current_profile)

### Activer l'authentification dans Supabase

1. Allez dans Authentication > Settings
2. Activez "Email/Password sign-in"
3. (Optionnel) Activez "Magic Link sign-in"

### Hooks disponibles

```typescript
// Hook principal d'authentification
const { session, user, profile, isAuthenticated, signIn, signUp, signOut } = useAuth();

// Hook de migration progressive
const { userCode, authMode, needsMigration, migrateUserCode } = useUserIdentity();

// Hook de permissions basées sur le rôle
const { isAdmin, isPro, canManageProducts } = usePermissions();
```

### Flux d'authentification obligatoire

L'accès à l'application nécessite une authentification et une vérification d'âge:

1. **Authentification requise**: Sans compte, l'utilisateur ne peut voir que les écrans de connexion/inscription
2. **Vérification d'âge**: À la première connexion, un écran demande de confirmer avoir plus de 18 ans
3. **Blocage**: Tant que `is_adult = true` n'est pas enregistré, l'accès au reste de l'app est bloqué

#### Champs de la table profiles pour la vérification d'âge
```sql
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS is_adult boolean DEFAULT null;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS age_verified_at timestamptz;
```

### Rôles utilisateur

| Rôle | Description | Permissions |
|------|-------------|-------------|
| client | Client standard | Acheter, consulter |
| pro | Professionnel (restaurateur, épicerie...) | Tarifs pro, commandes groupées |
| producer | Producteur CBD | Gérer ses produits |
| admin | Administrateur | Accès complet |

### Créer le premier admin

Après avoir créé un compte, exécutez dans Supabase SQL Editor:
```sql
UPDATE profiles SET role = 'admin' WHERE email = 'votre-email@example.com';
```

### Système de prix double (Client/Pro)

Les produits supportent deux prix différents:
- **price_public**: Prix pour les clients standard
- **price_pro**: Prix pour les professionnels

Les hooks de pricing gèrent automatiquement l'affichage:
```typescript
import { usePricingContext, getProductPrice } from '@/lib/useProductPricing';

// Dans un composant
const { pricingMode, isPro, priceLabel } = usePricingContext();
const price = getProductPrice(product, pricingMode);
```

### Visibilité des produits par rôle

Chaque produit peut être configuré avec:
- `visible_for_clients`: Visible pour les clients (défaut: true)
- `visible_for_pros`: Visible pour les pros (défaut: false)
- `status`: 'draft' | 'published' | 'archived'

### Espace Pro (B2B)

Un onglet "Pro" est disponible uniquement pour les utilisateurs avec `role = 'pro'` ou `role = 'admin'`.

Fonctionnalités:
- Liste tous les produits avec `visible_for_pros = true`
- Affiche les prix professionnels (`price_pro`)
- Filtres par producteur, type de produit
- Barre de recherche
- Badge "PRO" sur les prix réduits

L'onglet apparaît automatiquement dans la navigation quand l'utilisateur est connecté avec le bon rôle.

### Commandes Professionnelles

Quand un professionnel (`role = 'pro'`) passe une commande:
- L'email de commande est envoyé directement aux producteurs concernés
- Si la commande contient des produits de plusieurs producteurs, tous reçoivent le même email avec le détail complet
- `leschanvriersbretons@gmail.com` est automatiquement ajouté en CC
- Si un producteur n'a pas configuré d'email de contact, l'email est envoyé à l'adresse principale uniquement

Pour configurer l'email de contact producteur:
1. Se connecter en tant que producteur
2. Aller dans Profil > "Accéder à ma fiche producteur"
3. Remplir le champ "Email de contact (pour commandes pros)"

### Marché local (Vente directe)

Un onglet "Marché" est disponible pour **tous les utilisateurs** (clients, pros, producteurs, admins).

**Concept:** Marketplace centralisée pour découvrir et acheter directement auprès des producteurs proposant la vente directe à la ferme.

#### DEUX systèmes de commande distincts

**1. Système PANIER (min 20€/producteur)**
- Ajouter au panier → Minimum 20€ par producteur → Valider → Emails envoyés
- Adapté pour commandes groupées avec plusieurs produits

**2. Système COMMANDE DIRECTE (nouveauté)**
- Commander un produit immédiatement → Code de retrait généré → Paiement sur place
- Pas de minimum, pas de panier
- Idéal pour achats rapides

#### Fonctionnalités Commande Directe (Marché Local)

**Bouton "Commander" sur chaque produit:**
- Sélecteur de quantité (+/-)
- Formulaire de coordonnées (nom, email, téléphone)
- Message optionnel pour le producteur
- Écran de confirmation avec récapitulatif

**Code de retrait unique (6 chiffres):**
- Généré automatiquement à la création de commande
- Le client présente ce code au producteur lors du retrait
- Le paiement s'effectue EN PERSONNE

**Emails automatiques:**
- Email producteur: nouvelle commande avec code de retrait, coordonnées client, détails produit
- Email client: confirmation avec code de retrait, lieu/horaires de retrait, instructions
- CC à leschanvriersbretons@gmail.com pour suivi

**Écran "Mes commandes Marché Local":**
- Accessible depuis le Profil ou l'icône dans l'en-tête du Marché Local
- Liste des commandes groupées par statut (Prêtes, En cours, Historique)
- Code de retrait affiché en grand
- Statut: pending → confirmed → ready → completed/cancelled
- Possibilité d'annuler une commande en attente

#### Table Supabase: local_market_orders

```sql
CREATE TABLE local_market_orders (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

  -- Client
  customer_id UUID REFERENCES profiles(id),
  customer_name TEXT NOT NULL,
  customer_email TEXT NOT NULL,
  customer_phone TEXT,

  -- Producteur
  producer_id TEXT NOT NULL REFERENCES producers(id),
  producer_name TEXT NOT NULL,
  producer_email TEXT NOT NULL,
  producer_phone TEXT,
  producer_location TEXT,

  -- Produit
  product_id TEXT NOT NULL REFERENCES products(id),
  product_name TEXT NOT NULL,
  product_description TEXT,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  unit_price DECIMAL(10,2) NOT NULL,
  total_amount DECIMAL(10,2) NOT NULL,

  -- Statut
  status TEXT DEFAULT 'pending' CHECK (status IN (
    'pending', 'confirmed', 'ready', 'completed', 'cancelled'
  )),

  -- Code de retrait unique
  pickup_code TEXT UNIQUE NOT NULL,

  -- Coordonnées du retrait
  pickup_location TEXT,
  pickup_instructions TEXT,

  -- Notes
  customer_notes TEXT,
  producer_notes TEXT,

  -- Paiement (sur place)
  is_paid BOOLEAN DEFAULT false,
  payment_method TEXT,
  completed_at TIMESTAMP WITH TIME ZONE
);
```

#### Fichiers associés - Commande Directe

- `src/lib/local-market-orders.ts`: Store Zustand + fonctions de gestion des commandes
- `src/components/LocalMarketOrderModal.tsx`: Modal de commande avec sélecteur de quantité
- `src/app/mes-commandes-marche-local.tsx`: Écran "Mes commandes Marché Local"
- `supabase/functions/send-local-market-order-email/index.ts`: Edge function pour emails

#### Flux utilisateur - Commande Directe

1. Client accède au Marché Local
2. Clique sur "Commander" sur un produit
3. Sélectionne la quantité, remplit ses coordonnées
4. Confirme la commande
5. Reçoit un CODE DE RETRAIT (6 chiffres)
6. Reçoit un email de confirmation
7. Le producteur reçoit un email avec les détails
8. Client se rend chez le producteur avec le code
9. Paiement sur place et retrait du produit

#### Fonctionnalités existantes (Panier vente directe)

- **Liste des producteurs avec vente directe**: Affiche uniquement les producteurs ayant `vente_directe_ferme = true`
- **Informations détaillées**:
  - Photo du producteur
  - Nom et localisation
  - Badge "Vente directe"
  - Adresse de retrait (si configurée)
  - Horaires d'ouverture (si configurés)
- **Catalogue par producteur**: Page dédiée affichant tous les produits disponibles en vente directe
  - Filtrage automatique: `disponible_vente_directe = true`
  - Affichage du prix, description, stock
  - CBD% et THC% affichés si disponibles
- **Panier séparé pour vente directe**:
  - Panier dédié avec validation du minimum 20€ par producteur
  - Groupage par producteur avec affichage du total par producteur
  - Badges visuels: ✓ OK (vert) ou Minimum insuffisant (rouge)
  - Message d'alerte si le minimum n'est pas atteint
  - Bouton "Valider la commande" activé uniquement si tous les producteurs ont ≥ 20€
  - Persistance des données dans Supabase
- **Bouton panier rapide**: Badge avec compteur d'articles depuis l'onglet Marché
- **Pull-to-refresh**: Actualisation manuelle de la liste des producteurs

#### Panier vente directe (Table Supabase)

Table `panier_vente_directe` avec structure:
- `id` (uuid, primary key)
- `user_id` (uuid, référence auth.users)
- `product_id` (text, référence products)
- `producer_id` (text, référence producers)
- `quantity` (integer, > 0)
- `created_at` (timestamp)
- `updated_at` (timestamp)

**RLS Policies:**
- Les utilisateurs ne voient que leur propre panier
- Créer/modifier/supprimer items réservé au propriétaire

#### Fonctionnalités panier

- **Gestion de la quantité**: + / - pour modifier les quantités
- **Suppression d'articles**: Bouton supprimer avec icône poubelle
- **Calcul automatique**: Total par producteur et grand total
- **Validation minimum**: Badge rouge si < 20€, vert si ≥ 20€
- **Messages clairs**: "Ajoutez encore X€" avec détail par producteur
- **Bouton sauvegarde**: "Valider la commande" (activé si tous les minimums atteints)

#### Fichiers associés

- `src/app/(tabs)/marche-local.tsx`: Écran principal du marché avec liste des producteurs
- `src/app/(tabs)/marche-catalogue.tsx`: Page catalogue des produits d'un producteur spécifique
- `src/app/(tabs)/panier-vente-directe.tsx`: Écran du panier avec validation du minimum
- `src/lib/direct-sales-cart.ts`: Store Zustand pour gestion du panier
- `database/migrations/create_panier_vente_directe.sql`: Migration pour créer la table
- Requête Supabase: `GET /rest/v1/producers?vente_directe_ferme=eq.true`
- Requête Supabase: `GET /rest/v1/products?producer_id=eq.{id}&disponible_vente_directe=eq.true`
- Requête Supabase: `POST/PATCH/DELETE /rest/v1/panier_vente_directe`

#### Flux utilisateur

1. Utilisateur accède à l'onglet "Marché"
2. Voit la liste des producteurs avec vente directe
3. Clique sur "Voir les produits"
4. Accède au catalogue des produits en vente directe
5. Ajoute les produits au panier (message de confirmation "✓ Ajouté")
6. Clique sur le bouton panier pour voir le panier
7. Voit les articles groupés par producteur
8. Modifie les quantités ou supprime des articles
9. Voit les messages de validation (minimum 20€ par producteur)
10. Clique "Valider la commande" (bouton actif si tous les minimums ≥ 20€)
11. Procède au paiement et commande

#### Système de commande - Vente directe

**Concept:** Lorsqu'un utilisateur valide son panier vente directe, le système crée automatiquement une commande par producteur avec envoi d'emails aux producteurs et client.

**Fonctionnalités:**
- **Création de commandes multi-producteurs**: Une commande = un producteur
- **Validation du minimum**: Vérifie que chaque producteur a ≥ 20€ avant création
- **Données persistantes**: Adresse de retrait, horaires, instructions du producteur sont automatiquement ajoutées
- **Création de lignes de commande**: Chaque article est sauvegardé avec quantité et prix unitaire
- **Envoi d'emails automatique**:
  - Email producteur avec: numéro commande, détails client, liste produits, total, lieu/horaires de retrait
  - CC à leschanvriersbretons@gmail.com pour suivi
  - Email client avec: confirmation, détails commande, producteur, lieu/horaires, statut
- **Écran de confirmation**: Affichage de toutes les commandes créées avec récapitulatif
- **Statut initial**: Toutes les commandes commencent en "en_attente"

**Tables Supabase:**
- `commandes_vente_directe`: Commandes (id, user_id, producer_id, total ≥ 20, statut, adresse_retrait, horaires_retrait, instructions_retrait)
- `lignes_commande_vente_directe`: Ligne de commande (id, commande_id, product_id, quantite, prix_unitaire, sous_total)
- Enum: `commande_status` ('en_attente', 'confirmee', 'prete', 'recuperee', 'annulee')

**RLS Policies:**
- Users voient/créent uniquement leurs propres commandes
- Producteurs voient les commandes qui les concernent
- Admins voient tout
- Admins peuvent modifier les statuts

**Edge Function:**
- `send-order-email`: Récupère détails commande/producteur/client, envoie emails via Resend

**Fichiers associés:**
- `supabase/functions/send-order-email/index.ts`: Edge Function pour emails
- `database/migrations/create_commandes_vente_directe.sql`: Création tables + RLS
- `src/lib/direct-sales-cart.ts`: Méthode `createOrders()` dans le store
- `src/app/(tabs)/panier-vente-directe.tsx`: Bouton validation + handler
- `src/app/(tabs)/commande-confirmation.tsx`: Écran confirmation

**Flux complet:**
1. Client remplit panier vente directe
2. Vérifie minimum 20€ par producteur
3. Clique "Valider la commande"
4. `createOrders()` crée une commande par producteur (POST commandes_vente_directe)
5. Pour chaque commande, crée les lignes de commande (POST lignes_commande_vente_directe)
6. Appelle Edge Function `send-order-email` avec commandeId, producerId, userId
7. Vide le panier après succès
8. Navigue vers écran de confirmation avec liste des commandes créées
9. Edge Function envoie 2 emails:
   - Au producteur + CC company: infos commande, détails produits, retrait
   - Au client: confirmation + infos retrait

#### Gestion des commandes par les producteurs

Les producteurs peuvent gérer leurs commandes vente directe depuis l'onglet Admin.

**Accès:**
- Rôle `producer` : Accès à l'onglet "Mes Commandes" uniquement
- Rôle `admin` : Accès complet + onglet "Mes Commandes" si aussi producteur

**Fonctionnalités:**
- **Liste des commandes**: Affichage des commandes où `producer_id` correspond au producteur connecté
- **Filtres par statut**: Toutes / En attente / Confirmées / Prêtes / Récupérées / Annulées
- **Tri**: Du plus récent au plus ancien
- **Détails commande**: Modal avec infos client (nom, email, téléphone), liste produits, total, lieu/horaires retrait
- **Actions producteur**:
  - "Confirmer la commande" → statut `confirmee`
  - "Marquer comme prête" → statut `prete`
  - "Marquer comme récupérée" → statut `recuperee`
  - "Annuler" → statut `annulee`
- **Notifications automatiques**: Email envoyé au client à chaque changement de statut

**Edge Function `notify-order-status`:**
- Reçoit: commandeId, newStatus, userId, producerId
- Récupère les détails de la commande, du producteur et du client
- Génère un email personnalisé selon le nouveau statut
- Envoie l'email au client via Resend

**Fichiers associés:**
- `src/components/AdminProducerOrders.tsx`: Composant de gestion des commandes producteur
- `supabase/functions/notify-order-status/index.ts`: Edge Function pour notifications
- `src/app/(tabs)/admin.tsx`: Intégration dans l'écran Admin (onglet conditionnel)

**Flux producteur:**
1. Producteur se connecte avec `role = 'producer'`
2. Accède à l'onglet Admin → "Mes Commandes"
3. Voit la liste de ses commandes vente directe
4. Clique sur une commande pour voir les détails
5. Effectue une action (confirmer, prête, récupérée, annuler)
6. Le statut est mis à jour en base + email envoyé au client

### Ma Boutique (Producteurs)

Un onglet "Boutique" est disponible uniquement pour les utilisateurs avec `role = 'producer'` ou `role = 'admin'`.

Cet espace permet aux producteurs de gérer leurs propres produits:
- **Dashboard**: Statistiques (total produits, publiés, brouillons)
- **Liste des produits**: Avec recherche et filtres
- **CRUD complet**: Ajouter, modifier, supprimer des produits
- **Formulaire détaillé**: Nom, type, CBD%, THC%, prix public/pro, stock, TVA, visibilité, statut
- **Analyse de laboratoire**: Upload de PDF ou scan de documents d'analyse
  - Scanner un document avec la caméra
  - Sélectionner un PDF depuis le téléphone
  - Sélectionner une image depuis la galerie
  - Formats acceptés: PDF, JPG, PNG
- **Vente directe à la ferme**:
  - Checkbox "Disponible à la ferme" pour chaque produit
  - Permet aux clients de connaître quels produits sont disponibles pour pickup directement chez le producteur
  - Configuration du profil producteur requise (adresse de retrait, horaires d'ouverture, instructions)

**Synchronisation vente directe:**
- Si un producteur désactive "Vente directe à la ferme" dans son profil, tous ses produits marqués comme "Disponible à la ferme" sont automatiquement désactivés
- La réactivation du profil permet de réactiver manuellement les produits

Fichiers associés:
- `src/app/(tabs)/ma-boutique.tsx`: Écran principal du producteur
- `src/lib/supabase-producer.ts`: API CRUD pour les produits du producteur
- `src/components/LabAnalysisUploader.tsx`: Composant d'upload des analyses
- `database/migrations/add_direct_sales_products.sql`: Migration pour ajouter la colonne et le trigger

Les RLS (Row Level Security) assurent que chaque producteur ne peut gérer que ses propres produits.

### Bourse Produits (Professionnels)

Un onglet "Bourse" est disponible uniquement pour les utilisateurs avec `role = 'pro'` ou `role = 'admin'`.

**Concept:** Système de marché dynamique type bourse où les prix varient selon l'offre et la demande.

#### Fonctionnalités

- **Vue en bulles interactives**: Chaque produit est représenté par une bulle dont:
  - La **taille** reflète le prix dynamique (plus grande = prix proche de +30%)
  - La **couleur** indique la tendance (vert = hausse, rouge = baisse, gris = stable)
  - Badge "Faible stock" ou "Rupture" si applicable

- **Mécanique de prix dynamique (±30%)**:
  - Prix minimum = prix de base × 0.7 (-30%)
  - Prix maximum = prix de base × 1.3 (+30%)
  - Le prix varie selon le ratio demande/stock
  - Mise à jour en temps réel à chaque nouvelle demande

- **Demandes d'achat pro**:
  - Cliquer sur une bulle ouvre le détail du produit
  - Formulaire pour passer une demande avec quantité
  - Prix affiché = prix dynamique au moment de la demande
  - Les demandes sont stockées avec statut `pending`

- **Vue admin** (onglet dans la bourse):
  - Tableau de bord avec statistiques (ordres en attente, validés, annulés)
  - Top produits les plus demandés
  - Top produits avec plus forte variation
  - Liste filtrable de tous les ordres
  - Actions: Valider (matched) ou Annuler (cancelled) les ordres

#### Tables Supabase pour la Bourse

```sql
-- Table pro_orders (demandes des pros)
CREATE TABLE pro_orders (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  product_id text REFERENCES products(id) ON DELETE CASCADE,
  pro_user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  type text NOT NULL DEFAULT 'buy_request',
  quantity integer NOT NULL,
  unit_price numeric NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Index pour les requêtes fréquentes
CREATE INDEX idx_pro_orders_product ON pro_orders(product_id);
CREATE INDEX idx_pro_orders_user ON pro_orders(pro_user_id);
CREATE INDEX idx_pro_orders_status ON pro_orders(status);

-- RLS pour pro_orders
ALTER TABLE pro_orders ENABLE ROW LEVEL SECURITY;

-- Les pros peuvent créer leurs propres ordres
CREATE POLICY "pro_orders_insert" ON pro_orders
  FOR INSERT WITH CHECK (auth.uid() = pro_user_id);

-- Les pros peuvent voir leurs propres ordres
CREATE POLICY "pro_orders_select_own" ON pro_orders
  FOR SELECT USING (auth.uid() = pro_user_id);

-- Les admins peuvent tout voir
CREATE POLICY "pro_orders_select_admin" ON pro_orders
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );

-- Les admins peuvent modifier les statuts
CREATE POLICY "pro_orders_update_admin" ON pro_orders
  FOR UPDATE USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );

-- Les pros peuvent annuler leurs propres ordres pending
CREATE POLICY "pro_orders_update_own" ON pro_orders
  FOR UPDATE USING (
    auth.uid() = pro_user_id AND status = 'pending'
  );
```

#### Ajout des colonnes nécessaires à products

```sql
-- Ajouter le prix de base pour la bourse
ALTER TABLE products ADD COLUMN IF NOT EXISTS base_price numeric;

-- Ajouter le stock disponible
ALTER TABLE products ADD COLUMN IF NOT EXISTS stock_available integer DEFAULT 0;

-- Mettre à jour base_price avec le prix existant si non défini
UPDATE products SET base_price = price WHERE base_price IS NULL;
```

> **Note:** La fonctionnalité Bourse a été retirée de l'application pour simplification.

### Formulaires de Profil par Rôle

Le profil utilisateur affiche un formulaire différent selon le rôle:

#### Client (`role = 'client'`)
- Prénom, Nom (requis)
- Date de naissance (requis, vérification 18+)
- Email (lecture seule)
- Téléphone (requis)
- Adresse complète (requis pour livraison)

#### Producteur (`role = 'producer'`)
- Prénom, Nom (requis)
- Nom de l'entreprise (requis)
- Email (lecture seule)
- Téléphone (requis)
- Adresse complète (requis)
- SIRET (requis, 14 chiffres)
- Bouton "Accéder à ma fiche producteur"
- **Email de contact**: Les producteurs peuvent configurer un email de contact dans leur fiche producteur. Cet email est utilisé pour recevoir les commandes des professionnels.
- **Réseaux sociaux**: Les producteurs peuvent ajouter leurs liens de réseaux sociaux dans leur fiche producteur:
  - Instagram, Facebook, Twitter/X, TikTok, YouTube, Site web
  - Les liens sont affichés sur la carte Pokémon du producteur (onglet Carte)
  - Cliquer sur une icône ouvre directement le lien dans le navigateur
- **Vente directe à la ferme**:
  - Toggle pour activer/désactiver les ventes directes
  - Champs conditionnels: Adresse de retrait, horaires d'ouverture, instructions spéciales
  - Validation: L'adresse de retrait est obligatoire si la vente directe est activée
  - Cette configuration s'applique à tous les produits marqués comme "Disponible à la ferme"

#### Professionnel (`role = 'pro'`)
- Prénom, Nom (requis)
- Raison sociale (requis)
- SIRET (requis, 14 chiffres)
- Numéro de TVA (requis, format FR + 11 chiffres)
- Email (lecture seule)
- Téléphone (requis)
- Adresse complète (requis)

**Validation des comptes pro et producteur:**
- Quand un utilisateur demande le rôle `pro` ou `producer`, son compte est mis en statut `pending`
- L'onglet Pro affiche un message d'attente tant que le compte n'est pas approuvé
- L'administrateur peut approuver ou refuser les demandes dans l'onglet "Utilisateurs" de l'admin
- Champ `pro_status` : `pending` (en attente), `approved` (approuvé), `rejected` (refusé)
- Seuls les comptes avec `pro_status = 'approved'` ont accès aux fonctionnalités pro/producteur
- **Pour les producteurs approuvés**: Un bouton "Créer sa boutique" apparaît pour lier automatiquement une nouvelle boutique au compte

```sql
-- Ajouter le champ pro_status à la table profiles
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS pro_status text DEFAULT NULL;
-- Valeurs possibles: 'pending', 'approved', 'rejected'
```

#### Champs de la table profiles
```sql
-- Ajouter les nouveaux champs à la table profiles
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS first_name text;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS last_name text;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS birth_date date;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS address text;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS postal_code text;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS city text;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS business_name text;

-- Ajouter les champs pour la vente directe à la ferme
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS vente_directe_ferme boolean DEFAULT false;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS adresse_retrait text;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS horaires_retrait text;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS instructions_retrait text;

-- Créer un index pour filtrer les producteurs avec vente directe activée
CREATE INDEX IF NOT EXISTS idx_profiles_vente_directe_ferme ON profiles(vente_directe_ferme) WHERE vente_directe_ferme = true;
```

## Tech Stack

- Expo SDK 53 with React Native
- NativeWind (TailwindCSS) for styling
- React Native Reanimated for animations
- Zustand for state management with AsyncStorage persistence
- Supabase Auth for authentication
- React Query for server state
- Lucide icons
- expo-image-picker for photo selection
- expo-av for audio playback

## Bibliothèque Musicale

L'application dispose d'un lecteur musical style iPod Classic avec une interface d'administration complète.

### Bande Son de Fond - Guinguette du Canal

La bande son de fond comprend 6 morceaux qui tournent en boucle:
- **Guinguette du Canal** (original)
- **Guinguette du Canal 2** (untitled--4-.mpeg)
- **Guinguette du Canal 3** (untitled--2-.mpeg)
- **Guinguette du Canal 4** (untitled--3-.mpeg)
- **Guinguette du Canal 5** (untitled-1.mpeg)
- **Guinguette du Canal 6** (untitled--1-.mpeg)

**Comportement:**
- L'ordre des morceaux est aléatoire à chaque connexion de l'utilisateur
- Les 6 morceaux jouent en boucle continue
- Volume bas (15%) pour ne pas gêner l'utilisation de l'app
- Se mute automatiquement quand la playlist des Chanvriers Bretons joue

### Fonctionnalités

- **Lecteur iPod Classic**: Interface rétro avec molette cliquable, lecture/pause, navigation
- **Contexte audio global**: Une seule instance audio partagée entre tous les écrans
- **Démarrage automatique**: La musique démarre à 20% de volume sur la carte
- **Gestion admin**: Interface complète pour gérer la bibliothèque (accès via icône engrenage)

### Administration Musique

Depuis l'onglet Musique, cliquez sur l'icône engrenage pour accéder à l'admin:

- **Voir les pistes**: Liste avec numéro, couverture, titre, artiste
- **Modifier**: Renommer titre, artiste, album, changer la couverture
- **Réorganiser**: Monter/descendre les pistes dans la playlist
- **Supprimer**: Retirer une piste de la playlist
- **Ajouter**: Upload de nouveaux fichiers audio (nécessite Supabase Storage)

### Configuration Supabase Storage pour la musique

Pour ajouter de nouvelles pistes via l'admin, configurez deux buckets dans Supabase:

1. **Bucket `music-audio`** (privé):
   - File size limit: 50 MB
   - Allowed MIME types: audio/mpeg, audio/mp3, audio/wav

2. **Bucket `music-covers`** (public):
   - File size limit: 5 MB
   - Allowed MIME types: image/jpeg, image/jpg, image/png

```sql
-- Policies pour music-audio (privé)
CREATE POLICY "Audio read access" ON storage.objects
  FOR SELECT USING (bucket_id = 'music-audio');

CREATE POLICY "Audio upload" ON storage.objects
  FOR INSERT WITH CHECK (bucket_id = 'music-audio');

-- Policies pour music-covers (public)
CREATE POLICY "Covers public read" ON storage.objects
  FOR SELECT USING (bucket_id = 'music-covers');

CREATE POLICY "Covers upload" ON storage.objects
  FOR INSERT WITH CHECK (bucket_id = 'music-covers');
```

### Table `music_tracks` (optionnel)

Pour stocker les pistes dans Supabase:

```sql
CREATE TABLE music_tracks (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  title text NOT NULL,
  artist text NOT NULL,
  album text,
  cover_url text,
  audio_url text NOT NULL,
  position integer NOT NULL,
  duration_ms integer,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE music_tracks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "music_tracks_select" ON music_tracks FOR SELECT USING (true);
CREATE POLICY "music_tracks_insert" ON music_tracks FOR INSERT WITH CHECK (true);
CREATE POLICY "music_tracks_update" ON music_tracks FOR UPDATE USING (true);
CREATE POLICY "music_tracks_delete" ON music_tracks FOR DELETE USING (true);
```

## Design

- **Theme**: Whimsical fantasy park inspired by the illustrated France map
- **Color Palette**: Magical night sky theme with warm golden accents
  - Night Sky: #1A2744, #162236 (backgrounds)
  - Charcoal Blue: #243352, #2D3F66 (surfaces)
  - Primary Gold: #D4A853 (accents, navigation)
  - Bright Yellow: #F7D44C (highlights, glows)
  - Pale Gold: #E8C97A (secondary highlights)
  - Orange: #E8945A (warm accents)
  - Forest Green: #3D7A4A (buttons, nature elements)
  - Hemp Green: #5A9E5A (product badges)
  - Sky Blue: #6BB5D9 (water, accents)
  - Teal: #4A9B9B (secondary accents)
  - Cream: #FDF8E8 (text on dark)
- Dark theme with magical, whimsical aesthetic
- Rarity colors: Silver (Commun), Blue (Rare), Purple (Épique), Gold (Légendaire)
- Premium aesthetic inspired by gacha games, fantasy parks, and artisanal products
- Animated pins with pulsing glow effects
- Pokemon-style producer cards with gradient borders and sparkle decorations

## Audit de Stabilité - Corrections (2026-01-14)

### Améliorations UX (Session 2)

1. **Feedback Email Annulé** - Composant Toast créé (`src/components/Toast.tsx`) avec feedback utilisateur quand l'envoi d'email est annulé dans le panier
   - Messages distincts: annulation, erreur, brouillon sauvegardé
   - Animation fluide avec react-native-reanimated

2. **Modal Profil Incomplet Amélioré** - Affichage de la liste des champs manquants dans le modal
   - Nouvelle fonction `getMissingFields()` dans le store
   - Liste à puces des champs manquants (Prénom, Nom, Email, etc.)

3. **Écran Édition Profil Séparé** - Nouvel écran `/edit-profile` dédié à la modification du profil
   - Préremplissage avec données existantes
   - Validation email et téléphone
   - Sauvegarde locale + Supabase
   - Indicateur de complétion du profil
   - Accessible depuis le profil (remplace la redirection vers signup)

4. **Feedback Refresh Commandes** - Toast lors de l'actualisation manuelle des commandes
   - Nouveau bouton "Actualiser les commandes"
   - Message de succès avec nombre de commandes
   - Message d'erreur en cas d'échec

### Fichiers Créés/Modifiés
- `src/components/Toast.tsx` - Composant Toast réutilisable avec hook `useToast`
- `src/app/edit-profile.tsx` - Nouvel écran d'édition de profil
- `src/app/_layout.tsx` - Ajout route edit-profile
- `src/app/(tabs)/cart.tsx` - Intégration Toast pour feedback email
- `src/app/(tabs)/profile.tsx` - Bouton refresh commandes + Toast + lien vers edit-profile
- `src/lib/store.ts` - Fonction `getMissingFields()` ajoutée

### Corrections Critiques Appliqu?es

1. **Bouton Panier March? Local** - Impl?mentation compl?te du bouton d'ajout au panier dans l'?cran March? Local avec:
   - Feedback visuel (spinner, checkmark)
   - Retour haptique
   - V?rification de l'authentification avant ajout

2. **V?rification Stock Avant Commande** - Ajout de la fonction `checkStockAvailability()` dans cart.tsx qui v?rifie que le stock est suffisant avant de passer commande

3. **Protection Double-clic** - ?tat `isProcessingOrder` qui emp?che les soumissions multiples du bouton "Commander"

4. **D?cr?mentation Stock Corrig?e** - Le stock n'est maintenant d?cr?ment? qu'APR?S l'envoi r?ussi de l'email de commande (pas avant)

### Fichiers Modifiés
- `src/app/(tabs)/cart.tsx` - Vérification stock, protection double-clic, décrémentation différée
- `src/app/(tabs)/marche-local.tsx` - Bouton ajout panier fonctionnel

### Améliorations de Robustesse Réseau (Session 3)

Suite à l'audit de robustesse, plusieurs améliorations ont été implémentées pour rendre l'app plus résiliente:

#### 1. Helper `fetchWithRetry` Centralisé
- Timeout de 10 secondes sur toutes les requêtes
- Retry automatique x3 avec backoff exponentiel
- Messages d'erreur en français
- Fichier: `src/lib/fetch-with-retry.ts`

#### 2. Mode Offline-First pour Produits
- Chargement depuis le cache AsyncStorage au démarrage
- Synchronisation en arrière-plan avec Supabase
- Message d'erreur non-bloquant si sync échoue
- Cache automatique des données après sync réussie
- Fichier: `src/lib/useDataSync.ts`

#### 3. Bannière État Réseau Globale
- Détection automatique perte/reprise de connexion
- Messages: "Connexion internet indisponible", "Connexion rétablie"
- Bouton "Réessayer" pour forcer la reconnexion
- Composants: `src/components/NetworkBanner.tsx`, `src/lib/network-context.tsx`

#### 4. Sécurisation Flux de Commande
- Email envoyé AVANT création de commande
- Stock décrémenté SEULEMENT après email réussi
- Si email annulé/échoué: aucune commande créée, stock intact
- Fichier: `src/app/(tabs)/cart.tsx`

- File d'attente pour messages envoyés hors-ligne
- Indicateur visuel d'état de connexion
- Fichier: `src/lib/supabase-sync.ts`

#### 6. Upload d'Images Résilient
- Retry automatique x3 avec backoff exponentiel
- Timeout de 30 secondes par tentative
- Indicateur de progression ("Compression...", "Envoi...")
- Messages d'erreur explicites en français
- Fichier: `src/lib/image-upload.ts`

#### Messages d'Erreur FR

| Situation | Message |
|-----------|---------|
| Pas d'internet | "Connexion internet indisponible. Certaines fonctionnalités sont limitées." |
| Timeout API | "Le serveur met du temps à répondre. Nouvelle tentative..." |
| Échec final | "Impossible de contacter le serveur. Vérifiez votre connexion." |
| Sync produits échoue | "Impossible de charger les produits. Affichage des données en cache." |
| Upload image échoue | "L'image n'a pas pu être envoyée. Réessayez." |

#### Scénarios de Test

1. **Réseau OK** - Tout fonctionne normalement
2. **Réseau lent** - Retry automatique visible, messages de patience
4. **Reprise connexion** - Message "Connexion rétablie", sync automatique

### Fichiers Modifiés
- `src/lib/fetch-with-retry.ts` - NOUVEAU
- `src/lib/network-context.tsx` - NOUVEAU
- `src/components/NetworkBanner.tsx` - NOUVEAU
- `src/lib/supabase-sync.ts` - fetchWithRetry + WebSocket reconnexion
- `src/lib/supabase-auth.ts` - fetchWithRetry
- `src/lib/useDataSync.ts` - Mode offline-first
- `src/lib/image-upload.ts` - Retry + feedback
- `src/app/_layout.tsx` - NetworkProvider + NetworkStatusWrapper
- `src/app/(tabs)/cart.tsx` - Flux commande sécurisé

### À Exécuter dans Supabase
```sql
-- pour corriger les politiques RLS de la table chat_messages
```

### Mode Lecture Seule Offline (Session 4)

Gestion complète du mode hors-ligne avec désactivation des actions d'écriture et feedback visuel.

#### Principe

Quand l'app est hors-ligne:
1. Une bannière fixe apparaît en haut: "Connexion internet indisponible. Certaines fonctionnalités sont limitées."
2. Les actions d'écriture sont désactivées (grisées)
3. Au retour de la connexion, la bannière disparaît et les actions sont réactivées

#### Hooks et Composants

**Hooks disponibles dans `src/lib/network-context.tsx`:**
- `useNetwork()` - Accès au contexte complet (isOnline, checkConnection, cache, etc.)
- `useOfflineStatus()` - Hook simple: `{ isOffline, isOnline, checkConnection }`
- `useCanPerformAction()` - Retourne `true` si online
- `useWriteAction(action)` - Wrapper pour désactiver une action si offline

**Composants dans `src/components/OfflineDisabledButton.tsx`:**
- `OfflineDisabledButton` - Bouton qui se désactive automatiquement en mode offline
  - Props: `onPress`, `disabled`, `offlineMessage`, `showOfflineIcon`
  - Animation shake + haptic feedback si cliqué hors-ligne
  - Tooltip temporaire avec message d'erreur
- `OfflineDisabledZone` - Wrapper pour griser une zone entière

#### Actions Bloquées en Mode Offline

| Écran | Action | Composant modifié |
|-------|--------|-------------------|
| **Panier** | Bouton "Commander" | `src/app/(tabs)/cart.tsx` |
| **Profil** | Sauvegarder modifications | `src/app/edit-profile.tsx` |
| **Bourse** | Valider demande d'achat | `src/components/BourseProductDetailModal.tsx` |

#### Feedback Visuel

1. **Bouton grisé** - Opacité réduite à 0.5
2. **Icône WifiOff** - Apparaît sur les boutons désactivés
3. **Animation shake** - Le bouton tremble si on clique dessus hors-ligne
4. **Haptic warning** - Vibration d'avertissement
5. **Tooltip** - Message temporaire "Non disponible hors ligne" (2 secondes)
6. **Placeholder input** - "Connexion requise pour envoyer..."

#### Fichiers Modifiés

- `src/lib/network-context.tsx` - Nouveaux hooks `useOfflineStatus`, `useWriteAction`
- `src/components/OfflineDisabledButton.tsx` - NOUVEAU composant
- `src/app/(tabs)/cart.tsx` - Bouton Commander avec `OfflineDisabledButton`
- `src/app/edit-profile.tsx` - Boutons sauvegarde désactivés
- `src/components/BourseProductDetailModal.tsx` - Bouton commande désactivé

#### Exemple d'Utilisation

```tsx
import { OfflineDisabledButton } from '@/components/OfflineDisabledButton';
import { useOfflineStatus } from '@/lib/network-context';

function MyComponent() {
  const { isOffline } = useOfflineStatus();

  return (
    <OfflineDisabledButton
      onPress={handleSubmit}
      offlineMessage="Action impossible hors ligne"
      style={{ backgroundColor: 'gold' }}
    >
      <Text>Envoyer</Text>
    </OfflineDisabledButton>
  );
}
```

### Authentification Robuste (Session 5)

Gestion des erreurs d'authentification avec distinction réseau vs credentials et bouton "Réessayer".

#### Principe

Sur les écrans de connexion/inscription:
1. Les erreurs sont classifiées par type (réseau, credentials, token, rate_limit)
2. Les erreurs réseau affichent un bouton "Réessayer"
3. Les erreurs de credentials affichent un conseil pour l'utilisateur
4. Le helper `requestWithRetry` est utilisé pour toutes les requêtes auth

#### Types d'Erreurs

| Type | Détection | Action | Message |
|------|-----------|--------|---------|
| **network** | timeout, fetch failed, connexion | Bouton Réessayer | "Impossible de vérifier votre compte. Vérifiez votre connexion." |
| **credentials** | invalid, incorrect, user not found | Afficher conseil | "Email ou mot de passe incorrect." |
| **token** | token, session expired, jwt | Bouton Réessayer | "Votre session a expiré. Veuillez vous reconnecter." |
| **rate_limit** | 429, trop de tentatives | Attendre | "Trop de tentatives. Veuillez patienter." |
| **server** | 500, 502, 503 | Bouton Réessayer | "Le serveur est temporairement indisponible." |

#### Composant AuthErrorBanner

`src/components/AuthErrorBanner.tsx` - Bannière d'erreur réutilisable avec:

- **Props:**
  - `error` - L'erreur à afficher (Error | string)
  - `onRetry` - Callback pour le bouton Réessayer
  - `isRetrying` - État de chargement du retry
  - `onDismiss` - Callback pour fermer la bannière
  - `showDismiss` - Afficher le bouton Fermer

- **Fonctions utilitaires exportées:**
  - `getAuthErrorType(error)` - Retourne le type d'erreur
  - `getAuthErrorMessage(type)` - Retourne le message utilisateur
  - `canRetryAuthError(type)` - Vérifie si retry possible

#### Fichiers Modifiés

- `src/components/AuthErrorBanner.tsx` - NOUVEAU composant
- `src/lib/useAuth.ts` - Ajout `signInErrorType`, `resetSignInError`, `retrySession`
- `src/app/auth/login.tsx` - AuthErrorBanner + handleRetry
- `src/app/auth/signup.tsx` - AuthErrorBanner + handleRetry

#### Exemple d'Utilisation

```tsx
import { AuthErrorBanner, canRetryAuthError, getAuthErrorType } from '@/components/AuthErrorBanner';

function LoginForm() {
  const { signIn, signInError, resetSignInError } = useAuth();
  const [isRetrying, setIsRetrying] = useState(false);

  const handleRetry = async () => {
    setIsRetrying(true);
    resetSignInError();
    await signIn({ email, password });
    setIsRetrying(false);
  };

  return (
    <>
      {signInError && (
        <AuthErrorBanner
          error={signInError}
          onRetry={handleRetry}
          isRetrying={isRetrying}
          onDismiss={resetSignInError}
          showDismiss={!canRetryAuthError(getAuthErrorType(signInError))}
        />
      )}
      {/* ... form fields */}
    </>
  );
}
```

#### Différence Erreur Réseau vs Credentials

```tsx
// Dans AuthErrorBanner.tsx
export function getAuthErrorType(error): AuthErrorType {
  const message = error.message.toLowerCase();

  // Erreur réseau - retry possible
  if (message.includes('timeout') || message.includes('network')) {
    return 'network'; // → Bouton Réessayer
  }

  // Erreur credentials - pas de retry
  if (message.includes('invalid') || message.includes('incorrect')) {
    return 'credentials'; // → Conseil utilisateur
  }

  return 'unknown';
}
```

### Cache Catalogue Offline-First (Session 6)

Système de cache local pour le catalogue produits/producteurs avec affichage des données en cache et bouton Rafraîchir.

#### Principe

1. Au démarrage: Charger les données depuis le cache AsyncStorage
2. Afficher immédiatement les données en cache
3. Tenter une synchronisation réseau en arrière-plan
4. Si la sync échoue: Afficher un message + bouton "Rafraîchir"
5. Si la sync réussit: Mettre à jour le cache et les stores

#### Clés de Cache (AsyncStorage)

| Clé | Description |
|-----|-------------|
| `cache_producers_v2` | Liste des producteurs avec leurs produits |
| `cache_packs_v2` | Liste des packs |
| `cache_promo_products_v2` | Liste des produits en promotion |
| `cache_lots_v2` | Liste des lots (tirage) |
| `cache_last_sync_v2` | Timestamp de la dernière synchronisation |

#### Hooks et Fonctions

**`src/lib/useDataSync.ts`:**

```tsx
// Hook de synchronisation (appelé au montage du layout)
useDataSync();

// Hook pour suivre l'état de sync dans les composants
const { status, error, lastSyncAt, isUsingCache } = useSyncState();

// Force une synchronisation manuelle
const result = await forceDataSync();
// result: { success: boolean, error?: string, isUsingCache: boolean }

// Vider le cache
await clearDataCache();
```

**Types de statut:**
- `idle` - Aucune opération en cours
- `loading-cache` - Chargement depuis le cache
- `syncing` - Synchronisation réseau en cours
- `success` - Sync réussie
- `error` - Sync échouée (données en cache affichées)
- `offline` - Pas de connexion

#### Composant CacheStatusBanner

`src/components/CacheStatusBanner.tsx` - Bannière d'état du cache avec:

**Props CacheStatusBanner:**
- `style` - Style personnalisé
- `showOnlyOnError` - N'afficher que si erreur ou cache uniquement
- `onRefreshSuccess` - Callback après refresh réussi

**Props CompactCacheStatus:**
- `style` - Style personnalisé

**Affichage selon l'état:**

| État | Icône | Couleur | Message | Bouton |
|------|-------|---------|---------|--------|
| `syncing` | RefreshCw (animé) | Teal | "Synchronisation des données..." | - |
| `error` | WifiOff | Rouge | "Impossible de charger les produits. Affichage des données en cache." | Rafraîchir |
| `isUsingCache` | Database | Gold | "Affichage des données en cache." | Rafraîchir |

#### Intégration dans les Écrans

Les bannières sont intégrées dans les écrans suivants:

| Écran | Composant | Variante |
|-------|-----------|----------|
| **Carte (map.tsx)** | `<CompactCacheStatus />` | Compacte - après le header |
| **Boutique (shop.tsx)** | `<CacheStatusBanner showOnlyOnError />` | Complète - erreurs seulement |
| **Promotions (promo.tsx)** | `<CompactCacheStatus />` | Compacte - après le header |
| **Packs (packs.tsx)** | `<CompactCacheStatus />` | Compacte - après le header |

#### Exemple d'Utilisation

```tsx
import { CacheStatusBanner, CompactCacheStatus } from '@/components/CacheStatusBanner';
import { useSyncState, forceDataSync } from '@/lib/useDataSync';

// Variante complète avec callback
function ProductList() {
  return (
    <View>
      <CacheStatusBanner
        showOnlyOnError
        onRefreshSuccess={() => console.log('Données actualisées!')}
      />
      {/* ... liste des produits */}
    </View>
  );
}

// Variante compacte pour les headers
function ScreenWithHeader() {
  return (
    <View>
      <Header />
      <CompactCacheStatus />
      <Content />
    </View>
  );
}

// Accès direct à l'état de sync
function SyncIndicator() {
  const { status, isUsingCache, lastSyncAt } = useSyncState();

  if (status === 'syncing') {
    return <ActivityIndicator />;
  }

  return (
    <Text>{isUsingCache ? 'Données en cache' : 'Données à jour'}</Text>
  );
}
```

#### Fichiers Modifiés

- `src/lib/useDataSync.ts` - Hook existant, déjà implémenté avec cache
- `src/components/CacheStatusBanner.tsx` - NOUVEAU composant
- `src/app/(tabs)/map.tsx` - Ajout CompactCacheStatus
- `src/app/(tabs)/shop.tsx` - Ajout CacheStatusBanner
- `src/app/(tabs)/promo.tsx` - Ajout CompactCacheStatus
- `src/app/(tabs)/packs.tsx` - Ajout CompactCacheStatus

#### Flux de Données

```
┌──────────────┐     ┌─────────────┐     ┌──────────────┐
│  App Start   │ --> │ Load Cache  │ --> │ Show UI      │
└──────────────┘     └─────────────┘     └──────────────┘
                            │
                            v
                     ┌─────────────┐
                     │ Try Sync    │
                     └─────────────┘
                            │
              ┌─────────────┴─────────────┐
              │                           │
              v                           v
       ┌──────────┐                ┌──────────┐
       │ Success  │                │  Error   │
       └──────────┘                └──────────┘
              │                           │
              v                           v
       ┌──────────────┐           ┌──────────────────┐
       │ Update Cache │           │ Show Banner +    │
       │ Update Store │           │ "Rafraîchir"     │
       │ Hide Banner  │           └──────────────────┘
       └──────────────┘
```

### File d'Attente Commandes Résiliente (Session 7)

Système de file d'attente pour les commandes en cas d'échec réseau, avec resync automatique au retour de la connexion.

#### Principe

1. La commande est d'abord sauvegardée localement (toujours)
2. Tentative de synchronisation vers Supabase
3. Si échec réseau: Ajouter à la file d'attente + message utilisateur
4. Au retour du réseau: Resync automatique des commandes en attente
5. Bouton manuel disponible pour forcer la synchronisation

#### Message Utilisateur

En cas d'échec de sync:
> "Votre commande n'a pas pu être envoyée. Elle sera envoyée dès que possible."

#### Store de File d'Attente

`src/lib/order-queue-store.ts` - Gestion des commandes en attente

```tsx
import { useOrderQueueStore } from '@/lib/order-queue-store';

// États d'une commande en attente
type PendingOrderStatus = 'pending' | 'syncing' | 'failed' | 'synced';

// Structure d'une commande en file d'attente
interface PendingOrder {
  id: string;
  order: Order;
  createdAt: number;
  lastAttempt: number;
  attemptCount: number;
  error?: string;
  status: PendingOrderStatus;
}

// Actions disponibles
const {
  addPendingOrder,      // Ajouter une commande à la file
  removePendingOrder,   // Retirer une commande
  syncPendingOrders,    // Synchroniser toutes les commandes en attente
  clearSyncedOrders,    // Nettoyer les commandes synchronisées
  getPendingCount,      // Nombre de commandes en attente
  getFailedCount,       // Nombre de commandes échouées
} = useOrderQueueStore();
```

#### Resync Automatique

Le listener réseau est configuré dans `_layout.tsx`:

```tsx
import { setupOrderQueueNetworkListener, cleanupOrderQueueNetworkListener } from '@/lib/order-queue-store';

// Dans RootLayoutNav
useEffect(() => {
  setupOrderQueueNetworkListener();
  return () => cleanupOrderQueueNetworkListener();
}, []);
```

**Comportement:**
- Détecte automatiquement le retour de la connexion
- Attend 2 secondes pour laisser le réseau se stabiliser
- Lance la synchronisation des commandes en attente
- Log les résultats (succès/échecs)

#### Composant PendingOrdersBanner

`src/components/PendingOrdersBanner.tsx` - Bannière affichant les commandes en attente

```tsx
import { PendingOrdersBanner, CompactPendingOrdersIndicator } from '@/components/PendingOrdersBanner';

// Bannière complète avec bouton de sync
<PendingOrdersBanner
  onSyncComplete={(result) => {
    console.log(`${result.success} réussie(s), ${result.failed} échouée(s)`);
  }}
/>

// Indicateur compact pour les headers
<CompactPendingOrdersIndicator />
```

**États affichés:**

| État | Icône | Couleur | Message | Action |
|------|-------|---------|---------|--------|
| `syncing` | RefreshCw (animé) | Teal | "Synchronisation des commandes en cours..." | - |
| `synced` | CheckCircle | Vert | "X commande(s) synchronisée(s) avec succès !" | - |
| `failed` | AlertTriangle | Rouge | "X commande(s) n'ont pas pu être envoyée(s)..." | Réessayer |
| `pending` | Clock | Gold | "X commande(s) en attente de synchronisation." | Synchroniser |

#### Intégration dans le Panier

La bannière est affichée dans `cart.tsx` après le header:

```tsx
<PendingOrdersBanner
  onSyncComplete={(result) => {
    if (result.success > 0) {
      showToast(`${result.success} commande(s) synchronisée(s) avec succès !`, 'success');
    }
  }}
/>
```

#### Flux de Commande Résilient

```
┌─────────────────┐
│  Utilisateur    │
│  Clique "OK"    │
└────────┬────────┘
         │
         v
┌─────────────────┐
│ Email envoyé ?  │
└────────┬────────┘
         │ Oui
         v
┌─────────────────┐
│ Sauvegarder     │
│ commande locale │
└────────┬────────┘
         │
         v
┌─────────────────┐     ┌──────────────────────┐
│ Sync Supabase   │---->│ Succès               │
└────────┬────────┘     │ → Décrémenter stock  │
         │ Échec        │ → Confirmation       │
         v              └──────────────────────┘
┌─────────────────┐
│ Ajouter à la    │
│ file d'attente  │
└────────┬────────┘
         │
         v
┌─────────────────┐     ┌──────────────────────┐
│ Afficher        │     │ Au retour réseau:    │
│ message warning │     │ → Resync auto        │
└─────────────────┘     │ → Bouton manuel      │
                        └──────────────────────┘
```

#### Fichiers Modifiés

- `src/lib/order-queue-store.ts` - NOUVEAU: Store Zustand avec persistance
- `src/components/PendingOrdersBanner.tsx` - NOUVEAU: Composant bannière
- `src/app/(tabs)/cart.tsx` - Intégration file d'attente + bannière
- `src/app/_layout.tsx` - Setup du listener réseau automatique

#### Stockage Persistant

Les commandes en attente sont stockées dans AsyncStorage avec la clé:
- `order-queue-storage` - État complet de la file d'attente

Cela garantit que les commandes ne sont pas perdues même si l'app est fermée.

