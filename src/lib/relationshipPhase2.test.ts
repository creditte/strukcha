import { describe, it, expect } from "vitest";
import {
  POLICY_RULES,
  CREATABLE_RELATIONSHIP_TYPES,
  evaluateRelationship,
  getRelationshipOptions,
  toCanonicalEdge,
  policyMetadataFields,
} from "@/lib/relationshipPolicy";
import * as facade from "@/lib/relationshipRules";
import {
  planNewRelationship,
  planReverse,
  planTypeChange,
  pickTradesAsOwner,
  type PlanDeps,
  type ExistingRelationship,
  type TradesAsLookup,
} from "@/lib/manualRelationship";
import {
  parseXpmLabel,
  normaliseXpmRelationship,
  normaliseXpmBatch,
  classifyWithProvenance,
} from "../../supabase/functions/_shared/xpm-policy-normalise.ts";
import { resolveEntityType } from "../../supabase/functions/_shared/xpm-entity-type.ts";

const TYPES = [
  "Individual", "Company", "Partnership", "Sole Trader", "Incorporated Association/Club",
  "trust_discretionary", "trust_family", "trust_unit", "trust_hybrid", "trust_bare",
  "trust_testamentary", "trust_deceased_estate", "smsf", "Trust", "Unclassified",
];
const ALL_INPUT_TYPES = [...CREATABLE_RELATIONSHIP_TYPES, "child", "settlor", "secretary"];

// ── Facade parity ────────────────────────────────────────────────
describe("compatibility facade derives everything from the policy", () => {
  it("RELATIONSHIP_RULES is exactly the creatable set (no child/settlor)", () => {
    expect(facade.RELATIONSHIP_RULES.map((r) => r.type)).toEqual([...CREATABLE_RELATIONSHIP_TYPES]);
    expect(facade.RELATIONSHIP_RULES.map((r) => r.type)).not.toContain("child");
    expect(facade.RELATIONSHIP_RULES.map((r) => r.type)).not.toContain("settlor");
  });
  it("only spouse is reversible-by-symmetry", () => {
    expect(facade.RELATIONSHIP_RULES.filter((r) => r.allowReverse).map((r) => r.type)).toEqual(["spouse"]);
  });
  it("isDirectionValid / options / metadata match the evaluator for every combination", () => {
    for (const t of ALL_INPUT_TYPES) for (const f of TYPES) for (const g of TYPES) {
      const e = evaluateRelationship(t, f, g);
      expect(facade.isDirectionValid(t, f, g)).toBe(e.outcome === "valid");
      expect(facade.getDirectionError(t, f, g) === null).toBe(e.outcome === "valid");
      expect(facade.isReverseAllowed(t, f, g)).toBe(evaluateRelationship(t, g, f).outcome === "valid");
      const opt = facade.getValidRelationshipOptions([t], f, g)[0];
      if (!CREATABLE_RELATIONSHIP_TYPES.includes(t)) expect(opt).toBeUndefined();
      else if (e.outcome === "valid") expect(opt).toEqual({ type: t, needsReversal: false });
      else if (e.outcome === "reverse") expect(opt).toEqual({ type: t, needsReversal: true });
      else expect(opt).toBeUndefined();
      expect(facade.getEffectiveMetadataFields(t, g)).toEqual(policyMetadataFields(t, g));
    }
  });
  it("unknown types are default-deny; review is not valid", () => {
    expect(facade.isDirectionValid("secretary", "Individual", "Company")).toBe(false);
    expect(facade.isDirectionValid("director", "Unclassified", "Company")).toBe(false);
    expect(facade.isDirectionValid("trustee", "Company", "Trust")).toBe(false);
    expect(facade.getDirectionError("director", "Unclassified", "Company")).toMatch(/review/i);
  });
  it("Sole Trader resolves for shareholder, unit holder, trustee, beneficiary and partner only", () => {
    const targets: Record<string, string> = {
      shareholder: "Company", unit_holder: "trust_unit", trustee: "trust_discretionary",
      beneficiary: "trust_discretionary", partner: "Partnership",
    };
    for (const rule of POLICY_RULES) {
      const tgt = targets[rule.type];
      if (tgt) expect(evaluateRelationship(rule.type, "Sole Trader", tgt).outcome).toBe("resolve_sole_trader");
      else expect(rule.soleTraderResolves).toBe(false);
    }
  });
});

// ── Picker options ───────────────────────────────────────────────
describe("picker option generation", () => {
  it("never offers child, settlor, invalid or deprecated types", () => {
    for (const f of TYPES) for (const g of TYPES) {
      for (const o of getRelationshipOptions(f, g)) {
        expect(CREATABLE_RELATIONSHIP_TYPES).toContain(o.type);
        expect(["invalid", "deprecated"]).not.toContain(o.evaluation.outcome);
        expect(o.selectable).toBe(o.evaluation.outcome !== "review");
      }
    }
  });
  it("offers reversed director when drawn company → person", () => {
    const o = getRelationshipOptions("Company", "Individual").find((x) => x.type === "director")!;
    expect(o.evaluation).toMatchObject({ outcome: "reverse", swapped: true });
  });
  it("review options are listed but not selectable", () => {
    const o = getRelationshipOptions("Company", "Trust").find((x) => x.type === "trustee")!;
    expect(o.selectable).toBe(false);
  });
  it("trades_as only Individual → Sole Trader (or reversed draw)", () => {
    for (const f of TYPES) for (const g of TYPES) {
      const o = getRelationshipOptions(f, g).find((x) => x.type === "trades_as" && x.selectable);
      if (o) expect([o.evaluation.fromType, o.evaluation.toType]).toEqual(["Individual", "Sole Trader"]);
    }
  });
});

describe("review / resolve are never directly insertable", () => {
  it("toCanonicalEdge returns null for every non-valid/non-reverse outcome", () => {
    for (const t of ALL_INPUT_TYPES) for (const f of TYPES) for (const g of TYPES) {
      const e = evaluateRelationship(t, f, g, { directionKnown: false });
      const edge = toCanonicalEdge(e, "a", "b");
      if (e.outcome === "valid") expect(edge).toEqual({ type: e.canonicalType, fromId: "a", toId: "b" });
      else if (e.outcome === "reverse") expect(edge).toEqual({ type: e.canonicalType, fromId: "b", toId: "a" });
      else expect(edge).toBeNull();
    }
  });
});

// ── Manual planning ──────────────────────────────────────────────
function deps(opts: { owners?: Record<string, string[]>; existing?: ExistingRelationship[]; types?: Record<string, string>; unavailable?: boolean } = {}) {
  const calls: string[] = [];
  const d: PlanDeps = {
    lookupTradesAsOwner: async (id): Promise<TradesAsLookup> => {
      calls.push(`tradesAs:${id}`);
      if (opts.unavailable) return { status: "unavailable" };
      return pickTradesAsOwner(opts.owners?.[id] ?? []);
    },
    findExisting: async () => opts.existing ?? [],
    getEntityType: async (id) => opts.types?.[id] ?? null,
  };
  return { d, calls };
}
const ent = (id: string, entity_type: string) => ({ id, entity_type });

describe("manual create", () => {
  it("valid stores as given", async () => {
    const r = await planNewRelationship("director", ent("p", "Individual"), ent("c", "Company"), deps().d);
    expect(r).toMatchObject({ ok: true, edge: { type: "director", fromId: "p", toId: "c" } });
  });
  it("reverse swaps endpoints explicitly", async () => {
    const r = await planNewRelationship("director", ent("c", "Company"), ent("p", "Individual"), deps().d);
    expect(r.edge).toEqual({ type: "director", fromId: "p", toId: "c" });
  });
  it("review is blocked", async () => {
    const r = await planNewRelationship("trustee", ent("c", "Company"), ent("t", "Trust"), deps().d);
    expect(r).toMatchObject({ ok: false, kind: "review" });
  });
  it("child and settlor cannot be created", async () => {
    for (const t of ["child", "settlor"]) {
      const r = await planNewRelationship(t, ent("a", "Individual"), ent("b", "Individual"), deps().d);
      expect(r).toMatchObject({ ok: false, kind: "invalid" });
    }
  });
  it("member Company → SMSF is invalid", async () => {
    const r = await planNewRelationship("member", ent("c", "Company"), ent("s", "smsf"), deps().d);
    expect(r.ok).toBe(false);
  });
  it("does not query Trades As for ordinary types", async () => {
    const { d, calls } = deps();
    await planNewRelationship("shareholder", ent("p", "Individual"), ent("c", "Company"), d);
    expect(calls).toEqual([]);
  });

  describe("Sole Trader resolution", () => {
    it("exactly one owner → links the Individual", async () => {
      const { d } = deps({ owners: { st: ["ind"] }, types: { ind: "Individual" } });
      const r = await planNewRelationship("shareholder", ent("st", "Sole Trader"), ent("c", "Company"), d);
      expect(r).toMatchObject({ ok: true, edge: { type: "shareholder", fromId: "ind", toId: "c" } });
    });
    it("works when drawn reversed (company → sole trader)", async () => {
      const { d } = deps({ owners: { st: ["ind"] }, types: { ind: "Individual" } });
      const r = await planNewRelationship("trustee", ent("t", "trust_discretionary"), ent("st", "Sole Trader"), d);
      expect(r.edge).toEqual({ type: "trustee", fromId: "ind", toId: "t" });
    });
    it("zero owners → review, no save", async () => {
      const r = await planNewRelationship("beneficiary", ent("st", "Sole Trader"), ent("t", "trust_discretionary"), deps().d);
      expect(r).toMatchObject({ ok: false, kind: "review" });
    });
    it("multiple owners → review, no guess", async () => {
      const { d } = deps({ owners: { st: ["a", "b"] }, types: { a: "Individual", b: "Individual" } });
      const r = await planNewRelationship("partner", ent("st", "Sole Trader"), ent("p", "Partnership"), d);
      expect(r).toMatchObject({ ok: false, kind: "review" });
      expect(r.description).toMatch(/2 Trades As owners/);
    });
    it("lookup unavailable (enum not yet applied) → review", async () => {
      const r = await planNewRelationship("shareholder", ent("st", "Sole Trader"), ent("c", "Company"), deps({ unavailable: true }).d);
      expect(r).toMatchObject({ ok: false, kind: "review" });
    });
  });

  describe("trades_as", () => {
    it("creates Individual → Sole Trader when no owner exists", async () => {
      const r = await planNewRelationship("trades_as", ent("i", "Individual"), ent("st", "Sole Trader"), deps().d);
      expect(r.edge).toEqual({ type: "trades_as", fromId: "i", toId: "st" });
    });
    it("blocks a second owner", async () => {
      const r = await planNewRelationship("trades_as", ent("i", "Individual"), ent("st", "Sole Trader"), deps({ owners: { st: ["other"] } }).d);
      expect(r).toMatchObject({ ok: false, kind: "invalid" });
    });
    it("rejects Company → Sole Trader", async () => {
      const r = await planNewRelationship("trades_as", ent("c", "Company"), ent("st", "Sole Trader"), deps().d);
      expect(r.ok).toBe(false);
    });
  });

  describe("de-duplication", () => {
    it("spouse is unordered", async () => {
      const existing = [{ relationship_type: "spouse", from_entity_id: "b", to_entity_id: "a" }];
      const r = await planNewRelationship("spouse", ent("a", "Individual"), ent("b", "Individual"), deps({ existing }).d);
      expect(r).toMatchObject({ ok: false, kind: "duplicate" });
    });
    it("parent keeps direction (B→A does not block A→B)", async () => {
      const existing = [{ relationship_type: "parent", from_entity_id: "b", to_entity_id: "a" }];
      const r = await planNewRelationship("parent", ent("a", "Individual"), ent("b", "Individual"), deps({ existing }).d);
      expect(r.ok).toBe(true);
    });
    it("same directed fact is a duplicate", async () => {
      const existing = [{ relationship_type: "director", from_entity_id: "p", to_entity_id: "c" }];
      const r = await planNewRelationship("director", ent("c", "Company"), ent("p", "Individual"), deps({ existing }).d);
      expect(r).toMatchObject({ ok: false, kind: "duplicate" });
    });
  });
});

describe("manual edit and reverse", () => {
  const rel = { id: "r1", relationship_type: "director", from_entity_id: "c", to_entity_id: "p" };
  it("reverse fixes a backwards director", () => {
    const r = planReverse(rel, ent("c", "Company"), ent("p", "Individual"), []);
    expect(r.edge).toEqual({ type: "director", fromId: "p", toId: "c" });
  });
  it("reverse cannot turn a valid row invalid", () => {
    const ok = { id: "r2", relationship_type: "director", from_entity_id: "p", to_entity_id: "c" };
    expect(planReverse(ok, ent("p", "Individual"), ent("c", "Company"), []).ok).toBe(false);
  });
  it("reverse cannot produce review", () => {
    const r = { id: "r3", relationship_type: "trustee", from_entity_id: "t", to_entity_id: "c" };
    expect(planReverse(r, ent("t", "Trust"), ent("c", "Company"), []).ok).toBe(false);
  });
  it("spouse reverse is a no-op and refused", () => {
    const r = { id: "r4", relationship_type: "spouse", from_entity_id: "a", to_entity_id: "b" };
    expect(planReverse(r, ent("a", "Individual"), ent("b", "Individual"), []).ok).toBe(false);
  });
  it("type change must be valid as stored", () => {
    expect(planTypeChange("shareholder", ent("p", "Individual"), ent("c", "Company"), [], "x").ok).toBe(true);
    expect(planTypeChange("member", ent("p", "Individual"), ent("c", "Company"), [], "x").ok).toBe(false);
    expect(planTypeChange("child", ent("a", "Individual"), ent("b", "Individual"), [], "x").ok).toBe(false);
  });
  it("member exposes no ownership fields", () => {
    expect(facade.getMetadataFields("member")).toEqual([]);
    expect(facade.hasMetadataFields("member")).toBe(false);
  });
});

// ── XPM normalisation ────────────────────────────────────────────
describe("XPM label parsing", () => {
  const cases: [string, string | null, boolean][] = [
    ["Director Of", "director", false], ["Director", "director", true],
    ["Shareholder Of", "shareholder", false], ["Shareholder", "shareholder", true],
    ["Unit Holder Of", "unit_holder", false], ["Unit Holder", "unit_holder", true],
    ["unit_holder of", "unit_holder", false], ["unit_holder", "unit_holder", true],
    ["Beneficiary Of", "beneficiary", false], ["Beneficiary", "beneficiary", true],
    ["Trustee Of", "trustee", false], ["Trustee", "trustee", true],
    ["Appointer Of", "appointer", false], ["Appointer", "appointer", true],
    ["Appointor Of", "appointer", false], ["Appointor", "appointer", true],
    ["Settlor Of", "settlor", false], ["Settlor", "settlor", true],
    ["Partner Of", "partner", false], ["Partner", "partner", true],
    ["Member Of", "member", false], ["Member", "member", true],
    ["Spouse", "spouse", false], ["Spouse Of", "spouse", false],
    ["Parent Of", "parent", false], ["Parent", "parent", true],
    ["Child Of", "child", false], ["Child", "child", true],
    ["Secretary", null, false], ["Public Officer Of", null, false], ["  director   of ", "director", false],
  ];
  it.each(cases)("%s", (label, type, relatedIsSource) => {
    const p = parseXpmLabel(label);
    expect(p.type).toBe(type);
    if (type) expect(p.relatedIsSource).toBe(relatedIsSource);
  });
  it("only family labels claim a known direction", () => {
    expect(parseXpmLabel("Trustee Of").directionKnown).toBe(false);
    expect(parseXpmLabel("Parent Of").directionKnown).toBe(true);
  });
});

describe("XPM normalisation outcomes", () => {
  const types = new Map<string, string>([
    ["p", "Individual"], ["q", "Individual"], ["c", "Company"], ["c2", "Company"], ["t", "trust_discretionary"],
    ["f", "trust_family"], ["g", "Trust"], ["s", "smsf"], ["pt", "Partnership"], ["st", "Sole Trader"], ["u", "Unclassified"],
  ]);
  const ctx = { entityTypes: types };
  const n = (label: string, clientId: string, relatedId: string, extra = {}) =>
    normaliseXpmRelationship({ label, clientId, relatedId }, { ...ctx, ...extra });

  it("valid inserts canonical", () => {
    const r = n("Director Of", "p", "c");
    expect(r.edge).toEqual({ type: "director", fromId: "p", toId: "c" });
    expect(r.evidence).toMatchObject({ policy_outcome: "valid", review_status: "not_required" });
  });
  it("label on the wrong record reverses once and records it", () => {
    const r = n("Director Of", "c", "p");
    expect(r.edge).toEqual({ type: "director", fromId: "p", toId: "c" });
    expect(r.evidence).toMatchObject({ policy_outcome: "reverse", policy_reason: "auto_reversed" });
  });
  it("ambiguous both-valid orientation → review, no edge", () => {
    const r = n("Shareholder Of", "c", "c2");
    expect(r.edge).toBeNull();
    expect(r.evidence).toMatchObject({ policy_outcome: "review", policy_reason: "ambiguous_direction", review_status: "pending" });
  });
  it("Generic Trust / Unclassified → review evidence, no edge", () => {
    expect(n("Trustee Of", "c", "g").edge).toBeNull();
    expect(n("Director Of", "u", "c").evidence.policy_outcome).toBe("review");
  });
  it("Family Trust follows Discretionary", () => {
    expect(n("Appointor Of", "p", "f").edge).toEqual({ type: "appointer", fromId: "p", toId: "f" });
  });
  it("child → canonical parent with endpoints reversed, raw child kept", () => {
    const r = n("Child Of", "p", "q"); // p is child of q
    expect(r.edge).toEqual({ type: "parent", fromId: "q", toId: "p" });
    expect(r.evidence).toMatchObject({ raw_relationship_label: "Child Of", policy_reason: "child_alias_reversed" });
  });
  it("parent label direction is respected", () => {
    expect(n("Parent Of", "p", "q").edge).toEqual({ type: "parent", fromId: "p", toId: "q" });
    expect(n("Parent", "p", "q").edge).toEqual({ type: "parent", fromId: "q", toId: "p" });
  });
  it("settlor → deprecated evidence, no edge", () => {
    const r = n("Settlor Of", "p", "t");
    expect(r.edge).toBeNull();
    expect(r.evidence).toMatchObject({ policy_outcome: "deprecated", review_status: "rejected", raw_relationship_label: "Settlor Of" });
  });
  it("unknown label → invalid evidence, not lost", () => {
    const r = n("Secretary", "p", "c");
    expect(r.edge).toBeNull();
    expect(r.evidence).toMatchObject({ policy_outcome: "invalid", policy_reason: "unknown_relationship_type", raw_relationship_label: "Secretary" });
  });
  it("member Individual → SMSF only", () => {
    expect(n("Member Of", "p", "s").edge).toEqual({ type: "member", fromId: "p", toId: "s" });
    expect(n("Member", "s", "p").edge).toEqual({ type: "member", fromId: "p", toId: "s" });
    expect(n("Member Of", "c", "s").edge).toBeNull();
  });
  it("partner targets Partnership and is never sorted", () => {
    expect(n("Partner Of", "p", "pt").edge).toEqual({ type: "partner", fromId: "p", toId: "pt" });
    expect(n("Partner", "pt", "p").edge).toEqual({ type: "partner", fromId: "p", toId: "pt" });
    expect(n("Partner Of", "p", "q").edge).toBeNull();
  });
  describe("Sole Trader", () => {
    it("exactly one owner resolves", () => {
      const r = n("Shareholder Of", "st", "c", { tradesAsOwners: new Map([["st", ["p"]]]) });
      expect(r.edge).toEqual({ type: "shareholder", fromId: "p", toId: "c" });
      expect(r.evidence).toMatchObject({ policy_outcome: "resolve_sole_trader", resolved_via_trades_as: true, review_status: "not_required" });
    });
    it("zero owners stays pending", () => {
      const r = n("Beneficiary Of", "st", "t");
      expect(r.edge).toBeNull();
      expect(r.evidence.review_status).toBe("pending");
    });
    it("multiple owners stays pending", () => {
      const r = n("Trustee Of", "st", "t", { tradesAsOwners: new Map([["st", ["p", "q"]]]) });
      expect(r.edge).toBeNull();
      expect(r.evidence.review_status).toBe("pending");
    });
  });
  it("name-only types keep the edge but mark evidence pending", () => {
    const r = n("Director Of", "p", "c", { provisionalTypes: new Set(["c"]) });
    expect(r.edge).not.toBeNull();
    expect(r.evidence).toMatchObject({ entity_type_provisional: true, review_status: "pending" });
  });
  it("batch: one evidence per raw row, spouse deduped unordered, directed kept", () => {
    const { evidence, edges } = normaliseXpmBatch([
      { label: "Spouse", clientId: "p", relatedId: "q" },
      { label: "Spouse", clientId: "q", relatedId: "p" },
      { label: "Parent Of", clientId: "p", relatedId: "q" },
      { label: "Parent Of", clientId: "q", relatedId: "p" },
      { label: "Director", clientId: "c", relatedId: "p" },
      { label: "Director Of", clientId: "p", relatedId: "c" },
      { label: "Secretary", clientId: "p", relatedId: "c" },
    ], ctx);
    expect(evidence).toHaveLength(7);
    expect(edges.filter((e) => e.type === "spouse")).toHaveLength(1);
    expect(edges.filter((e) => e.type === "parent")).toHaveLength(2);
    expect(edges.filter((e) => e.type === "director")).toHaveLength(1);
  });
});

describe("entity-type provenance", () => {
  it("business structure is authoritative; name-only is provisional", () => {
    expect(classifyWithProvenance(resolveEntityType, "Discretionary Trust", "X")).toEqual({ entityType: "trust_discretionary", provisional: false });
    expect(classifyWithProvenance(resolveEntityType, undefined, "Smith Family Trust")).toEqual({ entityType: "trust_family", provisional: true });
    expect(classifyWithProvenance(resolveEntityType, undefined, "Jane")).toEqual({ entityType: "Unclassified", provisional: false });
  });
});
