# Stripe test webhook delivery fix

## Confirmed cause
The enabled sandbox endpoint sends test events to the shared deployment, which is configured in live mode. The handler verifies every request with the live signing secret before checking event mode. A correctly sandbox-signed fictional event reproduced HTTP 400. The two pending Stripe events are `invoice.paid` and `customer.subscription.updated`; historical delivery responses are unavailable in retained logs.

## Implementation
- Verify the untouched request body against independently configured test and live signing secrets; require the verified event mode to match the secret that verified it.
- Keep the deployment's billing mode unchanged. Verified events from the inactive mode receive HTTP 200 with an explicit ignored result, without database, subscription or email actions. Test events must not update this live database.
- Return generic HTTP 400 for invalid signatures without logging signature material or payloads. Configuration failures return HTTP 500.
- Preserve existing billing handlers and completed-event deduplication. Check persistence errors rather than acknowledge unsuccessful processing; avoid unrelated billing changes.
- Add focused tests for signatures, mode isolation, successful handlers, duplicates and retryable failures; deploy only `stripe-webhooks`.

## Verification and reporting
Probe the deployed endpoint with signed synthetic test events and an invalid signature. Test supported active-mode handlers with mocked database/Stripe/email dependencies, never real subscriptions. Report delivery HTTP responses, deployment status, exact changed files, and unavailable Stripe delivery-history/resend verification. No webhook replacement or production billing-mode changes.