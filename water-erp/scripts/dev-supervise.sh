#!/usr/bin/env bash
# dev 链服务守护器（2026-11-16）：替代 PM2 autorestart 语义（OCR watchdog 自杀→拉起；
# ecosystem.config.js 已退役）。用法: dev-supervise.sh <label> <port> <restart_delay_s> <cmd...>
# 端口已监听→让位 exit 0；每轮重启前复查端口，被抢跑者占住（模型加载窗 TOCTOU）也让位，
# 防「全量加载→bind 失败」无限循环；TERM/INT→限时优雅等待子进程（KILL_WAIT 秒，默认 10，
# 承接 PM2 kill_timeout 语义）超时 -9 升级收尸，整链退出不复活（配合 dev-kill 先杀守护器
# 再清端口的顺序）。注记：无 PM2 max_restarts 上限——永久性失败按 delay 持续重启，影响有界。
set -u
LABEL="${1:?用法: dev-supervise.sh <label> <port> <restart_delay_s> <cmd...>}"
PORT="${2:?}"
DELAY="${3:?}"
KILL_WAIT="${KILL_WAIT:-10}"
shift 3

port_busy() { ss -tln 2>/dev/null | grep -q ":${PORT} "; }
yield() { echo "[${LABEL}] :${PORT} 已有监听（残留实例/抢跑者？），让位退出；如需重启先 pnpm dev:kill"; exit 0; }

port_busy && yield

CHILD=0
on_term() {
  if [ "$CHILD" -gt 0 ]; then
    kill "$CHILD" 2>/dev/null
    # 限时优雅等待 + 超时 -9（kill -0 对僵尸恒真，以 wait 收尸判定为准）
    ( sleep "$KILL_WAIT" && kill -9 "$CHILD" 2>/dev/null ) >/dev/null 2>&1 &
    WATCHER=$!
    wait "$CHILD" 2>/dev/null
    kill "$WATCHER" 2>/dev/null
  fi
  # 兜底（2026-11-16 评审 Minor#3）：fork 与 CHILD=$! 间的竞窗可能漏杀刚 fork 的子进程——
  # TERM 掉本 shell 全部直接子进程（watcher 此时已处理；漏网子进程无视 TERM 的极端场景由 dev:kill fuser 收口）
  pkill -TERM -P $$ 2>/dev/null
  exit 0
}
trap on_term TERM INT

echo "[${LABEL}] 启动: $*（守护: 崩溃 ${DELAY}s 后重启）"
while true; do
  "$@" &
  CHILD=$!
  wait "$CHILD"
  CODE=$?
  CHILD=0
  port_busy && yield
  echo "[${LABEL}] 子进程退出码 ${CODE}，${DELAY}s 后重启"
  sleep "$DELAY"
done
