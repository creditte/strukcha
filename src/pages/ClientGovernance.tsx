import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  HeartPulse,
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
  ArrowRight,
  AlertCircle,
  Search,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { SCORE_BANDS, getScoreBand } from "@/lib/structureScoring";
import { useClientHealthReview } from "@/hooks/useClientHealthReview";
import type { StructureResult } from "@/hooks/useClientHealthReview";
import StructureIssuesPanel from "@/components/health/StructureIssuesPanel";

/* ── Friendly labels ────────────────────────────────────────────── */

function getScoreMessage(score: number, count: number): string {
  if (count === 0) return "No structures to review yet.";
  if (score >= 90) return "Your structures are in good shape.";
  if (score >= 50) return "Some improvements needed across your structures.";
  return "Your structures need attention.";
}

const STRUCTURE_PAGE_SIZE = 15;
const INSIGHT_PAGE_SIZE = 5;

/* ── Page ───────────────────────────────────────────────────────── */

export default function ClientGovernance() {
  const { toast } = useToast();
  const navigate = useNavigate();
  const { review, loading, error, progress, runReview: doReview } = useClientHealthReview();
  const [structuresChanged, setStructuresChanged] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string | null>(null);
  const [insightFilter, setInsightFilter] = useState<string[] | null>(null);
  const [selectedStructure, setSelectedStructure] = useState<StructureResult | null>(null);
  const [structureQuery, setStructureQuery] = useState("");
  const [structureSort, setStructureSort] = useState<"attention" | "name" | "score">("attention");
  const [structurePage, setStructurePage] = useState(1);
  const [insightPage, setInsightPage] = useState(1);

  // "Structures changed" now compares a content stamp of the entities and
  // relationships inside structures, not any touch of structures.updated_at.
  useEffect(() => {
    if (!review?.fingerprint) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase.rpc("health_review_fingerprint" as any);
      if (!cancelled && typeof data === "string") {
        setStructuresChanged(data !== review.fingerprint);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [review?.fingerprint]);

  const handleRunReview = async () => {
    const result = await doReview();
    if (result && result.structures.length === 0) {
      toast({ title: "No structures", description: "No active structures to review." });
    } else if (result) {
      setStructuresChanged(false);
      setStatusFilter(null);
      setInsightFilter(null);
      toast({ title: "Health check complete" });
    } else {
      toast({ title: "Review failed", variant: "destructive" });
    }
  };

  const filteredStructures = useMemo(() => {
    if (!review) return [];
    const needle = structureQuery.trim().toLowerCase();
    const list = review.structures.filter((structure) => {
      if (insightFilter && !insightFilter.includes(structure.id)) return false;
      if (!insightFilter && statusFilter && structure.status !== statusFilter) return false;
      return !needle || structure.name.toLowerCase().includes(needle);
    });
    return list.sort((a, b) => {
      if (structureSort === "name") return a.name.localeCompare(b.name);
      if (structureSort === "score") return b.score - a.score || a.name.localeCompare(b.name);
      return a.score - b.score || a.name.localeCompare(b.name);
    });
  }, [review, insightFilter, statusFilter, structureQuery, structureSort]);
  const structurePageCount = Math.max(1, Math.ceil(filteredStructures.length / STRUCTURE_PAGE_SIZE));
  const currentStructurePage = Math.min(structurePage, structurePageCount);
  const structureStart = (currentStructurePage - 1) * STRUCTURE_PAGE_SIZE;
  const pageStructures = filteredStructures.slice(structureStart, structureStart + STRUCTURE_PAGE_SIZE);
  const insightPageCount = Math.max(1, Math.ceil((review?.crossObservations.length ?? 0) / INSIGHT_PAGE_SIZE));
  const currentInsightPage = Math.min(insightPage, insightPageCount);
  const pageInsights = review?.crossObservations.slice(
    (currentInsightPage - 1) * INSIGHT_PAGE_SIZE,
    currentInsightPage * INSIGHT_PAGE_SIZE,
  ) ?? [];

  useEffect(() => {
    setStructurePage(1);
  }, [statusFilter, insightFilter, structureQuery, structureSort]);

  const healthyCount = review ? review.structures.filter((s) => s.status === "good").length : 0;
  const filterLabel = insightFilter
    ? "Showing structures from the selected insight"
    : statusFilter === "critical"
      ? "Showing structures with critical issues"
      : statusFilter === "warning"
        ? "Showing structures needing improvements"
        : statusFilter === "good"
          ? "Showing healthy structures"
          : null;

  if (selectedStructure) {
    return (
      <div className="mx-auto max-w-4xl px-6 py-10">
        <StructureIssuesPanel
          structure={selectedStructure}
          onBack={() => setSelectedStructure(null)}
        />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl px-6 py-10 space-y-8">
      {/* ── Page header ── */}
      <header className="flex flex-wrap items-start justify-between gap-4 border-b border-border/60 pb-6">
        <div className="space-y-1.5">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Structure Health</h1>
          <p className="text-sm text-muted-foreground">
            {review
              ? getScoreMessage(review.clientScore, review.structures.length)
              : "Check the quality and completeness of every client structure."}
          </p>
        </div>
        {review && (
          <div className="flex flex-col items-end gap-1.5">
            <Button
              variant="outline"
              size="sm"
              className="h-9 gap-2"
              onClick={handleRunReview}
              disabled={loading}
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Re-run check
            </Button>
            <p className="text-[11px] text-muted-foreground">
              Last checked{" "}
              {new Date(review.timestamp).toLocaleString("en-AU", {
                day: "2-digit",
                month: "short",
                year: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </p>
          </div>
        )}
      </header>

      {/* ── Load failure ── */}
      {!loading && error && (
        <Card className="border-destructive/30 bg-destructive/5">
          <CardContent className="flex items-start gap-3 p-5">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
            <div className="flex-1 space-y-2">
              <p className="text-sm font-medium text-foreground">We couldn't run the health check</p>
              <p className="text-xs text-muted-foreground">{error}</p>
              <Button size="sm" variant="outline" onClick={handleRunReview}>
                Try again
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── Empty state ── */}
      {!review && !loading && !error && (
        <Card>
          <CardContent className="space-y-5 px-8 py-14 text-center">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-success/10">
              <HeartPulse className="h-7 w-7 text-success" />
            </div>
            <div className="space-y-1.5">
              <h2 className="text-lg font-semibold text-foreground">Run your first health check</h2>
              <p className="mx-auto max-w-md text-sm text-muted-foreground">
                We'll score every structure and list what's missing, so you know exactly what to fix.
              </p>
            </div>
            <Button size="lg" className="gap-2 rounded-xl px-6 text-sm font-medium" onClick={handleRunReview}>
              <HeartPulse className="h-4 w-4" />
              Run health check
            </Button>
          </CardContent>
        </Card>
      )}

      {/* ── Loading ── */}
      {loading && (
        <Card>
          <CardContent className="space-y-6 p-6">
            <div className="space-y-2">
              <p className="text-sm font-medium text-foreground">Checking your structures…</p>
              <Progress
                value={progress && progress.total > 0 ? Math.round((progress.scored / progress.total) * 100) : 0}
                className="h-2 rounded-full"
              />
              <p className="text-xs text-muted-foreground">
                {progress ? `${progress.scored} of ${progress.total} structures checked` : "Loading your structures…"}
              </p>
            </div>
            <div className="space-y-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-14 w-full rounded-xl" />
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {review && (
        <>
          {/* ── Score summary ── */}
          <Card>
            <CardContent className="space-y-6 p-6">
              <div className="flex flex-wrap items-center gap-8">
                {/* Score dial */}
                <div className="relative flex h-24 w-24 shrink-0 items-center justify-center">
                  <svg className="absolute inset-0 h-24 w-24 -rotate-90" viewBox="0 0 96 96">
                    <circle cx="48" cy="48" r="42" fill="none" stroke="hsl(var(--border))" strokeWidth="6" />
                    <circle
                      cx="48" cy="48" r="42" fill="none"
                      stroke={
                        review.clientScore >= 90
                          ? "hsl(var(--success))"
                          : review.clientScore >= 50
                            ? "hsl(var(--warning))"
                            : "hsl(var(--destructive))"
                      }
                      strokeWidth="6"
                      strokeLinecap="round"
                      strokeDasharray={`${(review.clientScore / 100) * 264} 264`}
                    />
                  </svg>
                  <div className="flex flex-col items-center">
                    <span className="text-2xl font-bold leading-none tabular-nums text-foreground">
                      {review.clientScore}
                    </span>
                    <span className={`mt-1 text-[10px] font-medium ${getScoreBand(review.clientScore).text}`}>
                      {getScoreBand(review.clientScore).label}
                    </span>
                  </div>
                </div>

                {/* Counts */}
                <div className="flex flex-1 flex-wrap gap-x-10 gap-y-4">
                  <div>
                    <p className="text-2xl font-semibold tabular-nums text-foreground">
                      {review.structures.length}
                    </p>
                    <p className="text-xs text-muted-foreground">Structures checked</p>
                  </div>
                  <div>
                    <p className="text-2xl font-semibold tabular-nums text-foreground">{healthyCount}</p>
                    <p className="text-xs text-muted-foreground">Healthy</p>
                  </div>
                  <div>
                    <p className="text-2xl font-semibold tabular-nums text-foreground">
                      {review.needsAttention}
                    </p>
                    <p className="text-xs text-muted-foreground">Need updates</p>
                  </div>
                </div>
              </div>

              {/* Legend */}
              <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-border/60 pt-4 text-[11px] text-muted-foreground">
                {SCORE_BANDS.map((band) => (
                  <div key={band.status} className="flex items-center gap-1.5">
                    <span className={`h-2 w-2 rounded-full ${band.dot}`} />
                    <span>{band.range}</span>
                  </div>
                ))}
              </div>

              {structuresChanged && (
                <div className="flex items-start gap-2 rounded-xl border border-warning/20 bg-warning/10 px-4 py-3 text-xs text-warning">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  Your structures have changed since this check — re-run it for up-to-date results.
                </div>
              )}

              {review.needsAttention > 0 && (
                <Button className="gap-2 rounded-xl px-5 text-sm font-medium" onClick={() => navigate("/review")}>
                  Review issues
                  <ArrowRight className="h-3.5 w-3.5" />
                </Button>
              )}
            </CardContent>
          </Card>

          {/* ── Key insights ── */}
          {review.crossObservations.length > 0 && (
            <section className="space-y-3">
              <div className="space-y-1">
                <h2 className="text-sm font-semibold text-foreground">Key insights</h2>
                <p className="text-xs text-muted-foreground">
                  Patterns we noticed across your structures. Select one to see the structures involved.
                </p>
              </div>
              <div className="space-y-2">
                {pageInsights.map((obs, idx) => {
                  const isActionable =
                    obs.message.includes("missing") ||
                    obs.message.includes("without") ||
                    obs.message.includes("circular");
                  const affectedStructures = review.structures.filter((s) => obs.structureIds.includes(s.id));
                  return (
                    <button
                      key={idx}
                      onClick={() => {
                        if (affectedStructures.length === 1) {
                          setSelectedStructure(affectedStructures[0]);
                        } else {
                          setStatusFilter(null);
                          setInsightFilter(obs.structureIds);
                        }
                      }}
                      className={`group w-full rounded-xl border border-l-[3px] border-border/60 bg-card px-5 py-3.5 text-left text-sm text-foreground transition-all hover:border-border hover:shadow-sm ${
                        isActionable ? "border-l-warning" : "border-l-primary"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <span>{obs.message}</span>
                        <div className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
                          <span>
                            {affectedStructures.length} structure{affectedStructures.length !== 1 ? "s" : ""}
                          </span>
                          <ArrowRight className="h-3 w-3 transition-transform group-hover:translate-x-0.5" />
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
              {insightPageCount > 1 && (
                <div className="flex items-center justify-between gap-3 pt-1">
                  <span className="text-xs text-muted-foreground">
                    Insights {(currentInsightPage - 1) * INSIGHT_PAGE_SIZE + 1}–{Math.min(currentInsightPage * INSIGHT_PAGE_SIZE, review.crossObservations.length)} of {review.crossObservations.length}
                  </span>
                  <div className="flex items-center gap-2">
                    <Button size="icon" variant="outline" className="h-8 w-8" aria-label="Previous insights" disabled={currentInsightPage === 1} onClick={() => setInsightPage(currentInsightPage - 1)}>
                      <ChevronLeft className="h-3.5 w-3.5" />
                    </Button>
                    <span className="min-w-14 text-center text-xs tabular-nums text-muted-foreground">{currentInsightPage} / {insightPageCount}</span>
                    <Button size="icon" variant="outline" className="h-8 w-8" aria-label="Next insights" disabled={currentInsightPage === insightPageCount} onClick={() => setInsightPage(currentInsightPage + 1)}>
                      <ChevronRight className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              )}
            </section>
          )}

          {/* ── Filters by status ── */}
          <section className="space-y-3">
            <div className="space-y-1">
              <h2 className="text-sm font-semibold text-foreground">Filter by status</h2>
              <p className="text-xs text-muted-foreground">
                Select a group to narrow the list of structures below.
              </p>
            </div>
            <div className="grid gap-2 sm:grid-cols-3">
              {review.criticalStructures > 0 && (
                <button
                  onClick={() => {
                    setInsightFilter(null);
                    setStatusFilter(statusFilter === "critical" ? null : "critical");
                  }}
                  className={`flex items-center gap-3 rounded-xl border px-4 py-3.5 text-left transition-all ${
                    statusFilter === "critical"
                      ? "border-destructive/40 bg-destructive/10 ring-1 ring-destructive/20"
                      : "border-destructive/20 bg-destructive/5 hover:border-destructive/30"
                  }`}
                >
                  <AlertCircle className="h-4 w-4 shrink-0 text-destructive" />
                  <span className="text-sm text-foreground">
                    <span className="font-semibold tabular-nums">{review.criticalStructures}</span> critical
                  </span>
                </button>
              )}
              {review.needsAttention > review.criticalStructures && (
                <button
                  onClick={() => {
                    setInsightFilter(null);
                    setStatusFilter(statusFilter === "warning" ? null : "warning");
                  }}
                  className={`flex items-center gap-3 rounded-xl border px-4 py-3.5 text-left transition-all ${
                    statusFilter === "warning"
                      ? "border-warning/40 bg-warning/10 ring-1 ring-warning/20"
                      : "border-warning/20 bg-warning/5 hover:border-warning/30"
                  }`}
                >
                  <AlertTriangle className="h-4 w-4 shrink-0 text-warning" />
                  <span className="text-sm text-foreground">
                    <span className="font-semibold tabular-nums">
                      {review.needsAttention - review.criticalStructures}
                    </span>{" "}
                    need improvements
                  </span>
                </button>
              )}
              {healthyCount > 0 && (
                <button
                  onClick={() => {
                    setInsightFilter(null);
                    setStatusFilter(statusFilter === "good" ? null : "good");
                  }}
                  className={`flex items-center gap-3 rounded-xl border px-4 py-3.5 text-left transition-all ${
                    statusFilter === "good"
                      ? "border-success/40 bg-success/10 ring-1 ring-success/20"
                      : "border-success/20 bg-success/5 hover:border-success/30"
                  }`}
                >
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-success" />
                  <span className="text-sm text-foreground">
                    <span className="font-semibold tabular-nums">{healthyCount}</span> healthy
                  </span>
                </button>
              )}
            </div>
          </section>

          {/* ── Structures list ── */}
          <section className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="space-y-1">
                <h2 className="text-sm font-semibold text-foreground">
                  {filterLabel ? "Filtered structures" : "All structures"}
                </h2>
                <p className="text-xs text-muted-foreground">
                  {filterLabel ?? "Select a structure to see its issues in detail."}
                </p>
              </div>
              {(statusFilter || insightFilter) && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 text-xs"
                  onClick={() => {
                    setStatusFilter(null);
                    setInsightFilter(null);
                  }}
                >
                  Clear filter
                </Button>
              )}
            </div>

            <div className="flex flex-col gap-2 sm:flex-row">
              <div className="relative flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input value={structureQuery} onChange={(event) => setStructureQuery(event.target.value)} placeholder="Search structures…" className="h-9 pl-9 text-sm" />
              </div>
              <Select value={structureSort} onValueChange={(value) => setStructureSort(value as "attention" | "name" | "score")}>
                <SelectTrigger className="h-9 w-full text-sm sm:w-44"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="attention">Needs attention first</SelectItem>
                  <SelectItem value="name">Name A–Z</SelectItem>
                  <SelectItem value="score">Highest score first</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <Card className="overflow-hidden">
              <div className="flex items-center justify-between border-b border-border/60 bg-muted/30 px-5 py-2.5">
                <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                  Structure
                </span>
                <div className="flex items-center gap-4">
                  <span className="w-12 text-right text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                    Score
                  </span>
                  <span className="w-28 text-right text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                    Status
                  </span>
                  <span className="w-3.5" />
                </div>
              </div>

              <div className="divide-y divide-border/60">
                {pageStructures.map((s) => (
                  <button
                    key={s.id}
                    onClick={() => setSelectedStructure(s)}
                    className="group flex w-full items-center justify-between px-5 py-3.5 text-left transition-colors hover:bg-muted/40"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <div className={`h-2 w-2 shrink-0 rounded-full ${getScoreBand(s.score).dot}`} />
                      <span className="truncate text-sm font-medium text-foreground">{s.name}</span>
                    </div>
                    <div className="flex shrink-0 items-center gap-4">
                      <span className="w-12 text-right text-sm font-semibold tabular-nums text-foreground">
                        {s.score}
                      </span>
                      <Badge
                        className={`w-28 justify-center rounded-full border-0 text-[11px] font-medium ${getScoreBand(s.score).pill}`}
                      >
                        {s.friendlyLabel}
                      </Badge>
                      <ArrowRight className="h-3.5 w-3.5 text-muted-foreground/40 transition-transform group-hover:translate-x-0.5" />
                    </div>
                  </button>
                ))}
                {filteredStructures.length === 0 && (
                  <p className="py-8 text-center text-sm text-muted-foreground">
                    No structures match the current filter.
                  </p>
                )}
              </div>
            </Card>
            {filteredStructures.length > 0 && (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <span className="text-xs text-muted-foreground">
                  Showing {structureStart + 1}–{Math.min(structureStart + STRUCTURE_PAGE_SIZE, filteredStructures.length)} of {filteredStructures.length} structures
                </span>
                {structurePageCount > 1 && (
                  <div className="flex items-center gap-2">
                    <Button size="sm" variant="outline" className="h-8 gap-1 text-xs" disabled={currentStructurePage === 1} onClick={() => setStructurePage(currentStructurePage - 1)}>
                      <ChevronLeft className="h-3.5 w-3.5" /> Previous
                    </Button>
                    <span className="text-xs tabular-nums text-muted-foreground">Page {currentStructurePage} of {structurePageCount}</span>
                    <Button size="sm" variant="outline" className="h-8 gap-1 text-xs" disabled={currentStructurePage === structurePageCount} onClick={() => setStructurePage(currentStructurePage + 1)}>
                      Next <ChevronRight className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                )}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
