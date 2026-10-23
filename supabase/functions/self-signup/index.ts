import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { STRIPE_API_VERSION } from "../_shared/stripe-subscription.ts";
import { stripeVar, stripeMode } from "../_shared/stripe-env.ts";
import { TRIAL_GROUP_LIMIT } from "../_shared/stripe-plans.ts";
import { corsHeadersFor } from "../_shared/cors.ts";
import {
  CODE_TTL_MINUTES, GENERIC_SIGNUP_RESPONSE, RATE_LIMITED_ERROR, SIGNUP_LIMITS,
  clientAddress, decideSignup, generateCode, hashKey, isPendingUnverifiedShell, normaliseEmail, withinLimits,
} from "../_shared/signup-guard.ts";



const SITE_NAME = "strukcha";
const FROM_DOMAIN = "strukcha.app";

function renderVerificationHtml(code: string): string {
  return `<div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;padding:32px">
<h2 style="margin-bottom:16px;color:#18181b">Verify your email</h2>
<p style="color:#52525b;font-size:15px">Enter this code to complete your strukcha signup:</p>
<p style="font-size:36px;letter-spacing:10px;font-weight:bold;text-align:center;background:#f4f4f5;padding:16px;border-radius:8px;margin:24px 0;color:#18181b">${code}</p>
<p style="color:#71717a;font-size:14px">This code expires in 10 minutes. If you didn't sign up for strukcha, ignore this email.</p>
</div>`;
}

async function sendViaSmtp2go(to: string, subject: string, html: string, text?: string): Promise<void> {
  const apiKey = Deno.env.get("SMTP2GO_API_KEY");
  if (!apiKey) throw new Error("SMTP2GO_API_KEY not configured");

  const response = await fetch("https://api.smtp2go.com/v3/email/send", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_key: apiKey,
      sender: `${SITE_NAME} <no-reply@${FROM_DOMAIN}>`,
      to: [to],
      subject,
      html_body: html,
      text_body: text || undefined,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`smtp2go error ${response.status}: ${body}`);
  }
}

Deno.serve(async (req) => {
  const corsHeaders = corsHeadersFor(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const json = (body: Record<string, unknown>, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  try {
    const { fullName, email, password, firmName, selectedPlan, selectedBilling } = await req.json();
    const normalisedEmail = normaliseEmail(email);
    if (!normalisedEmail || !password || !firmName || !fullName) {
      return json({ error: "Missing required fields" }, 400);
    }
    if (typeof password !== "string" || password.length < 6 || password.length > 200) {
      return json({ error: "Password must be at least 6 characters." }, 400);
    }
    const plan = selectedPlan || "pro";
    const billing = selectedBilling || "monthly";

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Abuse controls: per email and per (hashed) client address. Fail closed.
    const emailKey = await hashKey("email", normalisedEmail);
    const clientKey = await hashKey("client", clientAddress(req.headers));
    const allowed = await withinLimits(supabaseAdmin, [
      { bucket: "signup_email", key: emailKey, ...SIGNUP_LIMITS.signupPerEmail },
      { bucket: "signup_client", key: clientKey, ...SIGNUP_LIMITS.signupPerClient },
    ]);
    if (!allowed) return json({ error: RATE_LIMITED_ERROR }, 200);

    // Never delete or replace an earlier sign-up, firm, account or invitation.
    // Existing emails get the same response as new ones (no enumeration).
    const { data: memberships } = await supabaseAdmin
      .from("tenant_users")
      .select("id, tenant_id, auth_user_id, role")
      .eq("email", normalisedEmail)
      .limit(5);
    const { count: inviteCount } = await supabaseAdmin
      .from("invitations")
      .select("id", { count: "exact", head: true })
      .eq("email", normalisedEmail)
      .is("accepted_at", null);

    let pendingUnverifiedUserId: string | null = null;
    if (memberships && memberships.length === 1 && memberships[0].auth_user_id) {
      const m = memberships[0];
      const [{ data: t }, { count: memberCount }, { data: au }] = await Promise.all([
        supabaseAdmin.from("tenants")
          .select("stripe_subscription_id, payment_method_captured, subscription_status, access_enabled, trial_used_at, payment_setup_completed_at")
          .eq("id", m.tenant_id).maybeSingle(),
        supabaseAdmin.from("tenant_users").select("id", { count: "exact", head: true }).eq("tenant_id", m.tenant_id),
        supabaseAdmin.auth.admin.getUserById(m.auth_user_id),
      ]);
      if (t && au?.user && isPendingUnverifiedShell({
        memberCount: memberCount ?? 0,
        memberRole: m.role,
        authEmailConfirmed: !!au.user.email_confirmed_at,
        authEverSignedIn: !!au.user.last_sign_in_at,
        stripeSubscriptionId: t.stripe_subscription_id,
        paymentMethodCaptured: t.payment_method_captured === true,
        subscriptionStatus: t.subscription_status,
        accessEnabled: t.access_enabled,
        trialUsedAt: t.trial_used_at,
        paymentSetupCompletedAt: t.payment_setup_completed_at,
      })) {
        pendingUnverifiedUserId = m.auth_user_id;
      }
    }

    const decision = decideSignup({
      hasMembership: (memberships?.length ?? 0) > 0,
      hasInvitation: (inviteCount ?? 0) > 0,
      pendingUnverifiedUserId,
    });

    if (decision.kind === "silent") {
      console.log("[Signup] email already in use; returning generic response");
      return json({ ...GENERIC_SIGNUP_RESPONSE });
    }
    if (decision.kind === "resend_pending") {
      // Re-send a fresh code to the existing unfinished sign-up. Its password and firm are unchanged.
      await issueCode(supabaseAdmin, decision.userId, normalisedEmail);
      return json({ ...GENERIC_SIGNUP_RESPONSE });
    }

    // 1. Create the auth user (NOT confirmed)
    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email: normalisedEmail,
      password,
      email_confirm: false,
      user_metadata: { full_name: fullName, signup_source: "self_service" },
    });

    if (authError || !authData?.user) {
      // Includes "already registered": same response, nothing modified.
      console.log("[Signup] createUser refused:", authError?.message);
      return json({ ...GENERIC_SIGNUP_RESPONSE });
    }

    const userId = authData.user.id;
    const now = new Date();

    // 2. Create the tenant — no trial yet; Stripe owns the trial after Checkout.
    const { data: tenant, error: tenantError } = await supabaseAdmin
      .from("tenants")
      .insert({
        name: String(firmName).toLowerCase().replace(/\s+/g, "-"),
        firm_name: firmName,
        subscription_status: "incomplete",
        subscription_plan: plan,
        selected_plan: plan,
        diagram_limit: TRIAL_GROUP_LIMIT,
        payment_method_captured: false,
        access_enabled: false,
        access_locked_reason: "payment_method_required",
      })
      .select("id")
      .single();

    if (tenantError) throw tenantError;

    const stripeKey = stripeVar("STRIPE_SECRET_KEY");
    if (stripeKey) {
      try {
        const stripe = new Stripe(stripeKey, { apiVersion: STRIPE_API_VERSION });
        const customer = await stripe.customers.create({
          email: normalisedEmail,
          metadata: { workspace_id: tenant.id, owner_user_id: userId },
        });
        await supabaseAdmin.from("tenants").update({
          stripe_customer_id: customer.id,
          stripe_mode: stripeMode(),
        }).eq("id", tenant.id);
        console.log(`[Signup] Stripe customer ${customer.id} created (awaiting payment method)`);
      } catch (stripeErr: any) {
        console.error("[Signup] Stripe setup failed:", stripeErr.message);
      }
    }

    // 3. Owner team-member row
    const { error: tuError } = await supabaseAdmin.from("tenant_users").insert({
      tenant_id: tenant.id,
      email: normalisedEmail,
      display_name: fullName,
      role: "owner",
      status: "active",
      auth_user_id: userId,
      accepted_at: now.toISOString(),
      invited_at: now.toISOString(),
      last_invited_at: now.toISOString(),
    });
    if (tuError) throw tuError;

    // 4. Profile
    const { error: profileError } = await supabaseAdmin.from("profiles")
      .upsert({
        user_id: userId,
        tenant_id: tenant.id,
        full_name: fullName,
        status: "active",
        onboarding_complete: true,
        password_set: true,
        selected_plan: plan,
        selected_billing: billing,
      }, { onConflict: "user_id" });
    if (profileError) throw profileError;

    // 5. Role
    const { error: roleError } = await supabaseAdmin.from("user_roles").insert({ user_id: userId, role: "admin" });
    if (roleError) throw roleError;

    // 6. Verification code
    await issueCode(supabaseAdmin, userId, normalisedEmail);

    return json({ ...GENERIC_SIGNUP_RESPONSE });
  } catch (err: any) {
    console.error("self-signup error:", err);
    return json({ error: "Sign-up could not be completed. Please try again." }, 500);
  }
});

// deno-lint-ignore no-explicit-any
async function issueCode(db: any, userId: string, email: string): Promise<void> {
  await db.from("signup_verifications").update({ used: true }).eq("email", email).eq("used", false);
  const code = generateCode();
  const expiresAt = new Date(Date.now() + CODE_TTL_MINUTES * 60 * 1000).toISOString();
  await db.from("signup_verifications").insert({ user_id: userId, email, code, expires_at: expiresAt });
  try {
    await sendViaSmtp2go(
      email,
      `Verify your strukcha account — ${code}`,
      renderVerificationHtml(code),
      `Your strukcha verification code is: ${code}. It expires in ${CODE_TTL_MINUTES} minutes.`,
    );
    console.log("[Signup] verification email sent");
  } catch (sendErr) {
    console.error("[Signup] Failed to send verification email:", (sendErr as Error)?.message);
  }
}
