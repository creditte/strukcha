// TEMPORARY diagnostic: dumps raw XPM XML for named client groups so the
// relationship/archive fields can be verified against live data. Delete after use.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getXeroAccessToken, loadXeroConnection } from "../_shared/xero-token.ts";

const XPM_BASE = "https://api.xero.com/practicemanager/3.1";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok");
  const url = new URL(req.url);
  if (url.searchParams.get("key") !== Deno.env.get("XPM_PROBE_KEY")) {
    return new Response("forbidden", { status: 403 });
  }
  const tenantId = url.searchParams.get("tenant") ?? "";
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  const conn = await loadXeroConnection(supabase, tenantId);
  if (!conn) return new Response("no connection", { status: 404 });
  const token = await getXeroAccessToken(supabase, conn);
  const headers = {
    Authorization: `Bearer ${token}`,
    "xero-tenant-id": conn.xero_tenant_id!,
    Accept: "application/xml",
  };

  const path = url.searchParams.get("path");
  if (path) {
    const res = await fetch(`${XPM_BASE}${path}`, { headers });
    const text = await res.text();
    const find = url.searchParams.get("find");
    if (find && url.searchParams.get("segment")) {
      const i = text.indexOf(find);
      const start = text.lastIndexOf("<Client>", i);
      const end = text.indexOf("</Client>", i);
      return new Response(text.slice(start, end + 9), { status: res.status });
    }
    if (find) {
      return new Response(JSON.stringify({
        bytes: text.length,
        clients: (text.match(/<Client>/g) ?? []).length,
        archivedYes: (text.match(/<IsArchived>Yes/g) ?? []).length,
        found: text.includes(find),
      }), { status: res.status });
    }
    return new Response(text.slice(0, 200000), { status: res.status });
  }
  return new Response("pass ?path=", { status: 400 });
});
