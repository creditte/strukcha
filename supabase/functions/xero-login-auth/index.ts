import { safeFrontend } from "../_shared/safe-redirect.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeadersFor } from "../_shared/cors.ts";


// Register this redirect URI on your Xero app: {SUPABASE_URL}/functions/v1/xero-login-callback

Deno.serve(async (req) => {
  const corsHeaders = corsHeadersFor(req);
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const clientId = Deno.env.get("XERO_CLIENT_ID");
    if (!clientId) {
      return new Response(JSON.stringify({ error: "Xero not configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let callerOrigin: string | undefined;
    // Sign-in always uses basic Xero access so every Xero user can sign in.
    // Practice Manager is connected separately from onboarding or Settings.
    const connectionType: "practice_manager" | "standard" = "standard";

    try {
      const body = await req.json();
      callerOrigin = typeof body.origin === "string" ? body.origin : undefined;
    } catch {
      /* no body */
    }


    const redirectUri = `${Deno.env.get("SUPABASE_URL")}/functions/v1/xero-login-callback`;
    const csrfToken = crypto.randomUUID();
    const serviceClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { error: insertErr } = await serviceClient.from("xero_oauth_states").insert({
      flow: "login",
      csrf_token: csrfToken,
    });

    if (insertErr) {
      console.error("[xero-login-auth] insert state failed:", insertErr);
      return new Response(JSON.stringify({ error: "Failed to start Xero sign-in" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const frontendOrigin = callerOrigin ||
      Deno.env.get("FRONTEND_URL") ||
      "https://link-map-insight.lovable.app";

    const state = btoa(JSON.stringify({
      csrf: csrfToken,
      origin: safeFrontend(frontendOrigin),
      flow: "login",
      connection_type: connectionType,
    }));

    const scopes = connectionType === "practice_manager"
      ? "openid profile email offline_access practicemanager.client.read"

      : "openid profile email offline_access accounting.contacts.read";

    const authUrl =
      `https://login.xero.com/identity/connect/authorize?` +
      `response_type=code&` +
      `client_id=${encodeURIComponent(clientId)}&` +
      `redirect_uri=${encodeURIComponent(redirectUri)}&` +
      `scope=${encodeURIComponent(scopes)}&` +
      `state=${encodeURIComponent(state)}&` +
      `prompt=consent`;

    return new Response(JSON.stringify({ url: authUrl }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("xero-login-auth error:", err);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
