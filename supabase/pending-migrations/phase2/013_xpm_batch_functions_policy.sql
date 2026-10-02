-- Rulebook v1 · PHASE 2 · NOT APPLIED. Requires phase1/001, phase1/002 and phase2/011.
-- Replacements for the live XPM batch functions. Generated from the applied
-- definitions in supabase/migrations/20260909202705_… (import_xpm_batch) and
-- 20260917103909_… (sync_xpm_upsert_clients); only the relationship section
-- changes. Entity, structure, capacity and archived handling are untouched.
-- No existing row is updated by this file itself.

CREATE OR REPLACE FUNCTION public.import_xpm_batch(_tenant_id uuid, _payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  _cap jsonb;
  _limit int;
  _used int := 0;
  _capacity bigint := 0;
  _enforce boolean := false;
  _access boolean := true;
  _limit_code text := NULL;
  _ent_created int := 0;
  _ent_updated int := 0;
  _struct_created int := 0;
  _struct_skipped int := 0;
  _rel_created int := 0;
  _rel_skipped int := 0;
  _warnings jsonb := '[]'::jsonb;
  _sid uuid;
  _rid uuid;
  rec record;
BEGIN
  CREATE TEMP TABLE _w (
    name text PRIMARY KEY,
    uuid text,
    entity_type text,
    entity_id uuid
  ) ON COMMIT DROP;

  INSERT INTO _w (name, uuid, entity_type)
  SELECT x.name, nullif(x.uuid, ''), coalesce(nullif(x.entity_type, ''), 'Unclassified')
  FROM jsonb_to_recordset(coalesce(_payload->'entities', '[]'::jsonb))
       AS x(name text, uuid text, entity_type text)
  WHERE coalesce(x.name, '') <> ''
  ON CONFLICT (name) DO NOTHING;

  UPDATE _w w SET entity_id = e.id
  FROM public.entities e
  WHERE e.tenant_id = _tenant_id AND e.deleted_at IS NULL
    AND w.uuid IS NOT NULL AND e.xpm_uuid = w.uuid;

  UPDATE _w w SET entity_id = e.id
  FROM (
    SELECT DISTINCT ON (name) id, name
    FROM public.entities
    WHERE tenant_id = _tenant_id AND deleted_at IS NULL
    ORDER BY name, created_at
  ) e
  WHERE w.entity_id IS NULL AND e.name = w.name;

  WITH upd AS (
    UPDATE public.entities e
    SET entity_type = CASE
          WHEN w.entity_type <> 'Unclassified' AND e.entity_type::text = 'Unclassified'
          THEN w.entity_type::entity_type ELSE e.entity_type END,
        xpm_uuid = coalesce(e.xpm_uuid, w.uuid),
        source = 'imported'
    FROM _w w
    WHERE w.entity_id = e.id
      AND (
        (w.entity_type <> 'Unclassified' AND e.entity_type::text = 'Unclassified')
        OR (w.uuid IS NOT NULL AND e.xpm_uuid IS NULL)
      )
    RETURNING 1
  )
  SELECT count(*) INTO _ent_updated FROM upd;

  SELECT count(*) INTO _ent_created FROM _w WHERE entity_id IS NULL;

  WITH ins AS (
    INSERT INTO public.entities (tenant_id, name, xpm_uuid, entity_type, source)
    SELECT _tenant_id, w.name, w.uuid, w.entity_type::entity_type, 'imported'
    FROM _w w WHERE w.entity_id IS NULL
    RETURNING id, name
  )
  UPDATE _w w SET entity_id = ins.id FROM ins WHERE ins.name = w.name;

  CREATE TEMP TABLE _g (name text PRIMARY KEY, structure_id uuid) ON COMMIT DROP;

  INSERT INTO _g (name)
  SELECT DISTINCT g FROM jsonb_array_elements_text(coalesce(_payload->'groups', '[]'::jsonb)) AS g
  WHERE coalesce(g, '') <> ''
  ON CONFLICT (name) DO NOTHING;

  UPDATE _g g SET structure_id = s.id
  FROM (
    SELECT DISTINCT ON (name) id, name
    FROM public.structures
    WHERE tenant_id = _tenant_id AND deleted_at IS NULL
    ORDER BY name, created_at
  ) s
  WHERE s.name = g.name;

  -- One shared capacity rule for every write path (same helper the XPM sync uses).
  _cap := public.tenant_structure_capacity(_tenant_id);
  _enforce := coalesce((_cap->>'enforced')::boolean, false);
  _access := coalesce((_cap->>'accessEnabled')::boolean, false);
  _limit := (_cap->>'limit')::int;
  _used := coalesce((_cap->>'used')::int, 0);

  IF _enforce AND NOT _access THEN
    _capacity := 0;
    _limit_code := 'subscription_inactive';
  ELSIF (_cap->>'remaining') IS NULL THEN
    _capacity := 1000000;
  ELSE
    _capacity := (_cap->>'remaining')::int;
  END IF;

  FOR rec IN SELECT name FROM _g WHERE structure_id IS NULL ORDER BY name LOOP
    IF _capacity <= 0 THEN
      _struct_skipped := _struct_skipped + 1;
      IF _limit_code IS NULL THEN _limit_code := 'structure_limit_reached'; END IF;
      CONTINUE;
    END IF;
    BEGIN
      INSERT INTO public.structures (tenant_id, name) VALUES (_tenant_id, rec.name) RETURNING id INTO _sid;
      UPDATE _g SET structure_id = _sid WHERE name = rec.name;
      _struct_created := _struct_created + 1;
      _capacity := _capacity - 1;
    EXCEPTION WHEN OTHERS THEN
      IF SQLERRM ILIKE '%Subscription inactive%' THEN
        _capacity := 0;
        _struct_skipped := _struct_skipped + 1;
        _limit_code := 'subscription_inactive';
      ELSIF SQLERRM ILIKE '%limit reached%' OR SQLERRM ILIKE '%maximum of%active structures%' THEN
        _capacity := 0;
        _struct_skipped := _struct_skipped + 1;
        IF _limit_code IS NULL THEN _limit_code := 'structure_limit_reached'; END IF;
      ELSE
        _warnings := _warnings || to_jsonb(format('Failed to create structure "%s": %s', rec.name, SQLERRM));
      END IF;
    END;
  END LOOP;

  INSERT INTO public.structure_entities (structure_id, entity_id)
  SELECT DISTINCT g.structure_id, w.entity_id
  FROM jsonb_to_recordset(coalesce(_payload->'members', '[]'::jsonb)) AS m(grp text, ent text)
  JOIN _g g ON g.name = m.grp AND g.structure_id IS NOT NULL
  JOIN _w w ON w.name = m.ent AND w.entity_id IS NOT NULL
  ON CONFLICT DO NOTHING;

  CREATE TEMP TABLE _r (
    rownum int,
    rtype text,
    from_key text,
    to_key text,
    from_id uuid,
    to_id uuid,
    label text,
    groups jsonb,
    rel_id uuid,
    raw_type text,
    raw_from_id uuid,
    raw_to_id uuid,
    from_type text,
    to_type text,
    outcome text,
    reason text
  ) ON COMMIT DROP;

  INSERT INTO _r (rownum, rtype, from_key, to_key, label, groups)
  SELECT x.row, x.type, x.from_key, x.to_key, x.label, coalesce(x.groups, '[]'::jsonb)
  FROM jsonb_to_recordset(coalesce(_payload->'rels', '[]'::jsonb))
       AS x(row int, type text, from_key text, to_key text, label text, groups jsonb);

  UPDATE _r SET from_id = w.entity_id FROM _w w WHERE w.name = _r.from_key;
  UPDATE _r SET to_id = w.entity_id FROM _w w WHERE w.name = _r.to_key;

  -- ── Rulebook v1: canonical policy decides every row (Phase 2) ──
  UPDATE _r SET raw_type = rtype, raw_from_id = from_id, raw_to_id = to_id;
  UPDATE _r SET from_type = e.entity_type::text FROM public.entities e WHERE e.id = _r.from_id;
  UPDATE _r SET to_type = e.entity_type::text FROM public.entities e WHERE e.id = _r.to_id;

  -- CSV rows don't establish orientation authoritatively → direction unknown.
  -- reverse swaps exactly once; child → parent with endpoints reversed.
  WITH ev AS (
    SELECT ctid AS c,
           public.relationship_policy_evaluate(rtype, from_type, to_type,
             rtype IN ('spouse','parent','child')) AS r
    FROM _r WHERE from_id IS NOT NULL AND to_id IS NOT NULL
  )
  UPDATE _r SET
    rtype   = coalesce(ev.r->>'canonical_type', _r.rtype),
    from_id = CASE WHEN (ev.r->>'swapped')::boolean AND ev.r->>'outcome' = 'reverse' THEN _r.to_id ELSE _r.from_id END,
    to_id   = CASE WHEN (ev.r->>'swapped')::boolean AND ev.r->>'outcome' = 'reverse' THEN _r.from_id ELSE _r.to_id END,
    outcome = ev.r->>'outcome',
    reason  = ev.r->>'reason'
  FROM ev WHERE _r.ctid = ev.c;

  -- Spouse only is unordered. Partner and every other type keep direction.
  UPDATE _r SET from_id = to_id, to_id = from_id
  WHERE rtype = 'spouse' AND outcome = 'valid' AND from_id > to_id;

  UPDATE _r SET rel_id = e.id
  FROM public.relationships e
  WHERE _r.outcome IN ('valid','reverse')
    AND e.tenant_id = _tenant_id AND e.deleted_at IS NULL
    AND e.relationship_type::text = _r.rtype
    AND ((e.from_entity_id = _r.from_id AND e.to_entity_id = _r.to_id)
      OR (_r.rtype = 'spouse' AND e.from_entity_id = _r.to_id AND e.to_entity_id = _r.from_id));

  BEGIN
    WITH todo AS (
      SELECT DISTINCT from_id, to_id, rtype
      FROM _r
      WHERE rel_id IS NULL AND from_id IS NOT NULL AND to_id IS NOT NULL
        AND outcome IN ('valid','reverse')
    ), ins AS (
      INSERT INTO public.relationships
        (tenant_id, from_entity_id, to_entity_id, relationship_type, source, confidence)
      SELECT _tenant_id, t.from_id, t.to_id, t.rtype::relationship_type, 'imported', 'imported'
      FROM todo t
      RETURNING id
    )
    SELECT count(*) INTO _rel_created FROM ins;

    UPDATE _r SET rel_id = e.id
    FROM public.relationships e
    WHERE _r.rel_id IS NULL AND e.tenant_id = _tenant_id
      AND e.from_entity_id = _r.from_id AND e.to_entity_id = _r.to_id
      AND e.relationship_type::text = _r.rtype;
  EXCEPTION WHEN OTHERS THEN
    _rel_created := 0;
    FOR rec IN
      SELECT DISTINCT ON (from_id, to_id, rtype) rownum, from_id, to_id, rtype, label
      FROM _r
      WHERE rel_id IS NULL AND from_id IS NOT NULL AND to_id IS NOT NULL
        AND outcome IN ('valid','reverse')
    LOOP
      BEGIN
        INSERT INTO public.relationships
          (tenant_id, from_entity_id, to_entity_id, relationship_type, source, confidence)
        VALUES (_tenant_id, rec.from_id, rec.to_id, rec.rtype::relationship_type, 'imported', 'imported')
        RETURNING id INTO _rid;
        UPDATE _r SET rel_id = _rid
        WHERE from_id = rec.from_id AND to_id = rec.to_id AND rtype = rec.rtype;
        _rel_created := _rel_created + 1;
      EXCEPTION WHEN OTHERS THEN
        _rel_skipped := _rel_skipped + 1;
        IF jsonb_array_length(_warnings) < 200 THEN
          _warnings := _warnings || to_jsonb(format(
            'Row %s: Failed to create relationship %s: %s', rec.rownum, coalesce(rec.label, ''), SQLERRM));
        END IF;
      END;
    END LOOP;
  END;

  -- Non-canonical rows are counted, never inserted.
  SELECT _rel_skipped + count(*) INTO _rel_skipped
  FROM _r WHERE from_id IS NOT NULL AND to_id IS NOT NULL AND outcome NOT IN ('valid','reverse');

  -- Durable evidence: one row per raw CSV relationship.
  INSERT INTO public.relationship_import_evidence (
      tenant_id, import_source, import_run_id, raw_relationship_label,
      raw_from_identifier, raw_from_name, raw_to_identifier, raw_to_name, raw_payload,
      raw_from_entity_type, raw_to_entity_type, direction_known, entity_type_provisional,
      proposed_from_entity_id, proposed_to_entity_id, canonical_type,
      canonical_from_entity_id, canonical_to_entity_id, policy_outcome, policy_reason,
      review_status, resolved_via_trades_as, relationship_id
  )
  SELECT _tenant_id, 'xpm_csv', nullif(_payload->>'import_run_id', '')::uuid, coalesce(r.label, r.raw_type, ''),
         r.from_key, r.from_key, r.to_key, r.to_key, jsonb_build_object('row', r.rownum, 'type', r.raw_type),
         r.from_type, r.to_type, r.raw_type IN ('spouse','parent','child'), false,
         r.raw_from_id, r.raw_to_id,
         CASE WHEN r.outcome IN ('valid','reverse','resolve_sole_trader','review') THEN r.rtype END,
         CASE WHEN r.outcome IN ('valid','reverse') THEN r.from_id END,
         CASE WHEN r.outcome IN ('valid','reverse') THEN r.to_id END,
         coalesce(r.outcome, 'review'), coalesce(r.reason, 'unclassified_review'),
         CASE WHEN r.outcome IN ('valid','reverse') THEN 'not_required'
              WHEN r.outcome IN ('invalid','deprecated') THEN 'rejected'
              ELSE 'pending' END,
         false, r.rel_id
  FROM _r r;

  INSERT INTO public.structure_relationships (structure_id, relationship_id)
  SELECT DISTINCT g.structure_id, rr.rel_id
  FROM _r rr
  CROSS JOIN LATERAL jsonb_array_elements_text(rr.groups) AS gn(name)
  JOIN _g g ON g.name = gn.name AND g.structure_id IS NOT NULL
  WHERE rr.rel_id IS NOT NULL
  ON CONFLICT DO NOTHING;

  UPDATE public.entities e SET is_trustee_company = true
  WHERE e.tenant_id = _tenant_id
    AND e.entity_type::text = 'Company'
    AND e.is_trustee_company = false
    AND e.id IN (SELECT from_id FROM _r WHERE rtype = 'trustee' AND from_id IS NOT NULL);

  RETURN jsonb_build_object(
    'entitiesCreated', _ent_created,
    'entitiesUpdated', _ent_updated,
    'structuresCreated', _struct_created,
    'structuresSkippedLimit', _struct_skipped,
    'structureLimit', _limit,
    'limitReached', _limit_code IS NOT NULL,
    'limitCode', _limit_code,
    'relationshipsCreated', _rel_created,
    'relationshipsSkipped', _rel_skipped,
    'warnings', _warnings,
    'unavailableGroups', coalesce(
      (SELECT jsonb_agg(name) FROM _g WHERE structure_id IS NULL), '[]'::jsonb),
    'unresolvedRels', coalesce(
      (SELECT jsonb_agg(jsonb_build_object('row', rownum, 'label', label))
       FROM _r WHERE from_id IS NULL OR to_id IS NULL), '[]'::jsonb)
  );
END;
$fn$;

REVOKE ALL ON FUNCTION public.import_xpm_batch(uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.import_xpm_batch(uuid, jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.sync_xpm_upsert_clients(_tenant_id uuid, _payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  _ent_created int := 0;
  _ent_updated int := 0;
  _rel_created int := 0;
  _rel_skipped int := 0;
  _rel_flipped int := 0;
  _warnings jsonb := '[]'::jsonb;
BEGIN
  CREATE TEMP TABLE _c (
    uuid text PRIMARY KEY,
    name text,
    entity_type text,
    abn text,
    acn text,
    is_trustee boolean DEFAULT false,
    is_archived boolean,
    entity_id uuid
  ) ON COMMIT DROP;

  INSERT INTO _c (uuid, name, entity_type, abn, acn, is_trustee, is_archived)
  SELECT x.uuid, x.name, coalesce(nullif(x.entity_type, ''), 'Unclassified'),
         nullif(x.abn, ''), nullif(x.acn, ''), coalesce(x.is_trustee, false),
         x.is_archived
  FROM jsonb_to_recordset(coalesce(_payload->'clients', '[]'::jsonb))
       AS x(uuid text, name text, entity_type text, abn text, acn text,
            is_trustee boolean, is_archived boolean)
  WHERE coalesce(x.uuid, '') <> '' AND coalesce(x.name, '') <> ''
  ON CONFLICT (uuid) DO NOTHING;

  -- Related parties are name-only mentions; the caller supplies a type inferred
  -- from the name so such records can be classified instead of staying unknown.
  INSERT INTO _c (uuid, name, entity_type)
  SELECT x.uuid, x.name, coalesce(nullif(x.entity_type, ''), 'Unclassified')
  FROM jsonb_to_recordset(coalesce(_payload->'related', '[]'::jsonb))
       AS x(uuid text, name text, entity_type text)
  WHERE coalesce(x.uuid, '') <> '' AND coalesce(x.name, '') <> ''
  ON CONFLICT (uuid) DO NOTHING;

  -- Match on the stable XPM UUID only. The previous name fallback silently
  -- merged distinct clients that happened to share a name.
  UPDATE _c c SET entity_id = e.id
  FROM public.entities e
  WHERE e.tenant_id = _tenant_id AND e.deleted_at IS NULL AND e.xpm_uuid = c.uuid;

  WITH upd AS (
    UPDATE public.entities e
    SET entity_type = CASE
          WHEN c.entity_type <> 'Unclassified' AND e.entity_type::text = 'Unclassified'
          THEN c.entity_type::entity_type ELSE e.entity_type END,
        xpm_uuid = coalesce(e.xpm_uuid, c.uuid),
        abn = coalesce(e.abn, c.abn),
        acn = coalesce(e.acn, c.acn),
        is_trustee_company = e.is_trustee_company OR c.is_trustee,
        is_archived = coalesce(c.is_archived, e.is_archived),
        source = 'imported'
    FROM _c c
    WHERE c.entity_id = e.id
      AND (
        (c.entity_type <> 'Unclassified' AND e.entity_type::text = 'Unclassified')
        OR e.xpm_uuid IS NULL
        OR (c.abn IS NOT NULL AND e.abn IS NULL)
        OR (c.acn IS NOT NULL AND e.acn IS NULL)
        OR (c.is_trustee AND NOT e.is_trustee_company)
        OR (c.is_archived IS NOT NULL AND c.is_archived <> e.is_archived)
      )
    RETURNING 1
  )
  SELECT count(*) INTO _ent_updated FROM upd;

  SELECT count(*) INTO _ent_created FROM _c WHERE entity_id IS NULL;

  WITH ins AS (
    INSERT INTO public.entities
      (tenant_id, name, xpm_uuid, entity_type, abn, acn, is_trustee_company, is_archived, source)
    SELECT _tenant_id, c.name, c.uuid, c.entity_type::entity_type, c.abn, c.acn, c.is_trustee,
           coalesce(c.is_archived, false), 'imported'
    FROM _c c WHERE c.entity_id IS NULL
    ON CONFLICT (tenant_id, xpm_uuid) WHERE xpm_uuid IS NOT NULL AND deleted_at IS NULL
      DO UPDATE SET name = excluded.name
    RETURNING id, xpm_uuid
  )
  UPDATE _c c SET entity_id = ins.id FROM ins WHERE ins.xpm_uuid = c.uuid;

  CREATE TEMP TABLE _sr (
    rtype text,
    from_uuid text,
    to_uuid text,
    from_id uuid,
    to_id uuid,
    from_type text,
    to_type text,
    start_date date,
    end_date date,
    outcome text,
    reason text
  ) ON COMMIT DROP;

  INSERT INTO _sr (rtype, from_uuid, to_uuid, start_date, end_date)
  SELECT x.type, x.from_uuid, x.to_uuid,
         CASE WHEN x.start_date ~ '^\d{4}-\d{2}-\d{2}' THEN left(x.start_date, 10)::date END,
         CASE WHEN x.end_date ~ '^\d{4}-\d{2}-\d{2}' THEN left(x.end_date, 10)::date END
  FROM jsonb_to_recordset(coalesce(_payload->'rels', '[]'::jsonb))
       AS x(type text, from_uuid text, to_uuid text, start_date text, end_date text)
  WHERE coalesce(x.type, '') <> '';

  UPDATE _sr s SET from_id = c.entity_id FROM _c c WHERE c.uuid = s.from_uuid;
  UPDATE _sr s SET to_id = c.entity_id FROM _c c WHERE c.uuid = s.to_uuid;

  SELECT count(*) INTO _rel_skipped FROM _sr WHERE from_id IS NULL OR to_id IS NULL;
  DELETE FROM _sr WHERE from_id IS NULL OR to_id IS NULL;

  UPDATE _sr s SET from_type = e.entity_type::text FROM public.entities e WHERE e.id = s.from_id;
  UPDATE _sr s SET to_type = e.entity_type::text FROM public.entities e WHERE e.id = s.to_id;

  -- ── Rulebook v1 (Phase 2) ──
  -- The Edge Function has already normalised every raw XPM fact with the
  -- canonical TypeScript policy and only sends canonical rows. Re-check here
  -- with the SQL twin so the database never relies on the caller.
  WITH ev AS (
    SELECT ctid AS c, public.relationship_policy_evaluate(rtype, from_type, to_type, true) AS r FROM _sr
  )
  UPDATE _sr SET outcome = ev.r->>'outcome', reason = ev.r->>'reason' FROM ev WHERE _sr.ctid = ev.c;

  -- Spouse only is unordered. Partner keeps direction.
  UPDATE _sr SET from_id = to_id, to_id = from_id
  WHERE rtype = 'spouse' AND from_id > to_id;

  WITH invalid AS (
    DELETE FROM _sr s WHERE s.outcome IS DISTINCT FROM 'valid'
    RETURNING s.rtype
  )
  SELECT _rel_skipped + count(*),
         _warnings || coalesce(
           jsonb_agg(DISTINCT format('%s: %s link(s) were not canonical and were kept for review', rtype, cnt)),
           '[]'::jsonb)
    INTO _rel_skipped, _warnings
  FROM (SELECT rtype, count(*) AS cnt FROM invalid GROUP BY rtype) g;

  -- Existing spouse facts may be stored in either order.
  DELETE FROM _sr s
  USING public.relationships e
  WHERE s.rtype = 'spouse' AND e.tenant_id = _tenant_id AND e.deleted_at IS NULL
    AND e.relationship_type::text = 'spouse'
    AND e.from_entity_id = s.to_id AND e.to_entity_id = s.from_id;

  UPDATE public.relationships e
  SET start_date = coalesce(e.start_date, s.start_date),
      end_date = coalesce(e.end_date, s.end_date),
      updated_at = now()
  FROM _sr s
  WHERE e.tenant_id = _tenant_id AND e.deleted_at IS NULL
    AND e.from_entity_id = s.from_id AND e.to_entity_id = s.to_id
    AND e.relationship_type::text = s.rtype
    AND (s.start_date IS NOT NULL OR s.end_date IS NOT NULL)
    AND (e.start_date IS NULL OR e.end_date IS NULL);

  DELETE FROM _sr s
  USING public.relationships e
  WHERE e.tenant_id = _tenant_id AND e.deleted_at IS NULL
    AND e.from_entity_id = s.from_id AND e.to_entity_id = s.to_id
    AND e.relationship_type::text = s.rtype;

  WITH todo AS (
    SELECT DISTINCT ON (from_id, to_id, rtype) from_id, to_id, rtype, start_date, end_date
    FROM _sr ORDER BY from_id, to_id, rtype, start_date NULLS LAST
  ), ins AS (
    INSERT INTO public.relationships
      (tenant_id, from_entity_id, to_entity_id, relationship_type, start_date, end_date, source, confidence)
    SELECT _tenant_id, t.from_id, t.to_id, t.rtype::relationship_type, t.start_date, t.end_date,
           'imported', 'imported'
    FROM todo t
    ON CONFLICT DO NOTHING
    RETURNING id
  )
  SELECT count(*) INTO _rel_created FROM ins;

  -- Durable evidence drafts from the Edge Function (one per raw XPM fact).
  -- Identifiers are XPM UUIDs; resolve to entity ids through _c.
  INSERT INTO public.relationship_import_evidence (
      tenant_id, import_source, import_run_id, raw_relationship_label,
      raw_from_identifier, raw_from_name, raw_to_identifier, raw_to_name, raw_payload,
      raw_from_entity_type, raw_to_entity_type, direction_known, entity_type_provisional,
      proposed_from_entity_id, proposed_to_entity_id, canonical_type,
      canonical_from_entity_id, canonical_to_entity_id, policy_outcome, policy_reason,
      review_status, resolved_via_trades_as, relationship_id
  )
  SELECT _tenant_id, coalesce(_payload->>'import_source', 'xpm_sync'), nullif(_payload->>'import_run_id', '')::uuid,
         x.raw_relationship_label, x.raw_from_identifier, x.raw_from_name, x.raw_to_identifier, x.raw_to_name, x.raw_payload,
         x.raw_from_entity_type, x.raw_to_entity_type, coalesce(x.direction_known, false), coalesce(x.entity_type_provisional, false),
         pf.entity_id, pt.entity_id, x.canonical_type, cf.entity_id, ct.entity_id,
         x.policy_outcome, x.policy_reason, coalesce(x.review_status, 'pending'), coalesce(x.resolved_via_trades_as, false),
         rel.id
  FROM jsonb_to_recordset(coalesce(_payload->'evidence', '[]'::jsonb)) AS x(
         raw_relationship_label text, raw_from_identifier text, raw_from_name text, raw_to_identifier text,
         raw_to_name text, raw_payload jsonb, raw_from_entity_type text, raw_to_entity_type text,
         direction_known boolean, entity_type_provisional boolean, proposed_from_entity_id text,
         proposed_to_entity_id text, canonical_type text, canonical_from_entity_id text,
         canonical_to_entity_id text, policy_outcome text, policy_reason text, review_status text,
         resolved_via_trades_as boolean)
  LEFT JOIN _c pf ON pf.uuid = x.proposed_from_entity_id
  LEFT JOIN _c pt ON pt.uuid = x.proposed_to_entity_id
  LEFT JOIN _c cf ON cf.uuid = x.canonical_from_entity_id
  LEFT JOIN _c ct ON ct.uuid = x.canonical_to_entity_id
  LEFT JOIN LATERAL (
    SELECT e.id FROM public.relationships e
    WHERE e.tenant_id = _tenant_id AND e.deleted_at IS NULL AND x.canonical_type IS NOT NULL
      AND e.relationship_type::text = x.canonical_type
      AND ((e.from_entity_id = cf.entity_id AND e.to_entity_id = ct.entity_id)
        OR (x.canonical_type = 'spouse' AND e.from_entity_id = ct.entity_id AND e.to_entity_id = cf.entity_id))
    LIMIT 1
  ) rel ON true;

  RETURN jsonb_build_object(
    'entitiesCreated', _ent_created,
    'entitiesUpdated', _ent_updated,
    'relationshipsCreated', _rel_created,
    'relationshipsSkipped', _rel_skipped,
    'relationshipsReoriented', _rel_flipped,
    'warnings', _warnings
  );
END;
$function$;
-- sync_xpm_upsert_clients privileges are unchanged (CREATE OR REPLACE keeps them).
