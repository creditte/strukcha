-- Rulebook v1 · PHASE 2 ACTIVATION · NOT APPLIED. Requires phase1/001, phase1/002.
-- Switches database enforcement to the canonical SQL evaluator.
--
-- Effect once applied:
--   * INSERT, and UPDATE that changes type/from/to, must evaluate to `valid`
--     exactly as stored. review / resolve_sole_trader / reverse / invalid /
--     deprecated are rejected — callers must canonicalise first.
--   * Soft-deletes and metadata-only edits of existing (legacy) rows still
--     succeed, so history and archived behaviour are preserved and no row is
--     rewritten by this file.
--   * rel_direction_valid() becomes a thin wrapper over the evaluator so any
--     remaining caller agrees with the policy.
-- Apply only after the Edge Functions send canonical rows (013) and after the
-- Phase 2 review of existing rows; it does not touch existing data.

CREATE OR REPLACE FUNCTION public.rel_direction_valid(_rtype text, _from_type text, _to_type text)
RETURNS boolean
LANGUAGE sql IMMUTABLE
SET search_path = public
AS $$
  SELECT public.relationship_policy_evaluate(_rtype, _from_type, _to_type, true)->>'outcome' = 'valid'
$$;

CREATE OR REPLACE FUNCTION public.validate_relationship_rules()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _from_type text;
  _to_type text;
  _r jsonb;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.deleted_at IS NOT NULL THEN RETURN NEW; END IF;
    IF NEW.relationship_type = OLD.relationship_type
       AND NEW.from_entity_id = OLD.from_entity_id
       AND NEW.to_entity_id = OLD.to_entity_id
       AND OLD.deleted_at IS NOT DISTINCT FROM NEW.deleted_at THEN
      RETURN NEW; -- metadata-only edit; do not re-judge a legacy fact
    END IF;
  END IF;

  SELECT entity_type::text INTO _from_type FROM public.entities WHERE id = NEW.from_entity_id;
  SELECT entity_type::text INTO _to_type FROM public.entities WHERE id = NEW.to_entity_id;

  _r := public.relationship_policy_evaluate(NEW.relationship_type::text, _from_type, _to_type, true);
  IF _r->>'outcome' <> 'valid' THEN
    RAISE EXCEPTION 'Relationship not canonical: % (%). A % link from % to % is not stored as-is.',
      _r->>'outcome', _r->>'reason', NEW.relationship_type, coalesce(_from_type, 'unknown'), coalesce(_to_type, 'unknown')
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
-- The existing trigger on public.relationships already calls this function;
-- no trigger is created or dropped here.
