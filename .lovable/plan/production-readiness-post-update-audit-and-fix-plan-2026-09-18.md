# Production readiness — post-update audit and fix plan

Re-audited after the Phase 1–6 work. Phases 1–5 hold up: the removed helper endpoints are gone, no duplicate clients or relationships remain, no archived client sits on a diagram, no failing payment events, no stuck emails, and the unlimited-structures override is still limited to one firm (creditte).

Current data: 4,642 active clients, 4,903 relationships, 0 duplicates, 223 unclassified, 1,403 diagrams across 13 firms.

Three real issues surfaced. Two need fixing before launch.

---

## 1. Admin "Operations health" card never loads (confirmed, blocker for admin visibility)

The card calls a check that asks the database `is_super_admin(<user>)`, but the database only has a no-argument version of that check. Every load and every Refresh fails with an error.

Fix: correct the call to the existing no-argument check. No other change needed.

Verify: sign in as a super admin, open the admin dashboard, confirm the card shows webhook counts, email counts and the three background jobs.

## 2. Archived clients are erased from hand-built diagrams (confirmed, blocker)

At the end of every Xero sync, the archive step deletes diagram membership for **every** archived client of the firm, in **every** diagram — including diagrams a user built or arranged by hand. If that client becomes active in Xero again, it never comes back to those diagrams and its position is lost. Leftover connection rows are also left pointing at clients no longer on the diagram.

Fix:
- Stop deleting membership. Exclude archived clients from active diagrams at read time instead (the diagram already filters them), so re-activation restores them automatically with their saved position.
- Where membership must be removed, scope it to sync-generated diagrams only, and remove the matching connection rows in the same step rather than leaving orphans.
- Check the result of the "mark client as seen" step during sync and abort the archive sweep if it failed, so a transient failure can never mass-archive live clients.

Verify: run a sync on a test firm, confirm archived clients disappear from the active diagram view but their placement rows survive; flip one back to active in the data and confirm it reappears in the same spot; confirm no connection rows point at absent clients.

## 3. Old "Spouse relationships can only be between individuals" report — already resolved

Confirmed stale: both the database rule function and the trigger now treat an unrecognised client type as "not known yet" and let the link through. The error appears once in history (15 Sep) and never after. No work needed; will be marked resolved.

---

## Housekeeping (your call, not blockers)

- **Test firms in live data.** 11 of 13 firms are test/expired accounts, including "PERF TEST TENANT" holding 880 diagrams and "Signe Huff" with 50. They inflate counts and clutter the admin view. I can soft-delete them on request.
- **223 unclassified clients.** These only ever appear as related mentions in Xero with wording we can't map; they display and connect correctly, just without a type.
- **~110 links skipped per full sync** (Secretary, Public Officer, and links Xero records in a direction the rules reject). Reported as warnings, nothing breaks.
- **95 database advisory warnings** (unchanged, pre-existing): internal helper routines callable by signed-in users and 4 without a fixed search path. None expose data directly — each is gated internally — but tightening them is worthwhile hardening later.
- **Payments stay in test mode** as you asked. Real cards cannot be charged until that is flipped and one real checkout, plan change and cancellation are run.

---

## Technical notes

- Fix 1: `src/components/admin/OperationsHealthPanel.tsx` / `admin_operations_health()` — drop the argument from `public.is_super_admin(auth.uid())`.
- Fix 2: migration replacing `sync_xpm_archive_absent_clients` (remove the unscoped `DELETE FROM public.structure_entities`), plus `supabase/functions/sync-xpm/index.ts` to check the `sync_xpm_mark_seen` result before the sweep. Confirm the diagram query already filters `is_archived`.
- No changes to pricing, plan limits, diagram layout or the import UI.
