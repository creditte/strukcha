import { useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  ArrowLeft,
  ArrowRight,
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Info,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import type { StructureResult } from "@/hooks/useClientHealthReview";

const SEVERITY_CONFIG = {
  critical: {
    icon: AlertCircle,
    border: "border-l-destructive",
    bg: "bg-destructive/5",
    badge: "bg-destructive/15 text-destructive",
    label: "Critical",
  },
  gap: {
    icon: AlertTriangle,
    border: "border-l-warning",
    bg: "bg-warning/5",
    badge: "bg-warning/15 text-warning",
    label: "Gap",
  },
  minor: {
    icon: Info,
    border: "border-l-primary",
    bg: "bg-primary/5",
    badge: "bg-primary/15 text-primary",
    label: "Minor",
  },
  info: {
    icon: Info,
    border: "border-l-muted-foreground",
    bg: "bg-muted/30",
    badge: "bg-muted text-muted-foreground",
    label: "Info",
  },
} as const;

const STATUS_DOT: Record<string, string> = {
  good: "bg-success",
  warning: "bg-warning",
  critical: "bg-destructive",
};

interface Props {
  structure: StructureResult;
  onBack: () => void;
}

const ISSUE_PAGE_SIZE = 10;

export default function StructureIssuesPanel({ structure, onBack }: Props) {
  const [page, setPage] = useState(1);
  const actionableIssues = structure.issues.filter((i) => i.severity !== "info");
  const hasIssues = actionableIssues.length > 0;
  const pageCount = Math.max(1, Math.ceil(actionableIssues.length / ISSUE_PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const pageStart = (currentPage - 1) * ISSUE_PAGE_SIZE;
  const pageIssues = actionableIssues.slice(pageStart, pageStart + ISSUE_PAGE_SIZE);

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="space-y-4">
        <button
          onClick={onBack}
          className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to Health Check
        </button>

        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className={`h-2.5 w-2.5 rounded-full shrink-0 ${STATUS_DOT[structure.status]}`} />
            <div>
              <h2 className="text-2xl font-semibold tracking-tight text-foreground">
                {structure.name}
              </h2>
              <p className="text-sm text-muted-foreground mt-0.5">
                Score: <span className="font-semibold tabular-nums text-foreground">{structure.score}</span>/100
                {" · "}
                {structure.friendlyLabel}
              </p>
            </div>
          </div>

          <Button asChild className="gap-2 rounded-xl text-sm font-medium">
            <Link to={`/structures/${structure.id}`}>
              Open Structure
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </Button>
        </div>
      </div>

      {/* Issues list */}
      {hasIssues ? (
        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium uppercase tracking-wider text-muted-foreground">
              Issues to Address
            </h3>
            <span className="text-xs text-muted-foreground">
              {actionableIssues.length} issue{actionableIssues.length !== 1 ? "s" : ""}
            </span>
          </div>

          <div className="space-y-2">
            {pageIssues.map((issue, idx) => {
              const config = SEVERITY_CONFIG[issue.severity];
              const Icon = config.icon;
              return (
                <div
                  key={idx}
                  className={`rounded-xl border border-border/60 ${config.bg} px-5 py-4 border-l-[3px] ${config.border}`}
                >
                  <div className="flex items-start gap-3">
                    <Icon className="h-4 w-4 mt-0.5 shrink-0 text-muted-foreground" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium text-foreground">
                          {issue.message}
                        </span>
                        <Badge className={`text-[10px] rounded-full border-0 font-medium ${config.badge}`}>
                          {config.label}
                        </Badge>
                      </div>
                      {issue.entity_name && (
                        <p className="text-xs text-muted-foreground mt-1">
                          Entity: {issue.entity_name}
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          {pageCount > 1 && (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span className="text-xs text-muted-foreground">
                Showing {pageStart + 1}–{Math.min(pageStart + ISSUE_PAGE_SIZE, actionableIssues.length)} of {actionableIssues.length} issues
              </span>
              <div className="flex items-center gap-2">
                <Button size="sm" variant="outline" className="h-8 gap-1 text-xs" disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)}>
                  <ChevronLeft className="h-3.5 w-3.5" /> Previous
                </Button>
                <span className="text-xs tabular-nums text-muted-foreground">Page {currentPage} of {pageCount}</span>
                <Button size="sm" variant="outline" className="h-8 gap-1 text-xs" disabled={currentPage === pageCount} onClick={() => setPage(currentPage + 1)}>
                  Next <ChevronRight className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          )}
        </section>
      ) : (
        <section className="text-center py-12 space-y-3">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-success/10">
            <CheckCircle2 className="h-6 w-6 text-success" />
          </div>
          <p className="text-sm text-muted-foreground">
            No issues found — this structure is healthy.
          </p>
        </section>
      )}

      {/* Bottom CTA */}
      <div className="flex justify-center pt-2">
        <Button asChild variant="outline" className="gap-2 rounded-xl text-sm">
          <Link to={`/structures/${structure.id}`}>
            View Diagram
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </Button>
      </div>
    </div>
  );
}
