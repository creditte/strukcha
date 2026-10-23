# Data API security review (23/10/2026) — findings only, no live permissions changed

## 1. Function warnings (91 = 43 anon + 48 signed-in, SECURITY DEFINER in public)

### Critical / High — genuinely exploitable
| Function | Who can run it | Problem | Fix |
|---|---|---|---|
| `merge_duplicate_xpm_entities(_tenant_id, _limit)` | anon, authenticated | No caller check; `_tenant_id NULL` = every firm. Merges/re-points client and relationship data. Not called by the app. | REVOKE from PUBLIC, anon, authenticated (service_role only). |
| `find_duplicate_entities(_tenant_id)` | anon, authenticated | No caller check. **Verified: signed-out call returned 148 Creditte client-name pairs; a signed-in Creditte user got 11 pairs from the other firm.** Used by Review > Duplicates and Create Structure. | Add guard `_tenant_id = get_user_tenant_id(auth.uid()) OR is_super_admin() OR service_role`; REVOKE from anon. |
| `find_fuzzy_duplicate_entities(_tenant_id, _threshold)` | anon, authenticated | Same as above. | Same guard; REVOKE from anon. |
| `read_email_batch`, `enqueue_email`, `delete_email`, `move_to_dlq` | anon, authenticated | No check. Anyone can read queued emails (incl. sign-in/reset links), inject emails, or delete them. Only backend functions use them. | REVOKE from PUBLIC, anon, authenticated. |

### Medium
| `email_queue_dispatch` | anon, authenticated | Lets anyone trigger queue dispatch. Cron/backend only. | REVOKE from anon, authenticated. |
| `get_user_tenant_id(_user_id)` | anon, authenticated | Verified: signed-out call maps any user ID to its firm ID. Needed by RLS policies (signed-in). | REVOKE from anon only. |

### Low / expected
- Guarded admin/tenant RPCs (`rpc_*`, `get_my_tenant_user`, `get_xero_connection_info`, `disconnect_xero_connection`, `link_tenant_user_on_login`, `admin_operations_health`, `health_review_*`, `xpm_archive_group_structures`): check the caller internally; signed-in access is intended. Recommend REVOKE from anon (no signed-out use).
- `has_role`, `is_owner`, `is_owner_or_admin`, `is_super_admin`: used by RLS; return only facts about the caller (has_role is own-role-only). REVOKE from anon.
- `is_billing_enforcement_enabled`, `tenant_has_unlimited_structures`: return a boolean; low. REVOKE from anon.
- Trigger functions (`audit_*`, `handle_new_user`, `protect_tenant_billing_fields`, `update_tenant_diagram_count`, `validate_*`, `email_queue_wake`): cannot be called through the API (trigger return type). Linter noise; revoking is harmless tidy-up.
- Already locked (service_role only): `claim_sync_job`, `import_xpm_batch`, `signup_*`, `sync_xpm_*`, `xpm_*` reconciliation, `tenant_structure_capacity`, `fail_stale_import_jobs`, `_xpm_set_relationship_metadata`.

## 2. Table with RLS on and no policies
`signup_rate_events` — signup rate-limit counters written only by `signup_rate_hit` (SECURITY DEFINER, service_role only). No policy = deny all browser access. **Intended; no change.**

## 3. anon (signed-out) table privileges
All 38 public tables grant anon full rights (SELECT/INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER; `tenants` lacks UPDATE). No RLS policy matches signed-out users (every policy requires `auth.uid()`, a role check, or `service_role`), and no signed-out page queries tables directly (Login/SetupPassword queries run after sign-in; signup, unsubscribe, password reset go through backend functions). Verified: signed-out reads of 9 sensitive tables returned no rows.
Impact of revoking: none on app flows. TRUNCATE is not subject to RLS but is not exposed by the Data API.
**Recommendation: revoke all anon privileges on all 38 tables.**

## 4. Validation results
- Cross-firm isolation via tables (signed-in Creditte user, not super admin): own firm visible (2,634 clients, 3,297 relationships); other firm 0 rows on entities, structures, relationships, import_logs, audit_log, xpm_groups, tenant_users, profiles; only own firm visible in tenants. Update of other firm's client: 0 rows changed. Insert into other firm: rejected (RLS). Update other firm: 0 rows. **PASS.**
- Cross-firm via functions: **FAIL** — `find_duplicate_entities` leaks other firm's client names (see 1).
- Signed-in normal path: read own data PASS; update own profile (same value) PASS. Browser click-through: NOT TESTED (MFA).
- Signed-out: tables return nothing PASS; functions leak (see 1).
- Fresh-database rebuild: NOT TESTED — no isolated Supabase stack available here; live DB not touched.

## 5. Proposed changes (awaiting approval)
A. Urgent: REVOKE EXECUTE on `merge_duplicate_xpm_entities`, `read_email_batch`, `enqueue_email`, `delete_email`, `move_to_dlq`, `email_queue_dispatch` FROM PUBLIC, anon, authenticated.
B. Urgent: add tenant guard inside `find_duplicate_entities` and `find_fuzzy_duplicate_entities`; REVOKE from PUBLIC, anon.
C. REVOKE EXECUTE FROM PUBLIC, anon on every remaining public SECURITY DEFINER function (signed-in grants kept where the app uses them).
D. REVOKE ALL on all 38 public tables FROM anon.
E. Optional tidy: REVOKE EXECUTE on trigger functions FROM anon, authenticated.

## Applied 23/10/2026 — `drizzle/migrations/0001_harden_function_and_anon_access.sql`
- A: merge + 4 email-queue functions + `email_queue_dispatch` → service_role only.
- B: both duplicate finders now raise 42501 unless caller's own firm (or service_role); anon revoked.
- C: every non-trigger SECURITY DEFINER function: PUBLIC/anon revoked; signed-in access kept exactly where it existed.
- D: anon has no privileges on any public table/view/sequence; default privileges for future tables revoked for anon. RLS policies unchanged (38/38 enabled).
- Verified live: signed-out tables/functions → permission denied; signed-in own-firm reads, duplicates (148 / 89), profile update, tenant/Xero/health RPCs OK; other-firm duplicates → 403; other-firm reads 0 rows, update 0 rows, insert refused; backend-only functions → 403 for signed-in.
- Not exercised: a real email send through the queue (service_role grants confirmed), browser click-through (MFA), fresh-database rebuild.
- E (pending): trigger functions still executable by anon/authenticated; Postgres checks EXECUTE only at CREATE TRIGGER, so revoking is safe.
- E applied (`drizzle/migrations/0002_revoke_trigger_function_execute.sql`): EXECUTE revoked from PUBLIC/anon/authenticated on 13 trigger functions; service_role kept; all triggers still enabled. Verified: signed-in invalid relationship insert was rejected by `validate_relationship_rules` (trigger ran without the grant; nothing saved).

## Follow-up verification 23/10/2026 (no changes deployed)
Trigger workflows tested inside one deliberately rolled-back transaction (confirmed nothing persisted):
- Audit: 8 audit rows for 2 client inserts, 1 client edit, relationship insert/edit/soft-delete, structure edit — PASS. Structure insert itself writes no audit row (by design: only `audit_structure_update`).
- Diagram count: Creditte 847→848 on new diagram — PASS. Limit: test firm limit 1, 2nd diagram refused, scenario allowed — PASS.
- handle_new_user: test invitation + test account → profile in test firm, role viewer, invite accepted — PASS.
- email_queue_wake: dummy queue message queued 1 wake-up call (rolled back, never sent) — PASS. Delivery by process-email-queue not exercised.
- Billing protection: change blocked, but with "malformed array literal" instead of the intended message (`_changed || 'x'`) — PROTECTS, message bug. Non-billing edit still allowed.

### CRITICAL found: user-management RPCs skip the permission check for non-members
`rpc_change_tenant_user_role`, `rpc_disable_tenant_user`, `rpc_enable_tenant_user`, `rpc_reinvite_tenant_user`, `rpc_restore_tenant_user` use `IF _actor_role NOT IN ('owner','admin')`, `rpc_soft_delete_tenant_user` uses `!= 'owner'`. When the caller is not an active member of `p_tenant_id`, `_actor_role` is NULL, the test is NULL, and the check is skipped. Verified: a Creditte user calling each against the other firm with a made-up user id got "User not found" (past the check) instead of "Unauthorized". With a real user id from another firm, the caller could change roles, disable, enable, re-invite, restore or delete users there. A disabled user could also re-enable themselves.
Fix: `IF _actor_role IS NULL OR _actor_role NOT IN (...)` / `IF _actor_role IS DISTINCT FROM 'owner'`.

## Follow-up fixes (migration 0003, applied 23/10/2026)

- **A** — `rpc_change_tenant_user_role`, `rpc_disable_tenant_user`, `rpc_enable_tenant_user`, `rpc_reinvite_tenant_user`, `rpc_restore_tenant_user`: guard is now `_actor_role IS NULL OR _actor_role NOT IN ('owner','admin')`. `rpc_soft_delete_tenant_user`: `_actor_role IS NULL OR _actor_role <> 'owner'`. Nothing else in the functions changed; grants unchanged (authenticated + service_role).
- **B** — `protect_tenant_billing_fields` builds its list with `array_append` (the old `text[] || 'literal'` was parsed as an array literal) and raises `Billing fields are managed by the billing system.` (SQLSTATE 42501, attempted fields in DETAIL). Signed-in users are also blocked earlier by column grants on `tenants`.
- Verified in a rolled-back batch: all six refuse another firm's real user (target unchanged); disabled self-reactivation refused; own-firm admin disable/enable/reinvite/role change work; admin delete refused, owner delete/restore work; billing change refused with the new message; normal firm setting saves.

## C — `get_user_tenant_id` (not changed)

Every caller passes the caller's own ID: 54 RLS policies on 19 tables use `get_user_tenant_id(auth.uid())`; 7 SQL functions and 5 Edge Functions plus `CreateStructureModal` pass `auth.uid()` / `user.id`. Proposed restriction: inside the function return NULL when `_user_id <> auth.uid()` unless the caller is `service_role` or a super admin. All current uses keep working; only lookups of other users' firms stop.
