import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Search, Loader2, Network, AlertTriangle } from "lucide-react";
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
}

export default function XpmGroupSelectionDialog({ open, onOpenChange, syncing }: Props) {
  const { billing } = useBilling();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");
  const [chosen, setChosen] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data, error } = await supabase
        .from("xpm_groups")
        .select("xpm_uuid, name, is_selected, last_synced_at")
        .order("name", { ascending: true });
      if (cancelled) return;
      if (error) {
        toast.error("Could not load client groups", { description: error.message });
      } else {
        const list = (data ?? []) as Row[];
        setRows(list);
        setChosen(new Set(list.filter((r) => r.is_selected).map((r) => r.xpm_uuid)));
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  const filtered = useMemo(
    () => rows.filter((r) => r.name.toLowerCase().includes(search.toLowerCase())),
    [rows, search],
  );

  const unlimited = billing?.unlimited_structures === true;
  const remaining = unlimited
    ? Number.POSITIVE_INFINITY
    : Math.max(0, (billing?.diagram_limit ?? 0) - (billing?.diagram_count ?? 0));
  const newlyChosen = rows.filter((r) => !r.is_selected && chosen.has(r.xpm_uuid)).length;
  const overCapacity = !unlimited && newlyChosen > remaining;

  const toggle = (uuid: string) => {
    setChosen((prev) => {
      const next = new Set(prev);
      next.has(uuid) ? next.delete(uuid) : next.add(uuid);
      return next;
    });
  };

  const toggleAllFiltered = (on: boolean) => {
    setChosen((prev) => {
      const next = new Set(prev);
      for (const r of filtered) on ? next.add(r.xpm_uuid) : next.delete(r.xpm_uuid);
      return next;
    });
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const toEnable = rows.filter((r) => !r.is_selected && chosen.has(r.xpm_uuid)).map((r) => r.xpm_uuid);
      const toDisable = rows.filter((r) => r.is_selected && !chosen.has(r.xpm_uuid)).map((r) => r.xpm_uuid);

      for (const [uuids, value] of [
        [toEnable, true],
        [toDisable, false],
      ] as [string[], boolean][]) {
        for (let i = 0; i < uuids.length; i += 200) {
          const slice = uuids.slice(i, i + 200);
          if (slice.length === 0) continue;
          const { error } = await supabase
            .from("xpm_groups")
            .update({ is_selected: value })
            .in("xpm_uuid", slice);
          if (error) throw error;
        }
      }

      setRows((prev) => prev.map((r) => ({ ...r, is_selected: chosen.has(r.xpm_uuid) })));
      toast.success(
        chosen.size === 0
          ? "No client groups selected — the next sync won't create diagrams."
          : `${chosen.size} client group${chosen.size === 1 ? "" : "s"} will be kept as diagrams.`,
      );
      onOpenChange(false);
    } catch (err: any) {
      toast.error("Could not save your selection", { description: err?.message ?? String(err) });
    } finally {
      setSaving(false);
    }
  };

  const allFilteredChosen = filtered.length > 0 && filtered.every((r) => chosen.has(r.xpm_uuid));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
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
              placeholder="Filter groups..."
              className="h-8 pl-8 text-xs"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="secondary" className="text-[10px]">
              {chosen.size} selected
            </Badge>
            <Badge variant="outline" className="text-[10px]">
              {rows.length} in XPM
            </Badge>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs"
              onClick={() => toggleAllFiltered(!allFilteredChosen)}
              disabled={loading || filtered.length === 0}
            >
              {allFilteredChosen ? "Clear shown" : "Select shown"}
            </Button>
          </div>
        </div>

        {overCapacity && (
          <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-xs">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" />
            <span className="text-muted-foreground">
              You've picked {newlyChosen} new groups but only have room for {remaining}. The extra
              groups will be skipped until you archive a structure or upgrade.
            </span>
          </div>
        )}

        <ScrollArea className="h-[320px] rounded-lg border border-border/60">
          <div className="divide-y divide-border/50">
            {loading ? (
              <div className="space-y-2 p-3">
                {Array.from({ length: 6 }).map((_, i) => (
                  <Skeleton key={i} className="h-8 w-full" />
                ))}
              </div>
            ) : filtered.length === 0 ? (
              <div className="py-12 text-center text-muted-foreground">
                <Network className="mx-auto mb-3 h-8 w-8 opacity-40" />
                <p className="text-sm">
                  {rows.length === 0 ? "No client groups yet — run a sync to load them." : "No groups match your search."}
                </p>
              </div>
            ) : (
              filtered.map((r) => (
                <label
                  key={r.xpm_uuid}
                  className="flex cursor-pointer items-center gap-3 px-3 py-2 hover:bg-accent/40"
                >
                  <Checkbox
                    checked={chosen.has(r.xpm_uuid)}
                    onCheckedChange={() => toggle(r.xpm_uuid)}
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

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving || loading} className="gap-2">
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            Save selection
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
