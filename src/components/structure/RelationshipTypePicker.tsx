import { useState } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { X, Info } from "lucide-react";
import {
  CREATABLE_RELATIONSHIP_TYPES,
  describePolicyReason,
  getRelationshipOptions,
  policyLabel,
  type RelationshipOption,
} from "@/lib/relationshipPolicy";

interface Props {
  open: boolean;
  fromEntityName: string;
  toEntityName: string;
  fromEntityType?: string;
  toEntityType?: string;
  /** needsReversal is informational; the caller re-plans via the policy before saving. */
  onConfirm: (relationshipType: string, needsReversal: boolean) => void;
  onCancel: () => void;
}

export default function RelationshipTypePicker({ open, fromEntityName, toEntityName, fromEntityType, toEntityType, onConfirm, onCancel }: Props) {
  const [selected, setSelected] = useState("");

  if (!open) return null;

  const options: RelationshipOption[] = getRelationshipOptions(fromEntityType ?? "Unclassified", toEntityType ?? "Unclassified");
  const selectable = options.filter((o) => o.selectable);
  const review = options.filter((o) => !o.selectable);
  const selectedOption = selectable.find((o) => o.type === selected);

  return (
    <div className="absolute top-4 left-1/2 -translate-x-1/2 z-20 rounded-lg border bg-card shadow-lg p-4 w-80 animate-in fade-in-0 zoom-in-95">
      <div className="flex items-center justify-between mb-3">
        <p className="text-sm font-medium">Add Relationship</p>
        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={onCancel}>
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>
      <p className="text-xs text-muted-foreground mb-3 truncate">
        {fromEntityName} → {toEntityName}
      </p>
      {selectable.length === 0 ? (
        <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3">
          <Info className="h-4 w-4 text-destructive mt-0.5 shrink-0" />
          <p className="text-xs text-destructive">
            {review.length > 0 ? describePolicyReason(review[0].evaluation) : "No valid relationship types for this entity combination."}
          </p>
        </div>
      ) : (
        <>
          <Select value={selected} onValueChange={setSelected}>
            <SelectTrigger className="h-8 text-xs">
              <SelectValue placeholder="Select relationship type..." />
            </SelectTrigger>
            <SelectContent>
              {selectable.map((o) => (
                <SelectItem key={o.type} value={o.type}>{policyLabel(o.type)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {selectedOption?.evaluation.outcome === "resolve_sole_trader" && (
            <p className="text-[10px] text-muted-foreground mt-1.5">{describePolicyReason(selectedOption.evaluation)}</p>
          )}
          {selectable.length < CREATABLE_RELATIONSHIP_TYPES.length && (
            <p className="text-[10px] text-muted-foreground mt-1.5">
              Only relationship types valid for this entity pair are shown.
            </p>
          )}
        </>
      )}
      <div className="flex justify-end gap-2 mt-3">
        <Button variant="outline" size="sm" className="h-7 text-xs" onClick={onCancel}>Cancel</Button>
        <Button size="sm" className="h-7 text-xs" disabled={!selectedOption} onClick={() => onConfirm(selected, !!selectedOption?.evaluation.swapped)}>
          Add
        </Button>
      </div>
    </div>
  );
}
