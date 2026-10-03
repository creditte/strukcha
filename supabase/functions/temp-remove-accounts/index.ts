// TEMPORARY one-off function. Delete after use.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { corsHeadersFor } from "../_shared/cors.ts";

const ID = "633c7a6e-ad0a-4413-b6a6-b03d223a1c87";
const EMAIL = "kishan@creditte.com.au";
const TU_ID = "35d88365-6284-4dc9-8b06-ec022f307c83";

Deno.serve(async (req) => {
  const cors = corsHeadersFor(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  const json = (b: unknown, s = 200) =>
    new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
  const url = Deno.env.get("SUPABASE_URL")!;
  const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
  const svc = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const auth = req.headers.get("Authorization");
  if (!auth?.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);
  const uc = createClient(url, anon, { global: { headers: { Authorization: auth } } });
  const { data: { user: caller } } = await uc.auth.getUser();
  if (!caller) return json({ error: "Unauthorized" }, 401);
  const admin = createClient(url, svc, { auth: { persistSession: false } });
  const { data: sa } = await admin.from("super_admins").select("id").eq("auth_user_id", caller.id).maybeSingle();
  if (!sa) return json({ error: "Forbidden" }, 403);

  const r: Record<string, unknown> = { id: ID, email: EMAIL };
  try {
    const { data: got, error: gErr } = await admin.auth.admin.getUserById(ID);
    if (gErr) throw new Error(gErr.message);
    if (got.user?.email?.toLowerCase() !== EMAIL) return json({ error: "email mismatch" }, 409);
    const { data: prof } = await admin.from("profiles").select("tenant_id").eq("user_id", ID).maybeSingle();
    const { error: aErr } = await admin.from("tenant_user_audit_log").insert({
      tenant_id: prof?.tenant_id ?? "f0e4888d-3d0c-4f70-8890-b6f202a380f1",
      actor_auth_user_id: caller.id,
      action: "account_removed_by_super_admin",
      target_tenant_user_id: TU_ID,
      target_email: EMAIL,
      meta: { auth_user_id: ID, reason: "unauthorised/unneeded account clean-up", removed_at: new Date().toISOString() },
    });
    if (aErr) throw new Error(`audit: ${aErr.message}`);
    const del = async (t: string, col: string, v: string, ci = false) => {
      const q = admin.from(t).delete({ count: "exact" });
      const { error, count } = await (ci ? q.ilike(col, v) : q.eq(col, v));
      if (error) throw new Error(`${t}: ${error.message}`);
      return count ?? 0;
    };
    r.super_admins = await del("super_admins", "auth_user_id", ID);
    r.tenant_users = await del("tenant_users", "email", EMAIL, true);
    r.invitations = await del("invitations", "email", EMAIL, true);
    r.user_roles = await del("user_roles", "user_id", ID);
    for (const t of ["trusted_devices", "mfa_settings", "mfa_verifications", "mfa_email_codes", "signup_verifications"]) {
      r[t] = await del(t, "user_id", ID);
    }
    r.profiles = await del("profiles", "user_id", ID);
    const { error } = await admin.auth.admin.deleteUser(ID);
    if (error) throw new Error(`auth: ${error.message}`);
    r.auth_user = 1;
    r.status = "removed";
  } catch (e) {
    r.status = "error"; r.error = (e as Error).message;
  }
  return json({ ok: r.status === "removed", result: r });
});
