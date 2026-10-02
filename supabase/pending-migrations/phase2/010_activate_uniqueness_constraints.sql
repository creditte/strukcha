-- Rulebook v1 · PHASE 2 ACTIVATION · NOT APPLIED. Do not run in Phase 1.
-- Run only after the pre-checks below return zero rows (after Phase 2 backfill
-- has merged duplicate spouse facts and resolved multiple Trades As owners).
--
-- PRE-CHECK 1: duplicate active spouse pairs (either orientation)
--   SELECT tenant_id, least(from_entity_id, to_entity_id) a, greatest(from_entity_id, to_entity_id) b, count(*)
--   FROM public.relationships
--   WHERE relationship_type = 'spouse' AND deleted_at IS NULL AND end_date IS NULL
--   GROUP BY 1,2,3 HAVING count(*) > 1;
--
-- PRE-CHECK 2: Sole Traders with more than one active Trades As owner
--   SELECT to_entity_id, count(*) FROM public.relationships
--   WHERE relationship_type = 'trades_as' AND deleted_at IS NULL AND end_date IS NULL
--   GROUP BY 1 HAVING count(*) > 1;

-- One active spouse fact per unordered pair.
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS relationships_spouse_unordered_active_uidx
  ON public.relationships (tenant_id, least(from_entity_id, to_entity_id), greatest(from_entity_id, to_entity_id))
  WHERE relationship_type = 'spouse' AND deleted_at IS NULL AND end_date IS NULL;

-- One active underlying Individual per Sole Trader.
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS relationships_trades_as_one_owner_active_uidx
  ON public.relationships (to_entity_id)
  WHERE relationship_type = 'trades_as' AND deleted_at IS NULL AND end_date IS NULL;

-- Trigger switch-over is phase2/012_activate_policy_trigger.sql.
