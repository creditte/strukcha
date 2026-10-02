CREATE OR REPLACE FUNCTION public.xpm_archive_group_structures(_group_uuids text[])
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _tenant_id uuid;
  _archived int := 0;
BEGIN
  _tenant_id := get_user_tenant_id(auth.uid());
  IF _tenant_id IS NULL OR NOT is_owner_or_admin(_tenant_id) THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  IF coalesce(array_length(_group_uuids, 1), 0) = 0 THEN
    RETURN jsonb_build_object('archived', 0);
  END IF;

  WITH names AS (
    SELECT g.name
    FROM public.xpm_groups g
    WHERE g.tenant_id = _tenant_id
      AND g.xpm_uuid = ANY (_group_uuids)
  ), upd AS (
    UPDATE public.structures s
    SET archived_at = now(), updated_at = now()
    WHERE s.tenant_id = _tenant_id
      AND s.deleted_at IS NULL
      AND s.archived_at IS NULL
      AND s.name IN (SELECT name FROM names)
    RETURNING 1
  )
  SELECT count(*) INTO _archived FROM upd;

  RETURN jsonb_build_object('archived', _archived);
END;
$$;

REVOKE ALL ON FUNCTION public.xpm_archive_group_structures(text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.xpm_archive_group_structures(text[]) TO authenticated;