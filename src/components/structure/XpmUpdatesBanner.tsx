import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { XpmGroupPreviewDialog, countXpmChanges, isNothingToApply, type XpmGroupPreview } from "./XpmGroupPreviewDialog";
import { XPM_CHECK_PARAM } from "@/lib/xpmOpen";

async function invokeImport(body: Record<string, unknown>) {
  const { data, error } = await supabase.functions.invoke("import-xpm-group", { body });
  if (data?.mode === "preview") return data;
  if (error) {
    const ctx = (error as { context?: Response }).context;
    const detail = ctx && typeof ctx.json === "function" ? await ctx.json().catch(() => null) : null;
    throw new Error(detail?.detail || detail?.error || error.message || "XPM check failed");
  }
  if (data?.error) throw new Error(data.detail || data.error);
  return data;
}

/**
 * Opened from "Open in Editor": the diagram shows straight away while XPM is
 * checked in the background. Changes are only made after the user reviews and
 * confirms them in the same review box.
 */
export default function XpmUpdatesBanner({ structureId, onApplied }: { structureId: string; onApplied: () => void }) {
  const [params, setParams] = useSearchParams();
  const requested = params.get(XPM_CHECK_PARAM) === "check";
  const [group, setGroup] = useState<{ uuid: string; name: string } | null>(null);
  const [state, setState] = useState<"idle" | "checking" | "updates" | "error">("idle");
  const [preview, setPreview] = useState<XpmGroupPreview | null>(null);
  const [errorText, setErrorText] = useState("");
  const [open, setOpen] = useState(false);
  const [applying, setApplying] = useState(false);

  const check = useCallback(async (g: { uuid: string; name: string }) => {
    setState("checking");
    try {
      const data = (await invokeImport({ group_uuid: g.uuid, group_name: g.name, mode: "preview" })) as XpmGroupPreview;
      if (data.structure_id !== structureId || data.status !== "ready" || isNothingToApply(data)) {
        setState("idle");
        return;
      }
      setPreview(data);
      setState("updates");
    } catch (err) {
      setErrorText(err instanceof Error ? err.message : String(err));
      setState("error");
    }
  }, [structureId]);

  useEffect(() => {
    if (!requested) return;
    // Drop the flag so a refresh doesn't re-check.
    const next = new URLSearchParams(params);
    next.delete(XPM_CHECK_PARAM);
    setParams(next, { replace: true });
    (async () => {
      const { data } = await supabase.from("structures").select("name, xpm_group_uuid").eq("id", structureId).maybeSingle();
      if (!data?.xpm_group_uuid) return;
      const g = { uuid: data.xpm_group_uuid, name: data.name };
      setGroup(g);
      check(g);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requested, structureId]);

  const apply = async () => {
    if (!preview || !group) return;
    setApplying(true);
    try {
      await invokeImport({
        group_uuid: group.uuid, group_name: group.name, mode: "apply", expected_structure_id: preview.structure_id,
      });
      toast.success("Diagram updated from XPM");
      setOpen(false);
      setPreview(null);
      setState("idle");
      onApplied();
    } catch (err) {
      toast.error("Could not apply changes", { description: err instanceof Error ? err.message : String(err) });
    } finally {
      setApplying(false);
    }
  };

  if (state === "idle") return null;

  return (
    <>
      <div className="mx-4 mt-2 flex items-center gap-3 rounded-md border border-border bg-muted/40 px-3 py-2 text-sm">
        {state === "checking" && (
          <>
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            <span className="text-muted-foreground">Checking XPM for updates…</span>
          </>
        )}
        {state === "updates" && preview && (
          <>
            <span className="flex-1">
              XPM has {countXpmChanges(preview)} update{countXpmChanges(preview) === 1 ? "" : "s"} for this diagram. Nothing changes until you confirm.
            </span>
            <Button size="sm" className="h-7" onClick={() => setOpen(true)}>Review updates</Button>
            <Button size="sm" variant="ghost" className="h-7" onClick={() => setState("idle")}>Dismiss</Button>
          </>
        )}
        {state === "error" && (
          <>
            <span className="flex-1 text-muted-foreground">Couldn't check XPM for updates: {errorText}</span>
            {group && (
              <Button size="sm" variant="outline" className="h-7 gap-1.5" onClick={() => check(group)}>
                <RefreshCw className="h-3.5 w-3.5" /> Try again
              </Button>
            )}
            <Button size="sm" variant="ghost" className="h-7" onClick={() => setState("idle")}>Dismiss</Button>
          </>
        )}
      </div>
      {open && (
        <XpmGroupPreviewDialog
          preview={preview}
          applying={applying}
          onCancel={() => setOpen(false)}
          onConfirm={apply}
          onLinkExisting={() => setOpen(false)}
          onOpenExisting={() => setOpen(false)}
        />
      )}
    </>
  );
}
