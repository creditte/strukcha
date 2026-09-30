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

const STRUCTURE_PAGE_SIZE = 10;
const INSIGHT_CHIP_LIMIT = 6;

const SEV_ORDER: Record<string, number> = { critical: 0, gap: 1, minor: 2, info: 3 };

function describeInsight(message: string): { title: string; explanation: string; entityCount: number | null; critical: boolean } {
  const lower = message.toLowerCase();
  const leading = parseInt(message, 10);
  if (lower.includes("corporate trustee"))
    return { title: "Trusts without corporate trustees", explanation: "These trusts have individual trustees rather than a company acting as trustee.", entityCount: null, critical: false };
  if (lower.includes("appointor"))
    return { title: "Trusts missing appointors", explanation: "No appointor is recorded — the person with power to appoint or remove the trustee.", entityCount: Number.isNaN(leading) ? null : leading, critical: false };
  if (lower.includes("circular"))
    return { title: "Circular ownership detected", explanation: "Entities own each other in a loop, which is usually a data-entry error.", entityCount: null, critical: true };
  return { title: message, explanation: "", entityCount: null, critical: false };
}

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
  const [showAllInsights, setShowAllInsights] = useState(false);

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
  const allInsights = review?.crossObservations ?? [];
  const visibleInsights = showAllInsights ? allInsights : allInsights.slice(0, INSIGHT_CHIP_LIMIT);
  const hiddenInsightCount = Math.max(allInsights.length - INSIGHT_CHIP_LIMIT, 0);

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
            Review structural issues identified across your firm's structures.
          </p>
        </div>
        {review && (
          <div className="flex w-full flex-col gap-1.5 sm:w-auto sm:items-end">
            <Button
              variant="ghost"
              size="sm"
              className="h-10 w-full gap-2 text-muted-foreground sm:h-9 sm:w-auto"
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

      {review && (() => {
        const criticalCount = review.structures.filter((s) => s.status === "critical").length;
        const warningCount = review.structures.filter((s) => s.status === "warning").length;
        const band = getScoreBand(review.clientScore);
        const tabs: { key: string | null; label: string; count: number }[] = [
          { key: null, label: "All", count: review.structures.length },
          { key: "critical", label: "Critical", count: criticalCount },
          { key: "warning", label: "Needs attention", count: warningCount },
          { key: "good", label: "Healthy", count: healthyCount },
        ];
        const activeInsight = insightFilter
          ? allInsights.find((o) => o.structureIds.join(",") === insightFilter.join(","))
          : null;
        return (
        <>
          {/* ── 1. Overall result ── */}
          <section className="space-y-4">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Latest result</h2>
            <div className="flex flex-col gap-6 sm:flex-row sm:items-center">
              <div className="flex items-center gap-4">
                <div className="flex items-baseline gap-1.5">
                  <span className="text-5xl font-semibold leading-none tabular-nums text-foreground">{review.clientScore}</span>
                  <span className="text-sm text-muted-foreground">/ 100</span>
                </div>
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className={`h-2 w-2 rounded-full ${band.dot}`} />
                    <span className={`text-sm font-semibold ${band.text}`}>{band.label}</span>
                  </div>
                  <p className="text-xs text-muted-foreground">Average across all structures</p>
                </div>
              </div>
              <dl className="grid flex-1 grid-cols-2 gap-x-6 gap-y-3 border-border/60 sm:grid-cols-4 sm:border-l sm:pl-6">
                <div>
                  <dt className="text-[11px] text-muted-foreground">Structures checked</dt>
                  <dd className="text-lg font-semibold tabular-nums text-foreground">{review.structures.length}</dd>
                </div>
                <div>
                  <dt className="text-[11px] text-muted-foreground">Healthy</dt>
                  <dd className="text-lg font-semibold tabular-nums text-success">{healthyCount}</dd>
                </div>
                <div>
                  <dt className="text-[11px] text-muted-foreground">Needs attention</dt>
                  <dd className="text-lg font-semibold tabular-nums text-warning">{warningCount}</dd>
                </div>
                <div>
                  <dt className="text-[11px] text-muted-foreground">Critical</dt>
                  <dd className={`text-lg font-semibold tabular-nums ${criticalCount > 0 ? "text-destructive" : "text-foreground"}`}>{criticalCount}</dd>
                </div>
              </dl>
            </div>
            <Progress value={review.clientScore} className="h-1.5 rounded-full" />
            <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted-foreground">
              <span>
                {review.needsAttention} of {review.structures.length} structures have at least one issue (including some rated Healthy).
              </span>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                {SCORE_BANDS.map((b) => (
                  <span key={b.status} className="flex items-center gap-1.5">
                    <span className={`h-1.5 w-1.5 rounded-full ${b.dot}`} />
                    {b.range}
                  </span>
                ))}
              </div>
            </div>
            {structuresChanged && (
              <div className="flex items-start gap-2 rounded-lg border border-warning/20 bg-warning/10 px-4 py-3 text-xs text-warning">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                Your structures have changed since this check — re-run it for up-to-date results.
              </div>
            )}
          </section>

          {/* ── 2. Issues found ── */}
          <section className="space-y-3 border-t border-border/60 pt-8">
            <div className="space-y-1">
              <h2 className="text-base font-semibold text-foreground">Issues found</h2>
              <p className="text-xs text-muted-foreground">Start here. Review an issue to see only the structures it affects.</p>
            </div>
            {allInsights.length === 0 ? (
              <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
                <CheckCircle2 className="h-4 w-4 text-success" />
                No firm-wide issues detected.
              </div>
            ) : (
              <div className="divide-y divide-border/60 rounded-xl border border-border/60">
                {visibleInsights.map((obs, idx) => {
                  const meta = describeInsight(obs.message);
                  const affected = review.structures.filter((s) => obs.structureIds.includes(s.id));
                  const active = activeInsight === obs;
                  return (
                    <div key={idx} className={`flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:px-5 ${active ? "bg-primary/5" : ""}`}>
                      <span className={`mt-1.5 hidden h-2 w-2 shrink-0 self-start rounded-full sm:block ${meta.critical ? "bg-destructive" : "bg-warning"}`} />
                      <div className="min-w-0 flex-1 space-y-1">
                        <p className="text-sm font-semibold text-foreground">{meta.title}</p>
                        <p className="text-xs text-muted-foreground">{meta.explanation}</p>
                        <p className="text-xs text-foreground">
                          <span className="font-medium tabular-nums">{affected.length}</span> structure{affected.length !== 1 ? "s" : ""} affected
                          {meta.entityCount !== null && meta.entityCount !== affected.length && (
                            <span className="text-muted-foreground"> · <span className="tabular-nums">{meta.entityCount}</span> trusts</span>
                          )}
                        </p>
                      </div>
                      <Button
                        size="sm"
                        variant={active ? "secondary" : "outline"}
                        className="h-9 w-full gap-1.5 sm:w-auto"
                        onClick={() => {
                          if (affected.length === 1) {
                            setSelectedStructure(affected[0]);
                            return;
                          }
                          setStatusFilter(null);
                          setInsightFilter(active ? null : obs.structureIds);
                          if (!active) document.getElementById("structures-to-review")?.scrollIntoView({ behavior: "smooth", block: "start" });
                        }}
                      >
                        {active ? "Showing" : "Review"}
                        <ArrowRight className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  );
                })}
              </div>
            )}
            {hiddenInsightCount > 0 && (
              <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={() => setShowAllInsights((p) => !p)}>
                {showAllInsights ? "Show fewer" : `+${hiddenInsightCount} more issues`}
              </Button>
            )}
          </section>

          {/* ── 3. Structures to review ── */}
          <section id="structures-to-review" className="scroll-mt-4 space-y-4 border-t border-border/60 pt-8">
            <div className="sticky top-0 z-20 -mx-1 space-y-4 bg-background/95 px-1 pb-3 pt-3 backdrop-blur supports-[backdrop-filter]:bg-background/85">
            <div className="space-y-1">
              <h2 className="text-base font-semibold text-foreground">Structures to review</h2>
              <p className="text-xs text-muted-foreground">Lowest scores first. Open a structure to see its issues in detail.</p>
            </div>

            {activeInsight && (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-primary/5 px-4 py-2.5 text-xs">
                <span className="text-foreground">
                  Filtered by issue: <span className="font-semibold">{describeInsight(activeInsight.message).title}</span>
                </span>
                <button className="font-medium text-primary hover:underline" onClick={() => setInsightFilter(null)}>
                  Clear
                </button>
              </div>
            )}

            <div className="flex flex-wrap gap-1 border-b border-border/60">
              {tabs.map((t) => {
                const active = !insightFilter && statusFilter === t.key;
                return (
                  <button
                    key={t.label}
                    onClick={() => {
                      setInsightFilter(null);
                      setStatusFilter(t.key);
                    }}
                    className={`-mb-px border-b-2 px-3 py-2 text-xs font-medium transition-colors ${
                      active ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {t.label} <span className="tabular-nums text-muted-foreground">({t.count})</span>
                  </button>
                );
              })}
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
                    <span className="hidden sm:inline">Sort</span>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
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
                      <DropdownMenuItem onClick={() => { setStatusFilter(null); setInsightFilter(null); }}>
                        Clear filters
                      </DropdownMenuItem>
                    </>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
            </div>

            <div className="divide-y divide-border/60 rounded-xl border border-border/60">
              {pageStructures.map((s) => {
                const actionable = s.issues.filter((i) => i.severity !== "info");
                const top = [...actionable].sort((a, b) => (SEV_ORDER[a.severity] ?? 3) - (SEV_ORDER[b.severity] ?? 3))[0];
                const b = getScoreBand(s.score);
                return (
                  <button
                    key={s.id}
                    onClick={() => setSelectedStructure(s)}
                    className="group flex w-full flex-col gap-2 px-4 py-3.5 text-left transition-colors hover:bg-muted/40 sm:flex-row sm:items-center sm:gap-4 sm:px-5"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-foreground">{s.name}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {top ? `Top issue: ${top.message}` : "No issues detected"}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-3 text-xs sm:gap-4">
                      <span className="w-14 font-semibold tabular-nums text-foreground sm:text-right">
                        {s.score}<span className="font-normal text-muted-foreground">/100</span>
                      </span>
                      <span className={`inline-flex w-28 items-center gap-1.5 font-medium ${b.text}`}>
                        <span className={`h-1.5 w-1.5 rounded-full ${b.dot}`} />
                        {s.friendlyLabel}
                      </span>
                      <span className="w-16 tabular-nums text-muted-foreground">
                        {actionable.length} issue{actionable.length !== 1 ? "s" : ""}
                      </span>
                      <span className="ml-auto inline-flex items-center gap-1 font-medium text-primary">
                        View <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
                      </span>
                    </div>
                  </button>
                );
              })}
              {filteredStructures.length === 0 && (
                <p className="py-8 text-center text-sm text-muted-foreground">No structures match the current filter.</p>
              )}
            </div>
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
        );
      })()}
    </div>
  );
}
