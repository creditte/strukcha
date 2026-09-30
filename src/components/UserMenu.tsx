import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronDown, LogOut, MessageSquarePlus, Settings, User } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import FeedbackModal from "@/components/FeedbackModal";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export default function UserMenu() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const [feedbackOpen, setFeedbackOpen] = useState(false);

  const meta = (user?.user_metadata ?? {}) as Record<string, any>;
  const name: string = meta.full_name || meta.name || user?.email?.split("@")[0] || "User";
  const email = user?.email ?? "";

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
              <User className="h-4 w-4" />
            </div>
            <div className="hidden min-w-0 sm:block">
              <p className="max-w-[160px] truncate text-sm font-medium leading-tight text-foreground">{name}</p>
              <p className="max-w-[160px] truncate text-[11px] leading-tight text-muted-foreground">{email}</p>
            </div>
            <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-60">
          <DropdownMenuLabel className="font-normal">
            <p className="truncate text-sm font-medium">{name}</p>
            <p className="truncate text-xs text-muted-foreground">{email}</p>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => navigate("/settings")}>
            <Settings className="mr-2 h-3.5 w-3.5" /> Settings
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setFeedbackOpen(true)}>
            <MessageSquarePlus className="mr-2 h-3.5 w-3.5" /> Send feedback
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={signOut} className="text-destructive focus:text-destructive">
            <LogOut className="mr-2 h-3.5 w-3.5" /> Sign out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <FeedbackModal open={feedbackOpen} onOpenChange={setFeedbackOpen} hideTrigger />
    </>
  );
}
