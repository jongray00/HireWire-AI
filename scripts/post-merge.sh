#!/bin/bash
set -e

if [ -f pyproject.toml ]; then
  uv sync
fi

if [ -d web ]; then
  (cd web && npm install --legacy-peer-deps --no-audit --no-fund)
fi
