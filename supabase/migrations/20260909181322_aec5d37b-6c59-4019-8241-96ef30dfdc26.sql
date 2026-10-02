-- Structured capacity reporting for a tenant
CREATE OR REPLACE FUNCTION public.tenant_structure_capacity(_tenant_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _count int;
  _limit int;
  _access boolean;
  _unlimited boolean;
  _enforced boolean;
BEGIN
  SELECT diagram_count, diagram_limit, access_enabled, unlimited_structures
  INTO _count, _limit, _access, _unlimited
  FROM public.tenants WHERE id = _tenant_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('found', false);
  END IF;

  _enforced := public.is_billing_enforcement_enabled();

  RETURN jsonb_build_object(
    'found', true,
    'enforced', _enforced,
    'accessEnabled', coalesce(_access, false),
    'unlimited', coalesce(_unlimited, false),
    'used', coalesce(_count, 0),
    'limit', _limit,
    'remaining', CASE
      WHEN _enforced IS NOT TRUE OR coalesce(_unlimited, false) OR _limit IS NULL THEN NULL
      ELSE greatest(_limit - coalesce(_count, 0), 0)
    END
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.tenant_structure_capacity(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.tenant_structure_capacity(uuid) TO authenticated, service_role;

-- Per-group linking: distinguish a capacity/billing block from a real error
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
BEGIN
  SELECT member_hash INTO _prev_hash
  FROM public.xpm_groups
  WHERE tenant_id = _tenant_id AND xpm_uuid = _group_uuid;

  SELECT id INTO _structure_id
  FROM public.structures
  WHERE tenant_id = _tenant_id AND name = _group_name AND deleted_at IS NULL
  ORDER BY created_at LIMIT 1;

  IF _structure_id IS NOT NULL AND _prev_hash IS NOT NULL AND _prev_hash = _member_hash THEN
    UPDATE public.xpm_groups SET last_synced_at = now()
    WHERE tenant_id = _tenant_id AND xpm_uuid = _group_uuid;
    RETURN jsonb_build_object('skipped', true);
  END IF;

  IF _structure_id IS NULL THEN
    BEGIN
      INSERT INTO public.structures (tenant_id, name) VALUES (_tenant_id, _group_name)
      RETURNING id INTO _structure_id;
      _created := true;
    EXCEPTION WHEN OTHERS THEN
      -- A capacity/billing block is a distinct, expected condition: report it as
      -- such so the sync can surface it to the user and retry the group later.
      -- The group's member_hash is deliberately left unset here.
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
      AND e.xpm_uuid = ANY (_member_uuids);

    IF coalesce(array_length(_member_ids, 1), 0) > 0 THEN
      WITH ins AS (
        INSERT INTO public.structure_entities (structure_id, entity_id)
        SELECT _structure_id, m FROM unnest(_member_ids) AS m
        ON CONFLICT DO NOTHING
        RETURNING 1
      )
      SELECT count(*) INTO _members FROM ins;

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
    END IF;
  END IF;

  UPDATE public.xpm_groups
  SET member_hash = _member_hash, last_synced_at = now(), updated_at = now()
  WHERE tenant_id = _tenant_id AND xpm_uuid = _group_uuid;

  RETURN jsonb_build_object(
    'skipped', false,
    'structureCreated', _created,
    'members', _members,
    'relationships', _rels
  );
END;
$function$;

-- Batch linking: aggregate blocked groups and the terminal limit condition
CREATE OR REPLACE FUNCTION public.sync_xpm_link_groups(_tenant_id uuid, _groups jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  g record;
  res jsonb;
  _created int := 0;
  _skipped int := 0;
  _processed int := 0;
  _blocked int := 0;
  _limit_reached boolean := false;
  _limit_code text;
  _limit_error text;
  _blocked_names jsonb := '[]'::jsonb;
  _errors jsonb := '[]'::jsonb;
BEGIN
  FOR g IN
    SELECT x.uuid, x.name, x.hash, x.members
    FROM jsonb_to_recordset(coalesce(_groups, '[]'::jsonb))
         AS x(uuid text, name text, hash text, members jsonb)
    WHERE coalesce(x.uuid, '') <> ''
  LOOP
    res := public.sync_xpm_link_group(
      _tenant_id,
      g.uuid,
      g.name,
      coalesce((SELECT array_agg(value::text) FROM jsonb_array_elements_text(coalesce(g.members, '[]'::jsonb)) AS value), ARRAY[]::text[]),
      g.hash
    );
    _processed := _processed + 1;
    IF coalesce((res->>'skipped')::boolean, false) THEN
      _skipped := _skipped + 1;
    ELSIF coalesce((res->>'limitReached')::boolean, false) THEN
      _blocked := _blocked + 1;
      _limit_reached := true;
      _limit_code := coalesce(_limit_code, res->>'code');
      _limit_error := coalesce(_limit_error, res->>'error');
      IF jsonb_array_length(_blocked_names) < 20 THEN
        _blocked_names := _blocked_names || to_jsonb(g.name);
      END IF;
    ELSIF res->>'error' IS NOT NULL THEN
      IF jsonb_array_length(_errors) < 50 THEN
        _errors := _errors || to_jsonb(format('Group "%s": %s', g.name, res->>'error'));
      END IF;
    ELSIF coalesce((res->>'structureCreated')::boolean, false) THEN
      _created := _created + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'groupsProcessed', _processed,
    'structuresCreated', _created,
    'skippedUnchanged', _skipped,
    'groupsBlocked', _blocked,
    'limitReached', _limit_reached,
    'limitCode', _limit_code,
    'limitError', _limit_error,
    'blockedGroups', _blocked_names,
    'errors', _errors
  );
END;
$function$;