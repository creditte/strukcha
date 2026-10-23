// Super-admin-only launch readiness summary. Returns statuses and counts only:
// never secret values, tokens, raw error payloads, email addresses or tenant data.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeadersFor } from "../_shared/cors.ts";
import { frontendConfigStatus } from "../_shared/frontend-url.ts";
import { stripeMode, stripeVar } from "../_shared/stripe-env.ts";

type Status = "ok" | "warn" | "fail" | "unknown";
interface Item { key: string; label: string; status: Status; summary: string; hint?: string; at?: string | null }

const has = (name: string) => !!(Deno.env.get(name) ?? "").trim();
const DAY = 24 * 3600 * 1000;

Deno.serve(async (req) => {
  const corsHeaders = corsHeadersFor(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Unauthorized" }, 401);
    const userClient = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return json({ error: "Unauthorized" }, 401);
    const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
    const { data: sa } = await admin.from("super_admins").select("id").eq("auth_user_id", user.id).maybeSingle();
    if (!sa) return json({ error: "Forbidden" }, 403);

    const items: Item[] = [];
    const since7 = new Date(Date.now() - 7 * DAY).toISOString();

    // Frontend address
    const fe = frontendConfigStatus();
    items.push({
      key: "frontend", label: "App web address",
      status: fe.configured && fe.valid ? "ok" : "warn",
      summary: fe.configured && fe.valid ? `Links point to ${fe.origin}`
        : `${fe.configured ? "Setting is not a recognised strukcha address" : "Not set"}; links use ${fe.origin}`,
      hint: fe.configured && fe.valid ? undefined : "Update the FRONTEND_URL backend setting to https://www.strukcha.app.",
    });

    // Email
    const { data: lastEmail } = await admin.from("email_send_log")
      .select("status, created_at").order("created_at", { ascending: false }).limit(1).maybeSingle();
    const { count: emailFails } = await admin.from("email_send_log")
      .select("id", { count: "exact", head: true }).in("status", ["failed", "dlq", "bounced"]).gte("created_at", since7);
    const emailKey = has("SMTP2GO_API_KEY");
    items.push({
      key: "email", label: "Email sending",
      status: !emailKey ? "fail" : (emailFails ?? 0) > 0 ? "warn" : "ok",
      summary: !emailKey ? "Email provider key missing"
        : `Provider configured. Last email: ${lastEmail ? lastEmail.status : "none logged"}. Failures in 7 days: ${emailFails ?? 0}`,
      hint: !emailKey ? "Add the email provider key in backend settings." : (emailFails ?? 0) > 0 ? "Check Operations health for undelivered emails." : undefined,
      at: lastEmail?.created_at ?? null,
    });

    // Stripe
    const mode = stripeMode();
    const needed = ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET", "STRIPE_STARTER_MONTHLY_PRICE_ID", "STRIPE_STARTER_ANNUAL_PRICE_ID", "STRIPE_PRO_MONTHLY_PRICE_ID", "STRIPE_PRO_ANNUAL_PRICE_ID"];
    const missing = needed.filter((n) => !(stripeVar(n) ?? "").trim()).length;
    const { data: lastHook } = await admin.from("stripe_webhook_events")
      .select("status, processed_at").order("processed_at", { ascending: false }).limit(1).maybeSingle();
    const { count: hookFails } = await admin.from("stripe_webhook_events")
      .select("id", { count: "exact", head: true }).eq("status", "failed").gte("processed_at", since7);
    items.push({
      key: "stripe", label: "Payments (Stripe)",
      status: missing > 0 ? "fail" : (hookFails ?? 0) > 0 ? "warn" : "ok",
      summary: `${mode === "live" ? "Live" : "Test"} mode. ${missing === 0 ? "All settings present" : `${missing} setting(s) missing`}. Last payment message: ${lastHook ? lastHook.status : "none received"}. Failed in 7 days: ${hookFails ?? 0}`,
      hint: missing > 0 ? "Use Stripe configuration check below to see which setting is missing." : (hookFails ?? 0) > 0 ? "Check Operations health for failing payment messages." : undefined,
      at: lastHook?.processed_at ?? null,
    });

    // Xero
    const xeroCfg = has("XERO_CLIENT_ID") && has("XERO_CLIENT_SECRET") && has("XERO_TOKEN_ENCRYPTION_KEY");
    const { data: conns } = await admin.from("xero_connections").select("status");
    const byStatus: Record<string, number> = {};
    for (const c of conns ?? []) byStatus[c.status] = (byStatus[c.status] ?? 0) + 1;
    const needsReauth = byStatus["needs_reauth"] ?? 0;
    items.push({
      key: "xero", label: "Xero connection",
      status: !xeroCfg ? "fail" : needsReauth > 0 ? "warn" : "ok",
      summary: `${xeroCfg ? "App settings present" : "App settings missing"}. Connections: ${Object.entries(byStatus).map(([k, v]) => `${v} ${k.replace(/_/g, " ")}`).join(", ") || "none"}`,
      hint: !xeroCfg ? "Add the Xero app settings in backend settings." : needsReauth > 0 ? "Firms with a lapsed connection need to reconnect Xero." : undefined,
    });

    // XPM sync
    const { data: lastOk } = await admin.from("import_logs")
      .select("updated_at, result").eq("file_name", "xpm-sync-3.1").eq("status", "completed")
      .order("updated_at", { ascending: false }).limit(1).maybeSingle();
    const { count: syncFails } = await admin.from("import_logs")
      .select("id", { count: "exact", head: true }).eq("file_name", "xpm-sync-3.1").eq("status", "failed").gte("created_at", since7);
    // deno-lint-ignore no-explicit-any
    const r = (lastOk?.result ?? {}) as any;
    const incomplete = Number(r.groupsFailedIncomplete ?? 0);
    const conflicts = Number(r.groupsSkippedConflict ?? 0);
    items.push({
      key: "xpm", label: "XPM sync",
      status: !lastOk ? "unknown" : (syncFails ?? 0) > 0 || incomplete > 0 ? "warn" : "ok",
      summary: !lastOk ? "No completed sync yet"
        : `Last completed sync finished. Failed runs in 7 days: ${syncFails ?? 0}. Groups not fully read: ${incomplete}. Name-clash groups skipped: ${conflicts}`,
      hint: incomplete > 0 ? "Run a full refresh later; unread groups were left unchanged." : conflicts > 0 ? "Name-clash groups need a decision in the editor." : undefined,
      at: lastOk?.updated_at ?? null,
    });

    // Invitations
    const { count: pendingTeam } = await admin.from("tenant_users")
      .select("id", { count: "exact", head: true }).eq("status", "invited").is("deleted_at", null);
    const { count: pendingInv } = await admin.from("invitations")
      .select("id", { count: "exact", head: true }).is("accepted_at", null).gt("expires_at", new Date().toISOString());
    const pending = (pendingTeam ?? 0) + (pendingInv ?? 0);
    items.push({
      key: "invites", label: "Pending invitations",
      status: "ok",
      summary: `${pending} invitation(s) not yet accepted`,
      hint: pending > 0 ? "Firm admins can resend or remove these in Team settings." : undefined,
    });

    // Security scan: no safe server-side source.
    items.push({
      key: "security", label: "Security scan",
      status: "unknown",
      summary: "Not available here",
      hint: "Check the Security view in the project editor.",
    });

    return json({ checked_at: new Date().toISOString(), items });
  } catch (e) {
    console.error("[system-readiness]", (e as Error)?.message);
    return json({ error: "Readiness check failed" }, 500);
  }
});
