// Tells the firm, once per breakage, that its Xero connection needs reconnecting.
//
// Loaded dynamically from `xero-token.ts` so the email renderer is only pulled in
// when a connection actually breaks, not on every Xero call.

import { queueTransactionalEmail } from "./queue-transactional-email.ts";

/**
 * Emails the firm's owner and admins that Xero must be reconnected.
 * `reauth_notified_at` guards against repeat sends: it is cleared whenever the
 * connection becomes healthy again, so the next breakage warns again.
 */
export async function notifyXeroConnectionLapsed(
  supabase: any,
  connectionId: string,
  reason: string,
): Promise<void> {
  try {
    const { data: conn } = await supabase
      .from("xero_connections")
      .select("id, tenant_id, xero_org_name, reauth_notified_at")
      .eq("id", connectionId)
      .maybeSingle();
    if (!conn || conn.reauth_notified_at) return;

    // Claim the notification first: two workers can fail at the same moment.
    const notifiedAt = new Date().toISOString();
    const { data: claimed } = await supabase
      .from("xero_connections")
      .update({ reauth_notified_at: notifiedAt })
      .eq("id", connectionId)
      .is("reauth_notified_at", null)
      .select("id");
    if (!claimed?.length) return;

    const { data: recipients } = await supabase
      .from("tenant_users")
      .select("email, display_name, role")
      .eq("tenant_id", conn.tenant_id)
      .eq("status", "active")
      .in("role", ["owner", "admin"]);

    for (const r of recipients ?? []) {
      if (!r.email) continue;
      await queueTransactionalEmail(supabase, {
        templateName: "xero-connection-lapsed",
        recipientEmail: r.email,
        templateData: {
          name: r.display_name ?? undefined,
          orgName: conn.xero_org_name ?? undefined,
          reason: reason.slice(0, 240),
        },
        idempotencyKey: `xero-lapsed:${connectionId}:${notifiedAt}:${r.email.toLowerCase()}`,
      });
    }
  } catch (e) {
    // A failed warning must never break the caller's Xero flow.
    console.error("[xero-lapse-notice] failed:", e);
  }
}
