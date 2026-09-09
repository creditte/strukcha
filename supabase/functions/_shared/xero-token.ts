// Single place where Xero access tokens are obtained and renewed.
//
// Xero refresh tokens are single-use: if two background runs renew the same
// connection at the same time, one of them burns the token and the connection
// dies permanently ("Refresh token has been consumed"). Every caller must go
// through `getXeroAccessToken` so renewals are serialised with a short database
// lease, and so a dead connection is recorded once instead of failing forever.

import { decryptToken, encryptToken } from "./crypto.ts";

/** Seconds of head-room before expiry that triggers a renewal. */
const RENEW_WINDOW_MS = 5 * 60 * 1000;
/** How long one worker may hold the renewal lease. */
const LEASE_MS = 45 * 1000;
/** How long a waiting worker will poll for someone else's renewal. */
const WAIT_TIMEOUT_MS = 40 * 1000;
const WAIT_POLL_MS = 1500;

export const XERO_REAUTH_CODE = "xero_reauthorization_required";

/** Thrown when only a fresh Xero authorisation can fix the problem. */
export class XeroReauthRequiredError extends Error {
  code = XERO_REAUTH_CODE;
  constructor(message = "Your Xero connection needs to be reconnected.") {
    super(message);
    this.name = "XeroReauthRequiredError";
  }
}

export interface XeroConnectionRow {
  id: string;
  access_token: string;
  refresh_token: string;
  expires_at: string;
  refresh_lock_until?: string | null;
  status?: string | null;
  [key: string]: unknown;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function readConnection(supabase: any, id: string): Promise<XeroConnectionRow> {
  const { data, error } = await supabase
    .from("xero_connections")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error || !data) throw new XeroReauthRequiredError("The Xero connection no longer exists.");
  return data as XeroConnectionRow;
}

function isFresh(row: XeroConnectionRow): boolean {
  const expires = new Date(row.expires_at).getTime();
  return Number.isFinite(expires) && expires - Date.now() > RENEW_WINDOW_MS;
}

/** Record that the connection can no longer be used without reconnecting. */
export async function markXeroConnectionInvalid(
  supabase: any,
  connectionId: string,
  reason: string,
): Promise<void> {
  await supabase
    .from("xero_connections")
    .update({
      status: "needs_reauth",
      last_error: reason.slice(0, 500),
      last_error_at: new Date().toISOString(),
      invalidated_at: new Date().toISOString(),
      refresh_lock_until: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", connectionId);
}

/** Clear a previous failure once Xero answers normally again. */
export async function markXeroConnectionHealthy(
  supabase: any,
  connectionId: string,
): Promise<void> {
  await supabase
    .from("xero_connections")
    .update({
      status: "active",
      last_error: null,
      last_error_at: null,
      invalidated_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", connectionId);
}

/** True when a Xero answer means "reconnect", not "retry". */
export function isXeroAuthFailure(status: number, body: string): boolean {
  if (status === 401) return true;
  if (status === 400 && /invalid_grant|consumed|revoked/i.test(body)) return true;
  return false;
}

async function claimLease(supabase: any, connectionId: string): Promise<boolean> {
  const nowIso = new Date().toISOString();
  const until = new Date(Date.now() + LEASE_MS).toISOString();
  const { data } = await supabase
    .from("xero_connections")
    .update({ refresh_lock_until: until })
    .eq("id", connectionId)
    .or(`refresh_lock_until.is.null,refresh_lock_until.lt.${nowIso}`)
    .select("id");
  return Array.isArray(data) && data.length > 0;
}

async function doRefresh(supabase: any, row: XeroConnectionRow): Promise<string> {
  const clientId = Deno.env.get("XERO_CLIENT_ID")!;
  const clientSecret = Deno.env.get("XERO_CLIENT_SECRET")!;
  const currentRefreshToken = await decryptToken(row.refresh_token);

  const res = await fetch("https://identity.xero.com/connect/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}`,
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: currentRefreshToken,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    // A rejected refresh token can never be recovered by retrying.
    if (isXeroAuthFailure(res.status, body) || res.status === 400) {
      await markXeroConnectionInvalid(
        supabase,
        row.id,
        `Xero rejected the stored authorisation (${res.status}).`,
      );
      throw new XeroReauthRequiredError();
    }
    await supabase
      .from("xero_connections")
      .update({ refresh_lock_until: null })
      .eq("id", row.id);
    throw new Error(`Couldn't renew the Xero connection (${res.status}). Please try again.`);
  }

  const tokens = await res.json();
  const nowIso = new Date().toISOString();
  await supabase
    .from("xero_connections")
    .update({
      access_token: await encryptToken(tokens.access_token),
      refresh_token: await encryptToken(tokens.refresh_token),
      expires_at: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
      last_refresh_at: nowIso,
      refresh_lock_until: null,
      status: "active",
      last_error: null,
      last_error_at: null,
      invalidated_at: null,
      updated_at: nowIso,
    })
    .eq("id", row.id);

  return tokens.access_token as string;
}

/**
 * Returns a usable Xero access token for this connection, renewing it if needed.
 * Throws `XeroReauthRequiredError` when the firm must reconnect Xero.
 */
export async function getXeroAccessToken(
  supabase: any,
  connection: XeroConnectionRow,
): Promise<string> {
  let row = connection;

  if (row.status === "needs_reauth") throw new XeroReauthRequiredError();
  if (isFresh(row)) return await decryptToken(row.access_token);

  // Always renew from the newest stored token, not the caller's snapshot.
  row = await readConnection(supabase, row.id);
  if (row.status === "needs_reauth") throw new XeroReauthRequiredError();
  if (isFresh(row)) return await decryptToken(row.access_token);

  if (await claimLease(supabase, row.id)) {
    const latest = await readConnection(supabase, row.id);
    if (isFresh(latest)) {
      await supabase
        .from("xero_connections")
        .update({ refresh_lock_until: null })
        .eq("id", row.id);
      return await decryptToken(latest.access_token);
    }
    return await doRefresh(supabase, latest);
  }

  // Someone else is renewing — wait for their result instead of burning the token.
  const deadline = Date.now() + WAIT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await sleep(WAIT_POLL_MS);
    const latest = await readConnection(supabase, row.id);
    if (latest.status === "needs_reauth") throw new XeroReauthRequiredError();
    if (isFresh(latest)) return await decryptToken(latest.access_token);
  }
  throw new Error("The Xero connection is being renewed. Please try again in a moment.");
}

/** Decrypted tokens for one-off calls such as disconnecting. */
export async function decryptXeroTokens(
  row: { access_token: string | null; refresh_token: string | null },
): Promise<{ accessToken: string | null; refreshToken: string | null }> {
  return {
    accessToken: row.access_token ? await decryptToken(row.access_token) : null,
    refreshToken: row.refresh_token ? await decryptToken(row.refresh_token) : null,
  };
}
