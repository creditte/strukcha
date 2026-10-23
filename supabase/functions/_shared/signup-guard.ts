// Abuse controls and non-destructive decisions for app-managed self sign-up.
// Pure helpers (testable in Vitest) plus a thin wrapper over signup_rate_hit.

export const SIGNUP_LIMITS = {
  signupPerEmail: { max: 5, windowSeconds: 3600 },
  signupPerClient: { max: 20, windowSeconds: 3600 },
  verifyPerEmail: { max: 10, windowSeconds: 900 },
  verifyPerClient: { max: 30, windowSeconds: 900 },
  resendCooldown: { max: 1, windowSeconds: 60 },
  resendPerEmail: { max: 5, windowSeconds: 3600 },
  resendPerClient: { max: 20, windowSeconds: 3600 },
} as const;

export const CODE_TTL_MINUTES = 10;
export const CODE_MAX_ATTEMPTS = 5;

/** Same body for every accepted sign-up, whether or not the email is new. */
export const GENERIC_SIGNUP_RESPONSE = Object.freeze({ ok: true, needsVerification: true });
export const GENERIC_RESEND_RESPONSE = Object.freeze({ ok: true });
export const GENERIC_CODE_ERROR = "That code is invalid or has expired. Request a new code and try again.";
export const RATE_LIMITED_ERROR = "Too many attempts. Please wait a few minutes and try again.";

export function normaliseEmail(email: unknown): string | null {
  if (typeof email !== "string") return null;
  const e = email.trim().toLowerCase();
  if (e.length < 3 || e.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) return null;
  return e;
}

/** First client address from proxy headers; never stored raw. */
export function clientAddress(headers: Headers): string {
  const fwd = headers.get("x-forwarded-for") ?? "";
  const first = fwd.split(",")[0]?.trim();
  return first || headers.get("cf-connecting-ip") || headers.get("x-real-ip") || "unknown";
}

/** Privacy-safe key: truncated SHA-256 with a purpose prefix. */
export async function hashKey(purpose: string, value: string): Promise<string> {
  const data = new TextEncoder().encode(`strukcha-signup:${purpose}:${value}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest)).slice(0, 16).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Uniform 6-digit code from a CSPRNG. */
export function generateCode(): string {
  const buf = new Uint32Array(1);
  let n: number;
  do {
    crypto.getRandomValues(buf);
    n = buf[0];
  } while (n >= 4_294_000_000); // drop the biased tail
  return String(100000 + (n % 900000));
}

export interface PriorSignupState {
  /** Any team-member row for this email, in any firm. */
  hasMembership: boolean;
  /** Pending (unaccepted) invitation for this email. */
  hasInvitation: boolean;
  /** The membership is an owner of a never-paid, never-active firm whose login was never confirmed. */
  pendingUnverifiedUserId: string | null;
}

export type SignupDecision =
  | { kind: "create" }
  | { kind: "resend_pending"; userId: string }
  | { kind: "silent" };

/**
 * Decides what a sign-up request may do. There is deliberately no "delete" or
 * "replace" outcome: an existing firm, account or invitation is never altered.
 */
export function decideSignup(prior: PriorSignupState): SignupDecision {
  if (prior.pendingUnverifiedUserId && !prior.hasInvitation) {
    return { kind: "resend_pending", userId: prior.pendingUnverifiedUserId };
  }
  if (prior.hasMembership || prior.hasInvitation) return { kind: "silent" };
  return { kind: "create" };
}

export interface TenantShellFacts {
  memberCount: number;
  memberRole: string | null;
  authEmailConfirmed: boolean;
  authEverSignedIn: boolean;
  stripeSubscriptionId: string | null;
  paymentMethodCaptured: boolean;
  subscriptionStatus: string | null;
  accessEnabled: boolean | null;
  trialUsedAt: string | null;
  paymentSetupCompletedAt: string | null;
}

/** True only for an unverified, unpaid, never-active, single-owner sign-up still waiting for its code. */
export function isPendingUnverifiedShell(f: TenantShellFacts): boolean {
  return (
    f.memberCount === 1 &&
    f.memberRole === "owner" &&
    !f.authEmailConfirmed &&
    !f.authEverSignedIn &&
    !f.stripeSubscriptionId &&
    !f.paymentMethodCaptured &&
    (f.subscriptionStatus ?? "incomplete") === "incomplete" &&
    f.accessEnabled !== true &&
    !f.trialUsedAt &&
    !f.paymentSetupCompletedAt
  );
}

// deno-lint-ignore no-explicit-any
type Rpc = { rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: any; error: any }> };

/** Records a hit per limit; returns false if any limit is exceeded or the check fails (fail closed). */
export async function withinLimits(
  db: Rpc,
  checks: Array<{ bucket: string; key: string; max: number; windowSeconds: number }>,
): Promise<boolean> {
  for (const c of checks) {
    const { data, error } = await db.rpc("signup_rate_hit", {
      _bucket: c.bucket,
      _key_hash: c.key,
      _max: c.max,
      _window_seconds: c.windowSeconds,
    });
    if (error || data !== true) return false;
  }
  return true;
}
