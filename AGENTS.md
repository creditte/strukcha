# Engineering rules

- Relationship validity is decided only by `src/lib/relationshipPolicy.ts` and its SQL twin `relationship_policy_evaluate()`, kept in step via `src/test/fixtures/relationship-policy-vectors.json` — one matrix prevents previews, imports and the database disagreeing.
- Unapplied/staged SQL lives in `supabase/pending-migrations/`, never `supabase/migrations/` — files there are treated as applied migrations.
