-- 1. One-shot health review dataset (replaces ~100 sequential client requests)
CREATE OR REPLACE FUNCTION public.health_review_dataset()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH t AS (
    SELECT public.get_user_tenant_id(auth.uid()) AS tid
  ),
  s AS (
    SELECT st.id, st.name
    FROM public.structures st, t
    WHERE t.tid IS NOT NULL
      AND st.tenant_id = t.tid
      AND st.deleted_at IS NULL
      AND COALESCE(st.is_scenario, false) = false
  )
  SELECT jsonb_build_object(
    'structures',
    COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', s.id,
          'name', s.name,
          'entities', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
              'id', e.id,
              'name', e.name,
              'entity_type', e.entity_type,
              'xpm_uuid', e.xpm_uuid,
              'abn', e.abn,
              'acn', e.acn,
              'is_operating_entity', e.is_operating_entity,
              'is_trustee_company', e.is_trustee_company,
              'created_at', e.created_at
            ) ORDER BY e.id)
            FROM public.structure_entities se
            JOIN public.entities e ON e.id = se.entity_id
            WHERE se.structure_id = s.id AND e.deleted_at IS NULL
          ), '[]'::jsonb),
          'relationships', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
              'id', r.id,
              'from_entity_id', r.from_entity_id,
              'to_entity_id', r.to_entity_id,
              'relationship_type', r.relationship_type,
              'source_data', r.source,
              'ownership_percent', r.ownership_percent,
              'ownership_units', r.ownership_units,
              'ownership_class', r.ownership_class,
              'created_at', r.created_at
            ) ORDER BY r.id)
            FROM public.structure_relationships sr
            JOIN public.relationships r ON r.id = sr.relationship_id
            WHERE sr.structure_id = s.id AND r.deleted_at IS NULL
          ), '[]'::jsonb)
        ) ORDER BY s.name, s.id
      )
      FROM s
    ), '[]'::jsonb)
  );
$$;

REVOKE ALL ON FUNCTION public.health_review_dataset() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.health_review_dataset() TO authenticated;
GRANT EXECUTE ON FUNCTION public.health_review_dataset() TO service_role;

-- 2. Cheap change stamp: reflects structure membership + entity/relationship edits
CREATE OR REPLACE FUNCTION public.health_review_fingerprint()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH t AS (
    SELECT public.get_user_tenant_id(auth.uid()) AS tid
  ),
  s AS (
    SELECT st.id
    FROM public.structures st, t
    WHERE t.tid IS NOT NULL
      AND st.tenant_id = t.tid
      AND st.deleted_at IS NULL
      AND COALESCE(st.is_scenario, false) = false
  )
  SELECT md5(concat_ws(
    '|',
    (SELECT count(*)::text FROM s),
    (SELECT count(*)::text FROM public.structure_entities se WHERE se.structure_id IN (SELECT id FROM s)),
    (SELECT count(*)::text FROM public.structure_relationships sr WHERE sr.structure_id IN (SELECT id FROM s)),
    COALESCE((
      SELECT max(e.updated_at)::text
      FROM public.entities e
      WHERE e.deleted_at IS NULL
        AND e.id IN (SELECT se.entity_id FROM public.structure_entities se WHERE se.structure_id IN (SELECT id FROM s))
    ), ''),
    COALESCE((
      SELECT max(r.updated_at)::text
      FROM public.relationships r
      WHERE r.deleted_at IS NULL
        AND r.id IN (SELECT sr.relationship_id FROM public.structure_relationships sr WHERE sr.structure_id IN (SELECT id FROM s))
    ), '')
  ));
$$;

REVOKE ALL ON FUNCTION public.health_review_fingerprint() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.health_review_fingerprint() TO authenticated;
GRANT EXECUTE ON FUNCTION public.health_review_fingerprint() TO service_role;

-- 3. Firm-level duplicate dismissals
CREATE TABLE IF NOT EXISTS public.duplicate_dismissals (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  group_key text NOT NULL,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, group_key)
);

GRANT SELECT, INSERT, DELETE ON public.duplicate_dismissals TO authenticated;
GRANT ALL ON public.duplicate_dismissals TO service_role;

ALTER TABLE public.duplicate_dismissals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Firm members can view dismissals" ON public.duplicate_dismissals;
CREATE POLICY "Firm members can view dismissals"
  ON public.duplicate_dismissals FOR SELECT TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()));

DROP POLICY IF EXISTS "Firm members can add dismissals" ON public.duplicate_dismissals;
CREATE POLICY "Firm members can add dismissals"
  ON public.duplicate_dismissals FOR INSERT TO authenticated
  WITH CHECK (tenant_id = public.get_user_tenant_id(auth.uid()));

DROP POLICY IF EXISTS "Firm members can remove dismissals" ON public.duplicate_dismissals;
CREATE POLICY "Firm members can remove dismissals"
  ON public.duplicate_dismissals FOR DELETE TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()));

CREATE INDEX IF NOT EXISTS idx_duplicate_dismissals_tenant ON public.duplicate_dismissals(tenant_id);

DROP TRIGGER IF EXISTS trg_duplicate_dismissals_updated_at ON public.duplicate_dismissals;
CREATE TRIGGER trg_duplicate_dismissals_updated_at
  BEFORE UPDATE ON public.duplicate_dismissals
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();