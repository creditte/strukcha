import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleDot,
} from "lucide-react";
import type { StructureIssue } from "@/hooks/useClientHealthReview";

const SEVERITY_STYLES: Record<
  string,
  { label: string; icon: typeof AlertCircle; iconClass: string; badgeClass: string }
> = {
  critical: {
    label: "Critical",
    icon: AlertCircle,
    iconClass: "text-destructive",
    badgeClass: "bg-destructive/10 text-destructive",
  },
  gap: {
    label: "Warning",
    icon: AlertTriangle,
    iconClass: "text-warning",
    badgeClass: "bg-warning/10 text-warning",
  },
  minor: {
    label: "Minor",
    icon: CircleDot,
    iconClass: "text-muted-foreground",
    badgeClass: "bg-muted text-muted-foreground",
  },
};

const ISSUE_PAGE_SIZE = 6;

interface Props {
  structureId: string;
  structureName: string;
  issues: StructureIssue[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOpenStructure: () => void;
}

export default function StructureIssueGroup({
  structureName,
  issues,
  open,
  onOpenChange,
  onOpenStructure,
}: Props) {
  const [issuePage, setIssuePage] = useState(1);
  const criticalCount = issues.filter((i) => i.severity === "critical").length;
  const issuePageCount = Math.max(1, Math.ceil(issues.length / ISSUE_PAGE_SIZE));
  const currentIssuePage = Math.min(issuePage, issuePageCount);
  const issueStart = (currentIssuePage - 1) * ISSUE_PAGE_SIZE;
  const visible = issues.slice(issueStart, issueStart + ISSUE_PAGE_SIZE);

  useEffect(() => {
    setIssuePage(1);
  }, [issues]);

  return (
    <Card className="overflow-hidden">
      <Collapsible open={open} onOpenChange={onOpenChange}>
        <div className="flex flex-wrap items-center justify-between gap-2 bg-muted/30 px-3 py-2.5 sm:px-5 sm:py-3">
          <CollapsibleTrigger asChild>
            <button
              type="button"
              className="flex min-w-0 flex-1 items-center gap-2 text-left"
              aria-expanded={open}
            >
              <ChevronDown
                className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${open ? "" : "-rotate-90"}`}
              />
              <span className="truncate text-sm font-semibold text-foreground">{structureName}</span>
              <Badge className="shrink-0 border-0 bg-muted px-2 py-0 text-[11px] font-medium text-muted-foreground">
                {issues.length} item{issues.length !== 1 ? "s" : ""}
              </Badge>
              {criticalCount > 0 && (
                <Badge className="shrink-0 border-0 bg-destructive/10 px-2 py-0 text-[11px] font-medium text-destructive">
                  {criticalCount} critical
                </Badge>
              )}
            </button>
          </CollapsibleTrigger>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 shrink-0 gap-1 text-xs"
            onClick={onOpenStructure}
          >
            Open structure
            <ArrowRight className="h-3 w-3" />
          </Button>
        </div>

        <CollapsibleContent>
          <ul className="divide-y divide-border/60 border-t border-border/60">
            {visible.map((issue, idx) => {
              const style = SEVERITY_STYLES[issue.severity] ?? SEVERITY_STYLES.minor;
              const Icon = style.icon;
              return (
                <li
                  key={`${issue.code}-${issue.entity_id ?? idx}`}
                  className="flex items-start gap-3 px-3 py-3 sm:px-5 sm:py-3.5"
                >
                  <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${style.iconClass}`} />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-foreground">{issue.message}</p>
                    <p className="mt-0.5 text-xs capitalize text-muted-foreground">{issue.category}</p>
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
          {issues.length > ISSUE_PAGE_SIZE && (
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/60 px-3 py-2 sm:px-5">
              <span className="text-xs text-muted-foreground">
                Items {issueStart + 1}–{Math.min(issueStart + ISSUE_PAGE_SIZE, issues.length)} of {issues.length}
              </span>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="icon"
                  className="h-7 w-7"
                  disabled={currentIssuePage === 1}
                  aria-label="Previous issue page"
                  onClick={() => setIssuePage(currentIssuePage - 1)}
                >
                  <ChevronLeft className="h-3.5 w-3.5" />
                </Button>
                <span className="min-w-14 text-center text-xs tabular-nums text-muted-foreground">
                  {currentIssuePage} / {issuePageCount}
                </span>
                <Button
                  variant="outline"
                  size="icon"
                  className="h-7 w-7"
                  disabled={currentIssuePage === issuePageCount}
                  aria-label="Next issue page"
                  onClick={() => setIssuePage(currentIssuePage + 1)}
                >
                  <ChevronRight className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          )}
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}
