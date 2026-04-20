import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from "recharts";
import { extractAsrConfidence } from "./helpers";

export default function AsrConfidenceChart({ callLog }) {
  const data = extractAsrConfidence(callLog);
  if (data.length === 0) return <p className="text-xs text-gray-500 text-center py-4">No ASR data</p>;

  const getColor = (val) => val >= 80 ? "#22C55E" : val >= 50 ? "#F59E0B" : "#EF4444";

  return (
    <div className="h-[250px]">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
          <XAxis dataKey="index" tick={{ fontSize: 11 }} label={{ value: "Utterance #", position: "insideBottom", offset: -2, fontSize: 11 }} />
          <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} label={{ value: "%", angle: -90, position: "insideLeft", fontSize: 11 }} />
          <Tooltip formatter={(val) => `${val}%`} />
          <Bar dataKey="confidence" name="Confidence" radius={[2, 2, 0, 0]}>
            {data.map((entry, i) => (
              <Cell key={i} fill={getColor(entry.confidence)} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
