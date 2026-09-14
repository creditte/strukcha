import { useMemo, useState } from "react";
import { AlertTriangle, ChevronDown, ChevronUp, Download } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Props {
  warnings: string[];
}

type Kind = "relationship_type" | "unresolved" | "group" | "other";

const KIND_LABEL: Record<Kind, string> = {
  relationship_type: "Relationship types we didn't recognise",
  unresolved: "Relationships we couldn't link",
  group: "Client groups that were skipped",
  other: "Other notes",
};

function classify(w: string): Kind {
  const l = w.toLowerCase();
  if (l.includes("unknown relationship type")) return "relationship_type";
  if (l.includes("could not resolve")) return "unresolved";
  if (l.includes("group")) return "group";
  return "other";
}

/** Grouped, bounded warning list with a CSV download instead of a wall of red text. */
export default function ImportWarnings({ warnings }: Props) {
  const [open, setOpen] = useState<Record<string, boolean>>({});

  const groups = useMemo(() => {
    const map = new Map<Kind, string[]>();
    for (const w of warnings) {
      const k = classify(w);
      const list = map.get(k) ?? [];
      list.push(w);
      map.set(k, list);
    }
    return [...map.entries()];
  }, [warnings]);

  const download = () => {
    const csv = ["Category,Message", ...warnings.map((w) => `"${KIND_LABEL[classify(w)]}","${w.replace(/"/g, '""')}"`)].join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "import-warnings.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  if (warnings.length === 0) return null;

  return (
    <div className="space-y-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-2 text-sm font-medium text-foreground">
          <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600" />
          {warnings.length.toLocaleString()} row{warnings.length === 1 ? "" : "s"} needed attention
        </p>
        <Button size="sm" variant="outline" onClick={download} className="h-7 gap-1.5 text-xs">
          <Download className="h-3.5 w-3.5" />
          Download list
        </Button>
      </div>

      <div className="space-y-1.5">
        {groups.map(([kind, list]) => {
          const isOpen = open[kind];
          const preview = isOpen ? list.slice(0, 50) : list.slice(0, 3);
          return (
            <div key={kind} className="rounded-md bg-background/60 p-2">
              <button
                type="button"
                onClick={() => setOpen((p) => ({ ...p, [kind]: !p[kind] }))}
                className="flex w-full items-center justify-between gap-2 text-left"
              >
                <span className="text-xs font-medium text-foreground">
                  {KIND_LABEL[kind]} · {list.length.toLocaleString()}
                </span>
                {isOpen ? (
                  <ChevronUp className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                ) : (
                  <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                )}
              </button>
              <ul className="mt-1 space-y-0.5">
                {preview.map((w, i) => (
                  <li key={i} className="break-words text-[11px] text-muted-foreground">
                    {w}
                  </li>
                ))}
              </ul>
              {!isOpen && list.length > 3 && (
                <p className="mt-1 text-[11px] text-muted-foreground">+{list.length - 3} more</p>
              )}
              {isOpen && list.length > 50 && (
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Showing the first 50 — download the list for all {list.length.toLocaleString()}.
                </p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
