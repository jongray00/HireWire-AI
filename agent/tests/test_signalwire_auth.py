import pytest
import respx
import httpx

from agent.lib.signalwire_auth import (
    validate_credentials,
    SignalWireAuthError,
    SignalWireUnreachable,
)


@pytest.mark.asyncio
@respx.mock
async def test_valid_credentials_returns_account_info():
    respx.get(
        "https://acme.signalwire.com/api/relay/rest/projects/sw-proj-1"
    ).mock(return_value=httpx.Response(200, json={"name": "Acme", "id": "sw-proj-1"}))
    info = await validate_credentials(
        signalwire_project_id="sw-proj-1",
        api_token="real-token",
        space_url="acme.signalwire.com",
    )
    assert info["display_name"] == "Acme"


@pytest.mark.asyncio
@respx.mock
async def test_401_raises_auth_error():
    respx.get(
        "https://x.signalwire.com/api/relay/rest/projects/p"
    ).mock(return_value=httpx.Response(401, text="unauthorized"))
    with pytest.raises(SignalWireAuthError):
        await validate_credentials(
            signalwire_project_id="p", api_token="bad", space_url="x.signalwire.com"
        )


@pytest.mark.asyncio
@respx.mock
async def test_5xx_raises_unreachable():
    respx.get(
        "https://x.signalwire.com/api/relay/rest/projects/p"
    ).mock(return_value=httpx.Response(503))
    with pytest.raises(SignalWireUnreachable):
        await validate_credentials(
            signalwire_project_id="p", api_token="t", space_url="x.signalwire.com"
        )


@pytest.mark.asyncio
@respx.mock
async def test_network_error_raises_unreachable():
    respx.get(
        "https://x.signalwire.com/api/relay/rest/projects/p"
    ).mock(side_effect=httpx.ConnectError("dns fail"))
    with pytest.raises(SignalWireUnreachable):
        await validate_credentials(
            signalwire_project_id="p", api_token="t", space_url="x.signalwire.com"
        )


@pytest.mark.asyncio
async def test_rejects_invalid_space_url():
    with pytest.raises(ValueError):
        await validate_credentials(
            signalwire_project_id="p", api_token="t", space_url="not-a-host"
        )
