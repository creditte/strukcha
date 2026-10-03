import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getXeroAccessToken, loadXeroConnection } from "../_shared/xero-token.ts";
import { parse as parseXml } from "https://esm.sh/jsr/@libs/xml@6.0.1";
import { resolveEntityType } from "../_shared/xpm-entity-type.ts";
import {
  classifyWithProvenance,
  normaliseXpmRelationship,
  type EvidenceDraft,
} from "../_shared/xpm-policy-normalise.ts";
import { relationshipIdentityKey } from "../_shared/relationship-policy.ts";
import { figuresForEdge, normaliseXpmOwnership, type XpmFigures } from "../_shared/xpm-ownership.ts";
import {
  hashGroupMembers,
  planGroupReconciliation,
  type GroupState,
  type ReconcilePlan,
} from "../_shared/xpm-group-reconcile.ts";
import { loadTradesAsOwners } from "../_shared/xpm-trades-as.ts";
import { corsHeadersFor } from "../_shared/cors.ts";
import { fetchXpmWithRetry, memberFetchFailure, readGroupMemberRecords } from "../_shared/xpm-member-completeness.ts";


const XPM_BASE = "https://api.xero.com/practicemanager/3.1";

function xpmHeaders(accessToken: string, xeroTenantId: string) {
  return { Authorization: `Bearer ${accessToken}`, "xero-tenant-id": xeroTenantId, Accept: "application/xml" };
}

// Retries rate limits / transient errors (shared rules with sync-xpm) so a
// group is never planned from a partial member list.
async function xpmGetXml(path: string, accessToken: string, xeroTenantId: string): Promise<any> {
  const out = await fetchXpmWithRetry(() => fetch(`${XPM_BASE}${path}`, { headers: xpmHeaders(accessToken, xeroTenantId) }));
  if (!out.ok) return null;
  try { return parseXml(out.text); } catch { return null; }
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
    // "preview" is write-free; "apply" needs an explicit confirmation. Callers
    // that send neither (an out-of-date page) are refused rather than applied.
    const mode = body.mode;
    const allowBesideManual = body.allow_create_beside_manual === true;
    const expectedStructureId: string | null | undefined = "expected_structure_id" in body ? body.expected_structure_id : undefined;
    if (mode !== "preview" && mode !== "apply") {
      return new Response(JSON.stringify({ code: "preview_required", error: "Please refresh the page to review changes before opening this group." }), { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
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

    // Shared completeness rule: every member record must be read and parsed.
    const { records: allFetched, failed: failedUuids } = await readGroupMemberRecords<ClientData>(
      memberUuids,
      async (uuid: string) => {
        const xml = await xpmGetXml(`/client.api/get/${uuid}`, accessToken, xeroTenantId);
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
          const fig = normaliseXpmOwnership({
            shares: xmlText(rel, "NumberOfShares"),
            percentage: xmlText(rel, "Percentage") || xmlText(rel, "OwnershipPercentage"),
          });

          if (relUuid && typeRaw) {
            rels.push({
              typeRaw,
              relatedUuid: relUuid,
              relatedName: relName,
              percentage: fig.percent,
              shares: fig.units,
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
      },
    );

    const json = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    // Never preview or apply from an incomplete group: a missing member record
    // would silently drop its relationships.
    if (failedUuids.length > 0) {
      const failure = memberFetchFailure({ uuid: groupUuid, name: groupName }, failedUuids)!;
      console.warn("[import-xpm-group] xpm_member_fetch_failed", JSON.stringify(failure));
      return json({
        ...failure,
        error: `${failedUuids.length} client record(s) in this group could not be read from XPM. Nothing was changed; please try again.`,
      }, 502);
    }

    // Archived/deleted XPM clients stay in the database as history but are kept
    // out of the active diagram, matching the full sync's behaviour.
    const inactiveUuids = allFetched.filter((c) => c.isArchived || c.isDeleted).map((c) => c.uuid);
    const clients: ClientData[] = allFetched.filter((c) => !c.isArchived && !c.isDeleted);
    const memberHash = await hashGroupMembers(groupName, memberUuids);
    const FILTER_BATCH = 80;

    // ── Read-only lookups (shared by preview and apply) ──────────────
    const loadEntities = async () => {
      const map: Record<string, { id: string; type: string; archived: boolean }> = {};
      const uuidList = allFetched.map((c) => c.uuid).filter(Boolean);
      for (let i = 0; i < uuidList.length; i += FILTER_BATCH) {
        const { data, error } = await supabase
          .from("entities")
          .select("id, xpm_uuid, entity_type, is_archived")
          .eq("tenant_id", tenantId)
          .is("deleted_at", null)
          .in("xpm_uuid", uuidList.slice(i, i + FILTER_BATCH));
        if (error) throw new Error(`Entity lookup failed: ${error.message}`);
        for (const e of data ?? []) if (e.xpm_uuid) map[e.xpm_uuid] = { id: e.id, type: e.entity_type, archived: e.is_archived };
      }
      return map;
    };
    const loadState = async (): Promise<GroupState> => {
      const { data, error } = await supabase.rpc("xpm_group_reconcile_state", {
        _tenant_id: tenantId, _group_uuid: groupUuid, _group_name: groupName, _member_uuids: memberUuids,
      });
      if (error) throw new Error(`Group state failed: ${error.message}`);
      return data as GroupState;
    };

    /** Canonical edges between active members. Ids are entity ids or `new:<xpm uuid>`. */
    const buildEdges = async (idOf: (uuid: string) => string | null, storedType: (id: string) => string | undefined) => {
      const memberSet = new Set(clients.map((c) => c.uuid));
      const entityTypes = new Map<string, string>();
      const provisionalTypes = new Set<string>();
      const nameById = new Map<string, string>();
      for (const c of clients) {
        const id = idOf(c.uuid);
        if (!id) continue;
        const st = storedType(id);
        entityTypes.set(id, st && st !== "Unclassified" ? st : c.entityType);
        nameById.set(id, c.name);
        const prov = classifyWithProvenance(resolveEntityType, c.businessStructure, c.name);
        if (prov.provisional && entityTypes.get(id) === prov.entityType) provisionalTypes.add(id);
      }
      const soleTraderIds = [...entityTypes].filter(([id, t]) => t === "Sole Trader" && !id.startsWith("new:")).map(([id]) => id);
      const tradesAs = await loadTradesAsOwners(supabase, tenantId, soleTraderIds, FILTER_BATCH);
      for (const [id, t] of tradesAs.ownerTypes) if (!entityTypes.has(id)) entityTypes.set(id, t);
      const ctx = { entityTypes, provisionalTypes, tradesAsOwners: tradesAs.owners };

      const evidenceRows: Array<{ draft: EvidenceDraft; edgeKey: string | null }> = [];
      const edgeByKey = new Map<string, { type: string; fromId: string; toId: string; figures: XpmFigures | null }>();
      let skipped = 0;
      for (const client of clients) {
        const clientId = idOf(client.uuid);
        if (!clientId) continue;
        for (const rel of client.relationships) {
          if (!memberSet.has(rel.relatedUuid)) continue;
          const relatedId = idOf(rel.relatedUuid);
          if (!relatedId) continue;
          const { evidence, edge } = normaliseXpmRelationship({
            label: rel.typeRaw,
            clientId,
            relatedId,
            clientName: client.name,
            relatedName: rel.relatedName || nameById.get(relatedId) || null,
            payload: { client_uuid: client.uuid, related_uuid: rel.relatedUuid, percentage: rel.percentage, shares: rel.shares },
          }, ctx);
          if (!edge) { skipped++; evidenceRows.push({ draft: evidence, edgeKey: null }); continue; }
          const key = relationshipIdentityKey(edge.type, edge.fromId, edge.toId);
          evidenceRows.push({ draft: evidence, edgeKey: key });
          if (!edgeByKey.has(key)) {
            edgeByKey.set(key, {
              type: edge.type, fromId: edge.fromId, toId: edge.toId,
              figures: figuresForEdge(edge.type, entityTypes.get(edge.toId), { units: rel.shares, percent: rel.percentage }),
            });
          }
        }
      }
      return { edgeByKey, evidenceRows, skipped, nameById };
    };

    const findRel = (state: GroupState, e: { type: string; fromId: string; toId: string }) =>
      state.relationships.find((r) => r.type === e.type &&
        ((r.from_id === e.fromId && r.to_id === e.toId) || (e.type === "spouse" && r.from_id === e.toId && r.to_id === e.fromId)));

    const conflictBody = (plan: ReconcilePlan) => ({
      code: plan.status,
      error: plan.status === "ambiguous_structure_match"
        ? `More than one XPM diagram is called "${groupName}". Nothing was changed; please review them.`
        : `A hand-made diagram called "${groupName}" already exists. Nothing was changed.`,
      candidates: plan.candidates,
      same_name_manual: plan.same_name_manual,
    });

    // ── Preview: guaranteed write-free (selects + a STABLE function only) ──
    if (mode === "preview") {
      const ents = await loadEntities();
      const state = await loadState();
      const idOf = (u: string) => ents[u]?.id ?? (clients.some((c) => c.uuid === u) ? `new:${u}` : null);
      const typeById = new Map(Object.values(ents).map((e) => [e.id, e.type]));
      const { edgeByKey, evidenceRows, skipped, nameById } = await buildEdges(idOf, (id) => typeById.get(id));

      const confirmed = new Set<string>();
      const figures = new Map<string, XpmFigures>();
      const newRelationships: unknown[] = [];
      const nm = (id: string) => nameById.get(id) ?? id;
      for (const e of edgeByKey.values()) {
        const r = e.fromId.startsWith("new:") || e.toId.startsWith("new:") ? undefined : findRel(state, e);
        if (r) { confirmed.add(r.id); if (e.figures) figures.set(r.id, e.figures); }
        else newRelationships.push({ type: e.type, from: nm(e.fromId), to: nm(e.toId), units: e.figures?.units ?? null, percent: e.figures?.percent ?? null });
      }
      // Preview shows what an Open in Editor confirmation would do: active
      // members as they will be once un-archived by the apply.
      const activeUuids = new Set(clients.map((c) => c.uuid));
      const previewState: GroupState = {
        ...state,
        members: state.members.map((m) => ({ ...m, is_archived: activeUuids.has(m.xpm_uuid) ? false : true })),
      };
      const plan = planGroupReconciliation(previewState, { confirmedRelationshipIds: confirmed, figures, allowCreateBesideManual: allowBesideManual });
      const entName = new Map<string, string>();
      for (const m of state.members) if (m.entity_id) entName.set(m.entity_id, m.name ?? m.xpm_uuid);
      for (const s of state.structure_entities) entName.set(s.entity_id, s.name ?? s.entity_id);
      const relLabel = (id: string) => {
        const r = state.relationships.find((x) => x.id === id);
        return r ? { type: r.type, from: entName.get(r.from_id) ?? r.from_id, to: entName.get(r.to_id) ?? r.to_id, units: r.units, percent: r.percent } : { id };
      };
      return json({
        mode: "preview",
        status: plan.status,
        match: plan.match,
        structure_id: plan.structure_id,
        group_uuid: groupUuid,
        group_name: groupName,
        member_hash: memberHash,
        ...(plan.status === "ready" ? {} : conflictBody(plan)),
        summary: {
          newEntities: clients.filter((c) => !ents[c.uuid]).map((c) => c.name),
          membersToAdd: plan.add_members.map((id) => entName.get(id) ?? id),
          membersToRemove: plan.remove_members.map((id) => entName.get(id) ?? id),
          archivedInXpm: allFetched.filter((c) => c.isArchived || c.isDeleted).map((c) => c.name),
          linksToAdd: plan.add_links.map(relLabel),
          linksToRemove: plan.remove_links.map(relLabel),
          newRelationships,
          metadataUpdates: plan.metadata_updates.map((m) => ({ ...relLabel(m.relationship_id), new_units: m.units, new_percent: m.percent })),
          preserved: {
            manualMembers: plan.preserved.manual_members.map((id) => entName.get(id) ?? id),
            manualLinks: plan.preserved.manual_links.map(relLabel),
            metadataOverrides: plan.preserved.metadata_overrides.map(relLabel),
            membersKeptForManualLinks: plan.preserved.members_kept_for_manual_links.map((id) => entName.get(id) ?? id),
          },
          evidenceFacts: evidenceRows.length,
          relationshipsSkipped: skipped,
        },
        plan,
      });
    }

    // ── Apply ────────────────────────────────────────────────────────
    {
      const pre = planGroupReconciliation(await loadState(), { allowCreateBesideManual: allowBesideManual });
      if (pre.status !== "ready") return json(conflictBody(pre), 409);
      if (expectedStructureId !== undefined && (pre.structure_id ?? null) !== (expectedStructureId ?? null)) {
        return json({ code: "stale_plan", error: "This group changed since the preview. Please review it again." }, 409);
      }
    }

    if (inactiveUuids.length > 0) {
      for (let i = 0; i < inactiveUuids.length; i += FILTER_BATCH) {
        await supabase.from("entities").update({ is_archived: true })
          .eq("tenant_id", tenantId).in("xpm_uuid", inactiveUuids.slice(i, i + FILTER_BATCH));
      }
    }

    const ents = await loadEntities();
    // Re-classify Unclassified records and un-archive members active in XPM again.
    for (const c of clients) {
      const e = ents[c.uuid];
      if (!e) continue;
      const patch: Record<string, unknown> = {};
      if (e.archived) patch.is_archived = false;
      if (c.entityType !== "Unclassified" && e.type === "Unclassified") patch.entity_type = c.entityType;
      if (Object.keys(patch).length === 0) continue;
      await supabase.from("entities").update(patch).eq("id", e.id).eq("tenant_id", tenantId);
      if (patch.entity_type) e.type = String(patch.entity_type);
    }
    const missing = clients.filter((c) => !ents[c.uuid]);
    if (missing.length > 0) {
      const { data: inserted, error: entErr } = await supabase.from("entities").insert(
        missing.map((c) => ({
          name: c.name, entity_type: c.entityType, tenant_id: tenantId, source: "imported" as const,
          abn: c.abn, acn: c.acn, xpm_uuid: c.uuid,
        })),
      ).select("id, xpm_uuid, entity_type");
      if (entErr) console.error("[import-xpm-group] Entity insert error:", entErr.message);
      for (const e of inserted ?? []) if (e.xpm_uuid) ents[e.xpm_uuid] = { id: e.id, type: e.entity_type, archived: false };
    }

    const typeById = new Map(Object.values(ents).map((e) => [e.id, e.type]));
    const { edgeByKey, evidenceRows } = await buildEdges((u) => ents[u]?.id ?? null, (id) => typeById.get(id));
    const importRunId = crypto.randomUUID();
    const relIdByKey = new Map<string, string>();
    const figures = new Map<string, XpmFigures>();
    let relationshipsCreated = 0;
    let relationshipsSkipped = 0;

    for (const [key, edge] of edgeByKey) {
      let q = supabase.from("relationships").select("id")
        .eq("tenant_id", tenantId).eq("relationship_type", edge.type).is("deleted_at", null);
      q = edge.type === "spouse"
        ? q.or(`and(from_entity_id.eq.${edge.fromId},to_entity_id.eq.${edge.toId}),and(from_entity_id.eq.${edge.toId},to_entity_id.eq.${edge.fromId})`)
        : q.eq("from_entity_id", edge.fromId).eq("to_entity_id", edge.toId);
      const { data: existingRel } = await q.limit(1).maybeSingle();
      let relationshipId: string | null = existingRel?.id ?? null;
      if (!relationshipId) {
        const [fromId, toId] = edge.type === "spouse" && edge.fromId > edge.toId ? [edge.toId, edge.fromId] : [edge.fromId, edge.toId];
        const { data: insertedRel, error: relErr } = await supabase.from("relationships").insert({
          from_entity_id: fromId, to_entity_id: toId, relationship_type: edge.type, tenant_id: tenantId,
          source: "imported", metadata_source: "xpm",
          ownership_percent: edge.figures?.percent ?? null,
          ownership_units: edge.figures?.units ?? null,
        }).select("id").single();
        if (relErr || !insertedRel) {
          console.error("[import-xpm-group] Relationship insert error:", relErr?.message, { type: edge.type, fromId, toId });
          relationshipsSkipped++;
          continue;
        }
        relationshipId = insertedRel.id;
        relationshipsCreated++;
      }
      relIdByKey.set(key, relationshipId!);
      if (edge.figures) figures.set(relationshipId!, edge.figures);
    }

    // Evidence: exactly one row per raw fact, written once per import run.
    let evidenceWritten = 0;
    if (evidenceRows.length > 0) {
      const rows = evidenceRows.map(({ draft, edgeKey }) => {
        const relationshipId = edgeKey ? relIdByKey.get(edgeKey) ?? null : null;
        return {
          ...draft, tenant_id: tenantId, import_source: "xpm_group", import_run_id: importRunId,
          relationship_id: relationshipId,
          review_status: draft.review_status === "not_required" && !relationshipId ? "pending" : draft.review_status,
        };
      });
      for (let i = 0; i < rows.length; i += 200) {
        const { error: evErr, count } = await supabase.from("relationship_import_evidence").insert(rows.slice(i, i + 200), { count: "exact" });
        if (evErr) console.error("[import-xpm-group] Evidence insert error:", evErr.message);
        else evidenceWritten += count ?? 0;
      }
    }

    const state = await loadState();
    const plan = planGroupReconciliation(state, {
      confirmedRelationshipIds: new Set(relIdByKey.values()), figures, allowCreateBesideManual: allowBesideManual,
    });
    if (plan.status !== "ready") return json(conflictBody(plan), 409);
    const { data: applied, error: applyErr } = await supabase.rpc("xpm_apply_group_reconciliation", {
      _tenant_id: tenantId, _group_uuid: groupUuid, _group_name: groupName, _member_hash: memberHash,
      _plan: plan, _select: true, _actor: user.id, _run_id: importRunId,
    });
    if (applyErr) return json({ error: "Failed to update the diagram", detail: applyErr.message }, 500);
    const result = applied as Record<string, unknown>;
    if (result.status !== "applied") {
      const status = result.status === "limit_reached" ? 403 : 409;
      return json({ code: result.code ?? result.status, error: result.error ?? `Group not applied: ${result.status}`, result }, status);
    }

    console.log(`[import-xpm-group] ${groupUuid} → ${result.structure_id}: ${JSON.stringify(result)} (run ${importRunId})`);
    return json({
      mode: "apply",
      structure_id: result.structure_id,
      entities_count: plan.add_members.length + plan.promote_members.length + plan.keep_members.length,
      relationships_count: relIdByKey.size,
      relationships_created: relationshipsCreated,
      relationships_skipped: relationshipsSkipped,
      evidence_written: evidenceWritten,
      result,
    });
  } catch (err) {
    console.error("[import-xpm-group] Error:", err);
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
