# strukcha Production Readiness Roadmap

A step-by-step implementation plan that closes every issue found in the production audit. Phases run in order; Phase 1 must ship before launch.

---

## Phase 1 — Launch blockers (must ship first)

### Step 1.1 — Remove the publicly reachable bootstrap helper
- Delete `supabase/functions/bootstrap-super-admin/index.ts` and its `config.toml` entry, then remove the deployed function.
- Super admins are already created through `register-super-admin`; confirm at least one super admin exists before deleting.
- Verify: the endpoint returns 404, super-admin sign-in still works, `/admin` still loads.

### Step 1.2 — Remove the temporary performance helper
- Delete `supabase/functions/perf-echo-auth/index.ts`, its `config.toml` entry, and the deployed function.
- Verify: XPM sync start/continue still works from the app.

### Step 1.3 — Remove the legacy cross-tenant invite function
- Delete `supabase/functions/invite-user/index.ts` (superseded by the tenant-scoped `tenant_users` RPCs and `admin-invite-user`).
- Search the frontend for any remaining `invoke("invite-user")` call and repoint it to the tenant-scoped path before deleting.
- Verify: invite, resend, role change and disable/enable all still work from Settings → Users, and a firm owner cannot act on another firm's users.

### Step 1.4 — Require step-up re-authentication for MFA reset
- `reset-totp` must require a freshly verified session (recent password re-entry or a valid current MFA verification) plus super-admin authority for admin-initiated resets.
- Write an audit row for every reset and send the existing "account access updated" email.
- Verify: reset without step-up is rejected; reset with step-up succeeds and is logged.

### Step 1.5 — Fix the login screen copy
- `src/pages/Login.tsx`: title to lowercase `strukcha`; remove the trailing environment word from the subtitle.
- Verify: login page reads correctly in preview and on the published URL.

**Phase 1 estimate: 6–8 hours.**

---

## Phase 2 — Security hardening (before or immediately after launch)

### Step 2.1 — Lock down CORS
- Replace `Access-Control-Allow-Origin: *` in all edge functions with an allow-list built from `FRONTEND_URL` plus the Lovable preview origin. Keep `*` only on endpoints third parties must call (Stripe and smtp2go webhooks, which verify signatures).
- Introduce one shared `_shared/cors.ts` helper so this cannot drift again.

### Step 2.2 — Remove email enumeration
- `send-password-reset` and `self-signup` must return the same generic response whether or not the address exists; keep the specific existing-account copy only where the audit says it is intentional at signup.

### Step 2.3 — Clean stale function configuration
- Remove `xero-debug` and `xpm-diagnostic` entries from `config.toml` (no code exists for them).
- Re-check every `verify_jwt = false` entry and flip back to `true` for anything that does not need public access.

**Phase 2 estimate: 5–7 hours.**

---

## Phase 3 — Data integrity

### Step 3.1 — De-duplicate legacy client records
- Report the 217 duplicate `xpm_uuid` groups (1,222 extra rows; 64 attached to live diagrams; 167 carrying relationships).
- For each group, keep the row with relationships/diagram membership, re-point relationships and structure membership to it, then soft-delete the rest via the existing merge path so history stays.
- Verify: duplicate count is zero and no diagram loses an entity or an arrow.

### Step 3.2 — Prevent recurrence
- Add a unique index on `(tenant_id, xpm_uuid)` where `xpm_uuid` is not null and `deleted_at` is null; run it only after Step 3.1.
- Verify: a repeated full sync completes and the index holds.

### Step 3.3 — Finish trust/entity classification
- Investigate the remaining Unclassified records that carry an `xpm_uuid` and were seen in the last sync (e.g. Dugan Property Trust, Edward Group Investment Trust): these arrive as "related" mentions rather than primary clients, so the upsert never re-types them.
- Allow re-typing from related-party payloads when the current stored type is Unclassified.
- Verify: Unclassified count drops and the named trusts show a trust type with their links intact.

**Phase 3 estimate: 8–10 hours.**

---

## Phase 4 — XPM consistency

### Step 4.1 — One entity-type resolver
- Extract the duplicated `resolveEntityType` / `inferTypeFromText` block into `_shared/xpm-entity-type.ts` and import it in `sync-xpm/_lib.ts`, `fetch-xpm-group`, and `import-xpm-group`.

### Step 4.2 — One relationship-direction rule
- Make `isRelationshipDirectionValid()` match the database trigger and `rel_direction_valid()` (unknown type passes through, never rejects), so preview, group import and full sync produce identical results.

### Step 4.3 — Stop silent name-based merging
- Remove the name fallback in `sync-xpm` so clients resolve by XPM UUID only; log unmatched names as warnings instead of merging.

### Step 4.4 — Handle the remaining skipped links
- Decide per label: map "Secretary" and "Public Officer" to an officer relationship or drop them intentionally; auto-flip or keep-as-warning the direction-breaking cases (e.g. Director on a trust). Roughly 110 per full sync today.
- Verify: run a full sync on the sample groups and confirm the warning count and diagram output.

**Phase 4 estimate: 6–8 hours.**

---

## Phase 5 — Billing and operations

### Step 5.1 — Put schedules in migrations
- Add `cron.schedule` migrations that match the three live jobs (expire-trials hourly, billing reminders daily, Xero keepalive weekly) so the schedule is reproducible.

### Step 5.2 — Webhook safety net
- Add retry/alerting for `stripe_webhook_events` rows that fail repeatedly, surfaced in the admin billing panel.

### Step 5.3 — Live Stripe switch checklist
- Verify all `STRIPE_LIVE_*` values, flip `STRIPE_MODE` to live, run one real checkout, one plan change, one cancellation, and confirm the tenant row updates.

### Step 5.4 — Tidy the email log
- Mark or clear the 22 stale "pending" rows from 10 September (all have matching "sent" rows) and drain the 3 dead-letter items.

**Phase 5 estimate: 5–6 hours.**

---

## Phase 6 — Final verification pass

### Step 6.1 — Authenticated end-to-end run
- Walk signup → payment setup → onboarding → Xero connect → group selection → sync → diagram → export → billing portal as a real user, plus role checks for owner, admin and staff.

### Step 6.2 — Regression checks
- Structure limits and the Creditte unlimited override, trial expiry, cancellation, archived entities absent from active diagrams, labels present on every arrow and in exports, repeated sync with zero duplicates.

### Step 6.3 — Remove dead code and publish
- Delete the unrouted `src/pages/Index.tsx`, confirm page title and description, publish and re-check the published URL.

**Phase 6 estimate: 4–5 hours.**

---

## Total estimate: 34–44 hours

## Technical notes
- Deleting an edge function requires both removing the code/config and deleting the deployed function.
- Step 3.2 depends on Step 3.1; the unique index will fail while duplicates exist.
- Step 3.1 uses the existing atomic merge function rather than raw deletes, so audit history is preserved.
- No changes to pricing, plan limits, diagram layout, or the import UI are in scope.
