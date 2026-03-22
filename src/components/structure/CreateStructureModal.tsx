import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Upload, PenTool, ArrowRight, Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImportXpm: () => void;
}

export default function CreateStructureModal({ open, onOpenChange, onImportXpm }: Props) {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { user } = useAuth();
  const [creating, setCreating] = useState(false);

  const handleDrawManually = async () => {
    if (!user?.id) return;
    setCreating(true);
    try {
      // Get user's tenant_id
      const { data: tenantId } = await supabase.rpc("get_user_tenant_id", { _user_id: user.id });
      if (!tenantId) throw new Error("Could not determine workspace");

      // Create a blank structure
      const { data: structure, error } = await supabase
        .from("structures")
        .insert({
          name: "Untitled Structure",
          tenant_id: tenantId,
        })
        .select("id")
        .single();

      if (error || !structure) throw new Error(error?.message || "Failed to create structure");

      onOpenChange(false);
      navigate(`/structures/${structure.id}?new=manual`);
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setCreating(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Create New Structure</DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-4 pt-2">
          {/* Import from XPM */}
          <button
            onClick={() => { onOpenChange(false); onImportXpm(); }}
            className="group flex flex-col items-start gap-3 rounded-xl border-2 border-border/60 bg-card p-5 text-left transition-all hover:border-primary/40 hover:shadow-sm"
          >
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
              <Upload className="h-5 w-5 text-primary" />
            </div>
            <div>
              <p className="text-sm font-semibold text-foreground">Import from XPM</p>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                Connect to Xero Practice Manager and import client structures automatically.
              </p>
            </div>
            <ArrowRight className="h-4 w-4 text-muted-foreground/40 transition-colors group-hover:text-primary" />
          </button>

          {/* Draw manually */}
          <button
            onClick={handleDrawManually}
            disabled={creating}
            className="group flex flex-col items-start gap-3 rounded-xl border-2 border-border/60 bg-card p-5 text-left transition-all hover:border-primary/40 hover:shadow-sm disabled:opacity-50"
          >
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
              {creating ? (
                <Loader2 className="h-5 w-5 text-primary animate-spin" />
              ) : (
                <PenTool className="h-5 w-5 text-primary" />
              )}
            </div>
            <div>
              <p className="text-sm font-semibold text-foreground">Draw manually</p>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                Build a structure from scratch by adding entities and relationships directly on the canvas.
              </p>
            </div>
            <ArrowRight className="h-4 w-4 text-muted-foreground/40 transition-colors group-hover:text-primary" />
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
