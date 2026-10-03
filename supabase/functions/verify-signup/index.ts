import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeadersFor } from "../_shared/cors.ts";
import {
  CODE_MAX_ATTEMPTS, CODE_TTL_MINUTES, GENERIC_CODE_ERROR, GENERIC_RESEND_RESPONSE, RATE_LIMITED_ERROR, SIGNUP_LIMITS,
  clientAddress, generateCode, hashKey, normaliseEmail, withinLimits,
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
    const { email: rawEmail, code, action } = await req.json();
    const email = normaliseEmail(rawEmail);
    if (!email) return json({ error: "Email is required" }, 400);

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );
    const emailKey = await hashKey("email", email);
    const clientKey = await hashKey("client", clientAddress(req.headers));

    // ── RESEND ──────────────────────────────────────────────────────
    if (action === "resend") {
      const allowed = await withinLimits(supabaseAdmin, [
        { bucket: "resend_cooldown", key: emailKey, ...SIGNUP_LIMITS.resendCooldown },
        { bucket: "resend_email", key: emailKey, ...SIGNUP_LIMITS.resendPerEmail },
        { bucket: "resend_client", key: clientKey, ...SIGNUP_LIMITS.resendPerClient },
      ]);
      if (!allowed) return json({ error: RATE_LIMITED_ERROR });

      const { data: verRow } = await supabaseAdmin
        .from("signup_verifications")
        .select("user_id")
        .eq("email", email)
        .eq("used", false)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      // Same response whether or not there is a pending sign-up.
      if (!verRow) return json({ ...GENERIC_RESEND_RESPONSE });

      await supabaseAdmin.from("signup_verifications").update({ used: true }).eq("email", email).eq("used", false);
      const newCode = generateCode();
      const expiresAt = new Date(Date.now() + CODE_TTL_MINUTES * 60 * 1000).toISOString();
      await supabaseAdmin.from("signup_verifications").insert({
        user_id: verRow.user_id, email, code: newCode, expires_at: expiresAt,
      });
      try {
        await sendViaSmtp2go(
          email,
          `Verify your strukcha account — ${newCode}`,
          renderVerificationHtml(newCode),
          `Your strukcha verification code is: ${newCode}. It expires in ${CODE_TTL_MINUTES} minutes.`
        );
      } catch (sendErr) {
        console.error("[VerifySignup] Failed to send email:", (sendErr as Error)?.message);
      }
      return json({ ...GENERIC_RESEND_RESPONSE });
    }

    // ── VERIFY ──────────────────────────────────────────────────────
    if (!code || typeof code !== "string" || !/^\d{6}$/.test(code)) {
      return json({ error: "Invalid code format" }, 400);
    }
    const allowed = await withinLimits(supabaseAdmin, [
      { bucket: "verify_email", key: emailKey, ...SIGNUP_LIMITS.verifyPerEmail },
      { bucket: "verify_client", key: clientKey, ...SIGNUP_LIMITS.verifyPerClient },
    ]);
    if (!allowed) return json({ error: RATE_LIMITED_ERROR });

    // One-time, attempt-limited check done atomically in the database.
    const { data: userId, error: checkErr } = await supabaseAdmin.rpc("signup_check_code", {
      _email: email, _code: code, _max_attempts: CODE_MAX_ATTEMPTS,
    });
    if (checkErr) {
      console.error("[VerifySignup] code check failed:", checkErr.message);
      return json({ error: "Verification failed" }, 500);
    }
    if (!userId) return json({ error: GENERIC_CODE_ERROR });

    const { data: existingUser, error: getUserErr } = await supabaseAdmin.auth.admin.getUserById(userId);
    if (getUserErr || !existingUser.user) {
      console.error("[VerifySignup] Failed to load user:", getUserErr?.message);
      return json({ error: "Failed to verify email" }, 500);
    }

    const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(userId, {
      email_confirm: true,
      user_metadata: { ...(existingUser.user.user_metadata ?? {}), signup_source: "self_service" },
    });
    if (updateError) {
      console.error("[VerifySignup] Failed to confirm email:", updateError.message);
      return json({ error: "Failed to verify email" }, 500);
    }

    // Self-signup users already chose a password; never send them to /setup-password.
    await supabaseAdmin
      .from("profiles")
      .update({ onboarding_complete: true, password_set: true, updated_at: new Date().toISOString() })
      .eq("user_id", userId);

    // Welcome email is sent by stripe-webhooks once the trial starts.
    return json({ ok: true, verified: true, needsPayment: true });
  } catch (err: any) {
    console.error("[verify-signup] Error:", err?.message);
    return json({ error: "Verification failed" }, 500);
  }
});
