import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import type { EntityNode } from "@/hooks/useStructureData";

const RELATIONSHIP_TYPES = [
  "director", "shareholder", "beneficiary", "trustee",
  "appointer", "settlor", "partner", "member", "spouse", "parent", "child",
] as const;

const OWNERSHIP_REL_TYPES = new Set(["shareholder", "beneficiary", "partner", "member"]);

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

  const otherEntities = allEntities.filter((e) => e.id !== currentEntityId);

  const handleSubmit = async () => {
    if (!target || !type) return;
    const pct = ownershipPercent ? parseFloat(ownershipPercent) : null;
    if (pct != null && (pct < 0 || pct > 100)) {
      toast({ title: "Invalid percentage", description: "Must be between 0 and 100", variant: "destructive" });
      return;
    }
    setAdding(true);

    const data: Record<string, unknown> = {
      to_entity_id: target,
      relationship_type: type,
    };

    if (OWNERSHIP_REL_TYPES.has(type)) {
      if (ownershipPercent) data.ownership_percent = parseFloat(ownershipPercent);
      if (ownershipUnits) data.ownership_units = parseFloat(ownershipUnits);
      if (ownershipClass) data.ownership_class = ownershipClass;
    }

    await onAdd(data);
    setAdding(false);
  };

  return (
    <div className="rounded-md border p-3 space-y-2 mb-3">
      <div>
        <Label className="text-xs">Target Entity</Label>
        <Select value={target} onValueChange={setTarget}>
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
        <Select value={type} onValueChange={setType}>
          <SelectTrigger className="h-8 mt-1 text-xs"><SelectValue placeholder="Select type" /></SelectTrigger>
          <SelectContent>
            {RELATIONSHIP_TYPES.map((t) => (
              <SelectItem key={t} value={t} className="text-xs">{t.charAt(0).toUpperCase() + t.slice(1)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {OWNERSHIP_REL_TYPES.has(type) && (
        <>
          <div>
            <Label className="text-xs">Ownership %</Label>
            <Input type="number" value={ownershipPercent} onChange={(e) => setOwnershipPercent(e.target.value)} className="h-8 mt-1 text-xs" placeholder="e.g. 50" />
          </div>
          <div>
            <Label className="text-xs">Units</Label>
            <Input type="number" value={ownershipUnits} onChange={(e) => setOwnershipUnits(e.target.value)} className="h-8 mt-1 text-xs" placeholder="e.g. 100" />
          </div>
          <div>
            <Label className="text-xs">Class</Label>
            <Input value={ownershipClass} onChange={(e) => setOwnershipClass(e.target.value)} className="h-8 mt-1 text-xs" placeholder="e.g. Ordinary" />
          </div>
        </>
      )}
      <div className="flex gap-2 pt-1">
        <Button size="sm" className="flex-1 h-7 text-xs" onClick={handleSubmit} disabled={adding || !target || !type}>
          {adding ? "Adding..." : "Add"}
        </Button>
        <Button size="sm" variant="outline" className="flex-1 h-7 text-xs" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
