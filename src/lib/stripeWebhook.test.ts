// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import Stripe from "stripe";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { verifyStripeWebhook, WebhookConfigurationError, WebhookSignatureError } from "../../supabase/functions/_shared/stripe-webhook-verification";

// Fixed test-only fixtures, not credentials for any Stripe account.
const secrets = { test: "test-only-sandbox-signing-fixture", live: "test-only-live-signing-fixture" };
const cryptoProvider = Stripe.createSubtleCryptoProvider();
const construct = (body: string, signature: string, secret: string) =>
  Stripe.webhooks.constructEventAsync(body, signature, secret, undefined, cryptoProvider);
const eventBody = (type = "invoice.paid", livemode = false, object: unknown = { customer: "cus_fictional" }) =>
  JSON.stringify({ id: "evt_fictional", type, livemode, data: { object } });
const sign = (payload: string, secret = secrets.test) => Stripe.webhooks.generateTestHeaderString({ payload, secret });

describe("Stripe raw-body mode-bound verification", () => {
  it.each([false, true])("accepts matching signature, live=%s", async (live) => {
    const body = eventBody("invoice.paid", live);
    const event = await verifyStripeWebhook(body, sign(body, live ? secrets.live : secrets.test), secrets, construct);
    expect(event.livemode).toBe(live);
  });
  it("rejects invalid signatures", async () => {
    const body = eventBody();
    await expect(verifyStripeWebhook(body, sign(body, "invalid-fixture"), secrets, construct)).rejects.toBeInstanceOf(WebhookSignatureError);
  });
  it("rejects tampered raw bodies", async () => {
    const body = eventBody();
    await expect(verifyStripeWebhook(body + " ", sign(body), secrets, construct)).rejects.toBeInstanceOf(WebhookSignatureError);
  });
  it("rejects live payloads signed with the sandbox secret", async () => {
    const body = eventBody("invoice.paid", true);
    await expect(verifyStripeWebhook(body, sign(body), secrets, construct)).rejects.toBeInstanceOf(WebhookSignatureError);
  });
  it("rejects expired signatures", async () => {
    const body = eventBody();
    const signature = Stripe.webhooks.generateTestHeaderString({ payload: body, secret: secrets.test, timestamp: Math.floor(Date.now() / 1000) - 600 });
    await expect(verifyStripeWebhook(body, signature, secrets, construct)).rejects.toBeInstanceOf(WebhookSignatureError);
  });
  it("fails closed without secrets", async () => {
    await expect(verifyStripeWebhook(eventBody(), "bad", {}, construct)).rejects.toBeInstanceOf(WebhookConfigurationError);
  });
});

// Execute the real Deno entrypoint with only its imports/environment substituted.
// This avoids Vite resolving Deno's https/npm imports while testing the actual handler.
const source = readFileSync(new URL("../../supabase/functions/stripe-webhooks/index.ts", import.meta.url), "utf8")
  .replace(/^import[\s\S]*?;\s*/gm, "");
const javascript = ts.transpile(source, { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None });

function harness(options: { mode?: "test" | "live"; status?: string; processedAt?: string; lookupError?: boolean; claimError?: boolean; lostClaim?: boolean; tenantError?: boolean; completionError?: boolean; stripeError?: boolean; emailError?: boolean } = {}) {
  const rows = new Map<string, any>();
  if (options.status) rows.set("evt_fictional", { id: "evt_fictional", status: options.status, attempts: 1, processed_at: options.processedAt ?? new Date().toISOString() });
  const subscription = { id: "sub_fictional", customer: "cus_fictional", metadata: { workspace_id: "firm_fictional" }, status: "active", items: { data: [] } };
  const stripe = { subscriptions: { retrieve: vi.fn(async () => { if (options.stripeError) throw new Error("Stripe unavailable"); return subscription; }), update: vi.fn(async () => subscription) } };
  const tenantWrites: any[] = [];
  const email = vi.fn(async () => { if (options.emailError) throw new Error("Email unavailable"); });
  const db = { from: vi.fn((table: string) => {
    let operation = "select", payload: any, shouldThrow = false;
    const filters: Record<string, any> = {};
    const result = () => {
      const fail = (message: string, code = "XX000") => { if (shouldThrow) throw new Error(message); return { data: null, error: { message, code } }; };
      if (table === "tenants") {
        if (options.tenantError) return fail("Tenant database unavailable");
        if (operation === "update") { tenantWrites.push(payload); return { data: null, error: null }; }
        return { data: { id: "firm_fictional", firm_name: "Fictional firm", subscription_plan: "pro", selected_plan: "pro" }, error: null };
      }
      if (table !== "stripe_webhook_events") throw new Error(`Unexpected table ${table}`);
      if (operation === "select") {
        if (options.lookupError) return fail("Event lookup unavailable");
        return { data: rows.get(filters.id) ?? null, error: null };
      }
      if (payload.status === "processing") {
        if (options.claimError) return fail("Claim unavailable");
        const current = rows.get(payload.id);
        if (operation === "insert" && current) return fail("Duplicate event", "23505");
        if (options.lostClaim) return { data: null, error: null };
        if (operation === "update" && (!current || current.status !== filters.status || current.attempts !== filters.attempts)) return { data: null, error: null };
        rows.set(payload.id, payload);
        return { data: { id: payload.id }, error: null };
      }
      if (payload.status === "completed" && options.completionError) return fail("Completion unavailable");
      rows.set(filters.id, { ...rows.get(filters.id), ...payload });
      return { data: { id: filters.id }, error: null };
    };
    const query: any = {
      select: () => query, eq: (key: string, value: any) => { filters[key] = value; return query; },
      insert: (value: any) => { operation = "insert"; payload = value; return query; },
      update: (value: any) => { operation = "update"; payload = value; return query; },
      maybeSingle: () => query, single: () => query, throwOnError: () => { shouldThrow = true; return query; },
      then: (resolve: any, reject: any) => Promise.resolve().then(result).then(resolve, reject),
    };
    return query;
  }) };
  let handler: (req: Request) => Promise<Response> = async () => new Response(null, { status: 500 });
  function FakeStripe() { return stripe; }
  Object.assign(FakeStripe, { webhooks: Stripe.webhooks, createSubtleCryptoProvider: Stripe.createSubtleCryptoProvider });
  const dependencies: Record<string, any> = {
    Deno: { serve: (fn: typeof handler) => { handler = fn; }, env: { get: () => "fixture" } },
    createClient: () => db, Stripe: FakeStripe, corsHeaders: {},
    invokeTransactionalEmail: email, getTenantBillingRecipients: async () => [{ email: "owner@example.invalid", name: "Fictional owner" }],
    STRIPE_API_VERSION: "2025-08-27.basil", getInvoicePeriodEnd: () => null,
    getInvoiceSubscriptionId: () => null, getSubscriptionLifecycle: (s: any) => ({ status: s.status, trialEnd: null }),
    getTrialEndSeconds: (s: any) => s.trial_end, toISO: (s: number) => new Date(s * 1000).toISOString(),
    buildPlanConfig: () => ({}), buildPriceMap: () => ({}), sharedResolvePlan: () => ({ plan: "pro", diagramLimit: 50 }), TRIAL_GROUP_LIMIT: 3,
    stripeVar: () => "fixture", stripeVarSafe: (_: string, mode: "live" | "test") => secrets[mode], stripeMode: () => options.mode ?? "test",
    verifyStripeWebhook, WebhookConfigurationError,
  };
  new Function(...Object.keys(dependencies), javascript)(...Object.values(dependencies));
  const deliver = (body: string, signature = sign(body)) => handler(new Request("https://example.invalid/webhook", { method: "POST", body, headers: { "stripe-signature": signature } }));
  return { deliver, rows, tenantWrites, stripe, email, db };
}

describe("real Stripe webhook entrypoint (isolated dependencies)", () => {
  beforeEach(() => { vi.spyOn(console, "log").mockImplementation(() => {}); vi.spyOn(console, "warn").mockImplementation(() => {}); vi.spyOn(console, "error").mockImplementation(() => {}); });
  it("acknowledges sandbox events in live mode without any database or Stripe calls", async () => {
    const h = harness({ mode: "live" });
    const response = await h.deliver(eventBody());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ received: true, ignored: "mode_mismatch" });
    expect(h.db.from).not.toHaveBeenCalled(); expect(h.stripe.subscriptions.retrieve).not.toHaveBeenCalled(); expect(h.email).not.toHaveBeenCalled();
  });
  it("rejects invalid signatures with HTTP 400 and a generic response", async () => {
    const h = harness(); const body = eventBody();
    const response = await h.deliver(body, sign(body, "wrong-fixture"));
    expect(response.status).toBe(400); expect(await response.json()).toEqual({ error: "Invalid webhook signature" }); expect(h.db.from).not.toHaveBeenCalled();
  });
  const events = ["checkout.session.completed", "customer.subscription.created", "customer.subscription.updated", "customer.subscription.deleted", "invoice.paid", "invoice.payment_failed", "customer.subscription.trial_will_end", "checkout.session.async_payment_failed", "invoice.upcoming"];
  it.each(events)("handles %s and skips its completed duplicate", async (type) => {
    const h = harness();
    const body = eventBody(type, false, { id: "object_fictional", customer: "cus_fictional", subscription: "sub_fictional", status: "active", metadata: { workspace_id: "firm_fictional" }, trial_end: Math.floor(Date.now() / 1000) + 86400, amount_due: 9900, currency: "aud" });
    expect((await h.deliver(body)).status).toBe(200);
    expect(h.rows.get("evt_fictional")?.status).toBe("completed");
    if (type === "invoice.upcoming") expect(h.email).toHaveBeenCalledTimes(1);
    else expect(h.tenantWrites.length).toBeGreaterThan(0);
    const count = h.tenantWrites.length, emailCount = h.email.mock.calls.length;
    expect((await h.deliver(body)).status).toBe(200);
    expect(h.tenantWrites.length).toBe(count); expect(h.email.mock.calls.length).toBe(emailCount);
  });
  it("acknowledges an unsupported event without billing actions", async () => {
    const h = harness(); expect((await h.deliver(eventBody("diagnostic.unsupported"))).status).toBe(200); expect(h.tenantWrites).toHaveLength(0);
  });
  it.each(["lookupError", "claimError", "tenantError", "completionError"] as const)("returns retryable HTTP 500 on %s", async (failure) => {
    const h = harness({ [failure]: true }); expect((await h.deliver(eventBody())).status).toBe(500); expect(h.rows.get("evt_fictional")?.status).not.toBe("completed");
  });
  it("returns HTTP 500 on Stripe API failure", async () => {
    const h = harness({ stripeError: true });
    expect((await h.deliver(eventBody("checkout.session.completed", false, { metadata: { workspace_id: "firm_fictional" }, subscription: "sub_fictional" }))).status).toBe(500);
    expect(h.rows.get("evt_fictional")?.status).toBe("failed");
  });
  it("returns HTTP 500 on email failure", async () => {
    const h = harness({ emailError: true }); expect((await h.deliver(eventBody("invoice.payment_failed"))).status).toBe(500); expect(h.rows.get("evt_fictional")?.status).toBe("failed");
  });
  it("returns HTTP 503 while a concurrent delivery holds the lease", async () => {
    const h = harness({ status: "processing" }); expect((await h.deliver(eventBody())).status).toBe(503); expect(h.tenantWrites).toHaveLength(0);
  });
  it("returns HTTP 503 after losing a conditional claim", async () => {
    const h = harness({ status: "failed", lostClaim: true }); expect((await h.deliver(eventBody())).status).toBe(503); expect(h.tenantWrites).toHaveLength(0);
  });
  it.each(["failed", "processing"])("retries a %s event after its lease expires", async (status) => {
    const h = harness({ status, processedAt: new Date(Date.now() - 600000).toISOString() }); expect((await h.deliver(eventBody())).status).toBe(200); expect(h.rows.get("evt_fictional")?.attempts).toBe(2); expect(h.rows.get("evt_fictional")?.status).toBe("completed");
  });
});