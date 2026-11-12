-- XPM batch import and sync judge XPM facts with the XPM-import rules
-- (general "Trust" targets accepted for trustee / beneficiary / appointor /
-- unit holder). The only change to each function body is the one call
-- relationship_policy_evaluate( -> relationship_policy_evaluate_xpm( ; the
-- block refuses to run unless exactly one call is found in each.
DO $mig$
DECLARE
  _fn text;
  _def text;
  _new text;
BEGIN
  FOREACH _fn IN ARRAY ARRAY['import_xpm_batch', 'sync_xpm_upsert_clients'] LOOP
    _def := pg_get_functiondef(('public.' || _fn)::regproc);
    IF (length(_def) - length(replace(_def, 'public.relationship_policy_evaluate(', ''))) / length('public.relationship_policy_evaluate(') <> 1 THEN
      RAISE EXCEPTION '%: expected exactly one relationship_policy_evaluate call', _fn;
    END IF;
    _new := replace(_def, 'public.relationship_policy_evaluate(', 'public.relationship_policy_evaluate_xpm(');
    EXECUTE _new;
  END LOOP;
END
$mig$;
