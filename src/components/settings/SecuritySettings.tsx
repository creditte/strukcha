import { useState } from "react";
import { ShieldCheck, KeyRound, MonitorSmartphone } from "lucide-react";
import { cn } from "@/lib/utils";
import MfaSettings from "@/components/settings/MfaSettings";
import PasswordSettings from "@/components/settings/PasswordSettings";

const items = [
  { id: "mfa", label: "Two-factor authentication", description: "Authenticator app or email codes", icon: ShieldCheck },
  { id: "password", label: "Password", description: "Set or change your password", icon: KeyRound },
  { id: "devices", label: "Trusted devices", description: "Devices that skip two-factor", icon: MonitorSmartphone },
] as const;

type ItemId = (typeof items)[number]["id"];

export default function SecuritySettings() {
  const [selected, setSelected] = useState<ItemId>("mfa");

  return (
    <div className="grid gap-6 md:grid-cols-[240px_1fr]">
      <nav className="flex flex-col gap-1 rounded-lg border bg-card p-2 h-fit" aria-label="Security settings">
        {items.map((item) => {
          const active = selected === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => setSelected(item.id)}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex items-start gap-3 rounded-md px-3 py-2.5 text-left transition-colors",
                active ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
              )}
            >
              <item.icon className={cn("mt-0.5 h-4 w-4 shrink-0", active && "text-primary")} />
              <span className="min-w-0">
                <span className="block text-sm font-medium">{item.label}</span>
                <span className="block text-xs text-muted-foreground">{item.description}</span>
              </span>
            </button>
          );
        })}
      </nav>

      <div className="min-w-0">
        {selected === "mfa" && <MfaSettings section="mfa" />}
        {selected === "password" && <PasswordSettings />}
        {selected === "devices" && <MfaSettings section="devices" />}
      </div>
    </div>
  );
}
