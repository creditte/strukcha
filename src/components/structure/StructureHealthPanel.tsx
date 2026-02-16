import { useState } from "react";
import { ChevronDown, ChevronRight, HeartPulse, XCircle, AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import type { OwnershipValidation, EntityIssue, OwnershipCycle } from "@/hooks/useStructureData";

interface Props {
  ownershipValidation: OwnershipValidation;
  entityIntegrity: EntityIssue[];
  ownershipCycles: OwnershipCycle[];
}

export default function StructureHealthPanel({ ownershipValidation, entityIntegrity, ownershipCycles }: Props) {
  const [expanded, setExpanded] = useState(false);

  const errorCount =
    ownershipValidation.errors.length +
    entityIntegrity.filter((i) => i.severity === "error").length +
    ownershipCycles.length;
  const warningCount =
    ownershipValidation.warnings.length +
    entityIntegrity.filter((i) => i.severity === "warning").length;

  const totalIssues = errorCount + warningCount;
  if (totalIssues === 0) return null;

  return (
    <div className="mt-1">
      {/* Summary banner */}
      <Button
        variant="outline"
        size="sm"
        className="w-full justify-start gap-2 text-xs font-normal"
        onClick={() => setExpanded((v) => !v)}
      >
        <HeartPulse className="h-3.5 w-3.5" />
        <span>
          Structure Health:
          {errorCount > 0 && (
            <span className="ml-1 font-semibold text-destructive">{errorCount} error{errorCount !== 1 ? "s" : ""}</span>
          )}
          {warningCount > 0 && (
            <span className="ml-1 font-semibold text-muted-foreground">{warningCount} warning{warningCount !== 1 ? "s" : ""}</span>
          )}
        </span>
        {expanded ? <ChevronDown className="ml-auto h-3.5 w-3.5" /> : <ChevronRight className="ml-auto h-3.5 w-3.5" />}
      </Button>

      {expanded && (
        <div className="mt-1 space-y-1 max-h-48 overflow-y-auto">
          {/* Circular ownership errors */}
          {ownershipCycles.map((c, i) => (
            <Alert key={`cycle-${i}`} variant="destructive" className="flex items-center gap-2 py-1.5 px-3">
              <RefreshCw className="h-3.5 w-3.5 shrink-0" />
              <AlertDescription className="text-xs">
                Circular ownership detected: {c.entityNames.join(" → ")} → {c.entityNames[0]}
              </AlertDescription>
            </Alert>
          ))}
          {/* Entity integrity errors */}
          {entityIntegrity
            .filter((i) => i.severity === "error")
            .map((i) => (
              <Alert key={i.entity_id + i.issue_type} variant="destructive" className="flex items-center gap-2 py-1.5 px-3">
                <XCircle className="h-3.5 w-3.5 shrink-0" />
                <AlertDescription className="text-xs">{i.message}</AlertDescription>
              </Alert>
            ))}

          {/* Ownership errors */}
          {ownershipValidation.errors.map((e) => (
            <Alert key={e.entityId} variant="destructive" className="flex items-center gap-2 py-1.5 px-3">
              <XCircle className="h-3.5 w-3.5 shrink-0" />
              <AlertDescription className="text-xs">
                <strong>{e.entityName}</strong>: ownership totals {e.total}% (exceeds 100%)
              </AlertDescription>
            </Alert>
          ))}

          {/* Entity integrity warnings */}
          {entityIntegrity
            .filter((i) => i.severity === "warning")
            .map((i) => (
              <Alert key={i.entity_id + i.issue_type} className="flex items-center gap-2 py-1.5 px-3 border-destructive/30 text-muted-foreground">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                <AlertDescription className="text-xs">{i.message}</AlertDescription>
              </Alert>
            ))}

          {/* Ownership warnings */}
          {ownershipValidation.warnings.map((w) => (
            <Alert key={w.entityId} className="flex items-center gap-2 py-1.5 px-3 border-destructive/30 text-muted-foreground">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
              <AlertDescription className="text-xs">
                <strong>{w.entityName}</strong>: ownership totals {w.total}%
                {w.missing > 0 ? ` (${w.missing} shareholder(s) missing %)` : " (does not sum to 100%)"}
              </AlertDescription>
            </Alert>
          ))}
        </div>
      )}
    </div>
  );
}
