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
    <div
      role="alert"
      className="border-b border-amber-300/60 bg-amber-50 px-4 py-3 sm:px-6"
    >
      <div className="mx-auto flex max-w-6xl flex-wrap items-start gap-3">
        <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-700">
          <AlertTriangle className="h-4 w-4" />
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-amber-900">
            Your Xero connection has been lost
          </p>
          <p className="mt-0.5 text-sm text-amber-800">
            {connection.xero_org_name ? (
              <>
                We can no longer reach{" "}
                <span className="font-medium">{connection.xero_org_name}</span> on your behalf.
              </>
            ) : (
              "We can no longer reach your Xero organisation on your behalf."
            )}{" "}
            This usually happens when access has been revoked in Xero or your sign-in
            has expired. Syncing and Xero-powered imports are paused until you
            reconnect.
          </p>
        </div>
        <Button
          onClick={handleReconnect}
          disabled={reconnecting}
          size="sm"
          className="gap-2 bg-[#13B5EA] text-white hover:bg-[#0f9dcc]"
        >
          {reconnecting ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Unplug className="h-4 w-4" />
          )}
          {reconnecting ? "Redirecting to Xero…" : "Reconnect to Xero"}
        </Button>
      </div>
    </div>
  );
}
