-- ROLLBACK REFERENCE for 015 (XPM group identity + provenance). Not applied.
-- Disables the new path without dropping any client data or columns.
-- 1. Redeploy the previous sync-xpm / import-xpm-group Edge Functions
--    (git revision before this change) so no caller uses the new RPCs.
-- 2. Stop the metadata-provenance trigger (columns stay; values untouched):
DROP TRIGGER IF EXISTS trg_relationships_metadata_source ON public.relationships;
-- 3. Remove the new routines (no data lives in them):
DROP FUNCTION IF EXISTS public.xpm_apply_group_reconciliation(uuid, text, text, text, jsonb, boolean, uuid, uuid);
DROP FUNCTION IF EXISTS public.xpm_group_reconcile_state(uuid, text, text, text[]);
DROP FUNCTION IF EXISTS public.xpm_apply_relationship_metadata(uuid, jsonb);
DROP FUNCTION IF EXISTS public._xpm_set_relationship_metadata(uuid, uuid, numeric, numeric);
-- 4. To restore the previous sync_xpm_link_group body, re-run its definition from
--    supabase/migrations/20260827185159_30dba549-eb42-4abb-b0d1-53b15ef78625.sql.
--    WARNING: the old body matches structures by name and is what this change fixed.
-- Columns structures.xpm_group_uuid, structure_*.membership_source/xpm_last_seen_at,
-- relationships.metadata_source/xpm_metadata_at are left in place (harmless).
