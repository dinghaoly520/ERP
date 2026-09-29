#!/usr/bin/env bash
# 一键恢复演示快照（引大济岷钻孔竞价项目 → 组长末签前停止点）
# 2026-09-14 起指向 demo-0914（同停止点 + 3 家回执全部已签）；旧 demo.json 保留在目录内备用
# 用法：./restore-demo.sh
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR/.."   # → scripts/
node demo-snapshot.js restore snapshots/JJ-2026091003-demo-0914.json
# 加密对象可解密性校验（2026-09-29 事故防线）：快照回灌的 decryptKey 若与 MinIO
# 现对象失配（对象在快照拍摄后被重建过），在此拦下，勿带病演示。
node verify-encrypted-assets.js
