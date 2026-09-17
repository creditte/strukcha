import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { corsHeadersFor } from "../_shared/cors.ts";
import { queueTransactionalEmail } from "../_shared/queue-transactional-email.ts";

// Removing an authenticator factor is a security downgrade, so it requires
// step-up re-authentication: the caller must re-enter their account password.
Deno.serve(async (req) => {
  const corsHeaders = corsHeadersFor(req);
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Unauthorized" }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: userErr } = await userClient.auth.getUser();
    if (userErr || !user?.email) return json({ error: "Unauthorized" }, 401);

    let password = "";
    try {
      const body = await req.json();
      password = typeof body?.password === "string" ? body.password : "";
    } catch {
      password = "";
    }

    if (!password) {
      return json(
        { error: "Password confirmation required", code: "step_up_required" },
        400,
      );
    }

    // Step-up check in an isolated client so the caller's session is untouched.
    const stepUpClient = createClient(supabaseUrl, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { error: stepUpErr } = await stepUpClient.auth.signInWithPassword({
      email: user.email,
      password,
    });
    if (stepUpErr) {
      return json({ error: "Incorrect password", code: "step_up_failed" }, 403);
    }
    await stepUpClient.auth.signOut();

    const adminHeaders = {
      Authorization: `Bearer ${serviceRoleKey}`,
      apikey: serviceRoleKey,
    };

    const listRes = await fetch(
      `${supabaseUrl}/auth/v1/admin/users/${user.id}/factors`,
      { headers: adminHeaders },
    );
    const factors = await listRes.json();
    const allFactors = Array.isArray(factors) ? factors : (factors?.factors ?? []);
    const totp = allFactors.filter((f: any) => f.factor_type === "totp");

    let removed = 0;
    for (const f of totp) {
      const delRes = await fetch(
        `${supabaseUrl}/auth/v1/admin/users/${user.id}/factors/${f.id}`,
        { method: "DELETE", headers: adminHeaders },
      );
      if (!delRes.ok) {
        const err = await delRes.text();
        console.error("[reset-totp] delete factor failed", err);
        return json({ error: "Could not remove the existing authenticator" }, 400);
      }
      removed++;
    }

    const adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    if (removed > 0) {
      const { data: profile } = await adminClient
        .from("profiles")
        .select("tenant_id, full_name")
        .eq("user_id", user.id)
        .maybeSingle();

      if (profile?.tenant_id) {
        await adminClient.from("audit_log").insert({
          tenant_id: profile.tenant_id,
          user_id: user.id,
          action: "mfa_authenticator_reset",
          entity_type: "user",
          entity_id: user.id,
          after_state: { removed_factors: removed, step_up: "password" },
        });
      }

      try {
        await queueTransactionalEmail(adminClient, {
          templateName: "account-access-updated",
          recipientEmail: user.email,
          templateData: {
            name: profile?.full_name ?? undefined,
            summary: "Your authenticator app was removed so a new one can be set up.",
          },
          idempotencyKey: `mfa-reset-${user.id}-${Date.now()}`,
        });
      } catch (mailErr) {
        console.error("[reset-totp] notification email failed", mailErr);
      }
    }

    return json({ ok: true, removed });
  } catch (err: any) {
    console.error("[reset-totp] error", err);
    return json({ error: "Could not reset the authenticator" }, 400);
  }
});
