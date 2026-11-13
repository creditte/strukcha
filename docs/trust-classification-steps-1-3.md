# Trust classification — steps 1–3

Revision: 13/11/2026

## Delivered

- Plain `Trust` no longer creates the `unclassified` issue or its 3-point deduction. Existing disconnected-entity and relationship warnings remain applicable.
- `Trust` is available through the shared entity type list used by Fix Mode and entity editing. `trust_unit` remains valid. Specific-type role checks remain unchanged.
- Original XPM wording travels independently of classification as `xpm_business_structure_label`. Empty/name-only mentions omit it. The client details panel displays it when present.
- Existing keyword/type mappings and manual relationship policy are unchanged. Existing confirmation flow is unchanged; group label writes occur only on confirmed apply, never preview.

## Files

- `src/lib/entityTypes.ts`
- `src/lib/structureScoring.ts`
- `src/hooks/useStructureData.ts`
- `src/components/structure/EntityInfoFields.tsx`
- `supabase/functions/_shared/xpm-business-structure.ts` (new source-label helper)
- `supabase/functions/sync-xpm/index.ts`
- `supabase/functions/import-xpm/index.ts`
- `supabase/functions/import-xpm-group/index.ts`
- `src/lib/healthSemantics.test.ts`
- `src/lib/trustClassification.test.tsx`
- `src/lib/xpmBusinessStructureMigration.test.ts`
- `src/test/setup.ts` (allow isolated Node database tests alongside browser tests)
- `AGENTS.md`, `roadmap.md`, this report; generated database types and migration metadata.

## Applied migration

`drizzle/migrations/0010_preserve_xpm_business_structure_label.sql`

Adds one nullable text column without default or backfill. Adds tenant-scoped label writes to the existing `import_xpm_batch` and `sync_xpm_upsert_clients` functions using checked insertion markers. Function signatures, existing classification/membership/relationship behavior and execution grants are retained. No RLS policies or grants changed. No migration-time client updates occur.

Read-only database verification confirmed the field exists, is nullable, has no default, and has zero populated labels following the migration. Both import functions contain the source-label write, retaining backend-only execution access.

The three changed import/sync functions were deployed successfully. No live import, sync, XPM update or record reclassification was triggered for verification. Frontend changes are in preview and require publishing for the public site.

## Verification

All **327 tests across 15 files passed** (14 added tests).

- Plain Trust and Unit Trust with recorded supported roles score 100 with no review-level issues.
- Plain Trust alone retains only the existing disconnected-entity deduction (98, not the previous 95).
- Fix Mode's save handler sends `entity_type: 'Trust'` using a mocked write; entity editing retains plain Trust and existing Family/Discretionary/Unit classifications.
- Existing keyword mapping continues to classify the custom label `Discretionary Trading Trust` as before; the source-label helper preserves the original wording separately.
- Actual migration label-write blocks were exercised against an isolated PGlite fixture database: import and sync payloads store supplied labels, the other tenant remains untouched, existing specific types remain unchanged, and missing labels/name-only mentions do not fabricate or clear labels. These fixtures do not exercise complete production import RPCs.
- Real React details/edit controls were exercised in a temporary browser-only harness using fictional, unsaved data and a local save callback: original wording visible and plain Trust selected/retained. Desktop/mobile captures reviewed; no authenticated workflow or production write was performed.
- Existing manual/XPM relationship policy tests pass; relationship validation code was not changed.
- Preview build log reports build OK.

## Limitations and scope decisions

- Full signed-in Review & Improve and production import → save → editor readback were not exercised. Doing so would require authorised data writes/XPM activity, outside this task's verification constraints.
- CSV/XML `import-xpm` retains its pre-existing `trust: 'Unclassified'` mapping, as explicitly required by the instruction not to alter import classification behavior in this phase. Such imports now preserve the original `Trust` wording, and users can select plain Trust without a Health classification penalty; mapping unification is deferred to the separately approved next phase.
- Existing original labels remain unknown until supplied by a future normal import/sync or confirmed group apply. No labels were inferred or backfilled.
- A group with no reconciliation changes may not offer Apply solely to populate source wording; future normal sync/import will populate it. The confirmation workflow was not expanded.
- Step 4 remains unimplemented. No existing client types, archive flags, relationships, shareholding or diagram positions were changed by this work.