import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Activity, AlertTriangle, CheckCircle2, Loader2 } from "lucide-react";

interface WebhookRow {
  id: string;
  event_type: string;
  status: string;
  attempts: number;
  last_error: string | null;
  processed_at: string | null;
}

interface EmailRow {
  id: string;
  template_name: string;
  recipient_email: string;
  status: string;
  error_message: string | null;
  created_at: string;
}

interface OperationsHealth {
  checked_at: string;
  webhooks: {
    total: number;
    completed: number;
    failing: number;
    pending: number;
    rows: WebhookRow[];
  };
  emails: {
    sent: number;
    pending: number;
    stale_pending: number;
    dlq: number;
    rows: EmailRow[];
  };
  cron_jobs: Array<{ name: string; schedule: string; active: boolean }>;
}

export default function OperationsHealthPanel() {
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [health, setHealth] = useState<OperationsHealth | null>(null);

  const run = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.rpc("admin_operations_health");
      if (error) throw error;
      setHealth(data as unknown as OperationsHealth);
    } catch (e: unknown) {
      const detail = e instanceof Error ? e.message : "Check failed";
      toast({ title: "Could not load operations health", description: detail, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const allClear =
    health &&
    health.webhooks.failing === 0 &&
    health.webhooks.pending === 0 &&
    health.emails.stale_pending === 0 &&
    health.emails.dlq === 0;

  return (
    <Card className="border-border/60 shadow-none">
      <CardContent className="p-5 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-medium flex items-center gap-2">
              <Activity className="h-4 w-4 text-primary" />
              Operations health
            </h2>
            <p className="text-xs text-muted-foreground mt-1 max-w-xl">
              Payment webhook processing, email delivery backlog and the background schedules.
              Read-only.
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={run} disabled={loading}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Activity className="h-4 w-4" />}
            Refresh
          </Button>
        </div>

        {health && (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[
                { label: "Webhooks processed", value: health.webhooks.completed },
                { label: "Webhooks failing", value: health.webhooks.failing },
                { label: "Emails awaiting send", value: health.emails.pending },
                { label: "Emails undeliverable", value: health.emails.dlq },
              ].map((s) => (
                <div key={s.label} className="rounded-lg border border-border/60 bg-secondary/30 p-3">
                  <p className="text-xs text-muted-foreground">{s.label}</p>
                  <p className="text-lg font-medium tabular-nums">{s.value}</p>
                </div>
              ))}
            </div>

            <div className="flex flex-wrap gap-2">
              {health.cron_jobs.map((j) => (
                <Badge key={j.name} variant={j.active ? "outline" : "destructive"}>
                  {j.name} · {j.schedule}
                </Badge>
              ))}
            </div>

            {allClear ? (
              <p className="text-xs text-emerald-600 flex items-center gap-1.5">
                <CheckCircle2 className="h-3.5 w-3.5" />
                No failing payment webhooks and no email backlog.
              </p>
            ) : (
              <div className="space-y-2">
                {health.webhooks.rows.map((w) => (
                  <div key={w.id} className="rounded-lg border border-border/60 p-3 text-xs">
                    <p className="font-medium flex items-center gap-1.5">
                      <AlertTriangle className="h-3.5 w-3.5 text-destructive" />
                      {w.event_type} — {w.status} ({w.attempts} attempt{w.attempts === 1 ? "" : "s"})
                    </p>
                    {w.last_error && <p className="text-muted-foreground mt-1">{w.last_error}</p>}
                  </div>
                ))}
                {health.emails.rows.map((m) => (
                  <div key={m.id} className="rounded-lg border border-border/60 p-3 text-xs">
                    <p className="font-medium">
                      {m.template_name} → {m.recipient_email} ({m.status})
                    </p>
                    {m.error_message && <p className="text-muted-foreground mt-1">{m.error_message}</p>}
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
