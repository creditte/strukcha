/**
 * Shared hook for computing workspace-level structure health.
 * Used by the Dashboard, ClientGovernance (Health Check) and Review & Improve
 * so all three surfaces show identical numbers.
 *
 * The whole dataset now arrives in ONE request (`health_review_dataset`),
 * replacing ~100 sequential chunked reads that made the pages hang on a
 * skeleton. Scoring is sliced so the browser stays responsive, and the result
 * is cached in React Query per firm.
 */

import { useCallback, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useTenantId } from "@/hooks/useSharedQueries";
import { qk, staleTimes } from "@/lib/queryKeys";
import { computeHealthScoreV2, getHealthStatus, getScoreBand } from "@/lib/structureScoring";
import type { EntityNode, RelationshipEdge } from "@/hooks/useStructureData";
import type { ScoringIssue } from "@/lib/structureScoring";

/* ── Types ──────────────────────────────────────────────────────── */

export interface StructureResult {
  id: string;
  name: string;
  score: number;
  status: "good" | "warning" | "critical";
  friendlyLabel: string;
  issues: ScoringIssue[];
  criticalCount: number;
}

export interface CrossObservation {
  message: string;
  structureIds: string[];
}

export interface ClientReview {
  timestamp: string;
  clientScore: number;
  structures: StructureResult[];
  crossObservations: CrossObservation[];
  criticalStructures: number;
  needsAttention: number;
  /** Flat list of all issues across all structures, with structure context */
  allIssues: StructureIssue[];
  /** Change stamp of the underlying data at review time */
  fingerprint: string | null;
}

export interface StructureIssue extends ScoringIssue {
  structure_id: string;
  structure_name: string;
}

interface RawStructure {
  id: string;
  name: string;
  entities: EntityNode[];
  relationships: RelationshipEdge[];
}

/* ── Helpers ────────────────────────────────────────────────────── */

const SCORE_SLICE = 100;
const REVIEW_TIMEOUT_MS = 60_000;

function yieldToBrowser(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

async function withTimeout<T>(p: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  try {
    return await Promise.race([p, timeout]);
  } finally {
    clearTimeout(timer!);
  }
}

/* ── Core computation ───────────────────────────────────────────── */

async function buildReview(
  onProgress?: (scored: number, total: number) => void,
): Promise<ClientReview> {
  const { data, error } = await supabase.rpc("health_review_dataset" as any);
  if (error) throw error;

  const structures: RawStructure[] = ((data as any)?.structures ?? []) as RawStructure[];

  if (structures.length === 0) {
    return {
      timestamp: new Date().toISOString(),
      clientScore: 100,
      structures: [],
      crossObservations: [],
      criticalStructures: 0,
      needsAttention: 0,
      allIssues: [],
      fingerprint: null,
    };
  }

  const results: StructureResult[] = [];
  const allIssues: StructureIssue[] = [];
  const trustsWithoutCorporateTrusteeIds: string[] = [];
  const missingAppointerIds: string[] = [];
  const circularIds: string[] = [];

  for (let i = 0; i < structures.length; i++) {
    const s = structures[i];
    const health = computeHealthScoreV2(s.entities ?? [], s.relationships ?? []);

    results.push({
      id: s.id,
      name: s.name,
      score: health.score,
      status: getHealthStatus(health.score),
      friendlyLabel: getScoreBand(health.score).label,
      issues: health.issues,
      criticalCount: health.criticalGaps.length,
    });

    for (const issue of health.issues) {
      if (issue.severity === "info") continue;
      allIssues.push({ ...issue, structure_id: s.id, structure_name: s.name });
    }

    if (health.isCapped) trustsWithoutCorporateTrusteeIds.push(s.id);
    if (health.issues.some((iss) => iss.code === "missing_appointer")) missingAppointerIds.push(s.id);
    if (health.issues.some((iss) => iss.code === "circular_ownership")) circularIds.push(s.id);

    // Keep the tab responsive on large firms.
    if ((i + 1) % SCORE_SLICE === 0) {
      onProgress?.(i + 1, structures.length);
      await yieldToBrowser();
    }
  }
  onProgress?.(structures.length, structures.length);

  const crossObservations: CrossObservation[] = [];
  if (trustsWithoutCorporateTrusteeIds.length > 0)
    crossObservations.push({
      message: `${trustsWithoutCorporateTrusteeIds.length} structure${trustsWithoutCorporateTrusteeIds.length > 1 ? "s have" : " has"} trusts without corporate trustees`,
      structureIds: trustsWithoutCorporateTrusteeIds,
    });
  if (missingAppointerIds.length > 0) {
    const totalAppointerIssues = allIssues.filter((i) => i.code === "missing_appointer").length;
    crossObservations.push({
      message: `${totalAppointerIssues} trust${totalAppointerIssues > 1 ? "s" : ""} missing appointors across structures`,
      structureIds: missingAppointerIds,
    });
  }
  if (circularIds.length > 0)
    crossObservations.push({
      message: `${circularIds.length} structure${circularIds.length > 1 ? "s" : ""} with circular ownership detected`,
      structureIds: circularIds,
    });

  const avgScore = Math.round(results.reduce((sum, r) => sum + r.score, 0) / results.length);
  const allPerfect = results.every((r) => r.score >= 100);
  const finalClientScore = allPerfect ? avgScore : Math.min(avgScore, 99);

  allIssues.sort((a, b) => {
    const severityOrder: Record<string, number> = { critical: 0, gap: 1, minor: 2, info: 3 };
    const sa = severityOrder[a.severity] ?? 3;
    const sb = severityOrder[b.severity] ?? 3;
    if (sa !== sb) return sa - sb;
    return a.structure_name.localeCompare(b.structure_name);
  });

  let fingerprint: string | null = null;
  try {
    const { data: fp } = await supabase.rpc("health_review_fingerprint" as any);
    fingerprint = (fp as string) ?? null;
  } catch {
    fingerprint = null;
  }

  return {
    timestamp: new Date().toISOString(),
    clientScore: finalClientScore,
    structures: results.sort((a, b) => a.score - b.score),
    crossObservations,
    criticalStructures: results.filter((r) => r.status === "critical").length,
    needsAttention: results.filter((r) => r.score < 100).length,
    allIssues,
    fingerprint,
  };
}

/* ── Hook ───────────────────────────────────────────────────────── */

export function useClientHealthReview() {
  const { session } = useAuth();
  const tenantId = useTenantId();
  const queryClient = useQueryClient();
  const [progress, setProgress] = useState<{ scored: number; total: number } | null>(null);
  const inFlight = useRef<Promise<ClientReview> | null>(null);

  const queryKey = useMemo(() => qk.healthReview(tenantId), [tenantId]);

  const fetchReview = useCallback(async () => {
    // Single in-flight guard: a second mount or a Re-run click joins the
    // running request instead of starting a competing one.
    if (inFlight.current) return inFlight.current;
    const run = withTimeout(
      buildReview((scored, total) => setProgress({ scored, total })),
      REVIEW_TIMEOUT_MS,
      "The health check took too long to finish. Please try again.",
    ).finally(() => {
      inFlight.current = null;
      setProgress(null);
    });
    inFlight.current = run;
    return run;
  }, []);

  const query = useQuery({
    queryKey,
    enabled: !!session?.user && !!tenantId,
    staleTime: staleTimes.stats,
    retry: false,
    queryFn: fetchReview,
  });

  const runReview = useCallback(async (): Promise<ClientReview | null> => {
    try {
      const result = await queryClient.fetchQuery({
        queryKey,
        staleTime: 0,
        retry: false,
        queryFn: fetchReview,
      });
      return result;
    } catch (e) {
      console.error("Review error:", e);
      return null;
    }
  }, [queryClient, queryKey, fetchReview]);

  return {
    review: query.data ?? null,
    loading: query.isLoading || query.isFetching,
    error: query.error ? ((query.error as any).message ?? "We couldn't check your structures just now.") : null,
    progress,
    runReview,
  };
}
