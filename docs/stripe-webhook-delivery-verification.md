# Stripe webhook delivery verification — 13/11/2026

## Root cause and evidence
- The connected Stripe account is **strukcha sandbox**. Its existing test endpoint is enabled, points at this deployment, and subscribes to the reported event types.
- Stripe lists two pending test events since 07/11/2026: `evt_1UZFEh03zgsCflns8luSeIuU` (`invoice.paid`) and `evt_1UZEI503zgsCflns6E6rFJ6g` (`customer.subscription.updated`).
- The shared deployment is configured with `STRIPE_MODE=live`. Before this fix, the handler verified all requests with the live signing secret, then checked event mode. Correctly sandbox-signed synthetic requests returned HTTP 400. Function logs confirm signature mismatch. No recent billing-event rows were recorded.
- This is an event-independent verification failure, not specific invoice or subscription parsing. Retained logs do not include the original November delivery attempts; their exact response bodies cannot be asserted.

## Changes
- `supabase/functions/_shared/stripe-webhook-verification.ts`: verify raw bodies against independently configured test/live secrets and bind each verified event's `livemode` to the secret that verified it. No unverified JSON decides which secret is trusted.
- `supabase/functions/stripe-webhooks/index.ts`: perform verification before billing configuration; acknowledge inactive-mode events without database/Stripe/email calls; generic invalid-signature response; CORS on all responses; configuration failures return 500. Replace event upsert with conditional claims and a five-minute processing lease. Completed events are skipped. Database failures and Stripe sync failures are not silently marked completed. Existing deferred Stripe updates receive a stable event-specific idempotency key. Existing email keys remain unchanged.
- `src/lib/stripeWebhook.test.ts`: real Stripe SDK signature tests and the actual entrypoint executed with isolated database, Stripe, and email dependencies.
- `package.json` / `bun.lock`: Stripe 18.5.0 added as a development dependency for tests, matching the deployed SDK.
- `AGENTS.md` and `roadmap.md`: record mode separation and completion.
- **No migrations, permission changes, endpoint replacement, secret changes, or billing-mode changes.**

## Deployment and actual HTTP results
Only `stripe-webhooks` deployed successfully. Function logs confirm the new behavior.

| Deployed test | Result |
| --- | --- |
| Signed synthetic test `invoice.paid`, first delivery and repeat | HTTP 200, `{"received":true,"ignored":"mode_mismatch"}` |
| Signed synthetic test `customer.subscription.updated`, first delivery and repeat | HTTP 200, `{"received":true,"ignored":"mode_mismatch"}` |
| Invalid signature | HTTP 400, `{"error":"Invalid webhook signature"}` |

These are direct HTTP probes signed using the securely available configured sandbox secret, not Stripe-originated deliveries. A read-only query confirms the probes created no webhook-event records. The mode guard runs before constructing a database client or accessing subscriptions. No real payments, subscriptions, Xero actions, or customer emails were triggered.

## Tests
`bunx vitest run --testTimeout=20000`: **356 tests pass in 16 files**, including **29 webhook tests**. The first whole-suite run hit an unrelated five-second temporary-database test timeout; rerunning with a longer test allowance passed without changing that test.

Webhook coverage: test and live signature success; invalid, modified, expired, and wrong-mode signatures; missing signing configuration; live deployment ignoring test events without calls; nine supported event handlers; completed duplicates; unsupported events; lookup/claim/tenant/completion failures returning 500; Stripe/email failures returning 500; in-flight/lost claims returning 503; failed and expired-lease retry. Active-mode handling uses fictional fixtures and mocked dependencies, not live accounts. Preview diagnostics finish with `build OK`.

## Limitations and follow-up
- No Stripe-originated resend/test delivery was performed, so Stripe's dashboard clearing the two original pending events is unverified. In Stripe's sandbox webhook deliveries, retry those two events and expect HTTP 200 with `ignored: mode_mismatch`.
- The shared database remains live. Successful sandbox delivery intentionally does **not** activate subscriptions or mirror sandbox billing. Full sandbox billing tests require an isolated test deployment/database; switching the shared deployment to test mode would be unsafe.
- Active-mode database concurrency and actual live subscription/email effects were tested through isolated dependencies, not exercised against live records. Conditional claim logic prevents concurrent handlers; retries preserve stable Stripe/email keys. No claim of transactional exactly-once delivery is made across external services.
- The endpoint also subscribes to `checkout.session.async_payment_succeeded`, which has no dedicated existing handler and remains acknowledged as unsupported; it was not one of the reported failures and billing behavior was not extended in this task.