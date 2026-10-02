-- Rulebook v1 · Phase 1 · NOT APPLIED. See docs/relationship-policy.md.
-- SQL twin of src/lib/relationshipPolicy.ts. Must return the same outcome and
-- reason for every vector in src/test/fixtures/relationship-policy-vectors.json.
--
-- This file:
--   * adds public.relationship_policy_category() and
--     public.relationship_policy_evaluate()  (pure, unused by any trigger yet);
--   * adds public.relationship_import_evidence (empty, tenant-isolated).
-- It does NOT update any row and does NOT replace validate_relationship_rules()
-- or rel_direction_valid(); those stay active until Phase 2.

-- ── Category mapping ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.relationship_policy_category(_db_type text)
RETURNS text
LANGUAGE sql IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE _db_type
    WHEN 'Individual' THEN 'individual'
    WHEN 'Company' THEN 'company'
    WHEN 'Partnership' THEN 'partnership'
    WHEN 'Sole Trader' THEN 'sole_trader'
    WHEN 'Incorporated Association/Club' THEN 'incorporated_association'
    WHEN 'trust_discretionary' THEN 'discretionary_trust'
    WHEN 'trust_family' THEN 'discretionary_trust'
    WHEN 'trust_unit' THEN 'unit_trust'
    WHEN 'trust_hybrid' THEN 'hybrid_trust'
    WHEN 'trust_bare' THEN 'bare_trust'
    WHEN 'trust_testamentary' THEN 'testamentary_trust'
    WHEN 'trust_deceased_estate' THEN 'deceased_estate'
    WHEN 'smsf' THEN 'smsf'
    WHEN 'Trust' THEN 'generic_trust'
    ELSE 'unclassified'
  END
$$;

-- ── Rule table (as a function so it stays immutable and versioned) ──
CREATE OR REPLACE FUNCTION public.relationship_policy_rule(_type text)
RETURNS jsonb
LANGUAGE sql IMMUTABLE
SET search_path = public
AS $$
  WITH c AS (
    SELECT
      ARRAY['discretionary_trust','unit_trust','hybrid_trust','bare_trust','testamentary_trust','deceased_estate'] AS trusts
  ), s AS (
    SELECT trusts,
      ARRAY['individual','company','partnership'] || trusts || ARRAY['smsf','incorporated_association'] AS econ,
      ARRAY['individual','company'] || trusts || ARRAY['smsf','incorporated_association'] AS partner_src
    FROM c
  )
  SELECT CASE _type
    WHEN 'director'    THEN jsonb_build_object('sources', to_jsonb(ARRAY['individual']), 'targets', to_jsonb(ARRAY['company']), 'symmetric', false, 'auto_reverse', true, 'st_resolves', false)
    WHEN 'shareholder' THEN jsonb_build_object('sources', to_jsonb(econ), 'targets', to_jsonb(ARRAY['company']), 'symmetric', false, 'auto_reverse', true, 'st_resolves', true)
    WHEN 'unit_holder' THEN jsonb_build_object('sources', to_jsonb(econ), 'targets', to_jsonb(ARRAY['unit_trust','hybrid_trust']), 'symmetric', false, 'auto_reverse', true, 'st_resolves', true)
    WHEN 'trustee'     THEN jsonb_build_object('sources', to_jsonb(ARRAY['individual','company']), 'targets', to_jsonb(trusts || ARRAY['smsf']), 'symmetric', false, 'auto_reverse', true, 'st_resolves', false)
    WHEN 'beneficiary' THEN jsonb_build_object('sources', to_jsonb(econ), 'targets', to_jsonb(ARRAY['discretionary_trust','hybrid_trust','bare_trust','testamentary_trust','deceased_estate']), 'symmetric', false, 'auto_reverse', true, 'st_resolves', true, 'bare_sources', to_jsonb(ARRAY['individual','company','smsf']))
    WHEN 'member'      THEN jsonb_build_object('sources', to_jsonb(ARRAY['individual']), 'targets', to_jsonb(ARRAY['smsf']), 'symmetric', false, 'auto_reverse', true, 'st_resolves', false)
    WHEN 'appointer'   THEN jsonb_build_object('sources', to_jsonb(ARRAY['individual','company']), 'targets', to_jsonb(ARRAY['discretionary_trust']), 'symmetric', false, 'auto_reverse', true, 'st_resolves', false)
    WHEN 'partner'     THEN jsonb_build_object('sources', to_jsonb(partner_src), 'targets', to_jsonb(ARRAY['partnership']), 'symmetric', false, 'auto_reverse', true, 'st_resolves', true)
    WHEN 'spouse'      THEN jsonb_build_object('sources', to_jsonb(ARRAY['individual']), 'targets', to_jsonb(ARRAY['individual']), 'symmetric', true, 'auto_reverse', false, 'st_resolves', false)
    WHEN 'parent'      THEN jsonb_build_object('sources', to_jsonb(ARRAY['individual']), 'targets', to_jsonb(ARRAY['individual']), 'symmetric', false, 'auto_reverse', false, 'st_resolves', false)
    WHEN 'trades_as'   THEN jsonb_build_object('sources', to_jsonb(ARRAY['individual']), 'targets', to_jsonb(ARRAY['sole_trader']), 'symmetric', false, 'auto_reverse', true, 'st_resolves', false)
    ELSE NULL
  END
  FROM s
$$;

CREATE OR REPLACE FUNCTION public._rp_trust_like(_cats jsonb)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM jsonb_array_elements_text(_cats) x
    WHERE x IN ('discretionary_trust','unit_trust','hybrid_trust','bare_trust','testamentary_trust','deceased_estate','smsf','generic_trust')
  )
$$;

-- Returns {result: ok|resolve|review|no, reason}
CREATE OR REPLACE FUNCTION public._rp_check_target(_rule jsonb, _tgt text)
RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE
    WHEN (_rule->'targets') ? _tgt THEN '{"result":"ok","reason":"valid"}'::jsonb
    WHEN _tgt = 'unclassified' THEN '{"result":"review","reason":"unclassified_review"}'::jsonb
    WHEN _tgt = 'generic_trust' AND public._rp_trust_like(_rule->'targets') THEN '{"result":"review","reason":"generic_trust_review"}'::jsonb
    ELSE '{"result":"no","reason":"invalid_target"}'::jsonb
  END
$$;

CREATE OR REPLACE FUNCTION public._rp_check_source(_rule jsonb, _src text, _tgt text)
RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  WITH a AS (
    SELECT CASE WHEN _tgt = 'bare_trust' AND _rule ? 'bare_sources' THEN _rule->'bare_sources' ELSE _rule->'sources' END AS allowed
  )
  SELECT CASE
    WHEN allowed ? _src THEN '{"result":"ok","reason":"valid"}'::jsonb
    WHEN _src = 'sole_trader' AND (_rule->>'st_resolves')::boolean THEN '{"result":"resolve","reason":"sole_trader_resolves_to_individual"}'::jsonb
    WHEN _src = 'unclassified' THEN '{"result":"review","reason":"unclassified_review"}'::jsonb
    WHEN _src = 'generic_trust' AND public._rp_trust_like(allowed) THEN '{"result":"review","reason":"generic_trust_review"}'::jsonb
    WHEN _tgt = 'bare_trust' AND _rule ? 'bare_sources' AND (_rule->'sources') ? _src THEN '{"result":"no","reason":"bare_trust_source_restricted"}'::jsonb
    ELSE '{"result":"no","reason":"invalid_source"}'::jsonb
  END FROM a
$$;

CREATE OR REPLACE FUNCTION public._rp_rank(_r text)
RETURNS int LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE _r WHEN 'ok' THEN 0 WHEN 'resolve' THEN 1 WHEN 'review' THEN 2 ELSE 3 END
$$;

CREATE OR REPLACE FUNCTION public._rp_check_pair(_rule jsonb, _from text, _to text)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path = public AS $$
DECLARE t jsonb := public._rp_check_target(_rule, _to);
        s jsonb := public._rp_check_source(_rule, _from, _to);
BEGIN
  IF public._rp_rank(t->>'result') >= public._rp_rank(s->>'result') THEN
    IF t->>'result' = 'ok' THEN RETURN s; END IF;
    RETURN t;
  END IF;
  RETURN s;
END $$;

-- ── Evaluator ───────────────────────────────────────────────────
-- Returns {outcome, reason, canonical_type, swapped, from_type, to_type}.
-- Unknown relationship types are INVALID (default deny).
CREATE OR REPLACE FUNCTION public.relationship_policy_evaluate(
  _type text, _from_type text, _to_type text, _direction_known boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE
SET search_path = public
AS $$
DECLARE
  t text := lower(btrim(coalesce(_type, '')));
  f text := coalesce(_from_type, 'Unclassified');
  g text := coalesce(_to_type, 'Unclassified');
  rule jsonb; fc text; tc text; fwd jsonb; rev jsonb; inner_r jsonb;
BEGIN
  IF t = 'settlor' THEN
    RETURN jsonb_build_object('outcome','deprecated','reason','settlor_deprecated','canonical_type',NULL,'swapped',false,'from_type',f,'to_type',g);
  END IF;

  IF t = 'child' THEN
    inner_r := public.relationship_policy_evaluate('parent', g, f, true);
    IF inner_r->>'outcome' = 'valid' THEN
      RETURN jsonb_build_object('outcome','reverse','reason','child_alias_reversed','canonical_type','parent','swapped',true,'from_type',g,'to_type',f);
    END IF;
    RETURN inner_r || jsonb_build_object('swapped', NOT (inner_r->>'swapped')::boolean);
  END IF;

  rule := public.relationship_policy_rule(t);
  IF rule IS NULL THEN
    RETURN jsonb_build_object('outcome','invalid','reason','unknown_relationship_type','canonical_type',NULL,'swapped',false,'from_type',f,'to_type',g);
  END IF;

  fc := public.relationship_policy_category(f);
  tc := public.relationship_policy_category(g);
  fwd := public._rp_check_pair(rule, fc, tc);
  rev := public._rp_check_pair(rule, tc, fc);

  IF (rule->>'symmetric')::boolean THEN
    RETURN jsonb_build_object(
      'outcome', CASE fwd->>'result' WHEN 'ok' THEN 'valid' WHEN 'review' THEN 'review' ELSE 'invalid' END,
      'reason',  CASE WHEN fwd->>'result' = 'ok' THEN 'symmetric_valid' ELSE fwd->>'reason' END,
      'canonical_type', t, 'swapped', false, 'from_type', f, 'to_type', g);
  END IF;

  IF fwd->>'result' = 'ok' THEN
    IF NOT _direction_known AND rev->>'result' = 'ok' THEN
      RETURN jsonb_build_object('outcome','review','reason','ambiguous_direction','canonical_type',t,'swapped',false,'from_type',f,'to_type',g);
    END IF;
    RETURN jsonb_build_object('outcome','valid','reason','valid','canonical_type',t,'swapped',false,'from_type',f,'to_type',g);
  END IF;
  IF fwd->>'result' = 'resolve' THEN
    RETURN jsonb_build_object('outcome','resolve_sole_trader','reason',fwd->>'reason','canonical_type',t,'swapped',false,'from_type',f,'to_type',g);
  END IF;
  IF fwd->>'result' = 'review' THEN
    RETURN jsonb_build_object('outcome','review','reason',fwd->>'reason','canonical_type',t,'swapped',false,'from_type',f,'to_type',g);
  END IF;

  IF (rule->>'auto_reverse')::boolean AND public._rp_check_target(rule, tc)->>'result' = 'no' THEN
    IF rev->>'result' IN ('ok','resolve','review') THEN
      RETURN jsonb_build_object(
        'outcome', CASE rev->>'result' WHEN 'ok' THEN 'reverse' WHEN 'resolve' THEN 'resolve_sole_trader' ELSE 'review' END,
        'reason',  CASE WHEN rev->>'result' = 'ok' THEN 'auto_reversed' ELSE rev->>'reason' END,
        'canonical_type', t, 'swapped', true, 'from_type', g, 'to_type', f);
    END IF;
  END IF;

  RETURN jsonb_build_object('outcome','invalid','reason',fwd->>'reason','canonical_type',t,'swapped',false,'from_type',f,'to_type',g);
END $$;

GRANT EXECUTE ON FUNCTION public.relationship_policy_evaluate(text, text, text, boolean) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.relationship_policy_category(text) TO authenticated, service_role;

-- ── XPM import evidence / review queue ──────────────────────────
-- One row per raw relationship seen during an import or sync, with what the
-- policy decided. Lets Phase 2 keep "review" cases instead of dropping them.
CREATE TABLE public.relationship_import_evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  import_source text NOT NULL,              -- 'xpm_sync' | 'xpm_group' | 'xpm_csv' | 'manual' ...
  import_run_id uuid,                       -- sync job / import_logs id
  raw_relationship_label text NOT NULL,
  raw_from_identifier text,
  raw_from_name text,
  raw_to_identifier text,
  raw_to_name text,
  raw_payload jsonb,
  proposed_from_entity_id uuid REFERENCES public.entities(id) ON DELETE SET NULL,
  proposed_to_entity_id uuid REFERENCES public.entities(id) ON DELETE SET NULL,
  canonical_type text,
  canonical_from_entity_id uuid REFERENCES public.entities(id) ON DELETE SET NULL,
  canonical_to_entity_id uuid REFERENCES public.entities(id) ON DELETE SET NULL,
  policy_outcome text NOT NULL,
  policy_reason text NOT NULL,
  review_status text NOT NULL DEFAULT 'pending',
  reviewed_by uuid,
  reviewed_at timestamptz,
  relationship_id uuid REFERENCES public.relationships(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT rie_outcome_chk CHECK (policy_outcome IN ('valid','reverse','resolve_sole_trader','review','invalid','deprecated')),
  CONSTRAINT rie_review_status_chk CHECK (review_status IN ('pending','not_required','accepted','rejected','superseded'))
);

GRANT SELECT, UPDATE ON public.relationship_import_evidence TO authenticated;
GRANT ALL ON public.relationship_import_evidence TO service_role;

ALTER TABLE public.relationship_import_evidence ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant members can view import evidence"
  ON public.relationship_import_evidence FOR SELECT TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()) OR public.is_super_admin());

CREATE POLICY "Tenant owners/admins can review import evidence"
  ON public.relationship_import_evidence FOR UPDATE TO authenticated
  USING (public.is_owner_or_admin(tenant_id))
  WITH CHECK (public.is_owner_or_admin(tenant_id));
-- Inserts come only from import/sync functions using the service role.

CREATE INDEX rie_tenant_status_idx ON public.relationship_import_evidence (tenant_id, review_status);
CREATE INDEX rie_run_idx ON public.relationship_import_evidence (import_run_id);
CREATE INDEX rie_relationship_idx ON public.relationship_import_evidence (relationship_id);

CREATE TRIGGER update_relationship_import_evidence_updated_at
  BEFORE UPDATE ON public.relationship_import_evidence
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
