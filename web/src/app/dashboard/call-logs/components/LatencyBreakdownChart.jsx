import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, ReferenceLine } from "recharts";
import { extractLatencyBreakdown } from "./helpers";

export default function LatencyBreakdownChart({ callLog }) {
  const data = extractLatencyBreakdown(callLog);
  if (data.length === 0) return <p className="text-xs text-gray-500 text-center py-4">No latency data</p>;

  const avg = Math.round(data.reduce((a, d) => a + d.total, 0) / data.length);

  return (
    <div className="h-[250px]">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
          <XAxis dataKey="index" tick={{ fontSize: 11 }} label={{ value: "Response #", position: "insideBottom", offset: -2, fontSize: 11 }} />
          <YAxis tick={{ fontSize: 11 }} label={{ value: "ms", angle: -90, position: "insideLeft", fontSize: 11 }} />
          <Tooltip />
          <Legend wrapperStyle={{ fontSize: "11px" }} />
          <ReferenceLine y={avg} stroke="#F59E0B" strokeDasharray="3 3" label={{ value: `avg ${avg}ms`, fontSize: 10 }} />
          <ReferenceLine y={1200} stroke="#EF4444" strokeDasharray="3 3" label={{ value: "target", fontSize: 10 }} />
          <Bar dataKey="llm" stackId="a" fill="#3B82F6" name="LLM" />
          <Bar dataKey="utterance" stackId="a" fill="#8B5CF6" name="Utterance" />
          <Bar dataKey="audio" stackId="a" fill="#10B981" name="Audio" />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
