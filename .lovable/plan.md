# Health Check & Review and Improve — audit and repair plan

## What these pages do today

Both pages (Structure Health, Review & Improve) and the Dashboard health card all call the same
in-memory hook `useClientHealthReview`. It loads every structure in the firm, then every
structure-entity link, structure-relationship link, entity and relationship, and scores each
structure in the browser.

## Findings (verified by reading the code and counting rows)

Row counts in the shared database right now: 1,339 active non-scenario structures, 3,205
structure-entity links, 2,216 structure-relationship links, 6,127 entities, 4,975 relationships.

1. **Request fan-out is the likely cause of the endless skeleton.** `fetchAllByIds` splits ids
   into 150-id chunks and runs every chunk *sequentially*. At current volume that is roughly
   9 + 15 chunks for the link tables plus ~41 entity chunks and ~33 relationship chunks — around
   100 sequential round trips before anything renders, on top of paging the structures list.
   Nothing renders partial results, so the page shows a skeleton for the whole duration.
   (Diagnosis is inferred from code + row counts; step 1 measures it before changing anything.)
2. **Paged reads have no stable sort.** Each `.in(...).range(from, to)` call omits `order()`, so
   Postgres may return rows in a different order per page — pages can duplicate or skip rows,
   silently producing wrong scores on any table that exceeds 1,000 rows.
3. **No caching and no cancellation.** The hook uses plain `useState`, not React Query, so every
   visit to Health Check, Review & Improve and the Dashboard restarts the whole load. Leaving the
   page mid-run leaves the request chain running and writes state into an unmounted component.
   Two mounts (or a Re-run click during a run) start overlapping runs with no guard.
4. **Scoring blocks the UI thread.** `computeHealthScoreV2` runs once per structure in a tight
   loop after the fetches; at ~1,300 structures this freezes the tab, which reads as "stuck".
5. **Health Check has no error state.** `ClientGovernance` destructures only `review, loading,
   runReview` and ignores `error`; on failure it silently falls back to the empty hero (Review &
   Improve does show an error).
6. **Label thresholds disagree.** The on-page legend says 90–100 Healthy / 50–89 Needs attention /
   <50 Critical, while `getFriendlyLabel` uses 90 / 70 / 41 bands, so a structure scoring 75 is
   labelled "Minor gaps" under a legend that calls it "Needs attention".
7. **"Structures changed" check is misleading.** It compares the newest `structures.updated_at`
   against the review timestamp; any unrelated edit (rename, layout move) permanently shows the
   re-run warning.
8. **Duplicates tab is a separate, unbounded query path.** `DuplicatesTab` re-fetches its own
   profile + both duplicate RPCs on every mount (no cache, unlike the sidebar count), then builds
   one giant `.or(from_entity_id.eq...,to_entity_id.eq...)` filter string across every candidate
   entity — that URL grows with the duplicate set and will eventually be rejected. Dismissals live
   only in this browser's local storage.

## Sequential tasks

1. **Measure first.** Instrument a timed run of the health review (request count, wall clock per
   phase, scoring time) against the real firm and record the numbers. Confirm the stall is fetch
   fan-out plus scoring, not an error being swallowed.
2. **Fix read correctness.** Add a deterministic `order("id")` to every paged read in
   `useClientHealthReview` so paging cannot duplicate or drop rows.
3. **Move the aggregation server-side.** Add a read-only Postgres function that returns, per
   structure, the entity and relationship rows the scorer needs (or the scored summary itself),
   scoped by RLS to the caller's firm, in one call. Replace the ~100 sequential round trips with
   that single call; keep the client scorer as the source of truth for issue text if the SQL only
   returns raw rows.
4. **Cache and guard the hook.** Move the review into React Query under a firm-scoped key with a
   sensible stale time, shared by Dashboard, Health Check and Review & Improve, with an
   in-flight guard so a second mount or a Re-run click reuses the running request instead of
   starting another, and abort/ignore results after unmount.
5. **Keep the UI responsive.** Chunk or yield during scoring (batch with `requestIdleCallback` or
   slice the loop) and show progress ("scored 400 of 1,339") instead of a static skeleton, with a
   hard timeout that surfaces an error rather than an infinite skeleton.
6. **Surface errors on Health Check.** Consume `error` in `ClientGovernance` and show the same
   failure card + "Try again" that Review & Improve now has.
7. **Align labels and thresholds.** Make `getFriendlyLabel`, `getHealthStatus`, the legend and the
   dial label read from one shared band definition so score bands and wording always agree.
8. **Tighten the re-run hint.** Base "structures have changed" on changes to entities and
   relationships inside structures (or a stored content hash), not on any `structures.updated_at`
   touch.
9. **Repair the Duplicates tab.** Reuse the cached tenant id and duplicate results instead of
   re-querying per mount, replace the giant `.or(...)` filter with chunked `in()` lookups (or a
   server-side count), and move dismissals from local storage to a firm-level table so they
   persist per firm rather than per browser.
10. **Verify end to end.** Signed-in run through Dashboard health card, Health Check and Review &
    Improve on the large firm: confirm first paint under a few seconds, identical scores on all
    three surfaces, correct counts after a merge, and no infinite skeleton on failure.

## Technical notes

- Files in scope: `src/hooks/useClientHealthReview.ts`, `src/pages/ClientGovernance.tsx`,
  `src/pages/Review.tsx`, `src/pages/Dashboard.tsx`, `src/lib/structureScoring.ts`,
  `src/components/review/DuplicatesTab.tsx`, plus one new read-only database function and one
  small table for duplicate dismissals (RLS + grants).
- No changes to scoring rules, Stripe, XPM sync or import in this plan; scores must be identical
  before and after, which step 10 checks.
