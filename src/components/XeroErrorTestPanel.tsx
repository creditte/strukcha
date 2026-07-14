import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { FlaskConical, ChevronDown, ChevronUp } from "lucide-react";
import XeroErrorAlert from "@/components/XeroErrorAlert";
import { translateXeroError, type XeroErrorKind } from "@/lib/xeroErrors";

/**
 * Dev-only panel that lets you preview every user-facing Xero error message
 * without having to actually trigger the underlying failures. Useful for
 * QA / Xero App Store certification reviewers.
 */

interface Sample {
  kind: XeroErrorKind;
  label: string;
  description: string;
  /** Simulated raw error the translator would receive in production. */
  makeError: () => unknown;
}

const SAMPLES: Sample[] = [
  {
    kind: "not_connected",
    label: "Not connected",
    description: "Firm has no active Xero connection.",
    makeError: () => new Error("No Xero connection for this tenant"),
  },
  {
    kind: "auth_expired",
    label: "Sign-in expired (401)",
    description: "Token expired or was revoked in Xero.",
    makeError: () => ({ message: "unauthorized", status: 401 }),
  },
  {
    kind: "permission",
    label: "Missing permissions (403)",
    description: "User lacks Practice Manager scope.",
    makeError: () => ({ message: "forbidden: insufficient scope", status: 403 }),
  },
  {
    kind: "rate_limit",
    label: "Rate limited (429)",
    description: "Too many requests to Xero in a short window.",
    makeError: () => ({ message: "rate limit exceeded", status: 429 }),
  },
  {
    kind: "not_found",
    label: "Not found (404)",
    description: "Tenant, organisation or record missing.",
    makeError: () => ({ message: "organisation not found", status: 404 }),
  },
  {
    kind: "validation",
    label: "Validation error (400)",
    description: "Xero rejected a value in the request.",
    makeError: () => ({ message: "validation error: invalid ABN", status: 400 }),
  },
  {
    kind: "unavailable",
    label: "Xero unavailable (5xx)",
    description: "Xero didn't respond or returned a server error.",
    makeError: () => ({ message: "bad gateway", status: 502 }),
  },
  {
    kind: "unavailable",
    label: "Bare non-2xx (Edge Function)",
    description: "Supabase FunctionsHttpError with no parseable body.",
    makeError: () => new Error("Edge Function returned a non-2xx status code"),
  },
  {
    kind: "network",
    label: "Network failure",
    description: "Browser couldn't reach Xero at all.",
    makeError: () => new TypeError("Failed to fetch"),
  },
  {
    kind: "unknown",
    label: "Unknown / fallback",
    description: "Anything the translator can't classify.",
    makeError: () => new Error("something completely unexpected"),
  },
];

export default function XeroErrorTestPanel() {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<Sample | null>(null);

  return (
    <Card className="border-dashed">
      <CardHeader className="flex flex-row items-start gap-4 space-y-0">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-amber-100">
          <FlaskConical className="h-5 w-5 text-amber-700" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <CardTitle className="text-base">Xero error preview (test only)</CardTitle>
            <Badge variant="outline" className="border-amber-400 bg-amber-50 text-amber-800">
              For QA
            </Badge>
          </div>
          <CardDescription className="mt-1">
            Preview every user-facing Xero error message without triggering the real failure.
            Nothing here contacts Xero.
          </CardDescription>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setOpen((v) => !v)}
          className="gap-1.5"
        >
          {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          {open ? "Hide" : "Show"}
        </Button>
      </CardHeader>

      {open && (
        <CardContent className="space-y-4">
          <div className="grid gap-2 sm:grid-cols-2">
            {SAMPLES.map((s, i) => {
              const isActive = selected === s;
              const preview = translateXeroError(s.makeError());
              return (
                <button
                  key={i}
                  type="button"
                  onClick={() => setSelected(s)}
                  className={`text-left rounded-lg border p-3 transition hover:bg-muted/50 ${
                    isActive ? "border-primary bg-primary/5" : ""
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium">{s.label}</span>
                    <Badge variant="secondary" className="text-[10px] uppercase">
                      {preview.kind}
                    </Badge>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">{s.description}</p>
                </button>
              );
            })}
          </div>

          {selected && (
            <div className="space-y-2 pt-2">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">
                What the user would see
              </p>
              <XeroErrorAlert
                error={selected.makeError()}
                onRetry={() => {
                  /* no-op preview */
                }}
                onReconnect={() => {
                  /* no-op preview */
                }}
              />
            </div>
          )}
        </CardContent>
      )}
    </Card>
  );
}
