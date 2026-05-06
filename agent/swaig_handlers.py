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
# ============================================================================

POST_PROMPT_TEMPLATE = (
    "You have just finished a phone conversation. Produce a JSON object summarizing it. "
    "ALWAYS produce valid JSON — do not add commentary, do not wrap in code fences, "
    "do not refuse. If the call was short, silent, or had no clear content, still "
    "produce the JSON with reasonable defaults (empty strings, empty arrays, null where appropriate).\n"
    "\n"
    "Required fields (every one must appear, even if empty):\n"
    '  "summary": 2-3 sentence summary of what happened. If nothing happened, say so plainly.\n'
    '  "caller_intent": one sentence describing what the caller wanted. Empty string if unclear.\n'
    '  "outcome": one of "resolved" | "transferred" | "abandoned" | "follow_up_needed" | "no_outcome".\n'
    '  "sentiment": one of "positive" | "neutral" | "negative".\n'
    '  "topics": array of 1-5 lowercase topic keywords. Empty array if none.\n'
    '  "follow_up": any action items, or null.\n'
    '  "key_quotes": array of up to 3 short verbatim quotes from the caller. Empty array if none.\n'
    '  "next_steps": array of recommended next steps for the agent owner. Empty array if none.\n'
    "\n"
    "Output ONLY the JSON object. No preamble, no postscript, no markdown fences."
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


# Handler bodies and HANDLERS registry are added in Task 3.
