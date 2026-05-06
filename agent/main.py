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

from agent import swaig_handlers
from agent.swaig_handlers import (
    TRANSFER_TO_HUMAN,
    SEND_SUMMARY_SMS,
    SCHEDULE_CALLBACK,
    CHECK_BUSINESS_HOURS,
    COLLECT_CUSTOMER_INFO,
    SEND_EMAIL,
)

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
        lang_map = {
            'en': 'English', 'en-US': 'English', 'en-GB': 'English',
            'en-AU': 'English', 'en-IN': 'English', 'en-NZ': 'English',
            'es': 'Spanish', 'es-ES': 'Spanish', 'es-419': 'Spanish',
            'fr': 'French', 'fr-FR': 'French', 'fr-CA': 'French',
            'de': 'German', 'de-DE': 'German',
            'it': 'Italian', 'it-IT': 'Italian',
            'pt': 'Portuguese', 'pt-BR': 'Portuguese', 'pt-PT': 'Portuguese',
            'ja': 'Japanese', 'ja-JP': 'Japanese',
            'zh': 'Chinese', 'zh-CN': 'Chinese',
            'ko': 'Korean', 'ko-KR': 'Korean',
            'hi': 'Hindi',
            'ru': 'Russian',
            'nl': 'Dutch',
            'pl': 'Polish',
            'sv': 'Swedish', 'sv-SE': 'Swedish',
            'da': 'Danish', 'da-DK': 'Danish',
            'tr': 'Turkish',
            'vi': 'Vietnamese',
            'uk': 'Ukrainian',
            'multi': 'Multilingual',
        }
        return lang_map.get(code, 'English')

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
        """Configure post-prompt to generate a structured call summary."""
        self.set_post_prompt(swaig_handlers.POST_PROMPT_TEMPLATE)

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
                    self.add_pom_section("Knowledge Base Routing", body=routing)
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
        # Note: search_knowledge is a skill, not a SWAIG tool — skip it in this filter
        swaig_functions = [f for f in enabled_functions if f != 'search_knowledge']
        if enabled_functions:
            all_functions = list(self._tool_registry.get_all_functions().keys())
            for func_name in all_functions:
                if func_name not in swaig_functions:
                    self._tool_registry.remove_function(func_name)
                    logger.info(f"  Removed function '{func_name}' (not in enabled list)")

    # ------------------------------------------------------------------
    # SWAIG Functions — real actions via SwaigFunctionResult
    # ------------------------------------------------------------------

    @AgentBase.tool(**TRANSFER_TO_HUMAN)
    def transfer_to_human(self, args, raw_data):
        return swaig_handlers.transfer_to_human(self.employee_config, args, raw_data)

    @AgentBase.tool(**SEND_SUMMARY_SMS)
    def send_summary_sms(self, args, raw_data):
        return swaig_handlers.send_summary_sms(self.employee_config, args, raw_data)

    @AgentBase.tool(**SCHEDULE_CALLBACK)
    def schedule_callback(self, args, raw_data):
        return swaig_handlers.schedule_callback(self.employee_config, args, raw_data)

    @AgentBase.tool(**CHECK_BUSINESS_HOURS)
    def check_business_hours(self, args, raw_data):
        return swaig_handlers.check_business_hours(self.employee_config, args, raw_data)

    @AgentBase.tool(**COLLECT_CUSTOMER_INFO)
    def collect_customer_info(self, args, raw_data):
        return swaig_handlers.collect_customer_info(self.employee_config, args, raw_data)

    @AgentBase.tool(**SEND_EMAIL)
    def send_email(self, args, raw_data):
        return swaig_handlers.send_email(self.employee_config, args, raw_data)

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
    """Voice-callable AI wizard that helps users build other AI agents through conversation.

    The wizard guides the user through a structured setup flow:
    1. Ask what kind of agent they want
    2. Use ask_config_question to show options on screen
    3. Call preview_agent to show a preview card
    4. Ask for approval and customizations
    5. Call create_agent when approved, then finalize_agent
    """

    def __init__(self):
        super().__init__(
            name="Agent Wizard",
            route="/swml/wizard"
        )

        self.add_language(
            name="English",
            code="en-US",
            voice="openai.shimmer",
            speech_fillers=[
                "Let me think about that...",
                "Great question...",
                "One moment..."
            ],
            function_fillers=[
                "Updating the preview...",
                "Building it now...",
                "One moment while I set this up..."
            ]
        )

        # ---------- §1 Identity ----------
        self.prompt_add_section(
            "Identity",
            body=(
                "You are the Agent Wizard for Sally Sales — a warm, knowledgeable setup assistant "
                "who builds custom AI voice agents for the user through a short phone conversation. "
                "You make the experience feel collaborative and exciting, like working with a coworker "
                "who really knows the product. You speak in short, friendly sentences (a phone call, "
                "not a lecture). You do not pretend to be human, and you do not over-apologize. "
                "The user is on the dashboard with a creation canvas open in front of them — let the "
                "screen do the heavy lifting for visual choices, and use your voice for guidance and rapport."
            )
        )

        # ---------- §2 Discovery ----------
        self.prompt_add_section(
            "Discovery — one open question, then build",
            bullets=[
                "Open with a brief greeting (one sentence) and a single open question: \"Tell me about the agent you'd like to build — what should it do, and who's it for?\"",
                "LISTEN to the user's full description before doing anything. Don't interrupt to ask for a name or role yet.",
                "From their description, derive everything you can yourself: a sensible agent name (e.g. \"Sarah\" for a sales rep, \"Max\" for support), a clear role title, a short prompt summarizing the job, a friendly greeting line, a sensible voice (openai.nova for warm, openai.shimmer for upbeat, openai.alloy for neutral/professional), and a small set of capabilities that fit the use case.",
                "Immediately call preview_agent with all of those derived values, THEN say something like \"I'm building this up for you — take a look at the canvas\" so the user knows to glance at the screen.",
                "Then call mark_checkpoint(\"identity\")."
            ]
        )

        # ---------- §3 Building ----------
        self.prompt_add_section(
            "Building — confirm and refine quickly",
            bullets=[
                "Your goal is to ask AS FEW QUESTIONS AS POSSIBLE. The user described the agent — your job is to make sensible choices and confirm them, not to interrogate.",
                "After the initial preview, narrate briefly: \"I'm setting up [name] as a [role] — they'll [1-2 capabilities] and use a [voice trait] voice. How does that look?\"",
                "If the user accepts, call mark_checkpoint(\"voice\") and mark_checkpoint(\"capabilities\") in quick succession (you've made the choices, the user confirmed) and move to recap.",
                "If the user wants changes, use update_agent_preview to apply them. Only ask follow-up questions for things you couldn't infer (e.g., \"What's the phone number to transfer to?\" when they enable transfer_to_human).",
                "When the user is unsure between options for ONE field, use ask_config_question with 2-4 options (e.g., voice). Don't bombard them with sequential ask_config_question calls — pick the most important undecided field.",
                "HARD RULE: mark_checkpoint must fire in order (identity → voice → capabilities → review), each at most once. Don't skip a stage even if you're moving fast.",
                "Use update_agent_preview every time you change a field — the canvas reflects updates live.",
                "Keep spoken responses under 2 sentences. The canvas does the visual heavy lifting."
            ]
        )

        # ---------- §4 Confirmation ----------
        self.prompt_add_section(
            "Confirmation",
            bullets=[
                "HARD RULE: Before mark_checkpoint(\"review\") — you MUST have already called mark_checkpoint(\"identity\"), mark_checkpoint(\"voice\"), AND mark_checkpoint(\"capabilities\") in that order. If any are missing, return to that section instead of marking review.",
                "Recap in one breath: \"Okay — {name}, a {role} with {voice}'s voice, who can {top 2-3 capabilities}. Sound right?\" Use the user's actual name and capability choices, not placeholders.",
                "Wait for explicit yes from the user. If they hesitate or ask for changes, treat it as another update_agent_preview cycle — don't push.",
                "On explicit confirmation, call mark_checkpoint(\"review\"). Only then proceed to creation.",
                "If the user says \"scrap it\" or \"start over\", clear the preview by calling update_agent_preview with empty fields and return to Discovery."
            ]
        )

        # ---------- §5 Creation ----------
        self.prompt_add_section(
            "Creation",
            bullets=[
                "HARD RULE: Before create_agent — you MUST have already called mark_checkpoint(\"review\"). If you haven't, recap and confirm with the user first.",
                "Say something brief and confident — \"Building {name} now…\" — then call create_agent with the full config (use the user's actual name, not a placeholder).",
                "Silence during the create_agent call is okay (the canvas shows progress).",
                "When create_agent returns successfully, call finalize_agent with the employee_id from the create_agent response immediately.",
                "After finalize, say: \"{name} is live. You can call them right from the canvas, or end this call and I'll get out of your way.\"",
                "If create_agent fails, surface the error briefly (\"Hmm, the build didn't go through — {short reason}. Want to try again?\") and offer to retry."
            ]
        )

        # ---------- §6 Conversation Style (cross-cutting) ----------
        self.prompt_add_section(
            "Conversation Style",
            bullets=[
                "1–2 sentences per turn. Phone-call cadence, not chatbot.",
                "Don't read out long lists — defer to ask_config_question so the user sees options on screen instead.",
                "Don't say \"I'm calling the function now\" or narrate tool use. Just call the tool and let the screen update.",
                "Use the user's words back at them when summarizing — if they said \"billing questions\", don't translate to \"customer service inquiries\".",
                "Never invent capabilities the system doesn't have (video, payments, CRM integration). Say so plainly and offer the closest supported behavior.",
                "When in doubt, ask. One question, then listen."
            ]
        )

        self.set_param("temperature", 0.7)

        # Configure post-prompt for call logging
        self.set_post_prompt(
            "Summarize this wizard session as JSON with exactly these fields:\n"
            '- "summary": 2-3 sentence summary of what was discussed/created\n'
            '- "caller_intent": what the user wanted to build\n'
            '- "outcome": one of "resolved", "transferred", "abandoned", or "follow_up_needed"\n'
            '- "sentiment": one of "positive", "neutral", or "negative"\n'
            '- "topics": array of topic keyword strings\n'
            '- "follow_up": any action items or follow-up needed (null if none)\n'
            '- "agent_built_id": the employee id returned by create_agent if you created an agent in this session, otherwise null\n'
            "Respond ONLY with the JSON object, no extra text."
        )

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
    # SWAIG Functions
    # ------------------------------------------------------------------

    @AgentBase.tool(
        name="ask_config_question",
        description="Display a configuration question with selectable options on the user's screen",
        parameters={
            "type": "object",
            "properties": {
                "question": {
                    "type": "string",
                    "description": "The question to display on screen"
                },
                "options": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "List of selectable options to display"
                },
                "field": {
                    "type": "string",
                    "description": "The config field this question is populating (e.g. 'voice', 'role', 'functions')"
                }
            },
            "required": ["question", "options", "field"]
        }
    )
    def ask_config_question(self, args, raw_data):
        logger.info(f"[WizardAgent.ask_config_question] CALLED with args={args}, raw_data keys={list(raw_data.keys()) if raw_data else None}")
        question = args.get("question", "")
        options = args.get("options", [])
        field = args.get("field", "")

        logger.info(f"[wizard] ask_config_question: field={field}, options={options}")

        result = SwaigFunctionResult(
            f"I've displayed the options on your screen. Take a look and let me know which one feels right."
        )
        result.swml_user_event({
            "type": "agent_config_question",
            "question": question,
            "options": options,
            "field": field
        })
        result.swml_user_event({
            "type": "wizard_said",
            "text": "I've displayed the options on your screen. Take a look and let me know which one feels right."
        })
        logger.info(f"[WizardAgent.ask_config_question] RETURNING")
        return result

    @AgentBase.tool(
        name="preview_agent",
        description="Show a preview card of the agent being designed on the dashboard",
        parameters={
            "type": "object",
            "properties": {
                "name": {
                    "type": "string",
                    "description": "Agent's name"
                },
                "role": {
                    "type": "string",
                    "description": "Agent's role or title"
                },
                "prompt_summary": {
                    "type": "string",
                    "description": "Brief summary of the agent's purpose and personality"
                },
                "voice": {
                    "type": "string",
                    "description": "Voice to use (e.g. openai.nova, openai.shimmer)"
                },
                "functions": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "List of enabled function names"
                },
                "greeting": {
                    "type": "string",
                    "description": "The agent's opening greeting"
                },
                "prompt": {
                    "type": "string",
                    "description": "Full prompt/instructions for the agent"
                }
            },
            "required": ["name", "role"]
        }
    )
    def preview_agent(self, args, raw_data):
        logger.info(f"[WizardAgent.preview_agent] CALLED with args={args}, raw_data keys={list(raw_data.keys()) if raw_data else None}")
        name = args.get("name", "New Agent")
        role = args.get("role", "Assistant")
        prompt_summary = args.get("prompt_summary", "")
        voice = args.get("voice", "openai.nova")
        functions = args.get("functions", [])
        greeting = args.get("greeting", f"Hello, I'm {name}. How can I help you today?")
        prompt = args.get("prompt", "")

        logger.info(f"[wizard] preview_agent: name={name}, role={role}, voice={voice}")

        result = SwaigFunctionResult(
            f"I've shown a preview of {name} on your screen. Does that look good, or would you like to make any changes?"
        )
        result.swml_user_event({
            "type": "agent_preview",
            "name": name,
            "role": role,
            "prompt_summary": prompt_summary,
            "voice": voice,
            "functions": functions,
            "greeting": greeting,
            "prompt": prompt
        })
        result.swml_user_event({
            "type": "wizard_said",
            "text": f"I've shown a preview of {name} on your screen. Does that look good, or would you like to make any changes?"
        })
        logger.info(f"[WizardAgent.preview_agent] RETURNING")
        return result

    @AgentBase.tool(
        name="update_agent_preview",
        description="Update the agent preview card on the dashboard with new details",
        parameters={
            "type": "object",
            "properties": {
                "name": {
                    "type": "string",
                    "description": "Updated agent name"
                },
                "role": {
                    "type": "string",
                    "description": "Updated role or title"
                },
                "voice": {
                    "type": "string",
                    "description": "Updated voice"
                },
                "functions": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Updated list of enabled functions"
                },
                "prompt": {
                    "type": "string",
                    "description": "Updated full prompt"
                },
                "greeting": {
                    "type": "string",
                    "description": "Updated greeting message"
                }
            }
        }
    )
    def update_agent_preview(self, args, raw_data):
        logger.info(f"[WizardAgent.update_agent_preview] CALLED with args={args}, raw_data keys={list(raw_data.keys()) if raw_data else None}")
        logger.info(f"[wizard] update_agent_preview: {list(args.keys())}")

        result = SwaigFunctionResult(
            "I've updated the preview on your screen with those changes."
        )
        result.swml_user_event({
            "type": "agent_preview",
            **{k: v for k, v in args.items() if v is not None}
        })
        result.swml_user_event({
            "type": "wizard_said",
            "text": "I've updated the preview on your screen with those changes."
        })
        logger.info(f"[WizardAgent.update_agent_preview] RETURNING")
        return result

    @AgentBase.tool(
        name="mark_checkpoint",
        description=(
            "Mark a build-progress checkpoint reached. Call exactly once per stage, "
            "in order: identity, voice, capabilities, review."
        ),
        parameters={
            "type": "object",
            "properties": {
                "stage": {
                    "type": "string",
                    "enum": ["identity", "voice", "capabilities", "review"],
                    "description": "Which checkpoint to mark"
                }
            },
            "required": ["stage"]
        }
    )
    def mark_checkpoint(self, args, raw_data):
        stage = args.get("stage", "")
        logger.info(f"[wizard] mark_checkpoint: {stage}")
        result = SwaigFunctionResult("")  # silent — no spoken response
        result.swml_user_event({
            "type": "wizard_checkpoint",
            "stage": stage
        })
        return result

    @AgentBase.tool(
        name="create_agent",
        description="Create the designed agent — builds the real agent and mounts it to a live endpoint",
        parameters={
            "type": "object",
            "properties": {
                "name": {
                    "type": "string",
                    "description": "Agent's name"
                },
                "role": {
                    "type": "string",
                    "description": "Agent's role or title"
                },
                "greeting": {
                    "type": "string",
                    "description": "The agent's opening greeting"
                },
                "prompt": {
                    "type": "string",
                    "description": "Full prompt/instructions for the agent"
                },
                "voice": {
                    "type": "string",
                    "description": "Voice to use (e.g. openai.nova)"
                },
                "language": {
                    "type": "string",
                    "description": "Language code (e.g. en-US)"
                },
                "temperature": {
                    "type": "number",
                    "description": "Model temperature (0.0–1.0)"
                },
                "functions": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "List of enabled function names"
                }
            },
            "required": ["name", "role", "prompt"]
        }
    )
    def create_agent(self, args, raw_data):
        logger.info(f"[WizardAgent.create_agent] CALLED with args={args}, raw_data keys={list(raw_data.keys()) if raw_data else None}")
        name = args.get("name", "New Agent")
        role = args.get("role", "Assistant")
        greeting = args.get("greeting", f"Hello, I'm {name}. How can I help you?")
        prompt = args.get("prompt", "")
        voice = args.get("voice", "openai.nova")
        language = args.get("language", "en-US")
        temperature = args.get("temperature", 0.7)
        functions = args.get("functions", [])

        # Dedup guard: SignalWire retries SWAIG calls if a tool exceeds its
        # response timeout. Without this guard each retry creates a new
        # employee. Key the in-flight map by (call_id, name) so a genuinely
        # different agent in the same call still works.
        call_id = (raw_data or {}).get("call_id", "") if isinstance(raw_data, dict) else ""
        dedup_key = f"{call_id}:{name}"
        existing = _wizard_create_inflight.get(dedup_key)
        if existing:
            if existing.get("status") == "done":
                logger.info(f"[wizard] create_agent: returning cached result for {dedup_key}")
                return existing["result"]
            # Still in progress — return a "we're working on it" response.
            logger.info(f"[wizard] create_agent: orchestration already in flight for {dedup_key}, acknowledging")
            ack_text = f"I'm still building {name}. Please give it a moment."
            ack = SwaigFunctionResult(ack_text)
            ack.swml_user_event({"type": "wizard_said", "text": ack_text})
            return ack
        _wizard_create_inflight[dedup_key] = {"status": "in_flight"}

        # Orchestrate via the frontend route so the agent gets a real
        # SignalWire SWML resource, a callFabricAddress, and a SQLite row —
        # the same path used by the dashboard's "Create Employee" button.
        project_id = (raw_data or {}).get("project_id") if isinstance(raw_data, dict) else None
        creds = _wizard_lookup_user_credentials(project_id)
        if not creds:
            logger.error(f"[wizard] create_agent: no credentials for project_id={project_id!r}")
            err_text = (
                "I couldn't find your SignalWire credentials. Please make sure you've logged in "
                "on the dashboard before creating agents through the wizard."
            )
            result = SwaigFunctionResult(err_text)
            result.swml_user_event({"type": "wizard_said", "text": err_text})
            _wizard_create_inflight.pop(dedup_key, None)
            return result

        employee_data = {
            "name": name,
            "role": role,
            "greeting": greeting,
            "prompt": prompt,
            "voice": voice,
            "language": language,
            "temperature": temperature,
            "enabled_functions": functions,
            "speech_hints": [],
        }

        try:
            response = _wizard_create_employee_via_frontend(employee_data, creds)
        except Exception as e:
            logger.error(f"[wizard] create_agent: orchestration failed: {e}")
            err_text = f"The build didn't go through — {e}. Want to try again?"
            result = SwaigFunctionResult(err_text)
            result.swml_user_event({"type": "wizard_said", "text": err_text})
            _wizard_create_inflight.pop(dedup_key, None)
            return result

        employee = response.get("employee") or {}
        employee_id = employee.get("id", "")
        call_fabric_address = employee.get("callFabricAddress") or employee.get("call_fabric_address") or ""
        logger.info(f"[wizard] Created agent via frontend: {name} ({employee_id}) at {call_fabric_address}")

        result = SwaigFunctionResult(
            f"Your agent {name} has been created and is live! "
            "I've updated the dashboard. Give it a moment to load, then you can make your first call."
        )
        result.swml_user_event({
            "type": "agent_created",
            "employee": {**employee, "id": employee_id, "callFabricAddress": call_fabric_address},
            "swml_route": f"/swml/{employee_id}",
        })
        result.swml_user_event({
            "type": "wizard_said",
            "text": f"Your agent {name} has been created and is live! "
                    "I've updated the dashboard. Give it a moment to load, then you can make your first call."
        })
        # Cache the successful result so any retry within this call returns the same agent
        # rather than creating a duplicate.
        _wizard_create_inflight[dedup_key] = {"status": "done", "result": result, "employee": employee}
        logger.info(f"[WizardAgent.create_agent] RETURNING")
        return result

    @AgentBase.tool(
        name="finalize_agent",
        description="Signal that the agent is ready for calls and the setup process is complete",
        parameters={
            "type": "object",
            "properties": {
                "employee_id": {
                    "type": "string",
                    "description": "The ID of the created employee"
                },
                "message": {
                    "type": "string",
                    "description": "A completion message to display to the user"
                }
            },
            "required": ["employee_id"]
        }
    )
    def finalize_agent(self, args, raw_data):
        logger.info(f"[WizardAgent.finalize_agent] CALLED with args={args}, raw_data keys={list(raw_data.keys()) if raw_data else None}")
        employee_id = args.get("employee_id", "")
        message = args.get("message", "Your agent is ready to take calls!")

        logger.info(f"[wizard] finalize_agent: employee_id={employee_id}")

        result = SwaigFunctionResult(
            "Your agent is all set and ready to go. Is there anything else you'd like to adjust, "
            "or would you like to create another agent?"
        )
        result.swml_user_event({
            "type": "agent_ready",
            "employee_id": employee_id,
            "message": message
        })
        result.swml_user_event({
            "type": "wizard_said",
            "text": "Your agent is all set and ready to go. Is there anything else you'd like to adjust, "
                    "or would you like to create another agent?"
        })
        logger.info(f"[WizardAgent.finalize_agent] RETURNING")
        return result

    @AgentBase.tool(
        name="list_available_functions",
        description="Returns a list of all available capabilities that can be enabled for an agent",
        parameters={
            "type": "object",
            "properties": {}
        }
    )
    def list_available_functions(self, args, raw_data):
        logger.info(f"[WizardAgent.list_available_functions] CALLED with args={args}, raw_data keys={list(raw_data.keys()) if raw_data else None}")
        logger.info("[wizard] list_available_functions called")

        functions_list = (
            "Here are the available capabilities you can enable for your agent:\n"
            "- transfer_to_human: Transfer callers to a real person at a phone number\n"
            "- send_summary_sms: Send text message summaries or confirmations to callers\n"
            "- schedule_callback: Schedule a phone callback for a later time\n"
            "- check_business_hours: Tell callers if you are currently open\n"
            "- collect_customer_info: Gather and store caller name, email, phone, and company\n"
            "- send_email: Send follow-up emails to callers via SendGrid\n"
            "- search_knowledge: Search uploaded documents to answer caller questions"
        )
        logger.info(f"[WizardAgent.list_available_functions] RETURNING")
        return SwaigFunctionResult(functions_list)


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


_HANDLERS_SOURCE_CACHE: Optional[str] = None
_HANDLERS_START = "# === HANDLERS START ==="
_HANDLERS_END = "# === HANDLERS END ==="


def _read_handlers_source() -> str:
    """Read agent/swaig_handlers.py as text, stripping its top-level imports.

    The generated file has its own consolidated import block; embedding the
    handlers' imports too would cause duplicate-import warnings and noise.
    Anything above the logger declaration is stripped.
    """
    global _HANDLERS_SOURCE_CACHE
    if _HANDLERS_SOURCE_CACHE is not None:
        return _HANDLERS_SOURCE_CACHE
    src = (_Path(__file__).parent / "swaig_handlers.py").read_text()
    # Find the line "logger = logging.getLogger(__name__)" — everything above
    # is module imports we'll consolidate at the top of the generated file.
    marker = "logger = logging.getLogger(__name__)"
    idx = src.find(marker)
    if idx == -1:
        # Fallback: keep the whole file (drift-guard test will then need to
        # account for this; we treat this as a hard error so it can't slip).
        raise RuntimeError("swaig_handlers.py missing expected logger marker")
    # Keep from the marker onward (logger declaration + everything below).
    _HANDLERS_SOURCE_CACHE = src[idx:]
    return _HANDLERS_SOURCE_CACHE


def _safe_class_name(name: str) -> str:
    """Convert "Sally Sales" -> "SallySalesAgent". Falls back to "EmployeeAgent"."""
    parts = re.findall(r"[A-Za-z0-9]+", name or "")
    capitalized = "".join(p[:1].upper() + p[1:] for p in parts) or "Employee"
    if not capitalized[0].isalpha():
        capitalized = "Employee" + capitalized
    return capitalized + "Agent" if not capitalized.endswith("Agent") else capitalized


def _env_block(enabled_functions: list) -> str:
    needs_signalwire = "search_knowledge" in enabled_functions
    needs_sendgrid = "send_email" in enabled_functions
    if not (needs_signalwire or needs_sendgrid):
        return "# No env vars required — this agent is fully self-contained.\n"
    lines = ["# Required env vars:"]
    if needs_signalwire:
        lines += [
            "#   SIGNALWIRE_SPACE       e.g. yourspace.signalwire.com",
            "#   SIGNALWIRE_PROJECT_ID  UUID of your SignalWire project",
            "#   SIGNALWIRE_TOKEN       REST API token",
        ]
    if needs_sendgrid:
        lines.append("#   SENDGRID_API_KEY       SendGrid API key for outbound email")
    return "\n".join(lines) + "\n"


def _generate_sdk_code(employee_config: Dict[str, Any]) -> str:
    """Render runnable Python that, when executed, builds an agent equivalent
    to the live HireWire one — same SWML, same SWAIG behavior."""
    name = employee_config.get("name", "Employee")
    role = employee_config.get("role", "Assistant")
    employee_id = employee_config.get("id", "employee")
    voice = employee_config.get("voice", "openai.nova")
    language = employee_config.get("language", "en-US")
    temperature = employee_config.get("temperature", 0.7)
    greeting = employee_config.get("greeting", "")
    prompt_body = employee_config.get("prompt", "")
    enabled_functions = list(employee_config.get("enabled_functions") or [])
    business_hours_start = employee_config.get("business_hours_start", 9)
    business_hours_end = employee_config.get("business_hours_end", 18)
    business_days = employee_config.get("business_days", [0, 1, 2, 3, 4])
    transfer_number = employee_config.get("transfer_number", "")
    transfer_from = employee_config.get("transfer_from", "")
    sms_from_number = employee_config.get("sms_from_number", "")
    email_from_address = employee_config.get("email_from_address", "")
    email_from_name = employee_config.get("email_from_name", "")
    documents = employee_config.get("documents", [])

    class_name = _safe_class_name(name)
    needs_os_import = ("search_knowledge" in enabled_functions) or ("send_email" in enabled_functions)

    # Build the embedded config dict — every value the handlers may read.
    inline_config = {
        "id": employee_id, "name": name,
        "phone_number": employee_config.get("phone_number", ""),  # fallback for transfer_to_human
        "transfer_number": transfer_number,
        "transfer_from": transfer_from,
        "sms_from_number": sms_from_number,
        "email_from_address": email_from_address,
        "email_from_name": email_from_name,
        "business_hours_start": business_hours_start,
        "business_hours_end": business_hours_end,
        "business_days": business_days,
        # NB: sendgrid_api_key intentionally absent — handler falls through
        # to os.getenv("SENDGRID_API_KEY"), keeping the secret out of the file.
    }

    # Compose
    handlers_source = _read_handlers_source()
    env_block = _env_block(enabled_functions)
    safe_prompt = prompt_body.replace('"""', '\\"\\"\\"')

    # Build SWAIG method blocks — mirrors VirtualEmployeeAgent._configure_functions:
    # when enabled_functions is empty (falsy), all tools remain (none removed);
    # when enabled_functions is non-empty, only listed ones are registered.
    _ALL_SWAIG = [
        "transfer_to_human", "send_summary_sms", "schedule_callback",
        "check_business_hours", "collect_customer_info", "send_email",
    ]
    if not enabled_functions:
        # Live: no removal loop runs → all 6 tools stay registered.
        active_fns = _ALL_SWAIG
    else:
        # Live: removal loop runs, keeps only what's in enabled_functions.
        active_fns = [
            f for f in enabled_functions
            if f in set(_ALL_SWAIG)
        ]
    swaig_methods = []
    for fn_id in active_fns:
        const = fn_id.upper()
        swaig_methods.append(
            f"    @AgentBase.tool(**{const})\n"
            f"    def {fn_id}(self, args, raw_data):\n"
            f"        return {fn_id}(self._config, args, raw_data)\n"
        )
    swaig_methods_block = "\n".join(swaig_methods) if swaig_methods else "    pass  # no SWAIG functions enabled\n"

    # Build DataSphere skill registration block.
    if "search_knowledge" in enabled_functions and documents:
        ds_lines = [
            "        # DataSphere knowledge bases (requires SIGNALWIRE_* env vars)",
            "        space_name = os.environ['SIGNALWIRE_SPACE']",
            "        project_id = os.environ['SIGNALWIRE_PROJECT_ID']",
            "        token = os.environ['SIGNALWIRE_TOKEN']",
            "        import hashlib",
            "        doc_descriptions = []",
            f"        documents = {json.dumps(documents)}",
            "        for doc in documents:",
            "            doc_id = doc.get('document_id', '') if isinstance(doc, dict) else doc",
            "            doc_name = doc.get('name', doc_id[:8]) if isinstance(doc, dict) else doc_id[:8]",
            "            doc_desc = doc.get('description', '') if isinstance(doc, dict) else ''",
            "            doc_distance = doc.get('distance', 3.0) if isinstance(doc, dict) else 3.0",
            "            if not doc_id:",
            "                continue",
            "            doc_hash = hashlib.md5(str(doc_id).encode()).hexdigest()[:6]",
            "            safe_name = doc_name.lower().replace(' ', '_').replace('-', '_')[:20]",
            "            tool_name = f'search_{safe_name}_{doc_hash}'",
            "            self.add_skill('datasphere_serverless', {",
            "                'space_name': space_name, 'project_id': project_id, 'token': token,",
            "                'document_id': doc_id, 'count': 3, 'distance': doc_distance,",
            "                'tool_name': tool_name,",
            "                'description': doc_desc or f'Search the {doc_name} knowledge base',",
            "                'swaig_fields': {'fillers': {'en-US': [",
            "                    'Let me check our documentation...',",
            "                    'Searching our knowledge base...',",
            "                    'Looking that up for you...',",
            "                ]}},",
            "            })",
            "            doc_descriptions.append(f'- {tool_name}: {doc_desc or doc_name}')",
            "        if len(doc_descriptions) > 1:",
            "            routing = 'You have access to these knowledge bases:\\n' + '\\n'.join(doc_descriptions)",
            "            routing += '\\nChoose the most relevant one based on the caller\\'s question.'",
            "            self.add_pom_section('Knowledge Base Routing', body=routing)",
        ]
        ds_block = "\n".join(ds_lines)
    else:
        ds_block = "        # search_knowledge not enabled — no DataSphere setup."

    # Personality / prompt / voice block — mirrors VirtualEmployeeAgent.__init__
    # for the parts that affect SWML output.
    sms_guideline_emit = ""
    if "send_summary_sms" in enabled_functions:
        sms_guideline_emit = (
            "        guidelines.append("
            "'Before ending the call, ask the caller if they would like a summary "
            "sent to their phone via text message. If yes, ask for their phone "
            "number, then use the send_summary_sms function.')\n"
        )

    # Instructions POM section — only emitted when prompt is non-empty (matches
    # _update_personality's `if prompt:` guard).
    if prompt_body:
        instructions_emit = (
            f'        self.prompt_add_section("Instructions", body="""{safe_prompt}""")'
        )
    else:
        instructions_emit = (
            "        # No prompt body — Instructions section omitted (matches live behavior)"
        )

    header = f'''#!/usr/bin/env python3
"""
{name} ({role})

Generated agent code. Running this file produces SWML equivalent to the live
HireWire backend's `/swml/{employee_id}` endpoint, and every enabled SWAIG
function executes the same logic.

Requires: pip install signalwire-agents

Usage: python {employee_id}.py     # serves on http://localhost:3000

{env_block.rstrip()}
"""
'''

    # Always include all imports the handlers source needs (logging, os, re,
    # datetime, typing) plus signalwire_agents. The handlers source block is
    # embedded verbatim and relies on these at module level.
    imports = (
        "import logging\n"
        "import os\n"
        "import re\n"
        "from datetime import datetime\n"
        "from typing import Any, Dict\n"
        "from signalwire_agents import AgentBase, SwaigFunctionResult\n"
    )

    inline_config_repr = json.dumps(inline_config, indent=4)

    agent_class = f'''
{_HANDLERS_START}

{handlers_source}
{_HANDLERS_END}


class {class_name}(AgentBase):
    """Generated agent — mirrors HireWire VirtualEmployeeAgent for this employee."""

    def __init__(self):
        super().__init__(name="{name}", route="/swml/{employee_id}", host="0.0.0.0", port=3000)
        self._config = {inline_config_repr}
        self.add_language(name="English", code="{language}", voice="{voice}",
            speech_fillers=[
                "Let me help you with that...",
                "One moment please...",
                "I\\'m processing your request...",
            ],
            function_fillers=[
                "Let me check on that for you...",
                "I\\'m looking that up now...",
            ],
        )
        self.set_param("temperature", {temperature})
        self.prompt_add_section("Identity",
            body=f"You are {name}, a {role}. Your greeting is: \\"{greeting}\\"")
{instructions_emit}
        guidelines = [
            "Keep responses to 1-3 sentences — this is a phone call, not a text chat",
            "Be conversational and natural, not robotic",
            "Listen fully before responding",
            "If you are unsure about something, say so and offer to connect the caller with a human",
            "Always end interactions with a clear next step",
        ]
{sms_guideline_emit}        self.prompt_add_section("Voice Interaction Guidelines", bullets=guidelines)
        self.set_post_prompt(POST_PROMPT_TEMPLATE)
{ds_block}

    def on_swml_request(self, request_data=None, callback_path=None, request=None):
        # Enable live transcription with the agent's primary language.
        self.add_verb("live_transcribe", {{
            "action": "start",
            "lang": "{language}".split("-")[0],
            "live_events": True,
            "direction": ["remote-caller", "local-caller"],
        }})
        return super().on_swml_request(request_data, callback_path, request)

{swaig_methods_block}

if __name__ == "__main__":
    {class_name}().run()
'''

    return header + "\n" + imports + agent_class


@app.get("/agent-code/{employee_id}", response_class=PlainTextResponse)
async def get_agent_code(employee_id: str = Path(...)):
    if employee_id not in employees:
        raise HTTPException(status_code=404, detail="Employee not found")
    return _generate_sdk_code(employees[employee_id])


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
