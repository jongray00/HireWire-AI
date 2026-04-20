const colors = {
  resolved: "text-green-700 dark:text-green-400 bg-green-50 dark:bg-green-900/30",
  transferred: "text-blue-700 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/30",
  abandoned: "text-red-700 dark:text-red-400 bg-red-50 dark:bg-red-900/30",
  follow_up_needed: "text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/30",
};

export default function OutcomeBadge({ outcome }) {
  if (!outcome) return null;
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${colors[outcome] || colors.resolved}`}>
      {outcome.replace(/_/g, " ")}
    </span>
  );
}
