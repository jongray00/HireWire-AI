import { buildTimelineEvents } from "./helpers";

const laneColors = {
  User: { bg: "bg-blue-500", text: "text-blue-100" },
  Assistant: { bg: "bg-gray-500", text: "text-gray-100" },
  SWAIG: { bg: "bg-amber-500", text: "text-amber-100" },
  System: { bg: "bg-slate-400", text: "text-slate-100" },
};

const lanes = ["User", "Assistant", "SWAIG", "System"];

export default function CallTimelineSwimlane({ callLog, callStartDate }) {
  const events = buildTimelineEvents(callLog, null, callStartDate);
  if (events.length === 0) return <p className="text-xs text-gray-500 text-center py-4">No timeline data</p>;

  const maxTime = Math.max(...events.map(e => e.end), 1);

  return (
    <div className="overflow-x-auto">
      <div className="min-w-[600px]">
        {/* Time axis */}
        <div className="flex items-center mb-1 pl-20">
          {Array.from({ length: Math.ceil(maxTime / 10) + 1 }, (_, i) => (
            <span key={i} className="text-xs text-gray-400" style={{ position: "absolute", left: `${(i * 10 / maxTime) * 100}%` }}>
              {i * 10}s
            </span>
          ))}
        </div>

        {/* Lanes */}
        {lanes.map(lane => {
          const laneEvents = events.filter(e => e.lane === lane);
          if (laneEvents.length === 0) return null;
          const colors = laneColors[lane];

          return (
            <div key={lane} className="flex items-center mb-2">
              <div className="w-20 text-xs font-medium text-gray-600 dark:text-gray-400 shrink-0">{lane}</div>
              <div className="flex-1 relative h-8 bg-gray-100 dark:bg-gray-800 rounded">
                {laneEvents.map(evt => {
                  const left = (evt.start / maxTime) * 100;
                  const width = Math.max(((evt.end - evt.start) / maxTime) * 100, 0.5);
                  return (
                    <div
                      key={evt.id}
                      className={`absolute top-1 bottom-1 ${colors.bg} rounded-sm opacity-80 hover:opacity-100 cursor-pointer`}
                      style={{ left: `${left}%`, width: `${width}%` }}
                      title={`${evt.label} (${(evt.end - evt.start).toFixed(1)}s)`}
                    />
                  );
                })}
              </div>
            </div>
          );
        })}

        {/* Legend */}
        <div className="flex gap-4 mt-3 pl-20">
          {lanes.map(lane => (
            <div key={lane} className="flex items-center gap-1.5">
              <div className={`w-3 h-3 rounded-sm ${laneColors[lane].bg}`} />
              <span className="text-xs text-gray-500 dark:text-gray-400">{lane}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
