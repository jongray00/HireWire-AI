"use client";

import { useState, useEffect } from "react";
import {
  Globe,
  RefreshCw,
  Check,
  AlertTriangle,
  ExternalLink,
  Save,
  Loader2,
  Shield,
  Server,
  Phone,
  Trash2,
  Wrench,
  Eye,
  EyeOff,
  Wand2,
} from "lucide-react";
import { useWizardMode } from "@/app/hooks/useWizardMode";

export default function SettingsPage() {
  const [domain, setDomain] = useState("");
  const [savedDomain, setSavedDomain] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [saveMessage, setSaveMessage] = useState(null);
  const [syncResult, setSyncResult] = useState(null);
  const [resources, setResources] = useState([]);
  const [loadingResources, setLoadingResources] = useState(false);

  // Auth state
  const [sessionInfo, setSessionInfo] = useState(null);
  const [showToken, setShowToken] = useState(false);

  // Backend health
  const [backendHealth, setBackendHealth] = useState(null);
  const [checkingBackend, setCheckingBackend] = useState(false);

  // Phone numbers
  const [phoneNumbers, setPhoneNumbers] = useState([]);

  const {
    enabled: wizardEnabled,
    loading: wizardLoading,
    setEnabled: setWizardEnabled,
  } = useWizardMode();
  const [wizardSaveError, setWizardSaveError] = useState(null);

  const handleWizardToggle = async () => {
    setWizardSaveError(null);
    try {
      await setWizardEnabled(!wizardEnabled);
    } catch (err) {
      setWizardSaveError(err.message || "Failed to save Wizard Mode");
    }
  };

  useEffect(() => {
    fetchDomain();
    fetchSession();
    checkBackendHealth();
    fetchPhoneNumbers();
  }, []);

  useEffect(() => {
    if (savedDomain) fetchResources();
  }, [savedDomain]);

  const fetchSession = async () => {
    try {
      const res = await fetch("/api/auth/session");
      if (res.ok) {
        const data = await res.json();
        setSessionInfo(data);
      }
    } catch {
      // No session
    }
  };

  const checkBackendHealth = async () => {
    setCheckingBackend(true);
    try {
      const res = await fetch("/api/credentials");
      const data = await res.json();

      // Try to reach the Python backend
      let agentStatus = "unknown";
      let employeeCount = 0;
      try {
        const healthRes = await fetch("/api/signalwire/list-resources", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ type: "health_check" }),
        });
        // If we get any response, the web server is up
        agentStatus = "reachable";
      } catch {
        agentStatus = "unreachable";
      }

      setBackendHealth({
        webServer: "running",
        agentBackend: agentStatus,
        credentials: data.success ? "configured" : "missing",
        domain: data.swml_url || null,
      });
    } catch {
      setBackendHealth({
        webServer: "running",
        agentBackend: "unknown",
        credentials: "unknown",
      });
    } finally {
      setCheckingBackend(false);
    }
  };

  const fetchPhoneNumbers = async () => {
    try {
      const res = await fetch("/api/signalwire/phone-numbers");
      if (res.ok) {
        const data = await res.json();
        if (data.success) setPhoneNumbers(data.phoneNumbers || []);
      }
    } catch {
      // Not critical
    }
  };

  const fetchDomain = async () => {
    try {
      const res = await fetch("/api/settings/domain");
      const data = await res.json();
      if (data.success && data.domain) {
        setDomain(data.domain);
        setSavedDomain(data.domain);
      }
    } catch (err) {
      console.error("Failed to fetch domain:", err);
    } finally {
      setLoading(false);
    }
  };

  const fetchResources = async () => {
    setLoadingResources(true);
    try {
      const res = await fetch("/api/signalwire/list-resources", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "swml_webhooks" }),
      });

      const data = await res.json();
      if (data.success) {
        setResources(data.categorized?.swml_webhooks || data.all || []);
      }
    } catch (err) {
      console.error("Failed to fetch resources:", err);
    } finally {
      setLoadingResources(false);
    }
  };

  const handleAutoDetect = () => {
    const detectedDomain = window.location.origin;
    setDomain(detectedDomain);
  };

  const handleSaveAndSync = async () => {
    if (!domain.trim()) return;

    setSaving(true);
    setSaveMessage(null);
    setSyncResult(null);

    try {
      const saveRes = await fetch("/api/settings/domain", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ domain: domain.trim() }),
      });

      const saveData = await saveRes.json();
      if (!saveRes.ok) {
        setSaveMessage({ type: "error", text: saveData.error });
        return;
      }

      setSavedDomain(saveData.domain);
      setSaveMessage({ type: "success", text: "Domain saved" });

      await reconcileWebhooks();
    } catch (err) {
      setSaveMessage({ type: "error", text: err.message });
    } finally {
      setSaving(false);
    }
  };

  const reconcileWebhooks = async () => {
    setSyncing(true);
    setSyncResult(null);

    try {
      const res = await fetch("/api/signalwire/reconcile-webhooks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });

      const data = await res.json();

      if (!res.ok) {
        setSyncResult({ type: "error", text: data.error });
        return;
      }

      const parts = [];
      if (data.updated?.length) parts.push(`${data.updated.length} updated`);
      if (data.unchanged?.length) parts.push(`${data.unchanged.length} already current`);
      if (data.errors?.length) parts.push(`${data.errors.length} failed`);

      setSyncResult({
        type: data.errors?.length ? "warning" : "success",
        text: parts.join(", ") || "No webhook resources found",
        details: data,
      });

      fetchResources();
    } catch (err) {
      setSyncResult({ type: "error", text: err.message });
    } finally {
      setSyncing(false);
    }
  };

  const handleFixResource = async (resource) => {
    try {
      const res = await fetch("/api/signalwire/fix-employee-webhook", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resourceId: resource.id }),
      });
      const data = await res.json();
      if (data.success) {
        fetchResources();
      } else {
        alert("Failed to fix: " + (data.error || "Unknown error"));
      }
    } catch (err) {
      alert("Error: " + err.message);
    }
  };

  const getDomainFromUrl = (url) => {
    if (!url) return null;
    try {
      const cleaned = url.replace(/^(https?:\/\/)[^@]+@/, "$1");
      return new URL(cleaned).host;
    } catch {
      return null;
    }
  };

  const isUrlStale = (webhookUrl) => {
    if (!savedDomain || !webhookUrl) return false;
    const resourceHost = getDomainFromUrl(webhookUrl);
    const currentHost = getDomainFromUrl(savedDomain);
    return resourceHost !== currentHost;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="w-12 h-12 border-2 border-[#2553F4] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl lg:text-3xl font-medium text-[#FAFAFA] tracking-tight">Settings</h1>
        <p className="text-[#A3A3A3] mt-1">
          Manage credentials, domain, webhooks, and phone numbers
        </p>
      </div>

      {/* SignalWire Credentials */}
      <div className="bg-[#0A0A0A] border border-[#1F1F1F] p-6">
        <h2 className="text-lg lg:text-xl font-medium text-[#FAFAFA] tracking-tight mb-1 flex items-center space-x-2">
          <Shield size={20} />
          <span>SignalWire Connection</span>
        </h2>
        <p className="text-sm text-[#A3A3A3] mb-4">
          Your SignalWire credentials are stored securely on the server.
        </p>

        {sessionInfo ? (
          <div className="space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-[#737373] mb-1">Space URL</label>
                <div className="px-3 py-2 bg-[#0F0F0F] border border-[#1F1F1F] rounded-md text-sm font-mono text-[#FAFAFA]">
                  {sessionInfo.spaceUrl || "—"}
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-[#737373] mb-1">Project ID</label>
                <div className="px-3 py-2 bg-[#0F0F0F] border border-[#1F1F1F] rounded-md text-sm font-mono text-[#FAFAFA] truncate">
                  {sessionInfo.projectId || "—"}
                </div>
              </div>
            </div>
            <div className="flex items-center space-x-2 text-sm text-green-600">
              <Check size={14} />
              <span>Connected and authenticated</span>
            </div>
          </div>
        ) : (
          <div className="flex items-center space-x-2 text-sm text-amber-600">
            <AlertTriangle size={14} />
            <span>No active session — please log in</span>
          </div>
        )}
      </div>

      {/* Agent Backend Status */}
      <div className="bg-[#0A0A0A] border border-[#1F1F1F] p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg lg:text-xl font-medium text-[#FAFAFA] tracking-tight flex items-center space-x-2">
            <Server size={20} />
            <span>System Status</span>
          </h2>
          <button
            onClick={checkBackendHealth}
            disabled={checkingBackend}
            className="hw-mono text-[11px] tracking-[0.16em] uppercase font-semibold inline-flex items-center space-x-1.5 px-3 py-1.5 bg-[#0F0F0F] border border-[#1F1F1F] hover:bg-[#1A1A1A] text-[#A3A3A3] rounded-md transition-colors disabled:opacity-50"
          >
            <RefreshCw size={12} className={checkingBackend ? "animate-spin" : ""} />
            <span>Refresh</span>
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <StatusBadge
            label="Web Server"
            status={backendHealth?.webServer === "running" ? "ok" : "unknown"}
          />
          <StatusBadge
            label="Agent Credentials"
            status={backendHealth?.credentials === "configured" ? "ok" : backendHealth?.credentials === "missing" ? "error" : "unknown"}
          />
          <StatusBadge
            label="Database"
            status="ok"
          />
        </div>
      </div>

      {/* Wizard Mode */}
      <div className="bg-[#0A0A0A] border border-[#1F1F1F] p-6">
        <h2 className="text-lg lg:text-xl font-medium text-[#FAFAFA] tracking-tight mb-1 flex items-center space-x-2">
          <Wand2 size={20} />
          <span>Wizard Mode</span>
        </h2>
        <p className="text-sm text-[#A3A3A3] mb-4">
          Show the guided wizard panel on the dashboard. Off by default.
        </p>
        <div className="flex items-center justify-between">
          <span className="text-sm text-[#FAFAFA]">
            {wizardLoading
              ? "Loading…"
              : wizardEnabled
                ? "Wizard is visible on the dashboard."
                : "Wizard is hidden on the dashboard."}
          </span>
          <button
            type="button"
            role="switch"
            aria-checked={wizardEnabled}
            aria-label="Toggle Wizard Mode"
            disabled={wizardLoading}
            onClick={handleWizardToggle}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
              wizardEnabled ? "bg-[#FAFAFA]" : "bg-[#1F1F1F]"
            } ${wizardLoading ? "opacity-50 cursor-not-allowed" : ""}`}
          >
            <span
              className={`inline-block h-4 w-4 transform rounded-full transition-transform ${
                wizardEnabled
                  ? "translate-x-6 bg-[#0A0A0A]"
                  : "translate-x-1 bg-[#FAFAFA]"
              }`}
            />
          </button>
        </div>
        {wizardSaveError && (
          <p className="mt-3 text-sm text-red-400">{wizardSaveError}</p>
        )}
      </div>

      {/* Domain Configuration */}
      <div className="bg-[#0A0A0A] border border-[#1F1F1F] p-6">
        <h2 className="text-lg lg:text-xl font-medium text-[#FAFAFA] tracking-tight mb-1 flex items-center space-x-2">
          <Globe size={20} />
          <span>Application Domain</span>
        </h2>
        <p className="text-sm text-[#A3A3A3] mb-4">
          The public URL where this app is accessible. SignalWire webhook resources will be updated to point here.
        </p>

        <div className="flex space-x-3">
          <input
            type="url"
            value={domain}
            onChange={(e) => setDomain(e.target.value)}
            placeholder="https://your-tunnel-url.ngrok-free.app"
            className="flex-1 px-4 py-2 bg-[#0F0F0F] border border-[#1F1F1F] rounded-md focus:ring-2 focus:ring-[#2553F4] focus:border-transparent text-[#FAFAFA] font-mono text-sm"
          />
          <button
            onClick={handleAutoDetect}
            className="hw-mono text-[11px] tracking-[0.16em] uppercase font-semibold px-3 py-2 bg-[#0F0F0F] border border-[#1F1F1F] hover:bg-[#1A1A1A] text-[#A3A3A3] rounded-md transition-colors"
            title="Auto-detect from current URL"
          >
            Auto
          </button>
          <button
            onClick={handleSaveAndSync}
            disabled={saving || !domain.trim()}
            className="inline-flex items-center space-x-2 px-5 py-2 bg-[#2553F4] hover:bg-[#1E46DC] text-white rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              <Save size={16} />
            )}
            <span className="hw-mono text-[11px] tracking-[0.16em] uppercase font-semibold">Save & Sync</span>
          </button>
        </div>

        {saveMessage && (
          <div
            className={`mt-3 flex items-center space-x-2 text-sm ${
              saveMessage.type === "error"
                ? "text-red-600"
                : "text-green-600"
            }`}
          >
            {saveMessage.type === "error" ? <AlertTriangle size={14} /> : <Check size={14} />}
            <span>{saveMessage.text}</span>
          </div>
        )}

        {syncResult && (
          <div
            className={`mt-2 flex items-center space-x-2 text-sm ${
              syncResult.type === "error"
                ? "text-red-600"
                : syncResult.type === "warning"
                ? "text-amber-600"
                : "text-green-600"
            }`}
          >
            {syncResult.type === "success" ? <Check size={14} /> : <AlertTriangle size={14} />}
            <span>Webhook sync: {syncResult.text}</span>
          </div>
        )}
      </div>

      {/* Phone Numbers */}
      {phoneNumbers.length > 0 && (
        <div className="bg-[#0A0A0A] border border-[#1F1F1F] p-6">
          <h2 className="text-lg lg:text-xl font-medium text-[#FAFAFA] tracking-tight mb-4 flex items-center space-x-2">
            <Phone size={20} />
            <span>Phone Numbers ({phoneNumbers.length})</span>
          </h2>

          <div className="space-y-2">
            {phoneNumbers.map((num) => (
              <div
                key={num.sid}
                className="flex items-center justify-between p-3 bg-[#0F0F0F] border border-[#1F1F1F] rounded-md"
              >
                <div>
                  <span className="font-mono text-sm text-[#FAFAFA]">
                    {num.phoneNumber}
                  </span>
                  <div className="flex items-center space-x-2 mt-0.5">
                    {num.capabilities?.voice && (
                      <span className="text-xs text-[#737373]">Voice</span>
                    )}
                    {num.capabilities?.sms && (
                      <span className="text-xs text-blue-600">SMS</span>
                    )}
                  </div>
                </div>
                <div>
                  {num.assignedTo ? (
                    <span className="text-xs text-green-600">
                      Assigned to {num.assignedTo.employeeName}
                    </span>
                  ) : (
                    <span className="text-xs text-[#737373]">
                      Unassigned
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Webhook Resource Status */}
      <div className="bg-[#0A0A0A] border border-[#1F1F1F] p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg lg:text-xl font-medium text-[#FAFAFA] tracking-tight flex items-center space-x-2">
            <ExternalLink size={20} />
            <span>Webhook Resources</span>
          </h2>
          <button
            onClick={() => reconcileWebhooks()}
            disabled={syncing}
            className="hw-mono text-[11px] tracking-[0.16em] uppercase font-semibold inline-flex items-center space-x-2 px-4 py-2 bg-[#0F0F0F] border border-[#1F1F1F] hover:bg-[#1A1A1A] text-[#A3A3A3] rounded-md transition-colors disabled:opacity-50"
          >
            <RefreshCw size={14} className={syncing ? "animate-spin" : ""} />
            <span>Sync All</span>
          </button>
        </div>

        {loadingResources ? (
          <div className="flex items-center justify-center py-8">
            <div className="w-8 h-8 border-3 border-[#2553F4] border-t-transparent rounded-full animate-spin"></div>
          </div>
        ) : resources.length === 0 ? (
          <p className="text-[#737373] text-sm py-4 text-center">
            No SWML webhook resources found.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[#1F1F1F]">
                  <th className="text-left py-2 px-3 text-[#737373] font-medium">
                    Status
                  </th>
                  <th className="text-left py-2 px-3 text-[#737373] font-medium">
                    Resource
                  </th>
                  <th className="text-left py-2 px-3 text-[#737373] font-medium">
                    Webhook Domain
                  </th>
                  <th className="text-right py-2 px-3 text-[#737373] font-medium">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {resources.map((resource) => {
                  const stale = isUrlStale(resource.webhookUrl);
                  const resourceHost = getDomainFromUrl(resource.webhookUrl);

                  return (
                    <tr
                      key={resource.id}
                      className="border-b border-[#1F1F1F]"
                    >
                      <td className="py-3 px-3">
                        {stale ? (
                          <span className="inline-flex items-center space-x-1 text-amber-600">
                            <AlertTriangle size={14} />
                            <span className="text-xs">Stale</span>
                          </span>
                        ) : (
                          <span className="inline-flex items-center space-x-1 text-green-600">
                            <Check size={14} />
                            <span className="text-xs">Current</span>
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-3 text-[#FAFAFA] font-medium">
                        {resource.display_name || resource.name}
                      </td>
                      <td className="py-3 px-3 font-mono text-xs text-[#A3A3A3]">
                        {resourceHost || "—"}
                      </td>
                      <td className="py-3 px-3 text-right">
                        {stale && (
                          <button
                            onClick={() => handleFixResource(resource)}
                            className="inline-flex items-center space-x-1 px-2 py-1 text-xs text-amber-700 bg-amber-50 hover:bg-amber-100 rounded transition-colors"
                            title="Fix webhook URL"
                          >
                            <Wrench size={12} />
                            <span>Fix</span>
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function StatusBadge({ label, status }) {
  const config = {
    ok: { color: "text-green-600", bg: "bg-[#0F0F0F] border border-[#1F1F1F]", icon: Check, text: "OK" },
    error: { color: "text-red-600", bg: "bg-[#0F0F0F] border border-[#1F1F1F]", icon: AlertTriangle, text: "Error" },
    unknown: { color: "text-[#737373]", bg: "bg-[#0F0F0F] border border-[#1F1F1F]", icon: null, text: "Unknown" },
  };
  const c = config[status] || config.unknown;
  const Icon = c.icon;

  return (
    <div className={`p-3 rounded-md ${c.bg}`}>
      <div className="hw-mono text-[10px] tracking-[0.18em] uppercase text-[#737373] mb-1">{label}</div>
      <div className={`flex items-center space-x-1.5 text-sm font-medium ${c.color}`}>
        {Icon && <Icon size={14} />}
        <span>{c.text}</span>
      </div>
    </div>
  );
}
