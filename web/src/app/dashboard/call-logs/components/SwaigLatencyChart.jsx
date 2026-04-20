import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";
import { extractSwaigLatency } from "./helpers";

export default function SwaigLatencyChart({ swaigLog }) {
  const data = extractSwaigLatency(swaigLog);
  if (data.length === 0) return <p className="text-xs text-gray-500 text-center py-4">No SWAIG latency data</p>;

  return (
    <div className="h-[250px]">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
          <XAxis dataKey="name" tick={{ fontSize: 10 }} />
          <YAxis tick={{ fontSize: 11 }} label={{ value: "ms", angle: -90, position: "insideLeft", fontSize: 11 }} />
          <Tooltip />
          <Legend wrapperStyle={{ fontSize: "11px" }} />
          <Bar dataKey="avgExec" fill="#3B82F6" name="Execution" radius={[2, 2, 0, 0]} />
          <Bar dataKey="avgFunc" fill="#F59E0B" name="Function" radius={[2, 2, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
