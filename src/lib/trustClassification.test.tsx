import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { computeHealthScoreV2 } from "./structureScoring";
import { ENTITY_TYPES } from "./entityTypes";
import { resolveEntityType } from "../../supabase/functions/_shared/xpm-entity-type";
import { xpmBusinessStructureFields } from "../../supabase/functions/_shared/xpm-business-structure";
import EntityEditForm from "@/components/structure/EntityEditForm";
import CanvasFixMode from "@/components/structure/CanvasFixMode";
import type { EntityNode, RelationshipEdge } from "@/hooks/useStructureData";

const { update } = vi.hoisted(() => ({ update: vi.fn(() => ({ eq: vi.fn(async () => ({ error: null })) })) }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: () => ({ update }) } }));
vi.mock("@/components/ui/select", () => ({
  Select: ({ children, value, onValueChange }: any) => <select aria-label="Entity type" value={value ?? ""} onChange={(e) => onValueChange(e.target.value)}>{children}</select>,
  SelectContent: ({ children }: any) => <>{children}</>,
  SelectItem: ({ children, value }: any) => <option value={value}>{children}</option>,
  SelectTrigger: () => null, SelectValue: () => null,
}));
afterEach(() => { cleanup(); vi.clearAllMocks(); });
const entity = (id: string, type: string): EntityNode => ({ id, name: id, entity_type: type, abn: null, acn: null } as EntityNode);
const link = (type: string): RelationshipEdge => ({ id: type, from_entity_id: "person", to_entity_id: "trust", relationship_type: type, source_data: "imported", ownership_percent: null, ownership_units: null, ownership_class: null, created_at: "" });

describe("standard Trust classifications", () => {
  it.each(["Trust", "trust_unit"])("%s with recorded roles has no classification penalty or review issue", (type) => {
    const health = computeHealthScoreV2([entity("person", "Individual"), entity("trust", type)], [link("trustee"), ...(type === "trust_unit" ? [link("unit_holder")] : [])]);
    expect(health.score).toBe(100);
    expect(health.status).toBe("good");
    expect(health.issues.filter((i) => i.severity !== "info")).toEqual([]);
  });
  it("Trust and Unit Trust are selectable classifications", () => {
    expect(ENTITY_TYPES).toContain("Trust");
    expect(ENTITY_TYPES).toContain("trust_unit");
  });
  it("Fix Mode saves plain Trust rather than a forced specific type", async () => {
    render(<CanvasFixMode issues={[{ code: "unclassified", category: "structural", severity: "gap", message: "", deduction: 3, entity_id: "fictional", entity_name: "Fictional" }]} entities={[entity("fictional", "Unclassified")]} structureName="Fictional" onClose={vi.fn()} onFocusEntity={vi.fn()} onEntityUpdated={vi.fn()} onExport={vi.fn()} />);
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "Trust" } });
    await waitFor(() => expect(update).toHaveBeenCalledWith({ entity_type: "Trust" }));
  });
  it("editing a plain Trust retains Trust", async () => {
    const save = vi.fn(async () => {});
    render(<EntityEditForm entity={entity("fictional", "Trust")} onSave={save} onCancel={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(save).toHaveBeenCalledWith(expect.objectContaining({ entity_type: "Trust" })));
  });
  it.each(["trust_discretionary", "trust_family", "trust_unit"])("editing %s retains its specific classification", async (type) => {
    const save = vi.fn(async () => {});
    render(<EntityEditForm entity={entity("fictional", type)} onSave={save} onCancel={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(save).toHaveBeenCalledWith(expect.objectContaining({ entity_type: type })));
  });
});

describe("original XPM wording", () => {
  it("preserves exact custom wording independently of unchanged keyword classification", () => {
    const wording = "Discretionary Trading Trust";
    expect(xpmBusinessStructureFields(wording)).toEqual({ xpm_business_structure_label: wording });
    expect(resolveEntityType(wording)).toBe("trust_discretionary");
    expect(resolveEntityType("Trust")).toBe("Trust");
    expect(resolveEntityType("Unit Trust")).toBe("trust_unit");
  });
  it.each([null, undefined, "", "   "])("does not fabricate labels for %s", (label) => {
    expect(xpmBusinessStructureFields(label)).toEqual({});
  });
});