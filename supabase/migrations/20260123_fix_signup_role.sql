-- ============================================================================
-- CORRECTION: Appliquer le rôle sélectionné lors de l'inscription
-- ============================================================================
-- Date: 2026-01-23
-- Problème: Le rôle est toujours "client" même si l'utilisateur choisit "pro" ou "producer"
-- Cause: Le trigger handle_new_user ignore les metadata et met toujours 'client'
-- Solution: Lire le rôle depuis raw_user_meta_data et l'appliquer
-- ============================================================================

-- ============================================================================
-- ÉTAPE 1 : Mettre à jour la fonction handle_new_user
-- ============================================================================
-- Cette fonction lit maintenant le rôle depuis les metadata de l'utilisateur
-- Si aucun rôle n'est spécifié, 'client' est utilisé par défaut

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
  user_role TEXT;
  user_full_name TEXT;
BEGIN
  -- Extraire le rôle des metadata (passé lors de l'inscription)
  -- Valeurs acceptées: 'client', 'pro', 'producer'
  user_role := COALESCE(
    NEW.raw_user_meta_data->>'role',
    'client'  -- Rôle par défaut si non spécifié
  );

  -- Valider que le rôle est valide
  IF user_role NOT IN ('client', 'pro', 'producer') THEN
    user_role := 'client';
  END IF;

  -- Extraire le nom complet des metadata
  user_full_name := NEW.raw_user_meta_data->>'full_name';

  -- Log pour debug
  RAISE LOG 'handle_new_user: Creating profile for user % with role %', NEW.id, user_role;

  INSERT INTO public.profiles (id, email, role, full_name, created_at, updated_at)
  VALUES (
    NEW.id,
    NEW.email,
    user_role,  -- Utiliser le rôle des metadata
    user_full_name,
    NOW(),
    NOW()
  )
  ON CONFLICT (id) DO UPDATE SET
    email = EXCLUDED.email,
    -- Ne pas écraser le rôle si le profil existe déjà
    -- role = COALESCE(profiles.role, EXCLUDED.role),
    updated_at = NOW();

  RETURN NEW;
EXCEPTION
  WHEN OTHERS THEN
    -- Log l'erreur mais ne bloque pas l'inscription
    RAISE WARNING 'Could not create profile for user %: %', NEW.id, SQLERRM;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- ÉTAPE 2 : S'assurer que le trigger existe
-- ============================================================================
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ============================================================================
-- RÉSUMÉ DES CHANGEMENTS
-- ============================================================================
-- ✅ Le trigger lit maintenant le rôle depuis raw_user_meta_data
-- ✅ Les rôles valides sont: 'client', 'pro', 'producer'
-- ✅ Si aucun rôle n'est spécifié, 'client' est utilisé par défaut
-- ✅ Le nom complet est aussi extrait des metadata
-- ============================================================================
