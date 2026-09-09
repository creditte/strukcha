# Xero connection audit — findings and repair plan

Read-only audit of the Xero sign-in, connect, disconnect, and Practice Manager sync paths, plus the live connection records and sync history. Nothing was changed.

## What works today

- Connecting: sign-in link, organisation picker when several organisations are available, and saving of the connection all work end to end.
- Access keys are stored encrypted, and no user of the app can read them directly.
- Practice Manager sync runs in the background with live progress, resumes across runs, skips unchanged client groups, and respects plan limits.
- Choosing which client groups become diagrams works.
- Error messages are translated into plain English and a "reconnect" banner appears when the connection looks broken.

## Confirmed problems (highest impact first)

**1. Disconnect never actually removes the app from Xero.**
The disconnect step sends the stored key to Xero in its encrypted form instead of its real form, so Xero rejects both the "remove organisation" and "forget this app" calls. The record disappears from strukcha, but the firm still sees strukcha listed under Connected Apps in Xero. This is also a Xero app-certification requirement, so it must be fixed.

**2. Connections die permanently and cannot recover on their own.**
Xero's renewal key is single-use. Six separate places in the app renew it independently with no coordination, so two overlapping runs can burn the same key. This already happened: the creditte firm's connection failed twice on 9 September with "renewal key already used", and it has stayed broken since. There is no automatic detection, and nothing records that the connection is dead.

**3. Organisations without Practice Manager are accepted at connect time.**
Nothing checks that the chosen Xero organisation actually has Practice Manager. The test firm connected an organisation without it, and every sync since then has failed — 10 of the last 12 sync runs ended in "Unauthorized". The user is only told after a failed sync, not at the moment of connecting.

**4. The "connection is broken" state is not remembered.**
It exists only in the current browser tab, so a page refresh, a second device, or another staff member sees a healthy-looking connection that cannot work.

**5. Idle connections expire silently.**
Xero drops a connection after 60 days without use, and there is no background renewal, so firms that pause come back to a dead connection with no warning.

**6. Repeated failures pile up with no cooling-off.**
23 sync runs have failed and only one has ever completed. Five failed runs happened within a single minute because nothing stops an immediate retry after an authorisation failure.

**7. Multiple staff connections are ambiguous.**
Each staff member can connect their own organisation to the same firm; sync silently uses the most recent one, and disconnect only removes that person's link.

**8. Housekeeping gaps.**
One old record still holds unencrypted keys, the firm reference on the connection table is stored as loose text with no link to the firms table, and two internal diagnostic functions are still live with key-renewal powers.

## Repair plan

**Phase 1 — correctness and compliance**
1. Decrypt keys before calling Xero in the disconnect step; verify against Xero's Connected Apps list; surface a clear message if Xero refuses.
2. Replace the six copies of the renewal logic with one shared helper that renews under a short database lock, so overlapping runs cannot burn the key twice.
3. On any "renewal key already used" or "unauthorised" answer, mark the connection as needing reconnection and stop the run cleanly with a reconnect prompt.

**Phase 2 — prevent bad connections**
4. At connect time, confirm the chosen organisation exposes Practice Manager; if it does not, refuse to save it and explain what the firm needs to authorise.
5. Store what the connection was authorised for, so the app knows what it can do before calling Xero.

**Phase 3 — durability and clarity**
6. Persist connection health (state, last failure, time) so the reconnect prompt is consistent for every user and device.
7. Add a scheduled keep-alive renewal well inside the 60-day window, plus an email warning when a connection is about to lapse.
8. Add a short cooling-off period after an authorisation failure, and clean up the stale failed-run records.

**Phase 4 — hygiene**
9. Re-encrypt or remove the legacy plaintext record, tighten the firm reference on the connection table, and one connection per firm rather than per user.
10. Remove or lock down the internal diagnostic functions.

## Technical detail

- Broken disconnect: `supabase/functions/xero-disconnect/index.ts` passes `conn.access_token` / `conn.refresh_token` (ciphertext from `_shared/crypto.ts`) to `DELETE https://api.xero.com/connections/{id}` and `POST /connect/revocation`; needs `decryptToken()` first. Failures only append to `revokeWarnings`, which the UI ignores.
- Duplicated refresh: `sync-xpm/_lib.ts:144`, `list-xpm-groups/index.ts:13`, `fetch-xpm-group/index.ts:27`, `import-xpm-group/index.ts:23`, `xero-debug/index.ts:28`, `xpm-diagnostic/index.ts:22`. Proposed `_shared/xero-token.ts` with `getAccessToken(supabase, connection)` using an advisory lock or `update ... where updated_at = <expected>` guard plus re-read on contention.
- Evidence: `import_logs` where `file_name='xpm-sync-3.1'` — 23 `failed`, 1 `completed`; errors `invalid_grant: Refresh token has been consumed` (tenant `f0e4888d…`, 18:00 and 20:38 on 09/09/2026) and `401 AuthorizationUnsuccessful` (tenant `1719ba8c…`, five runs between 21:23 and 21:48).
- Missing schema: `xero_connections` has no `connection_type`, `scopes`, `status`, `last_error`, `invalidated_at`; `tenant_id` is `text` with no FK (joins to `tenants` need a cast); row `0f2c12d1…` has unencrypted tokens and `decryptToken()` accepts them silently.
- Scope selection already exists in `xero-auth`, `xero-login-auth`, `xero-signup-auth` (`practicemanager.client.read` vs `accounting.contacts.read`) but the chosen type is never persisted; `xero-callback` and `xero-finalise-connection` ignore `tenantType` from `GET /connections`.
- Client-side invalid state lives in `src/contexts/XeroConnectionContext.tsx` React state only; make `get_xero_connection_info()` return persisted health.
- Retry throttling belongs in `sync-xpm` entry (before claiming a job) and mirrors the existing capacity preflight pattern.

## Out of scope for this plan

Ownership-percentage capture from XPM relationships (identified in the earlier data audit) is a separate data-completeness item, not a connection fault.
