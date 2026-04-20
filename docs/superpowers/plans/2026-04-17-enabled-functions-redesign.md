# Enabled Functions Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix all broken SWAIG functions, add knowledge base (DataSphere), email (SendGrid), and customer info capture, persist all actions to DB, and display them in call log detail view.

**Architecture:** Python backend defines SWAIG functions + DataSphere skill. React frontend provides configuration UI (phone picker, knowledge base upload, email settings). Post-prompt handler persists function actions from global_data to a new `call_actions` SQLite table. Call log detail view renders conditional sections per action type.

**Tech Stack:** Python/FastAPI (signalwire-agents SDK, sendgrid), React/Vite (Chakra UI), SQLite (better-sqlite3), SignalWire DataSphere REST API

**Spec:** `docs/superpowers/specs/2026-04-17-enabled-functions-redesign.md`

---

## File Structure

### Files to Create
- `web/src/components/dashboard/PhoneNumberPicker.jsx` — reusable phone number dropdown + custom input
- `web/src/components/dashboard/KnowledgeBaseTab.jsx` — document upload zone + document list
- `web/src/components/dashboard/CallLogDetail.jsx` — expanded call log with conditional action sections
- `web/src/app/api/signalwire/upload-document/route.js` — upload file to DataSphere
- `web/src/app/api/signalwire/delete-document/route.js` — delete document from DataSphere
- `web/src/app/api/signalwire/list-documents/route.js` — list documents for an employee

### Files to Modify
- `web/src/lib/db.ts` — add `call_actions` table, add new employee columns, add query functions
- `agent/main.py` — remove `send_sms`, fix `check_business_hours`, add `collect_customer_info`, `send_email`, `search_knowledge` skill
- `agent/requirements.txt` — add `sendgrid`
- `web/src/app/dashboard/employees/page.jsx` — update AVAILABLE_FUNCTIONS, add phone picker/knowledge base/email/hours config sections
- `web/src/app/dashboard/templates/page.jsx` — update template enabled_functions arrays
- `web/src/app/dashboard/call-logs/page.jsx` — integrate CallLogDetail component
- `web/src/app/api/post-prompt/[[...path]]/route.js` — persist global_data actions to call_actions
- `web/src/app/api/signalwire/create-virtual-employee/route.js` — pass new config fields to backend

---

## Task 1: Database Schema — `call_actions` Table + New Employee Fields

**Files:**
- Modify: `web/src/lib/db.ts:12-107` (schema), `web/src/lib/db.ts:285-355` (query functions)

- [ ] **Step 1: Add `call_actions` table to schema**

In `web/src/lib/db.ts`, after the `sms_logs` table creation (line ~107), add:

```typescript
db.exec(`
  CREATE TABLE IF NOT EXISTS call_actions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    call_id TEXT,
    employee_id TEXT,
    action_type TEXT NOT NULL,
    data TEXT NOT NULL DEFAULT '{}',
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (employee_id) REFERENCES employees(id)
  )
`);
```

- [ ] **Step 2: Add new employee columns**

In `web/src/lib/db.ts`, after the existing table creation statements, add column migrations:

```typescript
// Add new employee config columns (safe to re-run — uses IF NOT EXISTS pattern)
const employeeColumnsToAdd = [
  { name: 'business_hours_start', type: 'INTEGER DEFAULT 9' },
  { name: 'business_hours_end', type: 'INTEGER DEFAULT 18' },
  { name: 'business_days', type: "TEXT DEFAULT '[0,1,2,3,4]'" },
  { name: 'documents', type: "TEXT DEFAULT '[]'" },
  { name: 'email_provider', type: "TEXT DEFAULT ''" },
  { name: 'sendgrid_api_key', type: "TEXT DEFAULT ''" },
  { name: 'email_from_address', type: "TEXT DEFAULT ''" },
  { name: 'email_from_name', type: "TEXT DEFAULT ''" },
];

for (const col of employeeColumnsToAdd) {
  try {
    db.exec(`ALTER TABLE employees ADD COLUMN ${col.name} ${col.type}`);
  } catch (e: any) {
    // Column already exists — ignore
    if (!e.message.includes('duplicate column')) throw e;
  }
}
```

- [ ] **Step 3: Add `call_actions` query functions**

Add these functions after the existing `getCallLogs` function (~line 355):

```typescript
export function insertCallAction(callId: string, employeeId: string, actionType: string, data: object) {
  const stmt = db.prepare(`
    INSERT INTO call_actions (call_id, employee_id, action_type, data)
    VALUES (?, ?, ?, ?)
  `);
  return stmt.run(callId, employeeId, actionType, JSON.stringify(data));
}

export function getCallActions(callId: string) {
  const stmt = db.prepare(`SELECT * FROM call_actions WHERE call_id = ? ORDER BY created_at ASC`);
  const rows = stmt.all(callId) as any[];
  return rows.map(row => ({
    ...row,
    data: JSON.parse(row.data || '{}'),
  }));
}
```

- [ ] **Step 4: Update `upsertEmployee` to handle new fields**

In the `upsertEmployee` function (~line 167-251), add the new columns to both the INSERT and UPDATE portions. Add these to the column list and values:

```typescript
// In the INSERT column list, add:
business_hours_start, business_hours_end, business_days, documents,
email_provider, sendgrid_api_key, email_from_address, email_from_name

// In the VALUES placeholders, add corresponding ?'s
// In the parameter array, add:
emp.businessHoursStart ?? 9,
emp.businessHoursEnd ?? 18,
JSON.stringify(emp.businessDays ?? [0, 1, 2, 3, 4]),
JSON.stringify(emp.documents ?? []),
emp.emailProvider ?? '',
emp.sendgridApiKey ?? '',
emp.emailFromAddress ?? '',
emp.emailFromName ?? '',
```

Update the `employeeRowToJson` serializer (~line 400) to include:

```typescript
businessHoursStart: row.business_hours_start ?? 9,
businessHoursEnd: row.business_hours_end ?? 18,
businessDays: JSON.parse(row.business_days || '[0,1,2,3,4]'),
documents: JSON.parse(row.documents || '[]'),
emailProvider: row.email_provider || '',
sendgridApiKey: row.sendgrid_api_key || '',
emailFromAddress: row.email_from_address || '',
emailFromName: row.email_from_name || '',
```

- [ ] **Step 5: Verify DB changes**

Run the frontend dev server and check that no errors appear on startup. The table and columns should be created automatically.

```bash
curl -s http://localhost:5001/api/post-prompt/logs | python3 -m json.tool | head -5
```

Expected: `{ "success": true, ... }` — no schema errors.

- [ ] **Step 6: Commit**

```bash
git add web/src/lib/db.ts
git commit -m "feat: add call_actions table and new employee config columns"
```

---

## Task 2: Backend — Remove `send_sms`, Add `collect_customer_info`

**Files:**
- Modify: `agent/main.py:474-528` (remove send_sms), `agent/main.py:308-374` (update send_summary_sms description)

- [ ] **Step 1: Remove the `send_sms` function**

Delete the entire `send_sms` SWAIG tool definition in `agent/main.py` (lines 474-528 — the `@AgentBase.tool` decorator through the end of the method).

- [ ] **Step 2: Update `send_summary_sms` description**

In `agent/main.py`, update the `send_summary_sms` tool decorator description (line 310):

```python
@AgentBase.tool(
    name="send_summary_sms",
    description="Send an SMS text message to the caller's phone number. Can send call summaries, confirmations, follow-ups, or any custom message. Ask for their phone number first.",
    parameters={
        "type": "object",
        "properties": {
            "phone_number": {
                "type": "string",
                "description": "The caller's phone number to send the SMS to (E.164 format)"
            },
            "message": {
                "type": "string",
                "description": "The text message to send — can be a call summary, confirmation, or any relevant message"
            },
            "caller_info": {
                "type": "string",
                "description": "Caller name and contact info if provided"
            }
        },
        "required": ["phone_number", "message"]
    }
)
```

Also rename the `summary` parameter to `message` inside the method body. Update:
```python
def send_summary_sms(self, args, raw_data):
    phone_number_raw = args.get("phone_number", "")
    message = args.get("message", "") or args.get("summary", "No message provided")
    caller_info = args.get("caller_info", "")
```

- [ ] **Step 3: Add `collect_customer_info` function**

Add this new SWAIG tool after the `check_business_hours` function:

```python
@AgentBase.tool(
    name="collect_customer_info",
    description="Collect structured customer information during the call. Gather details conversationally — name, email, phone, company, and any notes. Call this once you have collected the relevant details.",
    parameters={
        "type": "object",
        "properties": {
            "name": {
                "type": "string",
                "description": "The customer's full name"
            },
            "email": {
                "type": "string",
                "description": "The customer's email address"
            },
            "phone": {
                "type": "string",
                "description": "The customer's phone number"
            },
            "company": {
                "type": "string",
                "description": "The customer's company or organization"
            },
            "notes": {
                "type": "string",
                "description": "Any additional notes or context from the conversation"
            }
        }
    }
)
def collect_customer_info(self, args, raw_data):
    """Collect and store structured customer information"""
    name = args.get("name", "")
    email = args.get("email", "")
    phone = args.get("phone", "")
    company = args.get("company", "")
    notes = args.get("notes", "")

    collected_fields = []
    if name: collected_fields.append(f"name ({name})")
    if email: collected_fields.append(f"email ({email})")
    if phone: collected_fields.append(f"phone ({phone})")
    if company: collected_fields.append(f"company ({company})")

    logger.info(f"[{self.employee_id}] Customer info collected: {', '.join(collected_fields) or 'no fields'}")

    result = SwaigFunctionResult(
        f"Got it, I've recorded {'your' if name else 'the'} information. Is there anything else I can help with?"
    )
    result.update_global_data({
        "customer_info": {
            "name": name,
            "email": email,
            "phone": phone,
            "company": company,
            "notes": notes[:500]
        }
    })
    return result
```

- [ ] **Step 4: Verify the backend starts cleanly**

```bash
curl -s http://localhost:8000/health | python3 -m json.tool
```

Expected: `{ "status": "healthy", ... }`

- [ ] **Step 5: Commit**

```bash
git add agent/main.py
git commit -m "feat: remove send_sms, update send_summary_sms, add collect_customer_info"
```

---

## Task 3: Backend — Add `send_email` (SendGrid)

**Files:**
- Modify: `agent/main.py` (add send_email function)
- Modify: `agent/requirements.txt` (add sendgrid)

- [ ] **Step 1: Add sendgrid dependency**

In `agent/requirements.txt`, add:

```
sendgrid>=6.10.0
```

Install it:

```bash
cd Sally-Sales/agent && pip install sendgrid>=6.10.0
```

- [ ] **Step 2: Add `send_email` SWAIG function**

Add this after the `collect_customer_info` function in `agent/main.py`:

```python
@AgentBase.tool(
    name="send_email",
    description="Send a follow-up email to the caller. Collects their email address and sends a message with call details, confirmations, or any relevant information.",
    parameters={
        "type": "object",
        "properties": {
            "to_email": {
                "type": "string",
                "description": "The recipient's email address"
            },
            "subject": {
                "type": "string",
                "description": "Email subject line"
            },
            "body": {
                "type": "string",
                "description": "Email body content — include call summary, action items, or relevant details"
            }
        },
        "required": ["to_email", "subject", "body"]
    }
)
def send_email(self, args, raw_data):
    """Send an email via SendGrid"""
    to_email = args.get("to_email", "")
    subject = args.get("subject", "")
    body = args.get("body", "")

    sendgrid_api_key = self.employee_config.get("sendgrid_api_key", "") or os.getenv("SENDGRID_API_KEY", "")
    from_email = self.employee_config.get("email_from_address", "")
    from_name = self.employee_config.get("email_from_name", "") or self.employee_config.get("name", "Agent")

    logger.info(f"[{self.employee_id}] Email requested to {to_email} from {from_email or 'NOT CONFIGURED'}")

    if not to_email or "@" not in to_email:
        return SwaigFunctionResult(
            "I need a valid email address to send to. Could you please provide your email?"
        )

    if not sendgrid_api_key or not from_email:
        logger.warning(f"[{self.employee_id}] Email skipped — SendGrid not configured")
        result = SwaigFunctionResult(
            "Email isn't set up for this agent yet. Let me take a note of your request instead."
        )
        result.update_global_data({
            "email_requested": {
                "to": to_email,
                "subject": subject,
                "body": body[:500],
                "status": "not_configured"
            }
        })
        return result

    try:
        from sendgrid import SendGridAPIClient
        from sendgrid.helpers.mail import Mail

        message = Mail(
            from_email=(from_email, from_name),
            to_emails=to_email,
            subject=subject or f"Follow-up from {from_name}",
            plain_text_content=body
        )

        sg = SendGridAPIClient(sendgrid_api_key)
        response = sg.send(message)

        logger.info(f"[{self.employee_id}] Email sent to {to_email}, status: {response.status_code}")

        result = SwaigFunctionResult(f"I've sent an email to {to_email}.")
        result.update_global_data({
            "email_sent": {
                "to": to_email,
                "subject": subject,
                "status": "sent",
                "status_code": response.status_code
            }
        })
        return result

    except Exception as e:
        logger.error(f"[{self.employee_id}] Email send failed: {e}")
        result = SwaigFunctionResult(
            "I'm sorry, I wasn't able to send the email right now. I've noted your request for our team."
        )
        result.update_global_data({
            "email_requested": {
                "to": to_email,
                "subject": subject,
                "body": body[:500],
                "status": "failed",
                "error": str(e)[:200]
            }
        })
        return result
```

- [ ] **Step 3: Verify backend starts with sendgrid import**

Restart the agent backend and verify:

```bash
curl -s http://localhost:8000/health | python3 -m json.tool
```

Expected: `{ "status": "healthy", ... }`

- [ ] **Step 4: Commit**

```bash
git add agent/main.py agent/requirements.txt
git commit -m "feat: add send_email SWAIG function with SendGrid integration"
```

---

## Task 4: Backend — Configurable Business Hours + DataSphere Skill

**Files:**
- Modify: `agent/main.py:425-447` (check_business_hours), `agent/main.py:64-113` (VirtualEmployeeAgent.__init__)

- [ ] **Step 1: Make `check_business_hours` read from employee config**

Replace the `check_business_hours` method body in `agent/main.py`:

```python
@AgentBase.tool(
    name="check_business_hours",
    description="Check if the business is currently open and provide hours information",
    parameters={
        "type": "object",
        "properties": {}
    }
)
def check_business_hours(self, args, raw_data):
    """Return business hours — uses config or defaults"""
    now = datetime.now()
    hour = now.hour
    weekday = now.weekday()  # 0=Monday, 6=Sunday

    start = self.employee_config.get("business_hours_start", 9)
    end = self.employee_config.get("business_hours_end", 18)
    days = self.employee_config.get("business_days", [0, 1, 2, 3, 4])

    day_names = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
    open_days = [day_names[d] for d in sorted(days)]
    hours_str = f"{start % 12 or 12} {'AM' if start < 12 else 'PM'} to {end % 12 or 12} {'AM' if end < 12 else 'PM'}"

    if weekday in days and start <= hour < end:
        return SwaigFunctionResult(
            f"We are currently open. Our business hours are {open_days[0]} through {open_days[-1]}, {hours_str}."
        )
    else:
        return SwaigFunctionResult(
            f"We are currently closed. Our business hours are {open_days[0]} through {open_days[-1]}, {hours_str}. "
            "I can take a message or schedule a callback for when we reopen."
        )
```

- [ ] **Step 2: Add DataSphere Serverless skill in `_configure_functions`**

Update the `_configure_functions` method to add the DataSphere skill when `search_knowledge` is enabled and documents exist:

```python
def _configure_functions(self):
    """Configure which functions are enabled for this employee"""
    enabled_functions = self.employee_config.get('enabled_functions', [])
    logger.info(f"Employee {self.employee_id} enabled functions: {enabled_functions}")

    # Add DataSphere Serverless skill if search_knowledge is enabled
    if 'search_knowledge' in enabled_functions:
        documents = self.employee_config.get('documents', [])
        space_name = os.getenv('SIGNALWIRE_SPACE', '') or self.employee_config.get('space_name', '')
        project_id = os.getenv('SIGNALWIRE_PROJECT_ID', '') or self.employee_config.get('project_id', '')
        token = os.getenv('SIGNALWIRE_TOKEN', '') or self.employee_config.get('token', '')

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
        else:
            if not documents:
                logger.info(f"  search_knowledge enabled but no documents uploaded")
            else:
                logger.warning(f"  search_knowledge enabled but missing DataSphere credentials")

    # Remove SWAIG tools not in the enabled list
    # Note: search_knowledge is a skill, not a SWAIG tool — skip it in this filter
    swaig_functions = [f for f in enabled_functions if f != 'search_knowledge']
    if enabled_functions:
        all_functions = list(self._tool_registry.get_all_functions().keys())
        for func_name in all_functions:
            if func_name not in swaig_functions:
                self._tool_registry.remove_function(func_name)
                logger.info(f"  Removed function '{func_name}' (not in enabled list)")
```

- [ ] **Step 3: Pass DataSphere credentials through employee creation**

In the `create_employee` endpoint in `agent/main.py` (~line 623), add the new config fields to the employee_config dict:

```python
employee_config = {
    # ... existing fields ...
    "business_hours_start": data.get("business_hours_start", 9),
    "business_hours_end": data.get("business_hours_end", 18),
    "business_days": data.get("business_days", [0, 1, 2, 3, 4]),
    "documents": data.get("documents", []),
    "sendgrid_api_key": data.get("sendgrid_api_key", ""),
    "email_from_address": data.get("email_from_address", ""),
    "email_from_name": data.get("email_from_name", ""),
    "space_name": data.get("space_name", ""),
    "project_id": data.get("project_id", ""),
    "token": data.get("token", ""),
    # ... existing fields ...
}
```

Do the same for the `update_employee` PATCH endpoint (~line 699).

- [ ] **Step 4: Verify backend starts**

```bash
curl -s http://localhost:8000/health | python3 -m json.tool
```

- [ ] **Step 5: Commit**

```bash
git add agent/main.py
git commit -m "feat: configurable business hours, DataSphere serverless skill for knowledge base"
```

---

## Task 5: API — Document Upload, Delete, List Endpoints

**Files:**
- Create: `web/src/app/api/signalwire/upload-document/route.js`
- Create: `web/src/app/api/signalwire/delete-document/route.js`
- Create: `web/src/app/api/signalwire/list-documents/route.js`
- Modify: `web/src/lib/db.ts` (update employee documents array)

- [ ] **Step 1: Create upload-document endpoint**

Create `web/src/app/api/signalwire/upload-document/route.js`:

```javascript
import { getEmployeeById, updateEmployeeDocuments } from '~/lib/db';

export async function POST(request) {
  try {
    const formData = await request.formData();
    const file = formData.get('file');
    const employeeId = formData.get('employeeId');
    const spaceUrl = formData.get('spaceUrl');
    const projectId = formData.get('projectId');
    const apiToken = formData.get('apiToken');

    if (!file || !employeeId || !spaceUrl || !projectId || !apiToken) {
      return Response.json({ success: false, error: 'Missing required fields' }, { status: 400 });
    }

    // Upload to DataSphere REST API
    const dsFormData = new FormData();
    dsFormData.append('file', file);
    dsFormData.append('chunking_strategy', 'paragraph');

    const spaceDomain = spaceUrl.replace(/^https?:\/\//, '').replace(/\/$/, '');
    const dsUrl = `https://${spaceDomain}/api/datasphere/documents`;

    const authHeader = 'Basic ' + Buffer.from(`${projectId}:${apiToken}`).toString('base64');

    const dsResponse = await fetch(dsUrl, {
      method: 'POST',
      headers: { 'Authorization': authHeader },
      body: dsFormData,
    });

    if (!dsResponse.ok) {
      const errText = await dsResponse.text();
      console.error('DataSphere upload failed:', dsResponse.status, errText);
      return Response.json({
        success: false,
        error: `DataSphere upload failed: ${dsResponse.status}`,
      }, { status: 502 });
    }

    const dsResult = await dsResponse.json();
    const documentId = dsResult.document_id || dsResult.id;

    if (!documentId) {
      return Response.json({ success: false, error: 'No document_id returned from DataSphere' }, { status: 502 });
    }

    // Add document to employee's documents array in DB
    const employee = getEmployeeById(employeeId);
    if (!employee) {
      return Response.json({ success: false, error: 'Employee not found' }, { status: 404 });
    }

    const documents = employee.documents || [];
    documents.push({
      document_id: documentId,
      filename: file.name,
      size: file.size,
      uploaded_at: new Date().toISOString(),
    });

    updateEmployeeDocuments(employeeId, documents);

    return Response.json({
      success: true,
      document: {
        document_id: documentId,
        filename: file.name,
        size: file.size,
      },
    });
  } catch (error) {
    console.error('Upload document error:', error);
    return Response.json({ success: false, error: error.message }, { status: 500 });
  }
}
```

- [ ] **Step 2: Create delete-document endpoint**

Create `web/src/app/api/signalwire/delete-document/route.js`:

```javascript
import { getEmployeeById, updateEmployeeDocuments } from '~/lib/db';

export async function POST(request) {
  try {
    const { employeeId, documentId, spaceUrl, projectId, apiToken } = await request.json();

    if (!employeeId || !documentId || !spaceUrl || !projectId || !apiToken) {
      return Response.json({ success: false, error: 'Missing required fields' }, { status: 400 });
    }

    // Delete from DataSphere
    const spaceDomain = spaceUrl.replace(/^https?:\/\//, '').replace(/\/$/, '');
    const dsUrl = `https://${spaceDomain}/api/datasphere/documents/${documentId}`;
    const authHeader = 'Basic ' + Buffer.from(`${projectId}:${apiToken}`).toString('base64');

    const dsResponse = await fetch(dsUrl, {
      method: 'DELETE',
      headers: { 'Authorization': authHeader },
    });

    if (!dsResponse.ok && dsResponse.status !== 404) {
      const errText = await dsResponse.text();
      console.error('DataSphere delete failed:', dsResponse.status, errText);
      return Response.json({
        success: false,
        error: `DataSphere delete failed: ${dsResponse.status}`,
      }, { status: 502 });
    }

    // Remove from employee's documents array
    const employee = getEmployeeById(employeeId);
    if (!employee) {
      return Response.json({ success: false, error: 'Employee not found' }, { status: 404 });
    }

    const documents = (employee.documents || []).filter(d => d.document_id !== documentId);
    updateEmployeeDocuments(employeeId, documents);

    return Response.json({ success: true });
  } catch (error) {
    console.error('Delete document error:', error);
    return Response.json({ success: false, error: error.message }, { status: 500 });
  }
}
```

- [ ] **Step 3: Create list-documents endpoint**

Create `web/src/app/api/signalwire/list-documents/route.js`:

```javascript
import { getEmployeeById } from '~/lib/db';

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const employeeId = searchParams.get('employeeId');

    if (!employeeId) {
      return Response.json({ success: false, error: 'Missing employeeId' }, { status: 400 });
    }

    const employee = getEmployeeById(employeeId);
    if (!employee) {
      return Response.json({ success: false, error: 'Employee not found' }, { status: 404 });
    }

    return Response.json({
      success: true,
      documents: employee.documents || [],
    });
  } catch (error) {
    console.error('List documents error:', error);
    return Response.json({ success: false, error: error.message }, { status: 500 });
  }
}
```

- [ ] **Step 4: Add `updateEmployeeDocuments` helper to db.ts**

In `web/src/lib/db.ts`, add after the existing employee functions:

```typescript
export function updateEmployeeDocuments(employeeId: string, documents: any[]) {
  const stmt = db.prepare(`UPDATE employees SET documents = ?, updated_at = datetime('now') WHERE id = ?`);
  return stmt.run(JSON.stringify(documents), employeeId);
}
```

- [ ] **Step 5: Verify endpoints**

```bash
# List documents for a non-existent employee (should return 404)
curl -s "http://localhost:5001/api/signalwire/list-documents?employeeId=nonexistent" | python3 -m json.tool
```

Expected: `{ "success": false, "error": "Employee not found" }`

- [ ] **Step 6: Commit**

```bash
git add web/src/app/api/signalwire/upload-document/ web/src/app/api/signalwire/delete-document/ web/src/app/api/signalwire/list-documents/ web/src/lib/db.ts
git commit -m "feat: add DataSphere document upload, delete, list API endpoints"
```

---

## Task 6: API — Extend Post-Prompt Handler to Persist Call Actions

**Files:**
- Modify: `web/src/app/api/post-prompt/[[...path]]/route.js:36-110`

- [ ] **Step 1: Import `insertCallAction` and update POST handler**

At the top of `web/src/app/api/post-prompt/[[...path]]/route.js`, add the import:

```javascript
import { insertCallLog, getCallLogs, getEmployeeById, insertCallAction } from '~/lib/db';
```

- [ ] **Step 2: Extract and persist actions from global_data**

After the `insertCallLog` call (~line 98), add action extraction:

```javascript
// Persist actions from global_data to call_actions table
const globalData = body?.global_data || {};
const callId = result?.lastInsertRowid?.toString() || `call_${Date.now()}`;

const actionMappings = [
  { key: 'customer_info', type: 'customer_info' },
  { key: 'message_taken', type: 'message' },
  { key: 'callback', type: 'callback' },
  { key: 'email_sent', type: 'email_sent' },
  { key: 'email_requested', type: 'email_sent' },
  { key: 'sms_sent', type: 'sms_sent' },
];

for (const mapping of actionMappings) {
  const actionData = globalData[mapping.key];
  if (actionData && typeof actionData === 'object') {
    try {
      insertCallAction(callId, employeeId, mapping.type, actionData);
      console.log(`[post-prompt] Persisted ${mapping.type} action for call ${callId}`);
    } catch (err) {
      console.error(`[post-prompt] Failed to persist ${mapping.type}:`, err);
    }
  }
}
```

- [ ] **Step 3: Add actions to GET response**

In the GET handler, after fetching logs, enrich each log with its actions. Update the GET handler:

```javascript
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const projectId = searchParams.get('projectId');
  const logs = getCallLogs(projectId || undefined);

  // Enrich logs with actions
  const enrichedLogs = logs.map(log => ({
    ...log,
    actions: getCallActions(log.id?.toString() || ''),
  }));

  return Response.json({ success: true, logs: enrichedLogs, count: enrichedLogs.length });
}
```

Add `getCallActions` to the import at the top.

- [ ] **Step 4: Verify**

```bash
curl -s "http://localhost:5001/api/post-prompt/logs" | python3 -m json.tool | head -10
```

Expected: logs with an `actions` array (empty for existing logs, populated for new calls).

- [ ] **Step 5: Commit**

```bash
git add web/src/app/api/post-prompt/
git commit -m "feat: persist SWAIG function actions from global_data to call_actions table"
```

---

## Task 7: Frontend — PhoneNumberPicker Component

**Files:**
- Create: `web/src/components/dashboard/PhoneNumberPicker.jsx`

- [ ] **Step 1: Create the PhoneNumberPicker component**

Create `web/src/components/dashboard/PhoneNumberPicker.jsx`:

```jsx
import { useState, useEffect } from 'react';

export default function PhoneNumberPicker({ value, onChange, label, placeholder, credentials }) {
  const [phoneNumbers, setPhoneNumbers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [useCustom, setUseCustom] = useState(false);

  useEffect(() => {
    if (!credentials?.spaceUrl || !credentials?.projectId || !credentials?.apiToken) return;

    setLoading(true);
    fetch(`/api/signalwire/phone-numbers?spaceUrl=${encodeURIComponent(credentials.spaceUrl)}&projectId=${encodeURIComponent(credentials.projectId)}&apiToken=${encodeURIComponent(credentials.apiToken)}`)
      .then(r => r.json())
      .then(data => {
        if (data.success) setPhoneNumbers(data.phoneNumbers || []);
      })
      .catch(err => console.error('Failed to load phone numbers:', err))
      .finally(() => setLoading(false));
  }, [credentials?.spaceUrl, credentials?.projectId, credentials?.apiToken]);

  const formatNumber = (num) => {
    if (!num) return '';
    const cleaned = num.replace(/\D/g, '');
    if (cleaned.length === 11 && cleaned.startsWith('1')) {
      return `+1 (${cleaned.slice(1, 4)}) ${cleaned.slice(4, 7)}-${cleaned.slice(7)}`;
    }
    return num;
  };

  // Check if current value matches any known number
  const isKnownNumber = phoneNumbers.some(p => p.phoneNumber === value);
  const showCustomInput = useCustom || (value && !isKnownNumber && phoneNumbers.length > 0);

  return (
    <div>
      <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 600, marginBottom: '0.25rem' }}>
        {label}
      </label>

      {loading ? (
        <p style={{ fontSize: '0.875rem', color: '#888' }}>Loading phone numbers...</p>
      ) : (
        <>
          <select
            value={showCustomInput ? '__custom__' : (value || '')}
            onChange={(e) => {
              if (e.target.value === '__custom__') {
                setUseCustom(true);
              } else {
                setUseCustom(false);
                onChange(e.target.value);
              }
            }}
            style={{
              width: '100%',
              padding: '0.5rem',
              borderRadius: '0.375rem',
              border: '1px solid #d1d5db',
              backgroundColor: 'white',
              fontSize: '0.875rem',
            }}
          >
            <option value="">— Select a number —</option>
            {phoneNumbers.map((pn) => (
              <option key={pn.sid || pn.phoneNumber} value={pn.phoneNumber}>
                {formatNumber(pn.phoneNumber)}{pn.friendlyName ? ` — "${pn.friendlyName}"` : ''}
              </option>
            ))}
            <option value="__custom__">Custom number...</option>
          </select>

          {showCustomInput && (
            <input
              type="text"
              value={value || ''}
              onChange={(e) => onChange(e.target.value)}
              placeholder={placeholder || '+15551234567'}
              style={{
                width: '100%',
                padding: '0.5rem',
                borderRadius: '0.375rem',
                border: '1px solid #d1d5db',
                fontSize: '0.875rem',
                marginTop: '0.5rem',
              }}
            />
          )}
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify the component renders**

This will be integrated in Task 9. For now, verify it imports cleanly:

```bash
# Check that the file exists and has no syntax errors
node -e "import('./web/src/components/dashboard/PhoneNumberPicker.jsx')" 2>&1 || echo "File created OK (import check is for build-time)"
ls -la "web/src/components/dashboard/PhoneNumberPicker.jsx"
```

- [ ] **Step 3: Commit**

```bash
git add web/src/components/dashboard/PhoneNumberPicker.jsx
git commit -m "feat: add PhoneNumberPicker component with space number dropdown"
```

---

## Task 8: Frontend — KnowledgeBaseTab Component

**Files:**
- Create: `web/src/components/dashboard/KnowledgeBaseTab.jsx`

- [ ] **Step 1: Create the KnowledgeBaseTab component**

Create `web/src/components/dashboard/KnowledgeBaseTab.jsx`:

```jsx
import { useState, useRef } from 'react';

const ACCEPTED_TYPES = '.pdf,.docx,.txt,.md,.html';
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

function formatFileSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function KnowledgeBaseTab({ documents = [], employeeId, credentials, onDocumentsChange }) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef(null);

  const handleUpload = async (file) => {
    if (!file) return;
    setError('');

    if (file.size > MAX_FILE_SIZE) {
      setError(`File too large (${formatFileSize(file.size)}). Maximum is 10MB.`);
      return;
    }

    if (!credentials?.spaceUrl || !credentials?.projectId || !credentials?.apiToken) {
      setError('SignalWire credentials not configured.');
      return;
    }

    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('employeeId', employeeId);
      formData.append('spaceUrl', credentials.spaceUrl);
      formData.append('projectId', credentials.projectId);
      formData.append('apiToken', credentials.apiToken);

      const resp = await fetch('/api/signalwire/upload-document', { method: 'POST', body: formData });
      const data = await resp.json();

      if (!data.success) {
        setError(data.error || 'Upload failed');
        return;
      }

      const newDocs = [...documents, {
        document_id: data.document.document_id,
        filename: data.document.filename,
        size: data.document.size,
        uploaded_at: new Date().toISOString(),
      }];
      onDocumentsChange(newDocs);
    } catch (err) {
      setError(err.message || 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = async (documentId) => {
    if (!credentials?.spaceUrl) return;

    try {
      const resp = await fetch('/api/signalwire/delete-document', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          employeeId,
          documentId,
          spaceUrl: credentials.spaceUrl,
          projectId: credentials.projectId,
          apiToken: credentials.apiToken,
        }),
      });
      const data = await resp.json();
      if (data.success) {
        onDocumentsChange(documents.filter(d => d.document_id !== documentId));
      } else {
        setError(data.error || 'Delete failed');
      }
    } catch (err) {
      setError(err.message || 'Delete failed');
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleUpload(file);
  };

  return (
    <div style={{ marginTop: '1rem' }}>
      <h4 style={{ fontSize: '0.875rem', fontWeight: 600, marginBottom: '0.5rem' }}>Knowledge Base Documents</h4>
      <p style={{ fontSize: '0.8rem', color: '#666', marginBottom: '0.75rem' }}>
        Upload documents for the agent to search during calls. Supports PDF, DOCX, TXT, MD, HTML (max 10MB each).
      </p>

      {/* Drop zone */}
      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
        style={{
          border: `2px dashed ${dragOver ? '#044cf6' : '#d1d5db'}`,
          borderRadius: '0.5rem',
          padding: '1.5rem',
          textAlign: 'center',
          cursor: uploading ? 'wait' : 'pointer',
          backgroundColor: dragOver ? '#f0f4ff' : '#fafafa',
          transition: 'all 0.15s',
        }}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept={ACCEPTED_TYPES}
          onChange={(e) => handleUpload(e.target.files?.[0])}
          style={{ display: 'none' }}
        />
        {uploading ? (
          <p style={{ color: '#666', fontSize: '0.875rem' }}>Uploading...</p>
        ) : (
          <p style={{ color: '#888', fontSize: '0.875rem' }}>
            Drop a file here or click to browse
          </p>
        )}
      </div>

      {error && (
        <p style={{ color: '#dc2626', fontSize: '0.8rem', marginTop: '0.5rem' }}>{error}</p>
      )}

      {/* Document list */}
      {documents.length > 0 && (
        <div style={{ marginTop: '0.75rem' }}>
          {documents.map((doc) => (
            <div
              key={doc.document_id}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '0.5rem 0.75rem',
                borderBottom: '1px solid #e5e7eb',
                fontSize: '0.85rem',
              }}
            >
              <div>
                <span style={{ fontWeight: 500 }}>{doc.filename}</span>
                <span style={{ color: '#888', marginLeft: '0.5rem' }}>
                  {formatFileSize(doc.size)}
                </span>
                <span style={{ color: '#aaa', marginLeft: '0.5rem', fontSize: '0.75rem' }}>
                  {new Date(doc.uploaded_at).toLocaleDateString()}
                </span>
              </div>
              <button
                onClick={(e) => { e.stopPropagation(); handleDelete(doc.document_id); }}
                style={{
                  background: 'none',
                  border: 'none',
                  color: '#dc2626',
                  cursor: 'pointer',
                  fontSize: '0.8rem',
                  padding: '0.25rem 0.5rem',
                }}
              >
                Remove
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add web/src/components/dashboard/KnowledgeBaseTab.jsx
git commit -m "feat: add KnowledgeBaseTab component with drag-and-drop document upload"
```

---

## Task 9: Frontend — Update Employee Form (Functions, Config Sections)

**Files:**
- Modify: `web/src/app/dashboard/employees/page.jsx:222-230` (AVAILABLE_FUNCTIONS), `web/src/app/dashboard/employees/page.jsx:1151-1686` (VirtualEmployeeForm)

- [ ] **Step 1: Update AVAILABLE_FUNCTIONS array**

Replace the AVAILABLE_FUNCTIONS array at lines 222-230:

```jsx
const AVAILABLE_FUNCTIONS = [
  { value: 'transfer_to_human', label: 'Transfer to Human', description: 'Transfer the call to a real phone number' },
  { value: 'take_message', label: 'Take Message', description: 'Collect caller name, number, and message' },
  { value: 'send_summary_sms', label: 'Send SMS', description: 'Send text messages — summaries, confirmations, or custom messages' },
  { value: 'schedule_callback', label: 'Schedule Callback', description: 'Collect callback request details and preferred time' },
  { value: 'check_business_hours', label: 'Check Business Hours', description: 'Report if business is open or closed (configurable hours)' },
  { value: 'collect_customer_info', label: 'Collect Customer Info', description: 'Gather name, email, phone, company — shown in call logs' },
  { value: 'search_knowledge', label: 'Search Knowledge Base', description: 'Search uploaded documents to answer caller questions (requires documents)' },
  { value: 'send_email', label: 'Send Email', description: 'Send follow-up emails via SendGrid integration' },
  { value: 'end_call', label: 'End Call', description: 'Politely end the call with a hangup' },
];
```

- [ ] **Step 2: Add imports for new components**

At the top of the employees page.jsx, add:

```jsx
import PhoneNumberPicker from '~/components/dashboard/PhoneNumberPicker';
import KnowledgeBaseTab from '~/components/dashboard/KnowledgeBaseTab';
```

- [ ] **Step 3: Add new state fields to VirtualEmployeeForm initial state**

In the VirtualEmployeeForm component (~line 1155-1170), add the new fields to the initial form state:

```jsx
const [formData, setFormData] = useState({
  // ... existing fields ...
  business_hours_start: initialData?.business_hours_start ?? initialData?.businessHoursStart ?? 9,
  business_hours_end: initialData?.business_hours_end ?? initialData?.businessHoursEnd ?? 18,
  business_days: initialData?.business_days ?? initialData?.businessDays ?? [0, 1, 2, 3, 4],
  documents: initialData?.documents ?? [],
  email_provider: initialData?.email_provider ?? initialData?.emailProvider ?? '',
  sendgrid_api_key: initialData?.sendgrid_api_key ?? initialData?.sendgridApiKey ?? '',
  email_from_address: initialData?.email_from_address ?? initialData?.emailFromAddress ?? '',
  email_from_name: initialData?.email_from_name ?? initialData?.emailFromName ?? '',
});
```

- [ ] **Step 4: Replace phone number text inputs with PhoneNumberPicker**

In the conditional function configuration section (~lines 1534-1605), replace the plain text inputs for `transfer_number`, `transfer_from`, and `sms_from_number` with the PhoneNumberPicker component:

```jsx
{/* Phone Number Configuration */}
{(formData.enabled_functions?.includes('transfer_to_human') || formData.enabled_functions?.includes('send_summary_sms')) && (
  <div style={{ marginTop: '1rem', padding: '1rem', backgroundColor: '#f0f7ff', borderRadius: '0.5rem', border: '1px solid #bfdbfe' }}>
    <h4 style={{ fontSize: '0.875rem', fontWeight: 600, marginBottom: '0.75rem' }}>Phone Number Configuration</h4>

    {formData.enabled_functions?.includes('transfer_to_human') && (
      <>
        <PhoneNumberPicker
          value={formData.transfer_number}
          onChange={(val) => setFormData(prev => ({ ...prev, transfer_number: val }))}
          label="Transfer To Number"
          placeholder="+15551234567"
          credentials={credentials}
        />
        <div style={{ marginTop: '0.5rem' }}>
          <PhoneNumberPicker
            value={formData.transfer_from}
            onChange={(val) => setFormData(prev => ({ ...prev, transfer_from: val }))}
            label="Transfer From (Caller ID override, optional)"
            placeholder="+15551234567"
            credentials={credentials}
          />
        </div>
      </>
    )}

    {formData.enabled_functions?.includes('send_summary_sms') && (
      <div style={{ marginTop: '0.5rem' }}>
        <PhoneNumberPicker
          value={formData.sms_from_number}
          onChange={(val) => setFormData(prev => ({ ...prev, sms_from_number: val }))}
          label="SMS From Number"
          placeholder="+15551234567"
          credentials={credentials}
        />
      </div>
    )}
  </div>
)}
```

- [ ] **Step 5: Add business hours config section**

After the phone number configuration section, add:

```jsx
{/* Business Hours Configuration */}
{formData.enabled_functions?.includes('check_business_hours') && (
  <div style={{ marginTop: '1rem', padding: '1rem', backgroundColor: '#f0fdf4', borderRadius: '0.5rem', border: '1px solid #bbf7d0' }}>
    <h4 style={{ fontSize: '0.875rem', fontWeight: 600, marginBottom: '0.75rem' }}>Business Hours</h4>
    <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
      <div>
        <label style={{ fontSize: '0.8rem', fontWeight: 500 }}>Open</label>
        <select
          value={formData.business_hours_start}
          onChange={(e) => setFormData(prev => ({ ...prev, business_hours_start: parseInt(e.target.value) }))}
          style={{ display: 'block', padding: '0.375rem', borderRadius: '0.25rem', border: '1px solid #d1d5db', fontSize: '0.85rem' }}
        >
          {Array.from({ length: 24 }, (_, i) => (
            <option key={i} value={i}>{`${i % 12 || 12}:00 ${i < 12 ? 'AM' : 'PM'}`}</option>
          ))}
        </select>
      </div>
      <span style={{ marginTop: '1rem' }}>to</span>
      <div>
        <label style={{ fontSize: '0.8rem', fontWeight: 500 }}>Close</label>
        <select
          value={formData.business_hours_end}
          onChange={(e) => setFormData(prev => ({ ...prev, business_hours_end: parseInt(e.target.value) }))}
          style={{ display: 'block', padding: '0.375rem', borderRadius: '0.25rem', border: '1px solid #d1d5db', fontSize: '0.85rem' }}
        >
          {Array.from({ length: 24 }, (_, i) => (
            <option key={i} value={i}>{`${i % 12 || 12}:00 ${i < 12 ? 'AM' : 'PM'}`}</option>
          ))}
        </select>
      </div>
    </div>
    <div style={{ marginTop: '0.5rem' }}>
      <label style={{ fontSize: '0.8rem', fontWeight: 500 }}>Open Days</label>
      <div style={{ display: 'flex', gap: '0.25rem', marginTop: '0.25rem' }}>
        {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((day, idx) => (
          <button
            key={day}
            type="button"
            onClick={() => {
              setFormData(prev => {
                const days = prev.business_days || [];
                return {
                  ...prev,
                  business_days: days.includes(idx) ? days.filter(d => d !== idx) : [...days, idx].sort(),
                };
              });
            }}
            style={{
              padding: '0.25rem 0.5rem',
              borderRadius: '0.25rem',
              border: '1px solid #d1d5db',
              fontSize: '0.75rem',
              fontWeight: 500,
              backgroundColor: (formData.business_days || []).includes(idx) ? '#044cf6' : 'white',
              color: (formData.business_days || []).includes(idx) ? 'white' : '#333',
              cursor: 'pointer',
            }}
          >
            {day}
          </button>
        ))}
      </div>
    </div>
  </div>
)}
```

- [ ] **Step 6: Add email config section**

After the business hours section, add:

```jsx
{/* Email Configuration */}
{formData.enabled_functions?.includes('send_email') && (
  <div style={{ marginTop: '1rem', padding: '1rem', backgroundColor: '#fefce8', borderRadius: '0.5rem', border: '1px solid #fde68a' }}>
    <h4 style={{ fontSize: '0.875rem', fontWeight: 600, marginBottom: '0.75rem' }}>Email Configuration (SendGrid)</h4>
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
      <div>
        <label style={{ fontSize: '0.8rem', fontWeight: 500 }}>SendGrid API Key</label>
        <input
          type="password"
          value={formData.sendgrid_api_key}
          onChange={(e) => setFormData(prev => ({ ...prev, sendgrid_api_key: e.target.value, email_provider: e.target.value ? 'sendgrid' : '' }))}
          placeholder="SG.xxxxxxxxxx"
          style={{ display: 'block', width: '100%', padding: '0.5rem', borderRadius: '0.375rem', border: '1px solid #d1d5db', fontSize: '0.85rem' }}
        />
      </div>
      <div>
        <label style={{ fontSize: '0.8rem', fontWeight: 500 }}>From Email Address</label>
        <input
          type="email"
          value={formData.email_from_address}
          onChange={(e) => setFormData(prev => ({ ...prev, email_from_address: e.target.value }))}
          placeholder="noreply@yourcompany.com"
          style={{ display: 'block', width: '100%', padding: '0.5rem', borderRadius: '0.375rem', border: '1px solid #d1d5db', fontSize: '0.85rem' }}
        />
      </div>
      <div>
        <label style={{ fontSize: '0.8rem', fontWeight: 500 }}>From Name (optional)</label>
        <input
          type="text"
          value={formData.email_from_name}
          onChange={(e) => setFormData(prev => ({ ...prev, email_from_name: e.target.value }))}
          placeholder="Defaults to employee name"
          style={{ display: 'block', width: '100%', padding: '0.5rem', borderRadius: '0.375rem', border: '1px solid #d1d5db', fontSize: '0.85rem' }}
        />
      </div>
    </div>
  </div>
)}
```

- [ ] **Step 7: Add Knowledge Base section**

After the email config, add:

```jsx
{/* Knowledge Base */}
{formData.enabled_functions?.includes('search_knowledge') && (
  <KnowledgeBaseTab
    documents={formData.documents || []}
    employeeId={formData.id || editingEmployee?.id}
    credentials={credentials}
    onDocumentsChange={(docs) => setFormData(prev => ({ ...prev, documents: docs }))}
  />
)}
```

- [ ] **Step 8: Ensure new fields are included in form submission**

Find where the form data is submitted (the `handleCreateEmployee` or `handleSave` function) and verify all new fields are passed through. The existing code likely spreads `formData`, so the new fields should flow through automatically. If not, explicitly add them.

- [ ] **Step 9: Commit**

```bash
git add web/src/app/dashboard/employees/page.jsx
git commit -m "feat: update employee form with 9 functions, phone picker, knowledge base, email, hours config"
```

---

## Task 10: Frontend — CallLogDetail Component

**Files:**
- Create: `web/src/components/dashboard/CallLogDetail.jsx`
- Modify: `web/src/app/dashboard/call-logs/page.jsx`

- [ ] **Step 1: Create CallLogDetail component**

Create `web/src/components/dashboard/CallLogDetail.jsx`:

```jsx
export default function CallLogDetail({ log }) {
  if (!log) return null;

  const actions = log.actions || [];

  const customerInfo = actions.find(a => a.action_type === 'customer_info');
  const messages = actions.filter(a => a.action_type === 'message');
  const callbacks = actions.filter(a => a.action_type === 'callback');
  const emailsSent = actions.filter(a => a.action_type === 'email_sent');
  const smsSent = actions.filter(a => a.action_type === 'sms_sent');

  const sectionStyle = {
    padding: '0.75rem',
    marginBottom: '0.5rem',
    borderRadius: '0.375rem',
    border: '1px solid #e5e7eb',
    backgroundColor: '#fafafa',
  };

  const headingStyle = {
    fontSize: '0.8rem',
    fontWeight: 700,
    marginBottom: '0.375rem',
    textTransform: 'uppercase',
    letterSpacing: '0.03em',
    color: '#555',
  };

  const fieldStyle = {
    display: 'flex',
    gap: '0.5rem',
    fontSize: '0.85rem',
    marginBottom: '0.125rem',
  };

  return (
    <div style={{ padding: '0.75rem 1rem', backgroundColor: '#fff', borderTop: '1px solid #e5e7eb' }}>
      {/* Customer Info */}
      {customerInfo && (
        <div style={sectionStyle}>
          <div style={headingStyle}>Customer Info</div>
          {customerInfo.data.name && <div style={fieldStyle}><strong>Name:</strong> {customerInfo.data.name}</div>}
          {customerInfo.data.email && <div style={fieldStyle}><strong>Email:</strong> {customerInfo.data.email}</div>}
          {customerInfo.data.phone && <div style={fieldStyle}><strong>Phone:</strong> {customerInfo.data.phone}</div>}
          {customerInfo.data.company && <div style={fieldStyle}><strong>Company:</strong> {customerInfo.data.company}</div>}
          {customerInfo.data.notes && <div style={fieldStyle}><strong>Notes:</strong> {customerInfo.data.notes}</div>}
        </div>
      )}

      {/* Call Summary */}
      {log.summary && (
        <div style={sectionStyle}>
          <div style={headingStyle}>Call Summary</div>
          <p style={{ fontSize: '0.85rem', margin: 0 }}>{log.summary}</p>
          {log.caller_intent && (
            <p style={{ fontSize: '0.8rem', color: '#666', marginTop: '0.25rem', margin: 0 }}>
              <strong>Intent:</strong> {log.caller_intent}
            </p>
          )}
          {log.follow_up && (
            <p style={{ fontSize: '0.8rem', color: '#b45309', marginTop: '0.25rem', margin: 0 }}>
              <strong>Follow-up:</strong> {log.follow_up}
            </p>
          )}
        </div>
      )}

      {/* Messages Taken */}
      {messages.length > 0 && (
        <div style={sectionStyle}>
          <div style={headingStyle}>Messages Taken</div>
          {messages.map((m, i) => (
            <div key={i} style={{ marginBottom: '0.375rem', fontSize: '0.85rem' }}>
              <strong>{m.data.name || 'Caller'}:</strong> "{m.data.message}"
              {m.data.number && <span style={{ color: '#666' }}> — callback: {m.data.number}</span>}
            </div>
          ))}
        </div>
      )}

      {/* Callbacks Scheduled */}
      {callbacks.length > 0 && (
        <div style={sectionStyle}>
          <div style={headingStyle}>Callbacks Scheduled</div>
          {callbacks.map((c, i) => (
            <div key={i} style={{ fontSize: '0.85rem', marginBottom: '0.375rem' }}>
              <strong>{c.data.name}</strong> — {c.data.time}
              {c.data.number && <span style={{ color: '#666' }}> ({c.data.number})</span>}
              {c.data.reason && <div style={{ color: '#666', fontSize: '0.8rem' }}>Reason: {c.data.reason}</div>}
            </div>
          ))}
        </div>
      )}

      {/* Emails Sent */}
      {emailsSent.length > 0 && (
        <div style={sectionStyle}>
          <div style={headingStyle}>Emails Sent</div>
          {emailsSent.map((e, i) => (
            <div key={i} style={{ fontSize: '0.85rem', marginBottom: '0.375rem' }}>
              To: <strong>{e.data.to || e.data.to_email}</strong>
              {e.data.subject && <span> — "{e.data.subject}"</span>}
              <span style={{ color: e.data.status === 'sent' ? '#16a34a' : '#dc2626', marginLeft: '0.5rem', fontSize: '0.75rem' }}>
                ({e.data.status || 'sent'})
              </span>
            </div>
          ))}
        </div>
      )}

      {/* SMS Sent */}
      {smsSent.length > 0 && (
        <div style={sectionStyle}>
          <div style={headingStyle}>SMS Sent</div>
          {smsSent.map((s, i) => (
            <div key={i} style={{ fontSize: '0.85rem', marginBottom: '0.375rem' }}>
              To: <strong>{s.data.to || s.data.phone_number}</strong>
              {s.data.body && <div style={{ color: '#666', fontSize: '0.8rem' }}>"{(s.data.body || '').slice(0, 100)}"</div>}
            </div>
          ))}
        </div>
      )}

      {/* Topics */}
      {log.topics && (
        <div style={{ display: 'flex', gap: '0.25rem', flexWrap: 'wrap', marginTop: '0.5rem' }}>
          {(typeof log.topics === 'string' ? JSON.parse(log.topics) : log.topics).map((topic, i) => (
            <span
              key={i}
              style={{
                padding: '0.125rem 0.5rem',
                backgroundColor: '#e0e7ff',
                color: '#3730a3',
                borderRadius: '9999px',
                fontSize: '0.75rem',
                fontWeight: 500,
              }}
            >
              {topic}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Integrate CallLogDetail into call-logs page**

In `web/src/app/dashboard/call-logs/page.jsx`, add the import:

```jsx
import CallLogDetail from '~/components/dashboard/CallLogDetail';
```

Then find the expandable row section (~lines 220-255) and replace the current expanded content with the CallLogDetail component. Where the existing code renders the expanded row detail, replace with:

```jsx
{expandedLog === log.id && (
  <CallLogDetail log={log} />
)}
```

- [ ] **Step 3: Commit**

```bash
git add web/src/components/dashboard/CallLogDetail.jsx web/src/app/dashboard/call-logs/page.jsx
git commit -m "feat: add CallLogDetail component with conditional action sections"
```

---

## Task 11: Frontend — Update Template Defaults

**Files:**
- Modify: `web/src/app/dashboard/templates/page.jsx:22-410`

- [ ] **Step 1: Update each template's enabled_functions**

In `web/src/app/dashboard/templates/page.jsx`, update the `enabled_functions` array in each template:

**Sales Representative** (~line 52):
```javascript
enabled_functions: ["collect_customer_info", "search_knowledge", "send_email", "send_summary_sms", "schedule_callback", "transfer_to_human", "end_call"],
```

**Customer Support** (~line 115):
```javascript
enabled_functions: ["search_knowledge", "collect_customer_info", "take_message", "send_email", "transfer_to_human", "end_call"],
```

**Appointment Scheduler** (~line 183):
```javascript
enabled_functions: ["schedule_callback", "collect_customer_info", "check_business_hours", "send_summary_sms", "transfer_to_human", "end_call"],
```

**Order Taker** (~line 246):
```javascript
enabled_functions: ["collect_customer_info", "send_summary_sms", "send_email", "transfer_to_human", "end_call"],
```

**Virtual Receptionist** (~line 316):
```javascript
enabled_functions: ["search_knowledge", "collect_customer_info", "take_message", "schedule_callback", "check_business_hours", "transfer_to_human", "send_summary_sms", "end_call"],
```

**Survey Collector** (~line 380):
```javascript
enabled_functions: ["collect_customer_info", "send_summary_sms", "end_call"],
```

- [ ] **Step 2: Commit**

```bash
git add web/src/app/dashboard/templates/page.jsx
git commit -m "feat: update template defaults with new function assignments"
```

---

## Task 12: Wire Up — Employee Creation Passes New Fields to Backend

**Files:**
- Modify: `web/src/app/api/signalwire/create-virtual-employee/route.js`

- [ ] **Step 1: Pass new config fields when creating employee in backend**

In the `create-virtual-employee/route.js`, find where `employeeData` is sent to the Python backend (`/api/create-employee`) and add the new fields to the payload:

```javascript
// In the body sent to the Python backend:
const backendPayload = {
  ...employeeData,
  id: employeeData.id,
  name: employeeData.name,
  role: employeeData.role,
  // ... existing fields ...
  business_hours_start: employeeData.businessHoursStart ?? employeeData.business_hours_start ?? 9,
  business_hours_end: employeeData.businessHoursEnd ?? employeeData.business_hours_end ?? 18,
  business_days: employeeData.businessDays ?? employeeData.business_days ?? [0, 1, 2, 3, 4],
  documents: employeeData.documents ?? [],
  sendgrid_api_key: employeeData.sendgridApiKey ?? employeeData.sendgrid_api_key ?? '',
  email_from_address: employeeData.emailFromAddress ?? employeeData.email_from_address ?? '',
  email_from_name: employeeData.emailFromName ?? employeeData.email_from_name ?? '',
  space_name: spaceUrl?.replace(/^https?:\/\//, '').replace(/\/$/, '') || '',
  project_id: projectId,
  token: apiToken,
};
```

- [ ] **Step 2: Ensure DB upsert receives new fields**

In the same file, verify the `upsertEmployee()` call includes the new fields. The existing code likely passes the employee data dict — make sure the field names match what `db.ts` expects (camelCase):

```javascript
upsertEmployee({
  // ... existing fields ...
  businessHoursStart: employeeData.business_hours_start ?? 9,
  businessHoursEnd: employeeData.business_hours_end ?? 18,
  businessDays: employeeData.business_days ?? [0, 1, 2, 3, 4],
  documents: employeeData.documents ?? [],
  emailProvider: employeeData.email_provider ?? '',
  sendgridApiKey: employeeData.sendgrid_api_key ?? '',
  emailFromAddress: employeeData.email_from_address ?? '',
  emailFromName: employeeData.email_from_name ?? '',
});
```

- [ ] **Step 3: Commit**

```bash
git add web/src/app/api/signalwire/create-virtual-employee/route.js
git commit -m "feat: pass new config fields (hours, email, documents) through employee creation"
```

---

## Verification Checklist

After all tasks are complete:

- [ ] Backend starts without errors (`curl http://localhost:8000/health`)
- [ ] Frontend starts without errors (no console errors at `http://localhost:5001`)
- [ ] Employee form shows 9 functions with checkboxes
- [ ] Enabling `transfer_to_human` shows phone number picker dropdown
- [ ] Enabling `send_summary_sms` shows SMS from number picker
- [ ] Enabling `check_business_hours` shows hours config with day buttons
- [ ] Enabling `send_email` shows SendGrid config fields
- [ ] Enabling `search_knowledge` shows knowledge base upload zone
- [ ] Creating an employee from a template pre-selects the correct functions
- [ ] Call logs page loads without errors
- [ ] Expanding a call log shows the CallLogDetail with conditional sections
