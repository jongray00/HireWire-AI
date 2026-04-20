import { useState } from "react";
import TabBar from "./TabBar";

export default function PostPromptTabs({ postPromptData }) {
  const [tab, setTab] = useState("raw");

  if (!postPromptData) {
    return <p className="text-sm text-gray-500 dark:text-gray-400 py-4 text-center">No post-prompt data available</p>;
  }

  const tabs = [
    postPromptData.raw && { id: "raw", label: "Raw" },
    postPromptData.substituted && { id: "substituted", label: "Substituted" },
    postPromptData.parsed && { id: "parsed", label: "Parsed" },
  ].filter(Boolean);

  if (tabs.length === 0) {
    return <p className="text-sm text-gray-500 dark:text-gray-400 py-4 text-center">No post-prompt data available</p>;
  }

  const activeTab = tabs.find(t => t.id === tab) ? tab : tabs[0].id;

  const content = postPromptData[activeTab];
  let formatted;
  if (activeTab === "parsed" && typeof content === "object") {
    formatted = JSON.stringify(content, null, 2);
  } else if (typeof content === "string") {
    try {
      formatted = JSON.stringify(JSON.parse(content), null, 2);
    } catch {
      formatted = content;
    }
  } else {
    formatted = JSON.stringify(content, null, 2);
  }

  return (
    <div>
      <TabBar tabs={tabs} activeTab={activeTab} onTabChange={setTab} />
      <pre className="text-xs bg-gray-100 dark:bg-gray-800 p-4 rounded-lg overflow-x-auto max-h-[400px] overflow-y-auto whitespace-pre-wrap text-gray-800 dark:text-gray-200">
        {formatted}
      </pre>
    </div>
  );
}
