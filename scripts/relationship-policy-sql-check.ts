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
 * 4. Transition profile: with a stand-in for the still-live legacy trigger,
 *    applies 001, 002, 011, 013 only and smoke-tests the LEGACY payloads
 *    (today's Edge Functions) and the CANONICAL payloads (built with the real
 *    xpm-policy-normalise.ts), incl. evidence exactly once and retries.
 * 5. Applies 012 last and smoke-tests the canonical trigger, then 010.
 */
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { evaluateRelationship } from "../supabase/functions/_shared/relationship-policy.ts";
import { normaliseXpmBatch, type XpmRawRelationship } from "../supabase/functions/_shared/xpm-policy-normalise.ts";

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
-- Stand-in for the live legacy trigger: refuses a row the old rules reject
-- (trades_as is used as the representative). Replaced by phase2/012.
CREATE FUNCTION public.validate_relationship_rules() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  IF NEW.relationship_type::text = 'trades_as' THEN RAISE EXCEPTION 'legacy rules: invalid relationship'; END IF;
  RETURN NEW; END $$;
CREATE TRIGGER validate_relationship_rules BEFORE INSERT OR UPDATE ON public.relationships FOR EACH ROW EXECUTE FUNCTION public.validate_relationship_rules();
`;

const BRIDGE = [
  "supabase/pending-migrations/phase1/001_add_trades_as_enum.sql",
  "supabase/pending-migrations/phase1/002_relationship_policy_foundation.sql",
  "supabase/pending-migrations/phase2/011_evidence_columns.sql",
  "supabase/pending-migrations/phase2/013_xpm_batch_functions_policy.sql",
];

const TYPES = ["Individual", "Company", "Partnership", "Sole Trader", "Incorporated Association/Club", "trust_discretionary", "trust_family", "trust_unit", "trust_hybrid", "trust_bare", "trust_testamentary", "trust_deceased_estate", "smsf", "Trust", "Unclassified"];
const RELS = ["director", "shareholder", "unit_holder", "trustee", "beneficiary", "member", "appointer", "partner", "spouse", "parent", "trades_as", "child", "settlor", "bogus"];

let failures = 0;
const fail = (msg: string) => { failures++; console.error("FAIL", msg); };
const check = (cond: unknown, msg: string) => { if (!cond) fail(msg); };

const db = new PGlite();
await db.exec(STUB);
for (const f of BRIDGE) {
  try { await db.exec(read(f)); console.log("applied (in memory):", f); }
  catch (e) { fail(`${f}: ${(e as Error).message}`); }
}

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

// 4. transition smoke (legacy trigger stand-in still active, 012 NOT applied)
const q = async (sql: string, p: unknown[] = []) => (await db.query<Record<string, unknown>>(sql, p)).rows;
const [{ id: tenant }] = await q("INSERT INTO tenants DEFAULT VALUES RETURNING id");
const ent = async (name: string, type: string, xpm: string | null = null, archived = false) =>
  (await q("INSERT INTO entities (tenant_id,name,entity_type,xpm_uuid,is_archived) VALUES ($1,$2,$3,$4,$5) RETURNING id", [tenant, name, type, xpm, archived]))[0].id as string;
const p = await ent("Pat", "Individual", "x-p");
const qn = await ent("Quinn", "Individual", "x-q");
const c = await ent("Co Pty Ltd", "Company", "x-c");
const g = await ent("Some Trust", "Trust", "x-g");
const f = await ent("Firm", "Partnership", "x-f");
const a = await ent("Archie", "Individual", "x-a", true);
const k = await ent("Kid", "Individual", "x-k");
const st = await ent("Pat Trading", "Sole Trader", "x-s");
const TYPE_BY_UUID: Record<string, string> = { "x-p": "Individual", "x-q": "Individual", "x-c": "Company", "x-g": "Trust", "x-f": "Partnership", "x-a": "Individual", "x-k": "Individual", "x-s": "Sole Trader" };
const NAME_BY_UUID: Record<string, string> = { "x-p": "Pat", "x-q": "Quinn", "x-c": "Co Pty Ltd", "x-g": "Some Trust", "x-f": "Firm", "x-a": "Archie", "x-k": "Kid", "x-s": "Pat Trading" };
const clients = Object.keys(TYPE_BY_UUID).map((u) => ({ uuid: u, name: NAME_BY_UUID[u], entity_type: TYPE_BY_UUID[u], is_archived: u === "x-a" }));
const rels = async (type: string, from: string, to: string) =>
  (await q("SELECT id, start_date, end_date, deleted_at FROM relationships WHERE tenant_id=$1 AND relationship_type=$2 AND from_entity_id=$3 AND to_entity_id=$4 ORDER BY deleted_at NULLS FIRST", [tenant, type, from, to]));
const sync = async (payload: unknown) => (await q("SELECT public.sync_xpm_upsert_clients($1,$2) r", [tenant, JSON.stringify(payload)]))[0].r as Record<string, any>;
const batch = async (payload: unknown) => (await q("SELECT public.import_xpm_batch($1,$2) r", [tenant, JSON.stringify(payload)]))[0].r as Record<string, any>;
const evCount = async (run: string) => Number((await q("SELECT count(*) n FROM relationship_import_evidence WHERE import_run_id=$1", [run]))[0].n);

// History: a soft-deleted fact must stay deleted and never be resurrected.
await q("INSERT INTO relationships (tenant_id,from_entity_id,to_entity_id,relationship_type,deleted_at) VALUES ($1,$2,$3,'director',now())", [tenant, qn, c]);

// 4a. LEGACY sync contract (today's sync-xpm payload: no evidence)
const RUN1 = "00000000-0000-0000-0000-000000000001";
const legacySync = {
  import_run_id: RUN1, clients,
  rels: [
    { type: "director", from_uuid: "x-p", to_uuid: "x-c" },
    { type: "director", from_uuid: "x-c", to_uuid: "x-p" },                 // wrong hint → reverse, dedupes with above
    { type: "spouse", from_uuid: "x-q", to_uuid: "x-p" },
    { type: "spouse", from_uuid: "x-p", to_uuid: "x-q" },                   // same unordered fact
    { type: "partner", from_uuid: "x-f", to_uuid: "x-p" },                  // legacy hint wrong → reversed, never sorted
    { type: "trustee", from_uuid: "x-c", to_uuid: "x-g" },                  // generic trust → review
    { type: "director", from_uuid: "x-a", to_uuid: "x-c", start_date: "2020-01-01" }, // archived endpoint
    { type: "director", from_uuid: "x-q", to_uuid: "x-c", start_date: "2019-05-01" }, // deleted history exists
    { type: "child", from_uuid: "x-k", to_uuid: "x-p" },                    // → parent p → k
    { type: "director", from_uuid: "x-p", to_uuid: "x-missing" },           // unresolved
  ],
};
const ls = await sync(legacySync);
check(ls.contract === "legacy", `legacy sync contract ${ls.contract}`);
check(ls.evidenceWritten === 10, `legacy sync evidence ${ls.evidenceWritten}`);
check((await rels("director", p, c)).length === 1, "legacy director p→c once");
check((await rels("director", c, p)).length === 0, "legacy reversed director not stored");
const sp = (await rels("spouse", p, qn)).length + (await rels("spouse", qn, p)).length;
check(sp === 1, `legacy spouse unordered once (${sp})`);
check((await rels("partner", p, f)).length === 1 && (await rels("partner", f, p)).length === 0, "legacy partner p→f only");
check((await rels("trustee", c, g)).length === 0, "legacy review row not inserted");
check((await rels("director", a, c)).length === 1, "archived endpoint relationship kept");
check((await rels("parent", p, k)).length === 1 && (await rels("child", k, p)).length === 0, "legacy child → parent");
const qc = await rels("director", qn, c);
check(qc.length === 2 && qc[0].deleted_at === null && qc[1].deleted_at !== null && qc[1].start_date === null, "deleted history not resurrected or edited");
check(ls.relationshipsCreated === 6, `legacy sync created ${ls.relationshipsCreated}`);
const ls2 = await sync({ ...legacySync, rels: [...legacySync.rels, { type: "director", from_uuid: "x-q", to_uuid: "x-c", end_date: "2024-06-30" }] });
check(ls2.relationshipsCreated === 0, `legacy retry created ${ls2.relationshipsCreated}`);
check(ls2.evidenceWritten === 0, `legacy retry evidence ${ls2.evidenceWritten} (same raw facts, same run)`);
check(await evCount(RUN1) === 10, "legacy evidence exactly once per raw fact across retries");
const live = (await rels("director", qn, c))[0];
check(String(live.start_date).startsWith("2019") || live.start_date instanceof Date, "start_date kept");
check(live.end_date !== null, "missing end_date filled on existing fact");
const lr = await q("SELECT review_status, relationship_id FROM relationship_import_evidence WHERE import_run_id=$1 AND raw_relationship_label='trustee'", [RUN1]);
check(lr.length === 1 && lr[0].review_status === "pending" && lr[0].relationship_id === null, "legacy review evidence pending, unlinked");
console.log("legacy sync contract:", JSON.stringify({ created: ls.relationshipsCreated, skipped: ls.relationshipsSkipped, reoriented: ls.relationshipsReoriented, evidence: ls.evidenceWritten }));

// 4b. CANONICAL sync contract (planned Edge payload via xpm-policy-normalise.ts)
const RUN2 = "00000000-0000-0000-0000-000000000002";
const raws: XpmRawRelationship[] = [
  { label: "Partner", clientId: "x-f", relatedId: "x-q" },      // on the firm's record → Quinn → Firm
  { label: "Spouse", clientId: "x-q", relatedId: "x-p" },       // existing fact, either order
  { label: "Spouse", clientId: "x-p", relatedId: "x-q" },
  { label: "Trustee Of", clientId: "x-c", relatedId: "x-g" },   // review
  { label: "Settlor Of", clientId: "x-p", relatedId: "x-g" },   // deprecated
  { label: "Weird Label", clientId: "x-p", relatedId: "x-c" },  // unknown → invalid evidence
  { label: "Child Of", clientId: "x-k", relatedId: "x-q" },     // → parent q → k
  { label: "Trades As", clientId: "x-s", relatedId: "x-p" },    // valid, refused by legacy trigger stand-in
];
const norm = normaliseXpmBatch(raws, { entityTypes: new Map(Object.entries(TYPE_BY_UUID)) });
const canonSync = {
  import_run_id: RUN2, clients,
  rels: [...norm.edges.map((e) => ({ type: e.type, from_uuid: e.fromId, to_uuid: e.toId })),
    { type: "director", from_uuid: "x-c", to_uuid: "x-k" }],   // caller bug: not canonical as sent
  evidence: norm.evidence,
};
const cs = await sync(canonSync);
check(cs.contract === "canonical_v1", "canonical sync contract");
check(cs.evidenceWritten === raws.length, `canonical evidence ${cs.evidenceWritten} ≠ ${raws.length} (no derived duplicates)`);
check((await rels("partner", qn, f)).length === 1 && (await rels("partner", f, qn)).length === 0, "canonical partner direction preserved");
const sp2 = (await rels("spouse", p, qn)).length + (await rels("spouse", qn, p)).length;
check(sp2 === 1, `canonical spouse still one fact (${sp2})`);
check((await rels("parent", qn, k)).length === 1, "canonical child → parent");
check((await rels("director", c, k)).length === 0 && (await rels("director", k, c)).length === 0, "non-canonical rel never inserted or flipped");
check((await rels("trustee", c, g)).length === 0 && (await rels("settlor", p, g)).length === 0, "review/deprecated not inserted");
const ce = Object.fromEntries((await q("SELECT raw_relationship_label l, policy_outcome o, review_status s, relationship_id r FROM relationship_import_evidence WHERE import_run_id=$1 AND raw_relationship_label <> 'Spouse'", [RUN2])).map((r) => [r.l, r]));
check(ce["Partner"]?.r && ce["Partner"].s === "not_required", "partner evidence linked");
check(ce["Trustee Of"]?.s === "pending" && !ce["Trustee Of"].r, "review evidence pending");
check(ce["Settlor Of"]?.o === "deprecated" && ce["Settlor Of"].s === "rejected", "settlor evidence rejected");
check(ce["Weird Label"]?.o === "invalid", "unknown label kept as evidence");
check(ce["Trades As"]?.s === "pending" && !ce["Trades As"].r, "refused row (legacy trigger) → evidence pending, chunk survives");
const cs2 = await sync(canonSync);
check(cs2.evidenceWritten === 0 && cs2.relationshipsCreated === 0, `canonical retry wrote ${cs2.evidenceWritten}/${cs2.relationshipsCreated}`);
console.log("canonical sync contract:", JSON.stringify({ created: cs.relationshipsCreated, skipped: cs.relationshipsSkipped, evidence: cs.evidenceWritten }));

// 4c. LEGACY CSV contract (today's import-xpm payload)
const entities = Object.keys(NAME_BY_UUID).map((u) => ({ name: NAME_BY_UUID[u], uuid: u, entity_type: TYPE_BY_UUID[u] })).concat([{ name: "Newbie", uuid: "", entity_type: "Individual" }]);
const RUN3 = "00000000-0000-0000-0000-000000000003";
const li = await batch({
  import_run_id: RUN3, entities, groups: ["G1"], members: [{ grp: "G1", ent: "Pat" }, { grp: "G1", ent: "Newbie" }],
  rels: [
    { row: 1, type: "child", from_key: "Newbie", to_key: "Pat", label: "Child Of", groups: ["G1"] },
    { row: 2, type: "director", from_key: "Co Pty Ltd", to_key: "Pat", label: "Director", groups: ["G1"] },
    { row: 3, type: "trustee", from_key: "Co Pty Ltd", to_key: "Some Trust", label: "Trustee Of", groups: ["G1"] },
    { row: 4, type: "settlor", from_key: "Pat", to_key: "Some Trust", label: "Settlor Of", groups: ["G1"] },
    { row: 5, type: "partner", from_key: "Firm", to_key: "Archie", label: "Partner", groups: ["G1"] },
  ],
});
const newbie = (await q("SELECT id FROM entities WHERE name='Newbie'"))[0]?.id as string;
check(li.contract === "legacy" && li.evidenceWritten === 5, `legacy CSV evidence ${li.evidenceWritten}`);
check(li.structuresCreated === 1, "legacy CSV structure/group behaviour unchanged");
check((await rels("parent", p, newbie)).length === 1, "CSV child → parent");
check((await rels("partner", a, f)).length === 1 && (await rels("partner", f, a)).length === 0, "CSV partner reversed once, not sorted");
check((await rels("trustee", c, g)).length === 0, "CSV review not inserted");
const sr = await q("SELECT count(*) n FROM structure_relationships");
check(Number(sr[0].n) >= 3, "CSV structure links for canonical rows");
const li2 = await batch({ import_run_id: RUN3, entities, groups: ["G1"], members: [], rels: [{ row: 1, type: "child", from_key: "Newbie", to_key: "Pat", label: "Child Of", groups: ["G1"] }] });
check(li2.evidenceWritten === 0 && li2.relationshipsCreated === 0, "CSV retry evidence once");
console.log("legacy CSV contract:", JSON.stringify({ created: li.relationshipsCreated, skipped: li.relationshipsSkipped, evidence: li.evidenceWritten }));

// 4d. CANONICAL CSV contract (identifiers are client names)
const RUN4 = "00000000-0000-0000-0000-000000000004";
const nameTypes = new Map(entities.map((e) => [e.name, e.entity_type]));
const csvNorm = normaliseXpmBatch([
  { label: "Partner Of", clientId: "Quinn", relatedId: "Firm" },
  { label: "Beneficiary Of", clientId: "Pat", relatedId: "Some Trust" },
], { entityTypes: nameTypes });
const ci = await batch({
  import_run_id: RUN4, entities, groups: ["G2"], members: [{ grp: "G2", ent: "Quinn" }],
  rels: csvNorm.edges.map((e, i) => ({ row: i + 1, type: e.type, from_key: e.fromId, to_key: e.toId, label: e.type, groups: ["G2"] })),
  evidence: csvNorm.evidence,
});
check(ci.contract === "canonical_v1" && ci.evidenceWritten === 2 && (await evCount(RUN4)) === 2, `canonical CSV evidence ${ci.evidenceWritten}`);
check((await rels("beneficiary", p, g)).length === 0, "canonical CSV review not inserted");
const g2 = await q("SELECT count(*) n FROM structure_relationships sr JOIN structures s ON s.id=sr.structure_id WHERE s.name='G2'");
check(Number(g2[0].n) === 1, "canonical CSV links existing partner fact into the group");
console.log("canonical CSV contract:", JSON.stringify({ created: ci.relationshipsCreated, skipped: ci.relationshipsSkipped, evidence: ci.evidenceWritten }));

// 5. apply 012 last, then smoke the canonical trigger
try { await db.exec(read("supabase/pending-migrations/phase2/012_activate_policy_trigger.sql")); console.log("applied (in memory): phase2/012 (last)"); }
catch (e) { fail(`012: ${(e as Error).message}`); }
const ins = (t: string, x: string, y: string) => q("INSERT INTO relationships (tenant_id,from_entity_id,to_entity_id,relationship_type) VALUES ($1,$2,$3,$4)", [tenant, x, y, t]);
const expectReject = async (label: string, fn: () => Promise<unknown>) => { try { await fn(); fail(`trigger accepted ${label}`); } catch { /* expected */ } };
await ins("trades_as", p, st);
await expectReject("reversed director", () => ins("director", c, p));
await expectReject("review trustee → generic trust", () => ins("trustee", c, g));
await expectReject("settlor", () => ins("settlor", p, g));
const [{ id: legacy }] = (await rels("director", p, c)).filter((r) => r.deleted_at === null);
await q("UPDATE relationships SET ownership_percent = 10 WHERE id = $1", [legacy]); // metadata-only edit allowed
await q("UPDATE relationships SET deleted_at = now() WHERE id = $1", [legacy]); // soft delete allowed
console.log("trigger: rejects non-canonical rows, allows metadata edits and soft deletes");

// Uniqueness indexes: CONCURRENTLY must run outside a transaction, one statement at a time.
for (const stmt of read("supabase/pending-migrations/phase2/010_activate_uniqueness_constraints.sql").split(";").map((s) => s.replace(/--.*$/gm, "").trim()).filter(Boolean)) {
  try { await db.query(stmt); } catch (e) { fail(`010: ${(e as Error).message}`); }
}
await expectReject("second spouse fact", () => ins("spouse", qn, p));
console.log("applied (in memory): phase2/010 uniqueness indexes");

await db.close();
if (failures) { console.error(`\n${failures} failure(s)`); process.exit(1); }
console.log("\nAll SQL checks passed (in-memory only; nothing was applied to any real database).");
