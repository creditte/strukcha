import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Search, Loader2, Network, AlertTriangle, RefreshCw, ChevronLeft, ChevronRight } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useBilling } from "@/hooks/useBilling";

interface Row {
  xpm_uuid: string;
  name: string;
  is_selected: boolean;
  last_synced_at: string | null;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Disable editing while a sync is running so the selection can't shift mid-run. */
  syncing?: boolean;
  /** Read the client group list from Practice Manager without creating anything. */
  onRefreshCatalogue?: () => Promise<void>;
  /** Called after a selection has been saved, so the caller can offer a sync. */
  onSaved?: (selectedCount: number) => void;
}

/** One page of groups at a time: firms can have thousands. */
const PAGE_SIZE = 100;

export default function XpmGroupSelectionDialog({
  open,
  onOpenChange,
  syncing,
  onRefreshCatalogue,
  onSaved,
}: Props) {
  const { billing } = useBilling();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [page, setPage] = useState(0);
  const [total, setTotal] = useState(0);
  const [matchCount, setMatchCount] = useState(0);
  const [selectedTotal, setSelectedTotal] = useState(0);
  const [archiveDropped, setArchiveDropped] = useState(true);
  const [confirmClose, setConfirmClose] = useState(false);

  // Pending changes are held as a diff so a page of 100 rows never limits what
  // the user can tick across a list of thousands.
  const [added, setAdded] = useState<Map<string, string>>(new Map());
  const [removed, setRemoved] = useState<Map<string, string>>(new Map());
  const reqId = useRef(0);

  const dirty = added.size > 0 || removed.size > 0;

  useEffect(() => {
    const t = setTimeout(() => {
      setDebounced(search.trim());
      setPage(0);
    }, 250);
    return () => clearTimeout(t);
  }, [search]);

  const loadCounts = useCallback(async () => {
    const [all, selected] = await Promise.all([
      supabase.from("xpm_groups").select("xpm_uuid", { count: "exact", head: true }),
      supabase
        .from("xpm_groups")
        .select("xpm_uuid", { count: "exact", head: true })
        .eq("is_selected", true),
    ]);
    setTotal(all.count ?? 0);
    setSelectedTotal(selected.count ?? 0);
  }, []);

  const loadPage = useCallback(async () => {
    const id = ++reqId.current;
    setLoading(true);
    let q = supabase
      .from("xpm_groups")
      .select("xpm_uuid, name, is_selected, last_synced_at", { count: "exact" })
      .order("name", { ascending: true })
      .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);
    if (debounced) q = q.ilike("name", `%${debounced}%`);
    const { data, error, count } = await q;
    if (id !== reqId.current) return;
    if (error) {
      toast.error("Could not load client groups", { description: error.message });
    } else {
      setRows((data ?? []) as Row[]);
      setMatchCount(count ?? 0);
    }
    setLoading(false);
  }, [page, debounced]);

  useEffect(() => {
    if (!open) return;
    loadPage();
  }, [open, loadPage]);

  useEffect(() => {
    if (!open) return;
    loadCounts();
  }, [open, loadCounts]);

  // Reset the dialog whenever it is reopened.
  useEffect(() => {
    if (open) return;
    setAdded(new Map());
    setRemoved(new Map());
    setSearch("");
    setDebounced("");
    setPage(0);
    setConfirmClose(false);
  }, [open]);

  const isChosen = (r: Row) =>
    added.has(r.xpm_uuid) ? true : removed.has(r.xpm_uuid) ? false : r.is_selected;

  const setChosen = (r: Row, on: boolean) => {
    setAdded((prev) => {
      const next = new Map(prev);
      if (on && !r.is_selected) next.set(r.xpm_uuid, r.name);
      else next.delete(r.xpm_uuid);
      return next;
    });
    setRemoved((prev) => {
      const next = new Map(prev);
      if (!on && r.is_selected) next.set(r.xpm_uuid, r.name);
      else next.delete(r.xpm_uuid);
      return next;
    });
  };

  const toggleAllShown = (on: boolean) => {
    for (const r of rows) setChosen(r, on);
  };

  const unlimited = billing?.unlimited_structures === true;
  const remaining = unlimited
    ? Number.POSITIVE_INFINITY
    : Math.max(0, (billing?.diagram_limit ?? 0) - (billing?.diagram_count ?? 0));
  const overCapacity = !unlimited && added.size > remaining;
  const effectiveSelected = selectedTotal + added.size - removed.size;
  const allShownChosen = rows.length > 0 && rows.every((r) => isChosen(r));

  const handleRefreshCatalogue = async () => {
    if (!onRefreshCatalogue) return;
    setRefreshing(true);
    try {
      await onRefreshCatalogue();
    } catch {
      /* the caller already reported it */
    } finally {
      setRefreshing(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      for (const [uuids, value] of [
        [[...added.keys()], true],
        [[...removed.keys()], false],
      ] as [string[], boolean][]) {
        for (let i = 0; i < uuids.length; i += 200) {
          const slice = uuids.slice(i, i + 200);
          if (slice.length === 0) continue;
          const { data, error } = await supabase
            .from("xpm_groups")
            .update({ is_selected: value })
            .in("xpm_uuid", slice)
            .select("xpm_uuid");
          if (error) throw error;
          // An access rule can reject the change without raising an error, and
          // a silent "saved" would be worse than a clear refusal.
          if ((data?.length ?? 0) === 0) {
            throw new Error(
              "Your account isn't allowed to change which client groups are used. Ask the firm owner or an admin to do it.",
            );
          }
        }
      }

      const dropped = [...removed.keys()];
      let archived = 0;
      if (dropped.length > 0 && archiveDropped) {
        const { data, error } = await supabase.rpc("xpm_archive_group_structures", {
          _group_uuids: dropped,
        });
        if (error) {
          toast.error("Selection saved, but the old diagrams weren't archived", {
            description: error.message,
          });
        } else {
          archived = ((data as any)?.archived as number) ?? 0;
        }
      }

      const finalCount = effectiveSelected;
      setAdded(new Map());
      setRemoved(new Map());
      await Promise.all([loadCounts(), loadPage()]);

      toast.success(
        finalCount === 0
          ? "No client groups selected — the next sync won't create diagrams."
          : `${finalCount} client group${finalCount === 1 ? "" : "s"} will be kept as diagrams.` +
            (archived > 0 ? ` ${archived} diagram${archived === 1 ? "" : "s"} archived.` : ""),
      );
      onSaved?.(finalCount);
      onOpenChange(false);
    } catch (err: any) {
      toast.error("Could not save your selection", { description: err?.message ?? String(err) });
    } finally {
      setSaving(false);
    }
  };

  const requestClose = (next: boolean) => {
    if (!next && dirty && !saving) {
      setConfirmClose(true);
      return;
    }
    onOpenChange(next);
  };

  const pages = Math.max(1, Math.ceil(matchCount / PAGE_SIZE));

  return (
    <>
      <Dialog open={open} onOpenChange={requestClose}>
        <DialogContent className="max-w-[calc(100%-1.5rem)] sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Choose client groups</DialogTitle>
            <DialogDescription className="text-left">
              Only the groups you tick are turned into diagrams when you sync. Everything else stays in
              the list for later.
            </DialogDescription>
          </DialogHeader>

          {syncing && (
            <div className="flex items-start gap-2 rounded-lg border border-border/60 bg-muted/40 p-3 text-xs text-muted-foreground">
              <Loader2 className="mt-0.5 h-3.5 w-3.5 shrink-0 animate-spin" />
              A sync is running right now. Your changes will apply to the next sync.
            </div>
          )}

          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="relative w-full sm:w-64">
              <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search all groups..."
                className="h-8 pl-8 text-xs"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <div className="flex items-center gap-2">
              <Badge variant="secondary" className="text-[10px]">
                {effectiveSelected} selected
              </Badge>
              <Badge variant="outline" className="text-[10px]">
                {total} in XPM
              </Badge>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs"
                onClick={() => toggleAllShown(!allShownChosen)}
                disabled={loading || rows.length === 0}
              >
                {allShownChosen ? "Clear shown" : "Select shown"}
              </Button>
            </div>
          </div>

          {overCapacity && (
            <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-xs">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" />
              <span className="text-muted-foreground">
                You've picked {added.size} new groups but only have room for {remaining}. The extra
                groups will be skipped until you archive a structure or upgrade.
              </span>
            </div>
          )}

          {removed.size > 0 && (
            <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-border/60 bg-muted/40 p-3 text-xs">
              <Checkbox
                className="mt-0.5"
                checked={archiveDropped}
                onCheckedChange={(v) => setArchiveDropped(v === true)}
              />
              <span className="text-muted-foreground">
                Archive the {removed.size} diagram{removed.size === 1 ? "" : "s"} for the group
                {removed.size === 1 ? "" : "s"} you've un-ticked. Un-ticked groups stop being
                refreshed, so their diagrams would otherwise look current when they aren't. Nothing is
                deleted — you can restore them from Structures.
              </span>
            </label>
          )}

          <ScrollArea className="h-[320px] rounded-lg border border-border/60">
            <div className="divide-y divide-border/50">
              {loading ? (
                <div className="space-y-2 p-3">
                  {Array.from({ length: 6 }).map((_, i) => (
                    <Skeleton key={i} className="h-8 w-full" />
                  ))}
                </div>
              ) : rows.length === 0 ? (
                <div className="py-12 text-center text-muted-foreground">
                  <Network className="mx-auto mb-3 h-8 w-8 opacity-40" />
                  <p className="text-sm">
                    {total === 0
                      ? "No client groups yet — load them from Xero to get started."
                      : "No groups match your search."}
                  </p>
                  {total === 0 && onRefreshCatalogue && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="mt-4 gap-2"
                      onClick={handleRefreshCatalogue}
                      disabled={refreshing || syncing}
                    >
                      {refreshing ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <RefreshCw className="h-3.5 w-3.5" />
                      )}
                      Load client groups from Xero
                    </Button>
                  )}
                </div>
              ) : (
                rows.map((r) => (
                  <label
                    key={r.xpm_uuid}
                    className="flex cursor-pointer items-center gap-3 px-3 py-2 hover:bg-accent/40"
                  >
                    <Checkbox
                      checked={isChosen(r)}
                      onCheckedChange={(v) => setChosen(r, v === true)}
                    />
                    <span className="min-w-0 flex-1 truncate text-sm text-foreground">{r.name}</span>
                    {r.last_synced_at && (
                      <span className="shrink-0 text-[10px] text-muted-foreground">Synced</span>
                    )}
                  </label>
                ))
              )}
            </div>
          </ScrollArea>

          <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
            <div className="flex items-center gap-2">
              {onRefreshCatalogue && total > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 gap-1.5 text-xs"
                  onClick={handleRefreshCatalogue}
                  disabled={refreshing || syncing}
                >
                  {refreshing ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <RefreshCw className="h-3.5 w-3.5" />
                  )}
                  Refresh list from Xero
                </Button>
              )}
            </div>
            {matchCount > PAGE_SIZE && (
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                  disabled={page === 0 || loading}
                >
                  <ChevronLeft className="h-3.5 w-3.5" />
                </Button>
                <span>
                  {page + 1} of {pages}
                </span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={() => setPage((p) => Math.min(pages - 1, p + 1))}
                  disabled={page >= pages - 1 || loading}
                >
                  <ChevronRight className="h-3.5 w-3.5" />
                </Button>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => requestClose(false)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={saving || !dirty} className="gap-2">
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              Save selection
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmClose} onOpenChange={setConfirmClose}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Discard your changes?</AlertDialogTitle>
            <AlertDialogDescription>
              You've changed which client groups are used but haven't saved yet. Closing now loses
              those changes.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep editing</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirmClose(false);
                onOpenChange(false);
              }}
            >
              Discard changes
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
