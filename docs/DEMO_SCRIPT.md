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
   Open `http://localhost:5000`

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

- Watch the **Wizard Creation Canvas** open over the dashboard — the wizard's voice drives a 4-checkpoint progression (Identity → Voice → Capabilities → Review) at the top of the panel
- The left column streams the live transcript; the right column populates structured fields and a prompt preview as the wizard collects info
- Say: "Add email follow-ups and make the voice more professional"
- The canvas updates immediately — voice changes, functions list grows
- Say: "Looks good, create it"
- The canvas flips to a celebratory "✨ {name} is ready" state with a "Call your new agent" CTA

### 5. Inspect the Wizard Session (30 seconds)
- End the wizard call
- Navigate to **Call Logs** — the wizard call appears with a 🧙 **Wizard Session** pill and a "→ Built: {name}" link
- Open it — the transcript view shows the full conversation, useful for debugging the wizard's progression

## Reset Between Demos

Dashboard → Demo Tools → **Reset Demo Data** → **Seed Example Data**

## Troubleshooting

- **No audio:** Check Chrome microphone permissions (address bar → camera icon)
- **Call fails:** Verify ngrok is running and Python agent detected it (check agent logs for "Auto-detected ngrok URL")
- **Wizard not responding:** Check Python agent logs for errors. The wizard is at `/swml/wizard`
