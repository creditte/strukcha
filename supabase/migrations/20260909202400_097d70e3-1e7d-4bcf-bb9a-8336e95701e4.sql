CREATE OR REPLACE FUNCTION public.import_xpm_batch(_tenant_id uuid, _payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _cap jsonb;
  _limit int;
  _used int := 0;
  _capacity bigint := 0;
  _unlimited boolean := false;
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

  -- Single shared capacity rule (same helper the XPM sync uses) instead of a
  -- second copy of the limit maths.
  _cap := public.tenant_structure_capacity(_tenant_id);
  _enforce := coalesce((_cap->>'enforced')::boolean, false);
  _access := coalesce((_cap->>'accessEnabled')::boolean, false);
  _unlimited := coalesce((_cap->>'unlimited')::boolean, false);
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
      IF SQLERRM ILIKE '%limit reached%' OR SQLERRM ILIKE '%maximum of%active structures%' THEN
        _capacity := 0;
        _struct_skipped := _struct_skipped + 1;
        IF _limit_code IS NULL THEN _limit_code := 'structure_limit_reached'; END IF;
      ELSIF SQLERRM ILIKE '%Subscription inactive%' THEN
        _capacity := 0;
        _struct_skipped := _struct_skipped + 1;
        _limit_code := 'subscription_inactive';
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
    from_name text,
    to_name text,
    grp text,
    percent numeric,
    units numeric,
    class text,
    from_id uuid,
    to_id uuid
  ) ON COMMIT DROP;

  INSERT INTO _r (rownum, rtype, from_name, to_name, grp, percent, units, class)
  SELECT row_number() OVER (), x.rtype, x.from_name, x.to_name, x.grp, x.percent, x.units, x.class
  FROM jsonb_to_recordset(coalesce(_payload->'relationships', '[]'::jsonb))
       AS x(rtype text, from_name text, to_name text, grp text, percent numeric, units numeric, class text)
  WHERE coalesce(x.rtype, '') <> '' AND coalesce(x.from_name, '') <> '' AND coalesce(x.to_name, '') <> '';

  UPDATE _r r SET from_id = w.entity_id FROM _w w WHERE w.name = r.from_name;
  UPDATE _r r SET to_id = w.entity_id FROM _w w WHERE w.name = r.to_name;

  FOR rec IN
    SELECT * FROM _r WHERE from_id IS NOT NULL AND to_id IS NOT NULL ORDER BY rownum
  LOOP
    BEGIN
      SELECT id INTO _rid
      FROM public.relationships
      WHERE tenant_id = _tenant_id
        AND from_entity_id = rec.from_id
        AND to_entity_id = rec.to_id
        AND relationship_type = rec.rtype::relationship_type
        AND deleted_at IS NULL
      LIMIT 1;

      IF _rid IS NULL THEN
        INSERT INTO public.relationships (
          tenant_id, from_entity_id, to_entity_id, relationship_type,
          ownership_percent, ownership_units, ownership_class, source, confidence
        ) VALUES (
          _tenant_id, rec.from_id, rec.to_id, rec.rtype::relationship_type,
          rec.percent, rec.units, rec.class, 'imported', 'imported'
        ) RETURNING id INTO _rid;
        _rel_created := _rel_created + 1;
      END IF;

      IF rec.grp IS NOT NULL THEN
        INSERT INTO public.structure_relationships (structure_id, relationship_id)
        SELECT g.structure_id, _rid FROM _g g
        WHERE g.name = rec.grp AND g.structure_id IS NOT NULL
        ON CONFLICT DO NOTHING;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      _rel_skipped := _rel_skipped + 1;
      _warnings := _warnings || to_jsonb(format('Relationship %s -> %s (%s) skipped: %s', rec.from_name, rec.to_name, rec.rtype, SQLERRM));
    END;
  END LOOP;

  RETURN jsonb_build_object(
    'entities_created', _ent_created,
    'entities_updated', _ent_updated,
    'structures_created', _struct_created,
    'structures_skipped', _struct_skipped,
    'relationships_created', _rel_created,
    'relationships_skipped', _rel_skipped,
    'limit_reached', _limit_code IS NOT NULL,
    'limit_code', _limit_code,
    'warnings', _warnings
  );
END;
$function$;