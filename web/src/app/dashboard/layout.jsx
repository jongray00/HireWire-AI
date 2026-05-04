"use client";

import { useState, useEffect } from "react";
import { useNavigate, useLocation } from "react-router";
import {
  Users,
  FileText,
  Settings,
  LogOut,
  Menu,
  X,
  Home,
  Zap,
  Activity,
} from "lucide-react";
import WizardCreationCanvas from "@/components/dashboard/WizardCreationCanvas";

const navigation = [
  { name: "Dashboard", href: "/dashboard", icon: Home },
  { name: "Employees", href: "/dashboard/employees", icon: Users },
  { name: "Resources", href: "/dashboard/resources", icon: Zap },
  { name: "Templates", href: "/dashboard/templates", icon: FileText },
  { name: "Call Logs", href: "/dashboard/call-logs", icon: Activity },
  { name: "Settings", href: "/dashboard/settings", icon: Settings },
];

// Pretty-format a SignalWire space URL: "demo.signalwire.com" → "Demo.SignalWire.com".
// SignalWire is rendered with its native camelCase; common TLDs stay lowercase.
const TLDS = new Set(["com", "net", "io", "ai", "dev", "co", "app", "org"]);
function formatSpaceUrl(url) {
  if (!url) return "";
  return url
    .split(".")
    .map((seg) => {
      const lower = seg.toLowerCase();
      if (lower === "signalwire") return "SignalWire";
      if (TLDS.has(lower)) return lower;
      return seg.charAt(0).toUpperCase() + seg.slice(1).toLowerCase();
    })
    .join(".");
}

export default function DashboardLayout({ children }) {
  const navigate = useNavigate();
  const location = useLocation();
  const pathname = location.pathname;

  const [session, setSession] = useState(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  // Check authentication on mount — verify server-side session via API
  useEffect(() => {
    const checkAuth = async () => {
      try {
        const res = await fetch("/api/auth/session");
        if (res.ok) {
          const serverSession = await res.json();
          setSession({
            credentials: {
              spaceUrl: serverSession.spaceUrl,
              projectId: serverSession.projectId,
            },
            subscriberData: serverSession.subscriberData,
          });
          setIsLoading(false);
          return;
        }
      } catch {
        // Server session check failed — try localStorage fallback
      }

      // Fallback to localStorage (backward compat during migration)
      const sessionData = localStorage.getItem("sally_sales_session");
      if (!sessionData) {
        navigate("/login");
        return;
      }

      try {
        const parsedSession = JSON.parse(sessionData);
        if (!parsedSession.isLoggedIn || !parsedSession.credentials) {
          navigate("/login");
          return;
        }
        setSession(parsedSession);
        setIsLoading(false);
      } catch (e) {
        console.error("Invalid session data:", e);
        localStorage.removeItem("sally_sales_session");
        navigate("/login");
      }
    };

    checkAuth();
  }, [navigate]);

  const [backendOnline, setBackendOnline] = useState(true);

  useEffect(() => {
    const checkBackend = async () => {
      try {
        const res = await fetch("/api/credentials");
        setBackendOnline(res.ok);
      } catch {
        setBackendOnline(false);
      }
    };
    checkBackend();
    const interval = setInterval(checkBackend, 30000);
    return () => clearInterval(interval);
  }, []);

  const handleLogout = async () => {
    // Clear server-side session cookie
    try {
      await fetch("/api/auth/session", { method: "DELETE" });
    } catch {
      // Non-critical
    }
    localStorage.removeItem("sally_sales_session");
    navigate("/login");
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <div className="text-center">
          <div className="w-12 h-12 border-2 border-[#2553F4] border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="hw-mono text-[10px] tracking-[0.18em] uppercase text-[#737373]">
            Loading
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black">
      {/* Mobile sidebar backdrop */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/70 z-40 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`fixed top-0 left-0 z-50 h-full w-64 bg-black border-r border-[#1F1F1F] transform transition-transform duration-300 ease-in-out lg:translate-x-0 ${
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        {/* Logo — height matches topbar (h-14) so the bottom border lines up across both columns */}
        <div className="relative h-14 flex items-center justify-center px-3 border-b border-[#1F1F1F]">
          <img
            src="/hirewire-logo.png?v=2"
            alt="HireWire"
            className="h-9 w-auto object-contain select-none"
            draggable="false"
          />
          <button
            onClick={() => setSidebarOpen(false)}
            className="lg:hidden absolute top-1/2 -translate-y-1/2 right-2 p-1.5 text-[#737373] hover:text-[#FAFAFA] transition-colors"
            aria-label="Close sidebar"
          >
            <X size={18} />
          </button>
        </div>

        {/* Navigation */}
        <nav className="p-3 space-y-0.5">
          {navigation.map((item) => {
            const Icon = item.icon;
            const isActive = pathname === item.href || (item.href !== '/dashboard' && pathname.startsWith(item.href));

            return (
              <button
                key={item.name}
                onClick={() => {
                  navigate(item.href);
                  setSidebarOpen(false);
                }}
                className={`relative w-full flex items-center space-x-3 px-4 py-2.5 transition-colors ${
                  isActive
                    ? "text-[#2553F4]"
                    : "text-[#8A8A8A] hover:text-[#FAFAFA]"
                }`}
              >
                {isActive && (
                  <span className="absolute left-0 top-2 bottom-2 w-[2px] bg-[#2553F4]" />
                )}
                <Icon size={18} />
                <span className="text-sm tracking-tight">{item.name}</span>
              </button>
            );
          })}
        </nav>

        {/* User Section */}
        <div className="absolute bottom-0 left-0 right-0 p-4 border-t border-[#1F1F1F]">
          <div className="mb-3 px-2">
            <div className="hw-micro mb-1.5">CONNECTED</div>
            <div className="text-xs text-[#FAFAFA] hw-mono truncate" title={session?.credentials?.spaceUrl || "SignalWire"}>
              {session?.credentials?.spaceUrl || "SignalWire"}
            </div>
          </div>
          <button
            onClick={handleLogout}
            className="w-full flex items-center justify-center space-x-2 px-4 py-2.5 border border-[#1F1F1F] text-[#A3A3A3] hover:text-[#E84B5B] hover:border-[#E84B5B]/40 transition-colors"
          >
            <LogOut size={16} />
            <span className="hw-mono text-[10px] tracking-[0.16em] uppercase">Sign Out</span>
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <div className="lg:pl-64">
        {/* Top Bar */}
        <header className="sticky top-0 z-30 h-14 bg-black border-b border-[#1F1F1F] flex items-center justify-between px-4 lg:px-8">
          <button
            onClick={() => setSidebarOpen(true)}
            className="lg:hidden p-2 text-[#5C5C5C] hover:text-[#FAFAFA] transition-colors"
          >
            <Menu size={22} />
          </button>

          <div className="flex-1 lg:flex-none flex items-baseline gap-3">
            <h1 className="text-lg font-normal text-[#FAFAFA] tracking-tight">
              {navigation.find((item) => pathname === item.href || (item.href !== '/dashboard' && pathname.startsWith(item.href)))?.name || "Dashboard"}
            </h1>
          </div>

          <div className="flex items-center space-x-3">
            {/* Space name */}
            {session?.credentials?.spaceUrl && (
              <span
                className="hw-mono text-sm text-[#FAFAFA] tracking-tight"
                title={session.credentials.spaceUrl}
              >
                {formatSpaceUrl(session.credentials.spaceUrl)}
              </span>
            )}
          </div>
        </header>

        {/* Backend offline banner */}
        {!backendOnline && (
          <div className="mx-4 lg:mx-6 mt-4 mb-0 px-4 py-3 bg-[#0A0A0A] border-l-2 border-l-[#E84B5B] border-y border-r border-[#1F1F1F] flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="w-1.5 h-1.5 rounded-full bg-[#E84B5B] animate-pulse" />
              <span className="hw-mono text-[10px] tracking-[0.16em] uppercase text-[#E84B5B]">Agent backend offline</span>
            </div>
            <button
              type="button"
              onClick={async () => {
                try {
                  const res = await fetch("/api/credentials");
                  setBackendOnline(res.ok);
                } catch { setBackendOnline(false); }
              }}
              aria-label="Retry backend connection"
              className="hw-mono text-[10px] tracking-[0.16em] uppercase px-3 py-1 border border-[#E84B5B]/40 text-[#E84B5B] hover:bg-[#E84B5B] hover:text-white transition-colors"
            >
              Retry
            </button>
          </div>
        )}

        <WizardCreationCanvas />

        {/* Page Content */}
        <main className="p-4 lg:p-6">
          {children}
        </main>
      </div>
    </div>
  );
}
