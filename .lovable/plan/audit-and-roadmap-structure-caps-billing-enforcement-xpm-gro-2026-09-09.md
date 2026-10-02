# Audit and roadmap: structure caps, billing enforcement, XPM group-to-structure flow

Read-only audit. Nothing was changed. Findings marked **Confirmed** were verified in code or the live database; everything else is a recommendation.

---

## 1. Unlimited structures for creditte

**Current implementation (Confirmed)**
- The cap lives on the tenant row: `tenants.diagram_limit` vs `tenants.diagram_count`.
- creditte (`f0e4888d-…`) is `pro`, `active`, `diagram_count = 50`, `diagram_limit = 50` — already exactly at the cap, so every new structure is blocked right now.
- `check-subscription` recomputes `diagram_limit` from the plan on every call (trial 3, starter 15, pro 50) and **writes the corrected value back** to the tenant row. Any manual bump of `diagram_limit` is therefore erased on the next page load.

**Confirmed gap**
There is no tenant-level override. The only existing bypass is the global kill switch `app_config.billing_enforcement_enabled`, which would disable enforcement for every firm.

**Recommended solution**
Add a permanent per-tenant override column, e.g. `tenants.unlimited_structures boolean not null default false`, and honour it in the three places that decide capacity:
1. `validate_diagram_limit` and `validate_diagram_limit_on_restore` triggers — return early when the flag is set.
2. `import_xpm_batch` — treat capacity as unbounded when the flag is set.
3. `check-subscription` — skip the plan-derived limit rewrite and expose an unlimited limit for that tenant.
Also skip the downgrade guard in `change-plan` for override tenants.

**Affected**: `tenants`; functions `validate_diagram_limit`, `validate_diagram_limit_on_restore`, `import_xpm_batch`; edge functions `check-subscription`, `change-plan`; UI reads via `useBilling` / `BillingBanner` / `DiagramLimitDialog` / `Structures.tsx` / `Import.tsx` (they only need to render "unlimited" instead of a number).

**Steps**: migration adds the column → update the two triggers and `import_xpm_batch` → update `check-subscription` → set the flag for creditte → UI copy for unlimited.

**Verification**: with the flag on, create structures past 50; re-run a sync; reload the app and confirm `diagram_limit` is no longer rewritten; confirm a second tenant without the flag is still capped.

**Estimate**: 3–4 h. **Risks**: forgetting one enforcement point (limit reappears intermittently); UI dividing by an unlimited value when drawing usage bars.

---

## 2. Structure-limit enforcement and XPM sync behaviour

**Current implementation (Confirmed)**
- Database is the real gate: `validate_diagram_limit` raises on insert when `access_enabled` is not true or `diagram_count >= diagram_limit`; `validate_diagram_limit_on_restore` guards un-archive; `update_tenant_diagram_count` recounts active, non-archived, non-scenario structures.
- CSV import: `import_xpm_batch` computes `capacity = diagram_limit - diagram_count` up front, creates structures until capacity runs out, then counts the rest as `structures_skipped`.
- UI: `Structures.tsx`, `Dashboard.tsx`, `Import.tsx`, `BillingBanner`, `DiagramLimitDialog` all pre-check `diagram_count >= diagram_limit` from `check-subscription`.
- XPM sync: `sync_xpm_link_group` wraps the structure insert in a `BEGIN … EXCEPTION` block and, on the limit error, returns `{skipped:false, error:…}`. `sync-xpm` passes that to `warn()`, which only appends to the job's warnings array.

**Confirmed problems**
- A sync that hits the cap **keeps running for all remaining groups and finishes as `completed`** — `useXpmSyncJob` then shows "Sync complete". The cap failure is never surfaced.
- The run is not a no-op: entities, relationships and `xpm_groups` rows are still written, and `xpm_groups.member_hash` / `last_synced_at` are **not** updated for failed groups (good), but members of the missing structure are silently not linked. This matches the live state found earlier: 886 groups catalogued, none turned into structures.
- Warnings collected in `import_logs.result` are not read by the UI at all.

**Recommended production-safe behaviour**
- Pre-flight the sync: compare the number of groups needing new structures against remaining capacity, and refuse to start with a clear message when there is not enough room (same pattern already used in `Import.tsx`).
- During a run, treat the limit error as a distinct, terminal condition rather than a warning: stop creating new structures, finish the current slice, and end the job as `failed` (or `completed_with_warnings`) with reason `structure_limit_reached` plus counts of created/skipped groups.
- Never leave a group half-linked: skip the group entirely rather than partially, and leave its `member_hash` unset so a later run retries it.
- Surface warnings and the skip reason in the sync UI, with actions "archive/delete structures" or "upgrade".
- Resume: after capacity is freed, re-running the sync should pick up only the unprocessed groups (already supported by the hash check).

**Affected**: `sync_xpm_link_group`, `sync_xpm_link_groups`, `sync_xpm_ensure_fallback_structure`, `supabase/functions/sync-xpm/index.ts` (+ `_lib.ts`), `import_logs`, `src/hooks/useXpmSyncJob.ts`, `src/pages/Dashboard.tsx`.

**Steps**: define a structured error code in the RPCs → detect it in the slice loop and stop cleanly → write status/reason/counters into `import_logs.result` → pre-flight capacity check at job start → expose reason and warnings in the sync panel.

**Dependencies**: area 1 (override) should land first so creditte is unblocked while this is built.

**Verification**: seed a tenant one structure below its cap and sync several groups — expect a clear stop, accurate counts, no half-linked groups; free a slot and re-run — expect only the remaining groups processed.

**Estimate**: 8–10 h. **Risks**: mislabelling unrelated insert failures as cap errors; job left in `processing` if the new stop path misses the lease release; long syncs where capacity changes mid-run.

---

## 3. Billing enforcement

**Current state (Confirmed)**
- `app_config.billing_enforcement_enabled = true`, so enforcement is **fully active**; `is_billing_enforcement_enabled()` gates both structure triggers and `import_xpm_batch`.
- Source of truth is the `tenants` row (`access_enabled`, `subscription_status`, `subscription_plan`, `diagram_limit`, `diagram_count`), written by `stripe-webhooks` and self-healed/recomputed by `check-subscription` and `reconcile-billing`.
- Enforcement points: structure insert/restore triggers, `import_xpm_batch`, `change-plan` downgrade guard, plus UI gates in `Structures`, `Dashboard`, `Import`, `BillingBanner`, `SubscriptionLocked`.

**Confirmed inconsistencies**
- XPM sync is the only write path that bypasses enforcement semantics: it swallows the cap error, and entity/relationship writes are never capped or gated by `access_enabled`.
- `diagram_limit` is authored in several places with duplicated hard-coded numbers (`check-subscription`, `stripe-webhooks`, `switch-billing-interval`, `change-plan`, `_shared/stripe-plans.ts`), so a plan change must be edited in several files.
- Several tenants sit in states like `trial_expired` with `access_enabled = false` while still holding structures — expected, but worth a documented policy.

**Recommendation**: keep the tenant row as the single source of truth, route every limit decision through one shared helper (server-side) plus one shared plan table, and bring sync under the same rules as import. Document the kill switch as a break-glass control only.

**Affected**: `_shared/stripe-plans.ts`, `check-subscription`, `stripe-webhooks`, `switch-billing-interval`, `change-plan`, structure triggers, `import_xpm_batch`, `sync_xpm_link_group`.

**Estimate**: 5–6 h. **Risks**: touching webhook/plan code can affect live subscriptions; do this after areas 1–2 and verify with the reconciliation panel.

---

## 4. XPM import flow: all groups vs user selection

**Current implementation (Confirmed)**
Sync catalogues every XPM group and tries to create a structure for each one, unconditionally. With 886 groups and a 50-structure plan this can never succeed, and today it fails silently. A single-group path (`import-xpm-group`, `fetch-xpm-group`, favourites/recent group cards) already exists in the app.

**Recommendation**: explicit group selection. Sync should always catalogue groups (cheap, no structures created), and structures should only be created for groups the user picks — with a picker that shows remaining capacity, disables selection beyond it, and marks already-imported groups. An explainer video is not sufficient on its own: the automatic behaviour is mathematically impossible for large practices and produces a silent failure, which no amount of explanation fixes. Keep the video as onboarding on top of the selection step.

**Interaction with limits/billing**: the picker is the natural place to enforce capacity before any write, so limit errors become a disabled checkbox and an upgrade prompt instead of a failed background job.

**Affected**: `sync-xpm` (catalogue-only mode), `import-xpm-group`, `list-xpm-groups`, `Dashboard.tsx`, `XpmGroupCards`, `FavouriteGroups`, `RecentGroups`, `xpm_groups`, `structures`.

**Estimate**: 10–14 h. **Risks**: existing tenants that relied on automatic creation; deciding what happens to groups already auto-created; pagination/search over ~900 groups.

---

## Sequenced roadmap

1. **creditte unlimited override** (3–4 h) — unblocks the firm immediately, no behaviour change for others.
2. **Safe structure-limit handling in sync** (8–10 h) — correct job status, messaging, no partial state, clean resume.
3. **Billing enforcement consolidation** (5–6 h) — one shared limit/plan source, sync brought under the same rules.
4. **XPM group-selection flow** (10–14 h) — catalogue always, create structures only on selection, capacity-aware picker.

Total 26–34 h. Steps 1 and 2 are the priority; step 4 is the durable fix for the group-to-structure mismatch.
