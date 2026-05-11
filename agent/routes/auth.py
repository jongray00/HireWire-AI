"""Auth endpoints called by the web layer.

POST /api/auth/validate-credentials
   Headers: X-Agent-API-Key
   Body:    { signalwire_project_id, api_token, space_url }
   Returns: 200 { valid: true, displayName } | 401 invalid_credentials |
            503 signalwire_unreachable | 400 invalid_input
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from agent.lib import signalwire_auth
from agent.lib.auth import require_api_key_only

router = APIRouter()


class ValidateCredsBody(BaseModel):
    signalwire_project_id: str = Field(min_length=1, max_length=128)
    api_token: str = Field(min_length=1, max_length=512)
    space_url: str = Field(min_length=4, max_length=255)


@router.post("/api/auth/validate-credentials")
async def validate_credentials_endpoint(
    body: ValidateCredsBody,
    _: None = Depends(require_api_key_only),
):
    try:
        info = await signalwire_auth.validate_credentials(
            signalwire_project_id=body.signalwire_project_id,
            api_token=body.api_token,
            space_url=body.space_url,
        )
    except signalwire_auth.SignalWireAuthError:
        raise HTTPException(status_code=401, detail="invalid_credentials")
    except signalwire_auth.SignalWireUnreachable:
        raise HTTPException(status_code=503, detail="signalwire_unreachable")
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return {"valid": True, "displayName": info.get("display_name")}
