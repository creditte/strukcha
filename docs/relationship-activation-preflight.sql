-- ════════════════════════════════════════════════════════════════════
-- READ ONLY · NOT A MIGRATION · DO NOT PLACE IN supabase/migrations/
-- Rulebook v1 activation preflight. Every statement is a SELECT; nothing
-- here inserts, updates, deletes or creates anything. Run each block on its
-- own and record the counts in the activation log.
--
-- "current live" = rel.deleted_at IS NULL AND rel.end_date IS NULL AND both
--                  endpoints not deleted AND not archived. Only these rows
--                  are in scope for remediation.
-- "history"      = everything else: soft-deleted rows, ended rows (end_date
--                  set), or rows touching an archived/deleted endpoint.
--                  History is reported, never remediated by default.
--
-- LEGACY DIAGNOSTICS (blocks 4, 6, 8a) use the old rel_direction_valid() so
-- they can run before phase1/002. They are indicative only.
-- CANONICAL blocks (8b, 10) need phase1/002 and are AUTHORITATIVE. Do not run
-- them before 002 exists — they will error.
-- ════════════════════════════════════════════════════════════════════

-- 0. Base classification (soft-deleted / ended / archived-endpoint kept separate)
WITH r AS (
  SELECT rel.deleted_at IS NOT NULL AS soft_deleted,
         rel.deleted_at IS NULL AND rel.end_date IS NOT NULL AS ended,
         (fe.deleted_at IS NOT NULL OR te.deleted_at IS NOT NULL OR fe.is_archived OR te.is_archived) AS bad_endpoint,
         rel.source::text AS source
  FROM public.relationships rel
  JOIN public.entities fe ON fe.id = rel.from_entity_id
  JOIN public.entities te ON te.id = rel.to_entity_id
)
SELECT count(*) FILTER (WHERE NOT soft_deleted AND NOT ended AND NOT bad_endpoint) AS current_live,
       count(*) FILTER (WHERE NOT soft_deleted AND NOT ended AND NOT bad_endpoint AND source = 'imported') AS current_live_imported,
       count(*) FILTER (WHERE NOT soft_deleted AND NOT ended AND bad_endpoint) AS current_touching_archived_or_deleted,
       count(*) FILTER (WHERE ended) AS ended,
       count(*) FILTER (WHERE soft_deleted) AS soft_deleted
FROM r;

-- 1. Duplicate active Spouse facts (either orientation) — must be 0 before 010
--    (same predicate as the 010 index: not deleted, not ended)
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

-- 3. Child rows (not deleted, not ended): live vs archived-endpoint history,
--    ended separately, and current-live collisions with an existing Parent B → A
WITH c AS (
  SELECT rel.*,
         (fe.deleted_at IS NULL AND te.deleted_at IS NULL AND NOT fe.is_archived AND NOT te.is_archived) AS ok_endpoints
  FROM public.relationships rel
  JOIN public.entities fe ON fe.id = rel.from_entity_id
  JOIN public.entities te ON te.id = rel.to_entity_id
  WHERE rel.relationship_type::text = 'child' AND rel.deleted_at IS NULL
)
SELECT count(*) FILTER (WHERE end_date IS NULL) AS child_current,
       count(*) FILTER (WHERE end_date IS NULL AND ok_endpoints) AS current_live,
       count(*) FILTER (WHERE end_date IS NULL AND NOT ok_endpoints) AS history_endpoints,
       count(*) FILTER (WHERE end_date IS NOT NULL) AS ended,
       count(*) FILTER (WHERE end_date IS NULL AND ok_endpoints AND EXISTS (
         SELECT 1 FROM public.relationships p
         WHERE p.tenant_id = c.tenant_id AND p.deleted_at IS NULL AND p.end_date IS NULL
           AND p.relationship_type::text = 'parent'
           AND p.from_entity_id = c.to_entity_id AND p.to_entity_id = c.from_entity_id)) AS live_colliding_with_parent
FROM c;

-- 4. LEGACY DIAGNOSTIC — deterministic reversals by the OLD rules (current live only).
--    Authoritative answer: block 10 (outcome 'reverse').
SELECT rel.id, rel.tenant_id, rel.relationship_type::text AS t, fe.entity_type::text AS from_type, te.entity_type::text AS to_type
FROM public.relationships rel
JOIN public.entities fe ON fe.id = rel.from_entity_id
JOIN public.entities te ON te.id = rel.to_entity_id
WHERE rel.deleted_at IS NULL AND rel.end_date IS NULL
  AND fe.deleted_at IS NULL AND te.deleted_at IS NULL AND NOT fe.is_archived AND NOT te.is_archived
  AND rel.relationship_type::text NOT IN ('spouse', 'child', 'settlor')
  AND NOT public.rel_direction_valid(rel.relationship_type::text, fe.entity_type::text, te.entity_type::text)
  AND public.rel_direction_valid(rel.relationship_type::text, te.entity_type::text, fe.entity_type::text);

-- 5. Sole Trader as relationship source: current live / archived-endpoint history / ended / soft-deleted
SELECT rel.relationship_type::text AS t,
       count(*) FILTER (WHERE rel.deleted_at IS NULL AND rel.end_date IS NULL
                        AND fe.deleted_at IS NULL AND te.deleted_at IS NULL
                        AND NOT fe.is_archived AND NOT te.is_archived) AS current_live,
       count(*) FILTER (WHERE rel.deleted_at IS NULL AND rel.end_date IS NULL
                        AND (fe.deleted_at IS NOT NULL OR te.deleted_at IS NOT NULL
                             OR fe.is_archived OR te.is_archived)) AS history_endpoints,
       count(*) FILTER (WHERE rel.deleted_at IS NULL AND rel.end_date IS NOT NULL) AS ended,
       count(*) FILTER (WHERE rel.deleted_at IS NOT NULL) AS soft_deleted
FROM public.relationships rel
JOIN public.entities fe ON fe.id = rel.from_entity_id
JOIN public.entities te ON te.id = rel.to_entity_id
WHERE fe.entity_type::text = 'Sole Trader'
GROUP BY 1;

-- 6. LEGACY DIAGNOSTIC — rows invalid in both orientations by the OLD rules (current live only).
--    Authoritative answer: block 10 (outcome 'invalid').
SELECT rel.id, rel.tenant_id, rel.relationship_type::text AS t, fe.entity_type::text AS from_type, te.entity_type::text AS to_type
FROM public.relationships rel
JOIN public.entities fe ON fe.id = rel.from_entity_id
JOIN public.entities te ON te.id = rel.to_entity_id
WHERE rel.deleted_at IS NULL AND rel.end_date IS NULL
  AND fe.deleted_at IS NULL AND te.deleted_at IS NULL AND NOT fe.is_archived AND NOT te.is_archived
  AND rel.relationship_type::text NOT IN ('child', 'settlor')
  AND fe.entity_type::text NOT IN ('Trust', 'Unclassified', 'Sole Trader')
  AND te.entity_type::text NOT IN ('Trust', 'Unclassified')
  AND NOT public.rel_direction_valid(rel.relationship_type::text, fe.entity_type::text, te.entity_type::text)
  AND NOT public.rel_direction_valid(rel.relationship_type::text, te.entity_type::text, fe.entity_type::text);

-- 7. Review backlog: Generic Trust / Unclassified live entities and current-live links touching them
WITH kinds AS (
  SELECT 'Trust'::text AS t UNION ALL SELECT 'Unclassified'
), ents AS (
  SELECT entity_type::text AS t, count(*) AS live_entities
  FROM public.entities
  WHERE deleted_at IS NULL AND NOT is_archived AND entity_type::text IN ('Trust', 'Unclassified')
  GROUP BY 1
), live_rels AS (
  SELECT fe.entity_type::text AS ft, te.entity_type::text AS tt
  FROM public.relationships rel
  JOIN public.entities fe ON fe.id = rel.from_entity_id
  JOIN public.entities te ON te.id = rel.to_entity_id
  WHERE rel.deleted_at IS NULL AND rel.end_date IS NULL
    AND fe.deleted_at IS NULL AND te.deleted_at IS NULL AND NOT fe.is_archived AND NOT te.is_archived
), rels AS (
  SELECT k.t, count(lr.ft) AS current_live_relationships
  FROM kinds k
  LEFT JOIN live_rels lr ON lr.ft = k.t OR lr.tt = k.t
  GROUP BY k.t
)
SELECT k.t AS entity_type,
       coalesce(e.live_entities, 0) AS live_entities,
       coalesce(r.current_live_relationships, 0) AS current_live_relationships
FROM kinds k
LEFT JOIN ents e ON e.t = k.t
LEFT JOIN rels r ON r.t = k.t
ORDER BY 1;

-- 8a. LEGACY DIAGNOSTIC — imported current-live rows where the OLD rules accept
--     both orientations. Overstates ambiguity (old rules accept e.g. Parent and
--     Generic Trust links both ways). Indicative only; use 8b after 002.
SELECT rel.relationship_type::text AS t, fe.entity_type::text AS from_type, te.entity_type::text AS to_type, count(*) AS n
FROM public.relationships rel
JOIN public.entities fe ON fe.id = rel.from_entity_id
JOIN public.entities te ON te.id = rel.to_entity_id
WHERE rel.source::text = 'imported' AND rel.deleted_at IS NULL AND rel.end_date IS NULL
  AND fe.deleted_at IS NULL AND te.deleted_at IS NULL AND NOT fe.is_archived AND NOT te.is_archived
  AND rel.relationship_type::text NOT IN ('spouse')
  AND public.rel_direction_valid(rel.relationship_type::text, fe.entity_type::text, te.entity_type::text)
  AND public.rel_direction_valid(rel.relationship_type::text, te.entity_type::text, fe.entity_type::text)
GROUP BY 1, 2, 3 ORDER BY n DESC;

-- 8b. CANONICAL — REQUIRES phase1/002. DO NOT RUN BEFORE 002 EXISTS.
--     Imported current-live rows whose direction the policy cannot decide.
-- SELECT rel.relationship_type::text AS t, fe.entity_type::text AS from_type, te.entity_type::text AS to_type, count(*) AS n
-- FROM public.relationships rel
-- JOIN public.entities fe ON fe.id = rel.from_entity_id
-- JOIN public.entities te ON te.id = rel.to_entity_id
-- CROSS JOIN LATERAL public.relationship_policy_evaluate(rel.relationship_type::text,
--   fe.entity_type::text, te.entity_type::text, false) AS o
-- WHERE rel.source::text = 'imported' AND rel.deleted_at IS NULL AND rel.end_date IS NULL
--   AND fe.deleted_at IS NULL AND te.deleted_at IS NULL AND NOT fe.is_archived AND NOT te.is_archived
--   AND o->>'policy_reason' IS NULL AND o->>'reason' = 'ambiguous_direction'
-- GROUP BY 1, 2, 3 ORDER BY n DESC;

-- 9. History: rows touching archived/deleted endpoints (current vs ended vs soft-deleted). Reported only.
SELECT count(*) FILTER (WHERE rel.deleted_at IS NULL AND rel.end_date IS NULL) AS current_rows,
       count(*) FILTER (WHERE rel.deleted_at IS NULL AND rel.end_date IS NOT NULL) AS ended_rows,
       count(*) FILTER (WHERE rel.deleted_at IS NOT NULL) AS soft_deleted_rows
FROM public.relationships rel
JOIN public.entities fe ON fe.id = rel.from_entity_id
JOIN public.entities te ON te.id = rel.to_entity_id
WHERE fe.is_archived OR te.is_archived OR fe.deleted_at IS NOT NULL OR te.deleted_at IS NOT NULL;

-- 10. CANONICAL — REQUIRES phase1/002. DO NOT RUN BEFORE 002 EXISTS. AUTHORITATIVE.
--     Outcome of every current-live row exactly as stored.
-- SELECT o->>'outcome' AS outcome, o->>'reason' AS reason, count(*) AS n
-- FROM public.relationships rel
-- JOIN public.entities fe ON fe.id = rel.from_entity_id
-- JOIN public.entities te ON te.id = rel.to_entity_id
-- CROSS JOIN LATERAL public.relationship_policy_evaluate(rel.relationship_type::text,
--   fe.entity_type::text, te.entity_type::text, true) AS o
-- WHERE rel.deleted_at IS NULL AND rel.end_date IS NULL
--   AND fe.deleted_at IS NULL AND te.deleted_at IS NULL AND NOT fe.is_archived AND NOT te.is_archived
-- GROUP BY 1, 2 ORDER BY n DESC;

-- 11. XPM jobs still active — must be 0 before applying anything
SELECT id, tenant_id, status, updated_at
FROM public.import_logs
WHERE status IN ('pending', 'processing');
