import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertTriangle,
  Copy,
  Download,
  ListChecks,
  AlertCircle,
  CheckCircle2,
  Search,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import DuplicatesTab from "@/components/review/DuplicatesTab";
import StructureIssueGroup from "@/components/review/StructureIssueGroup";
import { useClientHealthReview } from "@/hooks/useClientHealthReview";
import type { StructureIssue } from "@/hooks/useClientHealthReview";

type SeverityFilter = "all" | "critical" | "gap" | "minor";
type SortMode = "most" | "critical" | "name";

const PAGE_SIZE = 20;

interface StructureGroup {
  id: string;
  name: string;
  issues: StructureIssue[];
  criticalCount: number;
}

export default function Review() {
  const navigate = useNavigate();
  const { review, loading, error, progress, runReview } = useClientHealthReview();

  const [query, setQuery] = useState("");
  const [severity, setSeverity] = useState<SeverityFilter>("all");
  const [sort, setSort] = useState<SortMode>("critical");
  const [page, setPage] = useState(1);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  const issueCount = review?.allIssues.length ?? 0;
  const totalStructures = review?.structures.length ?? 0;
  const structuresWithIssues = review?.needsAttention ?? 0;
  const healthyCount = Math.max(totalStructures - structuresWithIssues, 0);
  const allResolved = !loading && review !== null && issueCount === 0;
  const healthyPct = totalStructures > 0 ? Math.round((healthyCount / totalStructures) * 100) : 100;

  /* Severity counts always reflect the full, unfiltered set */
  const severityCounts = useMemo(() => {
    const counts = { all: 0, critical: 0, gap: 0, minor: 0 };
    for (const issue of review?.allIssues ?? []) {
      counts.all += 1;
      if (issue.severity === "critical") counts.critical += 1;
      else if (issue.severity === "gap") counts.gap += 1;
      else counts.minor += 1;
    }
    return counts;
  }, [review?.allIssues]);

  /* Filter → group → sort */
  const groups = useMemo<StructureGroup[]>(() => {
    const needle = query.trim().toLowerCase();
    const map = new Map<string, StructureGroup>();

    for (const issue of review?.allIssues ?? []) {
      if (severity !== "all" && issue.severity !== severity) continue;
      if (
        needle &&
        !issue.structure_name.toLowerCase().includes(needle) &&
        !issue.message.toLowerCase().includes(needle)
      )
        continue;

      let group = map.get(issue.structure_id);
      if (!group) {
        group = {
          id: issue.structure_id,
          name: issue.structure_name,
          issues: [],
          criticalCount: 0,
        };
        map.set(issue.structure_id, group);
      }
      group.issues.push(issue);
      if (issue.severity === "critical") group.criticalCount += 1;
    }

    const list = Array.from(map.values());
    list.sort((a, b) => {
      if (sort === "name") return a.name.localeCompare(b.name);
      if (sort === "most") return b.issues.length - a.issues.length || a.name.localeCompare(b.name);
      return (
        b.criticalCount - a.criticalCount ||
        b.issues.length - a.issues.length ||
        a.name.localeCompare(b.name)
      );
    });
    return list;
  }, [review?.allIssues, query, severity, sort]);

  const pageCount = Math.max(1, Math.ceil(groups.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const pageStart = (currentPage - 1) * PAGE_SIZE;
  const pageGroups = groups.slice(pageStart, pageStart + PAGE_SIZE);

  useEffect(() => {
    setPage(1);
  }, [query, severity, sort]);

  const allExpanded = pageGroups.length > 0 && pageGroups.every((g) => expandedIds.has(g.id));

  const toggleGroup = (id: string, open: boolean) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (open) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const toggleAllOnPage = () => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      for (const g of pageGroups) {
        if (allExpanded) next.delete(g.id);
        else next.add(g.id);
      }
      return next;
    });
  };

  const clearFilters = () => {
    setQuery("");
    setSeverity("all");
  };

  const SEVERITY_TABS: { value: SeverityFilter; label: string; count: number }[] = [
    { value: "all", label: "All", count: severityCounts.all },
    { value: "critical", label: "Critical", count: severityCounts.critical },
    { value: "gap", label: "Warning", count: severityCounts.gap },
    { value: "minor", label: "Minor", count: severityCounts.minor },
  ];


  return (
    <div className="mx-auto max-w-4xl px-6 py-10 space-y-8">
      {/* ── Page header ── */}
      <header className="space-y-2 border-b border-border/60 pb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          Review &amp; Improve
        </h1>
        <p className="text-sm text-muted-foreground">
          {loading
            ? progress
              ? `Checking your structures — ${progress.scored} of ${progress.total}`
              : "Loading your structures…"
            : allResolved
              ? "Everything looks complete. Your structures are ready to export."
              : `Work through ${issueCount} item${issueCount !== 1 ? "s" : ""} across ${structuresWithIssues} structure${structuresWithIssues !== 1 ? "s" : ""} to finish and enable export.`}
        </p>
      </header>

      {/* ── Load failure ── */}
      {!loading && error && (
        <Card className="border-destructive/30 bg-destructive/5">
          <CardContent className="flex items-start gap-3 p-5">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
            <div className="flex-1 space-y-2">
              <p className="text-sm font-medium text-foreground">We couldn't load your review</p>
              <p className="text-xs text-muted-foreground">{error}</p>
              <Button size="sm" variant="outline" onClick={() => runReview()}>
                Try again
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── Summary ── */}
      {!loading && totalStructures > 0 && (
        <Card>
          <CardContent className="space-y-4 p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-success" />
                <span className="text-sm font-medium text-foreground">
                  {healthyCount} of {totalStructures} structures healthy
                </span>
              </div>
              <span className="text-sm font-semibold tabular-nums text-muted-foreground">
                {healthyPct}%
              </span>
            </div>
            <Progress value={healthyPct} className="h-2 rounded-full" />
          </CardContent>
        </Card>
      )}

      {/* ── Tabs ── */}
      <Tabs defaultValue="unresolved" className="space-y-6">
        <TabsList className="bg-muted/60 rounded-xl p-1">
          <TabsTrigger value="unresolved" className="gap-2 rounded-lg text-sm px-4">
            <ListChecks className="h-4 w-4" />
            Issues
            {issueCount > 0 && (
              <Badge className="ml-1 border-0 bg-warning/15 px-1.5 py-0 text-[11px] text-warning">
                {issueCount}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="duplicates" className="gap-2 rounded-lg text-sm px-4">
            <Copy className="h-4 w-4" />
            Duplicates
          </TabsTrigger>
        </TabsList>

        <TabsContent value="unresolved" className="space-y-6">
          {loading ? (
            <div className="space-y-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <Card key={i}>
                  <CardContent className="space-y-3 p-5">
                    <Skeleton className="h-4 w-1/3" />
                    <Skeleton className="h-3 w-2/3" />
                    <Skeleton className="h-3 w-1/2" />
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : allResolved ? (
            /* ── Completion state with celebration ── */
            <div className="relative overflow-hidden rounded-2xl border border-success/20 bg-success/5 px-8 py-14 text-center space-y-5">
              {/* Confetti particles */}
              <div className="pointer-events-none absolute inset-0" aria-hidden="true">
                {Array.from({ length: 24 }).map((_, i) => (
                  <span
                    key={i}
                    className="absolute block rounded-full animate-confetti"
                    style={{
                      width: `${4 + Math.random() * 6}px`,
                      height: `${4 + Math.random() * 6}px`,
                      left: `${10 + Math.random() * 80}%`,
                      top: "-8px",
                      backgroundColor: [
                        "hsl(var(--success))",
                        "hsl(var(--primary))",
                        "hsl(var(--warning))",
                        "hsl(152 56% 70%)",
                        "hsl(220 65% 70%)",
                        "hsl(38 92% 65%)",
                      ][i % 6],
                      animationDelay: `${Math.random() * 0.6}s`,
                      animationDuration: `${1.2 + Math.random() * 0.8}s`,
                    }}
                  />
                ))}
              </div>

              {/* Animated checkmark */}
              <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-success/10 animate-scale-in">
                <svg
                  className="h-9 w-9 text-success"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <circle
                    cx="12" cy="12" r="10"
                    className="animate-draw-circle"
                    style={{ strokeDasharray: 63, strokeDashoffset: 63 }}
                  />
                  <path
                    d="M8 12l3 3 5-5"
                    className="animate-draw-check"
                    style={{ strokeDasharray: 14, strokeDashoffset: 14 }}
                  />
                </svg>
              </div>

              <div className="space-y-1.5 animate-fade-in-up" style={{ animationDelay: "0.5s", animationFillMode: "both" }}>
                <h2 className="text-xl font-semibold text-foreground">All issues resolved</h2>
                <p className="mx-auto max-w-sm text-sm text-muted-foreground">
                  Your structures are complete and ready to export.
                </p>
              </div>
              <Button
                size="lg"
                className="gap-2 rounded-xl px-6 text-sm font-medium animate-fade-in-up"
                style={{ animationDelay: "0.7s", animationFillMode: "both" }}
                onClick={() => navigate("/structures")}
              >
                <Download className="h-4 w-4" />
                Export Structures
              </Button>
            </div>
          ) : (
            /* ── Issue list grouped by structure ── */
            <div className="space-y-4">
              {Array.from(issuesByStructure.entries()).map(([structureId, issues]) => {
                const structureName = issues[0]?.structure_name ?? "Unknown";
                const criticalCount = issues.filter((i) => i.severity === "critical").length;
                return (
                  <Card key={structureId} className="overflow-hidden">
                    {/* Structure header */}
                    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 bg-muted/30 px-5 py-3">
                      <div className="flex min-w-0 items-center gap-2">
                        <h3 className="truncate text-sm font-semibold text-foreground">{structureName}</h3>
                        <Badge className="border-0 bg-muted px-2 py-0 text-[11px] font-medium text-muted-foreground">
                          {issues.length} item{issues.length !== 1 ? "s" : ""}
                        </Badge>
                        {criticalCount > 0 && (
                          <Badge className="border-0 bg-destructive/10 px-2 py-0 text-[11px] font-medium text-destructive">
                            {criticalCount} critical
                          </Badge>
                        )}
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 gap-1 text-xs"
                        onClick={() => navigate(`/structures/${structureId}`)}
                      >
                        Open structure
                        <ArrowRight className="h-3 w-3" />
                      </Button>
                    </div>

                    {/* Issues for this structure */}
                    <ul className="divide-y divide-border/60">
                      {issues.map((issue, idx) => {
                        const style = SEVERITY_STYLES[issue.severity] ?? SEVERITY_STYLES.minor;
                        const Icon = style.icon;
                        return (
                          <li
                            key={`${issue.code}-${issue.entity_id ?? idx}`}
                            className="flex items-start gap-3 px-5 py-3.5"
                          >
                            <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${style.iconClass}`} />
                            <div className="min-w-0 flex-1">
                              <p className="text-sm text-foreground">{issue.message}</p>
                              <p className="mt-0.5 text-xs capitalize text-muted-foreground">
                                {issue.category}
                              </p>
                            </div>
                            <Badge
                              className={`shrink-0 border-0 px-2 py-0 text-[11px] font-medium ${style.badgeClass}`}
                            >
                              {style.label}
                            </Badge>
                          </li>
                        );
                      })}
                    </ul>
                  </Card>
                );
              })}
            </div>
          )}

          {/* ── Blocker message ── */}
          {!loading && issueCount > 0 && (
            <div className="flex items-start gap-3 rounded-xl border border-border/60 bg-muted/40 px-5 py-4">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
              <div>
                <p className="text-sm font-medium text-foreground">Export unavailable</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Complete all items above to export your structures.
                </p>
              </div>
            </div>
          )}
        </TabsContent>

        <TabsContent value="duplicates" className="space-y-6">
          <DuplicatesTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
