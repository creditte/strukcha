-- Security hardening (approved 23/10/2026, items A-D of docs/data-api-security-review.md).
-- No data changes. RLS policies unchanged.

-- ── A. Backend-only: merge + email queue ─────────────────────────
REVOKE EXECUTE ON FUNCTION public.merge_duplicate_xpm_entities(uuid, integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.read_email_batch(text, integer, integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.enqueue_email(text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.delete_email(text, bigint) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.move_to_dlq(text, text, bigint, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.email_queue_dispatch() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.merge_duplicate_xpm_entities(uuid, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.read_email_batch(text, integer, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.enqueue_email(text, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.delete_email(text, bigint) TO service_role;
GRANT EXECUTE ON FUNCTION public.move_to_dlq(text, text, bigint, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.email_queue_dispatch() TO service_role;

-- ── B. Duplicate finders: caller's own firm only ─────────────────
CREATE OR REPLACE FUNCTION public.find_duplicate_entities(_tenant_id uuid)
 RETURNS TABLE(entity_id_a uuid, name_a text, type_a text, entity_id_b uuid, name_b text, type_b text, normalized_name text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role'
     AND (auth.uid() IS NULL OR _tenant_id IS DISTINCT FROM public.get_user_tenant_id(auth.uid())) THEN
    RAISE EXCEPTION 'Not allowed to read duplicates for this firm' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  WITH normalized AS (
    SELECT
      e.id,
      e.name,
      e.entity_type::text as etype,
      lower(regexp_replace(
        regexp_replace(
          regexp_replace(e.name, '\s+(pty|ltd|limited|proprietary|inc|incorporated|llc|trust|pty ltd|as trustee for)\s*', ' ', 'gi'),
          '[^a-zA-Z0-9\s]', '', 'g'
        ),
        '\s+', ' ', 'g'
      )) as norm_name
    FROM public.entities e
    WHERE e.tenant_id = _tenant_id
      AND e.deleted_at IS NULL
  )
  SELECT a.id, a.name, a.etype, b.id, b.name, b.etype, a.norm_name
  FROM normalized a
  JOIN normalized b ON a.norm_name = b.norm_name AND a.id < b.id
  ORDER BY a.norm_name, a.id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.find_fuzzy_duplicate_entities(_tenant_id uuid, _threshold double precision DEFAULT 0.85)
 RETURNS TABLE(entity_id_a uuid, name_a text, type_a text, entity_id_b uuid, name_b text, type_b text, similarity double precision)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role'
     AND (auth.uid() IS NULL OR _tenant_id IS DISTINCT FROM public.get_user_tenant_id(auth.uid())) THEN
    RAISE EXCEPTION 'Not allowed to read duplicates for this firm' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  WITH normalized AS (
    SELECT
      e.id,
      e.name,
      e.entity_type::text as etype,
      lower(regexp_replace(
        regexp_replace(
          regexp_replace(e.name, '\s+(pty|ltd|limited|proprietary|inc|incorporated|llc|trust|pty ltd|as trustee for)\s*', ' ', 'gi'),
          '[^a-zA-Z0-9\s]', '', 'g'
        ),
        '\s+', ' ', 'g'
      )) as norm_name
    FROM public.entities e
    WHERE e.tenant_id = _tenant_id
      AND e.deleted_at IS NULL
  ), scored AS (
    SELECT a.id AS ia, a.name AS na, a.etype AS ta, b.id AS ib, b.name AS nb, b.etype AS tb, a.norm_name AS norm,
      (1.0 - (extensions.levenshtein(left(a.norm_name, 255), left(b.norm_name, 255))::float
        / GREATEST(length(left(a.norm_name, 255)), length(left(b.norm_name, 255)), 1)))::float AS sim
    FROM normalized a
    JOIN normalized b ON a.id < b.id AND a.etype = b.etype
  )
  SELECT ia, na, ta, ib, nb, tb, sim
  FROM scored
  WHERE sim >= _threshold
  ORDER BY sim DESC, norm, ia;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.find_duplicate_entities(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.find_fuzzy_duplicate_entities(uuid, double precision) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.find_duplicate_entities(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.find_fuzzy_duplicate_entities(uuid, double precision) TO authenticated, service_role;

-- ── C. No signed-out execution of any SECURITY DEFINER function ──
-- Signed-in access is kept exactly where it exists today (re-granted
-- explicitly so removing PUBLIC does not take it away). Trigger functions
-- are left for item E.
DO $$
DECLARE f record; had_auth boolean;
BEGIN
  FOR f IN
    SELECT p.oid, p.oid::regprocedure AS sig
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prosecdef AND p.prorettype <> 'trigger'::regtype
  LOOP
    had_auth := has_function_privilege('authenticated', f.oid, 'EXECUTE');
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon', f.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', f.sig);
    IF had_auth THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', f.sig);
    END IF;
  END LOOP;
END $$;

-- ── D. No signed-out table access ────────────────────────────────
-- No RLS policy admits anon and no signed-out page reads tables directly.
DO $$
DECLARE t record;
BEGIN
  FOR t IN SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
           WHERE n.nspname = 'public' AND c.relkind IN ('r','v','m','p')
  LOOP
    EXECUTE format('REVOKE ALL ON public.%I FROM anon', t.relname);
  END LOOP;
END $$;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon;

-- Future tables/sequences created by this role no longer auto-grant anon.
DO $$ BEGIN
  ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon;
EXCEPTION WHEN insufficient_privilege THEN NULL;
END $$;