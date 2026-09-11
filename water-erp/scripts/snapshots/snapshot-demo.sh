#!/usr/bin/env bash
# 捕获当前演示项目快照
# 用法：./snapshot-demo.sh [快照名]   （默认 demo；编号默认 JJ-2026091003，可经 $2 覆盖）
set -euo pipefail
SNAP_NAME="${1:-demo}"
PROJECT_CODE="${2:-JJ-2026091003}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR/.."   # → scripts/
exec node demo-snapshot.js snapshot "$PROJECT_CODE" "$SNAP_NAME"
