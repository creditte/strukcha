import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { decryptXeroTokens, getXeroAccessToken } from "../_shared/xero-token.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const token = authHeader.replace("Bearer ", "");
    const { data: claimsData, error: claimsError } = await userClient.auth.getClaims(token);
    if (claimsError || !claimsData?.claims) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userId = claimsData.claims.sub as string;

    let body: any = {};
    try {
      body = await req.json();
    } catch { /* empty */ }
    const connectionId = body?.connection_id as string | undefined;
    if (!connectionId) {
      return new Response(JSON.stringify({ error: "Missing connection_id" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const service = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Look up the connection (need tokens). Verify caller has access via tenant.
    const { data: conn, error: connErr } = await service
      .from("xero_connections")
      .select("*")
      .eq("id", connectionId)
      .maybeSingle();
    if (connErr || !conn) {
      return new Response(JSON.stringify({ error: "Connection not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Authorise: caller must be owner/admin of the tenant that owns the connection.
    const { data: membership } = await service
      .from("tenant_users")
      .select("role")
      .eq("tenant_id", conn.tenant_id)
      .eq("auth_user_id", userId)
      .maybeSingle();
    const role = (membership as any)?.role;
    if (role !== "owner" && role !== "admin") {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const clientId = Deno.env.get("XERO_CLIENT_ID");
    const clientSecret = Deno.env.get("XERO_CLIENT_SECRET");

    const revokeWarnings: string[] = [];
    let removedFromXero = false;

    // Xero only accepts the real access key, so renew/decrypt it first. The
    // stored value is ciphertext — sending it straight to Xero silently fails
    // and leaves the app listed under the org's Connected Apps.
    let accessToken: string | null = null;
    try {
      accessToken = await getXeroAccessToken(service, conn as any);
    } catch (e) {
      console.warn("xero-disconnect: no usable access key", e);
      revokeWarnings.push("access_token_unavailable");
    }

    // 1) Delete the tenant connection on Xero's side so the app disappears
    //    from the org's Connected Apps list.
    if (accessToken && conn.xero_tenant_id) {
      try {
        const res = await fetch(
          `https://api.xero.com/connections/${conn.xero_tenant_id}`,
          {
            method: "DELETE",
            headers: { Authorization: `Bearer ${accessToken}` },
          },
        );
        if (res.ok || res.status === 404) {
          removedFromXero = true;
        } else {
          const detail = (await res.text()).slice(0, 200);
          console.error(`xero connections delete ${res.status}: ${detail}`);
          revokeWarnings.push(`connections_delete_${res.status}`);
        }
      } catch (e) {
        console.error("xero connections delete failed", e);
        revokeWarnings.push("connections_delete_network");
      }

      // 2) Confirm against Xero's own list that the organisation is gone.
      try {
        const check = await fetch("https://api.xero.com/connections", {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        if (check.ok) {
          const list = await check.json();
          const stillThere = Array.isArray(list) &&
            list.some((c: any) => c.tenantId === conn.xero_tenant_id);
          if (stillThere) {
            removedFromXero = false;
            revokeWarnings.push("still_listed_in_xero");
          } else {
            removedFromXero = true;
          }
        } else {
          await check.body?.cancel();
        }
      } catch (e) {
        console.warn("xero connections verify failed", e);
      }
    }

    // 3) Revoke the renewal key so the user's Xero account fully forgets this
    //    app authorisation. Re-read the row: renewing above rotates the key.
    const { data: latest } = await service
      .from("xero_connections")
      .select("refresh_token")
      .eq("id", connectionId)
      .maybeSingle();
    const storedRefresh = latest?.refresh_token ?? conn.refresh_token;
    if (clientId && clientSecret && storedRefresh) {
      try {
        const { refreshToken } = await decryptXeroTokens({
          access_token: null,
          refresh_token: storedRefresh,
        });
        const basic = btoa(`${clientId}:${clientSecret}`);
        const res = await fetch("https://identity.xero.com/connect/revocation", {
          method: "POST",
          headers: {
            Authorization: `Basic ${basic}`,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: new URLSearchParams({ token: refreshToken ?? "" }).toString(),
        });
        if (!res.ok) {
          const detail = (await res.text()).slice(0, 200);
          console.error(`xero revoke ${res.status}: ${detail}`);
          revokeWarnings.push(`revoke_${res.status}`);
        }
      } catch (e) {
        console.error("xero revoke failed", e);
        revokeWarnings.push("revoke_network");
      }
    }

    // 4) Stop any XPM sync that is still running — it can no longer reach Xero,
    // and leaving it "processing" would keep the dashboard showing progress.
    await service
      .from("import_logs")
      .update({
        status: "failed",
        result: {
          success: false,
          cancelled: true,
          error: "Sync stopped because Xero was disconnected.",
        },
      })
      .eq("tenant_id", conn.tenant_id)
      .eq("file_name", "xpm-sync-3.1")
      .eq("status", "processing");

    // 5) Remove the local record regardless — the user asked to disconnect.
    const { error: delErr } = await service
      .from("xero_connections")
      .delete()
      .eq("id", connectionId);

    if (delErr) {
      return new Response(JSON.stringify({ error: "Failed to remove connection" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(
      JSON.stringify({
        ok: true,
        removedFromXero,
        warnings: revokeWarnings,
        message: removedFromXero
          ? "Disconnected from Xero."
          : "Disconnected in strukcha, but Xero didn't confirm the removal. Please also remove strukcha under Xero Settings → Connected Apps.",
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("xero-disconnect error:", err);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
