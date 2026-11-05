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

# venv 就绪判定：缺 .ready 标记，或 requirements.txt 比标记新（依赖变更）→ 重建
if [ ! -f ".venv/.ready" ] || [ "requirements.txt" -nt ".venv/.ready" ]; then
    echo "Setting up OCR virtual environment (missing or requirements.txt changed)..."
    python3 -m venv --clear .venv
    .venv/bin/pip install --upgrade pip
    .venv/bin/pip install -r requirements.txt
    touch .venv/.ready
fi

# Add .venv/bin to PATH for hybrid servers
export PATH="$(pwd)/.venv/bin:$PATH"

# 端口参数化：OCR_PORT/OCR_HOST（与 procurement 实例并存时起独立端口，如 OCR_PORT=8110）
OCR_PORT="${OCR_PORT:-8100}"
OCR_HOST="${OCR_HOST:-127.0.0.1}"

exec .venv/bin/uvicorn main:app --host "$OCR_HOST" --port "$OCR_PORT" --workers 1 --timeout-keep-alive 300
