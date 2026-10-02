# Relationship policy (Rulebook v1) — developer notes

## Where it lives
- `supabase/functions/_shared/relationship-policy.ts` — the canonical policy. Pure TypeScript, no runtime imports; used by both the browser and Edge Functions.
- `src/lib/relationshipPolicy.ts` — browser re-export (keeps `@/lib/relationshipPolicy` imports stable).
- `src/lib/relationshipRules.ts` — thin compatibility facade. It contains **no rules**; every answer comes from `evaluateRelationship()` / `POLICY_RULES`. `RELATIONSHIP_RULES` lists only creatable types (no Child, no Settlor).
- `src/lib/manualRelationship.ts` (+ `manualRelationshipDeps.ts`) — manual create / type change / reverse planning, Sole Trader resolution, de-duplication.
- `supabase/functions/_shared/xpm-policy-normalise.ts` — XPM label parsing, normalisation and evidence drafts (pure).
- `src/test/fixtures/relationship-policy-vectors.json` — shared hand-written vectors for TS and SQL.
- SQL twin `public.relationship_policy_evaluate()` and all database changes: `supabase/pending-migrations/` (**not applied**).

## Outcomes
`evaluateRelationship(type, fromDbType, toDbType, { directionKnown })` returns
`{ outcome, reason, canonicalType, swapped, fromType, toType }`. Only `valid` (as given) and `reverse` (swap once) can become a canonical row (`toCanonicalEdge`).

| outcome | meaning |
|---|---|
| `valid` | Store as given. |
| `reverse` | Store with from/to swapped (`auto_reversed`, or `child_alias_reversed` for Child → Parent). Only when the given target is wrong for the rule and the flip is clean. |
| `resolve_sole_trader` | Source is a Sole Trader; replace with its single active Trades As Individual, then re-evaluate. Zero or several owners → review. Applies to Shareholder, Unit Holder, Trustee, Beneficiary, Partner. |
| `review` | Generic Trust / Unclassified endpoint, or both orientations valid while direction is unknown (`ambiguous_direction`). Never inserted; kept as evidence. |
| `invalid` | Breaks the rulebook. Unknown types are denied by default. |
| `deprecated` | Settlor. Not creatable; kept as evidence only. |

Spouse is the only unordered type (`relationshipIdentityKey`). Partner is directed to a Partnership and is never sorted.

## What is active where

| Path | Status |
|---|---|
| Browser: drag-to-connect picker, entity "Add relationship", relationship edit / reverse, Health scoring, diagram warnings | **Uses the canonical policy in code** (preview only until published). |
| Edge Functions `sync-xpm`, `import-xpm`, `import-xpm-group` | **Not switched yet.** The normaliser is written and tested, but not imported by them. |
| Database trigger, `rel_direction_valid()`, `import_xpm_batch`, `sync_xpm_upsert_clients` | **Old rules still live.** Staged replacements are not applied. |

Why the Edge Functions are not switched in this phase: Edge Function code deploys automatically to the shared backend when it changes. Switching it now would mean live syncs write `trades_as` rows and evidence rows the live database can't accept yet (enum value and table not applied), and call SQL functions that don't exist. That would be a runtime activation, which this phase must not do. `supabase/functions/_shared/xpm-relationships.ts` is still the live XPM rule copy until activation.

Known preview effect: the browser now follows the new rules but the live trigger still follows the old ones. A save the new rules allow but the old trigger rejects (for example Partner → Partnership, Unit Holder → Hybrid Trust, any Trades As) shows the database's error message. Nothing is written in that case.

Trades As lookups happen only when saving a Sole Trader link or a Trades As link. Opening a page never queries `trades_as`. Until the enum is applied, that lookup fails safely and the save is blocked with a review message.

## Activation order (later, approved separately)
1. `phase1/001_add_trades_as_enum.sql` (on its own).
2. `phase1/002_relationship_policy_foundation.sql` — evaluator + evidence table.
3. `phase2/011_evidence_columns.sql` — extra evidence columns.
4. Switch the Edge Functions: build the raw relationship list, call `normaliseXpmBatch()` with `entityTypes`, `provisionalTypes` (from `classifyWithProvenance`) and `tradesAsOwners`, send `edges` as `rels` and `evidence` as `evidence` in the payload. Delete `_shared/xpm-relationships.ts`.
5. `phase2/013_xpm_batch_functions_policy.sql` — `import_xpm_batch` / `sync_xpm_upsert_clients` re-check with the SQL evaluator, de-duplicate Spouse only, write evidence. Entity, archive and capacity logic unchanged.
6. Review existing rows, then run the pre-checks in `phase2/010_activate_uniqueness_constraints.sql` and create the indexes.
7. `phase2/012_activate_policy_trigger.sql` — trigger rejects anything not `valid` as stored; soft deletes and metadata-only edits of legacy rows still pass.
8. Re-baseline Health scoring.

No pending file updates, backfills or deletes existing rows.

## Tests
```
bunx vitest run          # policy, facade parity, pickers, manual planning, XPM normalisation
bun run test:sql         # in-memory Postgres (PGlite, dev-only): applies all pending SQL to a stub
                         # schema, checks 61 vectors + 6,300 TS/SQL combinations, smoke-tests the
                         # trigger and both XPM batch functions. Never connects to a real database.
```
