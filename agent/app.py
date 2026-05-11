"""HireWire agent backend entry point — new auth + webhook surfaces.

Existing `main.py` continues running unchanged in parallel. Once Phase 3
refactors the webhook handlers, app.py will subsume main.py.
"""
from __future__ import annotations

import os
import sys
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from agent.lib.config import Config
from agent.lib.db import open_connection
from agent.lib.migrate import run_migrations
from agent.routes import auth as auth_routes


@asynccontextmanager
async def lifespan(_app: FastAPI):
    cfg = Config.load()
    conn = open_connection(cfg.db_path)
    applied = run_migrations(conn)
    print(f"[startup] migrations applied: {applied}", flush=True)
    yield


def build_app() -> FastAPI:
    try:
        cfg = Config.load()
    except Exception as exc:
        print(f"FATAL: {exc}", file=sys.stderr)
        sys.exit(78)

    allowed_origin = cfg.public_base_url_web
    app = FastAPI(title="HireWire Agent Backend", lifespan=lifespan)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=[allowed_origin],
        allow_methods=["GET", "POST", "PATCH", "DELETE"],
        allow_headers=[
            "Authorization",
            "Content-Type",
            "X-Agent-API-Key",
            "X-Project-Id",
            "X-Request-Id",
        ],
        allow_credentials=False,
    )
    app.include_router(auth_routes.router)
    return app


app = build_app()
