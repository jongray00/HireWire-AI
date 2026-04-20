import { getPerformanceRating } from "../helpers";

export default function PerformanceRatingBadge({ avgLatencyMs }) {
  const rating = getPerformanceRating(avgLatencyMs);
  if (!rating) return null;
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${rating.color}`}>
      {rating.label}
    </span>
  );
}
