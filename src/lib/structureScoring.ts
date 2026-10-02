/**
 * Deterministic Structure Health engine (v3 — semantic alignment).
 *
 * Health is a DATA-QUALITY indicator for the facts recorded in strukcha.
 * It is not tax, legal, regulatory or compliance advice, and it never says
 * an entity or structure is legally invalid.
 *
 * Severities (single source of truth — see ISSUE_SEVERITY):
 *   critical — stored facts contradict each other or are structurally
 *              impossible. Red. May block export (see exportBlocking.ts).
 *   gap      — "Review": important structural information is not recorded
 *              or is incomplete. Never blocks export.
 *   info     — optional information absent / recommendation. Zero deduction,
 *              no node icon, not counted in workspace Review totals.
 *
 * Status is issue-aware, never score-derived:
 *   critical only if a critical issue exists; warning if any review issue
 *   exists; otherwise good.
 *
 * Score: 0–100 completeness, split across four buckets (40/30/20/10).
 */

import type { EntityNode, RelationshipEdge } from "@/hooks/useStructureData";
import { isDirectionValid, getDirectionError, getRelationshipLabel } from "@/lib/relationshipRules";

// ── Types ──────────────────────────────────────────────────────────

export type IssueSeverity = "critical" | "gap" | "info";
export type HealthStatus = "good" | "warning" | "critical";

export interface ScoringIssue {
  code: string;
  category: "control" | "governance" | "structural" | "data";
  severity: IssueSeverity;
  message: string;
  entity_id?: string;
  entity_name?: string;
  relationship_id?: string;
  deduction: number;
  details?: any;
}

export interface HealthScoreV2 {
  rawScore: number;
  score: number;
  displayScore: number;
  status: HealthStatus;
  label: string;

  controlScore: number;    // 0–40
  governanceScore: number; // 0–30
  structuralScore: number; // 0–20
  dataScore: number;       // 0–10

  issues: ScoringIssue[];
  criticalGaps: ScoringIssue[];
  governanceGaps: ScoringIssue[];
  diagramIntegrity: ScoringIssue[];
  dataGaps: ScoringIssue[];

  entityCount: number;
  depthEstimate: number;
  controlChainStatus: "Confirmed" | "Incomplete";
  dataGapCount: number;
  oneLiner: string;
}

export const HEALTH_DISCLAIMER =
  "Health is a data-quality indicator for what is recorded in strukcha. It is not tax, legal, regulatory or compliance advice.";

// ── Issue catalogue (single source of truth) ──────────────────────

interface IssueDef {
  severity: IssueSeverity;
  category: ScoringIssue["category"];
  deduction: number;
}

export const ISSUE_DEFINITIONS: Readonly<Record<string, IssueDef>> = {
  // Critical — contradictions
  invalid_relationship_direction: { severity: "critical", category: "structural", deduction: 10 },
  circular_ownership: { severity: "critical", category: "control", deduction: 15 },
  ownership_exceeds: { severity: "critical", category: "governance", deduction: 10 },
  multiple_trades_as_owners: { severity: "critical", category: "control", deduction: 10 },
  // Review — important information not recorded / incomplete
  missing_trustee: { severity: "gap", category: "control", deduction: 5 },
  missing_member: { severity: "gap", category: "control", deduction: 5 },
  missing_trades_as_owner: { severity: "gap", category: "control", deduction: 8 },
  missing_partners: { severity: "gap", category: "control", deduction: 5 },
  missing_directors: { severity: "gap", category: "governance", deduction: 5 },
  missing_shareholders: { severity: "gap", category: "governance", deduction: 5 },
  missing_unit_holders: { severity: "gap", category: "governance", deduction: 5 },
  ownership_incomplete: { severity: "gap", category: "governance", deduction: 3 },
  ownership_under: { severity: "gap", category: "governance", deduction: 3 },
  duplicate_relationship: { severity: "gap", category: "structural", deduction: 2 },
  unclassified: { severity: "gap", category: "structural", deduction: 3 },
  orphan_entity: { severity: "gap", category: "structural", deduction: 2 },
  // Information — zero deduction
  missing_appointer: { severity: "info", category: "control", deduction: 0 },
  ownership_no_percent: { severity: "info", category: "governance", deduction: 0 },
  missing_identifiers: { severity: "info", category: "data", deduction: 0 },
};

export function getIssueSeverity(code: string): IssueSeverity {
  return ISSUE_DEFINITIONS[code]?.severity ?? "gap";
}

/** Issue-aware status. A low score alone never makes a structure Critical. */
export function getHealthStatus(issues: ReadonlyArray<Pick<ScoringIssue, "severity">>): HealthStatus {
  if (issues.some((i) => i.severity === "critical")) return "critical";
  if (issues.some((i) => i.severity === "gap")) return "warning";
  return "good";
}

/** Display metadata per status. Read by every Health surface. */
export const STATUS_META: Record<HealthStatus, {
  status: HealthStatus; label: string; description: string;
  text: string; dot: string; pill: string;
}> = {
  good: {
    status: "good", label: "Complete",
    description: "No conflicting data and no important gaps recorded",
    text: "text-success", dot: "bg-success", pill: "bg-success/15 text-success",
  },
  warning: {
    status: "warning", label: "Review recommended",
    description: "Some important information is not recorded",
    text: "text-warning", dot: "bg-warning", pill: "bg-warning/15 text-warning",
  },
  critical: {
    status: "critical", label: "Conflicting data",
    description: "Recorded facts contradict each other",
    text: "text-destructive", dot: "bg-destructive", pill: "bg-destructive/15 text-destructive",
  },
};

export const STATUS_ORDER: HealthStatus[] = ["critical", "warning", "good"];

export function getStatusMeta(status: HealthStatus) {
  return STATUS_META[status];
}

export const SEVERITY_LABEL: Record<IssueSeverity, string> = {
  critical: "Conflicting data",
  gap: "Review",
  info: "Information",
};

// ── Type helpers ───────────────────────────────────────────────────

/** Classified trust types (generic "Trust" must be classified first). */
const CLASSIFIED_TRUST_TYPES = new Set([
  "trust_discretionary", "trust_unit", "trust_hybrid", "trust_bare",
  "trust_testamentary", "trust_deceased_estate", "trust_family", "smsf",
]);
const UNIT_HOLDER_TARGETS = new Set(["trust_unit", "trust_hybrid"]);

/** Only these trust types are checked for a missing appointor. */
export const APPOINTOR_ELIGIBLE_TYPES: ReadonlySet<string> = new Set(["trust_discretionary", "trust_family"]);

const OWNERSHIP_TYPES = new Set(["shareholder", "unit_holder"]);

// ── Depth estimation ──────────────────────────────────────────────

function estimateDepth(entities: EntityNode[], relationships: RelationshipEdge[]): number {
  if (entities.length === 0) return 0;
  const ownershipTypes = new Set(["shareholder", "unit_holder", "beneficiary", "trustee", "member"]);
  const children = new Map<string, string[]>();
  const hasParent = new Set<string>();
  for (const rel of relationships) {
    if (!ownershipTypes.has(rel.relationship_type)) continue;
    const arr = children.get(rel.to_entity_id) ?? [];
    arr.push(rel.from_entity_id);
    children.set(rel.to_entity_id, arr);
    hasParent.add(rel.from_entity_id);
  }
  const entityIds = new Set(entities.map((e) => e.id));
  const roots = entities.filter((e) => !hasParent.has(e.id)).map((e) => e.id);
  if (roots.length === 0) return 1;
  let maxDepth = 0;
  const visited = new Set<string>();
  function dfs(node: string, depth: number) {
    if (visited.has(node)) return;
    visited.add(node);
    maxDepth = Math.max(maxDepth, depth);
    for (const child of children.get(node) ?? []) if (entityIds.has(child)) dfs(child, depth + 1);
    visited.delete(node);
  }
  for (const root of roots) dfs(root, 1);
  return maxDepth || 1;
}

/** Sum percentages in 1/10,000ths to avoid float drift (e.g. 33.33+33.33+33.34). */
function sumPercent(values: number[]): number {
  return values.reduce((s, v) => s + Math.round(Number(v) * 10000), 0) / 10000;
}

const notRecorded = (what: string, name: string) =>
  `No ${what} is recorded in strukcha for "${name}". Confirm whether the structure data is complete.`;

// ── Main scoring function ─────────────────────────────────────────

export function computeHealthScoreV2(
  entities: EntityNode[],
  relationships: RelationshipEdge[],
): HealthScoreV2 {
  const issues: ScoringIssue[] = [];
  const entityMap = new Map(entities.map((e) => [e.id, e]));

  const push = (code: string, message: string, extra: Partial<ScoringIssue> = {}) => {
    const def = ISSUE_DEFINITIONS[code];
    issues.push({ code, category: def.category, severity: def.severity, deduction: def.deduction, message, ...extra });
  };

  const inbound = new Map<string, Map<string, RelationshipEdge[]>>();
  const allRelated = new Set<string>();
  for (const rel of relationships) {
    allRelated.add(rel.from_entity_id);
    allRelated.add(rel.to_entity_id);
    if (!inbound.has(rel.to_entity_id)) inbound.set(rel.to_entity_id, new Map());
    const m = inbound.get(rel.to_entity_id)!;
    if (!m.has(rel.relationship_type)) m.set(rel.relationship_type, []);
    m.get(rel.relationship_type)!.push(rel);
  }
  const inboundOf = (id: string, type: string) => inbound.get(id)?.get(type) ?? [];

  // ── Entity-specific completeness ──
  for (const e of entities) {
    const t = e.entity_type;
    const ref = { entity_id: e.id, entity_name: e.name };

    if (CLASSIFIED_TRUST_TYPES.has(t) && inboundOf(e.id, "trustee").length === 0)
      push("missing_trustee", notRecorded("trustee", e.name), ref);

    if (t === "smsf" && inboundOf(e.id, "member").length === 0)
      push("missing_member", notRecorded("member", e.name), ref);

    if (APPOINTOR_ELIGIBLE_TYPES.has(t) && inboundOf(e.id, "appointer").length === 0)
      push("missing_appointer", `No appointor is recorded for "${e.name}". Confirm whether the trust deed includes an appointor.`, ref);

    if (t === "Company") {
      if (inboundOf(e.id, "director").length === 0) push("missing_directors", notRecorded("director", e.name), ref);
      if (inboundOf(e.id, "shareholder").length === 0) push("missing_shareholders", notRecorded("shareholder", e.name), ref);
      if (!e.acn && !e.abn) push("missing_identifiers", `No ABN or ACN is recorded for "${e.name}".`, ref);
    }

    if (UNIT_HOLDER_TARGETS.has(t) && inboundOf(e.id, "unit_holder").length === 0)
      push("missing_unit_holders", notRecorded("unit holder", e.name), ref);

    if (t === "Partnership" && inboundOf(e.id, "partner").length === 0)
      push("missing_partners", notRecorded("partner", e.name), ref);

    if (t === "Sole Trader") {
      const owners = inboundOf(e.id, "trades_as");
      if (owners.length === 0) push("missing_trades_as_owner", notRecorded("Trades As owner", e.name), ref);
      else if (owners.length > 1)
        push("multiple_trades_as_owners", `"${e.name}" has ${owners.length} Trades As owners recorded. A sole trader can only have one.`, { ...ref, details: { count: owners.length } });
    }

    if (t === "Unclassified")
      push("unclassified", `"${e.name}" has no entity type recorded. Classify it to complete the structure data.`, ref);
    else if (t === "Trust")
      push("unclassified", `"${e.name}" is recorded as a generic trust. Choose the trust type to complete the structure data.`, ref);

    if (!allRelated.has(e.id))
      push("orphan_entity", `"${e.name}" has no relationships recorded.`, ref);
  }

  // ── Ownership percentages (one issue per target) ──
  const ownershipByTarget = new Map<string, RelationshipEdge[]>();
  for (const rel of relationships) {
    if (!OWNERSHIP_TYPES.has(rel.relationship_type)) continue;
    const arr = ownershipByTarget.get(rel.to_entity_id) ?? [];
    arr.push(rel);
    ownershipByTarget.set(rel.to_entity_id, arr);
  }
  for (const [targetId, rels] of ownershipByTarget) {
    const name = entityMap.get(targetId)?.name ?? targetId;
    const ref = { entity_id: targetId, entity_name: name };
    const entered = rels.filter((r) => r.ownership_percent != null);
    if (entered.length === 0) {
      push("ownership_no_percent", `No ownership percentages are recorded for "${name}".`, ref);
      continue;
    }
    const total = sumPercent(entered.map((r) => r.ownership_percent as number));
    if (total > 100) {
      push("ownership_exceeds", `Recorded ownership for "${name}" totals ${total}%, which is more than 100%.`, { ...ref, details: { total } });
    } else if (entered.length < rels.length) {
      push("ownership_incomplete", `Some ownership percentages for "${name}" are blank (${entered.length} of ${rels.length} recorded). Confirm whether the structure data is complete.`, { ...ref, details: { total, entered: entered.length, count: rels.length } });
    } else if (total < 100) {
      push("ownership_under", `Recorded ownership for "${name}" totals ${total}%. Confirm whether the structure data is complete.`, { ...ref, details: { total } });
    }
  }

  // ── Circular ownership ──
  const ownAdj = new Map<string, string[]>();
  for (const rel of relationships) {
    if (!OWNERSHIP_TYPES.has(rel.relationship_type)) continue;
    const arr = ownAdj.get(rel.from_entity_id) ?? [];
    arr.push(rel.to_entity_id);
    ownAdj.set(rel.from_entity_id, arr);
  }
  const visited = new Set<string>();
  const inStack = new Set<string>();
  const stack: string[] = [];
  let cycle: string[] | null = null;
  function dfs(node: string) {
    if (cycle) return;
    if (inStack.has(node)) { cycle = stack.slice(stack.indexOf(node)); return; }
    if (visited.has(node)) return;
    visited.add(node); inStack.add(node); stack.push(node);
    for (const n of ownAdj.get(node) ?? []) dfs(n);
    stack.pop(); inStack.delete(node);
  }
  for (const id of ownAdj.keys()) if (!visited.has(id)) dfs(id);
  if (cycle) {
    const ids: string[] = cycle;
    const names = ids.map((id) => entityMap.get(id)?.name ?? id);
    push("circular_ownership", `Circular ownership is recorded: ${names.join(" → ")} → ${names[0]}`, {
      entity_id: ids[0], entity_name: names[0], details: { cycle: ids },
    });
  }

  // ── Duplicates ──
  const sigs = new Map<string, RelationshipEdge[]>();
  for (const rel of relationships) {
    const sig = `${rel.from_entity_id}:${rel.relationship_type}:${rel.to_entity_id}`;
    const arr = sigs.get(sig) ?? [];
    arr.push(rel);
    sigs.set(sig, arr);
  }
  for (const [, rels] of sigs) {
    if (rels.length < 2) continue;
    const from = entityMap.get(rels[0].from_entity_id);
    const to = entityMap.get(rels[0].to_entity_id);
    push("duplicate_relationship", `The ${getRelationshipLabel(rels[0].relationship_type)} link ${from?.name ?? "?"} → ${to?.name ?? "?"} is recorded more than once.`, {
      entity_id: rels[0].from_entity_id, entity_name: from?.name,
    });
  }

  // ── Invalid direction ──
  for (const rel of relationships) {
    const from = entityMap.get(rel.from_entity_id);
    const to = entityMap.get(rel.to_entity_id);
    if (from && to && !isDirectionValid(rel.relationship_type, from.entity_type, to.entity_type)) {
      const err = getDirectionError(rel.relationship_type, from.entity_type, to.entity_type);
      push("invalid_relationship_direction",
        `${getRelationshipLabel(rel.relationship_type)} link "${from.name}" (${from.entity_type}) → "${to.name}" (${to.entity_type}) contradicts the relationship rules. ${err ?? ""}`.trim(),
        { entity_id: from.id, entity_name: from.name, relationship_id: rel.id });
    }
  }

  // ── Scores ──
  const sumCat = (c: ScoringIssue["category"]) => issues.filter((i) => i.category === c).reduce((s, i) => s + i.deduction, 0);
  const controlScore = Math.max(0, 40 - sumCat("control"));
  const governanceScore = Math.max(0, 30 - sumCat("governance"));
  const structuralScore = Math.max(0, 20 - sumCat("structural"));
  const dataScore = Math.max(0, 10 - sumCat("data"));
  const score = Math.max(0, Math.min(100, controlScore + governanceScore + structuralScore + dataScore));
  const status = getHealthStatus(issues);

  const criticalGaps = issues.filter((i) => i.severity === "critical");
  const governanceGaps = issues.filter((i) => i.category === "governance" && i.severity !== "info");
  const diagramIntegrity = issues.filter((i) => i.category === "structural");
  const dataGaps = issues.filter((i) => i.category === "data");

  const oneLiner =
    status === "critical"
      ? "Some recorded facts contradict each other. Review the conflicting data."
      : status === "warning"
        ? "No conflicting data, but some important structure information is not recorded."
        : "No conflicting data or important gaps are recorded.";

  return {
    rawScore: score,
    score,
    displayScore: score,
    status,
    label: STATUS_META[status].label,
    controlScore,
    governanceScore,
    structuralScore,
    dataScore,
    issues,
    criticalGaps,
    governanceGaps,
    diagramIntegrity,
    dataGaps,
    entityCount: entities.length,
    depthEstimate: estimateDepth(entities, relationships),
    controlChainStatus: issues.some((i) => i.category === "control" && i.severity !== "info") ? "Incomplete" : "Confirmed",
    dataGapCount: issues.filter((i) => i.severity !== "info").length,
    oneLiner,
  };
}

export function computeHealthScoreV2Light(
  entities: EntityNode[],
  relationships: RelationshipEdge[],
): { score: number; displayScore: number; label: string; status: HealthStatus } {
  const full = computeHealthScoreV2(entities, relationships);
  return { score: full.score, displayScore: full.score, label: full.label, status: full.status };
}
