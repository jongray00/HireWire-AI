# Sally Sales Agent Backend

Python backend for the Sally Sales multi-employee AI voice agent system using the SignalWire Agents SDK.

## Setup

1. Install dependencies:
```bash
pip install -r requirements.txt
```

2. Configure `.env` (optional — ngrok URL is auto-detected):
```bash
cp .env.example .env
# Edit .env if you need to set APP_DOMAIN manually
```

3. Run the agent:
```bash
python main.py
```

The agent runs on `http://localhost:8000`.

## ngrok Auto-Detection

At startup, the backend queries the ngrok local API (`localhost:4040/api/tunnels`) to discover the current public URL. If found, it sets `APP_DOMAIN` automatically. To override, set `APP_DOMAIN` in `.env`.

```bash
# Start ngrok first
ngrok http 8000

# Then start the agent — it will detect the ngrok URL
python main.py
```

## API Endpoints

### Employee Management

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/create-employee` | Create a new virtual employee |
| GET | `/api/list-employees` | List all employees |
| GET | `/api/employee/{id}` | Get employee config |
| PATCH | `/api/employee/{id}` | Update employee config |
| DELETE | `/api/employee/{id}` | Delete an employee |

### SWML

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET/POST | `/swml/{employee_id}` | SWML document (called by SignalWire) |

### Legacy / System

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/update-config` | Legacy: create/update default employee |
| GET | `/api/config` | Legacy: get default config + credentials |
| GET | `/api/agent-info` | System info |
| GET | `/health` | Health check |

## Employee Configuration

When creating an employee, you can specify `enabled_functions` to control which SWAIG tools are available:

```json
{
  "name": "Sales Rep",
  "role": "Sales Representative",
  "enabled_functions": ["transfer_call", "route_to_order"]
}
```

### Available Functions

- `route_to_order` — Route caller to order department
- `route_to_schedule` — Route caller to scheduling
- `route_to_support` — Route caller to customer support
- `transfer_call` — Transfer call to a human representative

## Real-Time Events

The agent sends events via `swml_user_event()`:

- `routing_decision` — When routing to a department
- `transfer_initiated` — When call transfer is initiated

## Call Analytics

After each call, SignalWire sends a post-prompt payload to the frontend's `/api/post-prompt/{employeeId}` endpoint, which stores structured call logs for the dashboard.
