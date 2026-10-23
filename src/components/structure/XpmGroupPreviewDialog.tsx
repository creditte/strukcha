import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";

type RelLabel = { type?: string; from?: string; to?: string; units?: number | null; percent?: number | null; new_units?: number | null; new_percent?: number | null; id?: string };

export interface XpmGroupPreview {
  status: "ready" | "ambiguous_structure_match" | "manual_structure_name_conflict";
  match: "uuid" | "adopt" | "create" | "ambiguous";
  structure_id: string | null;
  group_name: string;
  error?: string;
  /** Existing same-name diagrams that are not yet linked to this XPM group. */
  same_name_manual?: string[];
  summary: {
    newEntities: string[];
    membersToAdd: string[];
    membersToRemove: string[];
    archivedInXpm: string[];
    linksToAdd: RelLabel[];
    linksToRemove: RelLabel[];
    newRelationships: RelLabel[];
    metadataUpdates: RelLabel[];
    /** Clients XPM describes as a person but stored as a Sole Trader. */
    typeCorrections?: Array<{ name: string; from: string; to: string }>;
    preserved: { manualMembers: string[]; manualLinks: RelLabel[]; metadataOverrides: RelLabel[]; membersKeptForManualLinks: string[] };
  };
}

/** True when the diagram already matches XPM: open it directly instead of asking. */
export function isNothingToApply(p: XpmGroupPreview | null | undefined): boolean {
  if (!p || p.status !== "ready" || p.match !== "uuid" || !p.structure_id) return false;
  const s = p.summary;
  return s.newEntities.length + s.membersToAdd.length + s.membersToRemove.length +
    s.linksToAdd.length + s.linksToRemove.length + s.newRelationships.length + s.metadataUpdates.length +
    (s.typeCorrections?.length ?? 0) === 0;
}

/** Number of changes the preview would make (for the editor's update banner). */
export function countXpmChanges(p: XpmGroupPreview): number {
  const s = p.summary;
  return s.newEntities.length + s.membersToAdd.length + s.membersToRemove.length +
    s.linksToAdd.length + s.linksToRemove.length + s.newRelationships.length + s.metadataUpdates.length +
    (s.typeCorrections?.length ?? 0);
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
  preview, applying, onCancel, onConfirm, onLinkExisting, onOpenExisting,
}: {
  preview: XpmGroupPreview | null;
  applying: boolean;
  onCancel: () => void;
  onConfirm: (allowBesideManual: boolean) => void;
  /** Link the one existing same-name diagram to this XPM group, then review again. */
  onLinkExisting: (structureId: string) => void;
  /** Open the existing diagram as it is, without any XPM changes. */
  onOpenExisting: (structureId: string) => void;
}) {
  if (!preview) return null;
  const s = preview.summary;
  const ambiguous = preview.status === "ambiguous_structure_match";
  const manualConflict = preview.status === "manual_structure_name_conflict";
  const existingId = manualConflict && preview.same_name_manual?.length === 1 ? preview.same_name_manual[0] : null;
  const intro = ambiguous
    ? "More than one XPM diagram has this name. Nothing will change until they are reviewed."
    : manualConflict
      ? existingId
        ? "A diagram with this name already exists but isn't linked to this XPM group yet. Link it to keep using the same diagram — nothing in it changes until you review and confirm the XPM updates next."
        : "More than one diagram has this name. Nothing will change until they are reviewed."
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
        {!ambiguous && !manualConflict && (
          <ScrollArea className="max-h-[50vh] pr-3">
            <div className="space-y-3">
              <Section title="Client type corrections" items={(s.typeCorrections ?? []).map((t) => `${t.name}: ${t.from} → ${t.to}`)} />
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
          {existingId && (
            <Button variant="outline" disabled={applying} onClick={() => onOpenExisting(existingId)}>
              Open without linking
            </Button>
          )}
          {existingId && (
            <AlertDialogAction
              disabled={applying}
              onClick={(e) => { e.preventDefault(); onLinkExisting(existingId); }}
            >
              {applying && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />}
              Link to XPM and review
            </AlertDialogAction>
          )}
          {!ambiguous && !manualConflict && (
            <AlertDialogAction
              disabled={applying}
              onClick={(e) => { e.preventDefault(); onConfirm(false); }}
            >
              {applying && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />}
              Apply and open
            </AlertDialogAction>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
