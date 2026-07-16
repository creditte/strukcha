import { AlertTriangle, Loader2, Unplug } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { useXeroConnection } from "@/contexts/XeroConnectionContext";
import { xeroToastPayload } from "@/lib/xeroErrors";

/**
 * Prominent banner shown at the top of the authenticated app when the
 * stored Xero connection is no longer valid (revoked, expired, or missing
 * required permissions). All Xero-dependent actions should be disabled by
 * their own screens while this banner is visible; the only path forward
 * for the user is to re-authorise Xero.
 */
export default function XeroReconnectBanner() {
  const { connection, invalid, reconnecting, startReconnect } = useXeroConnection();

  if (!connection || !invalid) return null;

  const handleReconnect = async () => {
    try {
      await startReconnect();
    } catch (err) {
      const payload = xeroToastPayload(err);
      toast.error(payload.title, { description: payload.description });
    }
  };

  return (
    <div className="px-3 pt-3 sm:px-6">
      <div
        role="alert"
        className="mx-auto flex w-full max-w-4xl items-start gap-3 rounded-lg border border-amber-300/70 bg-amber-50 p-3 shadow-sm sm:items-center sm:gap-4 sm:p-4"
      >
        <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-700 sm:mt-0">
          <AlertTriangle className="h-4 w-4" />
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-amber-900">
            Your Xero connection has been lost
          </p>
          <p className="mt-0.5 text-sm leading-snug text-amber-800">
            {connection.xero_org_name ? (
              <>
                We can no longer reach{" "}
                <span className="font-medium">{connection.xero_org_name}</span>. Syncing is paused until you reconnect.
              </>
            ) : (
              "We can no longer reach your Xero organisation. Syncing is paused until you reconnect."
            )}
          </p>
        </div>
        <Button
          onClick={handleReconnect}
          disabled={reconnecting}
          size="sm"
          className="shrink-0 gap-2 bg-[#13B5EA] text-white hover:bg-[#0f9dcc]"
        >
          {reconnecting ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Unplug className="h-4 w-4" />
          )}
          <span className="hidden sm:inline">{reconnecting ? "Redirecting…" : "Reconnect to Xero"}</span>
          <span className="sm:hidden">{reconnecting ? "…" : "Reconnect"}</span>
        </Button>
      </div>
    </div>
  );
}
