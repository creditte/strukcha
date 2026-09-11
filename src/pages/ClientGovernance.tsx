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
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  HeartPulse,
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
  ArrowRight,
  AlertCircle,
  Search,
  SlidersHorizontal,
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
          <div className="flex w-full flex-col gap-1.5 sm:w-auto sm:items-end">
            <Button
              variant="outline"
              size="sm"
              className="h-10 w-full gap-2 sm:h-9 sm:w-auto"
              onClick={handleRunReview}
              disabled={loading}
            >
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
              Re-run check
            </Button>
            <p className="text-[11px] text-muted-foreground sm:text-right">
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
          {/* ── Score summary (single card) ── */}
          <Card>
            <CardContent className="space-y-6 p-5 sm:p-6">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="space-y-1">
                  <div className="flex items-baseline gap-2">
                    <span className="text-4xl font-semibold leading-none tabular-nums text-foreground">
                      {review.clientScore}
                    </span>
                    <span className="text-sm text-muted-foreground">/ 100</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`h-2 w-2 rounded-full ${getScoreBand(review.clientScore).dot}`} />
                    <span className={`text-sm font-medium ${getScoreBand(review.clientScore).text}`}>
                      {getScoreBand(review.clientScore).label}
                    </span>
                  </div>
                </div>

                {review.needsAttention > 0 && (
                  <Button
                    variant="secondary"
                    className="w-full gap-2 rounded-xl text-sm font-medium sm:ml-auto sm:w-auto sm:px-5"
                    onClick={() => navigate("/review")}
                  >
                    Review issues
                    <ArrowRight className="h-3.5 w-3.5" />
                  </Button>
                )}
              </div>

              <Progress value={review.clientScore} className="h-1.5 rounded-full" />

              {/* Counts — spaced, no borders */}
              <div className="flex flex-wrap gap-x-10 gap-y-4">
                <div className="space-y-0.5">
                  <p className="text-2xl font-semibold tabular-nums text-foreground">
                    {review.structures.length}
                  </p>
                  <p className="text-xs text-muted-foreground">Checked</p>
                </div>
                <div className="space-y-0.5">
                  <p className="text-2xl font-semibold tabular-nums text-success">{healthyCount}</p>
                  <p className="text-xs text-muted-foreground">Healthy</p>
                </div>
                <div className="space-y-0.5">
                  <p className="text-2xl font-semibold tabular-nums text-warning">{review.needsAttention}</p>
                  <p className="text-xs text-muted-foreground">Need updates</p>
                </div>
              </div>

              {/* Legend */}
              <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-[11px] text-muted-foreground">
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
            </CardContent>
          </Card>

          {/* ── Key insights (chips) ── */}
          {review.crossObservations.length > 0 && (
            <section className="space-y-3">
              <div className="space-y-1">
                <h2 className="text-sm font-semibold text-foreground">Key insights</h2>
                <p className="text-xs text-muted-foreground">
                  Patterns across your structures. Tap one to see the structures involved.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {visibleInsights.map((obs, idx) => {
                  const isActionable =
                    obs.message.includes("missing") ||
                    obs.message.includes("without") ||
                    obs.message.includes("circular");
                  const affectedStructures = review.structures.filter((s) => obs.structureIds.includes(s.id));
                  const active =
                    !!insightFilter && insightFilter.join(",") === obs.structureIds.join(",");
                  return (
                    <button
                      key={idx}
                      title={obs.message}
                      onClick={() => {
                        if (affectedStructures.length === 1) {
                          setSelectedStructure(affectedStructures[0]);
                        } else {
                          setStatusFilter(null);
                          setInsightFilter(active ? null : obs.structureIds);
                        }
                      }}
                      className={`group inline-flex max-w-[18rem] items-center gap-2 rounded-full border px-3.5 py-1.5 text-left text-xs transition-colors ${
                        active
                          ? "border-primary/40 bg-primary/10 text-foreground"
                          : isActionable
                            ? "border-warning/30 bg-warning/5 text-foreground hover:bg-warning/10"
                            : "border-border/60 bg-card text-foreground hover:bg-muted/50"
                      }`}
                    >
                      <span
                        className={`h-1.5 w-1.5 shrink-0 rounded-full ${isActionable ? "bg-warning" : "bg-primary"}`}
                      />
                      <span className="truncate">{obs.message}</span>
                    </button>
                  );
                })}
                {hiddenInsightCount > 0 && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-8 rounded-full text-xs"
                    onClick={() => setShowAllInsights((prev) => !prev)}
                  >
                    {showAllInsights ? "Show fewer" : `+${hiddenInsightCount} more`}
                  </Button>
                )}
              </div>
            </section>
          )}

          {/* ── Structures list ── */}
          <section className="space-y-3">
            <div className="space-y-1">
              <h2 className="text-sm font-semibold text-foreground">
                {filterLabel ? "Filtered structures" : "All structures"}
              </h2>
              <p className="text-xs text-muted-foreground">
                {filterLabel ?? "Select a structure to see its issues in detail."}
              </p>
            </div>

            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={structureQuery}
                  onChange={(event) => setStructureQuery(event.target.value)}
                  placeholder="Search structures…"
                  className="h-10 pl-9 text-sm sm:h-9"
                />
              </div>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" className="h-10 shrink-0 gap-2 text-sm sm:h-9">
                    <SlidersHorizontal className="h-4 w-4" />
                    <span className="hidden sm:inline">Filter</span>
                    {(statusFilter || insightFilter) && (
                      <span className="h-1.5 w-1.5 rounded-full bg-primary" />
                    )}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-60">
                  <DropdownMenuLabel className="text-xs">Status</DropdownMenuLabel>
                  {review.criticalStructures > 0 && (
                    <DropdownMenuCheckboxItem
                      checked={statusFilter === "critical"}
                      onCheckedChange={(checked) => {
                        setInsightFilter(null);
                        setStatusFilter(checked ? "critical" : null);
                      }}
                    >
                      <AlertCircle className="mr-2 h-3.5 w-3.5 text-destructive" />
                      Critical ({review.criticalStructures})
                    </DropdownMenuCheckboxItem>
                  )}
                  {review.needsAttention > review.criticalStructures && (
                    <DropdownMenuCheckboxItem
                      checked={statusFilter === "warning"}
                      onCheckedChange={(checked) => {
                        setInsightFilter(null);
                        setStatusFilter(checked ? "warning" : null);
                      }}
                    >
                      <AlertTriangle className="mr-2 h-3.5 w-3.5 text-warning" />
                      Need improvements ({review.needsAttention - review.criticalStructures})
                    </DropdownMenuCheckboxItem>
                  )}
                  {healthyCount > 0 && (
                    <DropdownMenuCheckboxItem
                      checked={statusFilter === "good"}
                      onCheckedChange={(checked) => {
                        setInsightFilter(null);
                        setStatusFilter(checked ? "good" : null);
                      }}
                    >
                      <CheckCircle2 className="mr-2 h-3.5 w-3.5 text-success" />
                      Healthy ({healthyCount})
                    </DropdownMenuCheckboxItem>
                  )}
                  <DropdownMenuSeparator />
                  <DropdownMenuLabel className="text-xs">Sort by</DropdownMenuLabel>
                  <DropdownMenuRadioGroup
                    value={structureSort}
                    onValueChange={(value) => setStructureSort(value as "attention" | "name" | "score")}
                  >
                    <DropdownMenuRadioItem value="attention">Needs attention first</DropdownMenuRadioItem>
                    <DropdownMenuRadioItem value="name">Name A–Z</DropdownMenuRadioItem>
                    <DropdownMenuRadioItem value="score">Highest score first</DropdownMenuRadioItem>
                  </DropdownMenuRadioGroup>
                  {(statusFilter || insightFilter) && (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        onClick={() => {
                          setStatusFilter(null);
                          setInsightFilter(null);
                        }}
                      >
                        Clear filters
                      </DropdownMenuItem>
                    </>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
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
