import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Loader2 } from "lucide-react";

type RelLabel = { type?: string; from?: string; to?: string; units?: number | null; percent?: number | null; new_units?: number | null; new_percent?: number | null; id?: string };

export interface XpmGroupPreview {
  status: "ready" | "ambiguous_structure_match" | "manual_structure_name_conflict";
  match: "uuid" | "adopt" | "create" | "ambiguous";
  structure_id: string | null;
  group_name: string;
  error?: string;
  summary: {
    newEntities: string[];
    membersToAdd: string[];
    membersToRemove: string[];
    archivedInXpm: string[];
    linksToAdd: RelLabel[];
    linksToRemove: RelLabel[];
    newRelationships: RelLabel[];
    metadataUpdates: RelLabel[];
    preserved: { manualMembers: string[]; manualLinks: RelLabel[]; metadataOverrides: RelLabel[]; membersKeptForManualLinks: string[] };
  };
}

const fig = (u?: number | null, p?: number | null) =>
  [u != null ? `${u} units` : null, p != null ? `${p}%` : null].filter(Boolean).join(", ") || "none";
const rel = (r: RelLabel) => (r.type ? `${r.from} → ${r.to} (${r.type.replace(/_/g, " ")})` : r.id ?? "");

function Section({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div className="space-y-1">
      <p className="text-xs font-medium text-muted-foreground">{title} ({items.length})</p>
      <ul className="text-sm space-y-0.5">{items.map((t, i) => <li key={i}>{t}</li>)}</ul>
    </div>
  );
}

export function XpmGroupPreviewDialog({
  preview, applying, onCancel, onConfirm,
}: {
  preview: XpmGroupPreview | null;
  applying: boolean;
  onCancel: () => void;
  onConfirm: (allowBesideManual: boolean) => void;
}) {
  if (!preview) return null;
  const s = preview.summary;
  const ambiguous = preview.status === "ambiguous_structure_match";
  const manualConflict = preview.status === "manual_structure_name_conflict";
  const intro = ambiguous
    ? "More than one XPM diagram has this name. Nothing will change until they are reviewed."
    : manualConflict
      ? "A hand-made diagram already has this name. It will not be changed. You can create a separate XPM diagram instead."
      : preview.match === "create"
        ? "A new XPM diagram will be created for this group."
        : "These changes will be made to the existing XPM diagram. Hand-made items are kept.";

  return (
    <AlertDialog open onOpenChange={(o) => !o && !applying && onCancel()}>
      <AlertDialogContent className="max-w-lg">
        <AlertDialogHeader>
          <AlertDialogTitle>Review changes from XPM: {preview.group_name}</AlertDialogTitle>
          <AlertDialogDescription>{intro}</AlertDialogDescription>
        </AlertDialogHeader>
        {!ambiguous && (
          <ScrollArea className="max-h-[50vh] pr-3">
            <div className="space-y-3">
              <Section title="New clients to add" items={s.newEntities} />
              <Section title="Members to add" items={s.membersToAdd} />
              <Section title="Members to remove (from XPM only)" items={s.membersToRemove} />
              <Section title="Archived in XPM" items={s.archivedInXpm} />
              <Section title="New relationships" items={s.newRelationships.map((r) => `${rel(r)} — ${fig(r.units, r.percent)}`)} />
              <Section title="Relationships to link" items={s.linksToAdd.map(rel)} />
              <Section title="Relationships to unlink (from XPM only)" items={s.linksToRemove.map(rel)} />
              <Section title="Ownership figures to update" items={s.metadataUpdates.map((r) => `${rel(r)}: ${fig(r.units, r.percent)} → ${fig(r.new_units, r.new_percent)}`)} />
              <Section title="Hand-made members kept" items={[...s.preserved.manualMembers, ...s.preserved.membersKeptForManualLinks]} />
              <Section title="Hand-made relationships kept" items={s.preserved.manualLinks.map(rel)} />
              <Section title="Edited ownership figures kept" items={s.preserved.metadataOverrides.map(rel)} />
            </div>
          </ScrollArea>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={applying}>Cancel</AlertDialogCancel>
          {!ambiguous && (
            <AlertDialogAction
              disabled={applying}
              onClick={(e) => { e.preventDefault(); onConfirm(manualConflict); }}
            >
              {applying && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />}
              {manualConflict ? "Create separate XPM diagram" : "Apply and open"}
            </AlertDialogAction>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
