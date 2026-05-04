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
        <div key={log.id} data-testid={`call-log-row-${log.id}`} className="px-4 py-3 bg-[#0A0A0A] border border-[#1F1F1F] flex items-center gap-3">
          <span className="text-xs text-[#737373]">{log.id}</span>
          {isWizardLog(log) ? (
            <span className="px-2 py-0.5 bg-[#2553F4]/15 border border-[#2553F4]/40 rounded-full text-xs text-[#5478F8]">
              🧙 Wizard Session
            </span>
          ) : (
            <span className="text-sm text-[#FAFAFA]">{log.employee_name}</span>
          )}
          {log.builtAgentId && (
            <a
              href={`/dashboard/employees/${log.builtAgentId}`}
              className="ml-2 text-xs text-[#5478F8] hover:text-[#7892FA]"
            >
              → Built: {employeesById[log.builtAgentId]?.name || log.builtAgentId}
            </a>
          )}
        </div>
      ))}
    </div>
  );
}
