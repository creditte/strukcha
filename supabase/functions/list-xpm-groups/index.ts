import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { decryptToken, encryptToken } from "../_shared/crypto.ts";
import { parse as parseXml } from "https://deno.land/x/xml@6.0.1/mod.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const XPM_BASE = "https://api.xero.com/practicemanager/3.1";

async function refreshAccessToken(supabase: any, connection: any): Promise<string> {
  const now = new Date();
  const expiresAt = new Date(connection.expires_at);
  const currentAccessToken = await decryptToken(connection.access_token);

  if (expiresAt.getTime() - now.getTime() > 300_000) {
    return currentAccessToken;
  }

  console.log("[list-xpm-groups] Token expires soon, refreshing...");
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
    console.warn("[list-xpm-groups] Failed to fetch /connections:", e);
  }
  return storedTenantId;
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
      return new Response(JSON.stringify({ error: "No Xero connection found. Please connect XPM first.", groups: [] }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const connection = connections[0];
    const startedAt = Date.now();

    // Optional: return cached groups only (fast path for UI)
    const body = await req.json().catch(() => ({}));
    const cacheOnly = body?.cache_only === true;

    const { data: cachedRows } = await supabase
      .from("xpm_groups")
      .select("xpm_uuid, name, updated_at")
      .eq("tenant_id", tenantId)
      .order("name", { ascending: true });

    const cachedGroups = (cachedRows ?? []).map((g) => ({
      xpm_uuid: g.xpm_uuid,
      name: g.name,
    }));
    const cachedAt = cachedRows?.length
      ? cachedRows.reduce((latest, g) => (g.updated_at > latest ? g.updated_at : latest), cachedRows[0].updated_at)
      : null;

    if (cacheOnly) {
      return new Response(JSON.stringify({
        groups: cachedGroups,
        count: cachedGroups.length,
        cached: true,
        cached_at: cachedAt,
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const accessToken = await refreshAccessToken(supabase, connection);

    // Prefer stored PM tenant id — avoids an extra round-trip to api.xero.com/connections
    let xeroTenantId = connection.xero_tenant_id as string | null;
    if (!xeroTenantId) {
      xeroTenantId = await discoverPmTenantId(accessToken, null);
      if (xeroTenantId) {
        await supabase
          .from("xero_connections")
          .update({ xero_tenant_id: xeroTenantId, updated_at: new Date().toISOString() })
          .eq("id", connection.id);
      }
    }

    if (!xeroTenantId) {
      return new Response(JSON.stringify({
        error: "Practice Manager tenant not found",
        groups: cachedGroups,
        cached: cachedGroups.length > 0,
        cached_at: cachedAt,
      }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch groups from XPM API (dominant latency — typically several seconds)
    console.log("[list-xpm-groups] Fetching clientgroup.api/list...");
    const url = `${XPM_BASE}/clientgroup.api/list`;
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "xero-tenant-id": xeroTenantId,
        Accept: "application/xml",
      },
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error(`[list-xpm-groups] XPM returned ${res.status}: ${errText.substring(0, 300)}`);
      return new Response(JSON.stringify({
        error: `XPM API error: ${res.status}`,
        groups: cachedGroups,
        cached: cachedGroups.length > 0,
        cached_at: cachedAt,
      }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const xmlText2 = await res.text();
    let parsed: any;
    try {
      parsed = parseXml(xmlText2);
    } catch (e) {
      console.error("[list-xpm-groups] XML parse error:", e);
      return new Response(JSON.stringify({
        error: "Failed to parse XPM response",
        groups: cachedGroups,
        cached: cachedGroups.length > 0,
        cached_at: cachedAt,
      }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const groupsContainer = parsed?.Response?.Groups;
    const groupsArray = xmlArray(groupsContainer, "Group");
    console.log(`[list-xpm-groups] Found ${groupsArray.length} groups from XPM in ${Date.now() - startedAt}ms`);

    const groups = groupsArray.map((g: any) => ({
      xpm_uuid: xmlText(g, "UUID"),
      name: xmlText(g, "Name"),
    })).filter((g: any) => g.xpm_uuid && g.name);

    // Batch cache — one upsert per chunk instead of one round-trip per group
    const now = new Date().toISOString();
    const upsertRows = groups.map((g) => ({
      tenant_id: tenantId,
      xpm_uuid: g.xpm_uuid,
      name: g.name,
      updated_at: now,
    }));

    const CHUNK = 200;
    for (let i = 0; i < upsertRows.length; i += CHUNK) {
      const chunk = upsertRows.slice(i, i + CHUNK);
      const { error: upsertErr } = await supabase
        .from("xpm_groups")
        .upsert(chunk, { onConflict: "tenant_id,xpm_uuid" });
      if (upsertErr) {
        console.error("[list-xpm-groups] Batch upsert error:", upsertErr.message);
      }
    }

    console.log(`[list-xpm-groups] Done in ${Date.now() - startedAt}ms`);

    return new Response(JSON.stringify({
      groups,
      count: groups.length,
      cached: false,
      synced_at: now,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[list-xpm-groups] Error:", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : String(err), groups: [] }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
