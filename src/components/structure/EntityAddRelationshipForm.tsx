import { useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Info } from "lucide-react";
import {
  CREATABLE_RELATIONSHIP_TYPES,
  describePolicyReason,
  getRelationshipOptions,
  policyLabel,
  policyMetadataFields,
} from "@/lib/relationshipPolicy";
import { planNewRelationship } from "@/lib/manualRelationship";
import { manualRelationshipDeps } from "@/lib/manualRelationshipDeps";
import type { EntityNode } from "@/hooks/useStructureData";

interface Props {
  allEntities: EntityNode[];
  currentEntityId: string;
  onAdd: (data: Record<string, unknown>) => Promise<void>;
  onCancel: () => void;
}

export default function EntityAddRelationshipForm({ allEntities, currentEntityId, onAdd, onCancel }: Props) {
  const { toast } = useToast();
  const [target, setTarget] = useState("");
  const [type, setType] = useState("");
  const [ownershipPercent, setOwnershipPercent] = useState("");
  const [ownershipUnits, setOwnershipUnits] = useState("");
  const [ownershipClass, setOwnershipClass] = useState("");
  const [adding, setAdding] = useState(false);

  const currentEntity = allEntities.find((e) => e.id === currentEntityId);
  const otherEntities = allEntities.filter((e) => e.id !== currentEntityId);
  const targetEntity = allEntities.find((e) => e.id === target);

  const options = useMemo(() => {
    if (!currentEntity || !targetEntity) return [];
    return getRelationshipOptions(currentEntity.entity_type, targetEntity.entity_type);
  }, [currentEntity, targetEntity]);
  const selectable = options.filter((o) => o.selectable);
  const review = options.filter((o) => !o.selectable);

  const selectedOption = selectable.find((o) => o.type === type);
  const effectiveType = selectedOption ? type : "";

  // Metadata is decided on the canonical target (after any reversal).
  const meta = useMemo(() => {
    if (!selectedOption) return [] as const;
    return policyMetadataFields(effectiveType, selectedOption.evaluation.toType);
  }, [effectiveType, selectedOption]);
  const showPercent = meta.includes("ownership_percent");
  const showUnits = meta.includes("ownership_units");
  const showClass = meta.includes("ownership_class");

  const handleSubmit = async () => {
    if (!effectiveType || !currentEntity || !targetEntity) return;

    const pct = ownershipPercent ? parseFloat(ownershipPercent) : null;
    if (pct != null && (pct < 0 || pct > 100)) {
      toast({ title: "Invalid percentage", description: "Must be between 0 and 100", variant: "destructive" });
      return;
    }
    setAdding(true);
    const plan = await planNewRelationship(effectiveType, currentEntity, targetEntity, manualRelationshipDeps);
    if (!plan.ok) {
      toast({ title: plan.title, description: plan.description, variant: "destructive" });
      setAdding(false);
      return;
    }

    const data: Record<string, unknown> = {
      from_entity_id: plan.edge.fromId,
      to_entity_id: plan.edge.toId,
      relationship_type: plan.edge.type,
    };
    if (showPercent && ownershipPercent) data.ownership_percent = parseFloat(ownershipPercent);
    if (showUnits && ownershipUnits) data.ownership_units = parseFloat(ownershipUnits);
    if (showClass && ownershipClass) data.ownership_class = ownershipClass;

    await onAdd(data);
    setAdding(false);
  };

  return (
    <div className="rounded-md border p-3 space-y-2 mb-3">
      <div>
        <Label className="text-xs">Target Entity</Label>
        <Select value={target} onValueChange={(v) => { setTarget(v); setType(""); }}>
          <SelectTrigger className="h-8 mt-1 text-xs"><SelectValue placeholder="Select entity" /></SelectTrigger>
          <SelectContent>
            {otherEntities.map((e) => (
              <SelectItem key={e.id} value={e.id} className="text-xs">{e.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div>
        <Label className="text-xs">Type</Label>
        <Select value={effectiveType} onValueChange={setType} disabled={!target || selectable.length === 0}>
          <SelectTrigger className="h-8 mt-1 text-xs"><SelectValue placeholder="Select type" /></SelectTrigger>
          <SelectContent>
            {selectable.map((o) => (
              <SelectItem key={o.type} value={o.type} className="text-xs">{policyLabel(o.type)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {target && selectable.length === 0 && (
          <p className="text-[10px] text-destructive mt-1.5">
            {review.length > 0 ? describePolicyReason(review[0].evaluation) : "No valid relationship types for this entity pair."}
          </p>
        )}
        {selectedOption?.evaluation.outcome === "resolve_sole_trader" && (
          <p className="text-[10px] text-muted-foreground mt-1.5">{describePolicyReason(selectedOption.evaluation)}</p>
        )}
        {target && selectable.length > 0 && selectable.length < CREATABLE_RELATIONSHIP_TYPES.length && (
          <div className="flex items-start gap-1.5 mt-1.5">
            <Info className="h-3 w-3 text-muted-foreground mt-0.5 shrink-0" />
            <p className="text-[10px] text-muted-foreground">
              Only valid relationship types for this entity pair are shown.
            </p>
          </div>
        )}
      </div>
      {showPercent && (
        <div>
          <Label className="text-xs">Ownership %</Label>
          <Input type="number" value={ownershipPercent} onChange={(e) => setOwnershipPercent(e.target.value)} className="h-8 mt-1 text-xs" placeholder="e.g. 50" />
        </div>
      )}
      {showUnits && (
        <div>
          <Label className="text-xs">Units</Label>
          <Input type="number" value={ownershipUnits} onChange={(e) => setOwnershipUnits(e.target.value)} className="h-8 mt-1 text-xs" placeholder="e.g. 100" />
        </div>
      )}
      {showClass && (
        <div>
          <Label className="text-xs">Class</Label>
          <Input value={ownershipClass} onChange={(e) => setOwnershipClass(e.target.value)} className="h-8 mt-1 text-xs" placeholder="e.g. Ordinary" />
        </div>
      )}
      <div className="flex gap-2 pt-1">
        <Button size="sm" className="flex-1 h-7 text-xs" onClick={handleSubmit} disabled={adding || !target || !effectiveType}>
          {adding ? "Adding..." : "Add"}
        </Button>
        <Button size="sm" variant="outline" className="flex-1 h-7 text-xs" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
