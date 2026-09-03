#!/usr/bin/env bash
# ═══ CA盾(USB)一键启动 · Linux 免环境版 ═══
# B 机无需 Node/仓库:本脚本用U盘自带 node 启动 mock U盾中间件(:17999)
# 用法:插盘后运行本脚本(文件管理器双击选「运行」,或终端 bash 本文件);Ctrl-C 停止
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export UKEY_SLOT_DIR="${DIR}/slots"
# CORS 白名单:本机门户 + 演示服务器门户;其他来源经 UKEY_MW_ALLOW_ORIGIN 追加(逗号分隔)
ERP_HOST="${UKEY_ERP_HOST:-192.168.1.111}"
export UKEY_MW_ALLOW_ORIGIN="${UKEY_MW_ALLOW_ORIGIN:-http://localhost:3004,http://127.0.0.1:3004,http://${ERP_HOST}:3004}"

NODE="${DIR}/runtime/linux/node"
if ! "$NODE" --version >/dev/null 2>&1; then
  TMPN="$(mktemp -d /tmp/ukey-node-XXXX)"   # 挂载点 noexec 兜底:复制到 /tmp 执行
  cp "$NODE" "$TMPN/node" && chmod +x "$TMPN/node" && NODE="$TMPN/node"
fi

if curl -s -m 2 http://127.0.0.1:17999/health >/dev/null 2>&1; then
  echo "✔ 中间件已在运行:"; curl -s http://127.0.0.1:17999/health; echo; exit 0
fi
echo "── mock U盾中间件 :17999 启动中(盾槽=${UKEY_SLOT_DIR})——Ctrl-C 停止 ──"
exec "$NODE" "${DIR}/middleware/src/cli.mjs" serve
