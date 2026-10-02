import { describe, it, expect } from "vitest";
import { computeHealthScoreV2, type ScoringIssue } from "@/lib/structureScoring";
import { getExportBlock, isExportBlockingIssue } from "@/lib/exportBlocking";
import type { EntityNode, RelationshipEdge } from "@/hooks/useStructureData";

const ent = (id: string, entity_type: string): EntityNode =>
  ({ id, name: id, entity_type, xpm_uuid: null, abn: null, acn: null, is_operating_entity: false,
     is_trustee_company: false, is_investment_company: false, created_at: "", tfn: null, state: null,
     client_code: null, account_manager: null } as unknown as EntityNode);
const rel = (id: string, from: string, to: string, t: string): RelationshipEdge =>
  ({ id, from_entity_id: from, to_entity_id: to, relationship_type: t, source_data: "manual",
     ownership_percent: null, ownership_units: null, ownership_class: null, created_at: "" });
const iss = (code: string): ScoringIssue =>
  ({ code, category: "control", severity: "critical", message: code, deduction: 0 });

describe("missing appointor", () => {
  it("never checks Unit Trusts or other ineligible types", () => {
    for (const t of ["trust_unit", "trust_hybrid", "trust_bare", "trust_testamentary", "trust_deceased_estate", "smsf", "Trust", "Unclassified", "Company"]) {
      const h = computeHealthScoreV2([ent("T", t)], []);
      expect(h.issues.filter((i) => i.code === "missing_appointer")).toHaveLength(0);
    }
  });

  it.each(["trust_family", "trust_discretionary"])("%s without appointor → one info issue, zero deduction", (t) => {
    const ents = [ent("T", t), ent("Co", "Company"), ent("P", "Individual")];
    const rels = [rel("r1", "Co", "T", "trustee"), rel("r2", "P", "Co", "director")];
    const h = computeHealthScoreV2(ents, rels);
    const m = h.issues.filter((i) => i.code === "missing_appointer");
    expect(m).toHaveLength(1);
    expect(m[0].severity).toBe("info");
    expect(m[0].deduction).toBe(0);
    expect(m[0].message).toContain("Confirm whether the trust deed includes an appointor");
    expect(h.criticalGaps.some((i) => i.code === "missing_appointer")).toBe(false);
    expect(h.governanceGaps.some((i) => i.code === "missing_appointer")).toBe(false);
    // Adding an appointor changes nothing in the score.
    const withApp = computeHealthScoreV2(ents, [...rels, rel("r3", "P", "T", "appointer")]);
    expect(withApp.issues.some((i) => i.code === "missing_appointer")).toBe(false);
    expect(withApp.score).toBe(h.score);
    expect(getExportBlock(h.issues, true).blocked).toBe(false);
  });
});

describe("export blocking", () => {
  const nonBlocking = ["missing_appointer", "missing_trustee", "missing_member", "missing_directors",
    "missing_shareholders", "ownership_no_percent", "ownership_incomplete", "ownership_under", "missing_identifiers", "unclassified", "orphan_entity"];

  it("missing/incomplete facts never block", () => {
    for (const c of nonBlocking) expect(isExportBlockingIssue(iss(c))).toBe(false);
    expect(getExportBlock(nonBlocking.map(iss), true).blocked).toBe(false);
  });

  it.each(["invalid_relationship_direction", "circular_ownership"])("%s blocks when setting on", (c) => {
    const r = getExportBlock([iss(c)], true);
    expect(r.blocked).toBe(true);
    expect(r.blockingIssues).toHaveLength(1);
  });

  it("setting off allows export even with a blocking issue", () => {
    expect(getExportBlock([iss("circular_ownership"), iss("invalid_relationship_direction")], false).blocked).toBe(false);
  });
});
