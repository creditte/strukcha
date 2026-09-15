-- 1. Unknown ("Unclassified") entity types must not invalidate a relationship.
CREATE OR REPLACE FUNCTION public.rel_direction_valid(_rtype text, _from_type text, _to_type text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $function$
  SELECT CASE
    WHEN _from_type IS NULL OR _to_type IS NULL THEN true
    -- Unclassified means "type not known yet", not "wrong": treat as permissive.
    WHEN _from_type = 'Unclassified' OR _to_type = 'Unclassified' THEN true
    WHEN _rtype = 'director' THEN _from_type = 'Individual' AND _to_type = 'Company'
    WHEN _rtype = 'shareholder' THEN _to_type = 'Company'
      AND (_from_type IN ('Individual','Company','smsf','trust_unit','Trust','trust_discretionary','trust_family'))
    WHEN _rtype = 'unit_holder' THEN _to_type = 'trust_unit'
      AND (_from_type IN ('Individual','Company','smsf','trust_unit','Trust','trust_discretionary','trust_family'))
    WHEN _rtype = 'trustee' THEN _from_type IN ('Individual','Company')
      AND _to_type IN ('Trust','trust_discretionary','trust_unit','trust_hybrid','trust_bare',
                       'trust_testamentary','trust_deceased_estate','trust_family','smsf')
    WHEN _rtype = 'beneficiary' AND _to_type = 'trust_bare' THEN _from_type IN ('Individual','Company','smsf')
    WHEN _rtype = 'beneficiary' THEN
      (_from_type IN ('Individual','Company','smsf','Trust','trust_discretionary','trust_family'))
      AND _to_type IN ('Trust','trust_discretionary','trust_family','trust_hybrid','trust_bare',
                       'trust_testamentary','trust_deceased_estate')
    WHEN _rtype = 'member' THEN
      (_from_type IN ('Individual','Company','smsf','Trust','trust_discretionary','trust_family'))
      AND _to_type IN ('trust_unit','smsf')
    WHEN _rtype = 'appointer' THEN _from_type IN ('Individual','Company')
      AND _to_type IN ('Trust','trust_discretionary','trust_unit','trust_family','trust_hybrid',
                       'trust_bare','trust_testamentary','trust_deceased_estate')
    WHEN _rtype = 'settlor' THEN _from_type IN ('Individual','Company')
      AND _to_type IN ('Trust','trust_discretionary','trust_unit','trust_hybrid','trust_bare',
                       'trust_testamentary','trust_deceased_estate','trust_family')
    WHEN _rtype = 'partner' THEN _from_type IN ('Individual','Company') AND _to_type IN ('Individual','Company')
    WHEN _rtype IN ('spouse','parent','child') THEN _from_type = 'Individual' AND _to_type = 'Individual'
    ELSE true
  END;
$function$;

-- 2. Remove duplicate relationship rows, then stop new ones appearing.
WITH ranked AS (
  SELECT id, row_number() OVER (
           PARTITION BY tenant_id, from_entity_id, to_entity_id, relationship_type
           ORDER BY created_at, id
         ) AS rn
  FROM public.relationships
  WHERE deleted_at IS NULL
)
UPDATE public.relationships r
SET deleted_at = now()
FROM ranked
WHERE r.id = ranked.id AND ranked.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS relationships_unique_active
  ON public.relationships (tenant_id, from_entity_id, to_entity_id, relationship_type)
  WHERE deleted_at IS NULL;

-- 3. Sync now carries XPM's archived flag and relationship dates.
CREATE OR REPLACE FUNCTION public.sync_xpm_upsert_clients(_tenant_id uuid, _payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
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

  INSERT INTO _c (uuid, name, entity_type)
  SELECT x.uuid, x.name, 'Unclassified'
  FROM jsonb_to_recordset(coalesce(_payload->'related', '[]'::jsonb)) AS x(uuid text, name text)
  WHERE coalesce(x.uuid, '') <> '' AND coalesce(x.name, '') <> ''
  ON CONFLICT (uuid) DO NOTHING;

  UPDATE _c c SET entity_id = e.id
  FROM public.entities e
  WHERE e.tenant_id = _tenant_id AND e.deleted_at IS NULL AND e.xpm_uuid = c.uuid;

  UPDATE _c c SET entity_id = e.id
  FROM (
    SELECT DISTINCT ON (name) id, name
    FROM public.entities
    WHERE tenant_id = _tenant_id AND deleted_at IS NULL
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
        -- XPM owns archived state for imported records, both directions.
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

  -- Backfill dates onto links that already exist, then drop them from staging.
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

-- 4. Group linking: skip archived members, and keep relationship links current
--    even when the group's membership hash is unchanged.
CREATE OR REPLACE FUNCTION public.sync_xpm_link_group(_tenant_id uuid, _group_uuid text, _group_name text, _member_uuids text[], _member_hash text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _structure_id uuid;
  _created boolean := false;
  _members int := 0;
  _rels int := 0;
  _prev_hash text;
  _member_ids uuid[];
  _hash_unchanged boolean := false;
BEGIN
  SELECT member_hash INTO _prev_hash
  FROM public.xpm_groups
  WHERE tenant_id = _tenant_id AND xpm_uuid = _group_uuid;

  SELECT id INTO _structure_id
  FROM public.structures
  WHERE tenant_id = _tenant_id AND name = _group_name AND deleted_at IS NULL
  ORDER BY created_at LIMIT 1;

  _hash_unchanged := _structure_id IS NOT NULL AND _prev_hash IS NOT NULL AND _prev_hash = _member_hash;

  IF _structure_id IS NULL THEN
    BEGIN
      INSERT INTO public.structures (tenant_id, name) VALUES (_tenant_id, _group_name)
      RETURNING id INTO _structure_id;
      _created := true;
    EXCEPTION WHEN OTHERS THEN
      IF SQLERRM ILIKE '%limit reached%'
         OR SQLERRM ILIKE '%maximum of%active structures%'
         OR SQLERRM ILIKE '%Subscription inactive%' THEN
        RETURN jsonb_build_object(
          'skipped', false,
          'limitReached', true,
          'code', CASE WHEN SQLERRM ILIKE '%Subscription inactive%'
                       THEN 'subscription_inactive' ELSE 'structure_limit_reached' END,
          'error', SQLERRM
        );
      END IF;
      RETURN jsonb_build_object('skipped', false, 'error', SQLERRM);
    END;
  END IF;

  IF coalesce(array_length(_member_uuids, 1), 0) > 0 THEN
    SELECT array_agg(DISTINCT e.id) INTO _member_ids
    FROM public.entities e
    WHERE e.tenant_id = _tenant_id AND e.deleted_at IS NULL
      AND e.is_archived = false
      AND e.xpm_uuid = ANY (_member_uuids);

    IF coalesce(array_length(_member_ids, 1), 0) > 0 THEN
      WITH ins AS (
        INSERT INTO public.structure_entities (structure_id, entity_id)
        SELECT _structure_id, m FROM unnest(_member_ids) AS m
        ON CONFLICT DO NOTHING
        RETURNING 1
      )
      SELECT count(*) INTO _members FROM ins;

      -- Relationship links are refreshed every sync: entity classification can
      -- improve between runs, which recovers links that were previously absent.
      WITH ins AS (
        INSERT INTO public.structure_relationships (structure_id, relationship_id)
        SELECT DISTINCT _structure_id, rel.id
        FROM public.relationships rel
        WHERE rel.tenant_id = _tenant_id AND rel.deleted_at IS NULL
          AND rel.from_entity_id = ANY (_member_ids)
          AND rel.to_entity_id = ANY (_member_ids)
        ON CONFLICT DO NOTHING
        RETURNING 1
      )
      SELECT count(*) INTO _rels FROM ins;

      -- Members archived in XPM leave the active structure (history is kept).
      DELETE FROM public.structure_entities se
      USING public.entities e
      WHERE se.structure_id = _structure_id AND se.entity_id = e.id
        AND e.is_archived = true;
    END IF;
  END IF;

  UPDATE public.xpm_groups
  SET member_hash = _member_hash, last_synced_at = now(), updated_at = now()
  WHERE tenant_id = _tenant_id AND xpm_uuid = _group_uuid;

  RETURN jsonb_build_object(
    'skipped', _hash_unchanged AND _members = 0 AND _rels = 0,
    'structureCreated', _created,
    'members', _members,
    'relationships', _rels
  );
END;
$function$;