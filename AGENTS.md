# Engineering rules

- `supabase/functions/_shared/relationship-policy.ts` (re-exported as `src/lib/relationshipPolicy.ts`) and its SQL twin `relationship_policy_evaluate()` are the only relationship rules, kept in step via `src/test/fixtures/relationship-policy-vectors.json` and `bun run test:sql` — one matrix stops browser, imports and database disagreeing. Browser inputs use it now; `src/lib/relationshipRules.ts` is a rule-free facade over it.
- Every XPM path (`sync-xpm`, `import-xpm`, `import-xpm-group`, preview `fetch-xpm-group`) decides relationships only through `_shared/xpm-policy-normalise.ts` and writes one evidence row per raw fact; sync/CSV call the bridge RPCs with `contract: 'canonical_v1'` and the job id as `import_run_id` — so retries never duplicate evidence and no path keeps its own label map.
- Unapplied/staged SQL lives in `supabase/pending-migrations/`, never `supabase/migrations/` — files there are treated as applied migrations.
