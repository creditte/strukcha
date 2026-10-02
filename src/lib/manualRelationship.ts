/**
 * Manual relationship create / edit / reverse planning.
 *
 * Pure decision logic over the canonical policy. Data access is injected so
 * the rules are unit-tested without a database. The Trades As lookup is only
 * invoked for Sole Trader resolution or Trades As creation, so ordinary use
 * never queries the not-yet-activated `trades_as` enum value.
 */
import {
  CREATABLE_RELATIONSHIP_TYPES,
  describePolicyReason,
  evaluateRelationship,
  relationshipIdentityKey,
  toCanonicalEdge,
  type CanonicalEdge,
} from "@/lib/relationshipPolicy";

export interface PlanEntity {
  id: string;
  entity_type: string;
}

export interface ExistingRelationship {
  id?: string;
  relationship_type: string;
  from_entity_id: string;
  to_entity_id: string;
}

export type TradesAsLookup =
  | { status: "resolved"; individualId: string }
  | { status: "none" }
  | { status: "multiple"; count: number }
  | { status: "unavailable" };

export interface PlanDeps {
  /** Active Individual owners (Trades As) of a Sole Trader. */
  lookupTradesAsOwner: (soleTraderId: string) => Promise<TradesAsLookup>;
  /** Active relationships between the two entities (either direction). */
  findExisting: (aId: string, bId: string) => Promise<ExistingRelationship[]>;
  /** Entity type for an id (used after resolving to the Individual). */
  getEntityType: (id: string) => Promise<string | null>;
}

/** Single shape (the app compiles without strictNullChecks, so no union narrowing). */
export interface PlanResult {
  ok: boolean;
  /** Present when ok. */
  edge?: CanonicalEdge;
  note?: string;
  /** Present when not ok. */
  kind?: "review" | "invalid" | "duplicate";
  title?: string;
  description?: string;
}

const reviewFail = (description: string): PlanResult => ({ ok: false, kind: "review", title: "Needs review", description });
const invalidFail = (description: string): PlanResult => ({ ok: false, kind: "invalid", title: "Invalid relationship", description });

/** Pick the single Trades As owner from raw rows. Never guesses. */
export function pickTradesAsOwner(ownerIds: readonly string[]): TradesAsLookup {
  const unique = [...new Set(ownerIds)];
  if (unique.length === 0) return { status: "none" };
  if (unique.length > 1) return { status: "multiple", count: unique.length };
  return { status: "resolved", individualId: unique[0] };
}

function isDuplicate(edge: CanonicalEdge, existing: ExistingRelationship[], ignoreId?: string): boolean {
  const key = relationshipIdentityKey(edge.type, edge.fromId, edge.toId);
  return existing.some(
    (r) => (ignoreId === undefined || r.id !== ignoreId) && relationshipIdentityKey(r.relationship_type, r.from_entity_id, r.to_entity_id) === key,
  );
}

/** Plan a new relationship from `from` to `to` as the user drew/selected it. */
export async function planNewRelationship(
  type: string,
  from: PlanEntity,
  to: PlanEntity,
  deps: PlanDeps,
): Promise<PlanResult> {
  if (!CREATABLE_RELATIONSHIP_TYPES.includes(type)) {
    return invalidFail("This relationship type can't be created.");
  }
  const e = evaluateRelationship(type, from.entity_type, to.entity_type);
  let edge: CanonicalEdge | null = toCanonicalEdge(e, from.id, to.id);
  let note: string | undefined;

  if (e.outcome === "resolve_sole_trader") {
    // The Sole Trader is the canonical source (after any swap).
    const soleTraderId = e.swapped ? to.id : from.id;
    const otherId = e.swapped ? from.id : to.id;
    const otherType = e.swapped ? from.entity_type : to.entity_type;
    const owner = await deps.lookupTradesAsOwner(soleTraderId);
    if (owner.status === "none") return reviewFail("Needs review: add the individual who trades as this sole trader (a Trades As link) first.");
    if (owner.status === "multiple") return reviewFail(`Needs review: this sole trader has ${owner.count} Trades As owners. Keep exactly one.`);
    if (owner.status === "unavailable") return reviewFail("Needs review: sole trader owners can't be looked up yet.");
    const individualType = await deps.getEntityType(owner.individualId);
    const re = evaluateRelationship(type, individualType ?? "Unclassified", otherType);
    if (re.outcome !== "valid") return reviewFail(describePolicyReason(re));
    edge = { type: re.canonicalType!, fromId: owner.individualId, toId: otherId };
    note = "Linked to the individual who trades as this sole trader.";
  } else if (!edge) {
    return e.outcome === "review" ? reviewFail(describePolicyReason(e)) : invalidFail(describePolicyReason(e));
  }

  if (edge.type === "trades_as") {
    const owner = await deps.lookupTradesAsOwner(edge.toId);
    if (owner.status === "unavailable") return reviewFail("Trades As links can't be saved yet.");
    if (owner.status !== "none") {
      return invalidFail("This sole trader already has an individual linked with Trades As. A sole trader has exactly one.");
    }
  }

  const existing = await deps.findExisting(edge.fromId, edge.toId);
  if (isDuplicate(edge, existing)) {
    return { ok: false, kind: "duplicate", title: "Already exists", description: "This relationship already exists." };
  }
  return { ok: true, edge, note };
}

/**
 * Changing the type of an existing row keeps its endpoints; must be valid as stored.
 * Only when the new type is Trades As does this query (lazily, via deps) for the
 * global one-owner-per-Sole-Trader rule, because the existing owner may sit in
 * another structure that `siblings` does not contain.
 */
export async function planTypeChange(
  newType: string,
  from: PlanEntity,
  to: PlanEntity,
  siblings: ExistingRelationship[],
  selfId: string,
  deps: Pick<PlanDeps, "lookupTradesAsOwner">,
): Promise<PlanResult> {
  if (!CREATABLE_RELATIONSHIP_TYPES.includes(newType)) return invalidFail("This relationship type can't be selected.");
  const e = evaluateRelationship(newType, from.entity_type, to.entity_type);
  if (e.outcome !== "valid") {
    if (e.outcome === "reverse") return invalidFail("That type needs the opposite direction. Save the type, then use Reverse, or delete and re-add.");
    return e.outcome === "review" || e.outcome === "resolve_sole_trader" ? reviewFail(describePolicyReason(e)) : invalidFail(describePolicyReason(e));
  }
  const edge = { type: newType, fromId: from.id, toId: to.id };
  if (isDuplicate(edge, siblings, selfId)) return { ok: false, kind: "duplicate", title: "Already exists", description: "This relationship already exists." };
  if (newType === "trades_as") {
    // The row being edited is not Trades As yet, so any active owner is a different fact.
    const owner = await deps.lookupTradesAsOwner(to.id);
    if (owner.status === "unavailable") return reviewFail("Needs review: Trades As links can't be checked or saved yet.");
    if (owner.status !== "none") {
      return { ok: false, kind: "duplicate", title: "Already has an owner", description: "This sole trader already has an individual linked with Trades As. A sole trader has exactly one." };
    }
  }
  return { ok: true, edge };
}

/** Reversal only when the reversed row is `valid`; never produces review/invalid. */
export function planReverse(rel: ExistingRelationship & { id: string }, from: PlanEntity, to: PlanEntity, siblings: ExistingRelationship[]): PlanResult {
  const e = evaluateRelationship(rel.relationship_type, to.entity_type, from.entity_type);
  if (e.outcome !== "valid") {
    return invalidFail("Reversing would not produce a valid relationship.");
  }
  const edge = { type: rel.relationship_type, fromId: to.id, toId: from.id };
  if (relationshipIdentityKey(edge.type, edge.fromId, edge.toId) === relationshipIdentityKey(rel.relationship_type, rel.from_entity_id, rel.to_entity_id)) {
    return invalidFail("This relationship has no direction to reverse.");
  }
  if (isDuplicate(edge, siblings, rel.id)) return { ok: false, kind: "duplicate", title: "Duplicate exists", description: "A relationship with the reversed direction already exists." };
  return { ok: true, edge };
}
