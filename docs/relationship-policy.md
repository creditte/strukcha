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

## Payload contracts accepted by the staged 013 bridge
`import_xpm_batch` and `sync_xpm_upsert_clients` (phase2/013) pick a contract per call, so 013 can be applied **before** the Edge Functions change:

| Contract | Detected by | Rels | Evidence |
|---|---|---|---|
| `legacy` | no `evidence` array (today's `import-xpm` / `sync-xpm` payloads) | Old label hints. SQL decides each row with direction unknown (family labels known), swaps a clean `reverse` once, Child → Parent. | Derived in SQL, one row per raw rel. |
| `canonical_v1` | `evidence` array present (or `contract: "canonical_v1"`) | Must be `valid` exactly as sent; anything else is skipped with a warning, never flipped. | Written from the drafts only — never also derived from rels. |

Both: only Spouse is unordered; Partner keeps direction; review / resolve / invalid / deprecated rows are never inserted; soft-deleted rows are never matched or resurrected; existing rows only get missing dates filled. With `import_run_id`, a re-sent chunk writes no duplicate evidence (`dedupe_key`, added in 011). A row refused by the still-live legacy trigger is skipped row-by-row (the chunk still succeeds) and its evidence stays `pending`. Results gain `contract` and `evidenceWritten`; all other counts are unchanged.

Planned Edge payloads: sync sends `rels: [{type, from_uuid, to_uuid, start_date?, end_date?}]` from `edges` and `evidence` from `normaliseXpmBatch()` with XPM UUIDs as ids; CSV import sends `rels: [{row, type, from_key, to_key, label, groups}]` and `evidence` with client names as ids. Trades As owners may be sent as entity ids. Legacy limitation: labels the old parser drops never reach SQL, so they leave no evidence until the switchover.

## Activation runbook (approved separately; nothing here is done yet)
Read-only checks: `docs/relationship-activation-preflight.sql` (READ ONLY, not a migration).

1. Pause XPM jobs (cron + manual sync/import buttons). Verify no active job (preflight block 11 = 0 rows).
2. Run the preflight; record counts.
3. Apply `phase1/001` (on its own), then `phase1/002`, then `phase2/011`. *Rollback boundary A:* all additive — new enum value, functions, empty table. Rollback = leave unused (enum values can't be dropped; harmless).
4. Apply `phase2/013` (bridge). Smoke-test the **legacy** contract: one small CSV import and one single-group sync; check counts match before, and evidence rows appear once. *Rollback boundary B:* re-apply the previous function bodies from `supabase/migrations/20260909202705_…` and `20260917103909_…`.
5. Deploy the three Edge integrations (`sync-xpm`, `import-xpm`, `import-xpm-group`) **together** as one step, deleting `_shared/xpm-relationships.ts`. Smoke-test the **canonical** contract: `contract = canonical_v1`, `evidenceWritten` = raw facts, no derived duplicates. *Rollback boundary C:* redeploy the previous Edge code; 013 still accepts legacy payloads.
6. Resume XPM jobs.
7. Remediate current live rows (separately approved: Spouse duplicates, Child → Parent incl. collisions, deterministic reversals, invalid rows, Sole Trader sources). History rows are not touched.
8. Re-run preflight blocks 1–2; only when both are 0, run `phase2/010` (CONCURRENTLY, outside a transaction). *Rollback:* drop the two indexes.
9. Apply `phase2/012` last. *Rollback boundary D:* re-apply the previous `validate_relationship_rules()` / `rel_direction_valid()` bodies.
10. Re-baseline Health scoring.

Between steps 5 and 9 the old trigger still refuses some rows the new policy allows (e.g. Partner → Partnership, Trades As); they stay as `pending` evidence and are created on the next sync after 012.

No pending file updates, backfills or deletes existing rows.

## Tests
```
bunx vitest run          # policy, facade parity, pickers, manual planning, XPM normalisation
bun run test:sql         # in-memory Postgres (PGlite, dev-only): applies all pending SQL to a stub
                         # schema, checks 61 vectors + 6,300 TS/SQL combinations, smoke-tests the
                         # trigger and both XPM batch functions. Never connects to a real database.
```
