import { describe, it, expect } from "vitest";
import {
  computeHealthScoreV2, getHealthStatus, ISSUE_DEFINITIONS, STATUS_META, type ScoringIssue,
} from "@/lib/structureScoring";
import { getExportBlock, EXPORT_BLOCKING_ISSUE_CODES } from "@/lib/exportBlocking";
import type { EntityNode, RelationshipEdge } from "@/hooks/useStructureData";

const ent = (id: string, entity_type: string, extra: Partial<EntityNode> = {}): EntityNode =>
  ({ id, name: id, entity_type, abn: null, acn: null, ...extra } as unknown as EntityNode);
let n = 0;
const rel = (from: string, to: string, t: string, pct: number | null = null): RelationshipEdge =>
  ({ id: `r${++n}`, from_entity_id: from, to_entity_id: to, relationship_type: t, source_data: "manual",
     ownership_percent: pct, ownership_units: null, ownership_class: null, created_at: "" });
const codes = (h: { issues: ScoringIssue[] }) => h.issues.map((i) => i.code);

describe("issue classification", () => {
  const expected: Record<string, "critical" | "gap" | "info"> = {
    invalid_relationship_direction: "critical", circular_ownership: "critical",
    ownership_exceeds: "critical", multiple_trades_as_owners: "critical",
    missing_trustee: "gap", missing_member: "gap", missing_directors: "gap", missing_shareholders: "gap",
    missing_unit_holders: "gap", missing_partners: "gap", missing_trades_as_owner: "gap",
    ownership_incomplete: "gap", ownership_under: "gap", duplicate_relationship: "gap",
    unclassified: "gap", orphan_entity: "gap",
    missing_appointer: "info", ownership_no_percent: "info", ownership_units_only: "info", missing_identifiers: "info",
  };
  it.each(Object.entries(expected))("%s is %s", (code, sev) => {
    expect(ISSUE_DEFINITIONS[code].severity).toBe(sev);
    if (sev === "info") expect(ISSUE_DEFINITIONS[code].deduction).toBe(0);
    expect(EXPORT_BLOCKING_ISSUE_CODES.has(code)).toBe(sev === "critical");
  });
  it("catalogue has no legacy codes", () => {
    expect(ISSUE_DEFINITIONS).not.toHaveProperty("no_corporate_trustee");
    expect(ISSUE_DEFINITIONS).not.toHaveProperty("missing_ownership_percent");
    expect(Object.keys(ISSUE_DEFINITIONS).sort()).toEqual(Object.keys(expected).sort());
  });
});

describe("missing roles", () => {
  it("several gaps together are Review, not Critical, and never block", () => {
    const h = computeHealthScoreV2(
      [ent("Co", "Company"), ent("T", "trust_unit"), ent("S", "smsf"), ent("P", "Partnership"), ent("ST", "Sole Trader")], []);
    for (const c of ["missing_directors", "missing_shareholders", "missing_trustee", "missing_unit_holders",
      "missing_member", "missing_partners", "missing_trades_as_owner"]) expect(codes(h)).toContain(c);
    expect(h.status).toBe("warning");
    expect(h.label).toBe("Review recommended");
    expect(h.criticalGaps).toHaveLength(0);
    expect(getExportBlock(h.issues, true).blocked).toBe(false);
    for (const i of h.issues) expect(i.message).not.toMatch(/legal|invalid|must/i);
  });
  it("Unit/Hybrid Trust without Unit Holder, Partnership without Partner, Sole Trader without owner → Review", () => {
    for (const [t, c] of [["trust_unit", "missing_unit_holders"], ["trust_hybrid", "missing_unit_holders"],
      ["Partnership", "missing_partners"], ["Sole Trader", "missing_trades_as_owner"]]) {
      const i = computeHealthScoreV2([ent("X", t)], []).issues.find((x) => x.code === c);
      expect(i?.severity).toBe("gap");
      expect(i?.message).toContain("is recorded in strukcha");
    }
  });
  it("generic Trust gets classification review, not subtype checks", () => {
    const h = computeHealthScoreV2([ent("T", "Trust")], []);
    expect(codes(h)).toContain("unclassified");
    expect(codes(h)).not.toContain("missing_trustee");
  });
  it("Beneficiary / Appointor / Spouse are not required for export", () => {
    const h = computeHealthScoreV2([ent("T", "trust_discretionary")], []);
    expect(getExportBlock(h.issues, true).blocked).toBe(false);
  });
});

describe("critical contradictions", () => {
  it("multiple Trades As owners is critical and blocks only when setting on", () => {
    const h = computeHealthScoreV2([ent("A", "Individual"), ent("B", "Individual"), ent("ST", "Sole Trader")],
      [rel("A", "ST", "trades_as"), rel("B", "ST", "trades_as")]);
    expect(codes(h)).toContain("multiple_trades_as_owners");
    expect(h.status).toBe("critical");
    expect(h.label).toBe("Conflicting data");
    expect(getExportBlock(h.issues, true).blocked).toBe(true);
    expect(getExportBlock(h.issues, false).blocked).toBe(false);
  });
  it("one Trades As owner → no issue", () => {
    const h = computeHealthScoreV2([ent("A", "Individual"), ent("ST", "Sole Trader")], [rel("A", "ST", "trades_as")]);
    expect(codes(h).filter((c) => c.includes("trades_as"))).toEqual([]);
  });
  it("circular ownership and invalid direction block when setting on", () => {
    const circ = computeHealthScoreV2([ent("A", "Company"), ent("B", "Company")],
      [rel("A", "B", "shareholder", 100), rel("B", "A", "shareholder", 100)]);
    expect(codes(circ)).toContain("circular_ownership");
    expect(getExportBlock(circ.issues, true).blocked).toBe(true);
    const inv = computeHealthScoreV2([ent("Co", "Company"), ent("P", "Individual")], [rel("Co", "P", "director")]);
    expect(codes(inv)).toContain("invalid_relationship_direction");
    expect(inv.status).toBe("critical");
    expect(getExportBlock(inv.issues, true).blocked).toBe(true);
    expect(getExportBlock(inv.issues, false).blocked).toBe(false);
  });
});

describe("corporate trustee", () => {
  it("Individual trustee scores the same as Company trustee; no cap or issue", () => {
    const base = [ent("T", "trust_bare"), ent("P", "Individual")];
    const ind = computeHealthScoreV2(base, [rel("P", "T", "trustee")]);
    const co = computeHealthScoreV2([...base, ent("Co", "Company", { acn: "123456789" } as any)],
      [rel("Co", "T", "trustee"), rel("P", "Co", "director"), rel("P", "Co", "shareholder", 100)]);
    expect(ind.score).toBe(100);
    expect(co.score).toBe(100);
    expect(ind).not.toHaveProperty("isCapped");
    expect(codes(ind)).not.toContain("no_corporate_trustee");
  });
});

describe("ownership percentage aggregation", () => {
  const run = (pcts: (number | null)[]) => {
    const ents = [ent("Co", "Company"), ...pcts.map((_, i) => ent(`P${i}`, "Individual"))];
    const rels = [rel("P0", "Co", "director"), ...pcts.map((p, i) => rel(`P${i}`, "Co", "shareholder", p))];
    const h = computeHealthScoreV2(ents, rels);
    return h.issues.filter((i) => i.code.startsWith("ownership_"));
  };
  it("none → one info, zero deduction", () => {
    const i = run([null, null, null]);
    expect(i.map((x) => x.code)).toEqual(["ownership_no_percent"]);
    expect(i[0].deduction).toBe(0);
  });
  it("units only → ownership_units_only replaces ownership_no_percent", () => {
    const ents = [ent("Co", "Company"), ent("P0", "Individual")];
    const r = { ...rel("P0", "Co", "shareholder", null), ownership_units: 60 };
    const h = computeHealthScoreV2(ents, [rel("P0", "Co", "director"), r]);
    const i = h.issues.filter((x) => x.code.startsWith("ownership_"));
    expect(i.map((x) => x.code)).toEqual(["ownership_units_only"]);
    expect(i[0].severity).toBe("info");
    expect(i[0].deduction).toBe(0);
    expect(h.dataGapCount).toBe(0);
  });
  it("mixed → one ownership_incomplete", () => expect(run([50, null, null]).map((x) => x.code)).toEqual(["ownership_incomplete"]));
  it("under → one ownership_under", () => expect(run([40, 40]).map((x) => x.code)).toEqual(["ownership_under"]));
  it("exactly 100 (with decimals) → none", () => {
    expect(run([50, 50])).toEqual([]);
    expect(run([33.33, 33.33, 33.34])).toEqual([]);
  });
  it("over 100 → one critical ownership_exceeds that blocks", () => {
    const i = run([60, 50]);
    expect(i.map((x) => x.code)).toEqual(["ownership_exceeds"]);
    expect(i[0].severity).toBe("critical");
    expect(getExportBlock(i, true).blocked).toBe(true);
  });
  it("Unit Trust unit holders are aggregated per target", () => {
    const h = computeHealthScoreV2(
      [ent("T", "trust_unit"), ent("A", "Individual"), ent("B", "Individual")],
      [rel("A", "T", "trustee"), rel("A", "T", "unit_holder", 30), rel("B", "T", "unit_holder", 30)]);
    expect(h.issues.filter((i) => i.code === "ownership_under")).toHaveLength(1);
  });
});

describe("status", () => {
  it("information-only structure is good / Complete", () => {
    const h = computeHealthScoreV2(
      [ent("T", "trust_family"), ent("P", "Individual")], [rel("P", "T", "trustee")]);
    expect(codes(h)).toEqual(["missing_appointer"]);
    expect(h.score).toBe(100);
    expect(h.status).toBe("good");
    expect(h.label).toBe(STATUS_META.good.label);
    expect(h.label).toBe("Complete");
  });
  it("status is derived from issues, not score", () => {
    expect(getHealthStatus([])).toBe("good");
    expect(getHealthStatus([{ severity: "info" }])).toBe("good");
    expect(getHealthStatus([{ severity: "gap" }, { severity: "info" }])).toBe("warning");
    expect(getHealthStatus([{ severity: "critical" }])).toBe("critical");
  });
  it("Appointor stays info and only for Family/Discretionary", () => {
    expect(codes(computeHealthScoreV2([ent("T", "trust_unit")], []))).not.toContain("missing_appointer");
    const d = computeHealthScoreV2([ent("T", "trust_discretionary")], []).issues.find((i) => i.code === "missing_appointer");
    expect(d?.severity).toBe("info");
    expect(d?.deduction).toBe(0);
  });
});

import { groupIssuesBySeverity } from "@/lib/structureScoring";

describe("severity grouping", () => {
  it("covers every issue exactly once, including control-category Review items", () => {
    const h = computeHealthScoreV2(
      [ent("Co", "Company"), ent("T", "trust_family"), ent("S", "smsf"), ent("P", "Partnership"), ent("ST", "Sole Trader"),
       ent("A", "Individual"), ent("B", "Individual")],
      [rel("A", "Co", "shareholder", 60), rel("B", "Co", "shareholder", 50), rel("Co", "A", "director")]);
    const groups = groupIssuesBySeverity(h.issues);
    expect(groups.map((g) => g.label)).toEqual(["Conflicting data", "Review", "Information"]);
    const flat = groups.flatMap((g) => g.issues);
    expect(flat).toHaveLength(h.issues.length);
    expect(new Set(flat)).toEqual(new Set(h.issues));
    for (const g of groups) for (const i of g.issues) expect(i.severity).toBe(g.severity);
    const review = groups[1].issues.map((i) => i.code);
    for (const c of ["missing_trustee", "missing_member", "missing_partners", "missing_trades_as_owner"]) expect(review).toContain(c);
    expect(groups[0].issues.map((i) => i.code)).toContain("ownership_exceeds");
    expect(groups[2].issues.map((i) => i.code)).toContain("missing_appointer");
  });
});

describe("ownership percentage scope", () => {
  const pctCodes = ["ownership_no_percent", "ownership_incomplete", "ownership_under", "ownership_exceeds"];
  it.each([
    ["shareholder", "trust_discretionary", [null]],
    ["shareholder", "Individual", [40]],
    ["shareholder", "trust_unit", [150]],
    ["unit_holder", "Company", [40, null]],
    ["unit_holder", "trust_bare", [150]],
  ] as const)("%s → %s gets no percentage issue but is flagged invalid", (t, target, pcts) => {
    const ents = [ent("X", target), ...pcts.map((_, i) => ent(`P${i}`, "Individual"))];
    const rels = pcts.map((p, i) => rel(`P${i}`, "X", t, p));
    const h = computeHealthScoreV2(ents, rels);
    expect(h.issues.filter((i) => pctCodes.includes(i.code))).toEqual([]);
    expect(codes(h)).toContain("invalid_relationship_direction");
  });
  it("Hybrid Trust unit holders are assessed", () => {
    const h = computeHealthScoreV2([ent("H", "trust_hybrid"), ent("A", "Individual")], [rel("A", "H", "unit_holder", 40)]);
    expect(codes(h)).toContain("ownership_under");
  });
});
