/**
 * Active Trades As owners for Sole Trader resolution during XPM imports.
 *
 * Only active facts count: relationship not soft-deleted and not ended, owner
 * entity not deleted. The normaliser resolves a Sole Trader only when exactly
 * one owner exists; zero or several leave the raw fact in evidence as review.
 * A failed lookup returns no owners, so it can only ever keep a fact in review.
 */
export interface TradesAsOwners {
  /** Sole Trader entity id → owner Individual entity ids */
  owners: Map<string, string[]>;
  /** owner entity id → DB entity_type */
  ownerTypes: Map<string, string>;
}

// deno-lint-ignore no-explicit-any
export async function loadTradesAsOwners(
  supabase: any,
  tenantId: string,
  soleTraderIds: string[],
  batchSize = 80,
): Promise<TradesAsOwners> {
  const owners = new Map<string, string[]>();
  const ownerTypes = new Map<string, string>();
  const ids = [...new Set(soleTraderIds.filter(Boolean))];
  if (ids.length === 0) return { owners, ownerTypes };

  const ownerIds = new Set<string>();
  const pairs: { from: string; to: string }[] = [];
  for (let i = 0; i < ids.length; i += batchSize) {
    const { data, error } = await supabase
      .from("relationships")
      .select("from_entity_id, to_entity_id")
      .eq("tenant_id", tenantId)
      .eq("relationship_type", "trades_as")
      .is("deleted_at", null)
      .is("end_date", null)
      .in("to_entity_id", ids.slice(i, i + batchSize));
    if (error) {
      console.warn("[xpm-trades-as] owner lookup failed; Sole Trader links stay in review:", error.message);
      return { owners: new Map(), ownerTypes };
    }
    for (const r of data ?? []) {
      pairs.push({ from: r.from_entity_id, to: r.to_entity_id });
      ownerIds.add(r.from_entity_id);
    }
  }

  const ownerList = [...ownerIds];
  const liveOwners = new Set<string>();
  for (let i = 0; i < ownerList.length; i += batchSize) {
    const { data, error } = await supabase
      .from("entities")
      .select("id, entity_type")
      .eq("tenant_id", tenantId)
      .is("deleted_at", null)
      .in("id", ownerList.slice(i, i + batchSize));
    if (error) {
      console.warn("[xpm-trades-as] owner type lookup failed; Sole Trader links stay in review:", error.message);
      return { owners: new Map(), ownerTypes };
    }
    for (const e of data ?? []) {
      liveOwners.add(e.id);
      ownerTypes.set(e.id, e.entity_type);
    }
  }

  for (const { from, to } of pairs) {
    if (!liveOwners.has(from)) continue;
    const list = owners.get(to) ?? [];
    if (!list.includes(from)) list.push(from);
    owners.set(to, list);
  }
  return { owners, ownerTypes };
}
