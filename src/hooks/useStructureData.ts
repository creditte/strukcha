import { useEffect, useState, useMemo, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { computeHealthScoreV2, type HealthScoreV2, type ScoringIssue } from "@/lib/structureScoring";
type LayoutStrategy = "auto" | "manual";

// ── Types ──────────────────────────────────────────────────────────

export interface EntityNode {
  id: string;
  name: string;
  entity_type: string;
  xpm_uuid: string | null;
  abn: string | null;
  acn: string | null;
  is_operating_entity: boolean;
  is_trustee_company: boolean;
  is_investment_company: boolean;
  created_at: string;
  tfn: string | null;
  state: string | null;
  client_code: string | null;
  account_manager: string | null;
  gst_registered: boolean;
  is_archived: boolean;
}

export interface RelationshipEdge {
  id: string;
  from_entity_id: string;
  to_entity_id: string;
  relationship_type: string;
  source_data: string;
  ownership_percent: number | null;
  ownership_units: number | null;
  ownership_class: string | null;
  created_at: string;
}

export interface ValidationIssue {
  code: string;
  severity: "error" | "warning" | "info";
  message: string;
  entity_id?: string;
  entity_name?: string;
  relationship_id?: string;
  details?: any;
}

export interface StructureHealth {
  score: number;
  status: "good" | "warning" | "critical";
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
  info: ValidationIssue[];
}

// ── Constants ──────────────────────────────────────────────────────

const FAMILY_TYPES = new Set(["spouse", "parent", "child"]);
const OWNERSHIP_VIEW_TYPES = new Set(["shareholder", "unit_holder", "beneficiary", "partner", "member"]);
const CONTROL_VIEW_TYPES = new Set(["director", "trustee", "appointer", "settlor"]);

// ── Hook: useStructureData ─────────────────────────────────────────

export function useStructureData(structureId: string | undefined) {
  const [entities, setEntities] = useState<EntityNode[]>([]);
  const [relationships, setRelationships] = useState<RelationshipEdge[]>([]);
  const [structureName, setStructureName] = useState("");
  const [loading, setLoading] = useState(true);
  const [version, setVersion] = useState(0);
  const [layoutMode, setLayoutModeState] = useState<LayoutStrategy>("auto");
  const [nodePositions, setNodePositions] = useState<Map<string, { x: number; y: number }>>(new Map());
  const [isScenario, setIsScenario] = useState(false);
  const [scenarioLabel, setScenarioLabel] = useState<string | null>(null);
  const [parentStructureId, setParentStructureId] = useState<string | null>(null);
  const [parentStructureName, setParentStructureName] = useState<string | null>(null);

  const reload = () => setVersion((v) => v + 1);

  useEffect(() => {
    if (!structureId) return;

    async function load() {
      setLoading(true);

      const { data: struct } = await supabase
        .from("structures")
        .select("name, layout_mode, is_scenario, scenario_label, parent_structure_id")
        .eq("id", structureId)
        .single();
      setStructureName(struct?.name ?? "");
      setLayoutModeState((struct?.layout_mode as LayoutStrategy) ?? "auto");
      setIsScenario(!!(struct as any)?.is_scenario);
      setScenarioLabel((struct as any)?.scenario_label ?? null);
      const parentId = (struct as any)?.parent_structure_id ?? null;
      setParentStructureId(parentId);

      // Fetch parent name if scenario
      if (parentId) {
        const { data: parent } = await supabase
          .from("structures")
          .select("name")
          .eq("id", parentId)
          .single();
        setParentStructureName(parent?.name ?? null);
      } else {
        setParentStructureName(null);
      }

      const { data: seRows } = await supabase
        .from("structure_entities")
        .select("entity_id, position_x, position_y")
        .eq("structure_id", structureId);

      // Build positions map from DB
      const posMap = new Map<string, { x: number; y: number }>();
      const entityIds: string[] = [];
      for (const row of seRows ?? []) {
        entityIds.push(row.entity_id);
        if (row.position_x != null && row.position_y != null) {
          posMap.set(row.entity_id, { x: row.position_x, y: row.position_y });
        }
      }
      setNodePositions(posMap);

      if (entityIds.length === 0) {
        setEntities([]);
        setRelationships([]);
        setLoading(false);
        return;
      }

      const { data: entitiesData } = await supabase
        .from("entities")
        .select("id, name, entity_type, xpm_uuid, abn, acn, is_operating_entity, is_trustee_company, is_investment_company, created_at, tfn, state, client_code, account_manager, gst_registered, is_archived")
        .in("id", entityIds)
        .is("deleted_at", null)
        // Archived in XPM = no longer part of the active structure, but the
        // record and its history are kept.
        .eq("is_archived", false);
      const liveEntities = (entitiesData as EntityNode[]) ?? [];
      const liveEntityIds = new Set(liveEntities.map((e) => e.id));
      setEntities(liveEntities);

      const { data: srRows } = await supabase
        .from("structure_relationships")
        .select("relationship_id")
        .eq("structure_id", structureId);

      const relIds = (srRows ?? []).map((r) => r.relationship_id);
      if (relIds.length > 0) {
        const { data: relData } = await supabase
          .from("relationships")
          .select("id, from_entity_id, to_entity_id, relationship_type, source, ownership_percent, ownership_units, ownership_class, created_at")
          .in("id", relIds)
          .is("deleted_at", null);
        setRelationships(
          (relData ?? [])
            // Drop edges pointing at an archived entity so no line dangles.
            .filter((r) =>
              liveEntityIds.has(r.from_entity_id) && liveEntityIds.has(r.to_entity_id)
            )
            .map((r) => ({
            id: r.id,
            from_entity_id: r.from_entity_id,
            to_entity_id: r.to_entity_id,
            relationship_type: r.relationship_type,
            source_data: r.source,
            ownership_percent: r.ownership_percent,
            ownership_units: r.ownership_units,
            ownership_class: r.ownership_class,
            created_at: r.created_at,
          }))
        );
      } else {
        setRelationships([]);
      }

      setLoading(false);
    }

    load();
  }, [structureId, version]);

  // ── Layout mode change (persisted to DB + audit) ─────────────────
  const setLayoutMode = useCallback(async (newMode: LayoutStrategy) => {
    if (!structureId) return;
    const prevMode = layoutMode;
    setLayoutModeState(newMode);

    await supabase
      .from("structures")
      .update({ layout_mode: newMode } as any)
      .eq("id", structureId);

    // Audit log for mode change
    const { data: profile } = await supabase
      .from("profiles")
      .select("tenant_id, user_id")
      .eq("user_id", (await supabase.auth.getUser()).data.user?.id ?? "")
      .single();

    if (profile) {
      await supabase.from("audit_log").insert({
        tenant_id: profile.tenant_id,
        user_id: profile.user_id,
        action: "layout_mode_change",
        entity_type: "structure",
        entity_id: structureId,
        after_state: { previous_mode: prevMode, new_mode: newMode } as any,
      });
    }
  }, [structureId, layoutMode]);

  // ── Save node positions to DB (debounced from graph) ─────────────
  const saveNodePositions = useCallback(async (positions: Map<string, { x: number; y: number }>) => {
    if (!structureId) return;
    setNodePositions(positions);

    // Batch upsert positions
    const updates = Array.from(positions.entries()).map(([entityId, pos]) => ({
      structure_id: structureId,
      entity_id: entityId,
      position_x: Math.round(pos.x * 100) / 100,
      position_y: Math.round(pos.y * 100) / 100,
    }));

    // Update each row individually (structure_entities has composite PK)
    for (const u of updates) {
      await supabase
        .from("structure_entities")
        .update({ position_x: u.position_x, position_y: u.position_y } as any)
        .eq("structure_id", u.structure_id)
        .eq("entity_id", u.entity_id);
    }
  }, [structureId]);

  // ── Clear all positions (reset to auto) ──────────────────────────
  const clearNodePositions = useCallback(async () => {
    if (!structureId) return;
    setNodePositions(new Map());

    await supabase
      .from("structure_entities")
      .update({ position_x: null, position_y: null } as any)
      .eq("structure_id", structureId);
  }, [structureId]);

  // ── StructureHealth: adapter over the shared engine ───────────

  const structureHealth = useMemo<StructureHealth>(() => toStructureHealth(computeHealthScoreV2(entities, relationships)), [entities, relationships]);

  return { entities, relationships, structureName, loading, reload, structureHealth, layoutMode, nodePositions, setLayoutMode, saveNodePositions, clearNodePositions, isScenario, scenarioLabel, parentStructureId, parentStructureName };
}

// ── Hook: useFilteredGraph ─────────────────────────────────────────

export function useFilteredGraph(
  entities: EntityNode[],
  relationships: RelationshipEdge[],
  options: {
    search: string;
    showFamily: boolean;
    filterRelType: string;
    depth: number;
    selectedEntityId: string | null;
    viewMode: string;
  }
) {
  return useMemo(() => {
    const { search, showFamily, filterRelType, depth, selectedEntityId, viewMode } = options;

    let filteredRels = relationships.filter((r) => {
      if (viewMode === "ownership" && !OWNERSHIP_VIEW_TYPES.has(r.relationship_type)) return false;
      if (viewMode === "control" && !CONTROL_VIEW_TYPES.has(r.relationship_type)) return false;
      // Full view always shows family links (spouse/parent/child)
      if (!showFamily && viewMode !== "full" && FAMILY_TYPES.has(r.relationship_type)) return false;
      if (filterRelType && r.relationship_type !== filterRelType) return false;
      return true;
    });

    let visibleEntityIds: Set<string>;
    if (selectedEntityId) {
      visibleEntityIds = new Set<string>();
      let frontier = new Set([selectedEntityId]);
      for (let d = 0; d < depth; d++) {
        const nextFrontier = new Set<string>();
        for (const eid of frontier) {
          visibleEntityIds.add(eid);
          for (const rel of filteredRels) {
            if (rel.from_entity_id === eid && !visibleEntityIds.has(rel.to_entity_id)) {
              nextFrontier.add(rel.to_entity_id);
            }
            if (rel.to_entity_id === eid && !visibleEntityIds.has(rel.from_entity_id)) {
              nextFrontier.add(rel.from_entity_id);
            }
          }
        }
        frontier = nextFrontier;
      }
      for (const eid of frontier) visibleEntityIds.add(eid);
    } else {
      visibleEntityIds = new Set(entities.map((e) => e.id));
    }

    let visibleEntities = entities.filter((e) => visibleEntityIds.has(e.id));
    if (search) {
      const q = search.toLowerCase();
      const matchIds = new Set(
        visibleEntities.filter((e) => e.name.toLowerCase().includes(q)).map((e) => e.id)
      );
      const connectedIds = new Set(matchIds);
      for (const rel of filteredRels) {
        if (matchIds.has(rel.from_entity_id)) connectedIds.add(rel.to_entity_id);
        if (matchIds.has(rel.to_entity_id)) connectedIds.add(rel.from_entity_id);
      }
      visibleEntities = visibleEntities.filter((e) => connectedIds.has(e.id));
    }

    const finalEntityIds = new Set(visibleEntities.map((e) => e.id));
    filteredRels = filteredRels.filter(
      (r) => finalEntityIds.has(r.from_entity_id) && finalEntityIds.has(r.to_entity_id)
    );

    return { visibleEntities, visibleRelationships: filteredRels };
  }, [entities, relationships, options.search, options.showFamily, options.filterRelType, options.depth, options.selectedEntityId, options.viewMode]);
}

// ── Shared-engine adapter (no rules of its own) ───────────────────

const SEVERITY_TO_VALIDATION: Record<ScoringIssue["severity"], ValidationIssue["severity"]> = {
  critical: "error",
  gap: "warning",
  info: "info",
};

function toValidationIssue(i: ScoringIssue): ValidationIssue {
  return {
    code: i.code,
    severity: SEVERITY_TO_VALIDATION[i.severity],
    message: i.message,
    entity_id: i.entity_id,
    entity_name: i.entity_name,
    relationship_id: i.relationship_id,
    details: i.details,
  };
}

/** Maps the shared HealthScoreV2 result to the legacy StructureHealth shape. */
export function toStructureHealth(h: HealthScoreV2): StructureHealth {
  const issues = h.issues.map(toValidationIssue);
  return {
    score: h.score,
    status: h.status,
    errors: issues.filter((i) => i.severity === "error"),
    warnings: issues.filter((i) => i.severity === "warning"),
    info: issues.filter((i) => i.severity === "info"),
  };
}

export function computeStructureHealth(
  entities: EntityNode[],
  relationships: RelationshipEdge[]
): Pick<StructureHealth, "score" | "status"> {
  const h = computeHealthScoreV2(entities, relationships);
  return { score: h.score, status: h.status };
}
