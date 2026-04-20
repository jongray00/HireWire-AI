# Sally Sales Holistic Completion — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete Sally Sales with an inline wizard banner, RAG bug fixes, demo polish, and test coverage.

**Architecture:** 4 phases — (A) Replace popup wizard with inline banner using SignalWire JS SDK directly, (B) Fix RAG bugs in Python agent, (C) Add loading states and animations, (D) Test coverage for critical paths.

**Tech Stack:** React Router v7, @signalwire/js SDK, Tailwind CSS, Python FastAPI, signalwire-agents SDK, Vitest

**Spec:** `docs/superpowers/specs/2026-04-20-holistic-completion-design.md`

---

## Phase A: Wizard UX Redesign

### Task 1: Create useWizardCall Hook

**Files:**
- Create: `web/src/app/hooks/useWizardCall.js`

This hook wraps the `@signalwire/js` SDK directly (not the call widget). It creates a client, dials the wizard, mounts audio/video into a ref, and exposes call controls + event handlers.

- [ ] **Step 1: Create the hook**

Create `web/src/app/hooks/useWizardCall.js`:

```javascript
"use client";

import { useState, useRef, useCallback } from "react";

/**
 * useWizardCall — Direct SignalWire JS SDK integration for inline wizard calls.
 *
 * Unlike useCallWidget (which creates a popup <call-widget>), this hook
 * mounts audio/video into a provided DOM ref so the call lives inline
 * on the page.
 *
 * @returns {{ startCall, endCall, calling, connected, error, videoRef, onWizardEvent }}
 */
export function useWizardCall({ onEvent } = {}) {
  const [calling, setCalling] = useState(false);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState(null);
  const [connectionState, setConnectionState] = useState("idle"); // idle | connecting | ringing | connected
  const videoRef = useRef(null);
  const clientRef = useRef(null);
  const sessionRef = useRef(null);

  const startCall = useCallback(async () => {
    setCalling(true);
    setError(null);
    setConnectionState("connecting");

    try {
      // 1. Verify session
      const sessionRes = await fetch("/api/auth/session");
      if (!sessionRes.ok) {
        throw new Error("Not authenticated");
      }

      // 2. Get Fabric token
      const tokenRes = await fetch("/api/signalwire/widget-token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subscriberReference: "sally_sales_default_user" }),
      });

      if (!tokenRes.ok) {
        const err = await tokenRes.json();
        throw new Error(err.error || "Failed to get token");
      }

      const { token } = await tokenRes.json();

      // 3. Import and create SignalWire client
      const SignalWireModule = await import("@signalwire/js");
      const SignalWire =
        SignalWireModule.SignalWire || SignalWireModule.default || SignalWireModule;

      const client = await SignalWire({
        token,
        logLevel: "info",
      });
      clientRef.current = client;

      // 4. Listen for user events (wizard SWAIG events)
      client.on("user_event", (params) => {
        const eventData = params?.event || params;
        if (onEvent) onEvent(eventData);
      });

      setConnectionState("ringing");

      // 5. Dial the wizard
      const session = await client.dial({
        to: "/public/wizard-agent",
        audio: true,
        video: false,
        rootElement: videoRef.current || undefined,
      });
      sessionRef.current = session;

      // 6. Session events
      session.on("call.joined", () => {
        setConnected(true);
        setConnectionState("connected");
      });

      const cleanup = () => {
        setConnected(false);
        setCalling(false);
        setConnectionState("idle");
        clientRef.current = null;
        sessionRef.current = null;
      };

      session.on("call.left", cleanup);
      session.on("call.ended", cleanup);
      session.on("call.state", (params) => {
        const state = params?.payload?.call_state || params?.call_state || params?.state;
        if (state === "destroy" || state === "hangup" || state === "ended") {
          cleanup();
        }
      });

      await session.start();
    } catch (err) {
      console.error("[useWizardCall] Error:", err);
      setError(err.message);
      setCalling(false);
      setConnectionState("idle");
    }
  }, [onEvent]);

  const endCall = useCallback(async () => {
    try {
      if (sessionRef.current) {
        await sessionRef.current.hangup();
      }
    } catch (err) {
      console.warn("[useWizardCall] Error ending call:", err);
    }
    setConnected(false);
    setCalling(false);
    setConnectionState("idle");
    clientRef.current = null;
    sessionRef.current = null;
  }, []);

  return {
    startCall,
    endCall,
    calling,
    connected,
    connectionState,
    error,
    videoRef,
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add web/src/app/hooks/useWizardCall.js
git commit -m "feat: add useWizardCall hook with direct SignalWire SDK integration"
```

---

### Task 2: Create WizardBanner Component

**Files:**
- Create: `web/src/components/dashboard/WizardBanner.jsx`

The banner has two states: idle CTA bar and active call banner. It replaces both the old wizard button and WizardPanel.

- [ ] **Step 1: Create the component**

Create `web/src/components/dashboard/WizardBanner.jsx`:

```jsx
"use client";

import { useState, useCallback, useEffect } from "react";
import { Wand2, Phone, PhoneOff, Mic, MicOff, Sparkles, Check, MessageCircle, X } from "lucide-react";
import { useWizardCall } from "@/app/hooks/useWizardCall";
import { WIZARD_EVENTS, parseWizardEvent } from "@/lib/wizardEvents";

/**
 * WizardBanner — Global inline wizard experience.
 *
 * Idle: slim CTA bar — "Setup Wizard — Build agents with your voice [Call Now]"
 * Active: expanded banner with audio controls, questions, and preview cards.
 *
 * Mount in dashboard/layout.jsx so it persists across all pages.
 */
export default function WizardBanner({ onAgentCreated }) {
  const [preview, setPreview] = useState(null);
  const [question, setQuestion] = useState(null);
  const [createdAgent, setCreatedAgent] = useState(null);
  const [readyAgent, setReadyAgent] = useState(null);
  const [dismissed, setDismissed] = useState(false);

  const handleWizardEvent = useCallback((eventData) => {
    const parsed = parseWizardEvent(eventData);
    if (!parsed) return;

    switch (parsed.type) {
      case WIZARD_EVENTS.AGENT_PREVIEW:
        setPreview((prev) => ({ ...prev, ...parsed.data }));
        setQuestion(null);
        break;
      case WIZARD_EVENTS.AGENT_CONFIG_QUESTION:
        setQuestion(parsed.data);
        break;
      case WIZARD_EVENTS.AGENT_CREATED:
        setCreatedAgent(parsed.data.employee);
        setPreview(null);
        setQuestion(null);
        if (onAgentCreated) onAgentCreated(parsed.data.employee);
        break;
      case WIZARD_EVENTS.AGENT_READY:
        setReadyAgent(parsed.data);
        break;
    }
  }, [onAgentCreated]);

  const { startCall, endCall, calling, connected, connectionState, error, videoRef } =
    useWizardCall({ onEvent: handleWizardEvent });

  // Reset wizard state when call ends
  useEffect(() => {
    if (!calling && !connected) {
      // Keep createdAgent/readyAgent visible after call ends
      setPreview(null);
      setQuestion(null);
    }
  }, [calling, connected]);

  const handleEndCall = async () => {
    await endCall();
  };

  const handleDismiss = () => {
    setCreatedAgent(null);
    setReadyAgent(null);
    setDismissed(false);
  };

  const isActive = calling || connected;
  const hasResults = createdAgent || readyAgent;

  // Idle CTA bar
  if (!isActive && !hasResults) {
    return (
      <div className="mx-4 lg:mx-6 mt-4 mb-0">
        <button
          onClick={startCall}
          className="w-full flex items-center justify-between px-4 py-3 bg-gradient-to-r from-purple-600/10 to-indigo-600/10 hover:from-purple-600/20 hover:to-indigo-600/20 border border-purple-500/30 hover:border-purple-500/50 rounded-xl transition-all group"
        >
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-gradient-to-br from-purple-600 to-indigo-600 rounded-lg flex items-center justify-center">
              <Wand2 className="w-4 h-4 text-white" />
            </div>
            <div className="text-left">
              <span className="font-medium text-purple-300 group-hover:text-purple-200">Setup Wizard</span>
              <span className="text-gray-500 dark:text-gray-400 mx-2">—</span>
              <span className="text-sm text-gray-500 dark:text-gray-400">Build agents with your voice</span>
            </div>
          </div>
          <div className="flex items-center gap-2 px-3 py-1.5 bg-purple-600 hover:bg-purple-500 rounded-lg transition-colors">
            <Phone className="w-3.5 h-3.5 text-white" />
            <span className="text-sm font-medium text-white">Call Now</span>
          </div>
        </button>
      </div>
    );
  }

  // Active banner or results
  return (
    <div className="mx-4 lg:mx-6 mt-4 mb-0">
      <div className="bg-gradient-to-r from-purple-900/30 to-indigo-900/30 border border-purple-500/30 rounded-xl overflow-hidden">
        {/* Banner header */}
        <div className="flex items-center gap-4 p-4">
          {/* Left: Audio/connection area */}
          <div className="flex items-center gap-3 shrink-0">
            <div
              ref={videoRef}
              className="w-12 h-12 bg-gradient-to-br from-purple-600 to-indigo-600 rounded-lg flex items-center justify-center"
            >
              <Wand2 className="w-5 h-5 text-white" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-medium text-purple-300 text-sm">Setup Wizard</span>
                {isActive && (
                  <span className="flex items-center gap-1 text-xs">
                    {connectionState === "connecting" && (
                      <span className="text-yellow-400">Connecting...</span>
                    )}
                    {connectionState === "ringing" && (
                      <span className="text-yellow-400">Ringing...</span>
                    )}
                    {connectionState === "connected" && (
                      <>
                        <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
                        <span className="text-green-400">Live</span>
                      </>
                    )}
                  </span>
                )}
              </div>
              {error && <p className="text-xs text-red-400 mt-0.5">{error}</p>}
            </div>
          </div>

          {/* Center: Question / Preview / Created */}
          <div className="flex-1 min-w-0">
            {/* Question overlay */}
            {question && (
              <div>
                <p className="text-sm text-white font-medium mb-2">
                  <MessageCircle className="w-3.5 h-3.5 inline mr-1.5 text-purple-400" />
                  {question.question}
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {question.options?.map((option, i) => (
                    <span
                      key={i}
                      className="px-2.5 py-1 bg-purple-600/30 border border-purple-500/40 rounded-lg text-xs text-purple-200"
                    >
                      {option}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Preview card */}
            {preview && !question && (
              <div className="flex items-center gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-white text-sm">{preview.name || "New Agent"}</span>
                    <span className="px-1.5 py-0.5 bg-yellow-500/20 text-yellow-300 text-[10px] rounded-full border border-yellow-500/30">
                      Preview
                    </span>
                  </div>
                  <p className="text-xs text-gray-400 truncate">{preview.role || "Assistant"}</p>
                </div>
                {preview.functions?.length > 0 && (
                  <div className="flex flex-wrap gap-1 shrink-0">
                    {preview.functions.slice(0, 3).map((fn) => (
                      <span key={fn} className="px-1.5 py-0.5 bg-blue-500/20 text-blue-300 text-[10px] rounded-full border border-blue-500/30">
                        {fn.replace(/_/g, " ")}
                      </span>
                    ))}
                    {preview.functions.length > 3 && (
                      <span className="text-[10px] text-gray-500">+{preview.functions.length - 3}</span>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Agent created */}
            {createdAgent && !preview && !question && (
              <div className="flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-green-400 shrink-0" />
                <span className="text-sm text-green-300 font-medium">Created: {createdAgent.name}</span>
                <span className="text-xs text-gray-400">{createdAgent.role}</span>
                {readyAgent && (
                  <span className="flex items-center gap-1 text-xs text-green-400 ml-2">
                    <Check className="w-3 h-3" />
                    Ready
                  </span>
                )}
              </div>
            )}

            {/* Idle state during active call (no events yet) */}
            {isActive && !question && !preview && !createdAgent && (
              <p className="text-sm text-gray-400">Speak to the wizard to start building your agent...</p>
            )}
          </div>

          {/* Right: Call controls */}
          <div className="flex items-center gap-2 shrink-0">
            {isActive && (
              <button
                onClick={handleEndCall}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-red-600/80 hover:bg-red-600 rounded-lg transition-colors"
              >
                <PhoneOff className="w-3.5 h-3.5 text-white" />
                <span className="text-xs font-medium text-white">End</span>
              </button>
            )}
            {hasResults && !isActive && (
              <button
                onClick={handleDismiss}
                className="p-1.5 text-gray-500 hover:text-gray-300 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add web/src/components/dashboard/WizardBanner.jsx
git commit -m "feat: add WizardBanner component with inline call experience"
```

---

### Task 3: Mount WizardBanner in Dashboard Layout

**Files:**
- Modify: `web/src/app/dashboard/layout.jsx`

Add WizardBanner between the header and the page content so it persists across all pages.

- [ ] **Step 1: Add import to layout.jsx**

Add at the top of `web/src/app/dashboard/layout.jsx` with the other imports:

```javascript
import WizardBanner from "@/components/dashboard/WizardBanner";
```

- [ ] **Step 2: Add WizardBanner between header and main content**

In `web/src/app/dashboard/layout.jsx`, find this section (around line 222-226):

```jsx
        </header>

        {/* Page Content */}
        <main className="p-4 lg:p-6">
          {children}
        </main>
```

Replace with:

```jsx
        </header>

        {/* Wizard Banner — persists across all pages */}
        <WizardBanner />

        {/* Page Content */}
        <main className="p-4 lg:p-6">
          {children}
        </main>
```

- [ ] **Step 3: Commit**

```bash
git add web/src/app/dashboard/layout.jsx
git commit -m "feat: mount WizardBanner globally in dashboard layout"
```

---

### Task 4: Remove Old Wizard Button and Panel from Dashboard Page

**Files:**
- Modify: `web/src/app/dashboard/page.jsx`

Remove the old wizard button, WizardPanel, useCallWidget import, and related state/handlers.

- [ ] **Step 1: Remove wizard-related imports**

In `web/src/app/dashboard/page.jsx`, remove these imports:
- `import WizardPanel from "@/components/dashboard/WizardPanel";`
- `import { useCallWidget } from "@/app/hooks/useCallWidget";`
- `Wand2` from the lucide-react import (if only used for wizard)

- [ ] **Step 2: Remove wizard state and handlers**

Remove these from the component body:
- `const { initiateCall, calling: wizardCalling } = useCallWidget();`
- `const [wizardActive, setWizardActive] = useState(false);`
- `const handleCallWizard = async () => { ... };`
- `const handleAgentCreated = (employee) => { ... };`
- The `useEffect` for `wizard-event` listener

- [ ] **Step 3: Remove wizard button JSX**

Remove the `<div className="mt-4">` block containing the wizard button (lines ~219-231).

- [ ] **Step 4: Remove WizardPanel JSX**

Remove the `<WizardPanel wizardActive={wizardActive} onAgentCreated={handleAgentCreated} />` element.

- [ ] **Step 5: Verify the page still renders**

Run: `cd web && npm run dev`
Check that `http://localhost:5001/dashboard` renders without errors.

- [ ] **Step 6: Commit**

```bash
git add web/src/app/dashboard/page.jsx
git commit -m "refactor: remove old popup wizard button and panel from dashboard page"
```

---

### Task 5: WizardBanner Tests

**Files:**
- Create: `web/src/components/dashboard/__tests__/WizardBanner.test.jsx`

- [ ] **Step 1: Create the test file**

Create `web/src/components/dashboard/__tests__/WizardBanner.test.jsx`:

```jsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

// Mock the useWizardCall hook
const mockStartCall = vi.fn();
const mockEndCall = vi.fn();
vi.mock("@/app/hooks/useWizardCall", () => ({
  useWizardCall: ({ onEvent } = {}) => {
    // Expose onEvent so tests can simulate wizard events
    window.__testWizardOnEvent = onEvent;
    return {
      startCall: mockStartCall,
      endCall: mockEndCall,
      calling: window.__testWizardCalling || false,
      connected: window.__testWizardConnected || false,
      connectionState: window.__testWizardConnectionState || "idle",
      error: window.__testWizardError || null,
      videoRef: { current: null },
    };
  },
}));

import WizardBanner from "../WizardBanner";

describe("WizardBanner", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.__testWizardCalling = false;
    window.__testWizardConnected = false;
    window.__testWizardConnectionState = "idle";
    window.__testWizardError = null;
  });

  it("shows idle CTA bar with Call Now button", () => {
    render(<WizardBanner />);
    expect(screen.getByText("Setup Wizard")).toBeDefined();
    expect(screen.getByText("Call Now")).toBeDefined();
    expect(screen.getByText("Build agents with your voice")).toBeDefined();
  });

  it("calls startCall when Call Now is clicked", () => {
    render(<WizardBanner />);
    fireEvent.click(screen.getByText("Call Now").closest("button"));
    expect(mockStartCall).toHaveBeenCalled();
  });

  it("shows connecting state", () => {
    window.__testWizardCalling = true;
    window.__testWizardConnectionState = "connecting";
    render(<WizardBanner />);
    expect(screen.getByText("Connecting...")).toBeDefined();
    expect(screen.getByText("End")).toBeDefined();
  });

  it("shows connected state with Live indicator", () => {
    window.__testWizardCalling = true;
    window.__testWizardConnected = true;
    window.__testWizardConnectionState = "connected";
    render(<WizardBanner />);
    expect(screen.getByText("Live")).toBeDefined();
  });

  it("shows question when agent_config_question event fires", () => {
    window.__testWizardCalling = true;
    window.__testWizardConnected = true;
    window.__testWizardConnectionState = "connected";
    const { rerender } = render(<WizardBanner />);

    window.__testWizardOnEvent({
      type: "agent_config_question",
      question: "What should it do?",
      options: ["Support", "Sales"],
    });
    rerender(<WizardBanner />);

    expect(screen.getByText("What should it do?")).toBeDefined();
    expect(screen.getByText("Support")).toBeDefined();
    expect(screen.getByText("Sales")).toBeDefined();
  });

  it("shows agent created confirmation", () => {
    window.__testWizardCalling = true;
    window.__testWizardConnected = true;
    window.__testWizardConnectionState = "connected";
    const onCreated = vi.fn();
    const { rerender } = render(<WizardBanner onAgentCreated={onCreated} />);

    window.__testWizardOnEvent({
      type: "agent_created",
      employee: { name: "Test Agent", role: "Support", id: "abc" },
    });
    rerender(<WizardBanner onAgentCreated={onCreated} />);

    expect(screen.getByText(/Created: Test Agent/)).toBeDefined();
    expect(onCreated).toHaveBeenCalledWith({ name: "Test Agent", role: "Support", id: "abc" });
  });
});
```

- [ ] **Step 2: Run tests**

Run: `cd web && npx vitest run src/components/dashboard/__tests__/WizardBanner.test.jsx`
Expected: All tests pass

- [ ] **Step 3: Commit**

```bash
git add web/src/components/dashboard/__tests__/WizardBanner.test.jsx
git commit -m "test: add WizardBanner component tests"
```

---

## Phase B: RAG & Agent Quality

### Task 6: Fix Tool-Name Collision for Multiple KB Documents

**Files:**
- Modify: `agent/main.py` — `_configure_functions()` method (lines 197-236)

- [ ] **Step 1: Fix the datasphere skill registration**

In `agent/main.py`, find `_configure_functions()` (line 197). Replace the datasphere skill loop (lines 209-221):

```python
            if documents and space_name and project_id and token:
                for doc in documents:
                    doc_id = doc.get('document_id', '') if isinstance(doc, dict) else doc
                    if doc_id:
                        self.add_skill("datasphere_serverless", {
                            "space_name": space_name,
                            "project_id": project_id,
                            "token": token,
                            "document_id": doc_id,
                            "count": 3,
                            "distance": 5.0
                        })
                        logger.info(f"  Added DataSphere skill for doc: {doc_id}")
```

With:

```python
            if documents and space_name and project_id and token:
                doc_descriptions = []
                for doc in documents:
                    doc_id = doc.get('document_id', '') if isinstance(doc, dict) else doc
                    doc_name = doc.get('name', doc_id[:8]) if isinstance(doc, dict) else doc_id[:8]
                    doc_desc = doc.get('description', '') if isinstance(doc, dict) else ''
                    doc_distance = doc.get('distance', 3.0) if isinstance(doc, dict) else 3.0

                    if doc_id:
                        tool_name = f"search_{doc_name.lower().replace(' ', '_').replace('-', '_')[:20]}"
                        self.add_skill("datasphere_serverless", {
                            "space_name": space_name,
                            "project_id": project_id,
                            "token": token,
                            "document_id": doc_id,
                            "count": 3,
                            "distance": doc_distance,
                            "tool_name": tool_name,
                            "description": doc_desc or f"Search the {doc_name} knowledge base",
                            "swaig_fields": {
                                "fillers": {
                                    "en-US": [
                                        "Let me check our documentation...",
                                        "Searching our knowledge base...",
                                        "Looking that up for you..."
                                    ]
                                }
                            }
                        })
                        doc_descriptions.append(f"- {tool_name}: {doc_desc or doc_name}")
                        logger.info(f"  Added DataSphere skill '{tool_name}' for doc: {doc_id} (distance={doc_distance})")

                # Add routing guidance if multiple docs
                if len(doc_descriptions) > 1:
                    routing = "You have access to these knowledge bases:\n" + "\n".join(doc_descriptions)
                    routing += "\nChoose the most relevant one based on the caller's question."
                    self.add_pom_section("Knowledge Base Routing", body=routing)
```

- [ ] **Step 2: Fix silent credential failure — surface knowledge_status**

Replace the `else` block (lines 222-226):

```python
            else:
                if not documents:
                    logger.info(f"  search_knowledge enabled but no documents uploaded")
                else:
                    logger.warning(f"  search_knowledge enabled but missing DataSphere credentials")
```

With:

```python
            else:
                if not documents:
                    logger.info(f"  search_knowledge enabled but no documents uploaded")
                    self.employee_config['knowledge_status'] = 'no_documents'
                else:
                    missing = []
                    if not space_name: missing.append('space_name')
                    if not project_id: missing.append('project_id')
                    if not token: missing.append('token')
                    logger.warning(f"  search_knowledge enabled but missing: {', '.join(missing)}")
                    self.employee_config['knowledge_status'] = 'misconfigured'
                    self.employee_config['knowledge_error'] = f"Missing credentials: {', '.join(missing)}"
```

- [ ] **Step 3: Commit**

```bash
git add agent/main.py
git commit -m "fix: RAG tool-name collision, distance threshold, credential visibility, voice fillers"
```

---

### Task 7: Validate document_id at Create-Time

**Files:**
- Modify: `agent/main.py` — add validation in `create_employee` endpoint

- [ ] **Step 1: Add document validation helper**

Add this function before the `create_employee` endpoint in `agent/main.py`:

```python
def _validate_datasphere_doc(space_name: str, project_id: str, token: str, doc_id: str) -> dict:
    """Validate a DataSphere document_id by making a test query."""
    try:
        import urllib.request
        url = f"https://{space_name}/api/datasphere/documents/search"
        body = json.dumps({
            "document_id": doc_id,
            "query_string": "test",
            "count": 1,
            "distance": 10.0
        }).encode()
        auth = f"{project_id}:{token}"
        import base64
        auth_header = base64.b64encode(auth.encode()).decode()
        req = urllib.request.Request(url, data=body, method='POST', headers={
            'Authorization': f'Basic {auth_header}',
            'Content-Type': 'application/json'
        })
        resp = urllib.request.urlopen(req, timeout=5)
        return {"valid": True}
    except Exception as e:
        return {"valid": False, "error": str(e)}
```

- [ ] **Step 2: Add validation in create_employee**

In the `create_employee` function, after `employee_config` is built but before `employees[employee_id] = employee_config`, add:

```python
        # Validate document IDs if search_knowledge is enabled
        if 'search_knowledge' in employee_config.get('enabled_functions', []):
            docs = employee_config.get('documents', [])
            space = employee_config.get('space_name', '')
            proj = employee_config.get('project_id', '')
            tok = employee_config.get('token', '')
            if docs and space and proj and tok:
                for doc in docs:
                    doc_id = doc.get('document_id', '') if isinstance(doc, dict) else doc
                    if doc_id:
                        result = _validate_datasphere_doc(space, proj, tok, doc_id)
                        if not result['valid']:
                            logger.warning(f"  Document {doc_id} validation failed: {result['error']}")
```

- [ ] **Step 3: Commit**

```bash
git add agent/main.py
git commit -m "feat: validate DataSphere document_id at employee creation time"
```

---

## Phase C: Demo Polish

### Task 8: Skeleton Loaders for Dashboard Stats

**Files:**
- Modify: `web/src/app/dashboard/page.jsx`

- [ ] **Step 1: Add skeleton component and loading state**

In `web/src/app/dashboard/page.jsx`, find the stats rendering section. Add a skeleton loader that shows while `loading` is true. Find where the stats cards are rendered and wrap with a loading check:

```jsx
{loading ? (
  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
    {[...Array(4)].map((_, i) => (
      <div key={i} className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 p-6">
        <div className="animate-pulse">
          <div className="w-10 h-10 bg-gray-200 dark:bg-gray-700 rounded-lg mb-4"></div>
          <div className="h-8 bg-gray-200 dark:bg-gray-700 rounded w-16 mb-2"></div>
          <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-24"></div>
        </div>
      </div>
    ))}
  </div>
) : (
  /* existing stats cards */
)}
```

- [ ] **Step 2: Commit**

```bash
git add web/src/app/dashboard/page.jsx
git commit -m "feat: add skeleton loaders for dashboard stats during fetch"
```

---

### Task 9: Error Recovery Banner

**Files:**
- Modify: `web/src/app/dashboard/layout.jsx`

- [ ] **Step 1: Add backend health check and error banner**

In `web/src/app/dashboard/layout.jsx`, add state and a health check effect inside the component:

```javascript
const [backendOnline, setBackendOnline] = useState(true);

useEffect(() => {
  const checkBackend = async () => {
    try {
      const res = await fetch("/api/credentials");
      setBackendOnline(res.ok);
    } catch {
      setBackendOnline(false);
    }
  };
  checkBackend();
  const interval = setInterval(checkBackend, 30000);
  return () => clearInterval(interval);
}, []);
```

Then add a banner between the header and WizardBanner:

```jsx
        </header>

        {/* Backend offline banner */}
        {!backendOnline && (
          <div className="mx-4 lg:mx-6 mt-4 mb-0 px-4 py-3 bg-red-900/20 border border-red-500/30 rounded-xl flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-red-500" />
              <span className="text-sm text-red-300 font-medium">Agent backend offline</span>
            </div>
            <button
              onClick={async () => {
                try {
                  const res = await fetch("/api/credentials");
                  setBackendOnline(res.ok);
                } catch { setBackendOnline(false); }
              }}
              className="px-3 py-1 bg-red-600/30 hover:bg-red-600/50 text-red-300 text-xs rounded-lg transition-colors"
            >
              Retry
            </button>
          </div>
        )}

        {/* Wizard Banner */}
        <WizardBanner />
```

- [ ] **Step 2: Commit**

```bash
git add web/src/app/dashboard/layout.jsx
git commit -m "feat: add backend health check and offline error banner"
```

---

### Task 10: Agent Creation Animation on Employees Page

**Files:**
- Modify: `web/src/app/dashboard/employees/page.jsx`

- [ ] **Step 1: Add event listener for agent_created and CSS animation**

In the employees page component, add a listener for wizard events that refreshes the employee list with an animation class:

```javascript
// Inside the component
const [newAgentId, setNewAgentId] = useState(null);

useEffect(() => {
  const handleWizardEvent = (event) => {
    const detail = event?.detail || event;
    if (detail?.type === 'agent_created' && detail?.employee?.id) {
      setNewAgentId(detail.employee.id);
      // Refresh employee list
      loadEmployees();
      // Clear animation after 2 seconds
      setTimeout(() => setNewAgentId(null), 2000);
    }
  };
  window.addEventListener("wizard-event", handleWizardEvent);
  return () => window.removeEventListener("wizard-event", handleWizardEvent);
}, []);
```

Then on each employee card element, add a conditional animation class:

```jsx
className={`... ${employee.id === newAgentId ? 'animate-pulse ring-2 ring-purple-500 ring-opacity-50' : ''}`}
```

- [ ] **Step 2: Commit**

```bash
git add web/src/app/dashboard/employees/page.jsx
git commit -m "feat: add agent creation highlight animation on employees page"
```

---

## Phase D: Test Coverage & Documentation

### Task 11: Agent CRUD API Tests

**Files:**
- Create: `web/src/app/api/agents/__tests__/route.test.js`

- [ ] **Step 1: Create the test file**

Create `web/src/app/api/agents/__tests__/route.test.js`:

```javascript
// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock dependencies
vi.mock("@/lib/db", () => ({
  getEmployeesByProject: vi.fn(() => []),
  getEmployeeById: vi.fn(),
  upsertEmployee: vi.fn(),
  deleteEmployee: vi.fn(),
  employeeRowToJson: vi.fn((row) => ({ id: row.id, name: row.name })),
}));

vi.mock("@/lib/session", () => ({
  getSessionFromRequest: vi.fn(() => ({
    projectId: "test-project",
    spaceUrl: "test.signalwire.com",
  })),
}));

vi.mock("@/lib/db", async () => {
  return {
    getUserByProjectId: vi.fn(() => ({
      project_id: "test-project",
      space_url: "test.signalwire.com",
      api_token: "test-token",
      subscriber_id: null,
      subscriber_data: null,
    })),
    getEmployeesByProject: vi.fn(() => [
      { id: "emp1", name: "Agent One", status: "active" },
    ]),
    getEmployeeById: vi.fn((id) =>
      id === "emp1"
        ? { id: "emp1", name: "Agent One", status: "active", enabled_functions: "[]" }
        : null
    ),
    upsertEmployee: vi.fn(),
    deleteEmployee: vi.fn(),
    employeeRowToJson: vi.fn((row) => row ? { id: row.id, name: row.name } : null),
  };
});

import { getEmployeesByProject, getEmployeeById, upsertEmployee, deleteEmployee } from "@/lib/db";

describe("Agent CRUD API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ success: true }) }));
  });

  it("validates that agent schema module exports correctly", async () => {
    const { validateAgentConfig, AVAILABLE_FUNCTIONS } = await import("@/lib/agentSchema");
    expect(validateAgentConfig).toBeDefined();
    expect(AVAILABLE_FUNCTIONS).toHaveLength(7);
  });

  it("validates agent config rejects empty name", async () => {
    const { validateAgentConfig } = await import("@/lib/agentSchema");
    const result = validateAgentConfig({ prompt: "test" });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("name is required");
  });

  it("validates agent config accepts valid config", async () => {
    const { validateAgentConfig } = await import("@/lib/agentSchema");
    const result = validateAgentConfig({ name: "Test", prompt: "Do things" });
    expect(result.valid).toBe(true);
  });

  it("converts config to backend payload format", async () => {
    const { configToBackendPayload } = await import("@/lib/agentSchema");
    const payload = configToBackendPayload(
      { name: "Bot", prompt: "Help", functions: ["end_call"], businessHours: { start: 10, end: 17, days: [1, 2, 3] } },
      { id: "x", projectId: "p" }
    );
    expect(payload.enabled_functions).toEqual(["end_call"]);
    expect(payload.business_hours_start).toBe(10);
    expect(payload.id).toBe("x");
  });
});
```

- [ ] **Step 2: Run tests**

Run: `cd web && npx vitest run src/app/api/agents/__tests__/route.test.js`
Expected: All tests pass

- [ ] **Step 3: Commit**

```bash
git add web/src/app/api/agents/__tests__/route.test.js
git commit -m "test: add agent CRUD API tests"
```

---

### Task 12: Wizard Flow Integration Test

**Files:**
- Create: `web/src/components/dashboard/__tests__/wizard-flow.test.jsx`

- [ ] **Step 1: Create integration test**

Create `web/src/components/dashboard/__tests__/wizard-flow.test.jsx`:

```jsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, act } from "@testing-library/react";
import WizardBanner from "../WizardBanner";

// Mock useWizardCall to expose onEvent
let capturedOnEvent;
vi.mock("@/app/hooks/useWizardCall", () => ({
  useWizardCall: ({ onEvent } = {}) => {
    capturedOnEvent = onEvent;
    return {
      startCall: vi.fn(),
      endCall: vi.fn(),
      calling: true,
      connected: true,
      connectionState: "connected",
      error: null,
      videoRef: { current: null },
    };
  },
}));

describe("Wizard Flow Integration", () => {
  it("handles full wizard flow: question → preview → created → ready", () => {
    const onCreated = vi.fn();
    const { rerender } = render(<WizardBanner onAgentCreated={onCreated} />);

    // Step 1: Wizard asks a question
    act(() => {
      capturedOnEvent({ type: "agent_config_question", question: "What kind of agent?", options: ["Support", "Sales"], field: "role" });
    });
    rerender(<WizardBanner onAgentCreated={onCreated} />);
    expect(screen.getByText("What kind of agent?")).toBeDefined();
    expect(screen.getByText("Support")).toBeDefined();

    // Step 2: Wizard shows preview
    act(() => {
      capturedOnEvent({ type: "agent_preview", name: "Support Bot", role: "Customer Support", voice: "openai.nova", functions: ["transfer_to_human", "end_call"] });
    });
    rerender(<WizardBanner onAgentCreated={onCreated} />);
    expect(screen.getByText("Support Bot")).toBeDefined();
    expect(screen.getByText("Preview")).toBeDefined();

    // Step 3: Agent created
    act(() => {
      capturedOnEvent({ type: "agent_created", employee: { name: "Support Bot", role: "Customer Support", id: "abc123" } });
    });
    rerender(<WizardBanner onAgentCreated={onCreated} />);
    expect(screen.getByText(/Created: Support Bot/)).toBeDefined();
    expect(onCreated).toHaveBeenCalledWith({ name: "Support Bot", role: "Customer Support", id: "abc123" });

    // Step 4: Agent ready
    act(() => {
      capturedOnEvent({ type: "agent_ready", employee_id: "abc123", swml_route: "/swml/abc123" });
    });
    rerender(<WizardBanner onAgentCreated={onCreated} />);
    expect(screen.getByText("Ready")).toBeDefined();
  });
});
```

- [ ] **Step 2: Run tests**

Run: `cd web && npx vitest run src/components/dashboard/__tests__/wizard-flow.test.jsx`
Expected: All tests pass

- [ ] **Step 3: Commit**

```bash
git add web/src/components/dashboard/__tests__/wizard-flow.test.jsx
git commit -m "test: add wizard flow integration test covering full event sequence"
```

---

### Task 13: Demo Walkthrough Script

**Files:**
- Create: `docs/DEMO_SCRIPT.md`

- [ ] **Step 1: Create the demo script**

Create `docs/DEMO_SCRIPT.md`:

```markdown
# Sally Sales — Demo Walkthrough

## Prerequisites

1. **Python agent running:**
   ```bash
   cd agent && python3 main.py
   ```
   Verify: `curl http://localhost:8000/health`

2. **ngrok tunnel active:**
   ```bash
   ngrok http 8000
   ```
   Note the HTTPS URL.

3. **Web frontend running:**
   ```bash
   cd web && npm run dev
   ```
   Open `http://localhost:5001`

## Demo Flow

### 1. Login (30 seconds)
- Open the app in Chrome
- Credentials are pre-filled — click **Connect**
- You'll land on the dashboard

### 2. Seed Demo Data (15 seconds)
- Scroll to bottom of dashboard
- Click **Demo Tools** → **Seed Example Data**
- Dashboard populates with 2 agents and 3 call logs

### 3. Show the Dashboard (30 seconds)
- Point out: employee count, call stats, recent activity
- Navigate to **Employees** — show the pre-built agents
- Navigate to **Call Logs** — show AI-generated summaries, sentiment analysis

### 4. Call the Setup Wizard (2-3 minutes) — THE MAIN EVENT
- The purple **Setup Wizard** banner is at the top of every page
- Click **Call Now**
- Allow microphone access when prompted
- The banner expands — you'll see "Connecting..." → "Live"

**Say to the wizard:**
> "Build me a customer support agent for a software company. It should handle bug reports and billing questions."

- Watch the banner update with questions and options
- The wizard will show a preview card
- Say: "Add email follow-ups and make the voice more professional"
- Preview updates live
- Say: "Looks good, create it"
- Watch the **Employees** page — the new agent appears with a highlight animation

### 5. Call the New Agent (1 minute)
- Navigate to **Employees**
- Click the call button on the newly created agent
- Have a brief conversation to demonstrate it works
- End the call

### 6. Show Call Analytics (30 seconds)
- Navigate to **Call Logs**
- Click **Refresh** — the new call appears with AI summary
- Expand it to show transcript, sentiment, latency metrics

## Reset Between Demos

Dashboard → Demo Tools → **Reset Demo Data** → **Seed Example Data**

## Troubleshooting

- **No audio:** Check Chrome microphone permissions (address bar → camera icon)
- **Call fails:** Verify ngrok is running and Python agent detected it (check agent logs for "Auto-detected ngrok URL")
- **Wizard not responding:** Check Python agent logs for errors. The wizard is at `/swml/wizard`
```

- [ ] **Step 2: Commit**

```bash
git add docs/DEMO_SCRIPT.md
git commit -m "docs: add demo walkthrough script with step-by-step instructions"
```

---

### Task 14: Run Full Test Suite and Final Cleanup

**Files:** None (verification only)

- [ ] **Step 1: Run all tests**

Run: `cd web && npm test`
Expected: All test suites pass

- [ ] **Step 2: Fix any failures**

If tests fail, fix them before proceeding.

- [ ] **Step 3: Commit if any fixes needed**

```bash
git add -A
git commit -m "fix: resolve test failures from full suite run"
```

---

## Summary

| Phase | Tasks | Key Deliverable |
|-------|-------|----------------|
| A: Wizard UX | Tasks 1-5 | Inline banner with SDK-direct call, no popup |
| B: RAG Quality | Tasks 6-7 | Fixed tool collision, distance, credentials, fillers |
| C: Demo Polish | Tasks 8-10 | Skeleton loaders, error banner, creation animation |
| D: Tests & Docs | Tasks 11-14 | Agent tests, wizard flow test, demo script |

**Total: 14 tasks**
