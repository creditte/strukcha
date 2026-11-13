ALTER TABLE public.entities ADD COLUMN xpm_business_structure_label text;
COMMENT ON COLUMN public.entities.xpm_business_structure_label IS 'Original business structure wording received from XPM; NULL until supplied by a future import or sync. Never inferred from the client name or mapped entity type.';
DO $migration$
DECLARE definition text; marker text; addition text;
BEGIN
  definition := pg_get_functiondef('public.import_xpm_batch(uuid,jsonb)'::regprocedure);
  marker := '  CREATE TEMP TABLE _g (name text PRIMARY KEY, structure_id uuid) ON COMMIT DROP;';
  addition := $body$  -- Preserve only labels actually supplied by XPM, within the import tenant.
  UPDATE public.entities e
  SET xpm_business_structure_label = x.xpm_business_structure_label
  FROM _w w JOIN jsonb_to_recordset(coalesce(_payload->'entities', '[]'::jsonb))
    AS x(name text, xpm_business_structure_label text) ON x.name = w.name
  WHERE e.id = w.entity_id AND e.tenant_id = _tenant_id
    AND nullif(btrim(x.xpm_business_structure_label), '') IS NOT NULL
    AND e.xpm_business_structure_label IS DISTINCT FROM x.xpm_business_structure_label;

$body$;
  IF strpos(definition, marker) = 0 THEN RAISE EXCEPTION 'import_xpm_batch insertion point missing'; END IF;
  EXECUTE replace(definition, marker, addition || marker);
  definition := pg_get_functiondef('public.sync_xpm_upsert_clients(uuid,jsonb)'::regprocedure);
  marker := '  -- ── Rulebook v1 (Phase 2) · dual contract ──';
  addition := $body$  -- Related name-only mentions never supply an invented business structure label.
  UPDATE public.entities e
  SET xpm_business_structure_label = x.xpm_business_structure_label
  FROM _c c JOIN jsonb_to_recordset(coalesce(_payload->'clients', '[]'::jsonb))
    AS x(uuid text, xpm_business_structure_label text) ON x.uuid = c.uuid
  WHERE e.id = c.entity_id AND e.tenant_id = _tenant_id
    AND nullif(btrim(x.xpm_business_structure_label), '') IS NOT NULL
    AND e.xpm_business_structure_label IS DISTINCT FROM x.xpm_business_structure_label;

$body$;
  IF strpos(definition, marker) = 0 THEN RAISE EXCEPTION 'sync_xpm_upsert_clients insertion point missing'; END IF;
  EXECUTE replace(definition, marker, addition || marker);
END
$migration$;