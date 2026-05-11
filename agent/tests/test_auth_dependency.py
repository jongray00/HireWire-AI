import os
import pytest
from fastapi import FastAPI, Depends
from fastapi.testclient import TestClient

from agent.lib.auth import require_internal_auth, ProjectScope


def _build_app():
    app = FastAPI()

    @app.get("/internal/ping")
    def ping(scope: ProjectScope = Depends(require_internal_auth)):
        return {"project_id": scope.project_id}

    return app


def test_missing_api_key_returns_401(monkeypatch):
    monkeypatch.setenv("AGENT_API_KEY", "k-correct-32-byte-shared-secret")
    client = TestClient(_build_app())
    resp = client.get("/internal/ping", headers={"X-Project-Id": "uuid-a"})
    assert resp.status_code == 401


def test_wrong_api_key_returns_401(monkeypatch):
    monkeypatch.setenv("AGENT_API_KEY", "k-correct-32-byte-shared-secret")
    client = TestClient(_build_app())
    resp = client.get(
        "/internal/ping",
        headers={"X-Agent-API-Key": "wrong", "X-Project-Id": "uuid-a"},
    )
    assert resp.status_code == 401


def test_missing_project_id_returns_400(monkeypatch):
    monkeypatch.setenv("AGENT_API_KEY", "k-correct-32-byte-shared-secret")
    client = TestClient(_build_app())
    resp = client.get(
        "/internal/ping",
        headers={"X-Agent-API-Key": "k-correct-32-byte-shared-secret"},
    )
    assert resp.status_code == 400


def test_valid_request_returns_200(monkeypatch):
    monkeypatch.setenv("AGENT_API_KEY", "k-correct-32-byte-shared-secret")
    client = TestClient(_build_app())
    resp = client.get(
        "/internal/ping",
        headers={
            "X-Agent-API-Key": "k-correct-32-byte-shared-secret",
            "X-Project-Id": "uuid-a",
        },
    )
    assert resp.status_code == 200
    assert resp.json() == {"project_id": "uuid-a"}
