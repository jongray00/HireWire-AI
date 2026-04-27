import { useMemo } from "react";

const isWizardLog = (log) =>
  typeof log.employeeId === "string" && log.employeeId.startsWith("wizard-");

export default function CallLogsList({ logs = [], employees = [], filter = "all" }) {
  const employeesById = useMemo(() => {
    const map = {};
    for (const emp of employees) map[emp.id] = emp;
    return map;
  }, [employees]);

  const visibleLogs = useMemo(() => {
    return logs.filter((log) => {
      if (filter === "all") return true;
      if (filter === "wizard") return isWizardLog(log);
      return !isWizardLog(log);
    });
  }, [logs, filter]);

  return (
    <div className="space-y-2">
      {visibleLogs.map((log) => (
        <div key={log.id} data-testid={`call-log-row-${log.id}`} className="px-4 py-3 bg-gray-800 rounded-lg flex items-center gap-3">
          <span className="text-xs text-gray-500">{log.id}</span>
          {isWizardLog(log) ? (
            <span className="px-2 py-0.5 bg-purple-600/20 border border-purple-500/40 rounded-full text-xs text-purple-300">
              🧙 Wizard Session
            </span>
          ) : (
            <span className="text-sm text-white">{log.employee_name}</span>
          )}
          {log.builtAgentId && (
            <a
              href={`/dashboard/employees/${log.builtAgentId}`}
              className="ml-2 text-xs text-green-400 hover:text-green-300"
            >
              → Built: {employeesById[log.builtAgentId]?.name || log.builtAgentId}
            </a>
          )}
        </div>
      ))}
    </div>
  );
}
