import { describe, expect, it } from "vitest";
import {
  hashGroupMembers, isNoopPlan, planGroupReconciliation, type GroupState,
} from "../../supabase/functions/_shared/xpm-group-reconcile.ts";
import { figuresForEdge, normaliseXpmOwnership, parseXpmNumber } from "../../supabase/functions/_shared/xpm-ownership.ts";

const base = (over: Partial<GroupState> = {}): GroupState => ({
  resolution: { match: "uuid", structure_id: "S1" },
  group: { member_hash: "h", is_selected: true, last_synced_at: null },
  members: [
    { xpm_uuid: "xa", entity_id: "A", name: "A", is_archived: false },
    { xpm_uuid: "xb", entity_id: "B", name: "B", is_archived: false },
  ],
  structure_entities: [],
  structure_relationships: [],
  relationships: [
    { id: "R1", type: "shareholder", from_id: "A", to_id: "B", source: "imported", xpm_managed: true, units: null, percent: null },
  ],
  ...over,
});

describe("group identity and guarded adoption", () => {
  it("ambiguous match plans no writes", () => {
    const p = planGroupReconciliation(base({ resolution: { match: "ambiguous", structure_id: null, candidates: ["S1", "S2"] } }));
    expect(p.status).toBe("ambiguous_structure_match");
    expect(p.add_members).toEqual([]);
    expect(p.add_links).toEqual([]);
    expect(p.candidates).toEqual(["S1", "S2"]);
  });
  it("same-name manual structure blocks creation unless explicitly allowed", () => {
    const st = base({ resolution: { match: "create", structure_id: null, same_name_manual: ["M1"] } });
    expect(planGroupReconciliation(st).status).toBe("manual_structure_name_conflict");
    const ok = planGroupReconciliation(st, { allowCreateBesideManual: true });
    expect(ok.status).toBe("ready");
    expect(ok.structure_id).toBeNull();
  });
  it("adoption carries the single XPM candidate id", () => {
    const p = planGroupReconciliation(base({ resolution: { match: "adopt", structure_id: "3f9c" } }));
    expect(p.status).toBe("ready");
    expect(p.structure_id).toBe("3f9c");
    expect(isNoopPlan(p)).toBe(false);
  });
  it("member hash is order independent and name sensitive", async () => {
    expect(await hashGroupMembers("G", ["b", "a"])).toBe(await hashGroupMembers("G", ["a", "b"]));
    expect(await hashGroupMembers("G", ["a"])).not.toBe(await hashGroupMembers("H", ["a"]));
  });
});

describe("exact-key diffs", () => {
  it("adds members and confirmed links", () => {
    const p = planGroupReconciliation(base());
    expect(p.add_members).toEqual(["A", "B"]);
    expect(p.add_links).toEqual(["R1"]);
  });
  it("promotes manual rows only when confirmed, and keeps XPM rows", () => {
    const p = planGroupReconciliation(base({
      structure_entities: [{ entity_id: "A", source: "manual" }, { entity_id: "B", source: "xpm" }],
      structure_relationships: [{ relationship_id: "R1", source: "manual" }],
    }));
    expect(p.promote_members).toEqual(["A"]);
    expect(p.keep_members).toEqual(["B"]);
    expect(p.promote_links).toEqual(["R1"]);
  });
  it("never removes manual members or links; removes stale XPM ones", () => {
    const p = planGroupReconciliation(base({
      members: [{ xpm_uuid: "xa", entity_id: "A", name: "A", is_archived: false }],
      structure_entities: [
        { entity_id: "A", source: "xpm" }, { entity_id: "M", source: "manual" }, { entity_id: "X", source: "xpm" },
      ],
      structure_relationships: [{ relationship_id: "RM", source: "manual" }, { relationship_id: "R1", source: "xpm" }],
      relationships: [
        { id: "R1", type: "shareholder", from_id: "A", to_id: "B", source: "imported", xpm_managed: true, units: null, percent: null },
        { id: "RM", type: "appointer", from_id: "M", to_id: "A", source: "manual", xpm_managed: false, units: null, percent: null },
      ],
    }));
    expect(p.preserved.manual_members).toEqual(["M"]);
    expect(p.preserved.manual_links).toEqual(["RM"]);
    expect(p.remove_members).toEqual(["X"]);
    expect(p.remove_links).toEqual(["R1"]);
  });
  it("keeps an XPM member a retained manual link needs", () => {
    const p = planGroupReconciliation(base({
      members: [{ xpm_uuid: "xa", entity_id: "A", name: "A", is_archived: false }],
      structure_entities: [{ entity_id: "A", source: "xpm" }, { entity_id: "B", source: "xpm" }],
      structure_relationships: [{ relationship_id: "RM", source: "manual" }],
      relationships: [{ id: "RM", type: "appointer", from_id: "B", to_id: "A", source: "manual", xpm_managed: false, units: null, percent: null }],
    }));
    expect(p.remove_members).toEqual([]);
    expect(p.preserved.members_kept_for_manual_links).toEqual(["B"]);
  });
  it("archived members leave XPM-managed rows and are reported", () => {
    const p = planGroupReconciliation(base({
      members: [
        { xpm_uuid: "xa", entity_id: "A", name: "A", is_archived: false },
        { xpm_uuid: "xb", entity_id: "B", name: "B", is_archived: true },
        { xpm_uuid: "xc", entity_id: null, name: null, is_archived: false },
      ],
      structure_entities: [{ entity_id: "B", source: "xpm" }],
    }));
    expect(p.archived_members).toEqual(["B"]);
    expect(p.unresolved_members).toEqual(["xc"]);
    expect(p.remove_members).toEqual(["B"]);
    expect(p.add_links).toEqual([]);
  });
  it("confirmed set overrides the imported default", () => {
    const p = planGroupReconciliation(base(), { confirmedRelationshipIds: new Set() });
    expect(p.add_links).toEqual([]);
  });
  it("repeat sync of an applied group is a no-op", () => {
    const p = planGroupReconciliation(base({
      structure_entities: [{ entity_id: "A", source: "xpm" }, { entity_id: "B", source: "xpm" }],
      structure_relationships: [{ relationship_id: "R1", source: "xpm" }],
    }));
    expect(isNoopPlan(p)).toBe(true);
  });
});

describe("ownership figures", () => {
  it("parses XPM numbers: zero/blank → null, shares stay units", () => {
    expect(normaliseXpmOwnership({ shares: "60", percentage: "0" })).toEqual({ units: 60, percent: null });
    expect(normaliseXpmOwnership({ shares: "", percentage: "" })).toEqual({ units: null, percent: null });
    expect(normaliseXpmOwnership({ shares: "1,000", percentage: "25%" })).toEqual({ units: 1000, percent: 25 });
    expect(parseXpmNumber("abc")).toBeNull();
  });
  it("never infers a percentage from units", () => {
    expect(normaliseXpmOwnership({ shares: "100" }).percent).toBeNull();
  });
  it("only policy-allowed types keep figures", () => {
    expect(figuresForEdge("shareholder", "Company", { units: 60, percent: null })).toEqual({ units: 60, percent: null });
    expect(figuresForEdge("director", "Company", { units: 60, percent: 10 })).toBeNull();
  });
  it("refreshes XPM-managed figures and preserves manual overrides", () => {
    const figures = new Map([["R1", { units: 60, percent: null }]]);
    const managed = planGroupReconciliation(base(), { figures });
    expect(managed.metadata_updates).toEqual([{ relationship_id: "R1", units: 60, percent: null }]);
    const manual = planGroupReconciliation(base({
      relationships: [{ id: "R1", type: "shareholder", from_id: "A", to_id: "B", source: "imported", xpm_managed: false, units: 50, percent: 40 }],
    }), { figures });
    expect(manual.metadata_updates).toEqual([]);
    expect(manual.preserved.metadata_overrides).toEqual(["R1"]);
  });
  it("unchanged figures produce no update", () => {
    const p = planGroupReconciliation(base({
      relationships: [{ id: "R1", type: "shareholder", from_id: "A", to_id: "B", source: "imported", xpm_managed: true, units: 60, percent: null }],
    }), { figures: new Map([["R1", { units: 60, percent: null }]]) });
    expect(p.metadata_updates).toEqual([]);
  });
});
