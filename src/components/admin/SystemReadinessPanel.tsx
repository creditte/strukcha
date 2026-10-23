import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { ClipboardCheck, Loader2 } from "lucide-react";
import { format } from "date-fns";

type Status = "ok" | "warn" | "fail" | "unknown";
interface Item { key: string; label: string; status: Status; summary: string; hint?: string; at?: string | null }
interface Readiness { checked_at: string; items: Item[] }

declare const __BUILD_TIMESTAMP__: string;

const LABEL: Record<Status, string> = { ok: "Ready", warn: "Check", fail: "Action needed", unknown: "Not available" };
const VARIANT: Record<Status, "outline" | "secondary" | "destructive"> = {
  ok: "outline", warn: "secondary", fail: "destructive", unknown: "secondary",
};

const fmt = (iso?: string | null) => (iso ? format(new Date(iso), "dd/MM/yyyy HH:mm") : null);

export default function SystemReadinessPanel() {
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<Readiness | null>(null);

  const run = async () => {
    setLoading(true);
    try {
      const { data: res, error } = await supabase.functions.invoke("system-readiness", { body: {} });
      if (error) throw error;
      if ((res as { error?: string })?.error) throw new Error((res as { error: string }).error);
      setData(res as Readiness);
    } catch (e: unknown) {
      toast({ title: "Could not load system readiness", description: e instanceof Error ? e.message : "Check failed", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  let buildTime: string | null = null;
  try { buildTime = fmt(__BUILD_TIMESTAMP__); } catch { buildTime = null; }

  return (
    <Card className="border-border/60 shadow-none">
      <CardContent className="p-5 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-medium flex items-center gap-2">
              <ClipboardCheck className="h-4 w-4 text-primary" />
              System readiness
            </h2>
            <p className="text-xs text-muted-foreground mt-1 max-w-xl">
              Whether the app's web address, email, payments, Xero and XPM sync are set up and healthy. Read-only.
              {buildTime && <> App version built {buildTime}.</>}
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={run} disabled={loading}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ClipboardCheck className="h-4 w-4" />}
            Check
          </Button>
        </div>

        {data && (
          <ul className="divide-y divide-border/60">
            {data.items.map((i) => (
              <li key={i.key} className="py-3 flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium">{i.label}</p>
                  <p className="text-xs text-muted-foreground">
                    {i.summary}
                    {fmt(i.at) && <> · {fmt(i.at)}</>}
                  </p>
                  {i.hint && <p className="text-xs text-muted-foreground mt-0.5">{i.hint}</p>}
                </div>
                <Badge variant={VARIANT[i.status]}>{LABEL[i.status]}</Badge>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
