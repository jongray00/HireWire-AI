"use client";

import { useState, useEffect } from "react";
import { useNavigate } from "react-router";
import {
  Users,
  Phone,
  Plus,
  Activity,
  Clock,
  Zap,
} from "lucide-react";
import DashboardSplitHero from "@/components/dashboard/DashboardSplitHero";
import { useWizardMode } from "@/app/hooks/useWizardMode";
import { TEMPLATES } from "@/lib/templates";

export default function DashboardPage() {
  const navigate = useNavigate();
  const [stats, setStats] = useState({
    totalEmployees: 0,
    activeCalls: 0,
    totalCalls: 0,
    avgDuration: 0,
  });
  const [recentActivity, setRecentActivity] = useState([]);
  const [loading, setLoading] = useState(true);
  const { enabled: wizardEnabled } = useWizardMode();

  useEffect(() => {
    loadDashboardData();
  }, []);

  const loadDashboardData = async () => {
    try {
      // Source of truth: /api/list-employees (HireWire Phase 2+).
      // Fetched fresh on every dashboard mount — no localStorage cache.
      let employees = [];
      try {
        let empUrl = "/api/employees/sync";
        try {
          const session = JSON.parse(localStorage.getItem("sally_sales_session") || "{}");
          const projectId = session.credentials?.projectId;
          if (projectId) empUrl += `?projectId=${encodeURIComponent(projectId)}`;
        } catch { /* ignore */ }
        const empRes = await fetch(empUrl);
        const empData = await empRes.json();
        if (empData.success && empData.employees) {
          employees = empData.employees;
        }
      } catch (err) {
        console.warn("Failed to load employees from API:", err?.message || err);
      }

      // Fetch real call data from post-prompt logs API (scoped to project)
      let calls = [];
      try {
        let logsUrl = "/api/post-prompt/logs";
        try {
          const session = JSON.parse(localStorage.getItem("sally_sales_session") || "{}");
          const projectId = session.credentials?.projectId;
          if (projectId) logsUrl += `?projectId=${encodeURIComponent(projectId)}`;
        } catch { /* ignore */ }

        const res = await fetch(logsUrl);
        const data = await res.json();
        if (data.success && data.logs) {
          calls = data.logs;
        }
      } catch {
        // Fallback to localStorage if API unavailable
        const callHistory = localStorage.getItem("sally_sales_call_history");
        calls = callHistory ? JSON.parse(callHistory) : [];
      }

      // Calculate stats from real call data
      const totalCalls = calls.length;
      const avgDuration =
        totalCalls > 0
          ? calls.reduce((sum, c) => sum + (c.durationSec || c.duration || 0), 0) / totalCalls
          : 0;

      setStats({
        totalEmployees: employees.length,
        activeCalls: 0,
        totalCalls,
        avgDuration: Math.round(avgDuration),
      });

      // Get recent activity from real call logs
      const activity = [...calls]
        .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
        .slice(0, 5)
        .map((call) => ({
          id: call.id,
          type: "call",
          employee: call.employeeName || "Unknown Agent",
          message: `Call ${call.outcome || call.status || "completed"} - ${call.durationSec || call.duration || 0}s`,
          timestamp: call.timestamp,
        }));

      setRecentActivity(activity);
    } catch (error) {
      console.error("Failed to load dashboard data:", error);
    } finally {
      setLoading(false);
    }
  };

  const isFirstTime = !loading && stats.totalEmployees === 0;
  const showHeroAtTop = loading || isFirstTime;

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      {showHeroAtTop && <DashboardSplitHero templates={TEMPLATES} wizardEnabled={wizardEnabled} />}

      {/* Stats Grid */}
      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-0 border border-[#1F1F1F] divide-x divide-[#1F1F1F]">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="bg-[#0A0A0A] p-6">
              <div className="animate-pulse">
                <div className="h-3 bg-[#1F1F1F] w-20 mb-4"></div>
                <div className="h-8 bg-[#1F1F1F] w-16"></div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 lg:grid-cols-4 border border-[#1F1F1F] divide-x divide-[#1F1F1F] divide-y lg:divide-y-0 md:divide-y-0">
          <StatCard title="Agents" value={stats.totalEmployees} icon={Users} />
          <StatCard title="Active Calls" value={stats.activeCalls} icon={Phone} />
          <StatCard title="Total Calls" value={stats.totalCalls} icon={Activity} />
          <StatCard title="Avg Duration" value={`${stats.avgDuration}s`} icon={Clock} />
        </div>
      )}

      {/* Recent Activity */}
      <div>
        <h2 className="hw-mono text-[10px] tracking-[0.18em] uppercase text-[#737373] mb-3">
          Recent Activity
        </h2>
        <div className="bg-[#0A0A0A] border border-[#1F1F1F]">
          {recentActivity.length === 0 ? (
            <div className="p-10 text-center">
              <Activity className="mx-auto text-[#404040] mb-4" size={40} />
              <p className="text-sm text-[#A3A3A3] mb-5">
                No recent activity yet
              </p>
              <button
                onClick={() => navigate("/dashboard/employees?new=true")}
                className="inline-flex items-center space-x-2 px-5 py-2.5 bg-[#2553F4] hover:bg-[#1E46DC] text-white transition-colors"
              >
                <Plus size={16} />
                <span className="hw-mono text-[11px] tracking-[0.16em] uppercase font-semibold">Create Your First Agent</span>
              </button>
            </div>
          ) : (
            <div className="divide-y divide-[#1F1F1F]">
              {recentActivity.map((item) => (
                <div key={item.id} className="p-4 hover:bg-[#111111] transition-colors">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center space-x-2 mb-1">
                        <Zap className="text-[#2553F4]" size={14} />
                        <span className="text-sm font-medium text-[#FAFAFA] truncate">
                          {item.employee}
                        </span>
                      </div>
                      <p className="text-sm text-[#A3A3A3]">{item.message}</p>
                    </div>
                    <span className="hw-mono text-[10px] text-[#737373] shrink-0">
                      {new Date(item.timestamp).toLocaleTimeString()}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Demo Tools — hidden behind a disclosure */}
      <details className="mt-8">
        <summary className="hw-mono text-[10px] tracking-[0.16em] uppercase text-[#737373] cursor-pointer hover:text-[#A3A3A3]">
          Demo Tools
        </summary>
        <div className="mt-3 flex gap-3">
          <button
            onClick={async () => {
              if (!confirm('Clear all agents and call logs?')) return;
              await fetch('/api/demo/reset', { method: 'POST' });
              loadDashboardData();
            }}
            className="hw-mono text-[10px] tracking-[0.16em] uppercase px-3 py-2 border border-[#E84B5B]/40 text-[#E84B5B] hover:bg-[#E84B5B] hover:text-white transition-colors"
          >
            Reset Demo Data
          </button>
          <button
            onClick={async () => {
              await fetch('/api/demo/seed', { method: 'POST' });
              loadDashboardData();
            }}
            className="hw-mono text-[10px] tracking-[0.16em] uppercase px-3 py-2 border border-[#2553F4]/40 text-[#2553F4] hover:bg-[#2553F4] hover:text-white transition-colors"
          >
            Seed Example Data
          </button>
        </div>
      </details>

      {!showHeroAtTop && <DashboardSplitHero templates={TEMPLATES} wizardEnabled={wizardEnabled} />}
    </div>
  );
}

function StatCard({ title, value, icon: Icon }) {
  return (
    <div className="bg-[#0A0A0A] p-6">
      <div className="hw-mono text-[13px] tracking-[0.18em] uppercase text-[#A3A3A3] mb-3 flex items-center gap-2">
        <Icon size={16} className="text-[#2553F4]" />
        <span>{title}</span>
      </div>
      <div className="text-4xl font-light text-[#FAFAFA] tracking-tight">
        {value}
      </div>
    </div>
  );
}

