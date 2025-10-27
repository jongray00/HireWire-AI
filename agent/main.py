#!/usr/bin/env python3
"""
Sally Sales AI Agent Backend

This agent serves SWML dynamically based on configuration sent from the UI.
The SWML configuration is stored in memory and can be updated via API.
"""

import os
from dotenv import load_dotenv

# Load environment variables from .env file
load_dotenv()

# Load credentials and domain from .env
# These will be used by the SignalWire agent SDK for authentication
SWML_USER = os.getenv('SWML_BASIC_AUTH_USER', 'signalwire')
SWML_PASSWORD = os.getenv('SWML_BASIC_AUTH_PASSWORD', 'signalwire')
APP_DOMAIN = os.getenv('APP_DOMAIN', '')

from signalwire_agents import AgentBase, SwaigFunctionResult
from fastapi import FastAPI, Request, HTTPException
from fastapi.middleware.cors import CORSMiddleware
import uvicorn
import logging
import json
from typing import Dict, Any, Optional
from datetime import datetime

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Global storage for agent configuration
agent_config: Dict[str, Any] = {
    "prompt": "I run a pizza shop. Customers should be able to: 1) Order pizza, 2) Check delivery status, 3) Speak to a manager",
    "functions": [],
    "created_at": datetime.now().isoformat()
}

# Forward reference to agent instance
agent_instance = None

# Store agent credentials globally for the health endpoint
# Initialize with values from .env
agent_credentials = {
    "username": SWML_USER,
    "password": SWML_PASSWORD,
    "app_domain": APP_DOMAIN
}


class SallySalesAgent(AgentBase):
    """Dynamic AI agent that serves SWML based on configuration"""

    def __init__(self):
        super().__init__(
            name="SallySales",
            route="/swml"
        )

        # Configure voice
        self.add_language(
            name="English",
            code="en-US",
            voice="openai.nova",
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
        self.speech_hints = [
            "order", "pizza", "delivery", "status",
            "manager", "agent", "representative", "help", "support"
        ]

        # Configure base personality
        self._update_personality()

    def _update_personality(self):
        """Update agent personality from global config"""
        global agent_config

        prompt = agent_config.get("prompt", "")

        # Extract business type from prompt
        business_type = self._extract_business_type(prompt)

        # Set personality based on prompt
        personality = f"""You are a helpful AI assistant for a {business_type}.

Based on the following context:
{prompt}

Your role is to:
1. Greet callers professionally and warmly
2. Listen to their needs carefully
3. Use the available functions to help them
4. Provide clear, concise information
5. Always be polite, professional, and helpful
6. If you're unsure about something, offer to connect them to a human representative

Keep responses conversational and natural. Don't read off menu options unless specifically asked."""

        self.prompt_add_section("Personality", personality)

    def _extract_business_type(self, prompt: str) -> str:
        """Extract business type from prompt"""
        prompt_lower = prompt.lower()

        if "pizza" in prompt_lower or "restaurant" in prompt_lower:
            return "pizza restaurant"
        elif "dental" in prompt_lower or "dentist" in prompt_lower:
            return "dental office"
        elif "tech support" in prompt_lower or "technical" in prompt_lower:
            return "technical support center"
        elif "shop" in prompt_lower or "store" in prompt_lower:
            return "shop"
        else:
            return "business"

    def get_app(self):
        """Override get_app to add custom API endpoints"""
        if self._app is None:
            from fastapi import FastAPI
            from fastapi.middleware.cors import CORSMiddleware

            # Create the FastAPI app
            app = FastAPI(
                title="Sally Sales Agent",
                description="AI-powered sales agent with dynamic configuration"
            )

            # Add CORS middleware
            app.add_middleware(
                CORSMiddleware,
                allow_origins=["*"],
                allow_credentials=True,
                allow_methods=["*"],
                allow_headers=["*"],
            )

            # Add middleware to bypass BasicAuth for all requests
            # SignalWire doesn't support auth credentials in webhook URLs
            @app.middleware("http")
            async def bypass_auth(request: Request, call_next):
                # Allow all requests without authentication
                response = await call_next(request)
                return response

            # Add custom API endpoints
            @app.post("/api/update-config")
            async def update_config(request: Request):
                """Update agent configuration from UI"""
                global agent_config

                try:
                    data = await request.json()

                    # Update configuration
                    agent_config["prompt"] = data.get("prompt", agent_config["prompt"])
                    agent_config["updated_at"] = datetime.now().isoformat()

                    # Reinitialize agent with new config
                    self._update_personality()

                    logger.info(f"Agent configuration updated: {agent_config['prompt'][:100]}...")

                    return {
                        "success": True,
                        "message": "Agent configuration updated",
                        "config": agent_config
                    }

                except Exception as e:
                    logger.error(f"Error updating config: {str(e)}")
                    raise HTTPException(status_code=500, detail=str(e))

            @app.get("/api/config")
            async def get_config():
                """Get current agent configuration"""
                global agent_credentials

                return {
                    "success": True,
                    "config": agent_config,
                    "credentials": agent_credentials,
                    # SWML URL is dynamically constructed by the Next.js frontend based on where it's accessed
                    # This allows the app to work on any hosting platform (ngrok, Replit, production, etc.)
                    "swml_url": "/api/swml"  # Relative path - frontend will construct full URL
                }

            @app.get("/api/agent-info")
            async def get_agent_info():
                """Get agent information including credentials for UI"""
                global agent_credentials

                logger.info(f"Agent info requested, agent_credentials = {agent_credentials}")

                result = {
                    "status": "healthy",
                    "agent": "Sally Sales",
                    "route": "/swml",
                    "functions": 6,
                    "timestamp": datetime.now().isoformat(),
                    "credentials": agent_credentials
                }

                logger.info(f"Returning agent info: {result}")
                return result

            @app.post("/api/transcript-event")
            async def handle_transcript_event(request: Request):
                """Receive live transcript events and forward to WebRTC clients"""
                try:
                    data = await request.json()

                    speaker = data.get("speaker", "unknown")
                    text = data.get("text", "")
                    call_id = data.get("call_id")
                    is_final = data.get("is_final", False)
                    confidence = data.get("confidence")

                    logger.info("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
                    logger.info("📝 TRANSCRIPT EVENT RECEIVED IN PYTHON BACKEND")
                    logger.info(f"🗣️  Speaker: {speaker}")
                    logger.info(f"💬 Text: {text}")
                    logger.info(f"🎯 Call ID: {call_id}")
                    logger.info(f"✅ Is Final: {is_final}")
                    logger.info(f"📊 Confidence: {confidence}")
                    logger.info("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")

                    # Map speaker labels to frontend-friendly format
                    speaker_label = 'ai' if speaker in ['local-caller', 'local', 'agent'] else 'user'

                    # For now, just log the transcript
                    # SignalWire's live_transcribe may automatically send caption events to the client
                    # If not, we'll need to use SignalWire's REST API to send user events
                    # That would require call/room session ID which may not be in this payload
                    logger.info(f"📤 Mapped speaker '{speaker}' to '{speaker_label}'")
                    logger.info(f"💾 Transcript logged for debugging")

                    return {
                        "success": True,
                        "message": "Transcript received and logged",
                        "speaker": speaker_label,
                        "text": text,
                        "call_id": call_id
                    }

                except Exception as e:
                    logger.error(f"Error handling transcript event: {str(e)}")
                    raise HTTPException(status_code=500, detail=str(e))

            # Create router for SWML endpoints
            router = self.as_router()

            # Remove BasicAuth dependency from the router
            # SignalWire doesn't support auth credentials in webhook URLs
            # We need to manually strip the auth middleware
            if hasattr(router, 'dependencies'):
                # Remove any BasicAuth dependencies
                router.dependencies = [dep for dep in router.dependencies if 'BasicAuth' not in str(type(dep))]

            # Credentials are loaded from .env file
            # No need to search for SDK-generated passwords
            global agent_credentials
            logger.info(f"Using credentials from .env: {agent_credentials['username']}:***")
            logger.info(f"APP_DOMAIN from .env: {agent_credentials['app_domain']}")

            # Mount the SWML router at /swml
            app.include_router(router, prefix=self.route)

            self._app = app

        return self._app

    @AgentBase.tool(
        name="route_to_order",
        description="Route caller to order department",
        parameters={
            "type": "object",
            "properties": {
                "reason": {
                    "type": "string",
                    "description": "Reason for routing to this department"
                }
            }
        }
    )
    def route_to_order(self, args, raw_data):
        """Route to order department"""
        reason = args.get("reason", "General inquiry")

        logger.info(f"Routing to order department: {reason}")

        result = SwaigFunctionResult(
            "I'll connect you with our order team right away. Please hold while I transfer your call."
        )

        # Send real-time event to UI
        result.swml_user_event({
            "type": "routing_decision",
            "department": "order",
            "reason": reason,
            "transfer_number": "+15551234567",
            "timestamp": datetime.now().isoformat()
        })

        return result

    @AgentBase.tool(
        name="route_to_schedule",
        description="Route caller to scheduling/appointments department",
        parameters={
            "type": "object",
            "properties": {
                "reason": {
                    "type": "string",
                    "description": "Reason for routing"
                }
            }
        }
    )
    def route_to_schedule(self, args, raw_data):
        """Route to scheduling department"""
        reason = args.get("reason", "Schedule appointment")

        result = SwaigFunctionResult(
            "I'll connect you with our scheduling team. One moment please."
        )

        result.swml_user_event({
            "type": "routing_decision",
            "department": "scheduling",
            "reason": reason,
            "timestamp": datetime.now().isoformat()
        })

        return result

    @AgentBase.tool(
        name="route_to_support",
        description="Route caller to customer support",
        parameters={
            "type": "object",
            "properties": {
                "reason": {
                    "type": "string",
                    "description": "Reason for routing"
                }
            }
        }
    )
    def route_to_support(self, args, raw_data):
        """Route to support department"""
        reason = args.get("reason", "Support request")

        result = SwaigFunctionResult(
            "I'll connect you with our support team right away."
        )

        result.swml_user_event({
            "type": "routing_decision",
            "department": "support",
            "reason": reason,
            "timestamp": datetime.now().isoformat()
        })

        return result

    @AgentBase.tool(
        name="demo_order_item",
        description="Add an item to customer's order (demo function)",
        parameters={
            "type": "object",
            "properties": {
                "item_name": {
                    "type": "string",
                    "description": "Name of the item to order"
                },
                "quantity": {
                    "type": "integer",
                    "description": "Quantity to order",
                    "default": 1
                }
            },
            "required": ["item_name"]
        }
    )
    def demo_order_item(self, args, raw_data):
        """Demo function to add items to order"""
        item_name = args.get("item_name", "item")
        quantity = args.get("quantity", 1)
        price = 12.99
        total = round(quantity * price, 2)

        result = SwaigFunctionResult(
            f"Great! I've added {quantity} {item_name} to your order for ${total}. Is there anything else you'd like to add?"
        )

        result.swml_user_event({
            "type": "item_added",
            "item": {
                "name": item_name,
                "quantity": quantity,
                "price": price,
                "total": total
            },
            "order_total": total,
            "timestamp": datetime.now().isoformat()
        })

        return result

    @AgentBase.tool(
        name="demo_get_status",
        description="Check the status of an order (demo function)",
        parameters={
            "type": "object",
            "properties": {
                "order_number": {
                    "type": "string",
                    "description": "Order number to check"
                }
            }
        }
    )
    def demo_get_status(self, args, raw_data):
        """Demo function to check order status"""
        order_number = args.get("order_number", "12345")

        # Mock status
        status_info = {
            "order_number": order_number,
            "status": "In Progress",
            "estimated_completion": "15 minutes",
            "items": ["Pizza Margherita", "Garlic Bread"]
        }

        result = SwaigFunctionResult(
            f"Order {order_number} is currently {status_info['status']}. "
            f"Your {' and '.join(status_info['items'])} should be ready in about {status_info['estimated_completion']}."
        )

        result.swml_user_event({
            "type": "status_checked",
            "order": status_info,
            "timestamp": datetime.now().isoformat()
        })

        return result

    @AgentBase.tool(
        name="transfer_call",
        description="Transfer call to a human representative",
        parameters={
            "type": "object",
            "properties": {
                "department": {
                    "type": "string",
                    "description": "Department to transfer to",
                    "default": "general"
                },
                "reason": {
                    "type": "string",
                    "description": "Reason for transfer"
                }
            }
        }
    )
    def transfer_call(self, args, raw_data):
        """Transfer call to human"""
        department = args.get("department", "general")
        reason = args.get("reason", "Requested human assistance")

        logger.info(f"Transfer requested - Department: {department}, Reason: {reason}")

        result = SwaigFunctionResult(
            f"I'll connect you with a representative from our {department} team. Please hold while I transfer your call."
        )

        result.swml_user_event({
            "type": "transfer_initiated",
            "department": department,
            "reason": reason,
            "timestamp": datetime.now().isoformat()
        })

        return result

    def on_swml_request(self, request_data=None, callback_path=None, request=None):
        """Override to dynamically set video URLs and enable live transcription"""
        # Get the host from the request object if available
        host = None

        if request:
            # Try to get host from the request headers
            # FastAPI/Starlette headers are lowercase
            host = request.headers.get('x-forwarded-host') or request.headers.get('host')

            # Check if we're behind a proxy with x-forwarded-proto
            protocol = request.headers.get('x-forwarded-proto', 'https')

            # Override protocol for local development
            if host and ('localhost' in host or '127.0.0.1' in host):
                protocol = 'http'

        # If we found a host, update the video URLs
        if host:
            base_url = f"{protocol}://{host}"
            # Set video parameters for idle and talking states
            self.set_param("video_idle_file", f"{base_url}/videos/sally_idle.mp4")
            self.set_param("video_talking_file", f"{base_url}/videos/sally_talking.mp4")
            logger.info(f"Set video URLs to use host: {base_url}")
        else:
            # Fallback to ngrok URL if no host header found
            base_url = "https://jonnykarate.ngrok.io"
            self.set_param("video_idle_file", f"{base_url}/videos/sally_idle.mp4")
            self.set_param("video_talking_file", f"{base_url}/videos/sally_talking.mp4")
            logger.info("No host header found, using default video URLs")

        # Enable live transcription
        # Add live_transcribe verb to capture real-time speech-to-text
        # Trying without webhook first to see if SignalWire auto-broadcasts captions to WebRTC client
        self.add_verb({
            "live_transcribe": {
                "action": "start",
                # "webhook": f"{base_url}/api/transcribe",  # Commented out to test auto-broadcast
                "lang": "en",
                "live_events": True,
                "direction": ["remote-caller", "local-caller"]
            }
        })
        logger.info(f"Enabled live transcription (no webhook, testing auto-broadcast to WebRTC client)")

        # Call parent implementation
        return super().on_swml_request(request_data, callback_path, request)


# Initialize agent when module loads (for imports)
# Agent will be created when serve() is called
if __name__ == "__main__":
    logger.info("Starting Sally Sales Agent Backend...")
    logger.info("Agent will be available at: /swml")
    logger.info("Config API available at: /api/update-config")

    # Create and serve agent on port 8000
    agent = SallySalesAgent()

    # Write credentials from .env to file for web app to read
    logger.info("Writing credentials from .env to agent-credentials.json...")

    credentials_file = os.path.join(os.path.dirname(__file__), '..', 'web', 'agent-credentials.json')
    with open(credentials_file, 'w') as f:
        json.dump({
            "username": agent_credentials["username"],
            "password": agent_credentials["password"],
            "app_domain": agent_credentials["app_domain"],
            # SWML URL will be constructed using the app_domain from .env
            # Format: https://username:password@domain/api/swml
            "swml_url": f"{agent_credentials['app_domain']}/api/swml" if agent_credentials['app_domain'] else "/api/swml",
            "timestamp": datetime.now().isoformat()
        }, f, indent=2)
    logger.info(f"✓ Wrote credentials to: {credentials_file}")
    logger.info(f"✓ Username: {agent_credentials['username']}")
    logger.info(f"✓ Password: {agent_credentials['password'][:10]}...")
    logger.info(f"✓ App Domain: {agent_credentials['app_domain']}")

    # IMPORTANT: Call get_app() before serve() to ensure our custom endpoints are registered
    # The serve() method in the SDK checks if self._app is None, and if so, creates a default app
    # By calling get_app() first, we set self._app to our custom app with all the API endpoints
    logger.info("Initializing custom FastAPI app with API endpoints...")
    app = agent.get_app()
    logger.info(f"Custom app initialized with {len([r for r in app.routes])} routes")

    agent.serve(host="0.0.0.0", port=8000)
