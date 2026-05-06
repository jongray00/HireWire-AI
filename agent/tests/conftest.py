"""Pytest configuration: make `agent` importable from any test."""
import sys
from pathlib import Path

# agent/tests/conftest.py — add the repo root (parent of `agent/`) to sys.path.
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
