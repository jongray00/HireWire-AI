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
