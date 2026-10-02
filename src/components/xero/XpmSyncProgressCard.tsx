import { useEffect, useState } from "react";
import { AlertTriangle, Loader2, RefreshCw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
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

function useElapsed(startedAt?: string) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  if (!startedAt) return null;
  const secs = Math.max(0, Math.floor((now - new Date(startedAt).getTime()) / 1000));
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return m > 0 ? `${m}m ${String(s).padStart(2, "0")}s` : `${s}s`;
}

/**
 * Compact, single-line progress strip for the XPM sync — same wording, counts
 * and controls wherever the sync can be started.
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
  const elapsed = useElapsed(job?.startedAt);

  const details: string[] = [];
  if (job) {
    if (job.clientsFetched > 0) details.push(`${job.clientsFetched.toLocaleString()} clients`);
    if (job.groupsTotal > 0) details.push(`${job.groupsProcessed}/${job.groupsTotal} groups`);
    if (job.groupsCreated > 0) details.push(`${job.groupsCreated} new`);
    if (job.groupsSkippedUnchanged > 0) details.push(`${job.groupsSkippedUnchanged} up to date`);
  }
  if (elapsed) details.push(elapsed);

  return (
    <div
      className={cn(
        "rounded-lg border px-3 py-2",
        stalled ? "border-warning/40 bg-warning/5" : "border-border bg-card",
        className,
      )}
    >
      <div className="flex items-center gap-2.5">
        {stalled ? (
          <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-warning" />
        ) : (
          <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-primary" />
        )}

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="truncate text-xs font-medium text-foreground">
              {stalled ? "Xero sync stopped responding" : label || "Starting Xero sync…"}
            </p>
            {!stalled && (
              <span className="ml-auto shrink-0 text-[11px] font-medium tabular-nums text-muted-foreground">
                {percent}%
              </span>
            )}
          </div>
          {!stalled && (
            <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-primary transition-[width] duration-700 ease-out"
                style={{ width: `${Math.max(3, percent)}%` }}
              />
            </div>
          )}
          <p className="mt-1 truncate text-[11px] text-muted-foreground">
            {stalled
              ? "Nothing was lost — start again and it resumes."
              : details.join(" · ") || "Runs in the background."}
          </p>
        </div>

        {stalled ? (
          <Button size="sm" variant="outline" className="h-7 shrink-0 gap-1.5 rounded-lg text-xs" onClick={onResume}>
            <RefreshCw className="h-3 w-3" /> Start again
          </Button>
        ) : (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 shrink-0 gap-1.5 rounded-lg px-2 text-xs text-muted-foreground hover:text-destructive"
            onClick={onStop}
            disabled={stopping}
          >
            {stopping ? <Loader2 className="h-3 w-3 animate-spin" /> : <X className="h-3 w-3" />}
            {stopping ? "Stopping…" : "Stop"}
          </Button>
        )}
      </div>
    </div>
  );
}
