"use client";

import { useState, useEffect } from "react";
import { useNavigate } from "react-router";
import {
  Users,
  FileText,
  Phone,
  Plus,
  Activity,
  Clock,
  TrendingUp,
  Zap,
  ArrowRight,
} from "lucide-react";

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

  useEffect(() => {
    loadDashboardData();
  }, []);

  const loadDashboardData = async () => {
    try {
      // Load employees from API (DB-backed), with localStorage fallback
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
      } catch {
        const employeesData = localStorage.getItem("sally_sales_employees");
        employees = employeesData ? JSON.parse(employeesData) : [];
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
          employee: call.employeeName || "Unknown Employee",
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

  const quickActions = [
    {
      title: "Create Employee",
      description: "Add a new AI voice agent",
      icon: Plus,
      color: "blue",
      action: () => navigate("/dashboard/employees?new=true"),
    },
    {
      title: "Browse Templates",
      description: "Start with a pre-built agent",
      icon: FileText,
      color: "purple",
      action: () => navigate("/dashboard/templates"),
    },
    {
      title: "View Employees",
      description: "Manage your AI agents",
      icon: Users,
      color: "green",
      action: () => navigate("/dashboard/employees"),
    },
  ];

  const isFirstTime = !loading && stats.totalEmployees === 0;

  return (
    <div className="max-w-7xl mx-auto space-y-8">
      {/* Getting Started hero — shown prominently when no employees yet */}
      {isFirstTime && (
        <div className="relative bg-[#0A0A0A] border border-[#1F1F1F] p-8 lg:p-10 overflow-hidden">
          <span className="absolute left-0 top-0 bottom-0 w-[3px] bg-[#2553F4]" />
          <div className="hw-mono text-[10px] tracking-[0.18em] uppercase text-[#737373] mb-2">
            Get Started
          </div>
          <h1 className="text-3xl lg:text-4xl font-medium text-[#FAFAFA] tracking-tight mb-3">
            Hire an AI employee
          </h1>
          <p className="text-[#A3A3A3] mb-6 max-w-2xl">
            Build a voice agent in about a minute. Talk to the Setup Wizard and
            it&apos;ll create the agent for you, or pick a pre-built template to
            customize.
          </p>
          <div className="flex flex-wrap gap-3">
            <button
              onClick={() => navigate("/dashboard/employees?new=true")}
              className="inline-flex items-center space-x-2 px-6 py-3 bg-[#2553F4] hover:bg-[#1E46DC] text-white transition-colors"
            >
              <Plus size={18} />
              <span className="hw-mono text-[11px] tracking-[0.16em] uppercase font-semibold">Create Employee</span>
            </button>
            <button
              onClick={() => navigate("/dashboard/templates")}
              className="inline-flex items-center space-x-2 px-6 py-3 bg-transparent border border-[#1F1F1F] hover:border-[#2553F4]/60 text-[#FAFAFA] transition-colors"
            >
              <FileText size={18} />
              <span className="hw-mono text-[11px] tracking-[0.16em] uppercase font-semibold">Browse Templates</span>
            </button>
          </div>
        </div>
      )}

      {/* Welcome panel — shown only after first employee is created */}
      {!isFirstTime && (
        <div className="relative bg-[#0A0A0A] border border-[#1F1F1F] p-6">
          <span className="absolute left-0 top-0 bottom-0 w-[2px] bg-[#2553F4]" />
          <div className="hw-mono text-[10px] tracking-[0.18em] uppercase text-[#737373] mb-1">
            Dashboard
          </div>
          <h1 className="text-xl font-medium text-[#FAFAFA] tracking-tight">
            Welcome back
          </h1>
          <p className="text-sm text-[#A3A3A3] mt-1">
            Manage your AI voice agents and track their performance.
          </p>
        </div>
      )}

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
          <StatCard title="Employees" value={stats.totalEmployees} icon={Users} />
          <StatCard title="Active Calls" value={stats.activeCalls} icon={Phone} />
          <StatCard title="Total Calls" value={stats.totalCalls} icon={Activity} />
          <StatCard title="Avg Duration" value={`${stats.avgDuration}s`} icon={Clock} />
        </div>
      )}

      {/* Quick Actions */}
      <div>
        <h2 className="hw-mono text-[10px] tracking-[0.18em] uppercase text-[#737373] mb-3">
          Quick Actions
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-0 border border-[#1F1F1F] divide-x md:divide-x-0 md:divide-y-0 divide-[#1F1F1F]">
          {quickActions.map((action, idx) => (
            <QuickActionCard key={action.title} {...action} primary={idx === 0} />
          ))}
        </div>
      </div>

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
                <span className="hw-mono text-[11px] tracking-[0.16em] uppercase font-semibold">Create Your First Employee</span>
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
    </div>
  );
}

function StatCard({ title, value, icon: Icon }) {
  return (
    <div className="bg-[#0A0A0A] p-6">
      <div className="hw-mono text-[10px] tracking-[0.18em] uppercase text-[#737373] mb-3 flex items-center gap-2">
        <Icon size={12} className="text-[#2553F4]" />
        <span>{title}</span>
      </div>
      <div className="text-3xl font-light text-[#FAFAFA] tracking-tight">
        {value}
      </div>
    </div>
  );
}

function QuickActionCard({ title, description, icon: Icon, action, primary }) {
  return (
    <button
      onClick={action}
      className={`group relative bg-[#0A0A0A] p-6 text-left transition-colors hover:bg-[#111111] ${
        primary ? "" : ""
      }`}
    >
      {primary && (
        <span className="absolute left-0 top-0 bottom-0 w-[2px] bg-[#2553F4]" />
      )}
      <div className="w-10 h-10 border border-[#1F1F1F] group-hover:border-[#2553F4]/50 flex items-center justify-center mb-4 transition-colors">
        <Icon className="text-[#2553F4]" size={18} />
      </div>
      <h3 className="text-base font-medium text-[#FAFAFA] mb-1">{title}</h3>
      <p className="text-sm text-[#A3A3A3]">{description}</p>
      <div className="mt-4 flex items-center text-[#2553F4] group-hover:translate-x-1 transition-transform">
        <span className="hw-mono text-[10px] tracking-[0.16em] uppercase font-semibold">Get started</span>
        <ArrowRight size={14} className="ml-2" />
      </div>
    </button>
  );
}
