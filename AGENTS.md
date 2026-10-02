# Engineering rules

- `supabase/functions/_shared/relationship-policy.ts` (re-exported as `src/lib/relationshipPolicy.ts`) and its SQL twin `relationship_policy_evaluate()` are the only relationship rules, kept in step via `src/test/fixtures/relationship-policy-vectors.json` and `bun run test:sql` — one matrix stops browser, imports and database disagreeing. Browser inputs use it now; `src/lib/relationshipRules.ts` is a rule-free facade over it.
- Until database activation is approved, the live XPM Edge Functions and `_shared/xpm-relationships.ts` stay on the old rules and must not be edited, because Edge Function edits deploy immediately and the database cannot accept the new rows yet; the replacement is `_shared/xpm-policy-normalise.ts`.
- Unapplied/staged SQL lives in `supabase/pending-migrations/`, never `supabase/migrations/` — files there are treated as applied migrations.
