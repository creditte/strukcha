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

export function parseXpmRelationshipType(typeRaw: string): CanonicalRule | null {
  const key = typeRaw.trim().toLowerCase();
  return XPM_RELATIONSHIP_MAP[key] ?? null;
}

const TRUST_TYPES = new Set([
  "Trust", "trust_discretionary", "trust_unit", "trust_hybrid", "trust_bare",
  "trust_testamentary", "trust_deceased_estate", "trust_family",
]);

const DISCRETIONARY_TRUST_TYPES = new Set(["Trust", "trust_discretionary", "trust_family"]);

function isTrustType(t: string): boolean {
  return TRUST_TYPES.has(t) || t === "smsf";
}

function isDiscretionaryTrust(t: string): boolean {
  return DISCRETIONARY_TRUST_TYPES.has(t);
}

function isEligibleOwnershipSource(t: string): boolean {
  return t === "Individual" || t === "Company" || t === "smsf" || isTrustType(t);
}

/** Lightweight direction check aligned with validate_relationship_rules trigger. */
export function isRelationshipDirectionValid(
  relType: string,
  fromType: string,
  toType: string,
): boolean {
  switch (relType) {
    case "director":
      return fromType === "Individual" && toType === "Company";
    case "shareholder":
      return toType === "Company" && isEligibleOwnershipSource(fromType);
    case "unit_holder":
      return toType === "trust_unit" && isEligibleOwnershipSource(fromType);
    case "trustee":
      return (fromType === "Individual" || fromType === "Company") && isTrustType(toType);
    case "beneficiary":
      if (toType === "trust_bare") {
        return fromType === "Individual" || fromType === "Company" || fromType === "smsf";
      }
      return (fromType === "Individual" || fromType === "Company" || fromType === "smsf" ||
          isDiscretionaryTrust(fromType)) &&
        isTrustType(toType) && toType !== "trust_unit";
    case "member":
      return (fromType === "Individual" || fromType === "Company" || fromType === "smsf" ||
          isDiscretionaryTrust(fromType)) &&
        (toType === "trust_unit" || toType === "smsf");
    case "appointer":
      return (fromType === "Individual" || fromType === "Company") &&
        isTrustType(toType) && toType !== "smsf";
    case "settlor":
      return (fromType === "Individual" || fromType === "Company") && isTrustType(toType);
    case "partner":
      return (fromType === "Individual" || fromType === "Company") &&
        (toType === "Individual" || toType === "Company");
    case "spouse":
      return fromType === "Individual" && toType === "Individual";
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
