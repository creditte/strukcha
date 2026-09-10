// Keeps Xero connections alive.
//
// Xero drops a connection after 60 days without use. Firms that pause for a
// while would otherwise return to a dead connection with no warning, so this
// job renews idle connections well inside the window and records the ones that
// can no longer be renewed.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { isServiceRoleRequest } from "../_shared/cron-auth.ts";
import { getXeroAccessToken, XeroReauthRequiredError } from "../_shared/xero-token.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/** Renew when nothing has touched the connection for this long. */
const IDLE_DAYS = 20;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  if (!isServiceRoleRequest(req)) return json({ error: "Unauthorized" }, 401);

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const cutoff = new Date(Date.now() - IDLE_DAYS * 86_400_000).toISOString();
  const { data: rows, error } = await supabase
    .from("xero_connections")
    .select("*")
    .eq("status", "active")
    .or(`last_refresh_at.is.null,last_refresh_at.lt.${cutoff}`)
    .limit(50);

  if (error) {
    console.error("[xero-keepalive] read failed:", error.message);
    return json({ error: "read_failed" }, 500);
  }

  let renewed = 0;
  let needsReauth = 0;
  const failures: string[] = [];

  for (const row of rows ?? []) {
    try {
      // Force a renewal even when the current key still looks fresh: the point
      // is to exercise the authorisation, not to serve a request.
      await getXeroAccessToken(supabase, row as any, { force: true });
      renewed++;

    } catch (e) {
      if (e instanceof XeroReauthRequiredError) {
        needsReauth++;
      } else {
        failures.push(e instanceof Error ? e.message : String(e));
      }
    }
  }

  console.log(
    `[xero-keepalive] checked ${rows?.length ?? 0}, renewed ${renewed}, needs reconnect ${needsReauth}`,
  );
  return json({ checked: rows?.length ?? 0, renewed, needsReauth, failures: failures.slice(0, 5) });
});
