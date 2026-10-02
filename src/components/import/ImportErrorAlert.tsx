import { useState } from "react";
import { AlertCircle, RefreshCw, Loader2, ChevronDown, ChevronUp } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { translateImportError } from "@/lib/importErrors";

interface Props {
  error: unknown;
  onRetry?: () => void;
  retrying?: boolean;
  /** Label for the retry action — "Resume import" when a job can continue. */
  retryLabel?: string;
}

/** Production error card: plain message, next step, reference code, hidden detail. */
export default function ImportErrorAlert({ error, onRetry, retrying, retryLabel }: Props) {
  const [showDetail, setShowDetail] = useState(false);
  const f = translateImportError(error);

  return (
    <Alert variant="destructive">
      <AlertCircle className="h-4 w-4" />
      <AlertTitle className="flex flex-wrap items-center gap-2">
        <span>{f.title}</span>
        <span className="rounded bg-destructive/15 px-1.5 py-0.5 text-[10px] font-medium tracking-wide">
          {f.reference}
        </span>
      </AlertTitle>
      <AlertDescription className="space-y-2.5">
        <p className="text-sm">{f.message}</p>
        <p className="text-sm text-muted-foreground">{f.resolution}</p>

        <div className="flex flex-wrap items-center gap-2 pt-0.5">
          {f.retryable && onRetry && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={onRetry}
              disabled={retrying}
              className="h-7 gap-1.5 text-xs"
            >
              {retrying ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5" />
              )}
              {retrying ? "Working…" : retryLabel ?? "Try again"}
            </Button>
          )}
          {f.detail && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => setShowDetail((v) => !v)}
              className="h-7 gap-1 px-2 text-xs text-muted-foreground"
            >
              {showDetail ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
              {showDetail ? "Hide details" : "Details"}
            </Button>
          )}
        </div>

        {showDetail && f.detail && (
          <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded-md bg-destructive/10 p-2 text-[11px] leading-relaxed">
            {f.detail}
          </pre>
        )}
      </AlertDescription>
    </Alert>
  );
}
