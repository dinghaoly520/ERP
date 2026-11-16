#!/usr/bin/env bash
# dev 链服务守护器（2026-11-16）：替代 PM2 autorestart 语义（OCR watchdog 自杀→拉起；
# ecosystem.config.js 已退役）。用法: dev-supervise.sh <label> <port> <restart_delay_s> <cmd...>
# 端口已监听→让位 exit 0（残留实例仍可用，勿双开）；TERM/INT→杀子退出不重启
# （配合 dev-kill 先杀守护器再清端口的顺序，防延迟后孤儿复活抢端口）。
set -u
LABEL="${1:?用法: dev-supervise.sh <label> <port> <restart_delay_s> <cmd...>}"
PORT="${2:?}"
DELAY="${3:?}"
shift 3

if ss -tln 2>/dev/null | grep -q ":${PORT} "; then
  echo "[${LABEL}] :${PORT} 已有监听（残留实例？），跳过启动；如需重启先 pnpm dev:kill"
  exit 0
fi

CHILD=0
on_term() { [ "$CHILD" -gt 0 ] && kill "$CHILD" 2>/dev/null; exit 0; }
trap on_term TERM INT

echo "[${LABEL}] 启动: $*（守护: 崩溃 ${DELAY}s 后重启）"
while true; do
  "$@" &
  CHILD=$!
  wait "$CHILD"
  CODE=$?
  echo "[${LABEL}] 子进程退出码 ${CODE}，${DELAY}s 后重启"
  sleep "$DELAY"
done
