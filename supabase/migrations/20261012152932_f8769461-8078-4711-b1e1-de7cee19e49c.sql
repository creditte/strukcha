-- Link one existing same-name (non-XPM) diagram to an XPM group, only on the
-- user's explicit confirmation. Sets the group id; never merges, deletes,
-- or changes members. Rerunnable; refuses anything ambiguous.
CREATE OR REPLACE FUNCTION public.xpm_link_existing_structure(
  _tenant_id uuid, _group_uuid text, _group_name text, _structure_id uuid, _actor uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE _res jsonb; _manual jsonb; _before jsonb;
BEGIN
  IF coalesce(_group_uuid, '') = '' OR _structure_id IS NULL THEN
    RETURN jsonb_build_object('status', 'error', 'error', 'group and diagram are required');
  END IF;
  INSERT INTO public.xpm_groups (tenant_id, xpm_uuid, name) VALUES (_tenant_id, _group_uuid, _group_name)
  ON CONFLICT (tenant_id, xpm_uuid) DO NOTHING;
  PERFORM 1 FROM public.xpm_groups WHERE tenant_id = _tenant_id AND xpm_uuid = _group_uuid FOR UPDATE;

  _res := public.xpm_resolve_group_structure(_tenant_id, _group_uuid, _group_name);
  IF _res->>'match' = 'uuid' THEN
    IF (_res->>'structure_id')::uuid = _structure_id THEN
      RETURN jsonb_build_object('status', 'linked', 'structure_id', _structure_id, 'already', true);
    END IF;
    RETURN jsonb_build_object('status', 'already_linked_elsewhere', 'structure_id', _res->>'structure_id');
  END IF;
  _manual := coalesce(_res->'same_name_manual', '[]'::jsonb);
  IF _res->>'match' <> 'create' OR jsonb_array_length(_manual) <> 1 OR NOT (_manual ? _structure_id::text) THEN
    RETURN jsonb_build_object('status', 'not_linkable', 'resolution', _res);
  END IF;

  SELECT to_jsonb(s) INTO _before FROM public.structures s
  WHERE s.id = _structure_id AND s.tenant_id = _tenant_id AND s.xpm_group_uuid IS NULL
    AND s.deleted_at IS NULL AND s.is_scenario = false;
  IF _before IS NULL THEN RETURN jsonb_build_object('status', 'not_linkable'); END IF;

  UPDATE public.structures SET xpm_group_uuid = _group_uuid
  WHERE id = _structure_id AND tenant_id = _tenant_id AND xpm_group_uuid IS NULL;

  IF _actor IS NOT NULL THEN
    INSERT INTO public.audit_log (tenant_id, user_id, action, entity_type, entity_id, before_state, after_state)
    VALUES (_tenant_id, _actor, 'xpm_group_linked_existing', 'structure', _structure_id,
      jsonb_build_object('xpm_group_uuid', NULL, 'source', _before->>'source', 'name', _before->>'name'),
      jsonb_build_object('xpm_group_uuid', _group_uuid, 'group_name', _group_name));
  END IF;
  RETURN jsonb_build_object('status', 'linked', 'structure_id', _structure_id);
END $$;

REVOKE ALL ON FUNCTION public.xpm_link_existing_structure(uuid, text, text, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.xpm_link_existing_structure(uuid, text, text, uuid, uuid) TO service_role;