/**
 * Shared XPM read-retry and group-completeness rules, used by both
 * `import-xpm-group` and the full `sync-xpm` group phase so the two paths can't
 * drift. A group is never reconciled from a partial set of member records.
 *
 * Pure (no Deno / network imports) so it is unit-tested from Vitest.
 */

export const XPM_MAX_ATTEMPTS = 4;
export const XPM_BACKOFF_BASE_MS = 1000;
export const XPM_BACKOFF_CAP_MS = 8000;

/**
 * Delay before the next attempt, or null when the failure is not worth
 * retrying (or attempts are used up). `attempt` is 1-based (the one that just
 * failed). `status` is the HTTP status, or "network" for a thrown fetch.
 */
export function xpmRetryDelayMs(
  status: number | "network",
  attempt: number,
  retryAfterHeader: string | null = null,
  maxAttempts = XPM_MAX_ATTEMPTS,
): number | null {
  if (attempt >= maxAttempts) return null;
  const transient = status === "network" || status === 429 || status >= 500;
  if (!transient) return null;
  const retryAfter = Number(retryAfterHeader);
  const backoff = XPM_BACKOFF_BASE_MS * 2 ** (attempt - 1);
  const wait = status === 429 && Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : backoff;
  return Math.min(wait, XPM_BACKOFF_CAP_MS);
}

export type FetchOutcome = { ok: true; text: string } | { ok: false; status: number | "network" };

/** GET with bounded exponential backoff on 429 / 5xx / network failures. */
export async function fetchXpmWithRetry(
  doFetch: () => Promise<Response>,
  opts: { maxAttempts?: number; sleep?: (ms: number) => Promise<void> } = {},
): Promise<FetchOutcome> {
  const maxAttempts = opts.maxAttempts ?? XPM_MAX_ATTEMPTS;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  for (let attempt = 1; ; attempt++) {
    let status: number | "network";
    let retryAfter: string | null = null;
    try {
      const res = await doFetch();
      if (res.ok) return { ok: true, text: await res.text() };
      status = res.status;
      retryAfter = res.headers.get("retry-after");
      await res.body?.cancel();
    } catch {
      status = "network";
    }
    const wait = xpmRetryDelayMs(status, attempt, retryAfter, maxAttempts);
    if (wait === null) return { ok: false, status };
    await sleep(wait);
  }
}

/**
 * Read every member record with bounded concurrency. `readOne` returns the
 * parsed record or null when it could not be read or parsed (after its own
 * retries). Any null makes the group incomplete.
 */
export async function readGroupMemberRecords<T>(
  memberUuids: string[],
  readOne: (uuid: string) => Promise<T | null>,
  concurrency = 10,
): Promise<{ records: T[]; failed: string[] }> {
  const records: T[] = [];
  const failed: string[] = [];
  for (let i = 0; i < memberUuids.length; i += concurrency) {
    const batch = memberUuids.slice(i, i + concurrency);
    const results = await Promise.all(batch.map(async (uuid) => {
      try { return await readOne(uuid); } catch { return null; }
    }));
    results.forEach((r, j) => (r === null ? failed.push(batch[j]) : records.push(r)));
  }
  return { records, failed };
}

export interface MemberFetchFailure {
  code: "xpm_member_fetch_failed";
  group_uuid: string;
  group_name: string;
  failed_member_uuids: string[];
  message: string;
}

/** Null when complete; otherwise the explicit failure to report (and no writes). */
export function memberFetchFailure(
  group: { uuid: string; name: string },
  failed: string[],
): MemberFetchFailure | null {
  if (failed.length === 0) return null;
  return {
    code: "xpm_member_fetch_failed",
    group_uuid: group.uuid,
    group_name: group.name,
    failed_member_uuids: [...failed],
    message: `${failed.length} client record(s) in group "${group.name}" could not be read from XPM, so this group was left unchanged. It will be tried again next sync.`,
  };
}

// ── Full-sync group phase orchestration ─────────────────────────────

export type GroupSyncStatus =
  | "refreshed"
  | "skipped_recent"
  | "skipped_conflict"
  | "failed_incomplete"
  | "failed"
  | "limit_reached";

export interface GroupSyncCounts {
  refreshed: number;
  skippedRecent: number;
  skippedConflict: number;
  failedIncomplete: number;
}

/** Split a slice into groups to re-read and groups left alone for freshness. */
export function splitByFreshness<G extends { lastSyncedAt: string | null }>(
  slice: G[],
  fullRefresh: boolean,
  freshBeforeMs: number,
): { due: G[]; skippedRecent: G[] } {
  if (fullRefresh) return { due: slice, skippedRecent: [] };
  const due: G[] = [];
  const skippedRecent: G[] = [];
  for (const g of slice) {
    if (g.lastSyncedAt && new Date(g.lastSyncedAt).getTime() >= freshBeforeMs) skippedRecent.push(g);
    else due.push(g);
  }
  return { due, skippedRecent };
}

export interface GroupSyncDeps<G> {
  /** Membership from XPM; null when the group itself could not be read. */
  fetchMembers: (g: G) => Promise<{ members: string[]; hash: string } | null>;
  /** Members whose record this sync has not already read in full. */
  findUnread: (members: string[]) => Promise<string[]>;
  /** Targeted read of one member record (with retries); null = unreadable. */
  readMember: (uuid: string) => Promise<unknown | null>;
  /** Only ever called for a complete group. */
  reconcile: (g: G, members: string[], hash: string) => Promise<GroupSyncStatus>;
  /** Errors that must stop the whole run (auth, cancellation, database step). */
  isFatal?: (e: unknown) => boolean;
}

/**
 * Process groups one at a time. A failure in one group never stops or affects
 * another; an incomplete group is never passed to `reconcile`.
 */
export async function syncGroupsSafely<G extends { uuid: string; name: string }>(
  groups: G[],
  deps: GroupSyncDeps<G>,
): Promise<{ results: { group: G; status: GroupSyncStatus; failure?: MemberFetchFailure }[] }> {
  const results: { group: G; status: GroupSyncStatus; failure?: MemberFetchFailure }[] = [];
  for (const g of groups) {
    try {
      const fetched = await deps.fetchMembers(g);
      if (!fetched) {
        results.push({ group: g, status: "failed_incomplete", failure: memberFetchFailure(g, ["(group membership)"])! });
        continue;
      }
      const unread = await deps.findUnread(fetched.members);
      const { failed } = await readGroupMemberRecords(unread, deps.readMember);
      const failure = memberFetchFailure(g, failed);
      if (failure) { results.push({ group: g, status: "failed_incomplete", failure }); continue; }
      results.push({ group: g, status: await deps.reconcile(g, fetched.members, fetched.hash) });
    } catch (e) {
      if (deps.isFatal?.(e)) throw e;
      results.push({ group: g, status: "failed" });
    }
  }
  return { results };
}
