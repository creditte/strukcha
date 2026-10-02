# Stabilising Xero, group selection and XPM report upload

A single sequenced program of work covering the three areas that still cause problems: the Xero connection itself, the "Choose groups" experience, and the XPM report upload (CSV/XML import). Each phase is independently shippable and testable.

## Phase 1 — Xero connection durability (highest impact)

1. One connection per firm. Today each staff member can connect their own Xero organisation to the same firm and the sync silently uses the most recent one. Make the connection firm-owned: a new connection replaces the previous one, disconnect removes the firm's connection, and the dashboard names who connected it.
2. Warn before a connection lapses. The weekly keep-alive renews idle connections, but nothing tells the firm when renewal fails. Send an email to the owner and admins the first time a connection is marked as needing reconnection, and show the reason and date in Integrations.
3. Cooling-off after repeated failures. After an authorisation failure, block a new sync for a short period instead of allowing immediate retries, and show the wait time on the button.
4. Clean up legacy records: re-encrypt or remove the one old record holding unprotected keys, and tie the firm reference on the connection table properly to the firms table.

## Phase 2 — Choose groups behaviour

5. Remove the chicken-and-egg on first use. A brand-new firm opening "Choose groups" sees an empty list telling them to sync, but syncing without a selection creates nothing. Add a catalogue-only first pass that loads the group list without building diagrams, triggered automatically when the list is empty.
6. Show the true totals. The dialog counts only loaded rows; load the full count and page the list so large firms (900+ groups) can search everything reliably.
7. Warn on un-ticking. Un-ticking a group leaves its existing diagram behind, never refreshed again. Say so in the dialog and offer to archive those diagrams.
8. Protect unsaved changes. Prompt before closing the dialog with unsaved ticks, and after saving, prompt to run a sync and refresh the dashboard counts.
9. Make capacity honest at selection time. Show remaining room, which newly ticked groups would be skipped, and keep blocked groups clearly listed after a run.

## Phase 3 — XPM report upload (audit then fix)

10. Audit the upload path end to end: file parsing for both CSV and XML, group detection, duplicate handling, entity matching, ownership fields, capacity pre-check, progress reporting and failure recovery. Record findings before changing behaviour.
11. Fix what the audit finds, expected to include: preserving ownership percentages that are currently dropped, matching entities by Xero identifier first with a constrained fallback, keeping renamed entities instead of creating duplicates, and clearer messages when part of a file is skipped.
12. Make interrupted uploads resumable and visible, the same way sync now resumes, so a large file never leaves a half-finished import with no explanation.

## Phase 4 — Data quality and verification

13. Deduplicate existing groups and entities created by earlier runs, and add the constraint that prevents recurrence.
14. Reconciliation view for a firm: groups catalogued, groups selected, diagrams built, groups blocked and why, last successful run.
15. Full supervised validation on the live firm: catalogue pass, selection, sync, upload of a large report, disconnect and reconnect.

## Technical detail

- Connection ownership: `xero_connections` becomes firm-scoped (unique active row per firm, `tenant_id` typed as a real reference); `loadXeroConnection()` and the XPM callers drop the "most recent per user" ordering.
- Lapse warnings: new transactional template plus a send when `status` flips to `needs_reauth` in `_shared/xero-token.ts`; surfaced through `get_xero_connection_info()`.
- Cooldown: checked in `sync-xpm` before claiming a job, mirroring the existing capacity preflight, using `last_error_at`.
- Catalogue-only pass: a sync mode that runs the clients and groups phases and skips diagram creation, invoked from `XpmGroupSelectionDialog` when `xpm_groups` is empty.
- Group list: server-side count and paged/`ilike` search instead of loading all rows client-side.
- Upload: `import-xpm` and `import_xpm_batch` reviewed against the sync path; ownership captured from XPM relationship fields into `relationships.ownership_percent`; job state persisted in `import_logs` with resumable slices.
- Constraints: unique `(tenant_id, xpm_uuid)` on live rows for both groups and entities, added after dedupe.

## Out of scope

Separating preview and published data into different backends, and any Stripe or pricing change.
