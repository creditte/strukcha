import { Link, Outlet, useLocation } from "react-router-dom";
import AppSidebar from "@/components/AppSidebar";
import GlobalSearch from "@/components/GlobalSearch";
import UserMenu from "@/components/UserMenu";
import XeroReconnectBanner from "@/components/XeroReconnectBanner";
import XeroOrgPickerDialog from "@/components/XeroOrgPickerDialog";
import { TenantSettingsProvider } from "@/contexts/TenantSettingsContext";
import { XeroConnectionProvider, useXeroConnection } from "@/contexts/XeroConnectionContext";

function XeroOrgPickerBridge() {
  const { reload, clearInvalid } = useXeroConnection();
  return (
    <XeroOrgPickerDialog
      onConnected={() => {
        clearInvalid();
        reload();
      }}
    />
  );
}

export default function AppLayout() {
  const location = useLocation();
  const mobileNavItems = [
    { to: "/", label: "Dashboard" },
    { to: "/structures", label: "Structures" },
    { to: "/import", label: "Import" },
    { to: "/settings", label: "Settings" },
  ];

  return (
    <TenantSettingsProvider>
      <XeroConnectionProvider>
        <div className="flex h-screen overflow-hidden bg-background">
          <AppSidebar />
          <div className="flex-1 flex flex-col overflow-hidden">
            <div className="md:hidden border-b border-border/40 bg-card/40 px-3 py-2">
              <nav className="flex items-center gap-2 overflow-x-auto">
                {mobileNavItems.map((item) => {
                  const active = item.to === "/" ? location.pathname === "/" : location.pathname.startsWith(item.to);
                  return (
                    <Link
                      key={item.to}
                      to={item.to}
                      className={`shrink-0 rounded-md px-2.5 py-1 text-xs ${
                        active ? "bg-accent text-foreground font-medium" : "text-muted-foreground"
                      }`}
                    >
                      {item.label}
                    </Link>
                  );
                })}
              </nav>
            </div>
            <header className="relative flex items-center gap-3 px-3 py-2 sm:px-6 border-b border-border/40 bg-card/30 shrink-0">
              <div className="min-w-0 flex-1 lg:absolute lg:left-1/2 lg:w-full lg:max-w-md lg:-translate-x-1/2 lg:flex-none">
                <GlobalSearch />
              </div>
              <div className="ml-auto shrink-0">
                <UserMenu />
              </div>
            </header>
            <XeroReconnectBanner />
            <XeroOrgPickerBridge />
            <main className="flex-1 overflow-auto px-3 pt-4 sm:px-6">
              <Outlet />
            </main>
          </div>
        </div>
      </XeroConnectionProvider>
    </TenantSettingsProvider>
  );
}
