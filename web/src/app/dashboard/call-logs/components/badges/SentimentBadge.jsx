import { ThumbsUp, ThumbsDown, Minus } from "lucide-react";

const config = {
  positive: { icon: ThumbsUp, cls: "text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-900/30" },
  negative: { icon: ThumbsDown, cls: "text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/30" },
  neutral: { icon: Minus, cls: "text-gray-600 dark:text-gray-400 bg-gray-100 dark:bg-gray-700" },
};

export default function SentimentBadge({ sentiment }) {
  if (!sentiment) return null;
  const c = config[sentiment] || config.neutral;
  const Icon = c.icon;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${c.cls}`}>
      <Icon size={12} />
      {sentiment}
    </span>
  );
}
