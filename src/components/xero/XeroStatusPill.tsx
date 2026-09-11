import { AlertTriangle, ListChecks, Loader2, RefreshCw, Settings2, Unplug } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import XeroLogo from "@/components/XeroLogo";
import { cn } from "@/lib/utils";

interface XeroStatusPillProps {
  orgName?: string | null;
  syncing?: boolean;
  disconnecting?: boolean;
  /** The stored Xero sign-in is no longer usable. */
  invalid?: boolean;
  onSync: () => void;
  onChooseGroups: () => void;
  onDisconnect: () => void;
  onReconnect: () => void;
  className?: string;
}

/**
 * Compact "Connected to Xero — <organisation>" status with a single gear menu
 * holding every Xero action. Used everywhere a live connection is shown.
 */
export default function XeroStatusPill({
  orgName,
  syncing = false,
  disconnecting = false,
  invalid = false,
  onSync,
  onChooseGroups,
  onDisconnect,
  onReconnect,
  className,
}: XeroStatusPillProps) {
  const statusLabel = syncing
    ? "Syncing XPM…"
    : disconnecting
      ? "Disconnecting…"
      : invalid
        ? "Reconnection needed"
        : "Connected to Xero";

  return (
    <div
      className={cn(
        "flex h-10 items-center gap-2.5 rounded-xl border pl-3 pr-2",
        invalid ? "border-warning/40 bg-warning/5" : "border-[#13B5EA]/40 bg-[#13B5EA]/5",
        className,
      )}
    >
      {syncing || disconnecting ? (
        <Loader2 className="h-4 w-4 shrink-0 animate-spin text-[#0d8ab8]" />
      ) : invalid ? (
        <AlertTriangle className="h-4 w-4 shrink-0 text-warning" />
      ) : (
        <XeroLogo className="h-4 w-4 shrink-0" />
      )}
      <div className="flex min-w-0 flex-col leading-tight">
        <span
          className={cn(
            "text-[10px] font-medium uppercase tracking-wide",
            invalid ? "text-warning" : "text-[#0d8ab8]",
          )}
        >
          {statusLabel}
        </span>
        <span className="max-w-[180px] truncate text-xs font-medium text-foreground">
          {orgName || "Xero organisation"}
        </span>
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Xero options"
            className="ml-1 h-7 w-7 shrink-0 text-muted-foreground hover:bg-[#13B5EA]/10 hover:text-foreground"
            disabled={disconnecting}
          >
            <Settings2 className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
            Xero options
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          {invalid ? (
            <DropdownMenuItem onClick={onReconnect}>
              <XeroLogo className="mr-2 h-3.5 w-3.5" /> Reconnect to Xero
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem onClick={onSync} disabled={syncing}>
              <RefreshCw className="mr-2 h-3.5 w-3.5" /> Sync XPM
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onClick={onChooseGroups}>
            <ListChecks className="mr-2 h-3.5 w-3.5" /> Choose client groups
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={onDisconnect}
            disabled={disconnecting}
            className="text-muted-foreground focus:text-destructive"
          >
            <Unplug className="mr-2 h-3.5 w-3.5" /> Disconnect
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
