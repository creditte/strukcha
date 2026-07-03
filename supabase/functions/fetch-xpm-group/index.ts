import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { decryptToken, encryptToken } from "../_shared/crypto.ts";
import { parse as parseXml } from "https://deno.land/x/xml@6.0.1/mod.ts";
import { buildXpmEdges, parseXpmRelationshipType } from "../_shared/xpm-relationships.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const XPM_BASE = "https://api.xero.com/practicemanager/3.1";

// ── Token refresh (5-minute window, rotate refresh token) ──────────
async function refreshAccessToken(supabase: any, connection: any): Promise<string> {
  const now = new Date();
  const expiresAt = new Date(connection.expires_at);
  const currentAccessToken = await decryptToken(connection.access_token);

  if (expiresAt.getTime() - now.getTime() > 300_000) {
    return currentAccessToken;
  }

  console.log("[fetch-xpm-group] Token expires soon, refreshing...");
  const clientId = Deno.env.get("XERO_CLIENT_ID")!;
  const clientSecret = Deno.env.get("XERO_CLIENT_SECRET")!;
  const currentRefreshToken = await decryptToken(connection.refresh_token);

  const res = await fetch("https://identity.xero.com/connect/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}`,
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: currentRefreshToken,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Token refresh failed: ${body}`);
  }

  const tokens = await res.json();
  const newExpiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();
  const encryptedAccessToken = await encryptToken(tokens.access_token);
  const encryptedRefreshToken = await encryptToken(tokens.refresh_token);

  await supabase
    .from("xero_connections")
    .update({
      access_token: encryptedAccessToken,
      refresh_token: encryptedRefreshToken,
      expires_at: newExpiresAt,
      updated_at: new Date().toISOString(),
    })
    .eq("id", connection.id);

  return tokens.access_token;
}

// ── XPM helpers ────────────────────────────────────────────────────
function xpmHeaders(accessToken: string, xeroTenantId: string): Record<string, string> {
  return {
    Authorization: `Bearer ${accessToken}`,
    "xero-tenant-id": xeroTenantId,
    Accept: "application/xml",
  };
}

async function xpmGetXml(path: string, accessToken: string, xeroTenantId: string): Promise<any> {
  const url = `${XPM_BASE}${path}`;
  console.log(`[fetch-xpm-group] GET ${url}`);
  const res = await fetch(url, { headers: xpmHeaders(accessToken, xeroTenantId) });
  if (!res.ok) {
    const errText = await res.text();
    console.warn(`[fetch-xpm-group] ${res.status} on ${path}: ${errText.substring(0, 300)}`);
    return null;
  }
  const text = await res.text();
  try {
    return parseXml(text);
  } catch (e) {
    console.warn(`[fetch-xpm-group] XML parse error on ${path}:`, e);
    return null;
  }
}

function xmlArray(parent: any, key: string): any[] {
  if (!parent) return [];
  const val = parent[key];
  if (!val) return [];
  if (Array.isArray(val)) return val;
  return [val];
}

function xmlText(node: any, key: string): string {
  if (!node) return "";
  const val = node[key];
  if (val === null || val === undefined) return "";
  if (typeof val === "object" && val["#text"] !== undefined) return String(val["#text"]);
  return String(val);
}

// Discover PRACTICEMANAGER tenant ID
async function discoverPmTenantId(accessToken: string, storedTenantId: string | null): Promise<string | null> {
  try {
    const res = await fetch("https://api.xero.com/connections", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (res.ok) {
      const conns = await res.json();
      const pmConn = conns.find((c: any) => c.tenantType === "PRACTICEMANAGER");
      if (pmConn) return pmConn.tenantId;
    }
  } catch (e) {
    console.warn("[fetch-xpm-group] Failed to fetch /connections:", e);
  }
  return storedTenantId;
}

const BUSINESS_STRUCTURE_MAP: Record<string, string> = {
  Individual: "Individual",
  Company: "Company",
  Trust: "Trust",
  Partnership: "Partnership",
  "Sole Trader": "Sole Trader",
  "Trustee Company": "Company",
  "Discretionary Trust": "trust_discretionary",
  "Unit Trust": "trust_unit",
  "Hybrid Trust": "trust_hybrid",
  "Bare Trust": "trust_bare",
  "Testamentary Trust": "trust_testamentary",
  "Deceased Estate": "trust_deceased_estate",
  "Family Trust": "trust_family",
  "Self Managed Superannuation Fund": "smsf",
  SMSF: "smsf",
  "Super Fund": "smsf",
  SuperFund: "smsf",
};

function resolveEntityType(businessStructure?: string): string {
  if (businessStructure) {
    const mapped = BUSINESS_STRUCTURE_MAP[businessStructure];
    if (mapped) return mapped;
    const lower = businessStructure.toLowerCase();
    for (const [key, val] of Object.entries(BUSINESS_STRUCTURE_MAP)) {
      if (key.toLowerCase() === lower) return val;
    }
  }
  return "Unclassified";
}

// ── Main ────────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("authorization") ?? "";
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    const supabase = createClient(supabaseUrl, serviceKey);

    // Verify caller
    const anonClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authErr } = await anonClient.auth.getUser();
    if (authErr || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Parse body
    const body = await req.json().catch(() => ({}));
    const groupUuid = body.group_uuid;
    if (!groupUuid || typeof groupUuid !== "string") {
      return new Response(JSON.stringify({ error: "group_uuid is required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get tenant
    const { data: tenantId } = await supabase.rpc("get_user_tenant_id", { _user_id: user.id });
    if (!tenantId) {
      return new Response(JSON.stringify({ error: "No tenant found" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Load Xero connection
    const { data: connections } = await supabase
      .from("xero_connections")
      .select("*")
      .eq("tenant_id", tenantId)
      .order("connected_at", { ascending: false })
      .limit(1);

    if (!connections || connections.length === 0) {
      return new Response(JSON.stringify({ error: "No Xero connection found" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const connection = connections[0];
    const accessToken = await refreshAccessToken(supabase, connection);

    const xeroTenantId = await discoverPmTenantId(accessToken, connection.xero_tenant_id);
    if (!xeroTenantId) {
      return new Response(JSON.stringify({ error: "Xero tenant ID not available" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Step 1: Fetch group members
    console.log(`[fetch-xpm-group] Fetching group ${groupUuid}...`);
    const groupXml = await xpmGetXml(`/clientgroup.api/get/${groupUuid}`, accessToken, xeroTenantId);
    
    if (!groupXml) {
      return new Response(JSON.stringify({ error: "Failed to fetch group details from XPM" }), {
        status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const groupDetail = groupXml?.Response?.Group;
    const groupName = xmlText(groupDetail, "Name");
    const clientsInGroup = groupDetail?.Clients;
    const members = xmlArray(clientsInGroup, "Client");
    console.log(`[fetch-xpm-group] Group "${groupName}" has ${members.length} members`);

    // Step 2: Fetch each member's details in parallel (batches of 10)
    interface NodeData {
      id: string;
      name: string;
      entityType: string;
      abn: string | null;
      acn: string | null;
      businessStructure: string;
      relationships: Array<{
        type: string;
        typeRaw: string;
        relatedClientUuid: string;
        relatedClientName: string;
        percentage: number | null;
      }>;
    }

    const nodes: NodeData[] = [];
    const BATCH_SIZE = 10;
    const memberUuids = members.map((m: any) => xmlText(m, "UUID")).filter(Boolean);

    for (let i = 0; i < memberUuids.length; i += BATCH_SIZE) {
      const batch = memberUuids.slice(i, i + BATCH_SIZE);
      const results = await Promise.all(
        batch.map(async (uuid: string) => {
          const detailXml = await xpmGetXml(`/client.api/get/${uuid}`, accessToken, xeroTenantId);
          if (!detailXml) return null;
          
          const c = detailXml?.Response?.Client;
          if (!c) return null;

          const name = xmlText(c, "Name") || `${xmlText(c, "FirstName")} ${xmlText(c, "LastName")}`.trim();
          const businessStructure = xmlText(c, "BusinessStructure");
          const entityType = resolveEntityType(businessStructure);
          
          // Extract relationships
          const relContainer = c?.Relationships;
          const relList = xmlArray(relContainer, "Relationship");
          const rels: NodeData["relationships"] = [];

          for (const rel of relList) {
            const typeRaw = (xmlText(rel, "Type") || xmlText(rel, "RelationshipType")).trim();
            const relatedClient = rel?.RelatedClient;
            const relatedUuid = xmlText(relatedClient, "UUID") || xmlText(rel, "RelatedClientUUID");
            const relatedName = xmlText(relatedClient, "Name") || xmlText(rel, "RelatedClientName");
            const percentStr = xmlText(rel, "Percentage") || xmlText(rel, "OwnershipPercentage");
            const percentage = percentStr ? parseFloat(percentStr) : null;
            const rule = parseXpmRelationshipType(typeRaw);

            if ((relatedUuid || relatedName) && rule) {
              rels.push({
                type: rule.type,
                typeRaw,
                relatedClientUuid: relatedUuid,
                relatedClientName: relatedName,
                percentage: percentage && !isNaN(percentage) ? percentage : null,
              });
            }
          }

          return {
            id: uuid,
            name,
            entityType,
            abn: xmlText(c, "TaxNumber") || xmlText(c, "ABN") || null,
            acn: xmlText(c, "CompanyNumber") || xmlText(c, "ACN") || null,
            businessStructure,
            relationships: rels,
          } as NodeData;
        })
      );

      for (const r of results) {
        if (r) nodes.push(r);
      }
    }

    const memberUuidSet = new Set(memberUuids);
    const edges = buildXpmEdges(
      nodes.map((n) => ({
        id: n.id,
        entityType: n.entityType,
        relationships: n.relationships.map((r) => ({
          typeRaw: r.typeRaw,
          relatedClientUuid: r.relatedClientUuid,
          percentage: r.percentage,
        })),
      })),
      memberUuidSet,
    );

    return new Response(JSON.stringify({
      groupName,
      groupUuid,
      nodes,
      edges,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[fetch-xpm-group] Error:", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
