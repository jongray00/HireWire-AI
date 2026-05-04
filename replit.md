# Sally Sales - AI Voice Agent Demo

## Project Overview

Sally Sales is a SignalWire AI voice application demonstrating browser-to-agent WebRTC calling with dynamic SWML (SignalWire Markup Language) configuration. This is a complete full-stack application that allows users to create custom AI phone agents using natural language prompts.

**Status**: ✅ Fully configured and running on Replit

**Last Updated**: October 23, 2025

## Architecture

### Frontend (React + Vite)
- **Location**: `/web`
- **Port**: 5000 (0.0.0.0)
- **Technology**: React Router 7, Vite, Tailwind CSS
- **Purpose**: Web UI for configuring and calling the AI agent via WebRTC

### Backend (Python Agent)
- **Location**: `/agent`
- **Port**: 8000 (0.0.0.0)
- **Technology**: SignalWire Agents SDK, FastAPI, Uvicorn
- **Purpose**: Serves dynamic SWML configuration and handles SWAIG function calls

## Project Structure

```
sally-sales/
├── agent/                      # Python backend
│   ├── main.py                # AI agent implementation
│   └── requirements.txt       # Python dependencies
├── web/                       # React frontend
│   ├── src/
│   │   ├── app/              # React Router app
│   │   │   ├── demo-ivr/     # Main demo page
│   │   │   └── api/          # API routes
│   │   └── components/       # React components
│   └── package.json
├── .gitignore
└── replit.md                  # This file
```

## How It Works

1. **User configures agent** - Enter a natural language prompt describing the IVR menu
2. **Backend generates SWML** - Python agent creates dynamic configuration
3. **User calls agent** - Browser connects via WebRTC to SignalWire
4. **Real-time interaction** - AI handles calls with function calling and live events

## Running Locally

The project is already configured to run in Replit. Both workflows start automatically:

### Workflows
- **Frontend**: `cd web && npm run dev` (port 5000)
- **Backend**: `cd agent && python main.py` (port 8000)

### Manual Start
```bash
# Backend
cd agent
python main.py

# Frontend (in another terminal)
cd web
npm run dev
```

## Configuration Changes for Replit

### Port Changes
- **Frontend**: Changed from port 4000 → 5000 (Replit requirement)
- **Backend**: Changed from port 3030 → 8000 (allowed port)
- **Updated files**:
  - `web/vite.config.ts` - port 5000, host 0.0.0.0, allowedHosts: true
  - `agent/main.py` - host 0.0.0.0, port 8000

### Environment Setup
The application requires SignalWire credentials:
- **Space URL**: Your SignalWire space (e.g., demo.signalwire.com)
- **Project ID**: Found in SignalWire dashboard
- **API Token**: API access token from SignalWire

## Key Features

### AI Voice Agent
- Custom personalities via natural language prompts
- Speech-to-text and text-to-speech
- Real-time function calling (SWAIG)
- Live transcript streaming

### WebRTC Calling
- Browser-to-agent calls (no phone number needed)
- Real-time audio communication
- Live event streaming to UI

### Available Functions
- `route_to_order` - Route to order department
- `route_to_schedule` - Route to scheduling
- `route_to_support` - Route to support
- `demo_order_item` - Add items to cart (demo)
- `demo_get_status` - Check order status (demo)
- `transfer_call` - Transfer to human

## Dependencies

### Python (Backend)
- signalwire-agents
- fastapi
- uvicorn[standard]
- python-dotenv

### Node.js (Frontend)
- react, react-dom
- react-router
- @signalwire/js
- tailwindcss
- vite

## Data Storage

### SQLite Database
The web backend uses a single SQLite database (initialized in `web/src/lib/db.ts`).

- **Default path (development)**: `web/data/sally_sales.db` (resolved as `<cwd>/data/sally_sales.db` when the dev server runs from `web/`).
- **Override**: set the `DATABASE_PATH` environment variable to an absolute path. Both the Node web server (`web/src/lib/db.ts`) and the Python agent (`agent/main.py`) read this variable so they share the same DB file.
- **Never committed to git**: the runtime DB files (`*.db`, `*.db-shm`, `*.db-wal`) and the `web/data/` directory are excluded via `.gitignore` and `web/.gitignore`. Do not check fixtures into these paths — every deploy would otherwise overwrite live data with the seeded copy.
- **Production (VM deployment)**: set `DATABASE_PATH` in the deployment Secrets to a path on the VM's persistent disk that lives **outside** the build/deploy artifact tree (for example `/home/runner/sally-sales-data/sally_sales.db`). The directory is created automatically on first run by `getDb()`. Keeping the file outside `web/` ensures the build step (`cd web && npm run build`) cannot clobber it and that fresh deploys preserve user data.

## Deployment

The project is configured for Replit deployment using the VM target:

```json
{
  "deployment_target": "vm",
  "run": ["bash", "-c", "(cd agent && uvicorn main:agent.app --host 0.0.0.0 --port 8000) & (cd web && npm run dev -- --port 5000 --host 0.0.0.0)"]
}
```

This runs both the backend (using uvicorn) and frontend simultaneously. The backend binds to 0.0.0.0:8000 and the frontend to 0.0.0.0:5000.

### Security Notes
- The `web/agent-credentials.json` file is auto-generated by the backend and contains temporary credentials
- This file is excluded from git via `.gitignore`
- Never commit credentials to version control

## API Endpoints

### Backend (0.0.0.0:8000)
- `GET /swml` - Returns SWML configuration for SignalWire
- `POST /api/update-config` - Update agent configuration from UI
- `GET /api/config` - Get current agent configuration
- `GET /api/agent-info` - Get agent credentials and info
- `POST /api/transcript-event` - Receive live transcript events
- `POST /swaig/{function}` - SWAIG function call endpoints

### Frontend (0.0.0.0:5000)
- `/` - Home page with quick setup guide
- `/demo-ivr` - Main demo interface
- `/api/signalwire/*` - SignalWire API proxy routes

## Development Notes

### Important Configurations
1. **Frontend must bind to 0.0.0.0:5000** - Required for Replit proxy
2. **Backend must bind to 0.0.0.0:8000** - Required for external access via Replit proxy
3. **allowedHosts: true** - Required in vite.config.ts for iframe proxy
4. **CORS enabled** - Backend allows all origins for development

### SignalWire Integration
This app uses:
- **Fabric API** - For subscriber and address management
- **SWML** - Dynamic AI configuration
- **SWAIG** - Function calling for AI agents
- **WebRTC SDK** - Browser calling (@signalwire/js)

## Troubleshooting

### Frontend not loading
- Check that port 5000 is available
- Verify `allowedHosts: true` in vite.config.ts
- Clear browser cache and reload

### Backend not responding
- Check that Python dependencies are installed
- Verify port 8000 is available
- Check backend logs for errors

### WebRTC connection fails
- Verify SignalWire credentials are correct
- Check browser console for errors
- Ensure microphone permissions are granted

## License

MIT

## Credits

Built with:
- SignalWire Agents SDK (Python)
- @signalwire/js (JavaScript/TypeScript)
- React Router 7
- Tailwind CSS
