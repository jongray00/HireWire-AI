#!/usr/bin/env python3
"""
Sally Sales AI Agent Backend - Multi-Employee Support

This backend serves multiple SWML agents, one for each virtual employee.
Each employee has their own configuration and SWML endpoint.
"""

import os
import uuid
import json
import logging
from datetime import datetime
from typing import Dict, Any, Optional
from dotenv import load_dotenv

from signalwire_agents import AgentBase, SwaigFunctionResult
from fastapi import FastAPI, Request, HTTPException, Path
from fastapi.middleware.cors import CORSMiddleware
import uvicorn

# Load environment variables from .env file
load_dotenv()

# Load credentials and domain from .env
SWML_USER = os.getenv('SWML_BASIC_AUTH_USER', 'signalwire')
SWML_PASSWORD = os.getenv('SWML_BASIC_AUTH_PASSWORD', 'signalwire')
APP_DOMAIN = os.getenv('APP_DOMAIN', '')

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

        # Add enabled functions
        self._configure_functions()

    def _get_language_name(self, code: str) -> str:
        """Get language name from code"""
        lang_map = {
            'en-US': 'English',
            'es-ES': 'Spanish',
            'fr-FR': 'French',
            'de-DE': 'German',
            'it-IT': 'Italian',
            'pt-BR': 'Portuguese',
            'ja-JP': 'Japanese',
            'zh-CN': 'Chinese'
        }
        return lang_map.get(code, 'English')

    def _update_personality(self):
        """Update agent personality from employee config"""
        name = self.employee_config.get('name', 'Assistant')
        role = self.employee_config.get('role', 'Virtual Assistant')
        greeting = self.employee_config.get('greeting', f'Hello, I am {name}.')
        prompt = self.employee_config.get('prompt', '')

        personality = f"""{greeting}

I am {name}, your {role}.

{prompt}

My role is to:
1. Greet callers professionally and warmly
2. Listen to their needs carefully
3. Use the available functions to help them
4. Provide clear, concise information
5. Always be polite, professional, and helpful
6. If I'm unsure about something, offer to connect them to a human representative

I keep responses conversational and natural."""

        self.prompt_add_section("Personality", personality)

        # Set temperature if specified
        temperature = self.employee_config.get('temperature', 0.7)
        self.set_param("temperature", temperature)

    def _configure_functions(self):
        """Configure which functions are enabled for this employee"""
        enabled_functions = self.employee_config.get('enabled_functions', [])
        logger.info(f"Employee {self.employee_id} enabled functions: {enabled_functions}")
        # Functions are defined as decorators below

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
        logger.info(f"[{self.employee_id}] Routing to order department: {reason}")

        result = SwaigFunctionResult(
            "I'll connect you with our order team right away. Please hold while I transfer your call."
        )

        result.swml_user_event({
            "type": "routing_decision",
            "employee_id": self.employee_id,
            "department": "order",
            "reason": reason,
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
            "employee_id": self.employee_id,
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
            "employee_id": self.employee_id,
            "department": "support",
            "reason": reason,
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

        logger.info(f"[{self.employee_id}] Transfer requested - Department: {department}, Reason: {reason}")

        result = SwaigFunctionResult(
            f"I'll connect you with a representative from our {department} team. Please hold while I transfer your call."
        )

        result.swml_user_event({
            "type": "transfer_initiated",
            "employee_id": self.employee_id,
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
            host = request.headers.get('x-forwarded-host') or request.headers.get('host')
            protocol = request.headers.get('x-forwarded-proto', 'https')

            if host and ('localhost' in host or '127.0.0.1' in host):
                protocol = 'http'

        # If we found a host, update the video URLs
        if host:
            base_url = f"{protocol}://{host}"
            self.set_param("video_idle_file", f"{base_url}/videos/sally_idle.mp4")
            self.set_param("video_talking_file", f"{base_url}/videos/sally_talking.mp4")
            logger.info(f"[{self.employee_id}] Set video URLs to use host: {base_url}")
        else:
            base_url = APP_DOMAIN or "https://jonnykarate.ngrok.io"
            self.set_param("video_idle_file", f"{base_url}/videos/sally_idle.mp4")
            self.set_param("video_talking_file", f"{base_url}/videos/sally_talking.mp4")

        # Enable live transcription
        self.add_verb({
            "live_transcribe": {
                "action": "start",
                "lang": self.employee_config.get('language', 'en-US').split('-')[0],
                "live_events": True,
                "direction": ["remote-caller", "local-caller"]
            }
        })

        return super().on_swml_request(request_data, callback_path, request)


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


# Employee Management API Endpoints

@app.post("/api/create-employee")
async def create_employee(request: Request):
    """Create a new virtual employee"""
    try:
        data = await request.json()

        # Generate unique ID
        employee_id = str(uuid.uuid4())[:8]

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
            "enabled_functions": data.get("enabled_functions", ["transfer_call"]),
            "created_at": datetime.now().isoformat(),
            "updated_at": datetime.now().isoformat(),
            "status": "active"
        }

        # Store employee
        employees[employee_id] = employee_config

        # Create agent instance
        agent = VirtualEmployeeAgent(employee_config)
        agent_instances[employee_id] = agent

        # Mount the agent router
        router = agent.as_router()
        if hasattr(router, 'dependencies'):
            router.dependencies = [dep for dep in router.dependencies if 'BasicAuth' not in str(type(dep))]
        app.include_router(router, prefix=agent.route)

        logger.info(f"✅ Created virtual employee: {employee_config['name']} ({employee_id})")
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
            "updated_at": datetime.now().isoformat()
        })

        # Recreate agent instance with new config
        agent = VirtualEmployeeAgent(employee_config)
        agent_instances[employee_id] = agent

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
                "enabled_functions": ["transfer_call"],
                "created_at": datetime.now().isoformat(),
                "updated_at": datetime.now().isoformat(),
                "status": "active"
            }
            employees[default_id] = employee_config

            # Create agent
            agent = VirtualEmployeeAgent(employee_config)
            agent_instances[default_id] = agent
            router = agent.as_router()
            if hasattr(router, 'dependencies'):
                router.dependencies = [dep for dep in router.dependencies if 'BasicAuth' not in str(type(dep))]
            app.include_router(router, prefix=agent.route)
        else:
            # Update existing
            employees[default_id]["prompt"] = data.get("prompt", employees[default_id]["prompt"])
            employees[default_id]["updated_at"] = datetime.now().isoformat()

            # Recreate agent
            agent = VirtualEmployeeAgent(employees[default_id])
            agent_instances[default_id] = agent

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

    return {
        "success": True,
        "config": config,
        "credentials": agent_credentials,
        "swml_url": "/api/swml"
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
@app.get("/health")
async def health_check():
    """Health check endpoint"""
    return {
        "status": "healthy",
        "employees": len(employees),
        "timestamp": datetime.now().isoformat()
    }


# Main entry point
if __name__ == "__main__":
    logger.info("=" * 60)
    logger.info("🚀 Starting Virtual Employees Backend")
    logger.info("=" * 60)
    logger.info(f"📋 Multi-Agent System Initialized")
    logger.info(f"🔐 Credentials: {agent_credentials['username']}:***")
    logger.info(f"🌐 App Domain: {agent_credentials['app_domain']}")
    logger.info(f"🎯 Employees will be available at: /swml/{{employee_id}}")
    logger.info("=" * 60)

    # Write credentials to file for web app
    credentials_file = os.path.join(os.path.dirname(__file__), '..', 'web', 'agent-credentials.json')
    with open(credentials_file, 'w') as f:
        json.dump({
            "username": agent_credentials["username"],
            "password": agent_credentials["password"],
            "app_domain": agent_credentials["app_domain"],
            "swml_url": f"{agent_credentials['app_domain']}/api/swml" if agent_credentials['app_domain'] else "/api/swml",
            "timestamp": datetime.now().isoformat()
        }, f, indent=2)
    logger.info(f"✅ Wrote credentials to: {credentials_file}")

    # Start server
    uvicorn.run(app, host="0.0.0.0", port=8000)
