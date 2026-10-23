# Data API permissions: prepare for the 30 October change

## What the audit found (live database, checked today)

- 38 tables in the public schema. Every one has Row Level Security switched on.
- Every table already has full table access for `anon`, `authenticated` and `service_role`. These came from the old automatic grants, not from the migrations. (`tenants` is slightly narrower: no UPDATE for `anon`/`authenticated`.) Tenant isolation comes entirely from the RLS policies.
- 132 migrations: 21 create public tables, and only some of those include explicit GRANTs.
- **The live app is not affected on 30 October.** Existing tables keep their grants.
- **What is at risk:** anything that rebuilds the schema from the migrations (preview branches, draft backends, a local `db reset`, a new project). Tables created without explicit GRANTs would come back with no API access, so the app would fail with "permission denied".

## Plan

1. **Table-by-table inventory.** For each table, list which migration creates it, which GRANTs it has, its RLS policies, and the access the app actually uses: browser (`authenticated`), public pages (`anon`), and backend functions (`service_role`). This is worked out from the policies and from the frontend and edge-function code. The result goes into `docs/data-api-grants.md`.
2. **One additive "explicit grants" migration.** It writes down, explicitly, the grants each table needs:
   - `service_role`: ALL on every table, since backend functions use it.
   - `authenticated`: only the operations the RLS policies allow. Example: SELECT only on `audit_log`, `super_admins` and `mfa_verifications`.
   - `anon`: only where a policy is meant for anon use (expected to be few or none, for example unsubscribe tokens; confirmed during step 1).
   On the live database this grants nothing new, because everything is already granted, so live behaviour does not change. On rebuilt schemas, tables become reachable again with the intended access. No data is touched.
3. **Rule for future migrations.** Add a rule to `AGENTS.md`: every CREATE TABLE in public must have its GRANTs in the same migration. Also fix the staged files in `supabase/pending-migrations/` that create tables without GRANTs.
4. **Automated check before deployment.** Add `scripts/check-migration-grants.ts` (run with `bun run test:grants`, and from Vitest). It parses `supabase/migrations/` and fails when a public table is created without a GRANT in that migration or in the explicit-grants migration. A SQL test in `supabase/tests/` asserts that each table's grants match the inventory and that RLS is on.
5. **Validation.** Run the new check and the existing tests (Vitest, `test:sql`). Run the security linter. Sign in as a real user and confirm that structures, clients and settings still load. Confirm a signed-in user of one firm still cannot read another firm's rows.

## Decision needed (not part of the default work)

Today `anon` (signed-out visitors) has full table rights on every table. Only RLS stops them. Removing those rights would be safer defence-in-depth, but it changes live permissions. That breaks the "no changes to existing tables" rule unless you approve it. I will list exactly which tables could have `anon` removed and why, and change nothing until you say so.

## Dashboard action

None needed. Everything goes through migrations.

## Remaining risks

- The 30 October behaviour cannot be simulated here before that date. The grants check is the safeguard.
- Old migrations stay as they are (they are already applied). The catch-up migration covers replays, because it runs after them.
