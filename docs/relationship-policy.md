# Relationship policy (Rulebook v1) — developer notes

## Where it lives
- `src/lib/relationshipPolicy.ts` — the sole target/canonical policy. **Not yet active at runtime in Phase 1**: nothing in the app, XPM functions or database calls it.
- `supabase/pending-migrations/phase1/002_relationship_policy_foundation.sql` — SQL twin `public.relationship_policy_evaluate()`.
- `src/test/fixtures/relationship-policy-vectors.json` — shared hand-written vectors; both sides must match them.
- Legacy runtime validation — still what actually decides today: the direction matrix in `src/lib/relationshipRules.ts` (Health scoring, pickers), `supabase/functions/_shared/xpm-relationships.ts` (XPM), and the DB trigger `validate_relationship_rules()` / `rel_direction_valid()`. All are **frozen: do not edit**. They are removed in Phase 2. Only labels in `relationshipRules.ts` already come from the policy.

## Outcomes
`evaluateRelationship(type, fromDbType, toDbType, { directionKnown })` returns
`{ outcome, reason, canonicalType, swapped, fromType, toType }`.

| outcome | meaning |
|---|---|
| `valid` | Store as given. |
| `reverse` | Store with from/to swapped (`auto_reversed`, or `child_alias_reversed` for Child → Parent). Only when the given target is wrong for the rule and the flip is clean. |
| `resolve_sole_trader` | Source is a Sole Trader; replace with its Trades As Individual. |
| `review` | Generic Trust / Unclassified endpoint, or both orientations valid while direction is unknown (`ambiguous_direction`). Keep as evidence, never guess. |
| `invalid` | Breaks the rulebook (`invalid_source`, `invalid_target`, `bare_trust_source_restricted`, `unknown_relationship_type`). Unknown types are denied by default. |
| `deprecated` | Settlor. Not creatable. |

Spouse is the only symmetric type (`relationshipIdentityKey` sorts it). Partner is directed to a Partnership.

## Why the SQL is not applied in Phase 1
The files sit in `supabase/pending-migrations/`, outside `supabase/migrations/`, so no tooling applies them. Phase 1 must not change production: the live trigger `validate_relationship_rules()` / `rel_direction_valid()` and the XPM import paths still use the v0 rules, and switching would reject current inputs (e.g. Member from a Company, Appointor to a Unit Trust, Partner between individuals) before the callers know how to handle `review` / `resolve_sole_trader`. The uniqueness indexes (`phase2/010_…`) may also fail against existing duplicate rows.

## Phase 2 plan
1. Apply `phase1/001` (enum value) then `phase1/002` (evaluator + evidence table). Both are additive.
2. Route manual inputs (`EntityAddRelationshipForm`, `RelationshipTypePicker`, `RelationshipDetailPanel`) and the facade through `evaluateRelationship`.
3. Port the evaluator to `supabase/functions/_shared` (or call the SQL function) for `sync-xpm`, `import-xpm`, `import-xpm-group`, passing `directionKnown: false` for ambiguous XPM labels and writing every row to `relationship_import_evidence`.
4. Add a DB parity test running the vectors file against `relationship_policy_evaluate()`.
5. Backfill/review existing rows, run the pre-checks in `phase2/010`, create the indexes, then replace the trigger to call `relationship_policy_evaluate()`.
6. Re-baseline Health scoring.

## Tests
```
bunx vitest run
```
SQL parity was checked in Phase 1 with an in-memory Postgres (PGlite): all 61 vectors and all 6,300 type × type × direction combinations match the TypeScript.
