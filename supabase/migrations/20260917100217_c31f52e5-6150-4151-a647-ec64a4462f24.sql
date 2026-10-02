CREATE OR REPLACE FUNCTION public.merge_duplicate_xpm_entities(_tenant_id uuid DEFAULT NULL, _limit_groups integer DEFAULT 1000)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  g record;
  keeper uuid;
  keeper_tenant uuid;
  dup uuid;
  groups_done int := 0;
  merged_rows int := 0;
  rels_repointed int := 0;
  rels_deduped int := 0;
  struct_moved int := 0;
BEGIN
  FOR g IN
    SELECT e.tenant_id, e.xpm_uuid
    FROM public.entities e
    WHERE e.xpm_uuid IS NOT NULL
      AND e.deleted_at IS NULL
      AND (_tenant_id IS NULL OR e.tenant_id = _tenant_id)
    GROUP BY e.tenant_id, e.xpm_uuid
    HAVING count(*) > 1
    LIMIT _limit_groups
  LOOP
    -- Pick the keeper: most relationships, then most diagram memberships,
    -- then a classified type, then the oldest row.
    SELECT e.id, e.tenant_id INTO keeper, keeper_tenant
    FROM public.entities e
    WHERE e.tenant_id = g.tenant_id
      AND e.xpm_uuid = g.xpm_uuid
      AND e.deleted_at IS NULL
    ORDER BY
      (SELECT count(*) FROM public.relationships r
        WHERE r.deleted_at IS NULL
          AND (r.from_entity_id = e.id OR r.to_entity_id = e.id)) DESC,
      (SELECT count(*) FROM public.structure_entities se WHERE se.entity_id = e.id) DESC,
      (e.entity_type::text = 'Unclassified') ASC,
      e.created_at ASC,
      e.id ASC
    LIMIT 1;

    FOR dup IN
      SELECT e.id FROM public.entities e
      WHERE e.tenant_id = g.tenant_id
        AND e.xpm_uuid = g.xpm_uuid
        AND e.deleted_at IS NULL
        AND e.id <> keeper
    LOOP
      -- Drop links that would become self-referencing.
      UPDATE public.relationships r
        SET deleted_at = now()
      WHERE r.deleted_at IS NULL
        AND ((r.from_entity_id = dup AND r.to_entity_id = keeper)
          OR (r.from_entity_id = keeper AND r.to_entity_id = dup));

      -- Move diagram membership of surviving links to the keeper's rows later;
      -- first soft-delete links that would duplicate an existing keeper link.
      WITH doomed AS (
        SELECT r.id AS dup_rel, k.id AS keep_rel
        FROM public.relationships r
        JOIN public.relationships k
          ON k.deleted_at IS NULL
         AND k.tenant_id = r.tenant_id
         AND k.relationship_type = r.relationship_type
         AND k.from_entity_id = CASE WHEN r.from_entity_id = dup THEN keeper ELSE r.from_entity_id END
         AND k.to_entity_id   = CASE WHEN r.to_entity_id   = dup THEN keeper ELSE r.to_entity_id END
         AND k.id <> r.id
        WHERE r.deleted_at IS NULL
          AND (r.from_entity_id = dup OR r.to_entity_id = dup)
      ), moved AS (
        INSERT INTO public.structure_relationships (structure_id, relationship_id)
        SELECT sr.structure_id, d.keep_rel
        FROM doomed d
        JOIN public.structure_relationships sr ON sr.relationship_id = d.dup_rel
        ON CONFLICT DO NOTHING
        RETURNING 1
      ), cleared AS (
        DELETE FROM public.structure_relationships sr
        USING doomed d WHERE sr.relationship_id = d.dup_rel
        RETURNING 1
      )
      UPDATE public.relationships r
        SET deleted_at = now()
      WHERE r.id IN (SELECT dup_rel FROM doomed);
      rels_deduped := rels_deduped + coalesce((SELECT count(*) FROM public.relationships r
        WHERE r.deleted_at IS NOT NULL AND false), 0);

      -- Re-point remaining links.
      UPDATE public.relationships r
        SET from_entity_id = keeper
      WHERE r.deleted_at IS NULL AND r.from_entity_id = dup;
      UPDATE public.relationships r
        SET to_entity_id = keeper
      WHERE r.deleted_at IS NULL AND r.to_entity_id = dup;
      rels_repointed := rels_repointed + 1;

      -- Move diagram membership.
      INSERT INTO public.structure_entities (structure_id, entity_id, position_x, position_y)
      SELECT se.structure_id, keeper, se.position_x, se.position_y
      FROM public.structure_entities se
      WHERE se.entity_id = dup
      ON CONFLICT DO NOTHING;
      DELETE FROM public.structure_entities se WHERE se.entity_id = dup;
      struct_moved := struct_moved + 1;

      UPDATE public.entities e
        SET deleted_at = now(), merged_into_entity_id = keeper
      WHERE e.id = dup;

      INSERT INTO public.entity_merges (tenant_id, primary_entity_id, merged_entity_id, merged_by)
      VALUES (g.tenant_id, keeper, dup, '00000000-0000-0000-0000-000000000000'::uuid);

      merged_rows := merged_rows + 1;
    END LOOP;

    groups_done := groups_done + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'groups_processed', groups_done,
    'entities_merged', merged_rows,
    'relationship_updates', rels_repointed,
    'structure_moves', struct_moved
  );
END;
$$;

REVOKE ALL ON FUNCTION public.merge_duplicate_xpm_entities(uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.merge_duplicate_xpm_entities(uuid, integer) TO service_role;