"""Code-string templates used by `_generate_sdk_code` in agent/main.py.

Each entry in SWAIG_TEMPLATES maps a SWAIG function id to a builder:
    builder(employee_config: dict) -> tuple[str, dict[str, str]]

Returns:
    (method_source, helpers)

method_source: full @AgentBase.tool(...) decorator + method body, ready to
    paste into a generated file at one indent level inside the class body.
helpers: dict of helper-method-name -> source. Composer de-dups by name
    so the same helper from multiple templates is emitted exactly once.
"""
from __future__ import annotations

import hashlib
import json
from typing import Callable, Dict, Tuple


# function_id -> builder(employee_config) -> (method_source, helpers)
SWAIG_TEMPLATES: Dict[str, Callable[[dict], Tuple[str, Dict[str, str]]]] = {}


def datasphere_block(employee_config: dict) -> str:
    """Emit `self.add_skill("datasphere_serverless", {...})` calls + optional
    Knowledge Base Routing pom-section. Returns "" if not applicable.

    Mirrors VirtualEmployeeAgent._configure_functions lines 247-278.
    """
    enabled = employee_config.get("enabled_functions") or []
    if "search_knowledge" not in enabled:
        return ""
    documents = employee_config.get("documents") or []
    if not documents:
        return "        # search_knowledge enabled but no documents configured\n"

    lines: list[str] = []
    doc_descriptions: list[str] = []

    for doc in documents:
        if isinstance(doc, dict):
            doc_id = doc.get("document_id", "")
            doc_name = doc.get("name", doc_id[:8])
            doc_desc = doc.get("description", "")
            doc_distance = doc.get("distance", 3.0)
        else:
            doc_id = doc
            doc_name = doc_id[:8]
            doc_desc = ""
            doc_distance = 3.0

        if not doc_id:
            continue

        doc_hash = hashlib.md5(str(doc_id).encode()).hexdigest()[:6]
        safe_name = doc_name.lower().replace(" ", "_").replace("-", "_")[:20]
        tool_name = f"search_{safe_name}_{doc_hash}"
        description_text = doc_desc or f"Search the {doc_name} knowledge base"

        skill_block = (
            '        self.add_skill("datasphere_serverless", {\n'
            '            "space_name": os.environ["SIGNALWIRE_SPACE"],\n'
            '            "project_id": os.environ["SIGNALWIRE_PROJECT_ID"],\n'
            '            "token": os.environ["SIGNALWIRE_TOKEN"],\n'
            f'            "document_id": {json.dumps(doc_id)},\n'
            '            "count": 3,\n'
            f'            "distance": {doc_distance},\n'
            f'            "tool_name": {json.dumps(tool_name)},\n'
            f'            "description": {json.dumps(description_text)},\n'
            '            "swaig_fields": {\n'
            '                "fillers": {\n'
            '                    "en-US": [\n'
            '                        "Let me check our documentation...",\n'
            '                        "Searching our knowledge base...",\n'
            '                        "Looking that up for you...",\n'
            '                    ]\n'
            '                }\n'
            '            },\n'
            '        })'
        )
        lines.append(skill_block)
        # Routing description matches live agent: doc_desc or doc_name (not description_text)
        doc_descriptions.append(f"- {tool_name}: {doc_desc or doc_name}")

    if len(doc_descriptions) > 1:
        routing = "You have access to these knowledge bases:\n" + "\n".join(doc_descriptions)
        routing += "\nChoose the most relevant one based on the caller's question."
        lines.append(
            f'        self.prompt_add_section("Knowledge Base Routing", body={json.dumps(routing)})'
        )

    return "\n".join(lines) + "\n"


def env_var_header(employee_config: dict, enabled_functions: list[str]) -> str:
    """Return the top-of-file docstring listing required env vars + quickstart.

    Only lists env vars actually consumed by the enabled functions / DataSphere.
    Surfaces user-config values as comments (e.g. HireWire-stored transfer
    number) but never inlines API tokens.
    """
    name = employee_config.get("name", "Employee")
    role = employee_config.get("role", "Virtual Assistant")
    employee_id = employee_config.get("id", "employee")

    rows: list[str] = []

    if "search_knowledge" in enabled_functions and (employee_config.get("documents") or []):
        rows.append("  SIGNALWIRE_SPACE          — your SignalWire space (e.g. example.signalwire.com)")
        rows.append("  SIGNALWIRE_PROJECT_ID     — your SignalWire project ID")
        rows.append("  SIGNALWIRE_TOKEN          — your SignalWire API token (do NOT commit)")

    if "transfer_to_human" in enabled_functions:
        cur = employee_config.get("transfer_number", "")
        rows.append(f"  HIREWIRE_TRANSFER_NUMBER  — number to transfer callers to{(' (HireWire had: ' + cur + ')') if cur else ''}")
        cur_from = employee_config.get("transfer_from") or employee_config.get("phone_number", "")
        if cur_from:
            rows.append(f"  HIREWIRE_TRANSFER_FROM    — caller-ID for transfer (HireWire had: {cur_from})")
        else:
            rows.append("  HIREWIRE_TRANSFER_FROM    — caller-ID for transfer (optional)")

    if "send_summary_sms" in enabled_functions:
        cur = employee_config.get("sms_from_number", "")
        rows.append(f"  HIREWIRE_SMS_FROM_NUMBER  — SMS sender number{(' (HireWire had: ' + cur + ')') if cur else ''}")

    if "send_email" in enabled_functions:
        cur_addr = employee_config.get("email_from_address", "")
        cur_nm = employee_config.get("email_from_name", "")
        rows.append("  SENDGRID_API_KEY          — your SendGrid API key (do NOT commit)")
        rows.append(f"  HIREWIRE_EMAIL_FROM_ADDRESS — sender email{(' (HireWire had: ' + cur_addr + ')') if cur_addr else ''}")
        if cur_nm:
            rows.append(f"  HIREWIRE_EMAIL_FROM_NAME  — sender display name (HireWire had: {cur_nm})")
        else:
            rows.append("  HIREWIRE_EMAIL_FROM_NAME  — sender display name (optional)")

    env_section = (
        "\nRequired environment variables:\n" + "\n".join(rows) + "\n"
    ) if rows else ""

    return (
        '"""\n'
        f"{name} ({role})\n\n"
        "Generated agent code from HireWire-AI. When run, this file serves SWML at\n"
        f"http://localhost:3000/swml/{employee_id} whose schema matches the live HireWire\n"
        "agent's SWML for this employee."
        f"{env_section}"
        "\nQuickstart:\n"
        "  pip install signalwire-agents\n"
        "  # set required env vars above\n"
        f"  python {employee_id}.py\n"
        '"""'
    )


# ---------------------------------------------------------------------------
# SWAIG function templates
# ---------------------------------------------------------------------------

def _build_transfer_to_human(employee_config: dict) -> tuple:
    method = '''    @AgentBase.tool(
        name="transfer_to_human",
        description="Transfer the call to a human representative at a real phone number",
        parameters={
            "type": "object",
            "properties": {
                "department": {
                    "type": "string",
                    "description": "Department to transfer to (e.g. sales, support, general)"
                },
                "reason": {
                    "type": "string",
                    "description": "Brief reason for the transfer"
                }
            }
        }
    )
    def transfer_to_human(self, args, raw_data):
        """Transfer call to a configured phone number."""
        department = args.get("department", "general")
        number = os.environ.get("HIREWIRE_TRANSFER_NUMBER", "")

        if not number:
            return SwaigFunctionResult(
                "I'm sorry, there's no transfer number configured right now. "
                "Let me take a message instead so someone can call you back."
            )

        result = SwaigFunctionResult(
            f"I'll connect you with our {department} team now. Please hold.",
            post_process=True,
        )
        from_addr = os.environ.get("HIREWIRE_TRANSFER_FROM") or os.environ.get("HIREWIRE_PHONE_NUMBER") or None
        result.connect(number, final=True, from_addr=from_addr)
        return result'''
    return method, {}


SWAIG_TEMPLATES["transfer_to_human"] = _build_transfer_to_human


def _build_send_summary_sms(employee_config: dict) -> tuple:
    agent_name = employee_config.get("name", "Agent").replace('"', '\\"')
    method = f'''    @AgentBase.tool(
        name="send_summary_sms",
        description="Send an SMS text message to the caller\'s phone number. Can send call summaries, confirmations, follow-ups, or any custom message. Ask for their phone number first.",
        parameters={{
            "type": "object",
            "properties": {{
                "phone_number": {{
                    "type": "string",
                    "description": "The caller\'s phone number to send the SMS to (E.164 format)"
                }},
                "message": {{
                    "type": "string",
                    "description": "The text message to send — can be a call summary, confirmation, or any relevant message"
                }},
                "caller_info": {{
                    "type": "string",
                    "description": "Caller name and contact info if provided"
                }}
            }},
            "required": ["phone_number", "message"]
        }}
    )
    def send_summary_sms(self, args, raw_data):
        """Send an SMS with the call summary to a number the caller provided."""
        phone_number_raw = args.get("phone_number", "")
        message = args.get("message", "") or args.get("summary", "No message provided")
        caller_info = args.get("caller_info", "")
        from_number = os.environ.get("HIREWIRE_SMS_FROM_NUMBER", "")

        phone_number = self._clean_phone_number(phone_number_raw)

        if not phone_number or len(phone_number) < 10:
            return SwaigFunctionResult(
                "I need a valid phone number to send the summary. Could you please provide your full phone number including area code?"
            )

        if not from_number:
            return SwaigFunctionResult(
                "I\'m sorry, text messaging is not set up for this agent right now. I\'ve noted the summary for our team."
            )

        max_message_len = 300
        if len(message) > max_message_len:
            message = message[:max_message_len] + "..."
        parts = [f"[SignalWire] {agent_name} Call Summary:"]
        if caller_info:
            parts.append(f"Caller: {{caller_info}}")
        parts.append(message)
        parts.append("REPLY STOP TO STOP")
        body = "\\n".join(parts)

        try:
            result = SwaigFunctionResult(f"I\'ve sent a text summary to {{phone_number_raw}}.")
            result.send_sms(phone_number, from_number, body)
            return result
        except Exception:
            return SwaigFunctionResult(
                "I\'m sorry, I wasn\'t able to send the text message right now. I\'ve noted the summary for our team instead."
            )'''

    helper = '''    @staticmethod
    def _clean_phone_number(number: str) -> str:
        """Sanitize phone number to E.164 format — strip hyphens, spaces, parens."""
        import re
        if not number:
            return ""
        cleaned = re.sub(r\'[^\\d+]\', \'\', number)
        if cleaned and not cleaned.startswith(\'+\'):
            cleaned = \'+\' + cleaned
        return cleaned'''

    return method, {"_clean_phone_number": helper}


SWAIG_TEMPLATES["send_summary_sms"] = _build_send_summary_sms


def _build_schedule_callback(employee_config: dict) -> tuple:
    method = '''    @AgentBase.tool(
        name="schedule_callback",
        description="Schedule a PHONE CALLBACK for later. Collects name, number, preferred time, and reason. This is NOT for sending text messages — use send_summary_sms for that.",
        parameters={
            "type": "object",
            "properties": {
                "caller_name": {
                    "type": "string",
                    "description": "The caller\'s name"
                },
                "callback_number": {
                    "type": "string",
                    "description": "Phone number to call back"
                },
                "preferred_time": {
                    "type": "string",
                    "description": "When the caller would like to be called back"
                },
                "reason": {
                    "type": "string",
                    "description": "Reason for the callback"
                }
            },
            "required": ["caller_name", "callback_number", "preferred_time"]
        }
    )
    def schedule_callback(self, args, raw_data):
        """Collect callback request details and store them on global_data."""
        caller_name = args.get("caller_name", "")
        callback_number = args.get("callback_number", "")
        preferred_time = args.get("preferred_time", "")
        reason = args.get("reason", "")

        result = SwaigFunctionResult(
            f"I\'ve scheduled a callback for {caller_name} at {preferred_time}. "
            "Someone from our team will reach out to you then."
        )
        result.update_global_data({
            "callback": {
                "name": caller_name,
                "number": callback_number,
                "time": preferred_time,
                "reason": reason[:100],
            }
        })
        return result'''
    return method, {}


SWAIG_TEMPLATES["schedule_callback"] = _build_schedule_callback


def _build_check_business_hours(employee_config: dict) -> tuple:
    start = employee_config.get("business_hours_start", 9)
    end = employee_config.get("business_hours_end", 18)
    days = employee_config.get("business_days", [0, 1, 2, 3, 4])
    days_literal = json.dumps(days)

    method = f'''    @AgentBase.tool(
        name="check_business_hours",
        description="Check if the business is currently open and provide hours information",
        parameters={{
            "type": "object",
            "properties": {{}}
        }}
    )
    def check_business_hours(self, args, raw_data):
        """Return business hours — uses inlined config values."""
        from datetime import datetime
        now = datetime.now()
        hour = now.hour
        weekday = now.weekday()

        start = {start}
        end = {end}
        days = {days_literal}

        day_names = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
        open_days = [day_names[d] for d in sorted(days)]
        hours_str = f"{{start % 12 or 12}} {{\'AM\' if start < 12 else \'PM\'}} to {{end % 12 or 12}} {{\'AM\' if end < 12 else \'PM\'}}"

        if weekday in days and start <= hour < end:
            return SwaigFunctionResult(
                f"We are currently open. Our business hours are {{open_days[0]}} through {{open_days[-1]}}, {{hours_str}}."
            )
        else:
            return SwaigFunctionResult(
                f"We are currently closed. Our business hours are {{open_days[0]}} through {{open_days[-1]}}, {{hours_str}}. "
                "I can take a message or schedule a callback for when we reopen."
            )'''
    return method, {}


SWAIG_TEMPLATES["check_business_hours"] = _build_check_business_hours


def _build_collect_customer_info(employee_config: dict) -> tuple:
    method = '''    @AgentBase.tool(
        name="collect_customer_info",
        description="Collect structured customer information during the call. Gather details conversationally — name, email, phone, company, and any notes. Call this once you have collected the relevant details.",
        parameters={
            "type": "object",
            "properties": {
                "name": {
                    "type": "string",
                    "description": "The customer\'s full name"
                },
                "email": {
                    "type": "string",
                    "description": "The customer\'s email address"
                },
                "phone": {
                    "type": "string",
                    "description": "The customer\'s phone number"
                },
                "company": {
                    "type": "string",
                    "description": "The customer\'s company or organization"
                },
                "notes": {
                    "type": "string",
                    "description": "Any additional notes or context from the conversation"
                }
            }
        }
    )
    def collect_customer_info(self, args, raw_data):
        """Collect and store structured customer information on global_data."""
        name = args.get("name", "")
        email = args.get("email", "")
        phone = args.get("phone", "")
        company = args.get("company", "")
        notes = args.get("notes", "")

        result = SwaigFunctionResult(
            f"Got it, I\'ve recorded {\'your\' if name else \'the\'} information. Is there anything else I can help with?"
        )
        result.update_global_data({
            "customer_info": {
                "name": name,
                "email": email,
                "phone": phone,
                "company": company,
                "notes": notes[:500],
            }
        })
        return result'''
    return method, {}


SWAIG_TEMPLATES["collect_customer_info"] = _build_collect_customer_info


def _build_send_email(employee_config: dict) -> tuple:
    default_from_name = employee_config.get("email_from_name") or employee_config.get("name", "Agent")
    safe_default_from_name = default_from_name.replace('"', '\\"')

    method = f'''    @AgentBase.tool(
        name="send_email",
        description="Send a follow-up email to the caller. Collects their email address and sends a message with call details, confirmations, or any relevant information.",
        parameters={{
            "type": "object",
            "properties": {{
                "to_email": {{
                    "type": "string",
                    "description": "The recipient\'s email address"
                }},
                "subject": {{
                    "type": "string",
                    "description": "Email subject line"
                }},
                "body": {{
                    "type": "string",
                    "description": "Email body content — include call summary, action items, or relevant details"
                }}
            }},
            "required": ["to_email", "subject", "body"]
        }}
    )
    def send_email(self, args, raw_data):
        """Send an email via SendGrid (requires `pip install sendgrid`)."""
        to_email = args.get("to_email", "")
        subject = args.get("subject", "")
        body = args.get("body", "")

        sendgrid_api_key = os.environ.get("SENDGRID_API_KEY", "")
        from_email = os.environ.get("HIREWIRE_EMAIL_FROM_ADDRESS", "")
        from_name = os.environ.get("HIREWIRE_EMAIL_FROM_NAME", "") or "{safe_default_from_name}"

        if not to_email or "@" not in to_email:
            return SwaigFunctionResult(
                "I need a valid email address to send to. Could you please provide your email?"
            )

        if not sendgrid_api_key or not from_email:
            result = SwaigFunctionResult(
                "Email isn\'t set up for this agent yet. Let me take a note of your request instead."
            )
            result.update_global_data({{
                "email_requested": {{
                    "to": to_email,
                    "subject": subject,
                    "body": body[:500],
                    "status": "not_configured",
                }}
            }})
            return result

        try:
            from sendgrid import SendGridAPIClient
            from sendgrid.helpers.mail import Mail

            message = Mail(
                from_email=(from_email, from_name),
                to_emails=to_email,
                subject=subject or f"Follow-up from {{from_name}}",
                plain_text_content=body,
            )
            sg = SendGridAPIClient(sendgrid_api_key)
            response = sg.send(message)

            result = SwaigFunctionResult(f"I\'ve sent an email to {{to_email}}.")
            result.update_global_data({{
                "email_sent": {{
                    "to": to_email,
                    "subject": subject,
                    "status": "sent",
                    "status_code": response.status_code,
                }}
            }})
            return result
        except Exception as e:
            result = SwaigFunctionResult(
                "I\'m sorry, I wasn\'t able to send the email right now. I\'ve noted your request for our team."
            )
            result.update_global_data({{
                "email_requested": {{
                    "to": to_email,
                    "subject": subject,
                    "body": body[:500],
                    "status": "failed",
                    "error": str(e)[:200],
                }}
            }})
            return result'''
    return method, {}


SWAIG_TEMPLATES["send_email"] = _build_send_email


def _build_begin_assist(employee_config: dict) -> tuple:
    method = '''    @AgentBase.tool(
        name="begin_assist",
        description="Call this when the caller has stated their reason for calling and you are ready to start helping them.",
        parameters={"type": "object", "properties": {}}
    )
    def begin_assist(self, args, raw_data):
        """Step transition: greet -> assist."""
        return SwaigFunctionResult("Got it, let me help with that.")'''
    return method, {}


def _build_wrap_up_call(employee_config: dict) -> tuple:
    method = '''    @AgentBase.tool(
        name="wrap_up_call",
        description="Call this when the caller's request is fully addressed and you are ready to close the call.",
        parameters={"type": "object", "properties": {}}
    )
    def wrap_up_call(self, args, raw_data):
        """Step transition: assist -> wrap_up."""
        return SwaigFunctionResult("Let me wrap things up.")'''
    return method, {}


SWAIG_TEMPLATES["begin_assist"] = _build_begin_assist
SWAIG_TEMPLATES["wrap_up_call"] = _build_wrap_up_call


def contexts_block(employee_config: dict) -> str:
    """Emit the `define_contexts()` + 3 `add_step(...)` calls mirroring
    VirtualEmployeeAgent._build_employee_context.

    Returns a code-string ready to insert into the generated agent's
    __init__ method at one indent level inside the class body.
    """
    name = employee_config.get("name", "Assistant")
    role = employee_config.get("role", "Virtual Assistant")
    greeting = employee_config.get("greeting") or f"Hello, I am {name}."
    prompt_body = employee_config.get("prompt") or "Help the caller with their request."
    enabled_functions = employee_config.get("enabled_functions") or []

    greet_functions = ["begin_assist"]
    if "check_business_hours" in enabled_functions:
        greet_functions.append("check_business_hours")
    assist_functions = [fn for fn in enabled_functions if fn != "send_summary_sms"]
    assist_functions.append("wrap_up_call")
    wrap_up_functions = ["send_summary_sms"] if "send_summary_sms" in enabled_functions else []

    greet_text = (
        f'You are {name}, a {role}. Open the call with: "{greeting}". '
        "After greeting, listen for what the caller needs. Keep replies to 1-3 sentences. "
        "When the caller has stated what they're calling about, call begin_assist() to start helping."
    )

    assist_text = (
        f"{prompt_body}\n\n"
        "Use the available SWAIG functions when appropriate. When the caller's request is fully "
        "addressed, call wrap_up_call() to close the call gracefully."
    )

    wrap_up_parts = ["Wrap the call. Briefly recap what happened in 1 sentence."]
    if "send_summary_sms" in enabled_functions:
        wrap_up_parts.append(
            "Then offer to text a summary to the caller's phone. If they say yes, ask for the "
            "number and call send_summary_sms with a short summary."
        )
    wrap_up_parts.append("Thank the caller and end the call.")
    wrap_up_text = " ".join(wrap_up_parts)

    return (
        "        contexts = self.define_contexts()\n"
        "        ctx = contexts.add_context(\"default\")\n"
        "\n"
        f"        ctx.add_step(\"greet\") \\\n"
        f"            .set_text({json.dumps(greet_text)}) \\\n"
        "            .set_step_criteria(\"Caller has stated their reason for calling\") \\\n"
        "            .set_valid_steps([\"assist\"]) \\\n"
        f"            .set_functions({json.dumps(greet_functions)})\n"
        "\n"
        f"        ctx.add_step(\"assist\") \\\n"
        f"            .set_text({json.dumps(assist_text)}) \\\n"
        "            .set_step_criteria(\"Caller's request handled or escalated\") \\\n"
        "            .set_valid_steps([\"wrap_up\"]) \\\n"
        f"            .set_functions({json.dumps(assist_functions)})\n"
        "\n"
        f"        ctx.add_step(\"wrap_up\") \\\n"
        f"            .set_text({json.dumps(wrap_up_text)}) \\\n"
        f"            .set_functions({json.dumps(wrap_up_functions)})\n"
    )
