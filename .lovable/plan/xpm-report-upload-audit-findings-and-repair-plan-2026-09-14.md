# XPM report upload — audit findings and repair plan

The upload page (`/import`) accepts an XPM Client Relationships Report as CSV or XML, creates a background job, and builds entities, relationships and one structure per client group. This is an audit of that whole path plus a fix list, with emphasis on large files, structure limits for firms other than creditte, layout, and production-grade error handling.

## What works correctly today

- CSV and XML are both parsed in a single pass; a large file is not re-parsed per slice.
- Work runs as a resumable background job in `import_logs`, sliced (2,000 rows), with a fresh worker chained before the time budget runs out.
- All database work for a slice is one call, so throughput is good.
- Entity matching prefers the XPM identifier and falls back to name; a matched record is updated, not duplicated. Unclassified types are upgraded when a better type appears.
- Structure creation shares one capacity rule with the XPM sync, honours the permanent unlimited override, and reports how many groups were skipped rather than failing the whole run.
- Progress is monotonic (never jumps backwards), abandoned jobs are failed after 10 idle minutes, and history lists the last 20 runs.

## What is broken or missing

**Large files**
1. The whole file is sent as one JSON string and stored in the job row. A big export can be rejected outright by the request size limit, and the user only sees a generic failure. No size check, no guidance, no chunked upload.
2. The pre-import check reads the file twice (once to analyse, once to send) and holds both copies; on very large files the browser tab can stall with no feedback beyond "Checking the file…".
3. The 20-minute poll gives up with a message telling the user to check history, but history rows are not clickable and never show why a run ended early.
4. Polling is a fixed 0.9s query for up to 20 minutes with no backoff and no resume after a page refresh — reloading during an import loses all progress feedback even though the job continues.

**Structure limits for firms other than creditte**
5. The pre-import check counts existing structures by name only, ignores archived structures, is not tenant-filtered explicitly, and never asks the server for real capacity — so the number of "free slots" shown can be wrong. The authoritative capacity helper is server-side and unused by the page.
6. Groups skipped for capacity are counted but never named, so the user cannot tell which clients are missing.
7. When the subscription itself is inactive the server distinguishes that from a plain limit, but the page shows both as "structure limit reached".
8. Import is blocked when the file does not fit, with no option to import the part that does fit, and no direct link to archive structures or upgrade.

**Error handling**
9. Upload errors are routed through the Xero error helper, so a plain file or database problem can surface as Xero wording and can wrongly flip the Xero connection into a reconnect state.
10. Raw server messages ("Import batch failed: …", Postgres text) reach the user verbatim. There is no mapping to plain, actionable messages, and no reference the user can quote to support.
11. No validation of the file before sending: wrong report type, missing required columns, empty rows, or a file that is not really an XPM export all fail late with an unhelpful message.
12. Warnings are dumped as an unbounded red list of up to 200 raw row messages, with no grouping, no counts and no download.
13. A failed run offers Retry, but retry re-sends the whole file from the start instead of resuming the existing job.

**UI / layout (explicitly requested)**
14. "How to export from XPM" sits above the upload box as a full-width collapsible; the upload card is a narrow `max-w-lg` column. The instructions should sit to the right of the upload area.

## Plan of work

### 1. Layout rebuild
Two-column page on desktop: upload and its status on the left, "How to export from XPM" as a persistent (not collapsed) side panel on the right with the numbered steps and the sample-CSV download. Stacks to one column on mobile, instructions below. Import result and history stay full width beneath.

### 2. Honest capacity, for every firm
Ask the server for capacity instead of guessing client-side; report used, limit and remaining, and treat the unlimited override as no cap. Distinguish "plan limit reached" from "subscription inactive" with different wording and actions. Name the groups that would not fit (first few plus a count), and offer either "import what fits" or links to archive structures / upgrade.

### 3. Large-file handling
Reject files above a safe size before upload with a clear message and instructions to export in smaller group batches. Read the file once. Show record counts and an estimated duration. Replace fixed polling with backoff, and resume tracking a running job after a page refresh so a reload never loses the progress view.

### 4. Production-grade error handling
Stop routing upload errors through the Xero path. Add an import-specific message map covering: file too large, unreadable or wrong report, missing columns, no records, unauthorised, capacity blocked, subscription inactive, network dropout, worker timeout, and database failure — each with a plain sentence, a next action, and a short reference code. Keep the technical detail behind a "Details" toggle. Failed jobs resume from the last completed slice instead of restarting.

### 5. Warnings and results
Group warnings by kind (unknown relationship type, unresolved entity, skipped group) with counts and a sample, expandable, plus "Download warnings as CSV". Result card summarises created/updated/skipped clearly and links to the structures created.

### 6. History
Make each history row expandable to show counts, skipped groups, warnings and the failure reason, and let a failed or interrupted run be resumed or retried from there.

### 7. Verification
Small clean file; file with unknown relationship types; file with more groups than remaining slots on a limited (non-creditte) firm; oversized file; forced mid-run failure then resume; page refresh during a run.

## Technical detail

- `src/pages/Import.tsx` split into components: upload panel, export-instructions panel, progress strip, result summary, history table. Capacity read via a new tenant-scoped capacity read (service-side helper exposed through an RPC or `check-subscription`, since `tenant_structure_capacity` is service-role only).
- New `src/lib/importErrors.ts` mirroring the shape of `xeroErrors.ts` but for import failures; `Import.tsx` stops calling `reportXeroError`/`xeroToastPayload` and stops rendering `XeroErrorAlert`.
- `import-xpm`: return structured `{ code, message, detail }` errors instead of raw strings; carry `blockedGroups` and `limitCode` through job progress alongside the existing `structuresSkippedLimit`; accept a resume request for an existing `jobId`.
- Client-side file guard before invoke (size and header/tag sanity), so oversized or wrong-format files never reach the function.
- Polling moves to React Query with exponential backoff and a stored active job id, so refresh re-attaches.

## Out of scope

XPM sync itself, Xero connection work, Stripe or pricing changes, and any change to entity-matching rules beyond error reporting.
