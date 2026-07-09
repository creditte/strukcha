import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Loader2, Building2 } from "lucide-react";
import { toast } from "sonner";
import XeroLogo from "@/components/XeroLogo";
import { xeroToastPayload } from "@/lib/xeroErrors";

interface XeroOrgOption {
  id: string;
  name: string;
  type?: string | null;
}

interface Props {
  /** Called after a successful selection so the caller can reload state. */
  onConnected?: () => void;
}

/**
 * Renders when Xero returns multiple organisations for the user.
 * Reads `?xero=select_org&token=...&orgs=<base64 json>` from the URL,
 * lets the user pick one, and finalises the connection.
 */
export default function XeroOrgPickerDialog({ onConnected }: Props) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [open, setOpen] = useState(false);
  const [orgs, setOrgs] = useState<XeroOrgOption[]>([]);
  const [token, setToken] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (searchParams.get("xero") !== "select_org") return;
    const t = searchParams.get("token");
    const orgsParam = searchParams.get("orgs");
    if (!t || !orgsParam) return;
    try {
      const decoded = JSON.parse(atob(decodeURIComponent(orgsParam))) as XeroOrgOption[];
      if (Array.isArray(decoded) && decoded.length > 0) {
        setOrgs(decoded);
        setSelected(decoded[0].id);
        setToken(t);
        setOpen(true);
      }
    } catch {
      // Malformed — ignore and clear params.
      setSearchParams({}, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  const clearParams = () => {
    const next = new URLSearchParams(searchParams);
    next.delete("xero");
    next.delete("token");
    next.delete("orgs");
    next.delete("reason");
    setSearchParams(next, { replace: true });
  };

  const handleConfirm = async () => {
    if (!token || !selected) return;
    setSubmitting(true);
    try {
      const { data, error } = await supabase.functions.invoke("xero-finalise-connection", {
        body: { selection_token: token, xero_tenant_id: selected },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      const chosen = orgs.find((o) => o.id === selected);
      toast.success("Connected to Xero", {
        description: chosen ? `Linked ${chosen.name}.` : undefined,
      });
      setOpen(false);
      clearParams();
      onConnected?.();
    } catch (err) {
      const payload = xeroToastPayload(err);
      toast.error(payload.title, { description: payload.description });
    } finally {
      setSubmitting(false);
    }
  };

  const handleCancel = () => {
    if (submitting) return;
    setOpen(false);
    clearParams();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => (o ? setOpen(true) : handleCancel())}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <XeroLogo className="h-5 w-5" />
            Choose a Xero organisation
          </DialogTitle>
          <DialogDescription>
            Your Xero sign-in has access to multiple organisations. Pick the one you want to connect
            to strukcha.
          </DialogDescription>
        </DialogHeader>

        <RadioGroup
          value={selected ?? undefined}
          onValueChange={setSelected}
          className="mt-2 max-h-72 space-y-2 overflow-y-auto pr-1"
        >
          {orgs.map((org) => (
            <Label
              key={org.id}
              htmlFor={`xero-org-${org.id}`}
              className="flex cursor-pointer items-start gap-3 rounded-lg border p-3 hover:bg-muted/40 has-[[data-state=checked]]:border-[#13B5EA] has-[[data-state=checked]]:bg-[#13B5EA]/5"
            >
              <RadioGroupItem id={`xero-org-${org.id}`} value={org.id} className="mt-1" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <Building2 className="h-4 w-4 text-muted-foreground shrink-0" />
                  <span className="font-medium text-foreground truncate">{org.name}</span>
                </div>
                {org.type && (
                  <p className="mt-0.5 text-xs text-muted-foreground capitalize">
                    {org.type.toLowerCase().replace(/_/g, " ")}
                  </p>
                )}
              </div>
            </Label>
          ))}
        </RadioGroup>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="ghost" onClick={handleCancel} disabled={submitting}>
            Cancel
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={submitting || !selected}
            className="gap-2 bg-[#13B5EA] text-white hover:bg-[#0f9dcc]"
          >
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <XeroLogo className="h-4 w-4" />}
            {submitting ? "Connecting…" : "Connect organisation"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
