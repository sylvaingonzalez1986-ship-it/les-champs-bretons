-- Normalize local_market_orders.producer_id to producers.id when it stores profile_id.
UPDATE local_market_orders AS lmo
SET producer_id = p.id
FROM producers AS p
WHERE lmo.producer_id = p.profile_id::text
  AND lmo.producer_id <> p.id;
