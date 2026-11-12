CREATE OR REPLACE FUNCTION public.health_review_dataset()
 RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  WITH t AS (SELECT public.get_user_tenant_id(auth.uid()) AS tid),
  s AS (
    SELECT st.id, st.name FROM public.structures st, t
    WHERE t.tid IS NOT NULL AND st.tenant_id = t.tid AND st.deleted_at IS NULL
      AND st.archived_at IS NULL AND COALESCE(st.is_scenario, false) = false
  ),
  ae AS (
    SELECT se.structure_id, e.* FROM public.structure_entities se
    JOIN public.entities e ON e.id = se.entity_id
    WHERE se.structure_id IN (SELECT id FROM s) AND e.deleted_at IS NULL AND e.is_archived = false
  )
  SELECT jsonb_build_object('structures', COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'id', s.id, 'name', s.name,
      'inactive', NOT EXISTS (SELECT 1 FROM ae WHERE ae.structure_id = s.id),
      'entities', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'id', ae.id, 'name', ae.name, 'entity_type', ae.entity_type, 'xpm_uuid', ae.xpm_uuid,
          'abn', ae.abn, 'acn', ae.acn, 'is_operating_entity', ae.is_operating_entity,
          'is_trustee_company', ae.is_trustee_company, 'created_at', ae.created_at,
          'is_archived', ae.is_archived) ORDER BY ae.id)
        FROM ae WHERE ae.structure_id = s.id), '[]'::jsonb),
      'relationships', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'id', r.id, 'from_entity_id', r.from_entity_id, 'to_entity_id', r.to_entity_id,
          'relationship_type', r.relationship_type, 'source_data', r.source,
          'ownership_percent', r.ownership_percent, 'ownership_units', r.ownership_units,
          'ownership_class', r.ownership_class, 'created_at', r.created_at) ORDER BY r.id)
        FROM public.structure_relationships sr
        JOIN public.relationships r ON r.id = sr.relationship_id
        WHERE sr.structure_id = s.id AND r.deleted_at IS NULL
          AND EXISTS (SELECT 1 FROM ae WHERE ae.structure_id = s.id AND ae.id = r.from_entity_id)
          AND EXISTS (SELECT 1 FROM ae WHERE ae.structure_id = s.id AND ae.id = r.to_entity_id)
      ), '[]'::jsonb)
    ) ORDER BY s.name, s.id) FROM s), '[]'::jsonb));
$function$;

CREATE OR REPLACE FUNCTION public.health_review_fingerprint()
 RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  WITH t AS (SELECT public.get_user_tenant_id(auth.uid()) AS tid),
  allst AS (
    SELECT st.id, st.archived_at, st.updated_at FROM public.structures st, t
    WHERE t.tid IS NOT NULL AND st.tenant_id = t.tid AND st.deleted_at IS NULL
      AND COALESCE(st.is_scenario, false) = false
  ),
  s AS (SELECT id FROM allst WHERE archived_at IS NULL),
  ents AS (
    SELECT e.id, e.is_archived, e.updated_at FROM public.entities e
    WHERE e.deleted_at IS NULL
      AND e.id IN (SELECT se.entity_id FROM public.structure_entities se WHERE se.structure_id IN (SELECT id FROM s))
  )
  SELECT md5(concat_ws('|',
    (SELECT count(*)::text FROM s),
    (SELECT string_agg(id::text, ',' ORDER BY id) FROM allst WHERE archived_at IS NOT NULL),
    (SELECT count(*)::text FROM public.structure_entities se WHERE se.structure_id IN (SELECT id FROM s)),
    (SELECT count(*)::text FROM public.structure_relationships sr WHERE sr.structure_id IN (SELECT id FROM s)),
    (SELECT string_agg(id::text, ',' ORDER BY id) FROM ents WHERE is_archived),
    COALESCE((SELECT max(updated_at)::text FROM ents), ''),
    COALESCE((SELECT max(r.updated_at)::text FROM public.relationships r
      WHERE r.deleted_at IS NULL AND r.id IN (SELECT sr.relationship_id FROM public.structure_relationships sr WHERE sr.structure_id IN (SELECT id FROM s))), '')
  ));
$function$;