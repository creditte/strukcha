// TEMPORARY diagnostic: measures the size and parse cost of one XPM client page.
// Deleted once the client-phase CPU problem is characterised.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getXeroAccessToken, loadXeroConnection } from "../_shared/xero-token.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const json = (b: unknown, s = 200) =>
    new Response(JSON.stringify(b), {
      status: s,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const anon = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: { user } } = await anon.auth.getUser();
    if (!user) return json({ error: "Unauthorized" }, 401);
    const { data: tenantId } = await supabase.rpc("get_user_tenant_id", { _user_id: user.id });
    const conn = await loadXeroConnection(supabase, tenantId);
    if (!conn) return json({ error: "no connection" }, 400);
    const token = await getXeroAccessToken(supabase, conn);
    const pagesize = Number(new URL(req.url).searchParams.get("pagesize") ?? 50);

    const t0 = Date.now();
    const res = await fetch(
      `https://api.xero.com/practicemanager/3.1/client.api/list?detailed=true&page=1&pagesize=${pagesize}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          "xero-tenant-id": conn.xero_tenant_id!,
          Accept: "application/xml",
        },
      },
    );
    const text = await res.text();
    const t1 = Date.now();
    const clientTags = (text.match(/<Client>/g) ?? []).length;
    return json({
      status: res.status,
      bytes: text.length,
      clientTags,
      fetchMs: t1 - t0,
      head: text.slice(0, 300),
    });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
