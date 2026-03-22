import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { CheckCircle, AlertCircle, Loader2 } from "lucide-react";

type Status = "loading" | "valid" | "already" | "invalid" | "success" | "error";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

const Unsubscribe = () => {
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token");
  const [status, setStatus] = useState<Status>("loading");
  const [processing, setProcessing] = useState(false);

  useEffect(() => {
    if (!token) {
      setStatus("invalid");
      return;
    }
    fetch(`${SUPABASE_URL}/functions/v1/handle-email-unsubscribe?token=${token}`, {
      headers: { apikey: SUPABASE_ANON_KEY },
    })
      .then((r) => r.json())
      .then((data) => {
        if (data.valid === false && data.reason === "already_unsubscribed") {
          setStatus("already");
        } else if (data.valid) {
          setStatus("valid");
        } else {
          setStatus("invalid");
        }
      })
      .catch(() => setStatus("invalid"));
  }, [token]);

  const handleUnsubscribe = async () => {
    if (!token) return;
    setProcessing(true);
    try {
      const { data } = await supabase.functions.invoke("handle-email-unsubscribe", {
        body: { token },
      });
      if (data?.success) {
        setStatus("success");
      } else if (data?.reason === "already_unsubscribed") {
        setStatus("already");
      } else {
        setStatus("error");
      }
    } catch {
      setStatus("error");
    } finally {
      setProcessing(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardContent className="pt-8 pb-8 text-center space-y-4">
          <p className="text-lg font-semibold text-primary tracking-tight">strukcha</p>

          {status === "loading" && (
            <div className="flex flex-col items-center gap-3">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              <p className="text-muted-foreground text-sm">Validating your request…</p>
            </div>
          )}

          {status === "valid" && (
            <div className="space-y-4">
              <p className="text-foreground">Would you like to unsubscribe from app emails?</p>
              <Button onClick={handleUnsubscribe} disabled={processing} className="w-full">
                {processing ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                Confirm Unsubscribe
              </Button>
            </div>
          )}

          {status === "success" && (
            <div className="flex flex-col items-center gap-3">
              <CheckCircle className="h-10 w-10 text-green-500" />
              <p className="text-foreground font-medium">You've been unsubscribed</p>
              <p className="text-muted-foreground text-sm">You won't receive any more app emails from strukcha.</p>
            </div>
          )}

          {status === "already" && (
            <div className="flex flex-col items-center gap-3">
              <CheckCircle className="h-10 w-10 text-muted-foreground" />
              <p className="text-foreground font-medium">Already unsubscribed</p>
              <p className="text-muted-foreground text-sm">You're already unsubscribed from app emails.</p>
            </div>
          )}

          {status === "invalid" && (
            <div className="flex flex-col items-center gap-3">
              <AlertCircle className="h-10 w-10 text-destructive" />
              <p className="text-foreground font-medium">Invalid link</p>
              <p className="text-muted-foreground text-sm">This unsubscribe link is invalid or has expired.</p>
            </div>
          )}

          {status === "error" && (
            <div className="flex flex-col items-center gap-3">
              <AlertCircle className="h-10 w-10 text-destructive" />
              <p className="text-foreground font-medium">Something went wrong</p>
              <p className="text-muted-foreground text-sm">Please try again or contact support.</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default Unsubscribe;
