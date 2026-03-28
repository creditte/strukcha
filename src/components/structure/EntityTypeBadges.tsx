import { Badge } from "@/components/ui/badge";
import { getEntityIcon } from "@/lib/entityTypes";

/** Canonical grouping: all trust subtypes → "Trusts" */
function groupTypes(breakdown: Record<string, number>): Record<string, number> {
  const grouped: Record<string, number> = {};
  for (const [type, count] of Object.entries(breakdown)) {
    let key: string;
    if (type.startsWith("trust_") || type === "Trust") {
      key = "Trusts";
    } else if (type === "Individual") {
      key = "Individuals";
    } else if (type === "Company") {
      key = "Companies";
    } else if (type === "Partnership") {
      key = "Partnerships";
    } else if (type === "smsf") {
      key = "SMSFs";
    } else if (type === "Sole Trader") {
      key = "Sole Traders";
    } else if (type === "Unclassified") {
      key = "Unclassified";
    } else {
      key = type;
    }
    grouped[key] = (grouped[key] || 0) + count;
  }
  return grouped;
}

/** Maps grouped label back to a representative entity_type for icon lookup */
const ICON_KEY_MAP: Record<string, string> = {
  Individuals: "Individual",
  Companies: "Company",
  Trusts: "trust_discretionary",
  Partnerships: "Partnership",
  SMSFs: "smsf",
  "Sole Traders": "Sole Trader",
  Unclassified: "Unclassified",
};

const COLOR_MAP: Record<string, string> = {
  Individuals: "border-blue-300/40 text-blue-700 bg-blue-50 dark:border-blue-700/40 dark:text-blue-300 dark:bg-blue-950/50",
  Companies: "border-emerald-300/40 text-emerald-700 bg-emerald-50 dark:border-emerald-700/40 dark:text-emerald-300 dark:bg-emerald-950/50",
  Trusts: "border-amber-300/40 text-amber-700 bg-amber-50 dark:border-amber-700/40 dark:text-amber-300 dark:bg-amber-950/50",
  Partnerships: "border-purple-300/40 text-purple-700 bg-purple-50 dark:border-purple-700/40 dark:text-purple-300 dark:bg-purple-950/50",
  SMSFs: "border-orange-300/40 text-orange-700 bg-orange-50 dark:border-orange-700/40 dark:text-orange-300 dark:bg-orange-950/50",
  "Sole Traders": "border-rose-300/40 text-rose-700 bg-rose-50 dark:border-rose-700/40 dark:text-rose-300 dark:bg-rose-950/50",
  Unclassified: "border-border text-muted-foreground bg-muted/50",
};

// Display order
const ORDER = ["Individuals", "Companies", "Trusts", "SMSFs", "Partnerships", "Sole Traders", "Unclassified"];

interface Props {
  breakdown: Record<string, number>;
}

export default function EntityTypeBadges({ breakdown }: Props) {
  const grouped = groupTypes(breakdown);
  const sorted = ORDER.filter((k) => grouped[k]);

  if (sorted.length === 0) return null;

  return (
    <>
      {sorted.map((label) => {
        const iconKey = ICON_KEY_MAP[label] || "Unclassified";
        const Icon = getEntityIcon(iconKey);
        const colorClass = COLOR_MAP[label] || COLOR_MAP.Unclassified;

        return (
          <Badge
            key={label}
            variant="outline"
            className={`text-[10px] px-1.5 py-0 font-medium gap-1 ${colorClass}`}
          >
            <Icon className="h-2.5 w-2.5" />
            {grouped[label]} {label}
          </Badge>
        );
      })}
    </>
  );
}
