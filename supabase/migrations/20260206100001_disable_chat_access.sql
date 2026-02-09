-- ============================================================================
-- SECURITY: Disable chat access and realtime exposure
-- ============================================================================
-- Date: 2026-02-06
-- Goal: Keep chat tables/data intact but remove public access and realtime.
-- ============================================================================

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'chat_messages'
  ) THEN
    -- Remove from realtime publication if currently a member
    IF EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'chat_messages'
    ) THEN
      ALTER PUBLICATION supabase_realtime DROP TABLE public.chat_messages;
    END IF;

    REVOKE ALL ON TABLE public.chat_messages FROM anon, authenticated, public;

    DROP POLICY IF EXISTS "chat_messages_select" ON public.chat_messages;
    DROP POLICY IF EXISTS "chat_messages_insert" ON public.chat_messages;
    DROP POLICY IF EXISTS "chat_messages_delete" ON public.chat_messages;
    DROP POLICY IF EXISTS "chat_select" ON public.chat_messages;
    DROP POLICY IF EXISTS "chat_insert" ON public.chat_messages;

    ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'producer_chat_messages'
  ) THEN
    -- Remove from realtime publication if currently a member
    IF EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'producer_chat_messages'
    ) THEN
      ALTER PUBLICATION supabase_realtime DROP TABLE public.producer_chat_messages;
    END IF;

    REVOKE ALL ON TABLE public.producer_chat_messages FROM anon, authenticated, public;

    DROP POLICY IF EXISTS "producer_chat_messages_select" ON public.producer_chat_messages;
    DROP POLICY IF EXISTS "producer_chat_messages_insert" ON public.producer_chat_messages;
    DROP POLICY IF EXISTS "producer_chat_messages_delete" ON public.producer_chat_messages;
    DROP POLICY IF EXISTS "chat_messages_select" ON public.producer_chat_messages;
    DROP POLICY IF EXISTS "chat_messages_insert" ON public.producer_chat_messages;
    DROP POLICY IF EXISTS "chat_messages_delete" ON public.producer_chat_messages;
    DROP POLICY IF EXISTS "chat_select" ON public.producer_chat_messages;
    DROP POLICY IF EXISTS "chat_insert" ON public.producer_chat_messages;

    ALTER TABLE public.producer_chat_messages ENABLE ROW LEVEL SECURITY;
  END IF;
END $$;
