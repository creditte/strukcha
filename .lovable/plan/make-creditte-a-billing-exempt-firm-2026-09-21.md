# Make creditte a billing-exempt firm

creditte owns the product, so it should never be asked for a card, never be limited on the number of structures, and never be locked out or emailed about billing. Today it only has the "unlimited structures" override — the payment and subscription machinery still applies to it.

## What changes for creditte

- No card required, ever. The "complete setup" payment step is skipped.
- No plan limits: structures, group selection and imports stay uncapped (already true, kept).
- Never locked out, whatever the subscription state says.
- Billing screen shows a simple "Owner account — no billing applies" state instead of plan, price, renewal date, upgrade/downgrade, checkout and portal buttons.
- No trial-ending, renewal or payment-failed emails.

Nothing changes for any other firm: plan prices, limits, trials, checkout, cancellation and locking all behave exactly as they do now.

## How it will be controlled

A per-firm switch on the firm record (not hard-coded to a name), set on for creditte only. Admins can see it on the firm detail page in the admin area. Turning it on for another firm in future is a single database change, no code edit.

## Technical notes

- Migration: add `tenants.billing_exempt boolean not null default false`; set true for creditte (`f0e4888d-…380f1`). Keep `unlimited_structures` as is; exemption implies it.
- `validate_diagram_limit`, `validate_diagram_limit_on_restore`, `tenant_structure_capacity`, `tenant_has_unlimited_structures` and `import_xpm_batch`: treat `billing_exempt` the same as `unlimited_structures` (bypass the cap, still require an existing tenant).
- `check-subscription`: when exempt, return `billing_exempt: true`, `payment_method_required: false`, `access_enabled: true`, `access_locked_reason: null`, `diagram_limit: MAX_SAFE_INTEGER`, and skip the Stripe subscription lookup, the trial-expiry write and the diagram-limit persistence.
- `BillingStatus` in `src/hooks/useBilling.ts` gains `billing_exempt?: boolean`.
- `BillingGate` in `ProtectedRoute.tsx`: bypass both the `/complete-setup` and `/subscription-locked` redirects when exempt.
- `BillingSettings.tsx`: exempt branch renders the owner-account card; `Import.tsx` and `XpmGroupSelectionDialog.tsx` treat exempt as unlimited.
- `send-billing-reminders` and `expire-trials`: exclude `billing_exempt` firms from their queries.
- `create-checkout`, `change-plan`, `switch-billing-interval`, `customer-portal`: refuse with a clear "this firm is not billed" message rather than creating Stripe objects.
- Existing Stripe customer/subscription IDs on the creditte row are left untouched (no cancellation, nothing deleted) — they are simply no longer consulted.
- Out of scope: pricing values, plan limits for other firms, Stripe test/live mode, diagram layout, import UI.
