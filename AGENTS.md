# Engineering rules

- `src/lib/relationshipPolicy.ts` and its SQL twin `relationship_policy_evaluate()` are the sole target/canonical relationship policy, kept in step via `src/test/fixtures/relationship-policy-vectors.json`; they are not yet active at runtime. Legacy runtime validation (`relationshipRules.ts` matrix, `rel_direction_valid()`, `validate_relationship_rules()`, `_shared/xpm-relationships.ts`) is frozen — never edit it; it is removed in Phase 2 — so live behaviour stays stable until the switch-over.
- Unapplied/staged SQL lives in `supabase/pending-migrations/`, never `supabase/migrations/` — files there are treated as applied migrations.
