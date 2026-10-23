/**
 * The only XPM group reconciliation rules. Pure: takes the read-only state from
 * `xpm_group_reconcile_state` and returns an exact-key plan for
 * `xpm_apply_group_reconciliation`. Used by import-xpm-group (preview + apply)
 * and sync-xpm group processing.
 *
 * - Identity is (tenant, xpm_group_uuid). Name is used only by the database's
 *   guarded adoption of exactly one unlinked XPM-source structure.
 * - Manual memberships/links are never removed; XPM promotes an association to
 *   XPM-managed only when the current payload positively confirms it.
 * - Ownership figures refresh only on XPM-managed relationships.
 */
import type { XpmFigures } from "./xpm-ownership.ts";

export type GroupMatch = "uuid" | "adopt" | "create" | "ambiguous";

export interface GroupState {
  resolution: { match: GroupMatch; structure_id: string | null; candidates?: string[]; same_name_manual?: string[] };
  group: { member_hash: string | null; is_selected: boolean; last_synced_at: string | null } | null;
  members: { xpm_uuid: string; entity_id: string | null; name: string | null; is_archived: boolean }[];
  structure_entities: { entity_id: string; source: "manual" | "xpm"; name?: string | null }[];
  structure_relationships: { relationship_id: string; source: "manual" | "xpm" }[];
  relationships: {
    id: string; type: string; from_id: string; to_id: string; source: string;
    xpm_managed: boolean; units: number | null; percent: number | null;
  }[];
}

export interface PlanOptions {
  /** Relationship ids the current XPM payload confirms. Omitted → imported links between active members. */
  confirmedRelationshipIds?: ReadonlySet<string>;
  /** XPM figures per relationship id (already policy-filtered). */
  figures?: ReadonlyMap<string, XpmFigures>;
  /** Create an XPM structure even though a manual one has the same name. */
  allowCreateBesideManual?: boolean;
}

export type PlanStatus = "ready" | "ambiguous_structure_match" | "manual_structure_name_conflict";

export interface ReconcilePlan {
  status: PlanStatus;
  match: GroupMatch;
  structure_id: string | null;
  allow_create_beside_manual: boolean;
  candidates: string[];
  same_name_manual: string[];
  add_members: string[];
  promote_members: string[];
  keep_members: string[];
  remove_members: string[];
  add_links: string[];
  promote_links: string[];
  keep_links: string[];
  remove_links: string[];
  metadata_updates: { relationship_id: string; units: number | null; percent: number | null }[];
  preserved: {
    manual_members: string[];
    manual_links: string[];
    metadata_overrides: string[];
    members_kept_for_manual_links: string[];
  };
  archived_members: string[];
  unresolved_members: string[];
}

const sorted = (s: Iterable<string>) => [...s].sort();

function emptyPlan(state: GroupState, status: PlanStatus, allow: boolean): ReconcilePlan {
  return {
    status,
    match: state.resolution.match,
    structure_id: state.resolution.structure_id,
    allow_create_beside_manual: allow,
    candidates: state.resolution.candidates ?? [],
    same_name_manual: state.resolution.same_name_manual ?? [],
    add_members: [], promote_members: [], keep_members: [], remove_members: [],
    add_links: [], promote_links: [], keep_links: [], remove_links: [],
    metadata_updates: [],
    preserved: { manual_members: [], manual_links: [], metadata_overrides: [], members_kept_for_manual_links: [] },
    archived_members: [], unresolved_members: [],
  };
}

export function planGroupReconciliation(state: GroupState, opts: PlanOptions = {}): ReconcilePlan {
  const allow = opts.allowCreateBesideManual === true;
  const res = state.resolution;
  if (res.match === "ambiguous") return emptyPlan(state, "ambiguous_structure_match", allow);
  if (res.match === "create" && (res.same_name_manual ?? []).length > 0 && !allow) {
    return emptyPlan(state, "manual_structure_name_conflict", allow);
  }
  const plan = emptyPlan(state, "ready", allow);

  const active = new Set<string>();
  const archived = new Set<string>();
  const unresolved = new Set<string>();
  for (const m of state.members) {
    if (!m.entity_id) unresolved.add(m.xpm_uuid);
    else if (m.is_archived) archived.add(m.entity_id);
    else active.add(m.entity_id);
  }
  plan.archived_members = sorted(archived);
  plan.unresolved_members = sorted(unresolved);

  const curMembers = new Map(state.structure_entities.map((r) => [r.entity_id, r.source]));
  const curLinks = new Map(state.structure_relationships.map((r) => [r.relationship_id, r.source]));
  const relById = new Map(state.relationships.map((r) => [r.id, r]));

  // Links XPM confirms now.
  const confirmed = new Set<string>();
  for (const r of state.relationships) {
    if (!active.has(r.from_id) || !active.has(r.to_id)) continue;
    const ok = opts.confirmedRelationshipIds ? opts.confirmedRelationshipIds.has(r.id) : r.source === "imported";
    if (ok) confirmed.add(r.id);
  }

  const add = new Set<string>(), promote = new Set<string>(), keep = new Set<string>(), remove = new Set<string>();
  for (const id of confirmed) {
    const src = curLinks.get(id);
    if (src === undefined) add.add(id);
    else if (src === "manual") promote.add(id);
    else keep.add(id);
  }
  const manualLinks = new Set<string>();
  for (const [id, src] of curLinks) {
    if (src === "manual") { if (!confirmed.has(id)) manualLinks.add(id); }
    else if (!confirmed.has(id)) remove.add(id);
  }
  plan.add_links = sorted(add); plan.promote_links = sorted(promote);
  plan.keep_links = sorted(keep); plan.remove_links = sorted(remove);
  plan.preserved.manual_links = sorted(manualLinks);

  // Members kept alive because a retained manual link needs them.
  const protectedMembers = new Set<string>();
  for (const id of manualLinks) {
    const r = relById.get(id);
    if (r) { protectedMembers.add(r.from_id); protectedMembers.add(r.to_id); }
  }

  const mAdd = new Set<string>(), mPromote = new Set<string>(), mKeep = new Set<string>(), mRemove = new Set<string>();
  const manualMembers = new Set<string>(), keptForLinks = new Set<string>();
  for (const id of active) {
    const src = curMembers.get(id);
    if (src === undefined) mAdd.add(id);
    else if (src === "manual") mPromote.add(id);
    else mKeep.add(id);
  }
  for (const [id, src] of curMembers) {
    if (active.has(id)) continue;
    if (src === "manual") manualMembers.add(id);
    else if (protectedMembers.has(id)) keptForLinks.add(id);
    else mRemove.add(id);
  }
  plan.add_members = sorted(mAdd); plan.promote_members = sorted(mPromote);
  plan.keep_members = sorted(mKeep); plan.remove_members = sorted(mRemove);
  plan.preserved.manual_members = sorted(manualMembers);
  plan.preserved.members_kept_for_manual_links = sorted(keptForLinks);

  // Ownership figures.
  const overrides: string[] = [];
  for (const id of sorted(confirmed)) {
    const f = opts.figures?.get(id);
    const r = relById.get(id);
    if (!f || !r) continue;
    const same = (r.units ?? null) === f.units && (r.percent ?? null) === f.percent;
    if (same) continue;
    if (!r.xpm_managed) overrides.push(id);
    else plan.metadata_updates.push({ relationship_id: id, units: f.units, percent: f.percent });
  }
  plan.preserved.metadata_overrides = overrides;
  return plan;
}

/** True when applying would change no association or figure. */
export function isNoopPlan(p: ReconcilePlan): boolean {
  return p.status === "ready" && p.match === "uuid" &&
    p.add_members.length + p.promote_members.length + p.remove_members.length +
    p.add_links.length + p.promote_links.length + p.remove_links.length + p.metadata_updates.length === 0;
}

/** Stable fingerprint of a group's membership, used for change detection. */
export async function hashGroupMembers(name: string, memberUuids: string[]): Promise<string> {
  const payload = `${name}\n${[...memberUuids].sort().join(",")}`;
  const digest = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(payload));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
