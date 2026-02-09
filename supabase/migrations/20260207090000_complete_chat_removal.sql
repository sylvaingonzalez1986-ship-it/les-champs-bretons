-- ============================================================================
-- COMPLETE CHAT REMOVAL
-- ============================================================================
-- Date: 2026-02-07
-- Goal: Drop chat tables and related functions after feature removal.
-- ============================================================================

-- Drop realtime chat tables if they still exist
DROP TABLE IF EXISTS public.chat_messages CASCADE;
DROP TABLE IF EXISTS public.producer_chat_messages CASCADE;
DROP TABLE IF EXISTS public.chat_rooms CASCADE;
DROP TABLE IF EXISTS public.chat_connections CASCADE;

-- Drop any related functions that may remain
DROP FUNCTION IF EXISTS public.notify_new_message() CASCADE;
DROP FUNCTION IF EXISTS public.is_producer_or_admin() CASCADE;
