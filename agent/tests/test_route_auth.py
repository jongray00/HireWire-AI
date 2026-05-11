import pytest
import respx
import httpx
from fastapi import FastAPI
from fastapi.testclient import TestClient

from agent.routes.auth import router


def _build_app(monkeypatch):
    monkeypatch.setenv("AGENT_API_KEY", "k-secret-32-byte-shared-secret-xxx")
    app = FastAPI()
    app.include_router(router)
    return app


@respx.mock
def test_valid_credentials_returns_displayname(monkeypatch):
    respx.get(
        "https://acme.signalwire.com/api/relay/rest/projects/sw-proj-1"
    ).mock(return_value=httpx.Response(200, json={"name": "Acme"}))
    app = _build_app(monkeypatch)
    client = TestClient(app)
    resp = client.post(
        "/api/auth/validate-credentials",
        headers={"X-Agent-API-Key": "k-secret-32-byte-shared-secret-xxx"},
        json={
            "signalwire_project_id": "sw-proj-1",
            "api_token": "real-token",
            "space_url": "acme.signalwire.com",
        },
    )
    assert resp.status_code == 200
    assert resp.json() == {"valid": True, "displayName": "Acme"}


@respx.mock
def test_invalid_credentials_returns_401(monkeypatch):
    respx.get(
        "https://acme.signalwire.com/api/relay/rest/projects/sw-proj-1"
    ).mock(return_value=httpx.Response(401))
    app = _build_app(monkeypatch)
    client = TestClient(app)
    resp = client.post(
        "/api/auth/validate-credentials",
        headers={"X-Agent-API-Key": "k-secret-32-byte-shared-secret-xxx"},
        json={
            "signalwire_project_id": "sw-proj-1",
            "api_token": "bad",
            "space_url": "acme.signalwire.com",
        },
    )
    assert resp.status_code == 401


def test_missing_api_key_returns_401(monkeypatch):
    app = _build_app(monkeypatch)
    client = TestClient(app)
    resp = client.post(
        "/api/auth/validate-credentials",
        json={
            "signalwire_project_id": "p",
            "api_token": "t",
            "space_url": "x.signalwire.com",
        },
    )
    assert resp.status_code == 401
