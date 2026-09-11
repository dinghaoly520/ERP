#!/usr/bin/env bash
# 一键恢复演示快照（引大济岷钻孔竞价项目 → 组长末签前停止点）
# 用法：./restore-demo.sh
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR/.."   # → scripts/
exec node demo-snapshot.js restore snapshots/JJ-2026091003-demo.json
