/**
 * Canonical Entity & Relationship Policy (Rulebook v1) — Phase 1 foundation.
 *
 * SINGLE application authority for relationship validity. It returns a
 * structured evaluation, never a bare boolean, so callers can tell "valid"
 * apart from "needs a person to look at it".
 *
 * The SQL twin is public.relationship_policy_evaluate() in
 * supabase/pending-migrations/phase1/002_relationship_policy_foundation.sql.
 * Both must agree with src/test/fixtures/relationship-policy-vectors.json.
 *
 * Phase 1: nothing in the running app calls evaluateRelationship() yet.
 * See docs/relationship-policy.md.
 */

// ── Entity categories ────────────────────────────────────────────

export type EntityCategory =
  | "individual"
  | "company"
  | "partnership"
  | "sole_trader"
  | "incorporated_association"
  | "discretionary_trust" // includes Family Trust — identical behaviour
  | "unit_trust"
  | "hybrid_trust"
  | "bare_trust"
  | "testamentary_trust"
  | "deceased_estate"
  | "smsf"
  | "generic_trust" // review state: a trust whose kind is unknown
  | "unclassified"; // review state: entity type unknown

const DB_TYPE_TO_CATEGORY: Record<string, EntityCategory> = {
  Individual: "individual",
  Company: "company",
  Partnership: "partnership",
  "Sole Trader": "sole_trader",
  "Incorporated Association/Club": "incorporated_association",
  trust_discretionary: "discretionary_trust",
  trust_family: "discretionary_trust",
  trust_unit: "unit_trust",
  trust_hybrid: "hybrid_trust",
  trust_bare: "bare_trust",
  trust_testamentary: "testamentary_trust",
  trust_deceased_estate: "deceased_estate",
  smsf: "smsf",
  Trust: "generic_trust",
  Unclassified: "unclassified",
};

/** Map a raw DB entity_type to its category. Unknown/blank → unclassified. */
export function categoryOf(dbEntityType: string | null | undefined): EntityCategory {
  if (!dbEntityType) return "unclassified";
  return DB_TYPE_TO_CATEGORY[dbEntityType] ?? "unclassified";
}

export const CLASSIFIED_TRUSTS: readonly EntityCategory[] = [
  "discretionary_trust",
  "unit_trust",
  "hybrid_trust",
  "bare_trust",
  "testamentary_trust",
  "deceased_estate",
];

const TRUST_LIKE = new Set<EntityCategory>([...CLASSIFIED_TRUSTS, "smsf", "generic_trust"]);

/** Approved direct economic owners (shareholder / unit holder / beneficiary). */
const ECONOMIC_OWNERS: readonly EntityCategory[] = [
  "individual",
  "company",
  "partnership",
  ...CLASSIFIED_TRUSTS,
  "smsf",
  "incorporated_association",
];

const PARTNER_SOURCES: readonly EntityCategory[] = [
  "individual",
  "company",
  ...CLASSIFIED_TRUSTS,
  "smsf",
  "incorporated_association",
];

// ── Rules ────────────────────────────────────────────────────────

export type MetadataField = "ownership_percent" | "ownership_units" | "ownership_class";
export type RelationshipCategory = "governance" | "ownership" | "family" | "identity";

export interface PolicyRule {
  type: string;
  label: string;
  sources: readonly EntityCategory[];
  targets: readonly EntityCategory[];
  /** One unordered fact (A–B equals B–A). */
  symmetric: boolean;
  /** May flip a reversed input when only the flipped direction is valid. */
  autoReverse: boolean;
  /** A Sole Trader source must be replaced by its underlying Individual. */
  soleTraderResolves: boolean;
  /** Stricter source list when the target is a Bare Trust. */
  bareTrustSources?: readonly EntityCategory[];
  metadataFields: readonly MetadataField[];
  category: RelationshipCategory;
  message: string;
}

const OWNERSHIP_META: readonly MetadataField[] = ["ownership_percent", "ownership_units", "ownership_class"];

export const POLICY_RULES: readonly PolicyRule[] = [
  { type: "director", label: "Director", sources: ["individual"], targets: ["company"], symmetric: false, autoReverse: true, soleTraderResolves: false, metadataFields: [], category: "governance", message: "Directors must be individuals and can only be linked to companies." },
  { type: "shareholder", label: "Shareholder", sources: ECONOMIC_OWNERS, targets: ["company"], symmetric: false, autoReverse: true, soleTraderResolves: true, metadataFields: OWNERSHIP_META, category: "ownership", message: "Shareholders can only be linked to companies." },
  { type: "unit_holder", label: "Unit Holder", sources: ECONOMIC_OWNERS, targets: ["unit_trust", "hybrid_trust"], symmetric: false, autoReverse: true, soleTraderResolves: true, metadataFields: OWNERSHIP_META, category: "ownership", message: "Unit holders can only be linked to unit or hybrid trusts." },
  { type: "trustee", label: "Trustee", sources: ["individual", "company"], targets: [...CLASSIFIED_TRUSTS, "smsf"], symmetric: false, autoReverse: true, soleTraderResolves: false, metadataFields: [], category: "governance", message: "Trustees must be individuals or companies and can only be linked to trusts or SMSFs." },
  { type: "beneficiary", label: "Beneficiary", sources: ECONOMIC_OWNERS, targets: ["discretionary_trust", "hybrid_trust", "bare_trust", "testamentary_trust", "deceased_estate"], symmetric: false, autoReverse: true, soleTraderResolves: true, bareTrustSources: ["individual", "company", "smsf"], metadataFields: ["ownership_percent"], category: "ownership", message: "Beneficiaries can only be linked to eligible trust entities." },
  { type: "member", label: "Member", sources: ["individual"], targets: ["smsf"], symmetric: false, autoReverse: true, soleTraderResolves: false, metadataFields: [], category: "governance", message: "Members must be individuals and can only be linked to SMSFs." },
  { type: "appointer", label: "Appointor", sources: ["individual", "company"], targets: ["discretionary_trust"], symmetric: false, autoReverse: true, soleTraderResolves: false, metadataFields: [], category: "governance", message: "Appointors must be individuals or companies and can only be linked to discretionary trusts." },
  { type: "partner", label: "Partner", sources: PARTNER_SOURCES, targets: ["partnership"], symmetric: false, autoReverse: true, soleTraderResolves: true, metadataFields: ["ownership_percent"], category: "ownership", message: "Partners can only be linked to partnerships." },
  { type: "spouse", label: "Spouse", sources: ["individual"], targets: ["individual"], symmetric: true, autoReverse: false, soleTraderResolves: false, metadataFields: [], category: "family", message: "Spouse relationships can only be between individuals." },
  { type: "parent", label: "Parent", sources: ["individual"], targets: ["individual"], symmetric: false, autoReverse: false, soleTraderResolves: false, metadataFields: [], category: "family", message: "Parent relationships can only be between individuals." },
  { type: "trades_as", label: "Trades As", sources: ["individual"], targets: ["sole_trader"], symmetric: false, autoReverse: true, soleTraderResolves: false, metadataFields: [], category: "identity", message: "Only an individual can trade as a sole trader." },
];

/** Accepted on input only; never offered for creation. */
export const DEPRECATED_TYPES: Record<string, { label: string; normalisesTo?: string }> = {
  child: { label: "Child", normalisesTo: "parent" },
  settlor: { label: "Settlor" },
};

const RULES = new Map(POLICY_RULES.map((r) => [r.type, r]));

export function getPolicyRule(type: string): PolicyRule | undefined {
  return RULES.get(type);
}

/** Types a user/import may create. Excludes child and settlor. */
export const CREATABLE_RELATIONSHIP_TYPES: readonly string[] = POLICY_RULES.map((r) => r.type);

export function policyLabel(type: string): string {
  return RULES.get(type)?.label ?? DEPRECATED_TYPES[type]?.label ?? (type ? type.charAt(0).toUpperCase() + type.slice(1) : type);
}

// ── Evaluation ───────────────────────────────────────────────────

export type PolicyOutcome = "valid" | "reverse" | "resolve_sole_trader" | "review" | "invalid" | "deprecated";

export type PolicyReason =
  | "valid"
  | "symmetric_valid"
  | "auto_reversed"
  | "child_alias_reversed"
  | "sole_trader_resolves_to_individual"
  | "generic_trust_review"
  | "unclassified_review"
  | "ambiguous_direction"
  | "invalid_source"
  | "invalid_target"
  | "bare_trust_source_restricted"
  | "settlor_deprecated"
  | "unknown_relationship_type";

export interface PolicyEvaluation {
  outcome: PolicyOutcome;
  reason: PolicyReason;
  /** Canonical relationship type (child → parent). Null when unknown. */
  canonicalType: string | null;
  /** True when canonical from/to are the input to/from. */
  swapped: boolean;
  /** Canonical source/target DB entity types (after any swap). */
  fromType: string;
  toType: string;
}

export interface EvaluateOptions {
  /**
   * Whether the caller actually knows which side is the source. Manual input
   * does (default). XPM labels like "Trustee" on either record do not — when
   * false and both orientations are valid, the result is review.
   */
  directionKnown?: boolean;
}

type SideCheck = "ok" | "review" | "resolve" | "no";
type Check = { result: SideCheck; reason: PolicyReason };

function checkSource(rule: PolicyRule, src: EntityCategory, tgt: EntityCategory): Check {
  const allowed = tgt === "bare_trust" && rule.bareTrustSources ? rule.bareTrustSources : rule.sources;
  if (allowed.includes(src)) return { result: "ok", reason: "valid" };
  if (src === "sole_trader" && rule.soleTraderResolves) return { result: "resolve", reason: "sole_trader_resolves_to_individual" };
  if (src === "unclassified") return { result: "review", reason: "unclassified_review" };
  if (src === "generic_trust" && allowed.some((c) => TRUST_LIKE.has(c))) return { result: "review", reason: "generic_trust_review" };
  if (tgt === "bare_trust" && rule.bareTrustSources && rule.sources.includes(src)) return { result: "no", reason: "bare_trust_source_restricted" };
  return { result: "no", reason: "invalid_source" };
}

function checkTarget(rule: PolicyRule, tgt: EntityCategory): Check {
  if (rule.targets.includes(tgt)) return { result: "ok", reason: "valid" };
  if (tgt === "unclassified") return { result: "review", reason: "unclassified_review" };
  if (tgt === "generic_trust" && rule.targets.some((c) => TRUST_LIKE.has(c))) return { result: "review", reason: "generic_trust_review" };
  return { result: "no", reason: "invalid_target" };
}

const RANK: Record<SideCheck, number> = { ok: 0, resolve: 1, review: 2, no: 3 };

function checkPair(rule: PolicyRule, from: EntityCategory, to: EntityCategory): Check {
  const t = checkTarget(rule, to);
  const s = checkSource(rule, from, to);
  // Worst side wins; on a tie the target's reason is reported first.
  return RANK[t.result] >= RANK[s.result] ? (t.result === "ok" ? s : t) : s;
}

export function evaluateRelationship(
  relationshipType: string,
  fromDbType: string | null | undefined,
  toDbType: string | null | undefined,
  options: EvaluateOptions = {},
): PolicyEvaluation {
  const directionKnown = options.directionKnown ?? true;
  const type = (relationshipType ?? "").trim().toLowerCase();
  const from = fromDbType ?? "Unclassified";
  const to = toDbType ?? "Unclassified";
  const base = { fromType: from, toType: to, swapped: false };

  if (type === "settlor") {
    return { ...base, outcome: "deprecated", reason: "settlor_deprecated", canonicalType: null };
  }
  if (type === "child") {
    // Child A → B is the same fact as Parent B → A.
    const inner = evaluateRelationship("parent", to, from, { directionKnown: true });
    if (inner.outcome === "valid") {
      return { outcome: "reverse", reason: "child_alias_reversed", canonicalType: "parent", swapped: true, fromType: to, toType: from };
    }
    return { ...inner, swapped: !inner.swapped, fromType: inner.swapped ? from : to, toType: inner.swapped ? to : from };
  }

  const rule = RULES.get(type);
  if (!rule) return { ...base, outcome: "invalid", reason: "unknown_relationship_type", canonicalType: null };

  const fc = categoryOf(from);
  const tc = categoryOf(to);
  const fwd = checkPair(rule, fc, tc);
  const rev = checkPair(rule, tc, fc);
  const out = (outcome: PolicyOutcome, reason: PolicyReason, swapped = false): PolicyEvaluation => ({
    outcome,
    reason,
    canonicalType: rule.type,
    swapped,
    fromType: swapped ? to : from,
    toType: swapped ? from : to,
  });

  if (rule.symmetric) {
    if (fwd.result === "ok") return out("valid", "symmetric_valid");
    if (fwd.result === "review") return out("review", fwd.reason);
    return out("invalid", fwd.reason);
  }

  if (fwd.result === "ok") {
    if (!directionKnown && rev.result === "ok" && fc !== tc) return out("review", "ambiguous_direction");
    if (!directionKnown && rev.result === "ok" && fc === tc) return out("review", "ambiguous_direction");
    return out("valid", "valid");
  }
  if (fwd.result === "resolve") return out("resolve_sole_trader", fwd.reason);
  if (fwd.result === "review") return out("review", fwd.reason);

  // Forward invalid: only flip when the rule allows it and the flip is clean.
  if (rule.autoReverse) {
    if (rev.result === "ok") return out("reverse", "auto_reversed", true);
    if (rev.result === "resolve") return out("resolve_sole_trader", rev.reason, true);
    if (rev.result === "review") return out("review", rev.reason, true);
  }
  return out("invalid", fwd.reason);
}

/** True when the evaluation can be persisted as-is or after a mechanical flip. */
export function isAcceptedOutcome(e: PolicyEvaluation): boolean {
  return e.outcome === "valid" || e.outcome === "reverse";
}

/**
 * Stable identity key for de-duplication. Symmetric types (spouse only) are
 * unordered; every other type — including partner — keeps its direction.
 */
export function relationshipIdentityKey(type: string, fromId: string, toId: string): string {
  const rule = RULES.get(type);
  if (rule?.symmetric) {
    const [a, b] = fromId <= toId ? [fromId, toId] : [toId, fromId];
    return `${type}:${a}~${b}`;
  }
  return `${type}:${fromId}>${toId}`;
}

/** Metadata fields for a type; none for discretionary-trust beneficiaries. */
export function policyMetadataFields(type: string, targetDbType?: string): readonly MetadataField[] {
  const rule = RULES.get(type);
  if (!rule) return [];
  if (type === "beneficiary" && targetDbType && categoryOf(targetDbType) === "discretionary_trust") return [];
  return rule.metadataFields;
}
