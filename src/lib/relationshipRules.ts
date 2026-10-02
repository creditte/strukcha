/**
 * Compatibility facade over the canonical relationship policy.
 *
 * Holds NO rules of its own: every answer is derived from
 * evaluateRelationship() / POLICY_RULES in src/lib/relationshipPolicy.ts.
 * Kept so existing imports compile. New code should import the policy.
 */
import {
  POLICY_RULES,
  CREATABLE_RELATIONSHIP_TYPES,
  categoryOf,
  evaluateRelationship,
  getPolicyRule,
  policyLabel,
  policyMetadataFields,
  describePolicyReason,
  type EntityCategory,
  type MetadataField as PolicyMetadataField,
  type RelationshipCategory as PolicyRelationshipCategory,
} from "@/lib/relationshipPolicy";

export type CanonicalEntityCategory = EntityCategory;
export type MetadataField = PolicyMetadataField;
export type RelationshipCategory = PolicyRelationshipCategory;

export function getCanonicalCategories(dbEntityType: string): CanonicalEntityCategory[] {
  return [categoryOf(dbEntityType)];
}

export interface RelationshipRule {
  type: string;
  label: string;
  allowedSourceTypes: readonly CanonicalEntityCategory[];
  allowedTargetTypes: readonly CanonicalEntityCategory[];
  /** Symmetric facts only (Spouse). Directed types are never freely reversible. */
  allowReverse: boolean;
  validationMessage: string;
  category: RelationshipCategory;
  metadataFields: readonly MetadataField[];
}

/** Canonical creatable types only — Child and Settlor are not included. */
export const RELATIONSHIP_RULES: readonly RelationshipRule[] = POLICY_RULES.map((r) => ({
  type: r.type,
  label: r.label,
  allowedSourceTypes: r.sources,
  allowedTargetTypes: r.targets,
  allowReverse: r.symmetric,
  validationMessage: r.message,
  category: r.category,
  metadataFields: r.metadataFields,
}));

export function getRuleForType(relationshipType: string): RelationshipRule | undefined {
  return RELATIONSHIP_RULES.find((r) => r.type === relationshipType);
}

export function getRelationshipLabel(relationshipType: string): string {
  return policyLabel(relationshipType);
}

/** Directional label for diagram edges and exports, e.g. "Trustee Of". */
export function getRelationshipEdgeLabel(relationshipType: string): string {
  if (relationshipType === "spouse") return "Spouse";
  return `${policyLabel(relationshipType)} Of`;
}

export function isBareTrustBeneficiary(relationshipType: string, targetEntityType: string): boolean {
  return relationshipType === "beneficiary" && categoryOf(targetEntityType) === "bare_trust";
}

/** True only when the policy outcome is `valid` as stored. Review is not valid. */
export function isDirectionValid(relationshipType: string, fromEntityType: string, toEntityType: string): boolean {
  return evaluateRelationship(relationshipType, fromEntityType, toEntityType).outcome === "valid";
}

/** User-facing message for any non-valid outcome (invalid, review, resolve, deprecated). */
export function getDirectionError(relationshipType: string, fromEntityType: string, toEntityType: string): string | null {
  const e = evaluateRelationship(relationshipType, fromEntityType, toEntityType);
  if (e.outcome === "valid") return null;
  if (e.outcome === "reverse") return "This link is stored in the wrong direction. Reverse it to fix.";
  return describePolicyReason(e);
}

export interface ValidRelationshipOption {
  type: string;
  needsReversal: boolean;
}

/** Creatable types whose outcome is valid or reverse for the pair. */
export function getValidRelationshipOptions(
  allTypes: readonly string[],
  fromEntityType: string,
  toEntityType: string,
): ValidRelationshipOption[] {
  const out: ValidRelationshipOption[] = [];
  for (const t of allTypes) {
    if (!CREATABLE_RELATIONSHIP_TYPES.includes(t)) continue;
    const e = evaluateRelationship(t, fromEntityType, toEntityType);
    if (e.outcome === "valid") out.push({ type: t, needsReversal: false });
    else if (e.outcome === "reverse") out.push({ type: t, needsReversal: true });
  }
  return out;
}

/** Creatable types valid exactly as given (no reversal). */
export function getValidRelationshipTypes(
  allTypes: readonly string[],
  fromEntityType: string,
  toEntityType: string,
): string[] {
  return getValidRelationshipOptions(allTypes, fromEntityType, toEntityType)
    .filter((o) => !o.needsReversal)
    .map((o) => o.type);
}

export function hasMetadataFields(relationshipType: string): boolean {
  return (getPolicyRule(relationshipType)?.metadataFields.length ?? 0) > 0;
}

export function getMetadataFields(relationshipType: string): readonly MetadataField[] {
  return getPolicyRule(relationshipType)?.metadataFields ?? [];
}

export function isDiscretionaryTrustBeneficiary(relationshipType: string, targetEntityType: string): boolean {
  return relationshipType === "beneficiary" && categoryOf(targetEntityType) === "discretionary_trust";
}

export function getEffectiveMetadataFields(relationshipType: string, targetEntityType?: string): readonly MetadataField[] {
  return policyMetadataFields(relationshipType, targetEntityType);
}

/**
 * Reversal is allowed only when the reversed row would be `valid` — so a
 * reversal can never turn a record into review/invalid.
 */
export function isReverseAllowed(relationshipType: string, currentFromEntityType: string, currentToEntityType: string): boolean {
  return evaluateRelationship(relationshipType, currentToEntityType, currentFromEntityType).outcome === "valid";
}
