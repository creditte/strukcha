/** XPM relationship parsing — mirrors import-xpm CSV logic and relationshipRules direction. */

export interface CanonicalRule {
  type: string;
  reverse: boolean;
}

export const XPM_RELATIONSHIP_MAP: Record<string, CanonicalRule> = {
  "director of": { type: "director", reverse: false },
  director: { type: "director", reverse: true },
  "shareholder of": { type: "shareholder", reverse: false },
  shareholder: { type: "shareholder", reverse: true },
  "unit holder of": { type: "unit_holder", reverse: false },
  "unit holder": { type: "unit_holder", reverse: true },
  "unit_holder of": { type: "unit_holder", reverse: false },
  unit_holder: { type: "unit_holder", reverse: true },
  "beneficiary of": { type: "beneficiary", reverse: false },
  beneficiary: { type: "beneficiary", reverse: true },
  "trustee of": { type: "trustee", reverse: false },
  trustee: { type: "trustee", reverse: true },
  "appointer of": { type: "appointer", reverse: false },
  appointer: { type: "appointer", reverse: true },
  "appointor of": { type: "appointer", reverse: false },
  appointor: { type: "appointer", reverse: true },
  "settlor of": { type: "settlor", reverse: false },
  settlor: { type: "settlor", reverse: true },
  "partner of": { type: "partner", reverse: false },
  partner: { type: "partner", reverse: false },
  spouse: { type: "spouse", reverse: false },
  "spouse of": { type: "spouse", reverse: false },
  "parent of": { type: "parent", reverse: false },
  parent: { type: "parent", reverse: true },
  "child of": { type: "child", reverse: false },
  child: { type: "child", reverse: true },
  "member of": { type: "member", reverse: false },
  member: { type: "member", reverse: true },
};

/**
 * XPM labels that are deliberately not modelled as structure relationships.
 * These are statutory office holdings, not ownership or control links, so they
 * are dropped without a warning instead of being reported as sync problems.
 */
export const XPM_IGNORED_RELATIONSHIP_LABELS = new Set([
  "secretary",
  "secretary of",
  "public officer",
  "public officer of",
  "contact",
  "contact of",
]);

export function parseXpmRelationshipType(typeRaw: string): CanonicalRule | null {
  const key = typeRaw.trim().toLowerCase();
  if (XPM_IGNORED_RELATIONSHIP_LABELS.has(key)) return null;
  return XPM_RELATIONSHIP_MAP[key] ?? null;
}

/**
 * Mirrors public.rel_direction_valid() exactly (migration 20260915134932).
 * Keep the two in step: if they disagree, previews, group imports and full
 * syncs produce different diagrams, or the database rejects a whole batch.
 */
const ALL_TRUSTS = [
  "Trust", "trust_discretionary", "trust_unit", "trust_hybrid", "trust_bare",
  "trust_testamentary", "trust_deceased_estate", "trust_family",
];
const DISCRETIONARY_LIKE = ["Trust", "trust_discretionary", "trust_family"];
const OWNERSHIP_SOURCES = ["Individual", "Company", "smsf", "trust_unit", ...DISCRETIONARY_LIKE];
const BENEFICIARY_SOURCES = ["Individual", "Company", "smsf", ...DISCRETIONARY_LIKE];
const BENEFICIARY_TARGETS = [
  "Trust", "trust_discretionary", "trust_family", "trust_hybrid", "trust_bare",
  "trust_testamentary", "trust_deceased_estate",
];

const inList = (v: string, list: string[]) => list.includes(v);

/** Direction check aligned with the database trigger; unknown types pass through. */
export function isRelationshipDirectionValid(
  relType: string,
  fromType: string,
  toType: string,
): boolean {
  if (!fromType || !toType) return true;
  // Unclassified means "type not known yet", not "wrong": treat as permissive.
  if (fromType === "Unclassified" || toType === "Unclassified") return true;

  switch (relType) {
    case "director":
      return fromType === "Individual" && toType === "Company";
    case "shareholder":
      return toType === "Company" && inList(fromType, OWNERSHIP_SOURCES);
    case "unit_holder":
      return toType === "trust_unit" && inList(fromType, OWNERSHIP_SOURCES);
    case "trustee":
      return inList(fromType, ["Individual", "Company"]) &&
        inList(toType, [...ALL_TRUSTS, "smsf"]);
    case "beneficiary":
      if (toType === "trust_bare") {
        return inList(fromType, ["Individual", "Company", "smsf"]);
      }
      return inList(fromType, BENEFICIARY_SOURCES) && inList(toType, BENEFICIARY_TARGETS);
    case "member":
      return inList(fromType, BENEFICIARY_SOURCES) && inList(toType, ["trust_unit", "smsf"]);
    case "appointer":
      return inList(fromType, ["Individual", "Company"]) && inList(toType, ALL_TRUSTS);
    case "settlor":
      return inList(fromType, ["Individual", "Company"]) && inList(toType, ALL_TRUSTS);
    case "partner":
      return inList(fromType, ["Individual", "Company"]) && inList(toType, ["Individual", "Company"]);
    case "spouse":
    case "parent":
    case "child":
      return fromType === "Individual" && toType === "Individual";
    default:
      return true;
  }
}

/**
 * Pick valid from/to endpoints. Tries both orientations so XPM's ambiguous
 * "Trustee"/"Shareholder" labels on either client record resolve correctly.
 */
export function resolveRelationshipEndpoints(
  relType: string,
  clientEntityId: string,
  relatedEntityId: string,
  entityTypes: Map<string, string>,
  _reverseFromXpm?: boolean,
): { fromId: string; toId: string } | null {
  const orientations: [string, string][] = [
    [clientEntityId, relatedEntityId],
    [relatedEntityId, clientEntityId],
  ];

  for (const [fromId, toId] of orientations) {
    const fromType = entityTypes.get(fromId) ?? "Unclassified";
    const toType = entityTypes.get(toId) ?? "Unclassified";

    if (relType === "member" && fromType === "smsf" && toType === "Individual") {
      if (isRelationshipDirectionValid(relType, toType, fromType)) {
        return { fromId: toId, toId: fromId };
      }
      continue;
    }

    if (!isRelationshipDirectionValid(relType, fromType, toType)) continue;

    if (relType === "spouse" || relType === "partner") {
      return fromId > toId ? { fromId: toId, toId: fromId } : { fromId, toId };
    }
    return { fromId, toId };
  }

  return null;
}

/** Build deduped edges for preview/import from XPM client relationship rows. */
export function buildXpmEdges(
  nodes: Array<{
    id: string;
    entityType: string;
    relationships: Array<{ typeRaw: string; relatedClientUuid: string; percentage: number | null }>;
  }>,
  memberIds?: Set<string>,
): Array<{ id: string; source: string; target: string; type: string; percentage: number | null }> {
  const entityTypes = new Map(nodes.map((n) => [n.id, n.entityType]));
  const edges: Array<{ id: string; source: string; target: string; type: string; percentage: number | null }> = [];
  const edgeDedupeSet = new Set<string>();

  for (const node of nodes) {
    for (const rel of node.relationships) {
      const targetId = rel.relatedClientUuid;
      if (!targetId) continue;
      if (memberIds && !memberIds.has(targetId)) continue;

      const rule = parseXpmRelationshipType(rel.typeRaw);
      if (!rule) continue;

      const endpoints = resolveRelationshipEndpoints(
        rule.type,
        node.id,
        targetId,
        entityTypes,
      );
      if (!endpoints) continue;

      const { fromId: source, toId: target } = endpoints;
      const dedupeKey = `${rule.type}:${source}:${target}`;
      const reverseDedupe = `${rule.type}:${target}:${source}`;
      if (edgeDedupeSet.has(dedupeKey) || edgeDedupeSet.has(reverseDedupe)) continue;
      edgeDedupeSet.add(dedupeKey);

      edges.push({
        id: `${source}-${rule.type}-${target}`,
        source,
        target,
        type: rule.type,
        percentage: rel.percentage,
      });
    }
  }

  return edges;
}
