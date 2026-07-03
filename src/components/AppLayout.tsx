import { Link, Outlet, useLocation } from "react-router-dom";
import AppSidebar from "@/components/AppSidebar";
import GlobalSearch from "@/components/GlobalSearch";
import { TenantSettingsProvider } from "@/contexts/TenantSettingsContext";

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
          <header className="flex items-center justify-end px-3 py-2 sm:px-6 border-b border-border/40 bg-card/30 shrink-0">
            <GlobalSearch />
          </header>
          <main className="flex-1 overflow-auto px-3 pt-4 sm:px-6">
            <Outlet />
          </main>
        </div>
      </div>
    </TenantSettingsProvider>
  );
}
