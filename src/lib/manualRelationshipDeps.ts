/**
 * Database-backed dependencies for manual relationship planning.
 * Every query here runs only on save, never on page load. RLS scopes all reads
 * to the user's firm.
 */
import { supabase } from "@/integrations/supabase/client";
import { pickTradesAsOwner, type PlanDeps, type TradesAsLookup } from "@/lib/manualRelationship";

async function lookupTradesAsOwner(soleTraderId: string): Promise<TradesAsLookup> {
  const { data, error } = await supabase
    .from("relationships")
    .select("from_entity_id")
    .eq("to_entity_id", soleTraderId)
    // `trades_as` is not in the live enum until the pending migration is applied.
    .eq("relationship_type", "trades_as" as never)
    .is("deleted_at", null)
    .is("end_date", null);
  if (error) return { status: "unavailable" };
  return pickTradesAsOwner((data ?? []).map((r) => r.from_entity_id));
}

async function findExisting(aId: string, bId: string) {
  const { data } = await supabase
    .from("relationships")
    .select("id, relationship_type, from_entity_id, to_entity_id")
    .is("deleted_at", null)
    .or(`and(from_entity_id.eq.${aId},to_entity_id.eq.${bId}),and(from_entity_id.eq.${bId},to_entity_id.eq.${aId})`);
  return (data ?? []) as { id: string; relationship_type: string; from_entity_id: string; to_entity_id: string }[];
}

async function getEntityType(id: string): Promise<string | null> {
  const { data } = await supabase.from("entities").select("entity_type").eq("id", id).maybeSingle();
  return (data?.entity_type as string | undefined) ?? null;
}

export const manualRelationshipDeps: PlanDeps = { lookupTradesAsOwner, findExisting, getEntityType };
