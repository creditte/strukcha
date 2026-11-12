-- General "Trust" (kind unknown) relationship imports from XPM.
-- Mirrors supabase/functions/_shared/relationship-policy.ts (xpmImport option,
-- XPM_GENERIC_TRUST_TYPES). Trust kinds are never inferred or changed.

CREATE OR REPLACE FUNCTION public._rp_check_pair_x(_rule jsonb, _type text, _from text, _to text, _xpm_import boolean)
 RETURNS jsonb
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  SELECT CASE
    WHEN _xpm_import AND _to = 'generic_trust' AND _type IN ('trustee','beneficiary','appointer','unit_holder')
      THEN public._rp_check_source(_rule, _from, _to)
    ELSE public._rp_check_pair(_rule, _from, _to)
  END
$function$;

CREATE OR REPLACE FUNCTION public.relationship_policy_evaluate_core(_type text, _from_type text, _to_type text, _direction_known boolean, _xpm_import boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
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
    inner_r := public.relationship_policy_evaluate_core('parent', g, f, true, _xpm_import);
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
  fwd := public._rp_check_pair_x(rule, t, fc, tc, _xpm_import);
  rev := public._rp_check_pair_x(rule, t, tc, fc, _xpm_import);

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
END $function$;

CREATE OR REPLACE FUNCTION public.relationship_policy_evaluate(_type text, _from_type text, _to_type text, _direction_known boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  SELECT public.relationship_policy_evaluate_core(_type, _from_type, _to_type, _direction_known, false)
$function$;

CREATE OR REPLACE FUNCTION public.relationship_policy_evaluate_xpm(_type text, _from_type text, _to_type text, _direction_known boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  SELECT public.relationship_policy_evaluate_core(_type, _from_type, _to_type, _direction_known, true)
$function$;

REVOKE ALL ON FUNCTION public._rp_check_pair_x(jsonb, text, text, text, boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.relationship_policy_evaluate_core(text, text, text, boolean, boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.relationship_policy_evaluate_xpm(text, text, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._rp_check_pair_x(jsonb, text, text, text, boolean) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.relationship_policy_evaluate_core(text, text, text, boolean, boolean) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.relationship_policy_evaluate_xpm(text, text, text, boolean) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.validate_relationship_rules()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

  -- XPM-import rules apply only to imported rows written by the backend
  -- (service role: import/sync functions). Signed-in users always get the
  -- strict rules, even when editing an imported row.
  _r := public.relationship_policy_evaluate_core(NEW.relationship_type::text, _from_type, _to_type, true,
          NEW.source::text = 'imported' AND coalesce(auth.role(), '') = 'service_role');
  IF _r->>'outcome' <> 'valid' THEN
    RAISE EXCEPTION 'Relationship not canonical: % (%). A % link from % to % is not stored as-is.',
      _r->>'outcome', _r->>'reason', NEW.relationship_type, coalesce(_from_type, 'unknown'), coalesce(_to_type, 'unknown')
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$function$;
