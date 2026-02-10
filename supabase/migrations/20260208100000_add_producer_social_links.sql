-- Migration 20260208100000_add_producer_social_links.sql

BEGIN;

-- 1. Ajout colonnes sur producers (fiche producteur)
ALTER TABLE public.producers
    ADD COLUMN IF NOT EXISTS instagram_url text,
    ADD COLUMN IF NOT EXISTS facebook_url text,
    ADD COLUMN IF NOT EXISTS website_url text,
    ADD COLUMN IF NOT EXISTS tiktok_url text,
    ADD COLUMN IF NOT EXISTS linkedin_url text,
    ADD COLUMN IF NOT EXISTS youtube_url text;

-- 2. Duplication sur profiles (exposition publique + coherence)
ALTER TABLE public.profiles
    ADD COLUMN IF NOT EXISTS instagram_url text,
    ADD COLUMN IF NOT EXISTS facebook_url text,
    ADD COLUMN IF NOT EXISTS website_url text,
    ADD COLUMN IF NOT EXISTS tiktok_url text,
    ADD COLUMN IF NOT EXISTS linkedin_url text,
    ADD COLUMN IF NOT EXISTS youtube_url text;

-- 3. Index optionnel sur instagram_url (pour les listings tries par activite)
CREATE INDEX IF NOT EXISTS idx_producers_instagram ON public.producers (instagram_url)
WHERE instagram_url IS NOT NULL AND instagram_url != '';

COMMIT;
