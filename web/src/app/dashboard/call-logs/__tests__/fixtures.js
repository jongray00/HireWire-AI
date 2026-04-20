/**
 * Test fixture factories for Call Logs components.
 * All timestamps are in microseconds (SignalWire format).
 */

const BASE_TIME = 1774370000000000; // microsecond epoch

export function makeCallLogMessage(role = "user", overrides = {}) {
  const defaults = {
    role,
    content: role === "user" ? "Hello, I need help." : "Sure, I can help you with that.",
    timestamp: BASE_TIME + 10_000_000,
  };

  if (role === "user") {
    defaults.confidence = 0.95;
  }
  if (role === "assistant") {
    defaults.latency = 450;
    defaults.utterance_latency = 680;
    defaults.audio_latency = 1100;
  }
  if (role === "tool") {
    defaults.content = "Function result: success";
    defaults.execution_latency = 320;
  }

  return { ...defaults, ...overrides };
}

export function makeSwaigEntry(overrides = {}) {
  return {
    command_name: "transfer_to_human",
    command_arg: '{"department": "support", "reason": "Customer needs billing help"}',
    epoch_time: Math.floor(BASE_TIME / 1_000_000),
    post_data: { function: "transfer_to_human", argument: { raw: '{"department":"support","reason":"billing"}' } },
    post_response: { response: "Connecting you with our support team." },
    execution_latency: 250,
    function_latency: 180,
    ...overrides,
  };
}

export function makeRawPayload(overrides = {}) {
  return {
    call_id: "test-call-" + Math.random().toString(36).slice(2, 8),
    action: "post_conversation",
    call_start_date: BASE_TIME,
    call_end_date: BASE_TIME + 120_000_000,
    total_input_tokens: 1250,
    total_output_tokens: 890,
    call_log: [
      makeCallLogMessage("system", { content: "You are a helpful assistant.", timestamp: BASE_TIME }),
      makeCallLogMessage("user", { content: "Hi, I have a billing question.", timestamp: BASE_TIME + 5_000_000 }),
      makeCallLogMessage("assistant", { content: "I'd be happy to help with billing.", timestamp: BASE_TIME + 7_000_000, audio_latency: 1100, latency: 450, utterance_latency: 680 }),
      makeCallLogMessage("user", { content: "I was charged twice last month.", timestamp: BASE_TIME + 20_000_000, confidence: 0.92 }),
      makeCallLogMessage("assistant", { content: "Let me look into that for you.", timestamp: BASE_TIME + 22_000_000, audio_latency: 980, latency: 380, utterance_latency: 600 }),
      makeCallLogMessage("tool", { content: "Transfer initiated.", timestamp: BASE_TIME + 30_000_000 }),
    ],
    swaig_log: [
      makeSwaigEntry(),
      makeSwaigEntry({ command_name: "take_message", command_arg: '{"caller_name":"John","message":"Double charge issue"}', execution_latency: 180, function_latency: 120 }),
    ],
    post_prompt_data: {
      raw: '{"summary":"Customer had a billing issue.","caller_intent":"Resolve double charge","outcome":"transferred","sentiment":"negative","topics":["billing","double charge"],"follow_up":"Supervisor review needed"}',
      substituted: '{"summary":"Customer had a billing issue.","caller_intent":"Resolve double charge","outcome":"transferred","sentiment":"negative","topics":["billing","double charge"],"follow_up":"Supervisor review needed"}',
      parsed: [{ summary: "Customer had a billing issue." }],
    },
    global_data: { customer_id: "C-1234", issue_type: "billing" },
    times: [
      { answer_time: 0.45, token_time: 0.8, tokens: 125, tps: 156, response_word_count: 42 },
      { answer_time: 0.38, token_time: 0.7, tokens: 98, tps: 140, response_word_count: 35 },
    ],
    SWMLVars: { call_ended_by: "user" },
    ...overrides,
  };
}

export function makeLogEntry(overrides = {}) {
  const raw = makeRawPayload(overrides._raw);
  return {
    id: raw.call_id,
    employeeId: "test-emp-1",
    employeeName: "Test Agent",
    employeeRole: "Support Rep",
    timestamp: new Date(raw.call_start_date / 1000).toISOString(),
    durationSec: 120,
    summary: "Customer had a billing issue.",
    callerIntent: "Resolve double charge",
    outcome: "transferred",
    sentiment: "negative",
    topics: ["billing", "double charge"],
    followUp: "Supervisor review needed",
    userMessages: 2,
    assistantMessages: 2,
    totalMessages: 6,
    swaigCalls: 2,
    avgLatencyMs: 1040,
    totalInputTokens: 1250,
    totalOutputTokens: 890,
    _raw: raw,
    ...overrides,
  };
}
