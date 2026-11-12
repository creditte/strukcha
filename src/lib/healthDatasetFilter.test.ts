import { describe, it, expect } from "vitest";
import { partitionHealthDataset } from "./healthDatasetFilter";
import { computeHealthScoreV2 } from "./structureScoring";

const ent = (id: string, type: string, archived = false) =>
  ({ id, name: id, entity_type: type, xpm_uuid: null, abn: null, acn: null, is_operating_entity: false, is_trustee_company: false, created_at: "2026-01-01", is_archived: archived });
const rel = (id: string, from: string, to: string, t = "director") =>
  ({ id, from_entity_id: from, to_entity_id: to, relationship_type: t, source_data: "imported", ownership_percent: null, ownership_units: null, ownership_class: null, created_at: "2026-01-01" });

describe("Structure Health ignores archived clients and diagrams", () => {
  it("archived clients produce no health issues", () => {
    // An orphaned (unlinked) archived trust would normally raise issues.
    const s = { id: "s1", name: "S", entities: [ent("p", "Individual"), ent("c", "Company"), ent("t", "Trust", true)], relationships: [rel("r1", "p", "c")] };
    const { active } = partitionHealthDataset([s]);
    const h = computeHealthScoreV2(active[0].entities as any, active[0].relationships as any);
    expect(h.issues.some((i: any) => JSON.stringify(i).includes('"t"'))).toBe(false);
    expect(active[0].entities.map((e) => e.id)).toEqual(["p", "c"]);
  });

  it("links involving archived clients are excluded", () => {
    const s = { id: "s1", name: "S", entities: [ent("p", "Individual"), ent("c", "Company"), ent("x", "Company", true)], relationships: [rel("r1", "p", "c"), rel("r2", "p", "x"), rel("r3", "x", "c", "shareholder")] };
    expect(partitionHealthDataset([s]).active[0].relationships.map((r) => r.id)).toEqual(["r1"]);
  });

  it("archived diagrams are excluded from health review", () => {
    const s = { id: "s1", name: "S", archived_at: "2026-09-19", entities: [ent("p", "Individual")], relationships: [] };
    const out = partitionHealthDataset([s]);
    expect(out.active).toHaveLength(0);
    expect(out.inactive).toHaveLength(0);
  });

  it("a diagram whose clients are all archived is Inactive, not scored as Healthy", () => {
    const s = { id: "s1", name: "A Hall Group", entities: [ent("a", "Individual", true), ent("b", "Company", true)], relationships: [rel("r", "a", "b")] };
    const out = partitionHealthDataset([s]);
    expect(out.active).toHaveLength(0);
    expect(out.inactive).toEqual([{ id: "s1", name: "A Hall Group" }]);
  });

  it("an empty diagram (never had clients) is not marked Inactive", () => {
    const out = partitionHealthDataset([{ id: "e", name: "Empty", entities: [], relationships: [] }]);
    expect(out.inactive).toHaveLength(0);
    expect(out.active).toHaveLength(1);
  });

  it("server 'inactive' flag is honoured", () => {
    const out = partitionHealthDataset([{ id: "s", name: "S", inactive: true, entities: [], relationships: [] }]);
    expect(out.inactive).toEqual([{ id: "s", name: "S" }]);
  });

  it("unarchiving a client restores its eligibility", () => {
    const base = [ent("p", "Individual"), ent("c", "Company", true)];
    const s = (ents: any[]) => ({ id: "s1", name: "S", entities: ents, relationships: [rel("r1", "p", "c")] });
    expect(partitionHealthDataset([s(base)]).active[0].relationships).toHaveLength(0);
    const restored = partitionHealthDataset([s([base[0], { ...base[1], is_archived: false }])]).active[0];
    expect(restored.entities.map((e) => e.id)).toEqual(["p", "c"]);
    expect(restored.relationships.map((r) => r.id)).toEqual(["r1"]);
  });

  it("active clients and diagrams are evaluated normally", () => {
    const s = { id: "s1", name: "S", entities: [ent("p", "Individual"), ent("c", "Company")], relationships: [rel("r1", "p", "c")] };
    const out = partitionHealthDataset([s]);
    expect(out.active[0]).toEqual(s);
    expect(out.inactive).toHaveLength(0);
  });
});
