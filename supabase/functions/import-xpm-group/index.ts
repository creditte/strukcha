import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getXeroAccessToken, loadXeroConnection } from "../_shared/xero-token.ts";
import { parse as parseXml } from "https://esm.sh/jsr/@libs/xml@6.0.1";
import { resolveEntityType } from "../_shared/xpm-entity-type.ts";
import {
  classifyWithProvenance,
  normaliseXpmRelationship,
  type EvidenceDraft,
} from "../_shared/xpm-policy-normalise.ts";
import { policyMetadataFields, relationshipIdentityKey } from "../_shared/relationship-policy.ts";
import { loadTradesAsOwners } from "../_shared/xpm-trades-as.ts";
import { corsHeadersFor } from "../_shared/cors.ts";


const XPM_BASE = "https://api.xero.com/practicemanager/3.1";

function xpmHeaders(accessToken: string, xeroTenantId: string) {
  return { Authorization: `Bearer ${accessToken}`, "xero-tenant-id": xeroTenantId, Accept: "application/xml" };
}

async function xpmGetXml(path: string, accessToken: string, xeroTenantId: string) {
  const res = await fetch(`${XPM_BASE}${path}`, { headers: xpmHeaders(accessToken, xeroTenantId) });
  if (!res.ok) return null;
  try { return parseXml(await res.text()); } catch { return null; }
}

function xmlArray(parent: any, key: string): any[] {
  if (!parent) return [];
  const val = parent[key];
  if (!val) return [];
  return Array.isArray(val) ? val : [val];
}

function xmlText(node: any, key: string): string {
  if (!node) return "";
  const val = node[key];
  if (val === null || val === undefined) return "";
  if (typeof val === "object" && val["#text"] !== undefined) return String(val["#text"]);
  return String(val);
}

async function discoverPmTenantId(accessToken: string, storedTenantId: string | null): Promise<string | null> {
  try {
    const res = await fetch("https://api.xero.com/connections", { headers: { Authorization: `Bearer ${accessToken}` } });
    if (res.ok) {
      const conns = await res.json();
      const pm = conns.find((c: any) => c.tenantType === "PRACTICEMANAGER");
      if (pm) return pm.tenantId;
    }
  } catch {}
  return storedTenantId;
}

const isYes = (v?: string) => /^(yes|true|1)$/i.test((v ?? "").trim());

Deno.serve(async (req) => {
  const corsHeaders = corsHeadersFor(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("authorization") ?? "";
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    const supabase = createClient(supabaseUrl, serviceKey);
    const anonClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
    const { data: { user }, error: authErr } = await anonClient.auth.getUser();
    if (authErr || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const body = await req.json().catch(() => ({}));
    const groupUuid = body.group_uuid;
    const groupName = body.group_name || "XPM Group";
    if (!groupUuid) {
      return new Response(JSON.stringify({ error: "group_uuid is required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const { data: tenantId } = await supabase.rpc("get_user_tenant_id", { _user_id: user.id });
    if (!tenantId) {
      return new Response(JSON.stringify({ error: "No tenant found" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Load Xero connection
    const connections = await loadXeroConnection(supabase, tenantId).then((c) => (c ? [c] : []));
    if (!connections.length) {
      return new Response(JSON.stringify({ error: "No Xero connection found" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const connection = connections[0];
    const accessToken = await getXeroAccessToken(supabase, connection);
    const xeroTenantId = await discoverPmTenantId(accessToken, connection.xero_tenant_id);
    if (!xeroTenantId) {
      return new Response(JSON.stringify({ error: "Xero tenant ID not available" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Fetch group members
    const groupXml = await xpmGetXml(`/clientgroup.api/get/${groupUuid}`, accessToken, xeroTenantId);
    if (!groupXml) {
      return new Response(JSON.stringify({ error: "Failed to fetch group from XPM" }), { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const groupDetail = groupXml?.Response?.Group;
    const members = xmlArray(groupDetail?.Clients, "Client");
    const memberUuids = members.map((m: any) => xmlText(m, "UUID")).filter(Boolean);

    // Fetch each member's details
    interface ClientData {
      uuid: string; name: string; entityType: string; abn: string | null; acn: string | null;
      businessStructure: string; isArchived: boolean; isDeleted: boolean;
      relationships: Array<{ typeRaw: string; relatedUuid: string; relatedName: string; percentage: number | null; shares: number | null }>;
    }

    const allFetched: ClientData[] = [];
    const BATCH_SIZE = 10;

    for (let i = 0; i < memberUuids.length; i += BATCH_SIZE) {
      const batch = memberUuids.slice(i, i + BATCH_SIZE);
      const results = await Promise.all(batch.map(async (uuid: string) => {
        const xml = await xpmGetXml(`/client.api/get/${uuid}`, accessToken, xeroTenantId);
        if (!xml) return null;
        const c = xml?.Response?.Client;
        if (!c) return null;

        const name = xmlText(c, "Name") || `${xmlText(c, "FirstName")} ${xmlText(c, "LastName")}`.trim();
        const bs = xmlText(c, "BusinessStructure");
        const rels: ClientData["relationships"] = [];

        for (const rel of xmlArray(c?.Relationships, "Relationship")) {
          const typeRaw = (xmlText(rel, "Type") || xmlText(rel, "RelationshipType")).trim();
          const rc = rel?.RelatedClient;
          const relUuid = xmlText(rc, "UUID") || xmlText(rel, "RelatedClientUUID");
          const relName = xmlText(rc, "Name") || xmlText(rel, "RelatedClientName");
          const pct = parseFloat(xmlText(rel, "Percentage") || xmlText(rel, "OwnershipPercentage"));
          const shares = parseFloat(xmlText(rel, "NumberOfShares"));

          if (relUuid && typeRaw) {
            rels.push({
              typeRaw,
              relatedUuid: relUuid,
              relatedName: relName,
              percentage: isNaN(pct) ? null : pct,
              shares: isNaN(shares) ? null : shares,
            });
          }
        }

        return {
          uuid,
          name,
          entityType: resolveEntityType(bs, name),
          abn: xmlText(c, "TaxNumber") || xmlText(c, "ABN") || null,
          acn: xmlText(c, "CompanyNumber") || xmlText(c, "ACN") || null,
          businessStructure: bs,
          isArchived: isYes(xmlText(c, "IsArchived")) || isYes(xmlText(c, "Archived")),
          isDeleted: isYes(xmlText(c, "IsDeleted")),
          relationships: rels,
        } as ClientData;
      }));
      for (const r of results) if (r) allFetched.push(r);
    }

    // Archived/deleted XPM clients stay in the database as history but are kept
    // out of the active diagram, matching the full sync's behaviour.
    const inactiveUuids = allFetched.filter((c) => c.isArchived || c.isDeleted).map((c) => c.uuid);
    const clients: ClientData[] = allFetched.filter((c) => !c.isArchived && !c.isDeleted);
    if (inactiveUuids.length > 0) {
      console.log(`[import-xpm-group] Excluding ${inactiveUuids.length} archived/deleted member(s) from the active structure`);
      for (let i = 0; i < inactiveUuids.length; i += 80) {
        await supabase
          .from("entities")
          .update({ is_archived: true })
          .eq("tenant_id", tenantId)
          .in("xpm_uuid", inactiveUuids.slice(i, i + 80));
      }
    }

    // Reuse existing XPM structure for this group name when re-opening in editor
    const { data: existingStruct } = await supabase
      .from("structures")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("name", groupName)
      .eq("source", "xpm")
      .is("deleted_at", null)
      .maybeSingle();

    let structureId: string;

    if (existingStruct) {
      structureId = existingStruct.id;
      // Clear prior links so re-import reflects latest XPM data
      await supabase.from("structure_relationships").delete().eq("structure_id", structureId);
      await supabase.from("structure_entities").delete().eq("structure_id", structureId);
    } else {
      const { data: structure, error: structErr } = await supabase.from("structures").insert({
        name: groupName,
        tenant_id: tenantId,
        layout_mode: "auto",
        source: "xpm",
      }).select("id").single();

      if (structErr || !structure) {
        return new Response(JSON.stringify({ error: "Failed to create structure", detail: structErr?.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      structureId = structure.id;
    }

    // Upsert entities (keyed by xpm_uuid to avoid duplicates)
    const xpmUuidToEntityId: Record<string, string> = {};

    // Check for existing entities with these xpm_uuids
    // `.in(...)` filters live in the request URL — keep batches small so long
    // UUID lists can't blow the URL limit (HTTP2 protocol error).
    const FILTER_BATCH = 80;
    const uuidList = clients.map((c) => c.uuid).filter(Boolean);
    const existingTypes = new Map<string, string>();
    for (let i = 0; i < uuidList.length; i += FILTER_BATCH) {
      const { data: existingEntities } = await supabase
        .from("entities")
        .select("id, xpm_uuid, entity_type, is_archived")
        .eq("tenant_id", tenantId)
        .in("xpm_uuid", uuidList.slice(i, i + FILTER_BATCH));
      for (const e of existingEntities ?? []) {
        if (!e.xpm_uuid) continue;
        xpmUuidToEntityId[e.xpm_uuid] = e.id;
        existingTypes.set(e.xpm_uuid, e.entity_type);
      }
    }

    // Re-classify stored records that were saved before XPM's own wording was
    // understood (a trust left as Unclassified), and un-archive members that are
    // active in XPM again.
    for (const c of clients) {
      const entityId = xpmUuidToEntityId[c.uuid];
      if (!entityId) continue;
      const patch: Record<string, unknown> = { is_archived: false };
      if (c.entityType !== "Unclassified" && existingTypes.get(c.uuid) === "Unclassified") {
        patch.entity_type = c.entityType;
      }
      await supabase.from("entities").update(patch).eq("id", entityId);
    }

    // Create missing entities
    const newEntities = clients.filter(c => !xpmUuidToEntityId[c.uuid]);
    if (newEntities.length > 0) {
      const { data: inserted, error: entErr } = await supabase.from("entities").insert(
        newEntities.map(c => ({
          name: c.name,
          entity_type: c.entityType,
          tenant_id: tenantId,
          source: "imported" as const,
          abn: c.abn,
          acn: c.acn,
          xpm_uuid: c.uuid,
        }))
      ).select("id, xpm_uuid");

      if (entErr) {
        console.error("[import-xpm-group] Entity insert error:", entErr);
      }

      for (const e of inserted ?? []) {
        if (e.xpm_uuid) xpmUuidToEntityId[e.xpm_uuid] = e.id;
      }
    }

    // Link entities to structure
    const structureEntities = Object.values(xpmUuidToEntityId).map(entityId => ({
      structure_id: structureId,
      entity_id: entityId,
    }));

    if (structureEntities.length > 0) {
      await supabase.from("structure_entities").insert(structureEntities);
    }

    // Relationships go through the canonical policy (Rulebook v1). Every raw
    // XPM fact between two group members gets exactly one evidence row; only
    // canonical edges are written, one at a time so a single refusal (e.g. the
    // database check) never blocks the rest.
    const memberSet = new Set(clients.map((c) => c.uuid));
    const entityTypes = new Map<string, string>();
    const provisionalTypes = new Set<string>();
    for (const c of clients) {
      const id = xpmUuidToEntityId[c.uuid];
      if (id) entityTypes.set(id, c.entityType);
    }

    // Load stored entity types — these are what the database check evaluates.
    const allEntityIds = Object.values(xpmUuidToEntityId);
    if (allEntityIds.length > 0) {
      for (let i = 0; i < allEntityIds.length; i += FILTER_BATCH) {
        const { data: typeRows } = await supabase
          .from("entities")
          .select("id, entity_type")
          .in("id", allEntityIds.slice(i, i + FILTER_BATCH));
        for (const row of typeRows ?? []) {
          entityTypes.set(row.id, row.entity_type);
        }
      }
    }

    // A type guessed from the client's name only is provisional: its links are
    // evidenced as pending review even when canonical.
    for (const c of clients) {
      const id = xpmUuidToEntityId[c.uuid];
      if (!id) continue;
      const prov = classifyWithProvenance(resolveEntityType, c.businessStructure, c.name);
      if (prov.provisional && entityTypes.get(id) === prov.entityType) provisionalTypes.add(id);
    }

    const soleTraderIds = [...entityTypes].filter(([, t]) => t === "Sole Trader").map(([id]) => id);
    const tradesAs = await loadTradesAsOwners(supabase, tenantId, soleTraderIds, FILTER_BATCH);
    for (const [id, t] of tradesAs.ownerTypes) if (!entityTypes.has(id)) entityTypes.set(id, t);

    const ctx = { entityTypes, provisionalTypes, tradesAsOwners: tradesAs.owners };
    const importRunId = crypto.randomUUID();
    const nameById = new Map<string, string>();
    for (const c of clients) {
      const id = xpmUuidToEntityId[c.uuid];
      if (id) nameById.set(id, c.name);
    }

    const evidenceRows: Array<{ draft: EvidenceDraft; edgeKey: string | null }> = [];
    const edgeByKey = new Map<string, { type: string; fromId: string; toId: string; percentage: number | null; shares: number | null }>();
    const relIdByKey = new Map<string, string>();
    const linkedRelIds = new Set<string>();
    let relationshipsCreated = 0;
    let relationshipsLinked = 0;
    let relationshipsSkipped = 0;

    for (const client of clients) {
      const clientEntityId = xpmUuidToEntityId[client.uuid];
      if (!clientEntityId) continue;

      for (const rel of client.relationships) {
        if (!memberSet.has(rel.relatedUuid)) continue;
        const relatedEntityId = xpmUuidToEntityId[rel.relatedUuid];
        if (!relatedEntityId) continue;

        const { evidence, edge } = normaliseXpmRelationship({
          label: rel.typeRaw,
          clientId: clientEntityId,
          relatedId: relatedEntityId,
          clientName: client.name,
          relatedName: rel.relatedName || nameById.get(relatedEntityId) || null,
          payload: {
            client_uuid: client.uuid,
            related_uuid: rel.relatedUuid,
            percentage: rel.percentage,
            shares: rel.shares,
          },
        }, ctx);

        if (!edge) {
          relationshipsSkipped++;
          evidenceRows.push({ draft: evidence, edgeKey: null });
          continue;
        }
        // Spouse only is unordered; Partner and every other type keep direction.
        const key = relationshipIdentityKey(edge.type, edge.fromId, edge.toId);
        evidenceRows.push({ draft: evidence, edgeKey: key });
        if (!edgeByKey.has(key)) {
          edgeByKey.set(key, { ...edge, percentage: rel.percentage, shares: rel.shares });
        }
      }
    }

    for (const [key, edge] of edgeByKey) {
      let relationshipId: string | null = null;

      let existingQuery = supabase
        .from("relationships")
        .select("id")
        .eq("tenant_id", tenantId)
        .eq("relationship_type", edge.type)
        .is("deleted_at", null);
      existingQuery = edge.type === "spouse"
        ? existingQuery.or(
          `and(from_entity_id.eq.${edge.fromId},to_entity_id.eq.${edge.toId}),and(from_entity_id.eq.${edge.toId},to_entity_id.eq.${edge.fromId})`,
        )
        : existingQuery.eq("from_entity_id", edge.fromId).eq("to_entity_id", edge.toId);
      const { data: existingRel } = await existingQuery.limit(1).maybeSingle();

      if (existingRel) {
        relationshipId = existingRel.id;
      } else {
        // Only types whose policy allows ownership metadata carry it (never Member).
        const meta = policyMetadataFields(edge.type, entityTypes.get(edge.toId));
        const [fromId, toId] = edge.type === "spouse" && edge.fromId > edge.toId
          ? [edge.toId, edge.fromId]
          : [edge.fromId, edge.toId];
        const { data: insertedRel, error: relErr } = await supabase
          .from("relationships")
          .insert({
            from_entity_id: fromId,
            to_entity_id: toId,
            relationship_type: edge.type,
            tenant_id: tenantId,
            source: "imported",
            ownership_percent: meta.includes("ownership_percent") ? edge.percentage : null,
            ownership_units: meta.includes("ownership_units") ? edge.shares : null,
          })
          .select("id")
          .single();

        if (relErr || !insertedRel) {
          console.error("[import-xpm-group] Relationship insert error:", relErr?.message, { type: edge.type, fromId, toId });
          relationshipsSkipped++;
          continue;
        }
        relationshipId = insertedRel.id;
        relationshipsCreated++;
      }

      if (!relationshipId) continue;
      relIdByKey.set(key, relationshipId);
      if (linkedRelIds.has(relationshipId)) continue;

      const { error: linkErr } = await supabase
        .from("structure_relationships")
        .upsert(
          { structure_id: structureId, relationship_id: relationshipId },
          { onConflict: "structure_id,relationship_id", ignoreDuplicates: true },
        );

      if (linkErr) {
        console.error("[import-xpm-group] structure_relationships link error:", linkErr.message);
        relationshipsSkipped++;
        continue;
      }

      linkedRelIds.add(relationshipId);
      relationshipsLinked++;
    }

    // Evidence: exactly one row per raw fact, written once per import run.
    // A canonical fact whose row could not be written stays pending review.
    let evidenceWritten = 0;
    if (evidenceRows.length > 0) {
      const rows = evidenceRows.map(({ draft, edgeKey }) => {
        const relationshipId = edgeKey ? relIdByKey.get(edgeKey) ?? null : null;
        return {
          ...draft,
          tenant_id: tenantId,
          import_source: "xpm_group",
          import_run_id: importRunId,
          relationship_id: relationshipId,
          review_status: draft.review_status === "not_required" && !relationshipId ? "pending" : draft.review_status,
        };
      });
      for (let i = 0; i < rows.length; i += 200) {
        const { error: evErr, count } = await supabase
          .from("relationship_import_evidence")
          .insert(rows.slice(i, i + 200), { count: "exact" });
        if (evErr) {
          console.error("[import-xpm-group] Evidence insert error:", evErr.message);
        } else {
          evidenceWritten += count ?? 0;
        }
      }
    }

    console.log(`[import-xpm-group] Structure ${structureId}: ${Object.keys(xpmUuidToEntityId).length} entities, ${relationshipsLinked} relationships linked (${relationshipsCreated} new, ${relationshipsSkipped} skipped), ${evidenceWritten} evidence rows (run ${importRunId})`);

    return new Response(JSON.stringify({
      structure_id: structureId,
      entities_count: Object.keys(xpmUuidToEntityId).length,
      relationships_count: relationshipsLinked,
      relationships_created: relationshipsCreated,
      relationships_skipped: relationshipsSkipped,
      evidence_written: evidenceWritten,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (err) {
    console.error("[import-xpm-group] Error:", err);
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
