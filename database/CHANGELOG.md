# Changelog des Migrations SQL - Les Chanvriers Unis

Ce fichier documente toutes les migrations SQL appliquées au projet.

---

## [2026-01-25] - Audit de Sécurité Complet

### Fichier: `supabase/migrations/20260125_security_audit_fixes.sql`

#### Ajouté
- RLS activé et forcé sur toutes les tables publiques
- Index de performance sur `profiles`, `producers`, `products`, `orders`, `user_lots`, `producer_chat_messages`
- Fonctions helper sécurisées avec `SET search_path = ''`
- Politiques RLS pour `panier_vente_directe` et `commandes_vente_directe`
- Fonctions de validation : `is_valid_email()`, `sanitize_text()`

#### Sécurité
- Protection des audit logs (immuables : pas de UPDATE/DELETE)
- Toutes les fonctions SECURITY DEFINER utilisent search_path vide

---

## [2026-01-23] - Correction Signup Role

### Fichier: `supabase/migrations/20260123_fix_signup_role.sql`

#### Corrigé
- Trigger `handle_new_user` lit maintenant le rôle depuis `raw_user_meta_data`

---

## [2026-01-22] - RLS Commandes Producteurs

### Fichier: `supabase/migrations/20260122000000_orders_rls_producers.sql`

#### Ajouté
- Politique permettant aux producteurs de voir les commandes contenant leurs produits

---

## [2026-01-16] - Table Orders

### Fichier: `supabase/migrations/20260116_create_orders_table.sql`

#### Ajouté
- Table `orders` avec colonnes : id, customer_email, customer_name, items, total, status, etc.
- Index sur customer_email et status
- Politiques RLS pour utilisateurs et producteurs

---

## [2026-01-15] - Corrections Sécurité Multiples

### Fichiers
- `20260115_fix_security_definer_and_rls.sql`
- `20260115_fix_search_path_functions.sql`
- `20260115_fix_permissive_rls.sql`
- `20260115_fix_profiles_signup.sql`
- `20260115_fix_fk_trigger_timing.sql`

#### Corrigé
- Views `products_for_clients` et `products_for_pros` avec SECURITY INVOKER
- RLS sur `allowed_mime_types`
- search_path fixé sur 20+ fonctions
- Timing des triggers FK

---

## [2026-01-13] - RLS Orders Fix

### Fichier: `supabase/migrations/20260113120000_fix_orders_rls.sql`

#### Corrigé
- Politiques RLS sur la table orders

---

## Migrations dans `database/migrations/`

### Vente Directe
- `add_direct_farm_sales.sql` - Champs vente directe sur producers
- `add_direct_sales_products.sql` - Champs vente directe sur products
- `add_product_direct_sales.sql` - Disponibilité vente directe
- `create_panier_vente_directe.sql` - Table panier
- `create_commandes_vente_directe.sql` - Table commandes

### RLS & Sécurité
- `fix_chat_messages_rls.sql` - RLS sur chat producteurs
- `fix_orders_rls_policies.sql` - Politiques commandes
- `validate_file_uploads.sql` - Validation uploads

### RGPD
- `rgpd_functions.sql` - Export/suppression données utilisateur

---

## Fichiers de Référence

| Fichier | Description |
|---------|-------------|
| `COMPLETE_RLS_POLICIES.sql` | Toutes les politiques RLS consolidées |
| `SECURITY_RLS_POLICIES.sql` | Politiques de sécurité additionnelles |
| `FIX_AUDIT_LOG_TABLE.sql` | Création table audit_log_entries |
| `EXECUTE_IN_SUPABASE.sql` | Script d'exécution initial |
| `RLS_DOCUMENTATION.md` | Documentation complète RLS |

---

## Comment appliquer une migration

1. Ouvrir Supabase Dashboard > SQL Editor
2. Copier le contenu du fichier de migration
3. Exécuter la requête
4. Vérifier avec :
   ```sql
   SELECT tablename, rowsecurity FROM pg_tables WHERE schemaname = 'public';
   SELECT tablename, policyname, cmd FROM pg_policies WHERE schemaname = 'public';
   ```

---

_Dernière mise à jour : 2026-01-25_
