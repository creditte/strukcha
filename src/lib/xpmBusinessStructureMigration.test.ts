// @vitest-environment node
import { describe, it, expect } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { xpmBusinessStructureFields } from "../../supabase/functions/_shared/xpm-business-structure";

// Exercise the actual migration's label-write blocks on an isolated in-memory database.
// These fixture RPCs omit unrelated diagram/relationship/billing work; no production data is written.
describe("XPM original-label persistence migration", () => {
  it("saves future import/sync wording with tenant isolation and preserves existing kinds and unknown labels", async () => {
    const db = new PGlite();
    const tenant = "00000000-0000-0000-0000-000000000001";
    const other = "00000000-0000-0000-0000-000000000002";
    await db.exec(`
      CREATE TABLE public.entities (id uuid, tenant_id uuid, name text, xpm_uuid text, entity_type text);
      INSERT INTO public.entities VALUES ('00000000-0000-0000-0000-000000000003', '${tenant}', 'Fictional Trust', 'fixture-client', 'trust_family'), ('00000000-0000-0000-0000-000000000004', '${other}', 'Fictional Trust', 'fixture-client', 'trust_unit');
      CREATE FUNCTION public.import_xpm_batch(_tenant_id uuid, _payload jsonb) RETURNS jsonb LANGUAGE plpgsql AS $f$
      BEGIN
        CREATE TEMP TABLE _w (name text, entity_id uuid);
        INSERT INTO _w SELECT e.name, e.id FROM entities e WHERE e.tenant_id = _tenant_id;
  CREATE TEMP TABLE _g (name text PRIMARY KEY, structure_id uuid) ON COMMIT DROP;
        DROP TABLE _w; DROP TABLE _g; RETURN '{}'::jsonb;
      END $f$;
      CREATE FUNCTION public.sync_xpm_upsert_clients(_tenant_id uuid, _payload jsonb) RETURNS jsonb LANGUAGE plpgsql AS $f$
      BEGIN
        CREATE TEMP TABLE _c (uuid text, entity_id uuid);
        INSERT INTO _c SELECT e.xpm_uuid, e.id FROM entities e WHERE e.tenant_id = _tenant_id;
  -- ── Rulebook v1 (Phase 2) · dual contract ──
        DROP TABLE _c; RETURN '{}'::jsonb;
      END $f$;`);
    await db.exec(readFileSync("drizzle/migrations/0010_preserve_xpm_business_structure_label.sql", "utf8"));
    expect((await db.query<{ count: number }>("SELECT count(*)::int AS count FROM entities WHERE xpm_business_structure_label IS NOT NULL")).rows[0].count).toBe(0);
    await db.query("SELECT public.import_xpm_batch($1, $2)", [tenant, { entities: [{ name: "Fictional Trust", ...xpmBusinessStructureFields("Custom Family Settlement") }] }]);
    let rows = (await db.query<{ entity_type: string; xpm_business_structure_label: string | null }>("SELECT entity_type, xpm_business_structure_label FROM entities ORDER BY tenant_id")).rows;
    expect(rows).toEqual([{ entity_type: "trust_family", xpm_business_structure_label: "Custom Family Settlement" }, { entity_type: "trust_unit", xpm_business_structure_label: null }]);
    await db.query("SELECT public.sync_xpm_upsert_clients($1, $2)", [tenant, { clients: [{ uuid: "fixture-client", ...xpmBusinessStructureFields("Trust") }] }]);
    await db.query("SELECT public.sync_xpm_upsert_clients($1, $2)", [tenant, { clients: [{ uuid: "fixture-client" }], related: [{ uuid: "fixture-client", xpm_business_structure_label: "Must not use name-only mentions" }] }]);
    rows = (await db.query<{ entity_type: string; xpm_business_structure_label: string | null }>("SELECT entity_type, xpm_business_structure_label FROM entities ORDER BY tenant_id")).rows;
    expect(rows).toEqual([{ entity_type: "trust_family", xpm_business_structure_label: "Trust" }, { entity_type: "trust_unit", xpm_business_structure_label: null }]);
    await db.close();
  });
});