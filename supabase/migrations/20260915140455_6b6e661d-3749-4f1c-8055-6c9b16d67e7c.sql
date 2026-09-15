ALTER TABLE public.entities ADD COLUMN IF NOT EXISTS xpm_last_seen_at timestamptz;

CREATE OR REPLACE FUNCTION public.sync_xpm_mark_seen(_tenant_id uuid, _uuids text[])
RETURNS integer
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  WITH upd AS (
    UPDATE public.entities
    SET xpm_last_seen_at = now()
    WHERE tenant_id = _tenant_id
      AND deleted_at IS NULL
      AND xpm_uuid = ANY(_uuids)
    RETURNING 1
  )
  SELECT count(*)::int FROM upd;
$$;

-- Xero's client list only returns active clients: an archived client still shows
-- up as a relation on other clients, which used to create a live-looking record.
-- After a complete sweep, anything imported from Xero that was never seen in the
-- list is archived. Nothing is deleted, so history survives.
CREATE OR REPLACE FUNCTION public.sync_xpm_archive_absent_clients(_tenant_id uuid, _since timestamptz)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _archived int := 0;
BEGIN
  WITH upd AS (
    UPDATE public.entities
    SET is_archived = true, updated_at = now()
    WHERE tenant_id = _tenant_id
      AND deleted_at IS NULL
      AND source = 'imported'
      AND xpm_uuid IS NOT NULL
      AND NOT is_archived
      AND (xpm_last_seen_at IS NULL OR xpm_last_seen_at < _since)
    RETURNING 1
  )
  SELECT count(*) INTO _archived FROM upd;

  DELETE FROM public.structure_entities se
  USING public.entities e
  WHERE se.entity_id = e.id AND e.tenant_id = _tenant_id AND e.is_archived;

  RETURN jsonb_build_object('archived', _archived);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.sync_xpm_mark_seen(uuid, text[]) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.sync_xpm_archive_absent_clients(uuid, timestamptz) FROM anon, authenticated;