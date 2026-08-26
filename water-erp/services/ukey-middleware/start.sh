#!/usr/bin/env bash
# 首跑自装依赖(镜像 services/ocr 模式),再启动中间件(协议见 spec §5)
set -euo pipefail
cd "$(dirname "$0")"
[ -d node_modules ] || npm install --no-fund --no-audit
exec node src/cli.mjs serve "$@"
