#!/usr/bin/env python3
"""
Sally Sales AI Agent Backend - Multi-Employee Support

This backend serves multiple SWML agents, one for each virtual employee.
Each employee has their own configuration and SWML endpoint.
"""

import os
import re
import uuid
import json
import logging
import sqlite3
import urllib.request
import urllib.error
from pathlib import Path as _Path
from datetime import datetime
from typing import Dict, Any, Optional
from dotenv import load_dotenv

from signalwire_agents import AgentBase, SwaigFunctionResult
from fastapi import FastAPI, Request, HTTPException, Path
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import PlainTextResponse

import uvicorn

from agent.sdk_code_templates import (
    SWAIG_TEMPLATES,
    datasphere_block,
    env_var_header,
)

# Module-level language-code → language-name map.  Used by both
# VirtualEmployeeAgent._get_language_name and _generate_sdk_code.
_LANGUAGE_MAP = {
    "en": "English", "en-US": "English", "en-GB": "English",
    "en-AU": "English", "en-IN": "English", "en-NZ": "English",
    "es": "Spanish", "es-ES": "Spanish", "es-419": "Spanish",
    "fr": "French", "fr-FR": "French", "fr-CA": "French",
    "de": "German", "de-DE": "German",
    "it": "Italian", "it-IT": "Italian",
    "pt": "Portuguese", "pt-BR": "Portuguese", "pt-PT": "Portuguese",
    "ja": "Japanese", "ja-JP": "Japanese",
    "zh": "Chinese", "zh-CN": "Chinese",
    "ko": "Korean", "ko-KR": "Korean",
    "hi": "Hindi", "ru": "Russian", "nl": "Dutch", "pl": "Polish",
    "sv": "Swedish", "sv-SE": "Swedish",
    "da": "Danish", "da-DK": "Danish",
    "tr": "Turkish", "vi": "Vietnamese", "uk": "Ukrainian",
    "multi": "Multilingual",
}

# Load environment variables from .env file
load_dotenv()

# Load credentials and domain from .env
SWML_USER = os.getenv('SWML_BASIC_AUTH_USER', 'signalwire')
SWML_PASSWORD = os.getenv('SWML_BASIC_AUTH_PASSWORD', 'signalwire')
APP_DOMAIN = os.getenv('APP_DOMAIN', '')
# Frontend URL the wizard uses to invoke the create-virtual-employee orchestration.
# Vite usually runs on 5000, but macOS Control Center / AirPlay grabs 5000 so it
# falls back to 5001. Defaults match local dev; override in production.
FRONTEND_URL = os.getenv('FRONTEND_URL', 'http://localhost:5001')
# SQLite path for credentials lookup — same DB the frontend uses.
WEB_DB_PATH = os.getenv('DATABASE_PATH', str(_Path(__file__).parent.parent / 'web' / 'data' / 'sally_sales.db'))


def _detect_ngrok_url() -> Optional[str]:
    """Query ngrok local API to get the current public tunnel URL."""
    try:
        import urllib.request
        resp = urllib.request.urlopen("http://localhost:4040/api/tunnels", timeout=2)
        data = json.loads(resp.read())
        for tunnel in data.get("tunnels", []):
            if tunnel.get("proto") == "https":
                return tunnel["public_url"]
    except Exception:
        pass
    return None

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Global storage for agent credentials
agent_credentials = {
    "username": SWML_USER,
    "password": SWML_PASSWORD,
    "app_domain": APP_DOMAIN
}

# Global storage for employee configurations
# Key: employee_id, Value: employee config dict
employees: Dict[str, Dict[str, Any]] = {}

# Global storage for agent instances
# Key: employee_id, Value: Agent instance
agent_instances: Dict[str, AgentBase] = {}


class VirtualEmployeeAgent(AgentBase):
    """Dynamic AI agent for a virtual employee"""

    def __init__(self, employee_config: Dict[str, Any]):
        self.employee_id = employee_config['id']
        self.employee_config = employee_config

        # Initialize agent with employee-specific route
        super().__init__(
            name=employee_config.get('name', 'Employee'),
            route=f"/swml/{self.employee_id}"
        )

        # Configure voice and language
        voice = employee_config.get('voice', 'openai.nova')
        language_code = employee_config.get('language', 'en-US')
        language_name = self._get_language_name(language_code)

        self.add_language(
            name=language_name,
            code=language_code,
            voice=voice,
            speech_fillers=[
                "Let me help you with that...",
                "One moment please...",
                "I'm processing your request..."
            ],
            function_fillers=[
                "Let me check on that for you...",
                "I'm looking that up now..."
            ]
        )

        # Speech recognition hints
        speech_hints = employee_config.get('speech_hints', [])
        if isinstance(speech_hints, list):
            self.speech_hints = speech_hints
        else:
            self.speech_hints = [
                "help", "support", "agent", "representative"
            ]

        # Configure personality
        self._update_personality()

        # Configure post-prompt for call analytics
        self._configure_post_prompt()

        # Add enabled functions
        self._configure_functions()

    def _get_language_name(self, code: str) -> str:
        """Get language name from code"""
        return _LANGUAGE_MAP.get(code, "English")

    def _update_personality(self):
        """Update agent personality from employee config using POM sections"""
        name = self.employee_config.get('name', 'Assistant')
        role = self.employee_config.get('role', 'Virtual Assistant')
        greeting = self.employee_config.get('greeting', f'Hello, I am {name}.')
        prompt = self.employee_config.get('prompt', '')

        # Identity section
        self.prompt_add_section(
            "Identity",
            body=f"You are {name}, a {role}. Your greeting is: \"{greeting}\""
        )

        # Main instructions from the user's prompt (may contain markdown sections)
        if prompt:
            self.prompt_add_section("Instructions", body=prompt)

        # Voice interaction guidelines
        guidelines = [
            "Keep responses to 1-3 sentences — this is a phone call, not a text chat",
            "Be conversational and natural, not robotic",
            "Listen fully before responding",
            "If you are unsure about something, say so and offer to connect the caller with a human",
            "Always end interactions with a clear next step",
        ]

        # Add SMS offer guideline if send_summary_sms is enabled
        enabled_functions = self.employee_config.get('enabled_functions', [])
        if 'send_summary_sms' in enabled_functions:
            guidelines.append(
                "Before ending the call, ask the caller if they would like a summary sent to their phone via text message. "
                "If yes, ask for their phone number, then use the send_summary_sms function."
            )

        self.prompt_add_section(
            "Voice Interaction Guidelines",
            bullets=guidelines
        )

        # Set temperature
        temperature = self.employee_config.get('temperature', 0.7)
        self.set_param("temperature", temperature)

    def _configure_post_prompt(self):
        """Configure post-prompt to generate a structured call summary.

        IMPORTANT: SignalWire's AI engine renders the post-prompt at end-of-call
        regardless of conversation length. The instruction must be self-contained
        and produce valid JSON even when the call was very short or one-sided.
        """
        self.set_post_prompt(
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
                doc_descriptions = []
                for doc in documents:
                    doc_id = doc.get('document_id', '') if isinstance(doc, dict) else doc
                    doc_name = doc.get('name', doc_id[:8]) if isinstance(doc, dict) else doc_id[:8]
                    doc_desc = doc.get('description', '') if isinstance(doc, dict) else ''
                    doc_distance = doc.get('distance', 3.0) if isinstance(doc, dict) else 3.0

                    if doc_id:
                        import hashlib
                        doc_hash = hashlib.md5(str(doc_id).encode()).hexdigest()[:6]
                        safe_name = doc_name.lower().replace(' ', '_').replace('-', '_')[:20]
                        tool_name = f"search_{safe_name}_{doc_hash}"
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
                    self.prompt_add_section("Knowledge Base Routing", body=routing)
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

        # Remove SWAIG tools not in the enabled list
        # Note: search_knowledge is a skill, not a SWAIG tool — skip it in this filter.
        # Also skip functions registered by skills (e.g. DataSphere) so they are
        # not mistakenly wiped out by the cleanup loop.
        swaig_functions = [f for f in enabled_functions if f != 'search_knowledge']
        if enabled_functions:
            # Collect function names registered by skills (e.g. DataSphere) so the
            # removal loop below never wipes them out. Skills set their tool_name
            # attribute during setup().
            skill_function_names: set[str] = {
                getattr(instance, "tool_name", None)
                for instance in self.skill_manager.loaded_skills.values()
                if getattr(instance, "tool_name", None)
            }
            all_functions = list(self._tool_registry.get_all_functions().keys())
            for func_name in all_functions:
                if func_name not in swaig_functions and func_name not in skill_function_names:
                    self._tool_registry.remove_function(func_name)
                    logger.info(f"  Removed function '{func_name}' (not in enabled list)")

    # ------------------------------------------------------------------
    # SWAIG Functions — real actions via SwaigFunctionResult
    # ------------------------------------------------------------------

    @AgentBase.tool(
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
        """Transfer call to a configured phone number"""
        department = args.get("department", "general")
        reason = args.get("reason", "Requested human assistance")
        number = self.employee_config.get("transfer_number", "")

        logger.info(f"[{self.employee_id}] Transfer requested to {number or 'NO NUMBER'} - {department}: {reason}")

        if not number:
            result = SwaigFunctionResult(
                "I'm sorry, there's no transfer number configured right now. "
                "Let me take a message instead so someone can call you back."
            )
            return result

        result = SwaigFunctionResult(
            f"I'll connect you with our {department} team now. Please hold.",
            post_process=True
        )
        # Use transfer_from if set, otherwise fall back to assigned phone_number
        from_addr = self.employee_config.get("transfer_from") or self.employee_config.get("phone_number") or None
        result.connect(number, final=True, from_addr=from_addr)
        return result


    @staticmethod
    def _clean_phone_number(number: str) -> str:
        """Sanitize phone number to E.164 format — strip hyphens, spaces, parens."""
        import re
        if not number:
            return ""
        cleaned = re.sub(r'[^\d+]', '', number)
        if cleaned and not cleaned.startswith('+'):
            cleaned = '+' + cleaned
        return cleaned

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
    def send_summary_sms(self, args, raw_data):
        """Send an SMS with the call summary to a number the caller provided"""
        phone_number_raw = args.get("phone_number", "")
        message = args.get("message", "") or args.get("summary", "No message provided")
        caller_info = args.get("caller_info", "")
        from_number = self.employee_config.get("sms_from_number", "")

        # Sanitize phone number to clean E.164
        phone_number = self._clean_phone_number(phone_number_raw)

        logger.info(f"[{self.employee_id}] SMS summary requested to {phone_number or 'NO NUMBER'} (raw: {phone_number_raw}) from {from_number or 'NO FROM NUMBER'}")

        if not phone_number or len(phone_number) < 10:
            return SwaigFunctionResult(
                "I need a valid phone number to send the summary. Could you please provide your full phone number including area code?"
            )

        if not from_number:
            logger.warning(f"[{self.employee_id}] SMS skipped — no sms_from_number configured")
            return SwaigFunctionResult(
                "I'm sorry, text messaging is not set up for this agent right now. I've noted the summary for our team."
            )

        # Build SMS body — keep concise to avoid over_data_limit
        agent_name = self.employee_config.get("name", "Agent")
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
            logger.error(f"[{self.employee_id}] SMS send failed: {e}")
            return SwaigFunctionResult(
                "I'm sorry, I wasn't able to send the text message right now. I've noted the summary for our team instead."
            )

    @AgentBase.tool(
        name="schedule_callback",
        description="Schedule a PHONE CALLBACK for later. Collects name, number, preferred time, and reason. This is NOT for sending text messages — use send_summary_sms for that.",
        parameters={
            "type": "object",
            "properties": {
                "caller_name": {
                    "type": "string",
                    "description": "The caller's name"
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
        """Collect callback request details and store them"""
        caller_name = args.get("caller_name", "")
        callback_number = args.get("callback_number", "")
        preferred_time = args.get("preferred_time", "")
        reason = args.get("reason", "")

        logger.info(f"[{self.employee_id}] Callback scheduled for {caller_name} at {preferred_time}")

        result = SwaigFunctionResult(
            f"I've scheduled a callback for {caller_name} at {preferred_time}. "
            "Someone from our team will reach out to you then."
        )
        result.update_global_data({
            "callback": {
                "name": caller_name,
                "number": callback_number,
                "time": preferred_time,
                "reason": reason[:100]
            }
        })
        return result

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

    def on_swml_request(self, request_data=None, callback_path=None, request=None):
        """Override to dynamically set video URLs and enable live transcription"""
        # Get the host from the request object if available
        host = None

        if request:
            host = request.headers.get('x-forwarded-host') or request.headers.get('host')
            protocol = request.headers.get('x-forwarded-proto', 'https')

            if host and ('localhost' in host or '127.0.0.1' in host):
                protocol = 'http'

        # Set video URLs from employee config (or fall back to defaults)
        base_url = (f"{protocol}://{host}" if host else APP_DOMAIN) or ""
        idle_url = self.employee_config.get("video_idle_url", "")
        talking_url = self.employee_config.get("video_talking_url", "")

        # Use config URLs if set, otherwise fall back to default paths
        if not idle_url and base_url:
            idle_url = f"{base_url}/videos/sally_idle.mp4"
        if not talking_url and base_url:
            talking_url = f"{base_url}/videos/sally_talking.mp4"

        if idle_url:
            self.set_param("video_idle_file", idle_url)
        if talking_url:
            self.set_param("video_talking_file", talking_url)

        if idle_url or talking_url:
            logger.info(f"[{self.employee_id}] Video URLs: idle={idle_url}, talking={talking_url}")
        else:
            logger.warning(f"[{self.employee_id}] No video URLs available")

        # Set post_prompt_url — prefer APP_DOMAIN (points to frontend where handler lives)
        post_prompt_domain = APP_DOMAIN or (f"{protocol}://{host}" if host else None)
        if post_prompt_domain:
            post_prompt_path = f"{post_prompt_domain}/api/post-prompt/{self.employee_id}"
            self.set_post_prompt_url(post_prompt_path)
            logger.info(f"[{self.employee_id}] Set post_prompt_url to: {post_prompt_path}")
        else:
            logger.warning(f"[{self.employee_id}] Cannot set post_prompt_url — no domain available")

        # Enable live transcription
        self.add_verb("live_transcribe", {
            "action": "start",
            "lang": self.employee_config.get('language', 'en-US').split('-')[0],
            "live_events": True,
            "direction": ["remote-caller", "local-caller"]
        })

        return super().on_swml_request(request_data, callback_path, request)


def _wizard_lookup_user_credentials(project_id: str) -> Optional[Dict[str, str]]:
    """Look up the user's SignalWire credentials from the SQLite DB by project_id.

    Returns {spaceUrl, projectId, apiToken} or None if not found.
    The DB is populated by the frontend's upsertUser when the user logs in.
    """
    if not project_id:
        return None
    try:
        conn = sqlite3.connect(f"file:{WEB_DB_PATH}?mode=ro", uri=True, timeout=2.0)
        try:
            row = conn.execute(
                "SELECT space_url, api_token FROM users WHERE project_id = ?",
                (project_id,),
            ).fetchone()
        finally:
            conn.close()
        if not row:
            return None
        return {"spaceUrl": row[0], "projectId": project_id, "apiToken": row[1]}
    except Exception as e:
        logger.warning(f"[wizard] credential lookup failed: {e}")
        return None


# Track in-flight create_agent calls per (call_id, name) so SignalWire's
# tool-call retries don't create duplicate employees.
_wizard_create_inflight: Dict[str, Dict[str, Any]] = {}


def _wizard_create_employee_via_frontend(employee_data: Dict[str, Any], credentials: Dict[str, str]) -> Dict[str, Any]:
    """POST to the frontend's create-virtual-employee orchestration.

    The orchestration verifies the SWML webhook (~10s), creates a SignalWire
    Fabric resource, and persists to SQLite — typically 5-15s, but can exceed
    30s if ngrok is slow. We wait up to 120s before giving up.

    Returns the parsed JSON response (with .employee + callFabricAddress)
    or raises an exception with a useful message.
    """
    url = f"{FRONTEND_URL}/api/signalwire/create-virtual-employee"
    body = json.dumps({"employeeData": employee_data, "credentials": credentials}).encode()
    req = urllib.request.Request(
        url,
        data=body,
        method="POST",
        headers={"Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=120.0) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as e:
        try:
            err_body = e.read().decode()
        except Exception:
            err_body = ""
        raise RuntimeError(f"frontend returned {e.code}: {err_body or e.reason}") from e
    except urllib.error.URLError as e:
        raise RuntimeError(f"could not reach frontend at {FRONTEND_URL}: {e.reason}") from e


class WizardAgent(AgentBase):
    """Builds new HireWire agents through a guided voice conversation.

    Implemented as a five-step Contexts/Steps state machine:
        identity -> voice -> capabilities -> review -> complete
    Each step gates which SWAIG functions the LLM can call. The server-side
    state machine — not the prompt — enforces ordering. Spec:
    docs/superpowers/specs/2026-05-05-wizard-contexts-steps-redesign.md
    """

    def __init__(self):
        super().__init__(
            name="Agent Wizard",
            route="/swml/wizard",
            host="0.0.0.0",
            port=3000,
        )

        # Full transcript visibility in every SWAIG handler.
        self.set_params({"swaig_post_conversation": True})

        # Voice / language
        self.add_language(name="English", code="en-US", voice="openai.shimmer")

        # Base prompt (REQUIRED even when using contexts)
        self.prompt_add_section(
            "Identity",
            body=(
                "You are the Agent Wizard for HireWire — a warm, knowledgeable setup "
                "assistant who builds custom AI voice agents for the user through a "
                "short phone conversation."
            ),
        )

        # Initial call-scoped state
        self.set_global_data({
            "agent_draft": {
                "name": "",
                "role": "",
                "prompt_summary": "",
                "prompt": "",
                "voice": "",
                "language": "en-US",
                "greeting": "",
                "functions": [],
            },
            "created_agent": None,
            "current_step": "identity",
        })

        # Wizard state machine
        self._build_wizard_context()

        # Post-prompt summarization. Match the per-employee schema so call logs
        # for wizard sessions and built agents render uniformly in the dashboard.
        self.set_post_prompt(
            "You have just finished a wizard call to build a new AI agent. "
            "Produce a JSON object summarizing the session. ALWAYS produce valid JSON — "
            "do not add commentary, do not wrap in code fences, do not refuse. If the call "
            "was short or one-sided, still produce the JSON with reasonable defaults.\n"
            "\n"
            "Required fields (every one must appear, even if empty):\n"
            '  "summary": 2-3 sentences describing what was built (or what stalled).\n'
            '  "caller_intent": one sentence describing what kind of agent the user wanted.\n'
            '  "outcome": one of "agent_built" | "abandoned" | "follow_up_needed" | "no_outcome".\n'
            '  "sentiment": one of "positive" | "neutral" | "negative".\n'
            '  "topics": array of 1-5 lowercase topic keywords (e.g. "sales", "support", "scheduling").\n'
            '  "follow_up": any action items for the user, or null.\n'
            '  "key_quotes": array of up to 3 short verbatim quotes from the caller. Empty array if none.\n'
            '  "next_steps": array of recommended next steps. Empty array if none.\n'
            '  "agent_built_id": id of the agent that was created (the value returned by create_agent), '
            "or null if no agent was built.\n"
            "\n"
            "Output ONLY the JSON object. No preamble, no postscript, no markdown fences."
        )

    def _build_wizard_context(self):
        contexts = self.define_contexts()
        ctx = contexts.add_context("default")

        ctx.add_step("identity") \
            .set_text(
                "You are starting a wizard call to build a new AI voice agent for the user. "
                "Greet them warmly. Ask one question at a time. Start with: what kind of agent do they want to build, "
                "and what should it be called? "
                "After EACH user answer, immediately call update_agent_preview with whatever new field you just "
                "learned (name, role, or prompt_summary) so the live preview on the user's screen updates. "
                "\n\n"
                "If the user's description of the agent implies any capabilities — e.g. 'transfer to my cell' "
                "(transfer_to_human), 'send a follow-up text' (send_summary_sms), 'book callbacks' "
                "(schedule_callback), 'check business hours' (check_business_hours), 'collect their info' "
                "(collect_customer_info), 'send confirmation emails' (send_email) — silently include those in a "
                "subsequent update_agent_preview call with a `functions` array. Do NOT ask the user about "
                "capabilities here; just infer from what they say. "
                "\n\n"
                "When you have ALL three core fields (name, role, prompt_summary), call set_identity to advance "
                "to the voice step. DO NOT call set_voice, set_capabilities, or create_agent yet."
            ) \
            .set_step_criteria("Identity collected") \
            .set_valid_steps(["voice"]) \
            .set_functions(["set_identity", "update_agent_preview"])

        ctx.add_step("voice") \
            .set_text(
                "Help the user pick a voice. If they ask what's available, call list_voices. "
                "If they describe what they want (e.g. \"warm female\"), pick the closest match "
                "from the menu and confirm it. "
                "After the user picks, immediately call update_agent_preview with the voice so the screen reflects it, "
                "then call set_voice with the voice id to advance to capabilities. "
                "DO NOT call set_capabilities or create_agent yet — those belong to later steps."
            ) \
            .set_step_criteria("Voice selected") \
            .set_valid_steps(["capabilities"]) \
            .set_functions(["set_voice", "list_voices", "update_agent_preview"])

        ctx.add_step("capabilities") \
            .set_text(
                "Your job in this step is to collect ONE thing: the agent's opening greeting line. "
                "Ask: \"What should your agent say when it picks up?\" or similar. "
                "Do NOT prompt the user about capabilities or functions. Do NOT list available functions. "
                "Do NOT ask 'should it transfer calls?' or 'do you want it to send texts?'. "
                "\n\n"
                "INFER functions silently from the conversation so far. If anything the user already "
                "described implies a capability — for example they said 'transfer to my cell' (implies "
                "transfer_to_human), 'send a follow-up text' (send_summary_sms), 'book a callback' "
                "(schedule_callback), 'check if we're open' (check_business_hours), 'get their email' "
                "(collect_customer_info), 'send a confirmation email' (send_email) — silently call "
                "update_agent_preview with the inferred functions list. "
                "If the user spontaneously brings up a new capability while you're collecting the greeting, "
                "acknowledge it briefly and call update_agent_preview to add it. "
                "\n\n"
                "Available function ids you may infer: transfer_to_human, send_summary_sms, "
                "schedule_callback, check_business_hours, collect_customer_info, send_email. "
                "If nothing was mentioned, leave functions empty — that's fine. "
                "\n\n"
                "When you have the greeting line, call set_capabilities with functions (whatever you "
                "inferred, possibly empty) and the greeting. DO NOT call create_agent yet."
            ) \
            .set_step_criteria("Greeting collected") \
            .set_valid_steps(["review"]) \
            .set_functions(["set_capabilities", "update_agent_preview"])

        ctx.add_step("review") \
            .set_text(
                "The user is reviewing the full agent on screen. Recap it briefly aloud, then ask: "
                "\"Should I build it now, or change something first?\" "
                "If they ask to change anything (name, role, voice, greeting, capabilities, or the system prompt), "
                "call update_agent_preview with just the changed fields, then ask again. "
                "When they confirm with ANY affirmative ('yes', 'go', 'create it', 'do it', 'sounds good', "
                "'looks good', 'build it', 'ship it', or similar), call create_agent immediately — no arguments. "
                "create_agent reads the full draft from call state and commits it. "
                "If create_agent returns a failure message, tell the user what went wrong and offer to retry. "
                "Once create_agent succeeds, the wizard automatically advances to the complete step."
            ) \
            .set_step_criteria("Agent reviewed and approved") \
            .set_valid_steps(["complete"]) \
            .set_functions(["update_agent_preview", "create_agent"])

        ctx.add_step("complete") \
            .set_text(
                "The agent has been built. Briefly congratulate the user and offer to hand off "
                "the dial address so they can place a test call. When they say yes (or you've "
                "offered once), call finalize_agent. The wizard call will end shortly after that."
            ) \
            .set_functions(["finalize_agent"])
        # complete step is terminal — no set_valid_steps()

    # ---- Private helpers ---------------------------------------------

    def _merge_draft(self, raw_data, updates: dict) -> dict:
        """Shallow-merge updates into the current agent_draft from global_data.

        Returns the merged dict, suitable for passing to update_global_data.
        Skips keys whose values are None or empty strings so callers can
        safely pass partial updates without clobbering existing fields.
        """
        current = (raw_data or {}).get("global_data", {}).get("agent_draft", {}) or {}
        cleaned = {k: v for k, v in (updates or {}).items() if v is not None and v != ""}
        return {**current, **cleaned}

    def _agent_preview_event(self, draft: dict) -> dict:
        return {
            "type": "agent_preview",
            "name": draft.get("name", ""),
            "role": draft.get("role", ""),
            "prompt_summary": draft.get("prompt_summary", ""),
            "voice": draft.get("voice", ""),
            "functions": draft.get("functions", []),
            "greeting": draft.get("greeting", ""),
            "prompt": draft.get("prompt", ""),
        }

    def _checkpoint_event(self, stage: str) -> dict:
        return {"type": "wizard_checkpoint", "stage": stage}

    def _wizard_said(self, text: str) -> dict:
        return {"type": "wizard_said", "text": text}

    def on_swml_request(self, request_data=None, callback_path=None, request=None):
        """Override to set post_prompt_url dynamically based on the request host."""
        host = None
        protocol = 'https'

        if request:
            host = request.headers.get('x-forwarded-host') or request.headers.get('host')
            protocol = request.headers.get('x-forwarded-proto', 'https')
            if host and ('localhost' in host or '127.0.0.1' in host):
                protocol = 'http'

        post_prompt_domain = APP_DOMAIN or (f"{protocol}://{host}" if host else None)
        if post_prompt_domain:
            post_prompt_path = f"{post_prompt_domain}/api/post-prompt/wizard"
            self.set_post_prompt_url(post_prompt_path)
            logger.info(f"[wizard] Set post_prompt_url to: {post_prompt_path}")
        else:
            logger.warning("[wizard] Cannot set post_prompt_url — no domain available")

        return super().on_swml_request(request_data, callback_path, request)

    # ------------------------------------------------------------------
    # SWAIG handler stubs (Task 1) — bodies are added in Tasks 2-4
    # ------------------------------------------------------------------

    @AgentBase.tool(
        name="set_identity",
        description="Record the new agent's name, role, and one-sentence summary. Advances to the voice step.",
        parameters={
            "type": "object",
            "properties": {
                "name": {
                    "type": "string",
                    "description": "Agent's display name",
                },
                "role": {
                    "type": "string",
                    "description": "Agent's role label",
                },
                "prompt_summary": {
                    "type": "string",
                    "description": "One or two sentences describing what the agent does",
                },
            },
            "required": ["name", "role", "prompt_summary"],
        },
    )
    def set_identity(self, args, raw_data):
        call_id = (raw_data or {}).get("call_id") or "unknown"
        prev_step = (raw_data or {}).get("global_data", {}).get("current_step")
        logger.info("[wizard:%s] set_identity ENTRY prev_step=%s args=%s", call_id, prev_step, sorted(args.keys()))
        merged = self._merge_draft(raw_data, {
            "name": args.get("name"),
            "role": args.get("role"),
            "prompt_summary": args.get("prompt_summary"),
        })
        spoken = (
            f"Got it — building {merged.get('name','this agent')}, a {merged.get('role','')}. "
            f"Now, let's pick a voice. I have several options — would you like a "
            f"warm female voice, a confident male voice, or something else?"
        )
        return (
            SwaigFunctionResult(spoken)
                .update_global_data({"agent_draft": merged, "current_step": "voice"})
                .swml_change_step("voice")
                .swml_user_event(self._agent_preview_event(merged))
                .swml_user_event(self._checkpoint_event("identity"))
                .swml_user_event(self._wizard_said(spoken))
        )

    @AgentBase.tool(
        name="list_voices",
        description="Recite the available voice options. Does not transition steps.",
        parameters={
            "type": "object",
            "properties": {},
        },
    )
    def list_voices(self, args, raw_data):
        spoken = (
            "Here are some popular voices: openai.nova is a warm female voice, "
            "openai.shimmer is a softer female voice, openai.alloy is gender-neutral, "
            "openai.onyx is a deeper male voice, and openai.echo is a friendly male voice. "
            "ElevenLabs has rachel, charlie, and thomas. Which one would you like?"
        )
        return (
            SwaigFunctionResult(spoken)
                .swml_user_event(self._wizard_said(spoken))
        )

    @AgentBase.tool(
        name="set_voice",
        description="Pick a voice for the new agent. Advances to capabilities.",
        parameters={
            "type": "object",
            "properties": {
                "voice": {
                    "type": "string",
                    "description": "Voice ID (e.g. openai.nova)",
                },
            },
            "required": ["voice"],
        },
    )
    def set_voice(self, args, raw_data):
        call_id = (raw_data or {}).get("call_id") or "unknown"
        prev_step = (raw_data or {}).get("global_data", {}).get("current_step")
        logger.info("[wizard:%s] set_voice ENTRY prev_step=%s voice=%s", call_id, prev_step, args.get("voice"))
        merged = self._merge_draft(raw_data, {"voice": args.get("voice")})
        spoken = (
            f"Great — using {merged.get('voice','that voice')}. "
            "Now let's set up what your agent can do. "
            "Common capabilities: transferring calls to a human, sending follow-up texts, "
            "scheduling callbacks, checking business hours, collecting customer info, sending emails. "
            "Which of these do you want? You can pick any combination."
        )
        return (
            SwaigFunctionResult(spoken)
                .update_global_data({"agent_draft": merged, "current_step": "capabilities"})
                .swml_change_step("capabilities")
                .swml_user_event(self._agent_preview_event(merged))
                .swml_user_event(self._checkpoint_event("voice"))
                .swml_user_event(self._wizard_said(spoken))
        )

    @AgentBase.tool(
        name="set_capabilities",
        description="Record the agent's enabled functions and greeting line. Advances to review.",
        parameters={
            "type": "object",
            "properties": {
                "functions": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "SWAIG function ids",
                },
                "greeting": {
                    "type": "string",
                    "description": "Opening line the new agent will say",
                },
            },
            "required": ["functions", "greeting"],
        },
    )
    def set_capabilities(self, args, raw_data):
        call_id = (raw_data or {}).get("call_id") or "unknown"
        prev_step = (raw_data or {}).get("global_data", {}).get("current_step")
        logger.info(
            "[wizard:%s] set_capabilities ENTRY prev_step=%s fn_count=%d greeting_len=%d",
            call_id, prev_step, len(args.get("functions") or []), len((args.get("greeting") or "")),
        )
        merged = self._merge_draft(raw_data, {
            "functions": args.get("functions") or [],
            "greeting": args.get("greeting"),
        })
        greeting = merged.get("greeting", "")
        functions = merged.get("functions") or []
        if functions:
            cap_recap = f"It can {', '.join(functions)}, "
        else:
            cap_recap = ""
        spoken = (
            f"Got the greeting: \"{greeting}\". "
            f"Quick recap: {merged.get('name','your agent')}, a {merged.get('role','')}, "
            f"using voice {merged.get('voice','')}. "
            f"{cap_recap}"
            "If everything looks right on your screen, just say 'create it' and I'll build the agent. "
            "Otherwise, tell me what to change."
        )
        return (
            SwaigFunctionResult(spoken)
                .update_global_data({"agent_draft": merged, "current_step": "review"})
                .swml_change_step("review")
                .swml_user_event(self._agent_preview_event(merged))
                .swml_user_event(self._checkpoint_event("capabilities"))
                .swml_user_event(self._wizard_said(spoken))
        )

    @AgentBase.tool(
        name="update_agent_preview",
        description="Modify any field in the agent draft during review. Does not transition.",
        parameters={
            "type": "object",
            "properties": {
                "name": {"type": "string"},
                "role": {"type": "string"},
                "prompt": {"type": "string"},
                "prompt_summary": {"type": "string"},
                "voice": {"type": "string"},
                "greeting": {"type": "string"},
                "functions": {
                    "type": "array",
                    "items": {"type": "string"},
                },
            },
        },
    )
    def update_agent_preview(self, args, raw_data):
        # Available in every step now (per progressive-update redesign).
        # Just merges the partial update and emits an agent_preview event.
        # Does not transition steps.
        call_id = (raw_data or {}).get("call_id") or "unknown"
        prev_step = (raw_data or {}).get("global_data", {}).get("current_step")
        logger.info(
            "[wizard:%s] update_agent_preview ENTRY step=%s fields=%s",
            call_id, prev_step, sorted([k for k, v in (args or {}).items() if v not in (None, "", [])]),
        )

        # Strip None / empty values; merge the rest.
        updates = {k: v for k, v in (args or {}).items() if v is not None and v != ""}
        if not updates:
            return SwaigFunctionResult("Got it — nothing to change.")

        merged = self._merge_draft(raw_data, updates)
        changed_keys = ", ".join(updates.keys())
        spoken = (
            f"Updated: {changed_keys}. The preview on your screen now reflects the change. "
            "Anything else, or should I create it?"
        )
        return (
            SwaigFunctionResult(spoken)
                .update_global_data({"agent_draft": merged})
                .swml_user_event(self._agent_preview_event(merged))
                .swml_user_event(self._wizard_said(spoken))
        )

    @AgentBase.tool(
        name="create_agent",
        description="Commit the reviewed agent. Reads the full draft from call state.",
        parameters={
            "type": "object",
            "properties": {},
        },
    )
    def create_agent(self, args, raw_data):
        call_id = (raw_data or {}).get("call_id") or "unknown"
        gd = (raw_data or {}).get("global_data", {})
        current_step = gd.get("current_step")
        draft = gd.get("agent_draft", {}) or {}
        logger.info(
            "[wizard:%s] create_agent ENTRY step=%s draft_keys=%s",
            call_id, current_step, sorted(draft.keys()),
        )

        # Step guard
        if current_step != "review":
            logger.warning("[wizard:%s] create_agent BLOCKED: step=%s != review", call_id, current_step)
            spoken = "Hold on — we're not at the review stage yet."
            return SwaigFunctionResult(spoken).swml_user_event(self._wizard_said(spoken))

        # Effective prompt: explicit prompt wins, else fall back to prompt_summary.
        effective_prompt = (draft.get("prompt") or "").strip()
        if not effective_prompt:
            effective_prompt = (draft.get("prompt_summary") or "").strip()

        missing = []
        if not (draft.get("name") or "").strip():
            missing.append("name")
        if not (draft.get("role") or "").strip():
            missing.append("role")
        if not effective_prompt:
            missing.append("prompt")
        if not (draft.get("voice") or "").strip():
            missing.append("voice")
        if not (draft.get("greeting") or "").strip():
            missing.append("greeting")
        if missing:
            logger.warning(
                "[wizard:%s] create_agent VALIDATION_FAILED missing=%s draft=%s",
                call_id, missing, {k: bool(draft.get(k)) for k in ["name","role","prompt","prompt_summary","voice","greeting","functions"]},
            )
            spoken = f"I'm missing {', '.join(missing)} — let's fill that in first."
            return SwaigFunctionResult(spoken).swml_user_event(self._wizard_said(spoken))

        # Resolve project_id from raw_data (multiple possible locations).
        project_id = (
            (raw_data or {}).get("project_id")
            or (raw_data or {}).get("global_data", {}).get("project_id")
            or ((raw_data or {}).get("call_id_data") or {}).get("project_id")
        )
        logger.info("[wizard:%s] create_agent project_id=%s", call_id, project_id)

        credentials = _wizard_lookup_user_credentials(project_id) if project_id else None
        if not credentials:
            logger.warning(
                "[wizard:%s] create_agent CREDS_MISSING project_id=%s",
                call_id, project_id,
            )
            spoken = (
                "I couldn't find your SignalWire credentials — make sure you're logged in "
                "on the dashboard, then try again."
            )
            return SwaigFunctionResult(spoken).swml_user_event(self._wizard_said(spoken))

        # Dedup guard
        dedup_key = f"{call_id}:{draft.get('name','')}"
        if dedup_key in _wizard_create_inflight:
            logger.info("[wizard:%s] create_agent DEDUP_HIT key=%s", call_id, dedup_key)
            spoken = "I'm already creating that one — give me a few seconds."
            return SwaigFunctionResult(spoken).swml_user_event(self._wizard_said(spoken))
        _wizard_create_inflight[dedup_key] = True

        # Build the payload the existing helper expects.
        agent_data = {
            "name": draft["name"],
            "role": draft["role"],
            "greeting": draft["greeting"],
            "prompt": effective_prompt,
            "voice": draft["voice"],
            "language": draft.get("language", "en-US"),
            "temperature": draft.get("temperature", 0.7),
            "speech_hints": draft.get("speech_hints", []),
            "enabled_functions": draft.get("functions", []),
            "transfer_number": draft.get("transfer_number", ""),
            "transfer_from": draft.get("transfer_from", ""),
            "sms_from_number": draft.get("sms_from_number", ""),
            "documents": draft.get("documents", []),
        }
        logger.info(
            "[wizard:%s] create_agent POSTING name=%s role=%s voice=%s fn_count=%d",
            call_id, agent_data["name"], agent_data["role"], agent_data["voice"], len(agent_data["enabled_functions"]),
        )

        try:
            result = _wizard_create_employee_via_frontend(agent_data, credentials)
        except Exception as e:
            _wizard_create_inflight.pop(dedup_key, None)
            logger.error("[wizard:%s] create_agent FRONTEND_ERROR err=%s", call_id, e)
            spoken = (
                f"The build didn't go through — {e}. "
                "Want me to retry, or change something first?"
            )
            return SwaigFunctionResult(spoken).swml_user_event(self._wizard_said(spoken))

        # Success path
        employee = (result or {}).get("employee") or {}
        created = {
            "id": employee.get("id"),
            "name": employee.get("name") or draft["name"],
            "callFabricAddress": employee.get("callFabricAddress"),
        }
        logger.info(
            "[wizard:%s] create_agent SUCCESS id=%s name=%s addr=%s",
            call_id, created["id"], created["name"], created["callFabricAddress"],
        )
        spoken = (
            f"Done — {created['name']} is built and ready. "
            "Want me to hand off the dial address so you can call them?"
        )
        return (
            SwaigFunctionResult(spoken)
                .update_global_data({"created_agent": created, "current_step": "complete"})
                .swml_change_step("complete")
                .swml_user_event({"type": "agent_created", "employee": employee})
                .swml_user_event(self._checkpoint_event("review"))
                .swml_user_event(self._wizard_said(spoken))
        )

    @AgentBase.tool(
        name="finalize_agent",
        description="Hand off the new agent to the user (call-fabric address).",
        parameters={
            "type": "object",
            "properties": {},
        },
    )
    def finalize_agent(self, args, raw_data):
        gd = (raw_data or {}).get("global_data", {})
        if gd.get("current_step") != "complete":
            return SwaigFunctionResult("Hold on — the agent isn't built yet.")

        created = gd.get("created_agent") or {}
        addr = created.get("callFabricAddress") or "(address unavailable)"
        spoken = (
            f"You can call your new agent at {addr}. "
            "I'll go quiet now — talk to you next time."
        )
        return (
            SwaigFunctionResult(spoken)
                .swml_user_event({"type": "agent_ready", **created})
                .swml_user_event(self._wizard_said(spoken))
        )


# Create FastAPI app
app = FastAPI(
    title="Virtual Employees Backend",
    description="Multi-agent AI system with dynamic SWML endpoints"
)

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Bypass auth middleware
@app.middleware("http")
async def bypass_auth(request: Request, call_next):
    response = await call_next(request)
    return response


def _remount_employee_router(employee_id: str, agent: VirtualEmployeeAgent):
    """Remove old routes for an employee and mount the new agent's router."""
    prefix = f"/swml/{employee_id}"
    # Remove existing routes with this prefix
    app.routes[:] = [
        r for r in app.routes
        if not (hasattr(r, 'path') and r.path.startswith(prefix))
    ]
    # Mount new router (strip BasicAuth dependencies)
    router = agent.as_router()
    if hasattr(router, 'dependencies'):
        router.dependencies = [dep for dep in router.dependencies if 'BasicAuth' not in str(type(dep))]
    app.include_router(router, prefix=prefix)
    logger.info(f"   Mounted router at: {prefix}")


# Employee Management API Endpoints

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


@app.post("/api/create-employee")
async def create_employee(request: Request):
    """Create a new virtual employee"""
    try:
        data = await request.json()

        # Use provided ID (for re-creation after restart) or generate a new one
        employee_id = data.get("id") or str(uuid.uuid4())[:8]

        # Create employee config
        employee_config = {
            "id": employee_id,
            "name": data.get("name", "Virtual Employee"),
            "role": data.get("role", "Assistant"),
            "greeting": data.get("greeting", "Hello, how can I help you today?"),
            "prompt": data.get("prompt", ""),
            "voice": data.get("voice", "openai.nova"),
            "language": data.get("language", "en-US"),
            "temperature": data.get("temperature", 0.7),
            "speech_hints": data.get("speech_hints", []),
            "enabled_functions": data.get("enabled_functions", []),
            "transfer_number": data.get("transfer_number", ""),
            "transfer_from": data.get("transfer_from", ""),
            "sms_from_number": data.get("sms_from_number", ""),
            "video_idle_url": data.get("video_idle_url", ""),
            "video_talking_url": data.get("video_talking_url", ""),
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
            "created_at": datetime.now().isoformat(),
            "updated_at": datetime.now().isoformat(),
            "status": "active"
        }

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

        # Store employee
        employees[employee_id] = employee_config

        # Create agent instance and mount router
        agent = VirtualEmployeeAgent(employee_config)
        agent_instances[employee_id] = agent
        _remount_employee_router(employee_id, agent)

        logger.info(f"✅ Created virtual employee id={employee_id}")
        logger.info(f"   Route: /swml/{employee_id}")

        return {
            "success": True,
            "employee": employee_config,
            "swml_route": f"/swml/{employee_id}",
            "message": "Virtual employee created successfully"
        }

    except Exception as e:
        logger.error(f"Error creating employee: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/list-employees")
async def list_employees():
    """List all virtual employees"""
    return {
        "success": True,
        "employees": list(employees.values()),
        "count": len(employees)
    }


@app.get("/api/employee/{employee_id}")
async def get_employee(employee_id: str = Path(...)):
    """Get a specific employee's configuration"""
    if employee_id not in employees:
        raise HTTPException(status_code=404, detail="Employee not found")

    return {
        "success": True,
        "employee": employees[employee_id]
    }


def _generate_sdk_code(employee_config: Dict[str, Any]) -> str:
    """Render runnable Python that, when executed, builds the live agent's SWML.

    Mirrors VirtualEmployeeAgent.__init__ in this file: same add_language call
    (with speech_fillers + function_fillers), same three prompt sections
    (Identity / Instructions / Voice Interaction Guidelines), same conditional
    SMS-offer bullet, same temperature, same rich post-prompt, same DataSphere
    skill registration logic, and emits real handler bodies for every enabled
    SWAIG function with per-environment values read from os.environ.
    """
    name = employee_config.get("name", "Employee")
    role = employee_config.get("role", "Virtual Assistant")
    employee_id = employee_config.get("id", "employee")
    voice = employee_config.get("voice", "openai.nova")
    language_code = employee_config.get("language", "en-US")
    temperature = employee_config.get("temperature", 0.7)
    greeting = employee_config.get("greeting", f"Hello, I am {name}.")
    prompt_body = employee_config.get("prompt", "")
    enabled_functions = employee_config.get("enabled_functions") or []

    # Resolve language name the same way the live agent does.
    language_name = _LANGUAGE_MAP.get(language_code, "English")

    # Sanitize class name: strip non-identifier chars, guard leading digits.
    raw_class = "".join(word.capitalize() for word in (name.split() or ["Agent"]))
    class_name = re.sub(r"[^A-Za-z0-9]", "", raw_class) or "Agent"
    if class_name and class_name[0].isdigit():
        class_name = "Agent" + class_name

    # Build voice-interaction guidelines (mirror _update_personality lines 171-185).
    guidelines = [
        "Keep responses to 1-3 sentences — this is a phone call, not a text chat",
        "Be conversational and natural, not robotic",
        "Listen fully before responding",
        "If you are unsure about something, say so and offer to connect the caller with a human",
        "Always end interactions with a clear next step",
    ]
    if "send_summary_sms" in enabled_functions:
        guidelines.append(
            "Before ending the call, ask the caller if they would like a summary sent to their phone via text message. "
            "If yes, ask for their phone number, then use the send_summary_sms function."
        )

    guidelines_literal = json.dumps(guidelines, indent=8).replace("\n", "\n        ")

    # Identity section body (mirror _update_personality line 161-164).
    # Use repr() to produce a safe Python string literal — handles all escaping.
    identity_body_raw = f'You are {name}, a {role}. Your greeting is: "{greeting}"'
    identity_body_literal = repr(identity_body_raw)  # e.g. 'You are ...' with proper escaping

    # Instructions section is conditional on prompt_body being non-empty.
    prompt_body_literal = repr(prompt_body)
    instructions_block = (
        f'        self.prompt_add_section("Instructions", body={prompt_body_literal})\n'
        if prompt_body else ""
    )

    # Mirror live agent: if enabled_functions is empty, ALL known templates are emitted
    # (live VirtualEmployeeAgent has all tools as class methods and only removes them
    # when enabled_functions is non-empty — see _configure_functions's `if enabled_functions:`).
    functions_to_emit = (
        list(SWAIG_TEMPLATES.keys()) if not enabled_functions
        else [f for f in enabled_functions if f != "search_knowledge"]
    )

    # Compose enabled SWAIG handlers, de-duping helpers.
    swaig_methods: list = []
    helpers: dict = {}
    unknown_warnings: list = []
    for fn_id in functions_to_emit:
        if fn_id == "search_knowledge":
            continue  # handled by datasphere_block
        builder = SWAIG_TEMPLATES.get(fn_id)
        if builder is None:
            unknown_warnings.append(f"    # WARN: skipped unknown function '{fn_id}'")
            continue
        method_src, builder_helpers = builder(employee_config)
        swaig_methods.append(method_src)
        for hname, hsrc in builder_helpers.items():
            helpers.setdefault(hname, hsrc)

    helpers_block = "\n\n".join(helpers.values())
    swaig_block = "\n\n".join(swaig_methods)
    unknown_block = "\n".join(unknown_warnings)
    datasphere_lines = datasphere_block(employee_config)

    header = env_var_header(employee_config, enabled_functions)

    # Post-prompt mirrors _configure_post_prompt verbatim.
    # Use repr() so the Python literal in the generated file is always valid,
    # regardless of embedded quotes or backslashes.
    _live_post_prompt = (
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
    post_prompt_literal = repr(_live_post_prompt)

    return f'''#!/usr/bin/env python3
{header}
import os

from signalwire_agents import AgentBase, SwaigFunctionResult


class {class_name}(AgentBase):
    """An AI voice agent built with the signalwire-agents SDK."""

    def __init__(self):
        super().__init__(
            name="{name}",
            route="/swml/{employee_id}",
        )

        self.add_language(
            name="{language_name}",
            code="{language_code}",
            voice="{voice}",
            speech_fillers=[
                "Let me help you with that...",
                "One moment please...",
                "I'm processing your request...",
            ],
            function_fillers=[
                "Let me check on that for you...",
                "I'm looking that up now...",
            ],
        )

        self.prompt_add_section(
            "Identity",
            body={identity_body_literal},
        )
{instructions_block}        self.prompt_add_section(
            "Voice Interaction Guidelines",
            bullets={guidelines_literal},
        )

        self.set_param("temperature", {temperature})

{datasphere_lines}
        self.set_post_prompt({post_prompt_literal})

{swaig_block}

{helpers_block}
{unknown_block}


if __name__ == "__main__":
    {class_name}().run()
'''


@app.get("/agent-code/{employee_id}", response_class=PlainTextResponse)
async def get_agent_code(employee_id: str = Path(...)):
    """Return runnable Python that mirrors how this agent is built.

    The generated code is structurally identical to the live agent — same
    SDK calls, same prompt body, same voice/language/functions — so a developer
    can copy it, run `pip install signalwire-agents`, then `python <id>.py`
    to stand up an equivalent agent locally for inspection or extension.
    """
    if employee_id not in employees:
        raise HTTPException(status_code=404, detail="Employee not found")
    employee_config = dict(employees[employee_id])
    employee_config.setdefault("id", employee_id)
    return _generate_sdk_code(employee_config)


@app.patch("/api/employee/{employee_id}")
async def update_employee(employee_id: str, request: Request):
    """Update an employee's configuration"""
    if employee_id not in employees:
        raise HTTPException(status_code=404, detail="Employee not found")

    try:
        data = await request.json()

        # Update employee config
        employee_config = employees[employee_id]
        employee_config.update({
            "name": data.get("name", employee_config["name"]),
            "role": data.get("role", employee_config["role"]),
            "greeting": data.get("greeting", employee_config["greeting"]),
            "prompt": data.get("prompt", employee_config["prompt"]),
            "voice": data.get("voice", employee_config["voice"]),
            "language": data.get("language", employee_config["language"]),
            "temperature": data.get("temperature", employee_config["temperature"]),
            "speech_hints": data.get("speech_hints", employee_config["speech_hints"]),
            "enabled_functions": data.get("enabled_functions", employee_config["enabled_functions"]),
            "transfer_number": data.get("transfer_number", employee_config.get("transfer_number", "")),
            "transfer_from": data.get("transfer_from", employee_config.get("transfer_from", "")),
            "sms_from_number": data.get("sms_from_number", employee_config.get("sms_from_number", "")),
            "video_idle_url": data.get("video_idle_url", employee_config.get("video_idle_url", "")),
            "video_talking_url": data.get("video_talking_url", employee_config.get("video_talking_url", "")),
            "business_hours_start": data.get("business_hours_start", employee_config.get("business_hours_start", 9)),
            "business_hours_end": data.get("business_hours_end", employee_config.get("business_hours_end", 18)),
            "business_days": data.get("business_days", employee_config.get("business_days", [0, 1, 2, 3, 4])),
            "documents": data.get("documents", employee_config.get("documents", [])),
            "sendgrid_api_key": data.get("sendgrid_api_key", employee_config.get("sendgrid_api_key", "")),
            "email_from_address": data.get("email_from_address", employee_config.get("email_from_address", "")),
            "email_from_name": data.get("email_from_name", employee_config.get("email_from_name", "")),
            "space_name": data.get("space_name", employee_config.get("space_name", "")),
            "project_id": data.get("project_id", employee_config.get("project_id", "")),
            "token": data.get("token", employee_config.get("token", "")),
            "updated_at": datetime.now().isoformat()
        })

        # Recreate agent instance and remount router
        agent = VirtualEmployeeAgent(employee_config)
        agent_instances[employee_id] = agent
        _remount_employee_router(employee_id, agent)

        logger.info(f"✅ Updated virtual employee: {employee_config['name']} ({employee_id})")

        return {
            "success": True,
            "employee": employee_config,
            "message": "Employee updated successfully"
        }

    except Exception as e:
        logger.error(f"Error updating employee: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@app.delete("/api/employee/{employee_id}")
async def delete_employee(employee_id: str = Path(...)):
    """Delete a virtual employee"""
    if employee_id not in employees:
        raise HTTPException(status_code=404, detail="Employee not found")

    try:
        # Remove employee
        employee_name = employees[employee_id]["name"]
        del employees[employee_id]

        # Remove agent instance
        if employee_id in agent_instances:
            del agent_instances[employee_id]

        # Remove routes for this employee
        prefix = f"/swml/{employee_id}"
        app.routes[:] = [
            r for r in app.routes
            if not (hasattr(r, 'path') and r.path.startswith(prefix))
        ]

        logger.info(f"🗑️  Deleted virtual employee: {employee_name} ({employee_id})")

        return {
            "success": True,
            "message": "Employee deleted successfully"
        }

    except Exception as e:
        logger.error(f"Error deleting employee: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


# Legacy endpoints for backward compatibility
@app.post("/api/update-config")
async def update_config_legacy(request: Request):
    """Legacy endpoint - creates/updates a default employee"""
    try:
        data = await request.json()

        # Check if default employee exists
        default_id = "default"
        if default_id not in employees:
            # Create default employee
            employee_config = {
                "id": default_id,
                "name": "Sally Sales",
                "role": "Sales Representative",
                "greeting": "Hello! Welcome to Sally Sales.",
                "prompt": data.get("prompt", ""),
                "voice": "openai.nova",
                "language": "en-US",
                "temperature": 0.7,
                "speech_hints": [],
                "enabled_functions": [],
                "transfer_number": "",
                "transfer_from": "",
                "sms_from_number": "",
                "video_idle_url": "",
                "video_talking_url": "",
                "created_at": datetime.now().isoformat(),
                "updated_at": datetime.now().isoformat(),
                "status": "active"
            }
            employees[default_id] = employee_config

            # Create agent and mount router
            agent = VirtualEmployeeAgent(employee_config)
            agent_instances[default_id] = agent
            _remount_employee_router(default_id, agent)
        else:
            # Update existing
            employees[default_id]["prompt"] = data.get("prompt", employees[default_id]["prompt"])
            employees[default_id]["updated_at"] = datetime.now().isoformat()

            # Recreate agent and remount router
            agent = VirtualEmployeeAgent(employees[default_id])
            agent_instances[default_id] = agent
            _remount_employee_router(default_id, agent)

        return {
            "success": True,
            "message": "Configuration updated",
            "config": employees[default_id]
        }

    except Exception as e:
        logger.error(f"Error updating config: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/config")
async def get_config():
    """Legacy endpoint - returns default employee config"""
    default_id = "default"
    config = employees.get(default_id, {
        "prompt": "Welcome to Sally Sales",
        "created_at": datetime.now().isoformat()
    })

    default_swml_path = f"/swml/{default_id}"
    swml_url = f"{APP_DOMAIN}{default_swml_path}" if APP_DOMAIN else default_swml_path

    return {
        "success": True,
        "config": config,
        "credentials": agent_credentials,
        "swml_url": swml_url
    }


@app.get("/api/agent-info")
async def get_agent_info():
    """Get agent system information"""
    return {
        "status": "healthy",
        "total_employees": len(employees),
        "active_employees": len([e for e in employees.values() if e.get("status") == "active"]),
        "credentials": agent_credentials,
        "timestamp": datetime.now().isoformat()
    }


# Health check endpoint
@app.post("/api/post-prompt/{path:path}")
async def proxy_post_prompt(path: str, request: Request):
    """Proxy post-prompt webhooks from SignalWire to the frontend.

    SignalWire calls the post_prompt_url that's set during on_swml_request — this
    URL is built from APP_DOMAIN (the ngrok tunnel) which forwards port 8000 to
    the agent. The post-prompt route lives in the frontend (port 5001), so we
    forward the full body and headers there. Returns the frontend's response.
    """
    try:
        body = await request.body()
        target = f"{FRONTEND_URL}/api/post-prompt/{path}"
        logger.info(f"[post-prompt proxy] forwarding to {target} ({len(body)} bytes)")
        forward_req = urllib.request.Request(
            target,
            data=body,
            method="POST",
            headers={"Content-Type": request.headers.get("content-type", "application/json")},
        )
        with urllib.request.urlopen(forward_req, timeout=30.0) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as e:
        try:
            err_body = e.read().decode()
        except Exception:
            err_body = str(e)
        logger.error(f"[post-prompt proxy] frontend returned {e.code}: {err_body}")
        raise HTTPException(status_code=e.code, detail=err_body)
    except urllib.error.URLError as e:
        logger.error(f"[post-prompt proxy] could not reach frontend: {e.reason}")
        raise HTTPException(status_code=502, detail=f"could not reach frontend at {FRONTEND_URL}: {e.reason}")
    except Exception as e:
        logger.error(f"[post-prompt proxy] unexpected error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/health")
async def health_check():
    """Health check endpoint"""
    return {
        "status": "healthy",
        "employees": len(employees),
        "timestamp": datetime.now().isoformat()
    }


# Module-level initialization. Runs both when `python main.py` executes the
# `__main__` block below AND when uvicorn imports `main:app` directly (the
# deployment entry point — `uvicorn main:app --host 0.0.0.0 --port 8000`).
# Without this, the wizard agent is never mounted in production and SignalWire
# webhooks to /swml/wizard/ return 404.

# Write credentials file for the Node SWML proxy (it reads
# web/agent-credentials.json to construct the BasicAuth header).
try:
    _credentials_file = os.path.join(os.path.dirname(__file__), '..', 'web', 'agent-credentials.json')
    _swml_path = "/swml/default"
    with open(_credentials_file, 'w') as f:
        json.dump({
            "username": agent_credentials["username"],
            "password": agent_credentials["password"],
            "app_domain": agent_credentials["app_domain"],
            "swml_url": f"{agent_credentials['app_domain']}{_swml_path}" if agent_credentials['app_domain'] else _swml_path,
            "timestamp": datetime.now().isoformat()
        }, f, indent=2)
    logger.info(f"✅ Wrote credentials to: {_credentials_file}")
except Exception as e:
    logger.warning(f"Could not write credentials file: {e}")

# Mount the Wizard agent
wizard = WizardAgent()
_remount_employee_router("wizard", wizard)
agent_instances["wizard"] = wizard
logger.info("🧙 Wizard agent mounted at /swml/wizard")


# Main entry point
if __name__ == "__main__":
    logger.info("=" * 60)
    logger.info("🚀 Starting Virtual Employees Backend")
    logger.info("=" * 60)
    logger.info(f"📋 Multi-Agent System Initialized")
    logger.info("🔐 Credentials configured (redacted)")
    logger.info(f"🌐 App Domain: {APP_DOMAIN or '(not set)'}")
    logger.info(f"🎯 Employees will be available at: /swml/{{employee_id}}")
    logger.info("=" * 60)

    # Auto-detect ngrok URL if APP_DOMAIN not set
    if not APP_DOMAIN:
        detected = _detect_ngrok_url()
        if detected:
            APP_DOMAIN = detected
            agent_credentials["app_domain"] = detected
            logger.info(f"🔍 Auto-detected ngrok URL: {detected}")
        else:
            logger.warning("APP_DOMAIN not set and ngrok not detected")

    # Start server
    uvicorn.run(app, host="0.0.0.0", port=8000)
