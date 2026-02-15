import { useEffect, useState, useCallback } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Search, Network, Trash2, RotateCcw } from "lucide-react";

interface Structure {
  id: string;
  name: string;
  updated_at: string;
  deleted_at: string | null;
}

export default function Structures() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [structures, setStructures] = useState<Structure[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [showDeleted, setShowDeleted] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Structure | null>(null);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    let query = supabase
      .from("structures")
      .select("id, name, updated_at, deleted_at")
      .order("updated_at", { ascending: false });

    if (!showDeleted) {
      query = query.is("deleted_at", null);
    }

    const { data } = await query;
    setStructures((data as Structure[]) ?? []);
    setLoading(false);
  }, [showDeleted]);

  useEffect(() => {
    load();
  }, [load]);

  // Check admin role
  useEffect(() => {
    if (!user?.id) return;
    supabase
      .rpc("has_role", { _user_id: user.id, _role: "admin" })
      .then(({ data }) => setIsAdmin(!!data));
  }, [user?.id]);

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    const { error } = await supabase
      .from("structures")
      .update({ deleted_at: new Date().toISOString() } as any)
      .eq("id", deleteTarget.id);

    if (error) {
      toast({ title: "Delete failed", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Structure deleted", description: `"${deleteTarget.name}" has been removed` });
      load();
    }
    setDeleting(false);
    setDeleteTarget(null);
  };

  const handleRestore = async (structure: Structure) => {
    const { error } = await supabase
      .from("structures")
      .update({ deleted_at: null } as any)
      .eq("id", structure.id);

    if (error) {
      toast({ title: "Restore failed", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Structure restored", description: `"${structure.name}" has been restored` });
      load();
    }
  };

  const filtered = structures.filter((s) =>
    s.name.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">Structures</h1>
        {isAdmin && (
          <Button
            variant={showDeleted ? "secondary" : "outline"}
            size="sm"
            className="gap-1.5"
            onClick={() => setShowDeleted(!showDeleted)}
          >
            <Trash2 className="h-3.5 w-3.5" />
            {showDeleted ? "Hide deleted" : "Show deleted"}
          </Button>
        )}
      </div>
      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Search structures..."
          className="pl-9"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>
      {loading ? (
        <p className="text-sm text-muted-foreground">Loading...</p>
      ) : filtered.length === 0 ? (
        <p className="text-sm text-muted-foreground">No structures found.</p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((s) => {
            const isDeleted = !!s.deleted_at;
            return (
              <Card key={s.id} className={`group relative transition-colors ${isDeleted ? "opacity-60" : "hover:bg-accent/50"}`}>
                <CardContent className="flex items-center gap-3 p-4">
                  {isDeleted ? (
                    <div className="flex items-center gap-3 flex-1 min-w-0">
                      <Network className="h-5 w-5 text-muted-foreground" />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <p className="font-medium truncate line-through">{s.name}</p>
                          <Badge variant="destructive" className="text-[10px] px-1.5 py-0 shrink-0">Deleted</Badge>
                        </div>
                        <p className="text-xs text-muted-foreground">
                          Deleted {new Date(s.deleted_at!).toLocaleDateString()}
                        </p>
                      </div>
                      {isAdmin && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="gap-1 shrink-0"
                          onClick={() => handleRestore(s)}
                        >
                          <RotateCcw className="h-3.5 w-3.5" /> Restore
                        </Button>
                      )}
                    </div>
                  ) : (
                    <>
                      <Link to={`/structures/${s.id}`} className="flex items-center gap-3 flex-1 min-w-0">
                        <Network className="h-5 w-5 text-muted-foreground" />
                        <div>
                          <p className="font-medium">{s.name}</p>
                          <p className="text-xs text-muted-foreground">
                            Updated {new Date(s.updated_at).toLocaleDateString()}
                          </p>
                        </div>
                      </Link>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity text-destructive hover:text-destructive"
                        onClick={(e) => { e.preventDefault(); setDeleteTarget(s); }}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Delete confirmation */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete structure?</AlertDialogTitle>
            <AlertDialogDescription>
              This will remove <span className="font-medium">"{deleteTarget?.name}"</span> from your
              structures list. The underlying entities and relationships will not be affected.
              {isAdmin && " Admins can restore deleted structures later."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={deleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleting ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
