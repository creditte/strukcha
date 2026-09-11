import { AlertTriangle, Loader2, RefreshCw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import type { XpmSyncJob } from "@/hooks/useXpmSyncJob";
import { cn } from "@/lib/utils";

interface XpmSyncProgressCardProps {
  job: XpmSyncJob | null;
  label: string;
  percent: number;
  /** The job row says it is running but its worker went quiet. */
  stalled?: boolean;
  stopping?: boolean;
  onStop: () => void;
  onResume: () => void;
  className?: string;
}

/**
 * One consistent progress panel for the XPM sync — same wording, counts and
 * controls wherever the sync can be started.
 */
export default function XpmSyncProgressCard({
  job,
  label,
  percent,
  stalled = false,
  stopping = false,
  onStop,
  onResume,
  className,
}: XpmSyncProgressCardProps) {
  const details: string[] = [];
  if (job) {
    if (job.clientsFetched > 0) details.push(`${job.clientsFetched.toLocaleString()} clients read`);
    if (job.groupsCreated > 0) details.push(`${job.groupsCreated} diagrams created`);
    if (job.groupsSkippedUnchanged > 0) details.push(`${job.groupsSkippedUnchanged} unchanged`);
  }

  return (
    <div
      className={cn(
        "space-y-2 rounded-xl border px-4 py-3",
        stalled ? "border-warning/40 bg-warning/5" : "border-border bg-card/60",
        className,
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2">
          {stalled ? (
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
          ) : (
            <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-primary" />
          )}
          <div className="min-w-0 space-y-0.5">
            <p className="text-sm font-medium text-foreground">
              {stalled ? "XPM sync stopped responding" : "Syncing from Xero Practice Manager"}
            </p>
            <p className="text-xs text-muted-foreground">{label || "Starting XPM sync…"}</p>
          </div>
        </div>
        {!stalled && (
          <span className="shrink-0 text-xs font-medium tabular-nums text-muted-foreground">
            {percent}%
          </span>
        )}
      </div>

      {!stalled && <Progress value={percent} className="h-1.5" />}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[11px] text-muted-foreground">
          {details.length > 0 ? details.join(" · ") : "You can keep working while this runs."}
        </p>
        {stalled ? (
          <Button size="sm" variant="outline" className="h-7 gap-1.5 rounded-lg text-xs" onClick={onResume}>
            <RefreshCw className="h-3 w-3" /> Start again
          </Button>
        ) : (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1.5 rounded-lg px-2 text-xs text-muted-foreground hover:text-destructive"
            onClick={onStop}
            disabled={stopping}
          >
            {stopping ? <Loader2 className="h-3 w-3 animate-spin" /> : <X className="h-3 w-3" />}
            {stopping ? "Stopping…" : "Stop sync"}
          </Button>
        )}
      </div>
    </div>
  );
}
