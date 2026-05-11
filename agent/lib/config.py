"""Centralized configuration loader. Fail-fast on missing/malformed values."""
from __future__ import annotations

import base64
import os
import sys
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import urlparse


class ConfigError(RuntimeError):
    """Raised on missing or malformed configuration."""


@dataclass(frozen=True)
class Config:
    encryption_key_bytes: bytes
    agent_api_key: str
    sendgrid_api_key: str
    public_base_url_agent: str
    public_base_url_web: str
    data_dir: Path
    log_level: str
    allow_http: bool

    @property
    def db_path(self) -> Path:
        return self.data_dir / "hirewire.db"

    @classmethod
    def load(cls) -> "Config":
        allow_http = os.environ.get("ALLOW_HTTP_URLS") == "1"
        return cls(
            encryption_key_bytes=_require_b64_bytes("ENCRYPTION_KEY", exact_len=32),
            agent_api_key=_require_str("AGENT_API_KEY", min_len=32),
            sendgrid_api_key=_require_str("SENDGRID_API_KEY", min_len=3),
            public_base_url_agent=_require_url("PUBLIC_BASE_URL_AGENT", allow_http=allow_http),
            public_base_url_web=_require_url("PUBLIC_BASE_URL_WEB", allow_http=allow_http),
            data_dir=_require_dir("DATA_DIR"),
            log_level=os.environ.get("LOG_LEVEL", "INFO"),
            allow_http=allow_http,
        )


def _require_str(name: str, *, min_len: int) -> str:
    value = os.environ.get(name)
    if not value:
        raise ConfigError(f"{name} is required and not set")
    if len(value) < min_len:
        raise ConfigError(f"{name} length {len(value)} below minimum {min_len}")
    return value


def _require_b64_bytes(name: str, *, exact_len: int) -> bytes:
    raw = _require_str(name, min_len=4)
    try:
        decoded = base64.b64decode(raw, validate=True)
    except Exception as exc:
        raise ConfigError(f"{name} must be base64-encoded bytes") from exc
    if len(decoded) != exact_len:
        raise ConfigError(f"{name} must decode to exactly {exact_len} bytes; got {len(decoded)}")
    return decoded


def _require_url(name: str, *, allow_http: bool) -> str:
    value = _require_str(name, min_len=8)
    parsed = urlparse(value)
    if parsed.scheme != "https" and not allow_http:
        raise ConfigError(f"{name} must be https:// (got {parsed.scheme})")
    if not parsed.netloc:
        raise ConfigError(f"{name} must include a host")
    return value.rstrip("/")


def _require_dir(name: str) -> Path:
    value = _require_str(name, min_len=1)
    path = Path(value)
    path.mkdir(parents=True, exist_ok=True, mode=0o700)
    return path


def load_or_exit() -> Config:
    """Used at process startup. Logs and exits 78 (EX_CONFIG) on failure."""
    try:
        return Config.load()
    except ConfigError as exc:
        # stderr (not structlog) — logging isn't configured until after Config.load() succeeds.
        print(f"FATAL: configuration error: {exc}", file=sys.stderr)
        sys.exit(78)
