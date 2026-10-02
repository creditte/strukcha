/**
 * Offline SQL parity + staged-migration check for the relationship policy.
 *
 * Runs entirely in an in-memory Postgres (PGlite, a dev-only dependency).
 * It never connects to the project database.
 *
 *   bun scripts/relationship-policy-sql-check.ts
 *
 * 1. Applies the pending Phase 1 / Phase 2 SQL to a minimal stub schema.
 * 2. Checks every shared vector against public.relationship_policy_evaluate().
 * 3. Checks every type × entity × entity × direction combination against the
 *    TypeScript evaluator.
 * 4. Smoke-tests the staged trigger and XPM batch functions.
 */
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { evaluateRelationship } from "../supabase/functions/_shared/relationship-policy.ts";

const root = join(import.meta.dir, "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

const STUB = `
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE SCHEMA auth; CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT NULL::uuid $$;
CREATE TYPE public.relationship_type AS ENUM ('director','shareholder','beneficiary','trustee','appointer','settlor','partner','spouse','parent','child','member','unit_holder');
CREATE TYPE public.entity_type AS ENUM ('Individual','Company','Trust','Partnership','Sole Trader','Incorporated Association/Club','Unclassified','trust_discretionary','trust_unit','trust_hybrid','trust_bare','trust_testamentary','trust_deceased_estate','trust_family','smsf');
CREATE TABLE public.tenants (id uuid PRIMARY KEY DEFAULT gen_random_uuid());
CREATE TABLE public.entities (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid, name text, entity_type entity_type NOT NULL DEFAULT 'Unclassified', xpm_uuid text, abn text, acn text, is_trustee_company boolean NOT NULL DEFAULT false, is_archived boolean NOT NULL DEFAULT false, source text, deleted_at timestamptz, created_at timestamptz DEFAULT now());
CREATE UNIQUE INDEX ON public.entities (tenant_id, xpm_uuid) WHERE xpm_uuid IS NOT NULL AND deleted_at IS NULL;
CREATE TABLE public.relationships (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid, from_entity_id uuid, to_entity_id uuid, relationship_type relationship_type, start_date date, end_date date, source text, confidence text, ownership_percent numeric, deleted_at timestamptz, updated_at timestamptz);
CREATE TABLE public.structures (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid, name text, deleted_at timestamptz, created_at timestamptz DEFAULT now());
CREATE TABLE public.structure_entities (structure_id uuid, entity_id uuid, PRIMARY KEY (structure_id, entity_id));
CREATE TABLE public.structure_relationships (structure_id uuid, relationship_id uuid, PRIMARY KEY (structure_id, relationship_id));
CREATE FUNCTION public.get_user_tenant_id(uuid) RETURNS uuid LANGUAGE sql AS $$ SELECT NULL::uuid $$;
CREATE FUNCTION public.is_super_admin() RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
CREATE FUNCTION public.is_owner_or_admin(uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
CREATE FUNCTION public.update_updated_at_column() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END $$;
CREATE FUNCTION public.tenant_structure_capacity(uuid) RETURNS jsonb LANGUAGE sql AS $$ SELECT '{"enforced":false,"accessEnabled":true}'::jsonb $$;
CREATE FUNCTION public.validate_relationship_rules() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$;
CREATE TRIGGER validate_relationship_rules BEFORE INSERT OR UPDATE ON public.relationships FOR EACH ROW EXECUTE FUNCTION public.validate_relationship_rules();
`;

const PENDING = [
  "supabase/pending-migrations/phase1/001_add_trades_as_enum.sql",
  "supabase/pending-migrations/phase1/002_relationship_policy_foundation.sql",
  "supabase/pending-migrations/phase2/011_evidence_columns.sql",
  "supabase/pending-migrations/phase2/012_activate_policy_trigger.sql",
  "supabase/pending-migrations/phase2/013_xpm_batch_functions_policy.sql",
];

const TYPES = ["Individual", "Company", "Partnership", "Sole Trader", "Incorporated Association/Club", "trust_discretionary", "trust_family", "trust_unit", "trust_hybrid", "trust_bare", "trust_testamentary", "trust_deceased_estate", "smsf", "Trust", "Unclassified"];
const RELS = ["director", "shareholder", "unit_holder", "trustee", "beneficiary", "member", "appointer", "partner", "spouse", "parent", "trades_as", "child", "settlor", "bogus"];

let failures = 0;
const fail = (msg: string) => { failures++; console.error("FAIL", msg); };

const db = new PGlite();
await db.exec(STUB);
for (const f of PENDING) {
  try { await db.exec(read(f)); console.log("applied (in memory):", f); }
  catch (e) { fail(`${f}: ${(e as Error).message}`); }
}
// Uniqueness indexes: CONCURRENTLY must run outside a transaction, one statement at a time.
for (const stmt of read("supabase/pending-migrations/phase2/010_activate_uniqueness_constraints.sql").split(";").map((s) => s.replace(/--.*$/gm, "").trim()).filter(Boolean)) {
  try { await db.query(stmt); } catch (e) { fail(`010: ${(e as Error).message}`); }
}
console.log("applied (in memory): phase2/010 uniqueness indexes");

const evalSql = async (t: string, f: string, g: string, d: boolean) =>
  (await db.query<{ r: Record<string, unknown> }>("SELECT public.relationship_policy_evaluate($1,$2,$3,$4) r", [t, f, g, d])).rows[0].r;

// 2. vectors
const vectors = JSON.parse(read("src/test/fixtures/relationship-policy-vectors.json")).vectors;
let vOk = 0;
for (const v of vectors) {
  const r = await evalSql(v.type, v.from, v.to, v.directionKnown ?? true);
  if (r.outcome === v.outcome && r.reason === v.reason && r.canonical_type === v.canonicalType && r.swapped === v.swapped) vOk++;
  else fail(`vector ${JSON.stringify(v)} → ${JSON.stringify(r)}`);
}
console.log(`vectors: ${vOk}/${vectors.length} match`);

// 3. exhaustive
let n = 0, same = 0;
for (const t of RELS) for (const f of TYPES) for (const g of TYPES) for (const d of [true, false]) {
  n++;
  const a = evaluateRelationship(t, f, g, { directionKnown: d });
  const b = await evalSql(t, f, g, d);
  if (a.outcome === b.outcome && a.reason === b.reason && a.swapped === b.swapped && a.canonicalType === b.canonical_type && a.fromType === b.from_type && a.toType === b.to_type) same++;
  else if (n - same <= 5) fail(`${t} ${f}→${g} dir=${d}: ts=${JSON.stringify(a)} sql=${JSON.stringify(b)}`);
}
if (same !== n) failures++;
console.log(`exhaustive: ${same}/${n} identical TS vs SQL`);

// 4. smoke: trigger + batch functions
const q = async (sql: string, p: unknown[] = []) => (await db.query<Record<string, unknown>>(sql, p)).rows;
const [{ id: tenant }] = await q("INSERT INTO tenants DEFAULT VALUES RETURNING id");
const ent = async (name: string, type: string, xpm: string | null = null) =>
  (await q("INSERT INTO entities (tenant_id,name,entity_type,xpm_uuid) VALUES ($1,$2,$3,$4) RETURNING id", [tenant, name, type, xpm]))[0].id as string;
const p = await ent("Pat", "Individual", "x-p");
const c = await ent("Co Pty Ltd", "Company", "x-c");
const g = await ent("Some Trust", "Trust", "x-g");
const ins = (t: string, a: string, b: string) => q("INSERT INTO relationships (tenant_id,from_entity_id,to_entity_id,relationship_type) VALUES ($1,$2,$3,$4)", [tenant, a, b, t]);
const expectReject = async (label: string, fn: () => Promise<unknown>) => { try { await fn(); fail(`trigger accepted ${label}`); } catch { /* expected */ } };
await ins("director", p, c);
await expectReject("reversed director", () => ins("director", c, p));
await expectReject("review trustee → generic trust", () => ins("trustee", c, g));
await expectReject("settlor", () => ins("settlor", p, g));
const [{ id: legacy }] = await q("SELECT id FROM relationships LIMIT 1");
await q("UPDATE relationships SET ownership_percent = 10 WHERE id = $1", [legacy]); // metadata-only edit allowed
await q("UPDATE relationships SET deleted_at = now() WHERE id = $1", [legacy]); // soft delete allowed
console.log("trigger: rejects non-canonical rows, allows metadata edits and soft deletes");

const sync = await q("SELECT public.sync_xpm_upsert_clients($1,$2) r", [tenant, JSON.stringify({
  clients: [{ uuid: "x-p", name: "Pat", entity_type: "Individual" }, { uuid: "x-c", name: "Co Pty Ltd", entity_type: "Company" }, { uuid: "x-q", name: "Quinn", entity_type: "Individual" }],
  rels: [{ type: "director", from_uuid: "x-p", to_uuid: "x-c" }, { type: "spouse", from_uuid: "x-q", to_uuid: "x-p" }, { type: "director", from_uuid: "x-c", to_uuid: "x-p" }],
  evidence: [{ raw_relationship_label: "Director Of", raw_from_identifier: "x-p", raw_to_identifier: "x-c", proposed_from_entity_id: "x-p", proposed_to_entity_id: "x-c", canonical_type: "director", canonical_from_entity_id: "x-p", canonical_to_entity_id: "x-c", policy_outcome: "valid", policy_reason: "valid", review_status: "not_required" }],
})]);
const sr = sync[0].r as Record<string, number>;
if (sr.relationshipsCreated !== 2 || sr.relationshipsSkipped !== 1) fail(`sync result ${JSON.stringify(sr)}`);
const ev = await q("SELECT relationship_id FROM relationship_import_evidence WHERE import_source = 'xpm_sync'");
if (ev.length !== 1 || !ev[0].relationship_id) fail(`sync evidence ${JSON.stringify(ev)}`);
console.log("sync_xpm_upsert_clients v2:", JSON.stringify(sr));

const imp = await q("SELECT public.import_xpm_batch($1,$2) r", [tenant, JSON.stringify({
  entities: [{ name: "Pat", uuid: "x-p", entity_type: "Individual" }, { name: "Kid", entity_type: "Individual" }, { name: "Co Pty Ltd", uuid: "x-c", entity_type: "Company" }, { name: "Some Trust", uuid: "x-g", entity_type: "Trust" }],
  groups: [], members: [],
  rels: [
    { row: 1, type: "child", from_key: "Kid", to_key: "Pat", label: "Child Of" },
    { row: 2, type: "director", from_key: "Co Pty Ltd", to_key: "Pat", label: "Director" },
    { row: 3, type: "trustee", from_key: "Co Pty Ltd", to_key: "Some Trust", label: "Trustee Of" },
    { row: 4, type: "settlor", from_key: "Pat", to_key: "Some Trust", label: "Settlor Of" },
  ],
})]);
const ir = imp[0].r as Record<string, number>;
const parent = await q("SELECT 1 FROM relationships r JOIN entities a ON a.id=r.from_entity_id JOIN entities b ON b.id=r.to_entity_id WHERE r.relationship_type='parent' AND a.name='Pat' AND b.name='Kid'");
if (parent.length !== 1) fail("CSV child → parent not created");
const csvEv = await q("SELECT policy_outcome, review_status FROM relationship_import_evidence WHERE import_source='xpm_csv' ORDER BY policy_outcome");
if (csvEv.length !== 4) fail(`CSV evidence rows ${csvEv.length}`);
console.log("import_xpm_batch v2:", JSON.stringify({ created: ir.relationshipsCreated, skipped: ir.relationshipsSkipped, evidence: csvEv }));

await db.close();
if (failures) { console.error(`\n${failures} failure(s)`); process.exit(1); }
console.log("\nAll SQL checks passed (in-memory only; nothing was applied to any real database).");
