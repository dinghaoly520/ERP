#!/usr/bin/env bash
# 一键恢复演示快照（引大济岷钻孔竞价项目 → 组长末签前停止点）
# 2026-09-14 起指向 demo-0914（同停止点 + 3 家回执全部已签）；旧 demo.json 保留在目录内备用
# 用法：./restore-demo.sh
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR/.."   # → scripts/
exec node demo-snapshot.js restore snapshots/JJ-2026091003-demo-0914.json
