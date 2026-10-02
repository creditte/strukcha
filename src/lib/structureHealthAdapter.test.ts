import { describe, it, expect } from "vitest";
import { computeHealthScoreV2 } from "@/lib/structureScoring";
import { computeStructureHealth, toStructureHealth, type EntityNode, type RelationshipEdge } from "@/hooks/useStructureData";

const ent = (id: string, entity_type: string): EntityNode =>
  ({ id, name: id, entity_type, abn: null, acn: null } as unknown as EntityNode);
let n = 0;
const rel = (from: string, to: string, t: string, pct: number | null = null): RelationshipEdge =>
  ({ id: `r${++n}`, from_entity_id: from, to_entity_id: to, relationship_type: t, source_data: "manual",
     ownership_percent: pct, ownership_units: null, ownership_class: null, created_at: "" });

function both(e: EntityNode[], r: RelationshipEdge[]) {
  const shared = computeHealthScoreV2(e, r);
  const adapted = toStructureHealth(shared);
  expect(adapted.score).toBe(shared.score);
  expect(adapted.status).toBe(shared.status);
  expect(adapted.errors.map((i) => i.code)).toEqual(shared.issues.filter((i) => i.severity === "critical").map((i) => i.code));
  expect(adapted.warnings.map((i) => i.code)).toEqual(shared.issues.filter((i) => i.severity === "gap").map((i) => i.code));
  expect(adapted.info.map((i) => i.code)).toEqual(shared.issues.filter((i) => i.severity === "info").map((i) => i.code));
  expect(computeStructureHealth(e, r)).toEqual({ score: shared.score, status: shared.status });
  return { shared, adapted };
}

describe("StructureHealth adapter delegates to the shared engine", () => {
  it("multiple missing roles → warning, zero errors", () => {
    const { adapted } = both(
      [ent("Co", "Company"), ent("T", "trust_unit"), ent("S", "smsf"), ent("P", "Partnership"), ent("ST", "Sole Trader")], []);
    expect(adapted.status).toBe("warning");
    expect(adapted.errors).toHaveLength(0);
    const codes = adapted.warnings.map((w) => w.code);
    for (const c of ["missing_directors", "missing_shareholders", "missing_unit_holders", "missing_partners",
      "missing_trades_as_owner", "missing_trustee", "missing_member"]) expect(codes).toContain(c);
    expect(codes).not.toContain("missing_shareholder");
    expect(codes).not.toContain("missing_unit_holder");
  });

  it("ownership over 100% → critical / error", () => {
    const { adapted } = both([ent("Co", "Company"), ent("A", "Individual"), ent("B", "Individual")],
      [rel("A", "Co", "director"), rel("A", "Co", "shareholder", 60), rel("B", "Co", "shareholder", 50)]);
    expect(adapted.status).toBe("critical");
    expect(adapted.errors.map((e) => e.code)).toEqual(["ownership_exceeds"]);
    expect(adapted.errors[0].details).toEqual({ total: 110 });
  });

  it("invalid direction → critical / error with relationship id", () => {
    const r = rel("Co", "P", "director");
    const { adapted } = both([ent("Co", "Company"), ent("P", "Individual")], [r]);
    expect(adapted.status).toBe("critical");
    const e = adapted.errors.find((x) => x.code === "invalid_relationship_direction");
    expect(e?.relationship_id).toBe(r.id);
    expect(e?.severity).toBe("error");
  });

  it("multiple Trades As owners → error", () => {
    const { adapted } = both([ent("A", "Individual"), ent("B", "Individual"), ent("ST", "Sole Trader")],
      [rel("A", "ST", "trades_as"), rel("B", "ST", "trades_as")]);
    expect(adapted.errors.map((e) => e.code)).toContain("multiple_trades_as_owners");
  });

  it("info-only missing Appointor → good, info only, score unchanged", () => {
    const e = [ent("T", "trust_family"), ent("P", "Individual")];
    const { adapted } = both(e, [rel("P", "T", "trustee")]);
    expect(adapted.status).toBe("good");
    expect(adapted.errors).toHaveLength(0);
    expect(adapted.warnings).toHaveLength(0);
    expect(adapted.info.map((i) => i.code)).toEqual(["missing_appointer"]);
    const withApp = computeStructureHealth(e, [rel("P", "T", "trustee"), rel("P", "T", "appointer")]);
    expect(adapted.score).toBe(100);
    expect(withApp.score).toBe(adapted.score);
  });

  it("individual trustee: no corporate-trustee issue", () => {
    const { adapted } = both([ent("T", "trust_bare"), ent("P", "Individual")], [rel("P", "T", "trustee")]);
    expect([...adapted.errors, ...adapted.warnings, ...adapted.info]).toHaveLength(0);
    expect(adapted.score).toBe(100);
  });
});
