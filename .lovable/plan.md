# XPM group integrity repair (J Rowe priority)

Base: d5aee9d8. Keep the pg_safeupdate hotfix (014) and `DatabaseStepError` handling in `sync-xpm` unchanged. Every new SQL step uses an explicit WHERE.

## Confirmed in code
- `sync_xpm_link_group` (migration 20260827185159) finds the structure by `name` only, with no `source` filter. A manual structure with the same name can therefore be picked up by sync.
- `import-xpm-group` also matches by `name` + `source='xpm'`. When it reuses a structure, it deletes all of that structure's `structure_entities` and `structure_relationships`. That would remove manual additions, and positions with them.
- `import-xpm-group` reuses a relationship by selecting only its `id`. It never refreshes the share or percentage figures.
- `sync-xpm` reads only label, related party and dates. `NumberOfShares` and `Percentage` are dropped.
- `XpmGroupCards` calls `import-xpm-group` but never selects or tracks the group.

## Stage 1: Schema (pending SQL `phase2/015_xpm_group_provenance.sql`, not applied)
- `structures`: add `xpm_group_uuid text null`.
  - Add a partial unique index on `(tenant_id, xpm_group_uuid)` where `deleted_at is null and xpm_group_uuid is not null and is_scenario = false`.
  - Scenarios and snapshots never carry the UUID.
- `structure_entities` and `structure_relationships`: add `membership_source text not null default 'manual'` (`manual` | `xpm`) and `xpm_last_seen_at timestamptz`.
  - Only `xpm` rows can ever be removed by reconciliation.
- `relationships`: add `metadata_source text not null default 'manual'` (`manual` | `xpm`) and `xpm_metadata_at timestamptz`.
- Backfill, in the same file with WHERE-scoped UPDATEs and no merges:
  - Set `metadata_source='xpm'` on relationships where `source='imported'` and the figures were never edited (`confidence <> 'edited'`).
  - Leave every existing membership as `manual`. This is the safe default; the first reconciliation of each group promotes rows XPM confirms.
  - Do **not** set `xpm_group_uuid` automatically. It is set only by the pilot/apply step below, so the two J Rowe structures can never collide or merge.
- Replace `sync_xpm_link_group` / `sync_xpm_link_groups` so the lookup is by `xpm_group_uuid` only. If no structure is found, create one with `source='xpm'`. Name is never used for matching.

## Stage 2: One shared reconciler
New file `supabase/functions/_shared/xpm-group-reconcile.ts`: `planGroupReconciliation(current, xpm)` → `{ addMembers, removeMembers, addLinks, removeLinks, metadataUpdates, preserved }`. It is a pure function with no I/O.

Rules:
- **Members:** add active XPM members.
  - Remove only `membership_source='xpm'` rows whose entity is no longer a member, or is now archived or deleted in XPM.
  - Manual rows are always kept.
  - Rows are deleted by key (structure_id, entity_id), never wiped wholesale. Positions on rows that stay are untouched.
- **Links:** canonical edges between current members come from the existing normaliser (`xpm-policy-normalise.ts`), unchanged. Same for trustee links (`sync_xpm_link_trustees` logic).
  - Remove only `membership_source='xpm'` links no longer present.
  - Manual relationships, such as James Rowe → Appointor, are never removed.
- **Ownership figures, in this order of precedence:** manual edit (`metadata_source='manual'` or `confidence='edited'`), then current XPM, then stored.
  - XPM `Percentage`/`OwnershipPercentage` of 0, blank or not a number → null.
  - `NumberOfShares` above 0 → `ownership_units`.
  - A percentage is never worked out from a share count.
  - Figures are only written where `policyMetadataFields` allows them.
- **Group hash:** `member_hash` and `last_synced_at` are written only after an apply succeeds. A dry run writes nothing.

Database side: new RPC `xpm_apply_group_reconciliation(_tenant_id, _group_uuid, _group_name, _plan jsonb, _expected_hash text)`. It is security definer and runs in one transaction. It takes a row lock on `xpm_groups`, checks the hash has not changed since the plan was made, and applies the plan with WHERE-scoped statements only.

## Stage 3: Edge Functions
- `_shared/xpm-ownership.ts` (new): `parseXpmOwnership(rel)` → `{ units, percent }`, implementing the 0→null rule.
- `import-xpm-group/index.ts`:
  - Look up the structure by `xpm_group_uuid` and drop the name lookup and the wholesale deletes.
  - Use the shared ownership parser.
  - Build the current state, call `planGroupReconciliation`, then either:
    - `mode:'preview'`: return the plan (adds, removes, figure updates, manual items kept) with no writes; or
    - `mode:'apply'`: call the RPC.
  - Upsert `xpm_groups` with `is_selected=true`, so the group stays in sync.
  - Evidence rows are unchanged (still one per raw fact).
- `sync-xpm/index.ts` and `_lib.ts`:
  - Parse `NumberOfShares` and `Percentage` into rels and the evidence payload.
  - Pass the figures through the `canonical_v1` rels.
  - Per selected group, call the same planner and RPC instead of `sync_xpm_link_groups`.
  - `DatabaseStepError` paths stay as they are.
- `sync_xpm_upsert_clients` (pending SQL `016`): copy 014 byte-for-byte, except that rels now carry `ownership_units` and `ownership_percent`, existing imported rows are refreshed only where `metadata_source='xpm'`, and WHERE clauses are kept.
- `src/components/structure/XpmGroupCards.tsx`:
  - "Open in Editor" runs a preview first and shows a confirm dialog listing the changes.
  - Apply only after the user confirms.

## Stage 4: Health and display
- `structureScoring.ts`: new info code `ownership_units_only`, with the message "<n> shares recorded; percentage not supplied by XPM."
  - Severity info, deduction 0, no node icon.
  - Not in `EXPORT_BLOCKING_ISSUE_CODES`.
  - It replaces `ownership_no_percent` for a target when units exist, so the target never gets both.
- `EntityNode` / `RelationshipDetailPanel`: show "60 shares" when the percentage is null.

## Stage 5: Tests (code only)
New `src/lib/xpmGroupReconcile.test.ts` and `xpmOwnership.test.ts` cover:
- Running twice with the same UUID gives the same result.
- Same name with a different UUID gives two structures.
- Members added and removed; archived members removed.
- Trustee link added.
- Shares 60 / percent 0 → units 60, percent null.
- Existing imported figures refreshed, and a manual edit kept.
- Manual member, manual link and the Appointor all kept.
- A repeat sync makes no changes.
- A preview makes no writes.

Database and Health tests:
- `scripts/relationship-policy-sql-check.ts` (pg_safeupdate on) checks that 015, 016 and the RPC apply cleanly and need no WHERE fixes, and that the RPC is idempotent.
- Health tests for `ownership_units_only`.

Full Vitest, tsgo, build, test:sql and deno check must all pass.

## Stage 6: Deployment order (each step only after review)
Edge Function code goes live in Lovable as soon as it is saved, so the order matters:
1. Apply 015, then 016. Both are backwards compatible: new columns have defaults, and the old RPC signatures are kept as wrappers.
2. Save the Edge Function changes. That is the deploy, and it happens all at once.
3. Frontend changes publish later.

XPM syncs for real firms stay paused until the J Rowe pilot passes.

## J Rowe pilot
1. Take snapshots of both structures (ab7b85fb manual, 3f9c5530 XPM) with `create-snapshot`.
2. Set `xpm_group_uuid='29501793-…'` on 3f9c5530 only. Leave ab7b85fb untouched and protected.
3. Run the preview for that group and review it with you. Expected result:
   - 7 members, including Rowefox Pty Ltd and Megan Lys.
   - Rowefox → Trustee → The Rowe Family Trust added.
   - James Rowe's Shareholder links with units 60 and percent null.
   - James Rowe → Appointor shown as kept.
   - No removals of manual items.
4. Apply, then check with read-only queries: the members, the links, the figures, the Appointor still there, `xpm_groups` showing `is_selected=true` with hash and time set, and positions unchanged.
5. Run the preview again, which must show no changes.
6. Compare the two J Rowe structures by hand later. Nothing is merged or archived automatically.

## Rollback
- **SQL:** 015's columns are additive. Undo by restoring the previous `sync_xpm_link_group*` and 014 function bodies (kept in a `rollback/` pending file).
- **Edge Functions:** re-save the previous versions.
- **Pilot data:** restore 3f9c5530 from its snapshot as a scenario, or re-add the rows the plan removed. The apply plan JSON is written to `audit_log` so every change can be reversed.

## Production writes deferred until after code review
- Applying 015 and 016.
- Saving and deploying the Edge Functions.
- Setting `xpm_group_uuid` on 3f9c5530.
- The pilot snapshots and the apply.
- Resuming XPM sync.
- Any backfill of other groups' UUIDs (a later reviewed batch, one per group via preview).

## Risks and blockers
- Other duplicate-name groups exist that the name-based link may already have mixed together. Before assigning UUIDs, run a read-only report of name collisions across `structures` and `xpm_groups`.
- The relationships backfill relies on `confidence='edited'` to spot manual changes to the figures. Rows edited before that flag was used can't be told apart. Mitigation: the backfill only marks rows as XPM-managed and changes no values.
- The old production relationship trigger is still active, so some canonical links may be refused. The per-row skip and pending evidence still apply.
- Lovable's tools don't return commit SHAs. Use the version history instead.
