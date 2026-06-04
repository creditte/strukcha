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

function isTrustType(t: string): boolean {
  return TRUST_TYPES.has(t) || t === "smsf";
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
      return toType === "Company" &&
        (fromType === "Individual" || fromType === "Company" || fromType === "smsf" ||
          fromType === "trust_discretionary" || fromType === "trust_family" || fromType === "trust_unit");
    case "unit_holder":
      return toType === "trust_unit" &&
        (fromType === "Individual" || fromType === "Company" || fromType === "smsf" ||
          fromType === "trust_discretionary" || fromType === "trust_unit");
    case "trustee":
      return (fromType === "Individual" || fromType === "Company") && isTrustType(toType);
    case "beneficiary":
      if (toType === "trust_bare") {
        return fromType === "Individual" || fromType === "Company" || fromType === "smsf";
      }
      return (fromType === "Individual" || fromType === "Company" || fromType === "smsf" ||
          fromType === "trust_discretionary" || fromType === "trust_family") &&
        (TRUST_TYPES.has(toType) && toType !== "trust_unit");
    case "member":
      return (fromType === "Individual" || fromType === "Company" || fromType === "smsf" ||
          fromType === "trust_discretionary") &&
        (toType === "trust_unit" || toType === "smsf");
    case "appointer":
      return (fromType === "Individual" || fromType === "Company") &&
        TRUST_TYPES.has(toType) && toType !== "smsf";
    case "settlor":
      return (fromType === "Individual" || fromType === "Company") && TRUST_TYPES.has(toType);
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

export function resolveRelationshipEndpoints(
  relType: string,
  clientEntityId: string,
  relatedEntityId: string,
  entityTypes: Map<string, string>,
  reverseFromXpm: boolean,
): { fromId: string; toId: string } | null {
  let fromId = clientEntityId;
  let toId = relatedEntityId;

  if (reverseFromXpm) {
    [fromId, toId] = [toId, fromId];
  }

  if (relType === "spouse" || relType === "partner") {
    if (fromId > toId) [fromId, toId] = [toId, fromId];
  }

  const fromType = entityTypes.get(fromId) ?? "Unclassified";
  const toType = entityTypes.get(toId) ?? "Unclassified";

  if (relType === "member" && fromType === "smsf" && toType === "Individual") {
    [fromId, toId] = [toId, fromId];
  }

  const aFrom = entityTypes.get(fromId) ?? "Unclassified";
  const aTo = entityTypes.get(toId) ?? "Unclassified";

  if (isRelationshipDirectionValid(relType, aFrom, aTo)) {
    return { fromId, toId };
  }
  if (isRelationshipDirectionValid(relType, aTo, aFrom)) {
    return { fromId: toId, toId: fromId };
  }

  return null;
}
