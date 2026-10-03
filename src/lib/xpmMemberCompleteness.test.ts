import { describe, expect, it, vi } from "vitest";
import {
  fetchXpmWithRetry,
  memberFetchFailure,
  readGroupMemberRecords,
  splitByFreshness,
  syncGroupsSafely,
  xpmRetryDelayMs,
} from "../../supabase/functions/_shared/xpm-member-completeness.ts";

const res = (status: number, body = "", headers: Record<string, string> = {}) =>
  new Response(status === 204 ? null : body, { status, headers });
const noSleep = async () => {};

describe("retry rules", () => {
  it("retries 429/5xx/network with bounded exponential backoff", () => {
    expect(xpmRetryDelayMs(500, 1)).toBe(1000);
    expect(xpmRetryDelayMs(503, 2)).toBe(2000);
    expect(xpmRetryDelayMs("network", 3)).toBe(4000);
    expect(xpmRetryDelayMs(429, 1, "60")).toBe(8000); // capped
    expect(xpmRetryDelayMs(429, 4)).toBeNull(); // attempts exhausted
    expect(xpmRetryDelayMs(404, 1)).toBeNull();
    expect(xpmRetryDelayMs(401, 1)).toBeNull();
  });

  it("transient failures then success returns the record", async () => {
    const f = vi.fn()
      .mockResolvedValueOnce(res(429))
      .mockResolvedValueOnce(res(502))
      .mockRejectedValueOnce(new Error("reset"))
      .mockResolvedValueOnce(res(200, "<ok/>"));
    const out = await fetchXpmWithRetry(f, { sleep: noSleep });
    expect(out).toEqual({ ok: true, text: "<ok/>" });
    expect(f).toHaveBeenCalledTimes(4);
  });

  it("gives up after the bounded number of attempts", async () => {
    const f = vi.fn().mockImplementation(async () => res(503));
    const out = await fetchXpmWithRetry(f, { sleep: noSleep });
    expect(out).toEqual({ ok: false, status: 503 });
    expect(f).toHaveBeenCalledTimes(4);
  });
});

describe("member completeness", () => {
  it("reports every unreadable member", async () => {
    const { records, failed } = await readGroupMemberRecords(["a", "b", "c"], async (u) =>
      u === "b" ? null : u === "c" ? Promise.reject(new Error("parse")) : { u });
    expect(records).toEqual([{ u: "a" }]);
    expect(failed).toEqual(["b", "c"]);
    const f = memberFetchFailure({ uuid: "G1", name: "J Rowe Group" }, failed)!;
    expect(f.code).toBe("xpm_member_fetch_failed");
    expect(f.group_uuid).toBe("G1");
    expect(f.failed_member_uuids).toEqual(["b", "c"]);
    expect(memberFetchFailure({ uuid: "G1", name: "x" }, [])).toBeNull();
  });
});

describe("full-sync group phase", () => {
  const groups = [{ uuid: "G1", name: "Bad" }, { uuid: "G2", name: "Good" }, { uuid: "G3", name: "Conflict" }];

  it("never reconciles an incomplete group and continues with unrelated groups", async () => {
    const reconcile = vi.fn(async (g: { uuid: string }) => (g.uuid === "G3" ? "skipped_conflict" : "refreshed") as const);
    const { results } = await syncGroupsSafely(groups, {
      fetchMembers: async (g) => ({ members: g.uuid === "G1" ? ["m1", "m2"] : ["m3"], hash: "h" }),
      findUnread: async (m) => m,
      readMember: async (u) => (u === "m2" ? null : true),
      reconcile,
    });
    expect(reconcile).toHaveBeenCalledTimes(2);
    expect(reconcile.mock.calls.map((c) => c[0].uuid)).toEqual(["G2", "G3"]);
    expect(results.map((r) => r.status)).toEqual(["failed_incomplete", "refreshed", "skipped_conflict"]);
    expect(results[0].failure?.failed_member_uuids).toEqual(["m2"]);
  });

  it("an unreadable group membership is incomplete with zero writes", async () => {
    const reconcile = vi.fn();
    const { results } = await syncGroupsSafely([groups[0]], {
      fetchMembers: async () => null, findUnread: async () => [], readMember: async () => true, reconcile,
    });
    expect(reconcile).not.toHaveBeenCalled();
    expect(results[0].status).toBe("failed_incomplete");
  });

  it("members already read by the sweep need no extra request", async () => {
    const readMember = vi.fn(async () => true);
    await syncGroupsSafely([groups[1]], {
      fetchMembers: async () => ({ members: ["m3"], hash: "h" }), findUnread: async () => [],
      readMember, reconcile: async () => "refreshed",
    });
    expect(readMember).not.toHaveBeenCalled();
  });

  it("an unexpected per-group error is isolated, but fatal errors stop the run", async () => {
    class Fatal extends Error {}
    const deps = {
      fetchMembers: async (g: { uuid: string }) => {
        if (g.uuid === "G1") throw new Error("boom");
        return { members: [], hash: "h" };
      },
      findUnread: async () => [], readMember: async () => true, reconcile: async () => "refreshed" as const,
    };
    const { results } = await syncGroupsSafely(groups.slice(0, 2), deps);
    expect(results.map((r) => r.status)).toEqual(["failed", "refreshed"]);
    await expect(syncGroupsSafely(groups.slice(0, 1), {
      ...deps, fetchMembers: async () => { throw new Fatal(); }, isFatal: (e) => e instanceof Fatal,
    })).rejects.toBeInstanceOf(Fatal);
  });
});

describe("freshness vs full refresh", () => {
  const now = Date.parse("2026-10-03T00:00:00Z");
  const slice = [
    { uuid: "A", lastSyncedAt: "2026-10-02T23:59:00Z" },
    { uuid: "B", lastSyncedAt: null },
    { uuid: "C", lastSyncedAt: "2026-09-01T00:00:00Z" },
  ];
  it("normal sync skips recently checked groups (not reviewed)", () => {
    const { due, skippedRecent } = splitByFreshness(slice, false, now - 60 * 60_000);
    expect(due.map((g) => g.uuid)).toEqual(["B", "C"]);
    expect(skippedRecent.map((g) => g.uuid)).toEqual(["A"]);
  });
  it("full refresh re-reads every selected group", () => {
    const { due, skippedRecent } = splitByFreshness(slice, true, now - 60 * 60_000);
    expect(due).toHaveLength(3);
    expect(skippedRecent).toHaveLength(0);
  });
});
