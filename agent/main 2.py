#!/usr/bin/env python3
"""
Sally Sales AI Agent Backend

This agent serves SWML dynamically based on configuration sent from the UI.
The SWML configuration is stored in memory and can be updated via API.
"""

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
            voice="nova.luna",
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


# Create FastAPI app for configuration updates
app = FastAPI(title="Sally Sales Agent API")

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


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
        agent._update_personality()

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
    return {
        "success": True,
        "config": agent_config
    }


@app.get("/health")
async def health_check():
    """Health check endpoint"""
    return {
        "status": "healthy",
        "agent": "Sally Sales",
        "timestamp": datetime.now().isoformat()
    }


# Initialize agent
agent = SallySalesAgent()

# Mount agent routes to FastAPI app
app.mount("/", agent.app)


if __name__ == "__main__":
    logger.info("Starting Sally Sales Agent Backend...")
    logger.info("Agent will be available at: /swml")
    logger.info("Config API available at: /api/update-config")

    # Run on port 3030
    uvicorn.run(
        app,
        host="0.0.0.0",
        port=3030,
        log_level="info"
    )
