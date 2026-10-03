-- 015 XPM group identity + provenance. Additive and rerunnable.
ALTER TABLE public.structures ADD COLUMN IF NOT EXISTS xpm_group_uuid text;
CREATE UNIQUE INDEX IF NOT EXISTS structures_tenant_xpm_group_uuid_live
  ON public.structures (tenant_id, xpm_group_uuid)
  WHERE xpm_group_uuid IS NOT NULL AND deleted_at IS NULL AND is_scenario = false;

ALTER TABLE public.structure_entities
  ADD COLUMN IF NOT EXISTS membership_source text NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS xpm_last_seen_at timestamptz;
ALTER TABLE public.structure_relationships
  ADD COLUMN IF NOT EXISTS membership_source text NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS xpm_last_seen_at timestamptz;
DO $$ BEGIN
  ALTER TABLE public.structure_entities ADD CONSTRAINT structure_entities_membership_source_chk
    CHECK (membership_source IN ('manual','xpm'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public.structure_relationships ADD CONSTRAINT structure_relationships_membership_source_chk
    CHECK (membership_source IN ('manual','xpm'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- NULL = legacy row, classified at read time (no row is updated here).
ALTER TABLE public.relationships
  ADD COLUMN IF NOT EXISTS metadata_source text,
  ADD COLUMN IF NOT EXISTS xpm_metadata_at timestamptz;
DO $$ BEGIN
  ALTER TABLE public.relationships ADD CONSTRAINT relationships_metadata_source_chk
    CHECK (metadata_source IS NULL OR metadata_source IN ('manual','xpm'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE OR REPLACE FUNCTION public.xpm_metadata_managed(_metadata_source text, _source public.data_source, _confidence public.confidence_level)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT coalesce(_metadata_source,
    CASE WHEN _source = 'imported' AND _confidence <> 'edited' THEN 'xpm' ELSE 'manual' END) = 'xpm'
$$;

CREATE OR REPLACE FUNCTION public.relationships_metadata_source()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.metadata_source IS NULL THEN
      NEW.metadata_source := CASE WHEN NEW.source = 'imported' THEN 'xpm' ELSE 'manual' END;
    END IF;
  ELSIF (NEW.ownership_percent IS DISTINCT FROM OLD.ownership_percent
      OR NEW.ownership_units IS DISTINCT FROM OLD.ownership_units
      OR NEW.ownership_class IS DISTINCT FROM OLD.ownership_class)
     AND coalesce(current_setting('app.xpm_metadata_write', true), '') <> 'on' THEN
    NEW.metadata_source := 'manual';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_relationships_metadata_source ON public.relationships;
CREATE TRIGGER trg_relationships_metadata_source
  BEFORE INSERT OR UPDATE ON public.relationships
  FOR EACH ROW EXECUTE FUNCTION public.relationships_metadata_source();

-- Refresh one XPM-managed relationship's ownership figures. Never touches manual ones.
CREATE OR REPLACE FUNCTION public._xpm_set_relationship_metadata(_tenant_id uuid, _rel_id uuid, _units numeric, _percent numeric)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r record; _n int;
BEGIN
  SELECT id, metadata_source, source, confidence, ownership_units, ownership_percent INTO r
  FROM public.relationships WHERE id = _rel_id AND tenant_id = _tenant_id AND deleted_at IS NULL;
  IF NOT FOUND THEN RETURN 'not_found'; END IF;
  IF NOT public.xpm_metadata_managed(r.metadata_source, r.source, r.confidence) THEN RETURN 'manual_override'; END IF;
  IF r.ownership_units IS NOT DISTINCT FROM _units AND r.ownership_percent IS NOT DISTINCT FROM _percent THEN
    RETURN 'unchanged';
  END IF;
  PERFORM set_config('app.xpm_metadata_write', 'on', true);
  BEGIN
    UPDATE public.relationships
    SET ownership_units = _units, ownership_percent = _percent,
        metadata_source = 'xpm', xpm_metadata_at = now()
    WHERE id = _rel_id AND tenant_id = _tenant_id;
    GET DIAGNOSTICS _n = ROW_COUNT;
  EXCEPTION WHEN OTHERS THEN
    PERFORM set_config('app.xpm_metadata_write', 'off', true);
    RETURN 'refused';
  END;
  PERFORM set_config('app.xpm_metadata_write', 'off', true);
  RETURN CASE WHEN _n > 0 THEN 'updated' ELSE 'not_found' END;
END $$;

-- Full-sync metadata: rows {type, from_uuid, to_uuid, units, percent}.
CREATE OR REPLACE FUNCTION public.xpm_apply_relationship_metadata(_tenant_id uuid, _rows jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE x record; _rid uuid; _res text; _upd int := 0; _manual int := 0; _refused int := 0; _missing int := 0;
BEGIN
  FOR x IN SELECT * FROM jsonb_to_recordset(coalesce(_rows, '[]'::jsonb))
           AS t(type text, from_uuid text, to_uuid text, units numeric, percent numeric)
  LOOP
    SELECT e.id INTO _rid FROM public.relationships e
    WHERE e.tenant_id = _tenant_id AND e.deleted_at IS NULL
      AND e.relationship_type::text = x.type
      AND e.from_entity_id = public.xpm_resolve_entity_ref(_tenant_id, x.from_uuid)
      AND e.to_entity_id = public.xpm_resolve_entity_ref(_tenant_id, x.to_uuid)
    LIMIT 1;
    IF _rid IS NULL THEN _missing := _missing + 1; CONTINUE; END IF;
    _res := public._xpm_set_relationship_metadata(_tenant_id, _rid, x.units, x.percent);
    IF _res = 'updated' THEN _upd := _upd + 1;
    ELSIF _res = 'manual_override' THEN _manual := _manual + 1;
    ELSIF _res = 'refused' THEN _refused := _refused + 1; END IF;
  END LOOP;
  RETURN jsonb_build_object('updated', _upd, 'manualPreserved', _manual, 'refused', _refused, 'notFound', _missing);
END $$;

-- Identity: UUID first; guarded adoption of exactly one unlinked XPM structure
-- with the exact name; never a manual structure; never merges.
CREATE OR REPLACE FUNCTION public.xpm_resolve_group_structure(_tenant_id uuid, _group_uuid text, _group_name text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE _id uuid; _c uuid[]; _manual uuid[];
BEGIN
  SELECT id INTO _id FROM public.structures
  WHERE tenant_id = _tenant_id AND xpm_group_uuid = _group_uuid AND deleted_at IS NULL AND is_scenario = false
  LIMIT 1;
  IF _id IS NOT NULL THEN RETURN jsonb_build_object('match', 'uuid', 'structure_id', _id); END IF;

  SELECT coalesce(array_agg(id ORDER BY created_at), '{}') INTO _c FROM public.structures
  WHERE tenant_id = _tenant_id AND source = 'xpm' AND xpm_group_uuid IS NULL
    AND deleted_at IS NULL AND is_scenario = false AND name = _group_name;
  IF cardinality(_c) = 1 THEN RETURN jsonb_build_object('match', 'adopt', 'structure_id', _c[1]); END IF;
  IF cardinality(_c) > 1 THEN
    RETURN jsonb_build_object('match', 'ambiguous', 'structure_id', NULL, 'candidates', to_jsonb(_c));
  END IF;

  SELECT coalesce(array_agg(id ORDER BY created_at), '{}') INTO _manual FROM public.structures
  WHERE tenant_id = _tenant_id AND source <> 'xpm' AND deleted_at IS NULL AND is_scenario = false AND name = _group_name;
  RETURN jsonb_build_object('match', 'create', 'structure_id', NULL, 'same_name_manual', to_jsonb(_manual));
END $$;

-- Read-only state for planning/preview.
CREATE OR REPLACE FUNCTION public.xpm_group_reconcile_state(_tenant_id uuid, _group_uuid text, _group_name text, _member_uuids text[])
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE _res jsonb; _sid uuid; _active uuid[]; _linked uuid[];
BEGIN
  _res := public.xpm_resolve_group_structure(_tenant_id, _group_uuid, _group_name);
  _sid := nullif(_res->>'structure_id', '')::uuid;

  SELECT coalesce(array_agg(e.id), '{}') INTO _active FROM public.entities e
  WHERE e.tenant_id = _tenant_id AND e.deleted_at IS NULL AND e.is_archived = false
    AND e.xpm_uuid = ANY (coalesce(_member_uuids, '{}'));
  SELECT coalesce(array_agg(relationship_id), '{}') INTO _linked
  FROM public.structure_relationships WHERE structure_id = _sid;

  RETURN jsonb_build_object(
    'resolution', _res,
    'group', (SELECT jsonb_build_object('member_hash', g.member_hash, 'is_selected', g.is_selected, 'last_synced_at', g.last_synced_at)
              FROM public.xpm_groups g WHERE g.tenant_id = _tenant_id AND g.xpm_uuid = _group_uuid),
    'members', coalesce((
      SELECT jsonb_agg(jsonb_build_object('xpm_uuid', u, 'entity_id', e.id, 'name', e.name, 'is_archived', coalesce(e.is_archived, false)))
      FROM unnest(coalesce(_member_uuids, '{}')) u
      LEFT JOIN public.entities e ON e.tenant_id = _tenant_id AND e.deleted_at IS NULL AND e.xpm_uuid = u), '[]'::jsonb),
    'structure_entities', coalesce((
      SELECT jsonb_agg(jsonb_build_object('entity_id', se.entity_id, 'source', se.membership_source, 'name', e.name))
      FROM public.structure_entities se LEFT JOIN public.entities e ON e.id = se.entity_id
      WHERE se.structure_id = _sid), '[]'::jsonb),
    'structure_relationships', coalesce((
      SELECT jsonb_agg(jsonb_build_object('relationship_id', sr.relationship_id, 'source', sr.membership_source))
      FROM public.structure_relationships sr WHERE sr.structure_id = _sid), '[]'::jsonb),
    'relationships', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'id', r.id, 'type', r.relationship_type, 'from_id', r.from_entity_id, 'to_id', r.to_entity_id,
        'source', r.source, 'xpm_managed', public.xpm_metadata_managed(r.metadata_source, r.source, r.confidence),
        'units', r.ownership_units, 'percent', r.ownership_percent))
      FROM public.relationships r
      WHERE r.tenant_id = _tenant_id AND r.deleted_at IS NULL
        AND ((r.from_entity_id = ANY (_active) AND r.to_entity_id = ANY (_active)) OR r.id = ANY (_linked))), '[]'::jsonb)
  );
END $$;

-- Apply a reviewed plan. Exact-key diffs only; removals limited to XPM-sourced rows.
CREATE OR REPLACE FUNCTION public.xpm_apply_group_reconciliation(
  _tenant_id uuid, _group_uuid text, _group_name text, _member_hash text, _plan jsonb,
  _select boolean DEFAULT false, _actor uuid DEFAULT NULL, _run_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _res jsonb; _sid uuid; _expected uuid; _match text; _created boolean := false; _adopted boolean := false;
  _am int := 0; _pm int := 0; _rm int := 0; _al int := 0; _pl int := 0; _rl int := 0;
  _mu int := 0; _mm int := 0; _mr int := 0; x record; _r text; _result jsonb;
BEGIN
  IF coalesce(_group_uuid, '') = '' THEN RETURN jsonb_build_object('status', 'error', 'error', 'group uuid required'); END IF;
  INSERT INTO public.xpm_groups (tenant_id, xpm_uuid, name) VALUES (_tenant_id, _group_uuid, _group_name)
  ON CONFLICT (tenant_id, xpm_uuid) DO NOTHING;
  PERFORM 1 FROM public.xpm_groups WHERE tenant_id = _tenant_id AND xpm_uuid = _group_uuid FOR UPDATE;

  _res := public.xpm_resolve_group_structure(_tenant_id, _group_uuid, _group_name);
  _match := _res->>'match';
  _sid := nullif(_res->>'structure_id', '')::uuid;
  _expected := nullif(_plan->>'structure_id', '')::uuid;

  IF _match = 'ambiguous' THEN
    RETURN jsonb_build_object('status', 'ambiguous_structure_match', 'candidates', _res->'candidates');
  END IF;
  IF _sid IS DISTINCT FROM _expected OR _match IS DISTINCT FROM (_plan->>'match') THEN
    RETURN jsonb_build_object('status', 'stale_plan', 'resolution', _res);
  END IF;
  IF _match = 'create' AND jsonb_array_length(coalesce(_res->'same_name_manual', '[]'::jsonb)) > 0
     AND coalesce((_plan->>'allow_create_beside_manual')::boolean, false) = false THEN
    RETURN jsonb_build_object('status', 'manual_structure_name_conflict', 'manual', _res->'same_name_manual');
  END IF;

  IF _match = 'adopt' THEN
    UPDATE public.structures SET xpm_group_uuid = _group_uuid
    WHERE id = _sid AND tenant_id = _tenant_id AND xpm_group_uuid IS NULL;
    _adopted := true;
  ELSIF _match = 'create' THEN
    BEGIN
      INSERT INTO public.structures (tenant_id, name, source, xpm_group_uuid, layout_mode)
      VALUES (_tenant_id, _group_name, 'xpm', _group_uuid, 'auto') RETURNING id INTO _sid;
      _created := true;
    EXCEPTION WHEN OTHERS THEN
      IF SQLERRM ILIKE '%limit reached%' OR SQLERRM ILIKE '%maximum of%active structures%' OR SQLERRM ILIKE '%Subscription inactive%' THEN
        RETURN jsonb_build_object('status', 'limit_reached',
          'code', CASE WHEN SQLERRM ILIKE '%Subscription inactive%' THEN 'subscription_inactive' ELSE 'structure_limit_reached' END,
          'error', SQLERRM);
      END IF;
      RETURN jsonb_build_object('status', 'error', 'error', SQLERRM);
    END;
  END IF;

  -- Members
  WITH ins AS (
    INSERT INTO public.structure_entities (structure_id, entity_id, membership_source, xpm_last_seen_at)
    SELECT _sid, e.id, 'xpm', now()
    FROM jsonb_array_elements_text(coalesce(_plan->'add_members', '[]'::jsonb)) v
    JOIN public.entities e ON e.id = v::uuid AND e.tenant_id = _tenant_id AND e.deleted_at IS NULL
    ON CONFLICT (structure_id, entity_id) DO NOTHING RETURNING 1)
  SELECT count(*) INTO _am FROM ins;
  UPDATE public.structure_entities SET membership_source = 'xpm', xpm_last_seen_at = now()
  WHERE structure_id = _sid
    AND entity_id IN (SELECT v::uuid FROM jsonb_array_elements_text(coalesce(_plan->'promote_members', '[]'::jsonb)) v);
  GET DIAGNOSTICS _pm = ROW_COUNT;
  UPDATE public.structure_entities SET xpm_last_seen_at = now()
  WHERE structure_id = _sid AND membership_source = 'xpm'
    AND entity_id IN (SELECT v::uuid FROM jsonb_array_elements_text(coalesce(_plan->'keep_members', '[]'::jsonb)) v);
  DELETE FROM public.structure_entities
  WHERE structure_id = _sid AND membership_source = 'xpm'
    AND entity_id IN (SELECT v::uuid FROM jsonb_array_elements_text(coalesce(_plan->'remove_members', '[]'::jsonb)) v);
  GET DIAGNOSTICS _rm = ROW_COUNT;

  -- Links
  WITH ins AS (
    INSERT INTO public.structure_relationships (structure_id, relationship_id, membership_source, xpm_last_seen_at)
    SELECT _sid, r.id, 'xpm', now()
    FROM jsonb_array_elements_text(coalesce(_plan->'add_links', '[]'::jsonb)) v
    JOIN public.relationships r ON r.id = v::uuid AND r.tenant_id = _tenant_id AND r.deleted_at IS NULL
    ON CONFLICT (structure_id, relationship_id) DO NOTHING RETURNING 1)
  SELECT count(*) INTO _al FROM ins;
  UPDATE public.structure_relationships SET membership_source = 'xpm', xpm_last_seen_at = now()
  WHERE structure_id = _sid
    AND relationship_id IN (SELECT v::uuid FROM jsonb_array_elements_text(coalesce(_plan->'promote_links', '[]'::jsonb)) v);
  GET DIAGNOSTICS _pl = ROW_COUNT;
  UPDATE public.structure_relationships SET xpm_last_seen_at = now()
  WHERE structure_id = _sid AND membership_source = 'xpm'
    AND relationship_id IN (SELECT v::uuid FROM jsonb_array_elements_text(coalesce(_plan->'keep_links', '[]'::jsonb)) v);
  DELETE FROM public.structure_relationships
  WHERE structure_id = _sid AND membership_source = 'xpm'
    AND relationship_id IN (SELECT v::uuid FROM jsonb_array_elements_text(coalesce(_plan->'remove_links', '[]'::jsonb)) v);
  GET DIAGNOSTICS _rl = ROW_COUNT;

  -- Ownership figures (XPM-managed only)
  FOR x IN SELECT * FROM jsonb_to_recordset(coalesce(_plan->'metadata_updates', '[]'::jsonb))
           AS t(relationship_id uuid, units numeric, percent numeric)
  LOOP
    _r := public._xpm_set_relationship_metadata(_tenant_id, x.relationship_id, x.units, x.percent);
    IF _r = 'updated' THEN _mu := _mu + 1; ELSIF _r = 'manual_override' THEN _mm := _mm + 1;
    ELSIF _r = 'refused' THEN _mr := _mr + 1; END IF;
  END LOOP;

  UPDATE public.xpm_groups
  SET member_hash = _member_hash, last_synced_at = now(), updated_at = now(), name = _group_name,
      is_selected = (is_selected OR coalesce(_select, false))
  WHERE tenant_id = _tenant_id AND xpm_uuid = _group_uuid;

  _result := jsonb_build_object('status', 'applied', 'structure_id', _sid, 'match', _match,
    'structureCreated', _created, 'structureAdopted', _adopted,
    'membersAdded', _am, 'membersPromoted', _pm, 'membersRemoved', _rm,
    'linksAdded', _al, 'linksPromoted', _pl, 'linksRemoved', _rl,
    'metadataUpdated', _mu, 'metadataManualPreserved', _mm, 'metadataRefused', _mr);

  _actor := coalesce(_actor, (SELECT user_id FROM public.import_logs WHERE id = _run_id));
  IF _actor IS NOT NULL THEN
    INSERT INTO public.audit_log (tenant_id, user_id, action, entity_type, entity_id, before_state, after_state)
    VALUES (_tenant_id, _actor, 'xpm_group_reconcile', 'structure', _sid,
            jsonb_build_object('group_uuid', _group_uuid, 'group_name', _group_name, 'run_id', _run_id, 'plan', _plan),
            _result);
  END IF;
  RETURN _result;
END $$;

-- Backwards-compatible wrapper (old sync callers): identity by UUID / guarded
-- adoption, additive XPM-sourced links only, never removes manual items.
CREATE OR REPLACE FUNCTION public.sync_xpm_link_group(_tenant_id uuid, _group_uuid text, _group_name text, _member_uuids text[], _member_hash text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _res jsonb; _sid uuid; _created boolean := false; _members int := 0; _rels int := 0; _ids uuid[];
BEGIN
  _res := public.xpm_resolve_group_structure(_tenant_id, _group_uuid, _group_name);
  IF _res->>'match' = 'ambiguous' THEN
    RETURN jsonb_build_object('skipped', true, 'error', format('ambiguous_structure_match for group %s', _group_name));
  END IF;
  IF _res->>'match' = 'create' AND jsonb_array_length(coalesce(_res->'same_name_manual', '[]'::jsonb)) > 0 THEN
    RETURN jsonb_build_object('skipped', true, 'error', format('manual_structure_name_conflict for group %s', _group_name));
  END IF;
  _sid := nullif(_res->>'structure_id', '')::uuid;
  IF _res->>'match' = 'adopt' THEN
    UPDATE public.structures SET xpm_group_uuid = _group_uuid WHERE id = _sid AND xpm_group_uuid IS NULL;
  ELSIF _sid IS NULL THEN
    BEGIN
      INSERT INTO public.structures (tenant_id, name, source, xpm_group_uuid)
      VALUES (_tenant_id, _group_name, 'xpm', _group_uuid) RETURNING id INTO _sid;
      _created := true;
    EXCEPTION WHEN OTHERS THEN
      IF SQLERRM ILIKE '%limit reached%' OR SQLERRM ILIKE '%maximum of%active structures%' OR SQLERRM ILIKE '%Subscription inactive%' THEN
        RETURN jsonb_build_object('skipped', false, 'limitReached', true,
          'code', CASE WHEN SQLERRM ILIKE '%Subscription inactive%' THEN 'subscription_inactive' ELSE 'structure_limit_reached' END,
          'error', SQLERRM);
      END IF;
      RETURN jsonb_build_object('skipped', false, 'error', SQLERRM);
    END;
  END IF;

  SELECT coalesce(array_agg(DISTINCT e.id), '{}') INTO _ids FROM public.entities e
  WHERE e.tenant_id = _tenant_id AND e.deleted_at IS NULL AND e.is_archived = false
    AND e.xpm_uuid = ANY (coalesce(_member_uuids, '{}'));
  WITH ins AS (
    INSERT INTO public.structure_entities (structure_id, entity_id, membership_source, xpm_last_seen_at)
    SELECT _sid, m, 'xpm', now() FROM unnest(_ids) m ON CONFLICT DO NOTHING RETURNING 1)
  SELECT count(*) INTO _members FROM ins;
  WITH ins AS (
    INSERT INTO public.structure_relationships (structure_id, relationship_id, membership_source, xpm_last_seen_at)
    SELECT DISTINCT _sid, r.id FROM public.relationships r
    WHERE r.tenant_id = _tenant_id AND r.deleted_at IS NULL AND r.source = 'imported'
      AND r.from_entity_id = ANY (_ids) AND r.to_entity_id = ANY (_ids)
    ON CONFLICT DO NOTHING RETURNING 1)
  SELECT count(*) INTO _rels FROM ins;
  DELETE FROM public.structure_entities se USING public.entities e
  WHERE se.structure_id = _sid AND se.entity_id = e.id AND se.membership_source = 'xpm' AND e.is_archived = true;

  UPDATE public.xpm_groups SET member_hash = _member_hash, last_synced_at = now(), updated_at = now()
  WHERE tenant_id = _tenant_id AND xpm_uuid = _group_uuid;
  RETURN jsonb_build_object('skipped', _members = 0 AND _rels = 0, 'structureCreated', _created,
    'members', _members, 'relationships', _rels);
END $$;

REVOKE ALL ON FUNCTION public._xpm_set_relationship_metadata(uuid, uuid, numeric, numeric) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.xpm_apply_relationship_metadata(uuid, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.xpm_resolve_group_structure(uuid, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.xpm_group_reconcile_state(uuid, text, text, text[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.xpm_apply_group_reconciliation(uuid, text, text, text, jsonb, boolean, uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.sync_xpm_link_group(uuid, text, text, text[], text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._xpm_set_relationship_metadata(uuid, uuid, numeric, numeric) TO service_role;
GRANT EXECUTE ON FUNCTION public.xpm_apply_relationship_metadata(uuid, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.xpm_resolve_group_structure(uuid, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.xpm_group_reconcile_state(uuid, text, text, text[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.xpm_apply_group_reconciliation(uuid, text, text, text, jsonb, boolean, uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.sync_xpm_link_group(uuid, text, text, text[], text) TO service_role;