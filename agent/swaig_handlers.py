"""SWAIG handlers for HireWire virtual employees.

This module owns every SWAIG tool's schema and behavior as plain functions.
Both the live VirtualEmployeeAgent and the generated standalone agent files
consume the same constants and call the same handler functions.

Self-contained: depends only on stdlib + signalwire_agents.SwaigFunctionResult.
"""
from __future__ import annotations

import logging
import os
import re
from datetime import datetime
from typing import Any, Dict

from signalwire_agents import SwaigFunctionResult

logger = logging.getLogger(__name__)


# ============================================================================
# Schema constants — name/description/parameters for each SWAIG tool.
# Consumed by @AgentBase.tool(**SCHEMA) in both the live agent and generated
# standalone agents. Keep these in sync with the SWAIG calls expected by callers.
# ============================================================================

TRANSFER_TO_HUMAN = {
    "name": "transfer_to_human",
    "description": "Transfer the call to a human representative at a real phone number",
    "parameters": {
        "type": "object",
        "properties": {
            "department": {
                "type": "string",
                "description": "Department to transfer to (e.g. sales, support, general)",
            },
            "reason": {
                "type": "string",
                "description": "Brief reason for the transfer",
            },
        },
    },
}

SEND_SUMMARY_SMS = {
    "name": "send_summary_sms",
    "description": "Send an SMS text message to the caller's phone number. Can send call summaries, confirmations, follow-ups, or any custom message. Ask for their phone number first.",
    "parameters": {
        "type": "object",
        "properties": {
            "phone_number": {
                "type": "string",
                "description": "The caller's phone number to send the SMS to (E.164 format)",
            },
            "message": {
                "type": "string",
                "description": "The text message to send — can be a call summary, confirmation, or any relevant message",
            },
            "caller_info": {
                "type": "string",
                "description": "Caller name and contact info if provided",
            },
        },
        "required": ["phone_number", "message"],
    },
}

SCHEDULE_CALLBACK = {
    "name": "schedule_callback",
    "description": "Schedule a PHONE CALLBACK for later. Collects name, number, preferred time, and reason. This is NOT for sending text messages — use send_summary_sms for that.",
    "parameters": {
        "type": "object",
        "properties": {
            "caller_name": {"type": "string", "description": "The caller's name"},
            "callback_number": {"type": "string", "description": "Phone number to call back"},
            "preferred_time": {"type": "string", "description": "When the caller would like to be called back"},
            "reason": {"type": "string", "description": "Reason for the callback"},
        },
        "required": ["caller_name", "callback_number", "preferred_time"],
    },
}

CHECK_BUSINESS_HOURS = {
    "name": "check_business_hours",
    "description": "Check if the business is currently open and provide hours information",
    "parameters": {"type": "object", "properties": {}},
}

COLLECT_CUSTOMER_INFO = {
    "name": "collect_customer_info",
    "description": "Collect structured customer information during the call. Gather details conversationally — name, email, phone, company, and any notes. Call this once you have collected the relevant details.",
    "parameters": {
        "type": "object",
        "properties": {
            "name": {"type": "string", "description": "The customer's full name"},
            "email": {"type": "string", "description": "The customer's email address"},
            "phone": {"type": "string", "description": "The customer's phone number"},
            "company": {"type": "string", "description": "The customer's company or organization"},
            "notes": {"type": "string", "description": "Any additional notes or context from the conversation"},
        },
    },
}

SEND_EMAIL = {
    "name": "send_email",
    "description": "Send a follow-up email to the caller. Collects their email address and sends a message with call details, confirmations, or any relevant information.",
    "parameters": {
        "type": "object",
        "properties": {
            "to_email": {"type": "string", "description": "The recipient's email address"},
            "subject": {"type": "string", "description": "Email subject line"},
            "body": {"type": "string", "description": "Email body content — include call summary, action items, or relevant details"},
        },
        "required": ["to_email", "subject", "body"],
    },
}


# ============================================================================
# Post-prompt template — emitted verbatim by both the live agent (via
# _configure_post_prompt) and every generated standalone agent.
# Generates JSON with 6 fields: summary, caller_intent, outcome, sentiment,
# topics, and follow_up.
# ============================================================================

POST_PROMPT_TEMPLATE = (
    "Summarize this conversation as JSON with exactly these fields:\n"
    '- "summary": 2-3 sentence summary of the call\n'
    '- "caller_intent": what the caller wanted (1 sentence)\n'
    '- "outcome": one of "resolved", "transferred", "abandoned", or "follow_up_needed"\n'
    '- "sentiment": one of "positive", "neutral", or "negative"\n'
    '- "topics": array of topic keyword strings\n'
    '- "follow_up": any action items or follow-up needed (null if none)\n'
    "Respond ONLY with the JSON object, no extra text."
)


# ============================================================================
# Helper functions
# ============================================================================

def clean_phone_number(number: str) -> str:
    """Sanitize phone number to E.164 format — strip hyphens, spaces, parens."""
    if not number:
        return ""
    cleaned = re.sub(r"[^\d+]", "", number)
    if cleaned and not cleaned.startswith("+"):
        cleaned = "+" + cleaned
    return cleaned


# ============================================================================
# Handler functions — (config, args, raw_data) -> SwaigFunctionResult
# ============================================================================

def transfer_to_human(config: Dict[str, Any], args: Dict[str, Any], raw_data: Dict[str, Any]) -> SwaigFunctionResult:
    """Transfer call to a configured phone number."""
    employee_id = config.get("id", "?")
    department = args.get("department", "general")
    reason = args.get("reason", "Requested human assistance")
    number = config.get("transfer_number", "")

    logger.info(f"[{employee_id}] Transfer requested to {number or 'NO NUMBER'} - {department}: {reason}")

    if not number:
        result = SwaigFunctionResult(
            "I'm sorry, there's no transfer number configured right now. "
            "Let me take a message instead so someone can call you back."
        )
        return result

    result = SwaigFunctionResult(
        f"I'll connect you with our {department} team now. Please hold.",
        post_process=True,
    )
    # Use transfer_from if set, otherwise fall back to assigned phone_number
    from_addr = config.get("transfer_from") or config.get("phone_number") or None
    result.connect(number, final=True, from_addr=from_addr)
    return result


def send_summary_sms(config: Dict[str, Any], args: Dict[str, Any], raw_data: Dict[str, Any]) -> SwaigFunctionResult:
    """Send an SMS with the call summary to a number the caller provided."""
    employee_id = config.get("id", "?")
    phone_number_raw = args.get("phone_number", "")
    message = args.get("message", "") or args.get("summary", "No message provided")
    caller_info = args.get("caller_info", "")
    from_number = config.get("sms_from_number", "")

    # Sanitize phone number to clean E.164
    phone_number = clean_phone_number(phone_number_raw)

    logger.info(
        f"[{employee_id}] SMS summary requested to {phone_number or 'NO NUMBER'} "
        f"(raw: {phone_number_raw}) from {from_number or 'NO FROM NUMBER'}"
    )

    if not phone_number or len(phone_number) < 10:
        return SwaigFunctionResult(
            "I need a valid phone number to send the summary. "
            "Could you please provide your full phone number including area code?"
        )

    if not from_number:
        logger.warning(f"[{employee_id}] SMS skipped — no sms_from_number configured")
        return SwaigFunctionResult(
            "I'm sorry, text messaging is not set up for this agent right now. "
            "I've noted the summary for our team."
        )

    # Build SMS body — keep concise to avoid over_data_limit
    agent_name = config.get("name", "Agent")
    # Truncate message to stay within SMS limits
    max_message_len = 300
    if len(message) > max_message_len:
        message = message[:max_message_len] + "..."
    parts = [f"[SignalWire] {agent_name} Call Summary:"]
    if caller_info:
        parts.append(f"Caller: {caller_info}")
    parts.append(message)
    parts.append("REPLY STOP TO STOP")
    body = "\n".join(parts)

    try:
        result = SwaigFunctionResult(f"I've sent a text summary to {phone_number_raw}.")
        result.send_sms(phone_number, from_number, body)
        return result
    except Exception as e:
        logger.error(f"[{employee_id}] SMS send failed: {e}")
        return SwaigFunctionResult(
            "I'm sorry, I wasn't able to send the text message right now. "
            "I've noted the summary for our team instead."
        )


def schedule_callback(config: Dict[str, Any], args: Dict[str, Any], raw_data: Dict[str, Any]) -> SwaigFunctionResult:
    """Collect callback request details and store them."""
    employee_id = config.get("id", "?")
    caller_name = args.get("caller_name", "")
    callback_number = args.get("callback_number", "")
    preferred_time = args.get("preferred_time", "")
    reason = args.get("reason", "")

    logger.info(f"[{employee_id}] Callback scheduled for {caller_name} at {preferred_time}")

    result = SwaigFunctionResult(
        f"I've scheduled a callback for {caller_name} at {preferred_time}. "
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
    return result


def check_business_hours(config: Dict[str, Any], args: Dict[str, Any], raw_data: Dict[str, Any]) -> SwaigFunctionResult:
    """Return business hours — uses config or defaults."""
    now = datetime.now()
    hour = now.hour
    weekday = now.weekday()  # 0=Monday, 6=Sunday

    start = config.get("business_hours_start", 9)
    end = config.get("business_hours_end", 18)
    days = config.get("business_days", [0, 1, 2, 3, 4])

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


def collect_customer_info(config: Dict[str, Any], args: Dict[str, Any], raw_data: Dict[str, Any]) -> SwaigFunctionResult:
    """Collect and store structured customer information."""
    employee_id = config.get("id", "?")
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

    logger.info(f"[{employee_id}] Customer info collected: {', '.join(collected_fields) or 'no fields'}")

    result = SwaigFunctionResult(
        f"Got it, I've recorded {'your' if name else 'the'} information. Is there anything else I can help with?"
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
    return result


def send_email(config: Dict[str, Any], args: Dict[str, Any], raw_data: Dict[str, Any]) -> SwaigFunctionResult:
    """Send an email via SendGrid."""
    employee_id = config.get("id", "?")
    to_email = args.get("to_email", "")
    subject = args.get("subject", "")
    body = args.get("body", "")

    sendgrid_api_key = config.get("sendgrid_api_key", "") or os.getenv("SENDGRID_API_KEY", "")
    from_email = config.get("email_from_address", "")
    from_name = config.get("email_from_name", "") or config.get("name", "Agent")

    logger.info(f"[{employee_id}] Email requested to {to_email} from {from_email or 'NOT CONFIGURED'}")

    if not to_email or "@" not in to_email:
        return SwaigFunctionResult(
            "I need a valid email address to send to. Could you please provide your email?"
        )

    if not sendgrid_api_key or not from_email:
        logger.warning(f"[{employee_id}] Email skipped — SendGrid not configured")
        result = SwaigFunctionResult(
            "Email isn't set up for this agent yet. Let me take a note of your request instead."
        )
        result.update_global_data({
            "email_requested": {
                "to": to_email,
                "subject": subject,
                "body": body[:500],
                "status": "not_configured",
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
            plain_text_content=body,
        )

        sg = SendGridAPIClient(sendgrid_api_key)
        response = sg.send(message)

        logger.info(f"[{employee_id}] Email sent to {to_email}, status: {response.status_code}")

        result = SwaigFunctionResult(f"I've sent an email to {to_email}.")
        result.update_global_data({
            "email_sent": {
                "to": to_email,
                "subject": subject,
                "status": "sent",
                "status_code": response.status_code,
            }
        })
        return result

    except Exception as e:
        logger.error(f"[{employee_id}] Email send failed: {e}")
        result = SwaigFunctionResult(
            "I'm sorry, I wasn't able to send the email right now. I've noted your request for our team."
        )
        result.update_global_data({
            "email_requested": {
                "to": to_email,
                "subject": subject,
                "body": body[:500],
                "status": "failed",
                "error": str(e)[:200],
            }
        })
        return result


# ============================================================================
# Registry — fn id → (schema, handler)
# ============================================================================

HANDLERS: Dict[str, tuple] = {
    "transfer_to_human": (TRANSFER_TO_HUMAN, transfer_to_human),
    "send_summary_sms": (SEND_SUMMARY_SMS, send_summary_sms),
    "schedule_callback": (SCHEDULE_CALLBACK, schedule_callback),
    "check_business_hours": (CHECK_BUSINESS_HOURS, check_business_hours),
    "collect_customer_info": (COLLECT_CUSTOMER_INFO, collect_customer_info),
    "send_email": (SEND_EMAIL, send_email),
}
