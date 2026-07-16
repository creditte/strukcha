import { AlertCircle, RefreshCw, Unplug, Loader2 } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { translateXeroError } from "@/lib/xeroErrors";

interface XeroErrorAlertProps {
  /** Any error value; will be translated to a friendly message. */
  error: unknown;
  /** Called when the user clicks the retry button. Omit to hide retry. */
  onRetry?: () => void;
  /** Called when the user clicks the reconnect button. Omit to hide reconnect. */
  onReconnect?: () => void;
  retrying?: boolean;
  reconnecting?: boolean;
  className?: string;
}

/**
 * Inline alert card that presents a user-friendly Xero error with clear
 * next-step actions. Never surfaces raw HTTP status codes, JSON payloads,
 * or stack traces.
 */
export default function XeroErrorAlert({
  error,
  onRetry,
  onReconnect,
  retrying,
  reconnecting,
  className,
}: XeroErrorAlertProps) {
  const friendly = translateXeroError(error);
  const showRetry = friendly.retryable && !!onRetry;
  const showReconnect = friendly.requiresReconnect && !!onReconnect;

  return (
    <Alert variant="destructive" className={className}>
      <AlertCircle className="h-4 w-4" />
      <AlertTitle>{friendly.title}</AlertTitle>
      <AlertDescription className="space-y-3">
        <p className="text-sm">{friendly.message}</p>
        <p className="text-sm text-muted-foreground">{friendly.resolution}</p>
        {(showRetry || showReconnect) && (
          <div className="flex flex-wrap gap-2 pt-1">
            {showRetry && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={onRetry}
                disabled={retrying}
                className="gap-1.5"
              >
                {retrying ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="h-3.5 w-3.5" />
                )}
                {retrying ? "Retrying…" : "Try again"}
              </Button>
            )}
            {showReconnect && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={onReconnect}
                disabled={reconnecting}
                className="gap-1.5"
              >
                {reconnecting ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Unplug className="h-3.5 w-3.5" />
                )}
                {reconnecting ? "Opening Xero…" : "Reconnect Xero"}
              </Button>
            )}
          </div>
        )}
      </AlertDescription>
    </Alert>
  );
}
