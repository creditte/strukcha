-- Rulebook v1 · PHASE 2 · NOT APPLIED. Requires phase1/002.
-- Extends relationship_import_evidence so every XPM path (sync, group import,
-- CSV import) can record the full normalisation decision. Additive only;
-- the table is new and empty, so no existing row changes.
ALTER TABLE public.relationship_import_evidence
  ADD COLUMN IF NOT EXISTS raw_from_entity_type text,
  ADD COLUMN IF NOT EXISTS raw_to_entity_type text,
  ADD COLUMN IF NOT EXISTS direction_known boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS entity_type_provisional boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS resolved_via_trades_as boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS rie_tenant_outcome_idx
  ON public.relationship_import_evidence (tenant_id, policy_outcome);
