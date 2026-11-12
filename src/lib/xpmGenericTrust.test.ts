import { describe, it, expect } from "vitest";
import { evaluateRelationship } from "@/lib/relationshipPolicy";
import { isDirectionValid, storedRelationshipOptions } from "@/lib/relationshipRules";
import { normaliseXpmRelationship } from "../../supabase/functions/_shared/xpm-policy-normalise.ts";

// XPM clients whose business structure is plain "Trust" (kind unknown).
// Rule: XPM-imported Trustee / Beneficiary / Appointor / Unit Holder links to
// them are accepted; manual links keep the stricter trust-kind checks; the
// trust kind is never changed.

const ctx = {
  entityTypes: new Map<string, string>([
    ["stephen", "Individual"],
    ["dft", "Trust"],
    ["co", "Company"],
    ["mft", "trust_discretionary"],
  ]),
};
const n = (label: string, clientId: string, relatedId: string) =>
  normaliseXpmRelationship({ label, clientId, relatedId }, ctx);

describe("XPM import: general Trust targets", () => {
  it("Stephen Dart 'Trustee Of' Dart Family Trust is accepted", () => {
    expect(n("Trustee Of", "stephen", "dft").edge).toEqual({ type: "trustee", fromId: "stephen", toId: "dft" });
  });
  it("'Trustee' on the trust's record gives the same canonical link", () => {
    expect(n("Trustee", "dft", "stephen").edge).toEqual({ type: "trustee", fromId: "stephen", toId: "dft" });
  });
  it("Stephen Dart 'Beneficiary Of' Dart Family Trust is accepted (both records)", () => {
    expect(n("Beneficiary Of", "stephen", "dft").edge).toEqual({ type: "beneficiary", fromId: "stephen", toId: "dft" });
    expect(n("Beneficiary", "dft", "stephen").edge).toEqual({ type: "beneficiary", fromId: "stephen", toId: "dft" });
  });
  it("Appointor and Unit Holder to a general Trust are accepted", () => {
    expect(n("Appointor Of", "stephen", "dft").edge).toEqual({ type: "appointer", fromId: "stephen", toId: "dft" });
    expect(n("Unit Holder Of", "co", "dft").edge).toEqual({ type: "unit_holder", fromId: "co", toId: "dft" });
  });
  it("other types to a general Trust are not loosened", () => {
    expect(n("Director Of", "stephen", "dft").edge).toBeNull();
    // Trust as direct shareholder is still held for review (unchanged).
    expect(n("Shareholder Of", "dft", "co").edge).toBeNull();
  });
  it("Mortimer-style discretionary trust is unaffected", () => {
    expect(n("Trustee Of", "stephen", "mft").edge).toEqual({ type: "trustee", fromId: "stephen", toId: "mft" });
    expect(evaluateRelationship("trustee", "Individual", "trust_discretionary")).toMatchObject({ outcome: "valid" });
  });
});

describe("manual input keeps strict rules", () => {
  it("strict evaluation still holds general Trust links for review", () => {
    for (const t of ["trustee", "beneficiary", "appointer", "unit_holder"]) {
      expect(evaluateRelationship(t, "Individual", "Trust").outcome).toBe("review");
    }
  });
  it("a manual relationship is judged strictly, an imported one with XPM rules", () => {
    expect(isDirectionValid("trustee", "Individual", "Trust", storedRelationshipOptions({ source_data: "manual" }))).toBe(false);
    expect(isDirectionValid("trustee", "Individual", "Trust", storedRelationshipOptions({ source_data: "imported" }))).toBe(true);
  });
});
