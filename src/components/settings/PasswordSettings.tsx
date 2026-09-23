import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { usePasswordSet } from "@/hooks/usePasswordSet";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Eye, EyeOff, KeyRound, Loader2 } from "lucide-react";

function PwField({ id, label, value, onChange, autoComplete }: {
  id: string; label: string; value: string; onChange: (v: string) => void; autoComplete: string;
}) {
  const [show, setShow] = useState(false);
  return (
    <div className="space-y-1.5">
      <Label className="text-xs" htmlFor={id}>{label}</Label>
      <div className="relative">
        <Input id={id} type={show ? "text" : "password"} value={value} autoComplete={autoComplete}
          onChange={(e) => onChange(e.target.value)} className="pr-10" />
        <button type="button" onClick={() => setShow((v) => !v)}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          aria-label={show ? "Hide password" : "Show password"}>
          {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
      </div>
    </div>
  );
}

export default function PasswordSettings() {
  const { user } = useAuth();
  const { passwordSet, loading, markSet } = usePasswordSet();
  const { toast } = useToast();
  const [current, setCurrent] = useState("");
  const [pw, setPw] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);

  const isChange = passwordSet === true;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (pw.length < 6) return toast({ title: "Password too short", description: "Minimum 6 characters required.", variant: "destructive" });
    if (pw !== confirm) return toast({ title: "Passwords don't match", description: "Please make sure both passwords are the same.", variant: "destructive" });
    if (isChange && !current) return toast({ title: "Current password required", variant: "destructive" });
    setBusy(true);
    try {
      const { error } = await supabase.auth.updateUser(
        isChange ? ({ password: pw, current_password: current } as any) : { password: pw },
      );
      if (error) throw error;
      if (user) await supabase.from("profiles").update({ password_set: true } as any).eq("user_id", user.id);
      markSet();
      setCurrent(""); setPw(""); setConfirm("");
      toast({
        title: isChange ? "Password changed" : "Password set",
        description: isChange ? "Use your new password next time you sign in." : "You can now also sign in with your email and password.",
      });
    } catch (err: any) {
      toast({ title: isChange ? "Couldn't change password" : "Couldn't set password", description: err?.message, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="max-w-lg">
      <CardHeader className="pb-4">
        <CardTitle className="flex items-center gap-2 text-base"><KeyRound className="h-4 w-4 text-primary" /> Password</CardTitle>
        <CardDescription>
          {loading ? "\u00a0" : isChange
            ? "Change the password you use to sign in with email."
            : "You sign in with Xero. Set a password to also sign in with email."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {loading ? <Skeleton className="h-24 w-full" /> : (
          <form onSubmit={submit} className="space-y-3">
            {isChange && <PwField id="current-pw" label="Current password" value={current} onChange={setCurrent} autoComplete="current-password" />}
            <div className="grid gap-3 sm:grid-cols-2">
              <PwField id="new-pw" label="New password" value={pw} onChange={setPw} autoComplete="new-password" />
              <PwField id="confirm-pw" label="Confirm password" value={confirm} onChange={setConfirm} autoComplete="new-password" />
            </div>
            <div className="flex items-center justify-between gap-3 pt-1">
              <p className="text-xs text-muted-foreground">Minimum 6 characters.</p>
              <Button type="submit" size="sm" disabled={busy}>
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : isChange ? "Change password" : "Set password"}
              </Button>
            </div>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
