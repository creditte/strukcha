/**
 * Keeps Structure Health to active diagrams and active clients, matching the
 * diagram editor. The database (`health_review_dataset`) already applies these
 * rules; this is the same rule on the browser side so a stale or older server
 * response can never score archived clients.
 */
export interface RawHealthEntity { id: string; is_archived?: boolean | null; [k: string]: unknown }
export interface RawHealthRel { id: string; from_entity_id: string; to_entity_id: string; [k: string]: unknown }
export interface RawHealthStructure {
  id: string;
  name: string;
  archived_at?: string | null;
  inactive?: boolean;
  entities: RawHealthEntity[];
  relationships: RawHealthRel[];
}

export interface PartitionedHealthDataset<S extends RawHealthStructure> {
  /** Diagrams with at least one active client — these get scored. */
  active: S[];
  /** Diagrams whose clients are all archived — shown as Inactive, never scored or Healthy. */
  inactive: { id: string; name: string }[];
}

export function partitionHealthDataset<S extends RawHealthStructure>(structures: S[]): PartitionedHealthDataset<S> {
  const active: S[] = [];
  const inactive: { id: string; name: string }[] = [];
  for (const s of structures) {
    if (s.archived_at) continue; // archived diagram: out of Health entirely
    const entities = (s.entities ?? []).filter((e) => !e.is_archived);
    const ids = new Set(entities.map((e) => e.id));
    const relationships = (s.relationships ?? []).filter(
      (r) => ids.has(r.from_entity_id) && ids.has(r.to_entity_id),
    );
    if (entities.length === 0) {
      inactive.push({ id: s.id, name: s.name });
      continue;
    }
    active.push({ ...s, entities, relationships });
  }
  return { active, inactive };
}
