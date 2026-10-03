import { describe, it, expect } from "vitest";
import {
  decideSignup, isPendingUnverifiedShell, normaliseEmail, clientAddress, hashKey, generateCode,
  GENERIC_SIGNUP_RESPONSE, SIGNUP_LIMITS, withinLimits, type TenantShellFacts,
} from "../../supabase/functions/_shared/signup-guard";
import {
  canonicalFrontendFrom, resolveFrontendFrom, normaliseOrigin, frontendLink, CANONICAL_FALLBACK,
} from "../../supabase/functions/_shared/frontend-url";

const shell: TenantShellFacts = {
  memberCount: 1, memberRole: "owner", authEmailConfirmed: false, authEverSignedIn: false,
  stripeSubscriptionId: null, paymentMethodCaptured: false, subscriptionStatus: "incomplete",
  accessEnabled: false, trialUsedAt: null, paymentSetupCompletedAt: null,
};

describe("sign-up never deletes or alters an existing firm", () => {
  it("has no destructive outcome for any combination", () => {
    for (const hasMembership of [true, false]) for (const hasInvitation of [true, false])
      for (const pending of [null, "u1"]) {
        const d = decideSignup({ hasMembership, hasInvitation, pendingUnverifiedUserId: pending });
        expect(["create", "resend_pending", "silent"]).toContain(d.kind);
      }
  });
  it("existing member email is silent (no create, no change)", () => {
    expect(decideSignup({ hasMembership: true, hasInvitation: false, pendingUnverifiedUserId: null }).kind).toBe("silent");
  });
  it("invited email is silent even if a pending shell exists", () => {
    expect(decideSignup({ hasMembership: true, hasInvitation: true, pendingUnverifiedUserId: "u1" }).kind).toBe("silent");
    expect(decideSignup({ hasMembership: false, hasInvitation: true, pendingUnverifiedUserId: null }).kind).toBe("silent");
  });
  it("repeated sign-up on own unfinished shell only re-sends a code", () => {
    expect(decideSignup({ hasMembership: true, hasInvitation: false, pendingUnverifiedUserId: "u1" }))
      .toEqual({ kind: "resend_pending", userId: "u1" });
  });
  it("new email creates", () => {
    expect(decideSignup({ hasMembership: false, hasInvitation: false, pendingUnverifiedUserId: null }).kind).toBe("create");
  });
  it("shell test rejects any sign of real use", () => {
    expect(isPendingUnverifiedShell(shell)).toBe(true);
    const variants: Partial<TenantShellFacts>[] = [
      { memberCount: 2 }, { memberRole: "admin" }, { authEmailConfirmed: true }, { authEverSignedIn: true },
      { stripeSubscriptionId: "sub_1" }, { paymentMethodCaptured: true }, { subscriptionStatus: "active" },
      { accessEnabled: true }, { trialUsedAt: "2026-01-01" }, { paymentSetupCompletedAt: "2026-01-01" },
    ];
    for (const v of variants) expect(isPendingUnverifiedShell({ ...shell, ...v })).toBe(false);
  });
  it("generic response is identical for new and existing emails", () => {
    expect(GENERIC_SIGNUP_RESPONSE).toEqual({ ok: true, needsVerification: true });
    expect(Object.keys(GENERIC_SIGNUP_RESPONSE)).not.toContain("userId");
  });
});

describe("abuse controls", () => {
  it("normalises email", () => {
    expect(normaliseEmail("  A@B.Co ")).toBe("a@b.co");
    expect(normaliseEmail("nope")).toBeNull();
    expect(normaliseEmail(42)).toBeNull();
  });
  it("uses first forwarded address and hashes it", async () => {
    const h = new Headers({ "x-forwarded-for": "1.2.3.4, 10.0.0.1" });
    expect(clientAddress(h)).toBe("1.2.3.4");
    const k = await hashKey("client", "1.2.3.4");
    expect(k).toMatch(/^[0-9a-f]{32}$/);
    expect(k).not.toContain("1.2.3.4");
    expect(await hashKey("email", "1.2.3.4")).not.toBe(k);
  });
  it("codes are 6 digits", () => {
    for (let i = 0; i < 200; i++) expect(generateCode()).toMatch(/^[1-9]\d{5}$/);
  });
  it("limits are bounded", () => {
    expect(SIGNUP_LIMITS.resendCooldown.max).toBe(1);
    expect(SIGNUP_LIMITS.signupPerEmail.max).toBeLessThanOrEqual(10);
  });
  it("rate check fails closed and stops at first refusal", async () => {
    const calls: string[] = [];
    const db = (answer: unknown, err: unknown = null) => ({
      rpc: async (_f: string, a: Record<string, unknown>) => { calls.push(a._bucket as string); return { data: answer, error: err }; },
    });
    const checks = [{ bucket: "a", key: "k", max: 1, windowSeconds: 60 }, { bucket: "b", key: "k", max: 1, windowSeconds: 60 }];
    expect(await withinLimits(db(true), checks)).toBe(true);
    calls.length = 0;
    expect(await withinLimits(db(false), checks)).toBe(false);
    expect(calls).toEqual(["a"]);
    expect(await withinLimits(db(null, { message: "x" }), checks)).toBe(false);
  });
});

describe("frontend URL handling", () => {
  it("uses a valid configured https origin", () => {
    expect(canonicalFrontendFrom("https://www.strukcha.app/")).toBe("https://www.strukcha.app");
    expect(canonicalFrontendFrom("https://app.example.com/path?x=1")).toBe("https://app.example.com");
  });
  it("falls back when missing, invalid, plain http or localhost in cloud", () => {
    for (const v of [undefined, "", "not a url", "http://evil.com", "http://localhost:8080", "javascript:alert(1)"])
      expect(canonicalFrontendFrom(v)).toBe(CANONICAL_FALLBACK);
    expect(canonicalFrontendFrom("http://localhost:8080", true)).toBe("http://localhost:8080");
  });
  it("never reflects arbitrary origins", () => {
    expect(resolveFrontendFrom("https://evil.lovable.app", "https://www.strukcha.app")).toBe("https://www.strukcha.app");
    expect(resolveFrontendFrom("https://strukcha.app.evil.com", undefined)).toBe(CANONICAL_FALLBACK);
    expect(resolveFrontendFrom(null, undefined)).toBe(CANONICAL_FALLBACK);
  });
  it("accepts allow-listed origins", () => {
    expect(resolveFrontendFrom("https://strukcha-dev.lovable.app/x", "https://www.strukcha.app")).toBe("https://strukcha-dev.lovable.app");
    expect(resolveFrontendFrom("https://app.example.com", "https://app.example.com")).toBe("https://app.example.com");
  });
  it("no stale project address anywhere", () => {
    expect(CANONICAL_FALLBACK).not.toContain("link-map-insight");
    expect(normaliseOrigin("https://link-map-insight.lovable.app")).toBeTruthy();
    expect(resolveFrontendFrom("https://link-map-insight.lovable.app", undefined)).toBe(CANONICAL_FALLBACK);
  });
  it("builds clean links", () => {
    expect(frontendLink("https://www.strukcha.app", "reset-password")).toBe("https://www.strukcha.app/reset-password");
  });
});
