-- Fix mutable search_path for spend_tickets
-- Signature: spend_tickets(p_user_id uuid, p_amount integer, p_source text, p_source_details jsonb)
ALTER FUNCTION public.spend_tickets(uuid, integer, text, jsonb) SET search_path = '';
