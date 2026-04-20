# Enabled Functions Redesign — Sally Sales

**Date:** 2026-04-17
**Scope:** Fix broken functions, add knowledge base + email + customer info capture, update templates and call logs

---

## Problem

3 of 6 current SWAIG functions are effectively broken:
- `transfer_to_human` — no transfer number configured by default
- `send_summary_sms` — no SMS from number configured by default
- `take_message` and `schedule_callback` — store data in global_data that's never persisted or surfaced

The `send_sms` (generic) function exists in the backend but isn't exposed in the UI, and overlaps with `send_summary_sms`.

No functions connect to external services or provide knowledge retrieval.

---

## Solution Overview

- Fix all 6 existing functions to work end-to-end
- Remove `send_sms` (merge into `send_summary_sms`)
- Add 3 new functions: `search_knowledge`, `send_email`, `collect_customer_info`
- Persist all function actions to a `call_actions` DB table
- Display actions in call log detail view
- Add phone number picker, knowledge base upload, email config, and business hours config to the employee form

---

## Final Function Set (9 total)

### Keep & Fix

#### `transfer_to_human`
- Phone number selected from dropdown populated via SignalWire space API + custom number input
- `transfer_from` also uses the phone number picker
- No change to SWAIG function logic — fix is in configuration UX

#### `send_summary_sms`
- `sms_from_number` selected via same phone number picker
- Absorbs the generic `send_sms` capability — agent can send any message, not just summaries
- No functional change to the SWAIG code

#### `take_message`
- Persists message data to `call_actions` table (action_type: `message`)
- Displayed in call log detail view under "Messages Taken" section
- Data: caller_name, callback_number, message

#### `schedule_callback`
- Persists callback data to `call_actions` table (action_type: `callback`)
- Displayed in call log detail view under "Callbacks Scheduled" section
- Data: caller_name, callback_number, preferred_time, reason

#### `check_business_hours`
- Hours configurable per employee in employee config
- Config fields: `business_hours_start` (default 9), `business_hours_end` (default 18), `business_days` (default [0,1,2,3,4] = Mon-Fri)
- Employee form shows business hours config when this function is enabled

#### `end_call`
- No changes. Works as-is.

### Remove

#### `send_sms` (generic)
- Removed. Overlaps with `send_summary_sms`.
- `send_summary_sms` description updated to clarify it can send any text message.

### Add New

#### `search_knowledge`
- Uses SignalWire DataSphere Serverless skill (`datasphere_serverless`)
- Documents uploaded per employee via new Knowledge Base UI
- Upload flow: file → `/api/signalwire/upload-document` → DataSphere REST API → `document_id` stored in employee config
- Agent config: `add_skill("datasphere_serverless", { space_name, project_id, token, document_id, count: 3, distance: 5.0 })`
- DataSphere credentials (`space_name`, `project_id`, `token`) sourced from the same SignalWire credentials the app already uses for Fabric API
- Multiple documents supported via multiple skill instances
- Graceful fallback if no documents uploaded: "I don't have reference materials to search right now"
- Supported formats: PDF, DOCX, TXT, MD, HTML
- Max file size: 10MB per file
- Chunking strategy: `paragraph` (default)
- `search_knowledge` is NOT a SWAIG function defined in `main.py` — it's a built-in SDK skill added via `add_skill()`. The function checkbox in the UI controls whether the skill is added to the agent.

#### `send_email`
- SendGrid integration
- Config fields: `email_provider` (sendgrid), `sendgrid_api_key`, `email_from_address`, `email_from_name`
- API key configurable at app level (`.env`) or per employee
- SWAIG function collects: recipient email, purpose/subject from conversation context
- Sends email with call summary + any collected customer info
- Persists email record to `call_actions` table (action_type: `email_sent`)
- Data: to_address, subject, body, sent_at
- Graceful fallback if not configured: "Email isn't set up yet, let me take a message instead"

#### `collect_customer_info`
- Structured data collection during the call — agent gathers fields conversationally
- Fields: `name`, `email`, `phone`, `company`, `notes` (all optional)
- Stored as structured JSON via `update_global_data`
- Persisted to `call_actions` table (action_type: `customer_info`)
- Displayed prominently in call log detail view under "Customer Info" section

---

## Phone Number Picker Component

Reusable dropdown component used for `transfer_number`, `transfer_from`, and `sms_from_number`.

- Fetches numbers from `/api/signalwire/phone-numbers` (existing endpoint)
- Display format: `+1 (555) 123-4567 — "Main Line"` (number + friendly name)
- "Custom number" option at bottom opens text input for manual E.164 entry
- Selected value stored as string in employee config

Conditional display:
- Transfer number picker: visible when `transfer_to_human` enabled
- SMS from number picker: visible when `send_summary_sms` enabled
- Email config: visible when `send_email` enabled
- Business hours config: visible when `check_business_hours` enabled

---

## Knowledge Base UI

New "Knowledge Base" tab in employee create/edit form.

- Drag & drop file upload zone (or click to browse)
- Accepts: PDF, DOCX, TXT, MD, HTML
- Max 10MB per file
- Document list showing: filename, size, upload date, status indicator
- Delete button per document
- Employee config stores: `documents: [{ document_id, filename, size, uploaded_at }]`

### API Endpoints

- `POST /api/signalwire/upload-document` — accepts multipart file + employee_id, uploads to DataSphere, returns document_id
- `DELETE /api/signalwire/delete-document` — removes document from DataSphere and employee config
- `GET /api/signalwire/list-documents/:employeeId` — returns document list for an employee

---

## Call Log Detail View

When viewing a specific call log entry, conditional sections appear based on which functions were used:

1. **Customer Info** — name, email, phone, company, notes (from `collect_customer_info`)
2. **Call Summary** — AI-generated summary (from post-prompt, already exists)
3. **Messages Taken** — caller messages (from `take_message`)
4. **Callbacks Scheduled** — scheduled callback details (from `schedule_callback`)
5. **Emails Sent** — email records (from `send_email`)
6. **SMS Sent** — SMS records (from `send_summary_sms`)
7. **Transcript** — expandable full transcript (already exists)

Each section only renders if that action type has data for the call.

---

## Database Changes

### New table: `call_actions`

| Column | Type | Description |
|---|---|---|
| `id` | INTEGER PRIMARY KEY | Auto-increment |
| `call_id` | TEXT | FK to call log record |
| `employee_id` | TEXT | Which employee handled the call |
| `action_type` | TEXT | `customer_info`, `message`, `callback`, `email_sent`, `sms_sent`, `transfer` |
| `data` | TEXT (JSON) | Action-specific structured data |
| `created_at` | TEXT | ISO timestamp |

### Post-prompt handler changes

The existing post-prompt handler at `/api/post-prompt/:employeeId` is extended to:
1. Read `global_data` from the post-prompt payload (contains data from `update_global_data` calls)
2. For each known key (`message_taken`, `callback`, `customer_info`), write a `call_actions` row
3. SMS and email actions are written at send time (already have the data)

---

## Updated Template Defaults

| Template | Enabled Functions |
|---|---|
| Sales Rep | `collect_customer_info`, `search_knowledge`, `send_email`, `send_summary_sms`, `schedule_callback`, `transfer_to_human`, `end_call` |
| Customer Support | `search_knowledge`, `collect_customer_info`, `take_message`, `send_email`, `transfer_to_human`, `end_call` |
| Appointment Scheduler | `schedule_callback`, `collect_customer_info`, `check_business_hours`, `send_summary_sms`, `transfer_to_human`, `end_call` |
| Order Taker | `collect_customer_info`, `send_summary_sms`, `send_email`, `transfer_to_human`, `end_call` |
| Virtual Receptionist | `search_knowledge`, `collect_customer_info`, `take_message`, `schedule_callback`, `check_business_hours`, `transfer_to_human`, `send_summary_sms`, `end_call` |
| Survey Collector | `collect_customer_info`, `send_summary_sms`, `end_call` |

---

## New Dependencies

**Python (agent):**
- `sendgrid` — SendGrid email API client

**Frontend:**
- No new dependencies (file upload uses native browser APIs)

---

## Error Handling

All new and fixed functions follow the same graceful degradation pattern:
- Missing config → agent tells caller the feature isn't available and offers an alternative (e.g., take a message instead)
- External service failure (SendGrid, DataSphere) → agent acknowledges the issue and falls back to data capture
- No documents uploaded for `search_knowledge` → agent says it doesn't have reference materials and offers to connect to a human

---

## Out of Scope

- Multiple email providers (v1 is SendGrid only)
- Document editing/re-chunking (upload or delete, no update)
- Real calendar integration (schedule_callback is still data capture, not API booking)
- Custom fields for collect_customer_info (v1 is fixed field set)
