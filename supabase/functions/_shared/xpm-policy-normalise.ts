/**
 * XPM relationship normalisation over the canonical policy (Rulebook v1).
 *
 * Pure TypeScript: no Deno/browser imports, so Edge Functions and Vitest use
 * the same code. Every raw XPM relationship produces exactly one evidence
 * draft (for public.relationship_import_evidence) and at most one canonical
 * edge. Nothing here talks to the database.
 *
 * STAGED: not yet imported by sync-xpm / import-xpm / import-xpm-group. Those
 * deploy automatically and the live database lacks the trades_as enum value,
 * the evidence table and the policy trigger. See docs/relationship-policy.md.
 */
import {
  evaluateRelationship,
  relationshipIdentityKey,
  toCanonicalEdge,
  type CanonicalEdge,
  type PolicyOutcome,
  type PolicyReason,
} from "./relationship-policy.ts";

// ── Label parsing ────────────────────────────────────────────────

export interface ParsedXpmLabel {
  /** Raw policy input type ("child", "settlor" kept as-is; null = unknown). */
  type: string | null;
  /**
   * Label orientation hint relative to the client record that carries it.
   * false: client → related ("Director Of" on the person's record).
   * true:  related → client ("Director" on the company's record).
   */
  relatedIsSource: boolean;
  /** Whether the label itself authoritatively fixes orientation. */
  directionKnown: boolean;
}

const ORG_TYPES: Record<string, string> = {
  director: "director",
  shareholder: "shareholder",
  "unit holder": "unit_holder",
  unit_holder: "unit_holder",
  unitholder: "unit_holder",
  beneficiary: "beneficiary",
  trustee: "trustee",
  appointer: "appointer",
  appointor: "appointer",
  settlor: "settlor",
  partner: "partner",
  member: "member",
  "trades as": "trades_as",
  trades_as: "trades_as",
};

const FAMILY_TYPES: Record<string, string> = {
  spouse: "spouse",
  parent: "parent",
  child: "child",
};

/**
 * Parse an XPM relationship label. Organisational labels are attached by XPM
 * to either record inconsistently, so their orientation is only a hint
 * (directionKnown=false). Family labels state who is who, so they are known.
 */
export function parseXpmLabel(raw: string): ParsedXpmLabel {
  const key = (raw ?? "").trim().toLowerCase().replace(/\s+/g, " ");
  const hasOf = key.endsWith(" of");
  const base = hasOf ? key.slice(0, -3).trim() : key;
  if (base in FAMILY_TYPES) {
    // "Parent Of" on A's record: A is parent of related. "Parent" on A's record: related is A's parent.
    const t = FAMILY_TYPES[base];
    return { type: t, relatedIsSource: t === "spouse" ? false : !hasOf, directionKnown: true };
  }
  if (base in ORG_TYPES) {
    return { type: ORG_TYPES[base], relatedIsSource: !hasOf, directionKnown: false };
  }
  return { type: null, relatedIsSource: false, directionKnown: false };
}

// ── Evidence ─────────────────────────────────────────────────────

export type ReviewStatus = "pending" | "not_required" | "rejected";

/** Mirrors public.relationship_import_evidence columns (snake_case on write). */
export interface EvidenceDraft {
  raw_relationship_label: string;
  raw_from_identifier: string;
  raw_to_identifier: string;
  raw_from_name: string | null;
  raw_to_name: string | null;
  raw_payload: Record<string, unknown> | null;
  raw_from_entity_type: string;
  raw_to_entity_type: string;
  direction_known: boolean;
  entity_type_provisional: boolean;
  proposed_from_entity_id: string;
  proposed_to_entity_id: string;
  canonical_type: string | null;
  canonical_from_entity_id: string | null;
  canonical_to_entity_id: string | null;
  policy_outcome: PolicyOutcome;
  policy_reason: PolicyReason;
  review_status: ReviewStatus;
  resolved_via_trades_as: boolean;
}

export interface XpmRawRelationship {
  label: string;
  /** Entity id of the client record carrying the label. */
  clientId: string;
  relatedId: string;
  clientName?: string | null;
  relatedName?: string | null;
  payload?: Record<string, unknown> | null;
}

export interface NormaliseContext {
  /** entity id → DB entity_type */
  entityTypes: Map<string, string>;
  /** entity ids whose type came only from a name heuristic */
  provisionalTypes?: Set<string>;
  /** Sole Trader id → active Trades As owner Individual ids */
  tradesAsOwners?: Map<string, string[]>;
}

export interface NormaliseResult {
  evidence: EvidenceDraft;
  edge: CanonicalEdge | null;
}

export function normaliseXpmRelationship(raw: XpmRawRelationship, ctx: NormaliseContext): NormaliseResult {
  const parsed = parseXpmLabel(raw.label);
  const fromId = parsed.relatedIsSource ? raw.relatedId : raw.clientId;
  const toId = parsed.relatedIsSource ? raw.clientId : raw.relatedId;
  const fromType = ctx.entityTypes.get(fromId) ?? "Unclassified";
  const toType = ctx.entityTypes.get(toId) ?? "Unclassified";
  const provisional = !!(ctx.provisionalTypes?.has(fromId) || ctx.provisionalTypes?.has(toId));

  // Unknown labels go through the evaluator too → invalid / unknown_relationship_type.
  const evalType = parsed.type ?? `xpm:${raw.label}`;
  const e = evaluateRelationship(evalType, fromType, toType, { directionKnown: parsed.directionKnown });
  let edge = toCanonicalEdge(e, fromId, toId);
  let resolved = false;

  if (e.outcome === "resolve_sole_trader") {
    const soleTraderId = e.swapped ? toId : fromId;
    const otherId = e.swapped ? fromId : toId;
    const otherType = e.swapped ? fromType : toType;
    const owners = [...new Set(ctx.tradesAsOwners?.get(soleTraderId) ?? [])];
    if (owners.length === 1) {
      const individualType = ctx.entityTypes.get(owners[0]) ?? "Unclassified";
      const re = evaluateRelationship(e.canonicalType!, individualType, otherType);
      if (re.outcome === "valid") {
        edge = { type: re.canonicalType!, fromId: owners[0], toId: otherId };
        resolved = true;
      }
    }
  }

  const review_status: ReviewStatus = edge
    ? provisional ? "pending" : "not_required"
    : e.outcome === "invalid" || e.outcome === "deprecated" ? "rejected" : "pending";

  return {
    edge,
    evidence: {
      raw_relationship_label: raw.label,
      raw_from_identifier: raw.clientId,
      raw_to_identifier: raw.relatedId,
      raw_from_name: raw.clientName ?? null,
      raw_to_name: raw.relatedName ?? null,
      raw_payload: raw.payload ?? null,
      raw_from_entity_type: ctx.entityTypes.get(raw.clientId) ?? "Unclassified",
      raw_to_entity_type: ctx.entityTypes.get(raw.relatedId) ?? "Unclassified",
      direction_known: parsed.directionKnown,
      entity_type_provisional: provisional,
      proposed_from_entity_id: fromId,
      proposed_to_entity_id: toId,
      canonical_type: e.canonicalType,
      canonical_from_entity_id: edge?.fromId ?? null,
      canonical_to_entity_id: edge?.toId ?? null,
      policy_outcome: e.outcome,
      policy_reason: e.reason,
      review_status,
      resolved_via_trades_as: resolved,
    },
  };
}

/**
 * Normalise a batch. Every raw row keeps its evidence; edges are de-duplicated
 * with relationshipIdentityKey (only Spouse is unordered — Partner and every
 * other type keep direction).
 */
export function normaliseXpmBatch(
  raws: readonly XpmRawRelationship[],
  ctx: NormaliseContext,
): { evidence: EvidenceDraft[]; edges: CanonicalEdge[] } {
  const evidence: EvidenceDraft[] = [];
  const edges: CanonicalEdge[] = [];
  const seen = new Set<string>();
  for (const raw of raws) {
    const r = normaliseXpmRelationship(raw, ctx);
    evidence.push(r.evidence);
    if (!r.edge) continue;
    const key = relationshipIdentityKey(r.edge.type, r.edge.fromId, r.edge.toId);
    if (seen.has(key)) continue;
    seen.add(key);
    edges.push(r.edge);
  }
  return { evidence, edges };
}

// ── Provisional entity types ─────────────────────────────────────

/**
 * Classify with provenance. A type taken from XPM's business-structure field
 * is authoritative; one guessed from the client's name only is provisional
 * and its links are evidenced as pending review.
 */
export function classifyWithProvenance(
  resolve: (businessStructure?: string, clientName?: string) => string,
  businessStructure?: string,
  clientName?: string,
): { entityType: string; provisional: boolean } {
  const fromStructure = businessStructure ? resolve(businessStructure, undefined) : "Unclassified";
  if (fromStructure !== "Unclassified") return { entityType: fromStructure, provisional: false };
  const fromName = resolve(undefined, clientName);
  return { entityType: fromName, provisional: fromName !== "Unclassified" };
}
