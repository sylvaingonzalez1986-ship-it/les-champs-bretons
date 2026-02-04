-- Fix mutable search_path for award_tickets
-- Signature: award_tickets(p_user_id uuid, p_amount integer, p_source text, p_source_details jsonb, p_replay_hash text)
ALTER FUNCTION public.award_tickets(uuid, integer, text, jsonb, text) SET search_path = '';
