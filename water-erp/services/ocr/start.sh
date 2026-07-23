#!/bin/bash
set -e
cd "$(dirname "$0")"

# Auto-create .env from template if missing
if [ ! -f ".env" ]; then
    if [ -f ".env.example" ]; then
        echo "Creating .env from .env.example..."
        cp .env.example .env
    else
        echo "Warning: No .env or .env.example found, using defaults."
    fi
fi

if [ ! -f ".venv/.ready" ]; then
    echo "Setting up OCR virtual environment..."
    python3 -m venv --clear .venv
    .venv/bin/pip install --upgrade pip
    .venv/bin/pip install -r requirements.txt
    touch .venv/.ready
fi

# Add .venv/bin to PATH for hybrid servers
export PATH="$(pwd)/.venv/bin:$PATH"

# 多副本部署：每副本用不同的 OCR_PORT，且 OCR_HYBRID_PORT 段不可重叠（见 README.md）
# API 侧 OCR_SERVICE_URL 支持逗号列表轮询多副本
exec .venv/bin/uvicorn main:app --host "${OCR_HOST:-127.0.0.1}" --port "${OCR_PORT:-8100}" --workers 1 --timeout-keep-alive 300
