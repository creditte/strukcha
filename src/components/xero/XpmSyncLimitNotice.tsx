import { Link } from "react-router-dom";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { XpmSyncJob } from "@/hooks/useXpmSyncJob";

interface XpmSyncLimitNoticeProps {
  message: string;
  job: XpmSyncJob | null;
}

/** Shown when a sync could not add every client group. */
export default function XpmSyncLimitNotice({ message, job }: XpmSyncLimitNoticeProps) {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3.5">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
      <div className="min-w-0 flex-1 space-y-1.5 text-sm">
        <p className="font-semibold text-foreground">Some client groups were not added</p>
        <p className="text-muted-foreground">{message}</p>
        {job && job.blockedGroups.length > 0 && (
          <p className="text-xs text-muted-foreground">
            For example: {job.blockedGroups.slice(0, 5).join(", ")}
            {job.groupsBlockedByLimit > 5 ? "…" : ""}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-2 pt-1.5">
          <Button asChild size="sm" variant="outline" className="h-7 rounded-lg text-xs">
            <Link to="/structures">Manage structures</Link>
          </Button>
          <Button asChild size="sm" className="h-7 rounded-lg text-xs">
            <Link to="/settings?tab=billing">Upgrade plan</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
