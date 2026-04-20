import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from "recharts";
import { extractTpsData } from "./helpers";

export default function TpsBarChart({ times }) {
  const data = extractTpsData(times);
  if (data.length === 0) return <p className="text-xs text-gray-500 text-center py-4">No TPS data</p>;

  const avg = Math.round(data.reduce((a, d) => a + d.tps, 0) / data.length);

  return (
    <div className="h-[250px]">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
          <XAxis dataKey="index" tick={{ fontSize: 11 }} label={{ value: "Response #", position: "insideBottom", offset: -2, fontSize: 11 }} />
          <YAxis tick={{ fontSize: 11 }} label={{ value: "TPS", angle: -90, position: "insideLeft", fontSize: 11 }} />
          <Tooltip />
          <ReferenceLine y={avg} stroke="#F59E0B" strokeDasharray="3 3" label={{ value: `avg ${avg}`, fontSize: 10 }} />
          <Bar dataKey="tps" fill="#8B5CF6" name="Tokens/sec" radius={[2, 2, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
