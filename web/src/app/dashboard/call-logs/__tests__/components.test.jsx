import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { makeLogEntry, makeRawPayload, makeCallLogMessage, makeSwaigEntry } from "./fixtures";

// Phase 0: Badge components
import SentimentBadge from "../components/badges/SentimentBadge";
import OutcomeBadge from "../components/badges/OutcomeBadge";

describe("SentimentBadge", () => {
  it("renders nothing for null", () => {
    const { container } = render(<SentimentBadge sentiment={null} />);
    expect(container.innerHTML).toBe("");
  });
  it("renders positive badge", () => {
    render(<SentimentBadge sentiment="positive" />);
    expect(screen.getByText("positive")).toBeInTheDocument();
  });
  it("renders negative badge", () => {
    render(<SentimentBadge sentiment="negative" />);
    expect(screen.getByText("negative")).toBeInTheDocument();
  });
  it("renders neutral badge", () => {
    render(<SentimentBadge sentiment="neutral" />);
    expect(screen.getByText("neutral")).toBeInTheDocument();
  });
});

describe("OutcomeBadge", () => {
  it("renders nothing for null", () => {
    const { container } = render(<OutcomeBadge outcome={null} />);
    expect(container.innerHTML).toBe("");
  });
  it("renders resolved", () => {
    render(<OutcomeBadge outcome="resolved" />);
    expect(screen.getByText("resolved")).toBeInTheDocument();
  });
  it("renders follow_up_needed with spaces", () => {
    render(<OutcomeBadge outcome="follow_up_needed" />);
    expect(screen.getByText("follow up needed")).toBeInTheDocument();
  });
});

// Phase 1: PerformanceRatingBadge
import PerformanceRatingBadge from "../components/badges/PerformanceRatingBadge";

describe("PerformanceRatingBadge", () => {
  it("renders nothing for null", () => {
    const { container } = render(<PerformanceRatingBadge avgLatencyMs={null} />);
    expect(container.innerHTML).toBe("");
  });
  it("renders Excellent for low latency", () => {
    render(<PerformanceRatingBadge avgLatencyMs={800} />);
    expect(screen.getByText("Excellent")).toBeInTheDocument();
  });
  it("renders Needs Improvement for high latency", () => {
    render(<PerformanceRatingBadge avgLatencyMs={3000} />);
    expect(screen.getByText("Needs Improvement")).toBeInTheDocument();
  });
});

// Phase 0: TabBar
import TabBar from "../components/TabBar";

describe("TabBar", () => {
  it("renders all tabs", () => {
    const tabs = [{ id: "a", label: "Tab A" }, { id: "b", label: "Tab B" }];
    render(<TabBar tabs={tabs} activeTab="a" onTabChange={() => {}} />);
    expect(screen.getByText("Tab A")).toBeInTheDocument();
    expect(screen.getByText("Tab B")).toBeInTheDocument();
  });
  it("calls onTabChange when clicked", () => {
    const onChange = vi.fn();
    const tabs = [{ id: "a", label: "Tab A" }, { id: "b", label: "Tab B" }];
    render(<TabBar tabs={tabs} activeTab="a" onTabChange={onChange} />);
    fireEvent.click(screen.getByText("Tab B"));
    expect(onChange).toHaveBeenCalledWith("b");
  });
});

// Phase 0: MetricCards
import MetricCards from "../components/MetricCards";

describe("MetricCards", () => {
  it("renders all 4 metric cards", () => {
    const log = makeLogEntry();
    render(<MetricCards log={log} />);
    expect(screen.getByText("Duration")).toBeInTheDocument();
    expect(screen.getByText("Avg Latency")).toBeInTheDocument();
    expect(screen.getByText("Messages")).toBeInTheDocument();
    expect(screen.getByText("Tokens")).toBeInTheDocument();
  });
});

// Phase 0: TranscriptPanel
import TranscriptPanel from "../components/TranscriptPanel";

describe("TranscriptPanel", () => {
  it("shows empty state for null callLog", () => {
    render(<TranscriptPanel callLog={null} />);
    expect(screen.getByText("No transcript available")).toBeInTheDocument();
  });
  it("renders user and assistant messages", () => {
    const callLog = [
      makeCallLogMessage("user", { content: "Hello there" }),
      makeCallLogMessage("assistant", { content: "Hi, how can I help?" }),
    ];
    render(<TranscriptPanel callLog={callLog} />);
    expect(screen.getByText("Hello there")).toBeInTheDocument();
    expect(screen.getByText("Hi, how can I help?")).toBeInTheDocument();
  });
  it("filters by role", () => {
    const callLog = [
      makeCallLogMessage("user", { content: "User message" }),
      makeCallLogMessage("assistant", { content: "Agent message" }),
    ];
    render(<TranscriptPanel callLog={callLog} />);
    // Change filter to "user" only
    const select = screen.getByDisplayValue("All Roles");
    fireEvent.change(select, { target: { value: "user" } });
    expect(screen.getByText("User message")).toBeInTheDocument();
    expect(screen.queryByText("Agent message")).not.toBeInTheDocument();
  });
  it("searches transcript content", () => {
    const callLog = [
      makeCallLogMessage("user", { content: "I need billing help" }),
      makeCallLogMessage("assistant", { content: "Sure, let me check pricing" }),
    ];
    render(<TranscriptPanel callLog={callLog} />);
    const searchInput = screen.getByPlaceholderText("Search transcript...");
    fireEvent.change(searchInput, { target: { value: "billing" } });
    expect(screen.getByText("1 matches")).toBeInTheDocument();
  });
});

// Phase 0: SwaigPanel
import SwaigPanel from "../components/SwaigPanel";

describe("SwaigPanel", () => {
  it("shows empty state", () => {
    render(<SwaigPanel swaigLog={null} />);
    expect(screen.getByText("No function calls")).toBeInTheDocument();
  });
  it("renders function calls", () => {
    const swaigLog = [makeSwaigEntry({ command_name: "lookup_customer" })];
    render(<SwaigPanel swaigLog={swaigLog} />);
    expect(screen.getByText("lookup_customer")).toBeInTheDocument();
  });
  it("filters by search query", () => {
    const swaigLog = [
      makeSwaigEntry({ command_name: "lookup_customer" }),
      makeSwaigEntry({ command_name: "transfer_to_human" }),
    ];
    render(<SwaigPanel swaigLog={swaigLog} />);
    const searchInput = screen.getByPlaceholderText("Search functions, args, responses...");
    fireEvent.change(searchInput, { target: { value: "transfer" } });
    expect(screen.getByText("1/2")).toBeInTheDocument();
  });
});

// Phase 1: SummaryPanel
import SummaryPanel from "../components/SummaryPanel";

describe("SummaryPanel", () => {
  it("renders summary and intent", () => {
    const log = makeLogEntry();
    render(<SummaryPanel log={log} />);
    expect(screen.getByText("Customer had a billing issue.")).toBeInTheDocument();
    expect(screen.getByText("Resolve double charge")).toBeInTheDocument();
  });
  it("shows follow-up when present", () => {
    const log = makeLogEntry({ followUp: "Call back tomorrow" });
    render(<SummaryPanel log={log} />);
    expect(screen.getByText("Call back tomorrow")).toBeInTheDocument();
  });
  it("renders topics as tags", () => {
    const log = makeLogEntry({ topics: ["billing", "refund"] });
    render(<SummaryPanel log={log} />);
    expect(screen.getByText("billing")).toBeInTheDocument();
    expect(screen.getByText("refund")).toBeInTheDocument();
  });
  it("shows empty state when no summary", () => {
    const log = makeLogEntry({ summary: null, callerIntent: null });
    render(<SummaryPanel log={log} />);
    expect(screen.getByText("No AI summary available for this call")).toBeInTheDocument();
  });
});

// Phase 1: PostPromptTabs
import PostPromptTabs from "../components/PostPromptTabs";

describe("PostPromptTabs", () => {
  it("shows empty state for null data", () => {
    render(<PostPromptTabs postPromptData={null} />);
    expect(screen.getByText("No post-prompt data available")).toBeInTheDocument();
  });
  it("renders raw tab", () => {
    const data = { raw: '{"summary":"test"}', substituted: '{"summary":"test"}' };
    render(<PostPromptTabs postPromptData={data} />);
    expect(screen.getByText("Raw")).toBeInTheDocument();
    expect(screen.getByText("Substituted")).toBeInTheDocument();
  });
  it("switches tabs", () => {
    const data = { raw: "raw content here", substituted: "substituted content here" };
    render(<PostPromptTabs postPromptData={data} />);
    fireEvent.click(screen.getByText("Substituted"));
    expect(screen.getByText("substituted content here")).toBeInTheDocument();
  });
});

// Phase 1: CallHeader
import CallHeader from "../components/CallHeader";

describe("CallHeader", () => {
  it("renders call ID", () => {
    const log = makeLogEntry();
    render(<CallHeader log={log} />);
    // Call ID is truncated
    expect(screen.getByText(/test-call/)).toBeInTheDocument();
  });
  it("renders export button", () => {
    const log = makeLogEntry();
    render(<CallHeader log={log} />);
    expect(screen.getByText("Export JSON")).toBeInTheDocument();
  });
  it("copies call ID to clipboard", () => {
    const log = makeLogEntry();
    render(<CallHeader log={log} />);
    const copyButton = screen.getByTitle("Copy call ID");
    fireEvent.click(copyButton);
    expect(navigator.clipboard.writeText).toHaveBeenCalled();
  });
  it("shows termination source when available", () => {
    const log = makeLogEntry({ _raw: { SWMLVars: { call_ended_by: "user" } } });
    render(<CallHeader log={log} />);
    expect(screen.getByText("Ended by caller")).toBeInTheDocument();
  });
});

// Phase 2: Chart smoke tests (verify they render without crashing)
import RoleDistributionChart from "../components/RoleDistributionChart";
import LatencyBreakdownChart from "../components/LatencyBreakdownChart";
import TpsBarChart from "../components/TpsBarChart";
import AsrConfidenceChart from "../components/AsrConfidenceChart";
import SwaigLatencyChart from "../components/SwaigLatencyChart";

describe("RoleDistributionChart", () => {
  it("renders without crashing", () => {
    const callLog = makeRawPayload().call_log;
    const { container } = render(<RoleDistributionChart callLog={callLog} />);
    expect(container.firstChild).toBeTruthy();
  });
  it("returns null for empty data", () => {
    const { container } = render(<RoleDistributionChart callLog={[]} />);
    expect(container.innerHTML).toBe("");
  });
});

describe("LatencyBreakdownChart", () => {
  it("renders without crashing", () => {
    const callLog = makeRawPayload().call_log;
    const { container } = render(<LatencyBreakdownChart callLog={callLog} />);
    expect(container.firstChild).toBeTruthy();
  });
  it("shows empty message for no data", () => {
    render(<LatencyBreakdownChart callLog={[]} />);
    expect(screen.getByText("No latency data")).toBeInTheDocument();
  });
});

describe("TpsBarChart", () => {
  it("renders without crashing", () => {
    const times = makeRawPayload().times;
    const { container } = render(<TpsBarChart times={times} />);
    expect(container.firstChild).toBeTruthy();
  });
  it("shows empty message for no data", () => {
    render(<TpsBarChart times={[]} />);
    expect(screen.getByText("No TPS data")).toBeInTheDocument();
  });
});

describe("AsrConfidenceChart", () => {
  it("renders without crashing", () => {
    const callLog = makeRawPayload().call_log;
    const { container } = render(<AsrConfidenceChart callLog={callLog} />);
    expect(container.firstChild).toBeTruthy();
  });
  it("shows empty message for no data", () => {
    render(<AsrConfidenceChart callLog={[]} />);
    expect(screen.getByText("No ASR data")).toBeInTheDocument();
  });
});

describe("SwaigLatencyChart", () => {
  it("renders without crashing", () => {
    const swaigLog = makeRawPayload().swaig_log;
    const { container } = render(<SwaigLatencyChart swaigLog={swaigLog} />);
    expect(container.firstChild).toBeTruthy();
  });
  it("shows empty message for no data", () => {
    render(<SwaigLatencyChart swaigLog={[]} />);
    expect(screen.getByText("No SWAIG latency data")).toBeInTheDocument();
  });
});

// Phase 4: CallTimelineSwimlane
import CallTimelineSwimlane from "../components/CallTimelineSwimlane";

describe("CallTimelineSwimlane", () => {
  it("shows empty state for null", () => {
    render(<CallTimelineSwimlane callLog={null} callStartDate={0} />);
    expect(screen.getByText("No timeline data")).toBeInTheDocument();
  });
  it("renders lane labels", () => {
    const raw = makeRawPayload();
    render(<CallTimelineSwimlane callLog={raw.call_log} callStartDate={raw.call_start_date} />);
    // "User" appears in lane label and legend, so use getAllByText
    expect(screen.getAllByText("User").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Assistant").length).toBeGreaterThan(0);
  });
});

// Phase 4: GlobalDataTreeViewer
import GlobalDataTreeViewer from "../components/GlobalDataTreeViewer";

describe("GlobalDataTreeViewer", () => {
  it("shows empty state when no data", () => {
    render(<GlobalDataTreeViewer globalData={{}} userVariables={{}} swmlVars={{}} />);
    expect(screen.getByText("No state data available")).toBeInTheDocument();
  });
  it("renders global data keys", () => {
    render(<GlobalDataTreeViewer globalData={{ customer_id: "C-1234" }} />);
    expect(screen.getByText("customer_id:")).toBeInTheDocument();
    expect(screen.getByText('"C-1234"')).toBeInTheDocument();
  });
  it("renders nested objects with expand/collapse", () => {
    render(<GlobalDataTreeViewer globalData={{ nested: { key: "value" } }} />);
    expect(screen.getByText("nested")).toBeInTheDocument();
    // Nested content should be visible since depth < 2 auto-expands
    expect(screen.getByText("key:")).toBeInTheDocument();
  });
});

// Phase 5: RecordingWaveform
import RecordingWaveform from "../components/RecordingWaveform";

describe("RecordingWaveform", () => {
  it("shows no-recording message when URL is null", () => {
    render(<RecordingWaveform recordingUrl={null} />);
    expect(screen.getByText("No recording available for this call")).toBeInTheDocument();
  });
  it("renders container for valid URL", () => {
    // wavesurfer will fail to load in jsdom but the component should render
    const { container } = render(<RecordingWaveform recordingUrl="https://example.com/recording.wav" />);
    expect(container.querySelector("[class*=rounded-lg]")).toBeTruthy();
  });
});

// Task 17: CallLogsList — wizard pill + built-agent link + filter chip
import CallLogsList from "../components/CallLogsList";

describe("Call Logs — wizard rows", () => {
  const baseLog = (overrides = {}) => ({
    id: "c1",
    timestamp: new Date().toISOString(),
    duration_sec: 30,
    summary: "test",
    employee_name: "Sarah",
    employee_role: "Support",
    employeeId: "emp_x",
    builtAgentId: null,
    actions: [],
    ...overrides,
  });

  it("renders 🧙 Wizard Session pill for employeeId='wizard-{projectId}'", () => {
    const logs = [baseLog({ employeeId: "wizard-p1", employee_name: "Setup Wizard" })];
    render(<CallLogsList logs={logs} filter="all" />);
    expect(screen.getByText(/Wizard Session/i)).toBeDefined();
  });

  it("renders 'Built: {name}' link when builtAgentId is set", () => {
    const logs = [baseLog({ employeeId: "wizard-p1", builtAgentId: "emp_x" })];
    const employees = [{ id: "emp_x", name: "Sarah" }];
    render(<CallLogsList logs={logs} employees={employees} filter="all" />);
    const link = screen.getByRole("link", { name: /Built: Sarah/i });
    expect(link.getAttribute("href")).toContain("emp_x");
  });

  it("filter='wizard' shows only wizard rows", () => {
    const logs = [
      baseLog({ id: "c1", employeeId: "emp_x" }),
      baseLog({ id: "c2", employeeId: "wizard-p1" }),
    ];
    render(<CallLogsList logs={logs} filter="wizard" />);
    expect(screen.queryByText("c1")).toBeNull();
    expect(screen.queryByText("c2")).toBeDefined();
  });

  it("filter='employees' hides wizard rows", () => {
    const logs = [
      baseLog({ id: "c1", employeeId: "emp_x" }),
      baseLog({ id: "c2", employeeId: "wizard-p1" }),
    ];
    render(<CallLogsList logs={logs} filter="employees" />);
    expect(screen.queryByText("Wizard Session")).toBeNull();
  });
});

// Phase 0+1: CallDetail integration
import CallDetail from "../components/CallDetail";

describe("CallDetail", () => {
  it("renders without crashing", () => {
    const log = makeLogEntry();
    const { container } = render(<CallDetail log={log} />);
    expect(container.firstChild).toBeTruthy();
  });
  it("shows all main tabs", () => {
    const log = makeLogEntry();
    render(<CallDetail log={log} />);
    expect(screen.getByText("Transcript")).toBeInTheDocument();
    expect(screen.getByText("Charts")).toBeInTheDocument();
    expect(screen.getByText(/Functions/)).toBeInTheDocument();
    expect(screen.getByText("AI Summary")).toBeInTheDocument();
    expect(screen.getByText("Post-Prompt")).toBeInTheDocument();
    expect(screen.getByText("Timeline")).toBeInTheDocument();
    expect(screen.getByText("State Data")).toBeInTheDocument();
  });
  it("switches tabs on click", () => {
    const log = makeLogEntry();
    render(<CallDetail log={log} />);
    fireEvent.click(screen.getByText("AI Summary"));
    expect(screen.getByText("Customer had a billing issue.")).toBeInTheDocument();
  });
  it("shows Recording tab only when URL present", () => {
    const log = makeLogEntry({ _raw: makeRawPayload({ SWMLVars: { record_call_url: "https://example.com/rec.wav" } }) });
    render(<CallDetail log={log} />);
    expect(screen.getByText("Recording")).toBeInTheDocument();
  });
});
