import { Loader2 } from "lucide-react";
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

export type XeroConnectionType = "standard" | "practice_manager";

interface XeroConnectButtonProps {
  onConnect: (type: XeroConnectionType) => void;
  loading?: boolean;
  /** Reconnect wording for a connection that has gone invalid. */
  reconnect?: boolean;
  className?: string;
}

/**
 * The single entry point for linking Xero. Both the dashboard and the
 * integrations tab use this so the wording, logo and choices never drift apart.
 */
export default function XeroConnectButton({
  onConnect,
  loading = false,
  reconnect = false,
  className,
}: XeroConnectButtonProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          className={cn(
            "h-10 gap-2 rounded-xl px-5 text-sm font-medium border-[#13B5EA]/40 hover:bg-[#13B5EA]/5 hover:border-[#13B5EA]",
            className,
          )}
          disabled={loading}
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <XeroLogo className="h-4 w-4" />}
          {loading ? "Opening Xero…" : reconnect ? "Reconnect to Xero" : "Connect to Xero"}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
          Choose how to connect
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          className="flex flex-col items-start gap-0.5"
          onClick={() => onConnect("practice_manager")}
        >
          <span className="text-sm font-medium">Xero Practice Manager</span>
          <span className="text-xs text-muted-foreground">
            Import client groups and relationships (needs Practice Manager access).
          </span>
        </DropdownMenuItem>
        <DropdownMenuItem
          className="flex flex-col items-start gap-0.5"
          onClick={() => onConnect("standard")}
        >
          <span className="text-sm font-medium">Xero organisation</span>
          <span className="text-xs text-muted-foreground">
            Works for any Xero account — imports your contacts.
          </span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
