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

  UPDATE _c c SET entity_id = e.id
  FROM public.entities e
  WHERE e.tenant_id = _tenant_id AND e.deleted_at IS NULL AND e.xpm_uuid = c.uuid;

  UPDATE _c c SET entity_id = e.id
  FROM (
    SELECT DISTINCT ON (name) id, name
    FROM public.entities
    WHERE tenant_id = _tenant_id AND deleted_at IS NULL AND xpm_uuid IS NULL
    ORDER BY name, created_at
  ) e
  WHERE c.entity_id IS NULL AND e.name = c.name;

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
    end_date date
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

  WITH flipped AS (
    UPDATE _sr s
    SET from_id = s.to_id, to_id = s.from_id,
        from_type = s.to_type, to_type = s.from_type
    WHERE NOT public.rel_direction_valid(s.rtype, s.from_type, s.to_type)
      AND public.rel_direction_valid(s.rtype, s.to_type, s.from_type)
    RETURNING 1
  )
  SELECT count(*) INTO _rel_flipped FROM flipped;

  UPDATE _sr SET from_id = to_id, to_id = from_id
  WHERE rtype IN ('spouse', 'partner') AND from_id > to_id;

  WITH invalid AS (
    DELETE FROM _sr s
    WHERE NOT public.rel_direction_valid(s.rtype, s.from_type, s.to_type)
    RETURNING s.rtype
  )
  SELECT _rel_skipped + count(*),
         _warnings || coalesce(
           jsonb_agg(DISTINCT format('%s: %s link(s) from Xero did not match Strukcha''s relationship rules and were skipped', rtype, cnt)),
           '[]'::jsonb)
    INTO _rel_skipped, _warnings
  FROM (SELECT rtype, count(*) AS cnt FROM invalid GROUP BY rtype) g;

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