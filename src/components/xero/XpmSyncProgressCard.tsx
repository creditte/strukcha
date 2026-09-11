import { useEffect, useState } from "react";
import { AlertTriangle, Check, Loader2, RefreshCw, Users, Network, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { XpmSyncJob, XpmSyncPhase } from "@/hooks/useXpmSyncJob";
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

const STEPS: { phase: XpmSyncPhase; label: string; icon: typeof Users }[] = [
  { phase: "clients", label: "Reading clients", icon: Users },
  { phase: "groups", label: "Building groups", icon: Network },
  { phase: "staff", label: "Finishing up", icon: Sparkles },
];

function phaseIndex(phase: XpmSyncPhase | undefined) {
  if (phase === "groups") return 1;
  if (phase === "staff" || phase === "done") return 2;
  return 0;
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
 * One consistent progress panel for the XPM sync — same wording, steps, counts
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
  const current = phaseIndex(job?.phase);

  const stats = [
    { label: "Clients read", value: job ? job.clientsFetched.toLocaleString() : "0" },
    {
      label: "Groups",
      value: job && job.groupsTotal > 0 ? `${job.groupsProcessed} / ${job.groupsTotal}` : "—",
    },
    { label: "Diagrams created", value: job ? job.groupsCreated.toLocaleString() : "0" },
    { label: "Already up to date", value: job ? job.groupsSkippedUnchanged.toLocaleString() : "0" },
  ];

  return (
    <div
      className={cn(
        "overflow-hidden rounded-2xl border shadow-sm",
        stalled ? "border-warning/40 bg-warning/5" : "border-primary/25 bg-card",
        className,
      )}
    >
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3 px-4 pt-4 sm:px-5">
        <div className="flex min-w-0 items-start gap-2.5">
          <span
            className={cn(
              "mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full",
              stalled ? "bg-warning/15" : "bg-primary/10",
            )}
          >
            {stalled ? (
              <AlertTriangle className="h-4 w-4 text-warning" />
            ) : (
              <Loader2 className="h-4 w-4 animate-spin text-primary" />
            )}
          </span>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-foreground">
              {stalled ? "Xero sync stopped responding" : "Syncing from Xero Practice Manager"}
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {stalled
                ? "Nothing was lost — start it again and it picks up where it left off."
                : label || "Getting started…"}
            </p>
          </div>
        </div>
        <div className="text-right">
          {!stalled && (
            <p className="text-lg font-semibold leading-none tabular-nums text-foreground">{percent}%</p>
          )}
          {elapsed && <p className="mt-1 text-[11px] tabular-nums text-muted-foreground">{elapsed} elapsed</p>}
        </div>
      </div>

      {/* Progress bar */}
      {!stalled && (
        <div className="mt-3 px-4 sm:px-5">
          <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary transition-[width] duration-700 ease-out"
              style={{ width: `${Math.max(3, percent)}%` }}
            />
          </div>
        </div>
      )}

      {/* Steps */}
      <div className="mt-3.5 flex flex-wrap items-center gap-x-5 gap-y-2 px-4 sm:px-5">
        {STEPS.map((step, i) => {
          const done = i < current;
          const active = i === current && !stalled;
          const Icon = step.icon;
          return (
            <div
              key={step.phase}
              className={cn(
                "flex items-center gap-1.5 text-xs",
                done && "text-muted-foreground",
                active && "font-medium text-foreground",
                !done && !active && "text-muted-foreground/50",
              )}
            >
              <span
                className={cn(
                  "flex h-4 w-4 items-center justify-center rounded-full",
                  done && "bg-success/15 text-success",
                  active && "bg-primary/15 text-primary",
                  !done && !active && "bg-muted",
                )}
              >
                {done ? <Check className="h-2.5 w-2.5" /> : <Icon className="h-2.5 w-2.5" />}
              </span>
              {step.label}
            </div>
          );
        })}
      </div>

      {/* Counts */}
      <div className="mt-3.5 grid grid-cols-2 gap-px border-t border-border/60 bg-border/40 sm:grid-cols-4">
        {stats.map((s) => (
          <div key={s.label} className="bg-card px-4 py-2.5">
            <p className="text-sm font-semibold tabular-nums text-foreground">{s.value}</p>
            <p className="mt-0.5 text-[11px] text-muted-foreground">{s.label}</p>
          </div>
        ))}
      </div>

      {/* Footer */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/60 px-4 py-2.5 sm:px-5">
        <p className="text-[11px] text-muted-foreground">
          {stalled ? "Safe to restart at any time." : "You can keep working — this continues in the background."}
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
