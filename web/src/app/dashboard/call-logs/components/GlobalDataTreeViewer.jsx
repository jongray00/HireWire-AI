import { useState } from "react";
import { ChevronRight, ChevronDown } from "lucide-react";

function TreeNode({ name, value, depth = 0 }) {
  const [open, setOpen] = useState(depth < 2);

  if (value === null || value === undefined) {
    return (
      <div className="flex items-center gap-1" style={{ paddingLeft: depth * 16 }}>
        <span className="text-xs text-gray-600 dark:text-gray-400">{name}:</span>
        <span className="text-xs text-gray-400 italic">null</span>
      </div>
    );
  }

  if (typeof value === "object" && !Array.isArray(value)) {
    const keys = Object.keys(value);
    return (
      <div>
        <button onClick={() => setOpen(!open)} className="flex items-center gap-1 hover:bg-gray-100 dark:hover:bg-gray-800 rounded w-full text-left" style={{ paddingLeft: depth * 16 }}>
          {open ? <ChevronDown size={12} className="text-gray-400" /> : <ChevronRight size={12} className="text-gray-400" />}
          <span className="text-xs font-medium text-gray-700 dark:text-gray-300">{name}</span>
          <span className="text-xs text-gray-400">{`{${keys.length}}`}</span>
        </button>
        {open && keys.map(k => <TreeNode key={k} name={k} value={value[k]} depth={depth + 1} />)}
      </div>
    );
  }

  if (Array.isArray(value)) {
    return (
      <div>
        <button onClick={() => setOpen(!open)} className="flex items-center gap-1 hover:bg-gray-100 dark:hover:bg-gray-800 rounded w-full text-left" style={{ paddingLeft: depth * 16 }}>
          {open ? <ChevronDown size={12} className="text-gray-400" /> : <ChevronRight size={12} className="text-gray-400" />}
          <span className="text-xs font-medium text-gray-700 dark:text-gray-300">{name}</span>
          <span className="text-xs text-gray-400">[{value.length}]</span>
        </button>
        {open && value.map((v, i) => <TreeNode key={i} name={`[${i}]`} value={v} depth={depth + 1} />)}
      </div>
    );
  }

  const typeColor = typeof value === "string" ? "text-green-600 dark:text-green-400"
    : typeof value === "number" ? "text-blue-600 dark:text-blue-400"
    : typeof value === "boolean" ? "text-purple-600 dark:text-purple-400"
    : "text-gray-600 dark:text-gray-400";

  return (
    <div className="flex items-center gap-1" style={{ paddingLeft: depth * 16 }}>
      <span className="text-xs text-gray-600 dark:text-gray-400">{name}:</span>
      <span className={`text-xs ${typeColor}`}>
        {typeof value === "string" ? `"${value}"` : String(value)}
      </span>
    </div>
  );
}

export default function GlobalDataTreeViewer({ globalData, userVariables, swmlVars }) {
  const sections = [
    globalData && Object.keys(globalData).length > 0 && { name: "Global Data", data: globalData },
    userVariables && Object.keys(userVariables).length > 0 && { name: "User Variables", data: userVariables },
    swmlVars && Object.keys(swmlVars).length > 0 && { name: "SWML Variables", data: swmlVars },
  ].filter(Boolean);

  if (sections.length === 0) {
    return <p className="text-sm text-gray-500 dark:text-gray-400 py-4 text-center">No state data available</p>;
  }

  return (
    <div className="space-y-4 max-h-[500px] overflow-y-auto">
      {sections.map(s => (
        <div key={s.name}>
          <h4 className="text-sm font-semibold text-gray-900 dark:text-white mb-2">{s.name}</h4>
          <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-3 border border-gray-200 dark:border-gray-700">
            {Object.keys(s.data).map(k => <TreeNode key={k} name={k} value={s.data[k]} />)}
          </div>
        </div>
      ))}
    </div>
  );
}
