-- ════════════════════════════════════════════════════════════════════
-- READ ONLY · NOT A MIGRATION · DO NOT PLACE IN supabase/migrations/
-- Rulebook v1 activation preflight. Every statement is a SELECT; nothing
-- here inserts, updates, deletes or creates anything. Run each block on its
-- own and record the counts in the activation log.
--
-- "live"    = relationship not soft-deleted AND both endpoints live
--             (not deleted, not archived).
-- "history" = relationship soft-deleted, or touching an archived/deleted
--             endpoint. History is reported, never remediated by default.
--
-- Blocks 4 and 6 use the legacy rel_direction_valid() so they run before
-- phase1/002. After 002 is applied, the evaluator variants (block 10) give
-- the canonical answer and should be preferred.
-- ════════════════════════════════════════════════════════════════════

-- 0. Base classification used by every block below
WITH r AS (
  SELECT rel.id, rel.tenant_id, rel.relationship_type::text AS t,
         rel.from_entity_id, rel.to_entity_id, rel.source::text AS source,
         fe.entity_type::text AS ft, te.entity_type::text AS tt,
         (rel.deleted_at IS NULL AND fe.deleted_at IS NULL AND te.deleted_at IS NULL
          AND NOT fe.is_archived AND NOT te.is_archived) AS is_live
  FROM public.relationships rel
  JOIN public.entities fe ON fe.id = rel.from_entity_id
  JOIN public.entities te ON te.id = rel.to_entity_id
)
SELECT count(*) FILTER (WHERE is_live) AS live_rows,
       count(*) FILTER (WHERE NOT is_live) AS history_rows,
       count(*) FILTER (WHERE source = 'imported' AND is_live) AS live_imported
FROM r;

-- 1. Duplicate active Spouse facts (either orientation) — must be 0 before 010
SELECT tenant_id, least(from_entity_id, to_entity_id) AS a, greatest(from_entity_id, to_entity_id) AS b, count(*) AS n
FROM public.relationships
WHERE relationship_type::text = 'spouse' AND deleted_at IS NULL AND end_date IS NULL
GROUP BY 1, 2, 3 HAVING count(*) > 1
ORDER BY n DESC;

-- 2. Sole Traders with more than one active Trades As owner — must be 0 before 010.
--    Text comparison so it runs before the enum value exists (returns 0 rows).
SELECT to_entity_id AS sole_trader_id, count(*) AS owners
FROM public.relationships
WHERE relationship_type::text = 'trades_as' AND deleted_at IS NULL AND end_date IS NULL
GROUP BY 1 HAVING count(*) > 1;

-- 3. Child rows: live vs history, and collisions with an existing Parent B → A
WITH c AS (
  SELECT rel.*, (rel.deleted_at IS NULL AND fe.deleted_at IS NULL AND te.deleted_at IS NULL
                 AND NOT fe.is_archived AND NOT te.is_archived) AS is_live
  FROM public.relationships rel
  JOIN public.entities fe ON fe.id = rel.from_entity_id
  JOIN public.entities te ON te.id = rel.to_entity_id
  WHERE rel.relationship_type::text = 'child'
)
SELECT count(*) AS child_rows,
       count(*) FILTER (WHERE is_live) AS live,
       count(*) FILTER (WHERE NOT is_live) AS history,
       count(*) FILTER (WHERE is_live AND EXISTS (
         SELECT 1 FROM public.relationships p
         WHERE p.tenant_id = c.tenant_id AND p.deleted_at IS NULL
           AND p.relationship_type::text = 'parent'
           AND p.from_entity_id = c.to_entity_id AND p.to_entity_id = c.from_entity_id)) AS live_colliding_with_parent
FROM c;

-- 4. Deterministic reversals: stored orientation wrong, flipped orientation right (live only)
SELECT rel.id, rel.tenant_id, rel.relationship_type::text AS t, fe.entity_type::text AS from_type, te.entity_type::text AS to_type
FROM public.relationships rel
JOIN public.entities fe ON fe.id = rel.from_entity_id
JOIN public.entities te ON te.id = rel.to_entity_id
WHERE rel.deleted_at IS NULL AND fe.deleted_at IS NULL AND te.deleted_at IS NULL
  AND NOT fe.is_archived AND NOT te.is_archived
  AND rel.relationship_type::text NOT IN ('spouse', 'child', 'settlor')
  AND NOT public.rel_direction_valid(rel.relationship_type::text, fe.entity_type::text, te.entity_type::text)
  AND public.rel_direction_valid(rel.relationship_type::text, te.entity_type::text, fe.entity_type::text);

-- 5. Sole Trader as relationship source (live vs history)
SELECT rel.relationship_type::text AS t,
       count(*) FILTER (WHERE rel.deleted_at IS NULL AND NOT fe.is_archived AND NOT te.is_archived
                        AND fe.deleted_at IS NULL AND te.deleted_at IS NULL) AS live,
       count(*) FILTER (WHERE NOT (rel.deleted_at IS NULL AND NOT fe.is_archived AND NOT te.is_archived
                        AND fe.deleted_at IS NULL AND te.deleted_at IS NULL)) AS history
FROM public.relationships rel
JOIN public.entities fe ON fe.id = rel.from_entity_id
JOIN public.entities te ON te.id = rel.to_entity_id
WHERE fe.entity_type::text = 'Sole Trader'
GROUP BY 1;

-- 6. Structurally invalid live rows: neither orientation valid
SELECT rel.id, rel.tenant_id, rel.relationship_type::text AS t, fe.entity_type::text AS from_type, te.entity_type::text AS to_type
FROM public.relationships rel
JOIN public.entities fe ON fe.id = rel.from_entity_id
JOIN public.entities te ON te.id = rel.to_entity_id
WHERE rel.deleted_at IS NULL AND fe.deleted_at IS NULL AND te.deleted_at IS NULL
  AND NOT fe.is_archived AND NOT te.is_archived
  AND rel.relationship_type::text NOT IN ('child', 'settlor')
  AND fe.entity_type::text NOT IN ('Trust', 'Unclassified', 'Sole Trader')
  AND te.entity_type::text NOT IN ('Trust', 'Unclassified')
  AND NOT public.rel_direction_valid(rel.relationship_type::text, fe.entity_type::text, te.entity_type::text)
  AND NOT public.rel_direction_valid(rel.relationship_type::text, te.entity_type::text, fe.entity_type::text);

-- 7. Review backlog: Generic Trust / Unclassified entities and the live links touching them
SELECT e.entity_type::text AS t,
       count(*) FILTER (WHERE e.deleted_at IS NULL AND NOT e.is_archived) AS live_entities,
       (SELECT count(*) FROM public.relationships rel
          JOIN public.entities fe ON fe.id = rel.from_entity_id
          JOIN public.entities te ON te.id = rel.to_entity_id
         WHERE rel.deleted_at IS NULL AND fe.deleted_at IS NULL AND te.deleted_at IS NULL
           AND NOT fe.is_archived AND NOT te.is_archived
           AND (fe.entity_type::text = e.entity_type::text OR te.entity_type::text = e.entity_type::text)) AS live_relationships
FROM public.entities e
WHERE e.entity_type::text IN ('Trust', 'Unclassified')
GROUP BY 1;

-- 8. Ambiguous imported directions: imported live rows where BOTH orientations are valid
SELECT rel.relationship_type::text AS t, fe.entity_type::text AS from_type, te.entity_type::text AS to_type, count(*) AS n
FROM public.relationships rel
JOIN public.entities fe ON fe.id = rel.from_entity_id
JOIN public.entities te ON te.id = rel.to_entity_id
WHERE rel.source::text = 'imported' AND rel.deleted_at IS NULL
  AND fe.deleted_at IS NULL AND te.deleted_at IS NULL AND NOT fe.is_archived AND NOT te.is_archived
  AND rel.relationship_type::text NOT IN ('spouse')
  AND public.rel_direction_valid(rel.relationship_type::text, fe.entity_type::text, te.entity_type::text)
  AND public.rel_direction_valid(rel.relationship_type::text, te.entity_type::text, fe.entity_type::text)
GROUP BY 1, 2, 3 ORDER BY n DESC;

-- 9. Archived/deleted-endpoint history (kept as-is; reported only)
SELECT count(*) AS rows_touching_archived_or_deleted_endpoints
FROM public.relationships rel
JOIN public.entities fe ON fe.id = rel.from_entity_id
JOIN public.entities te ON te.id = rel.to_entity_id
WHERE fe.is_archived OR te.is_archived OR fe.deleted_at IS NOT NULL OR te.deleted_at IS NOT NULL;

-- 10. (Only after phase1/002) canonical outcome of every live row as stored
-- SELECT o->>'outcome' AS outcome, o->>'reason' AS reason, count(*) AS n
-- FROM public.relationships rel
-- JOIN public.entities fe ON fe.id = rel.from_entity_id
-- JOIN public.entities te ON te.id = rel.to_entity_id
-- CROSS JOIN LATERAL public.relationship_policy_evaluate(rel.relationship_type::text,
--   fe.entity_type::text, te.entity_type::text, true) AS o
-- WHERE rel.deleted_at IS NULL AND fe.deleted_at IS NULL AND te.deleted_at IS NULL
--   AND NOT fe.is_archived AND NOT te.is_archived
-- GROUP BY 1, 2 ORDER BY n DESC;

-- 11. XPM jobs still active — must be 0 before applying anything
SELECT id, tenant_id, status, updated_at
FROM public.import_logs
WHERE status IN ('pending', 'processing');
