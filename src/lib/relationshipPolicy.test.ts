import { describe, it, expect } from "vitest";
import vectorsFile from "@/test/fixtures/relationship-policy-vectors.json";
import {
  evaluateRelationship,
  categoryOf,
  CREATABLE_RELATIONSHIP_TYPES,
  POLICY_RULES,
  getPolicyRule,
  relationshipIdentityKey,
  policyMetadataFields,
} from "@/lib/relationshipPolicy";
import { getRelationshipLabel, RELATIONSHIP_RULES } from "@/lib/relationshipRules";

type Vector = {
  type: string; from: string; to: string; directionKnown?: boolean;
  outcome: string; reason: string; canonicalType: string | null; swapped: boolean;
};
const vectors = (vectorsFile as { vectors: Vector[] }).vectors;

describe("policy vectors (shared with SQL parity)", () => {
  it.each(vectors.map((v) => [`${v.type || "<empty>"} ${v.from}→${v.to}${v.directionKnown === false ? " (dir unknown)" : ""}`, v] as const))(
    "%s",
    (_n, v) => {
      const r = evaluateRelationship(v.type, v.from, v.to, { directionKnown: v.directionKnown ?? true });
      expect({ outcome: r.outcome, reason: r.reason, canonicalType: r.canonicalType, swapped: r.swapped })
        .toEqual({ outcome: v.outcome, reason: v.reason, canonicalType: v.canonicalType, swapped: v.swapped });
      expect(r.fromType).toBe(v.swapped ? v.to : v.from);
      expect(r.toType).toBe(v.swapped ? v.from : v.to);
    },
  );

  it("covers every canonical and deprecated type", () => {
    const covered = new Set(vectors.map((v) => v.type));
    for (const t of [...CREATABLE_RELATIONSHIP_TYPES, "child", "settlor"]) expect(covered.has(t)).toBe(true);
  });
});

const ALL_DB_TYPES = [
  "Individual", "Company", "Partnership", "Sole Trader", "Incorporated Association/Club",
  "trust_discretionary", "trust_family", "trust_unit", "trust_hybrid", "trust_bare",
  "trust_testamentary", "trust_deceased_estate", "smsf", "Trust", "Unclassified",
];

describe("Family Trust parity", () => {
  it("behaves exactly like Discretionary Trust on both sides for every rule", () => {
    for (const rule of POLICY_RULES) {
      for (const other of ALL_DB_TYPES) {
        const strip = (x: ReturnType<typeof evaluateRelationship>) => ({ o: x.outcome, r: x.reason, s: x.swapped });
        expect(strip(evaluateRelationship(rule.type, "trust_family", other)))
          .toEqual(strip(evaluateRelationship(rule.type, "trust_discretionary", other)));
        expect(strip(evaluateRelationship(rule.type, other, "trust_family")))
          .toEqual(strip(evaluateRelationship(rule.type, other, "trust_discretionary")));
      }
    }
    expect(categoryOf("trust_family")).toBe("discretionary_trust");
  });
});

describe("review states", () => {
  it("Generic Trust and Unclassified are never silently valid", () => {
    for (const rule of POLICY_RULES) {
      for (const other of ALL_DB_TYPES) {
        for (const unknown of ["Trust", "Unclassified"]) {
          for (const [f, t] of [[unknown, other], [other, unknown]]) {
            const r = evaluateRelationship(rule.type, f, t);
            expect(["review", "invalid", "resolve_sole_trader"]).toContain(r.outcome);
          }
        }
      }
    }
  });
  it("missing entity type is treated as Unclassified", () => {
    expect(evaluateRelationship("director", null, "Company").outcome).toBe("review");
  });
});

describe("type handling", () => {
  it("unknown type defaults to invalid", () => {
    expect(evaluateRelationship("public_officer", "Individual", "Company").outcome).toBe("invalid");
  });
  it("child and settlor are not creatable", () => {
    expect(CREATABLE_RELATIONSHIP_TYPES).not.toContain("child");
    expect(CREATABLE_RELATIONSHIP_TYPES).not.toContain("settlor");
    expect(evaluateRelationship("settlor", "Individual", "trust_unit").outcome).toBe("deprecated");
  });
  it("child A→B normalises to parent B→A", () => {
    const r = evaluateRelationship("child", "Individual", "Individual");
    expect(r).toMatchObject({ outcome: "reverse", canonicalType: "parent", swapped: true });
  });
  it("is case/whitespace tolerant", () => {
    expect(evaluateRelationship(" Director ", "Individual", "Company").outcome).toBe("valid");
  });
});

describe("member", () => {
  it("accepts only Individual → SMSF", () => {
    for (const f of ALL_DB_TYPES) for (const t of ALL_DB_TYPES) {
      const r = evaluateRelationship("member", f, t);
      if (r.outcome === "valid") expect([f, t]).toEqual(["Individual", "smsf"]);
    }
  });
  it("has no ownership metadata", () => {
    expect(policyMetadataFields("member")).toEqual([]);
  });
});

describe("partner", () => {
  it("always targets Partnership", () => {
    for (const f of ALL_DB_TYPES) for (const t of ALL_DB_TYPES) {
      const r = evaluateRelationship("partner", f, t);
      if (r.outcome === "valid" || r.outcome === "reverse") expect(r.toType).toBe("Partnership");
    }
  });
  it("is directed, not symmetric", () => {
    expect(getPolicyRule("partner")!.symmetric).toBe(false);
    expect(relationshipIdentityKey("partner", "b", "a")).not.toBe(relationshipIdentityKey("partner", "a", "b"));
  });
});

describe("trades_as", () => {
  it("only Individual → Sole Trader is valid", () => {
    for (const f of ALL_DB_TYPES) for (const t of ALL_DB_TYPES) {
      const r = evaluateRelationship("trades_as", f, t);
      if (r.outcome === "valid") expect([f, t]).toEqual(["Individual", "Sole Trader"]);
    }
  });
});

describe("auto-reverse", () => {
  it("never reverses parent or spouse", () => {
    for (const f of ALL_DB_TYPES) for (const t of ALL_DB_TYPES) {
      expect(evaluateRelationship("parent", f, t).outcome).not.toBe("reverse");
      expect(evaluateRelationship("spouse", f, t).outcome).not.toBe("reverse");
    }
  });
  it("a reversed result is valid in the canonical direction", () => {
    for (const rule of POLICY_RULES) for (const f of ALL_DB_TYPES) for (const t of ALL_DB_TYPES) {
      const r = evaluateRelationship(rule.type, f, t);
      if (r.outcome === "reverse") expect(evaluateRelationship(rule.type, r.fromType, r.toType).outcome).toBe("valid");
    }
  });
  it("returns review when both orientations are valid and direction is unknown", () => {
    expect(evaluateRelationship("parent", "Individual", "Individual", { directionKnown: false }).outcome).toBe("review");
    expect(evaluateRelationship("shareholder", "Company", "Company", { directionKnown: false }).reason).toBe("ambiguous_direction");
    // Unambiguous cases still pass with unknown direction
    expect(evaluateRelationship("director", "Company", "Individual", { directionKnown: false }).outcome).toBe("reverse");
  });
});

describe("identity", () => {
  it("spouse is one unordered fact", () => {
    expect(relationshipIdentityKey("spouse", "b", "a")).toBe(relationshipIdentityKey("spouse", "a", "b"));
  });
  it("directed relationships keep direction", () => {
    for (const t of ["director", "shareholder", "parent", "trades_as", "trustee"]) {
      expect(relationshipIdentityKey(t, "a", "b")).not.toBe(relationshipIdentityKey(t, "b", "a"));
    }
  });
});

describe("metadata", () => {
  it("ownership fields only where meaningful", () => {
    expect(policyMetadataFields("shareholder")).toEqual(["ownership_percent", "ownership_units", "ownership_class"]);
    expect(policyMetadataFields("unit_holder")).toContain("ownership_units");
    expect(policyMetadataFields("beneficiary", "trust_discretionary")).toEqual([]);
    expect(policyMetadataFields("beneficiary", "trust_family")).toEqual([]);
    expect(policyMetadataFields("beneficiary", "trust_bare")).toEqual(["ownership_percent"]);
    for (const t of ["director", "trustee", "appointer", "spouse", "parent", "trades_as", "member"]) {
      expect(policyMetadataFields(t)).toEqual([]);
    }
    expect(policyMetadataFields("nonsense")).toEqual([]);
  });
});

describe("compatibility facade", () => {
  it("labels come from the policy", () => {
    expect(getRelationshipLabel("appointer")).toBe("Appointor");
    expect(getRelationshipLabel("trades_as")).toBe("Trades As");
    expect(getRelationshipLabel("unit_holder")).toBe("Unit Holder");
  });
  it("legacy exports still exist", () => {
    expect(RELATIONSHIP_RULES.length).toBeGreaterThan(0);
  });
});
