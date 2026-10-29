#!/usr/bin/env bash
# dev-api-guard —— :4001 API 探活守护（2026-10-29 用户裁定「不允许出现后端服务未启动」）
#
# 语义：
#   - 每 10s 探活 http://127.0.0.1:4001/api/docs；
#   - 连续 3 次失败（≥~20s 不可达，超出 nest watch 正常重编译窗口）才干预——
#     不与 dev:api watcher 的合法重启窗口打架；
#   - 干预：端口被僵尸占用（监听但不响应）时按精确 PID 清理（macOS 无 /proc、
#     禁模式 pkill——见 memory kill-by-exact-pid-only），随后后台拉起 dev:api；
#   - main.ts 有 listen 预检（端口被占即 exit 1），与链内 watcher 竞争不会叠树；
#   - 守护退出时仅清理**自己拉起**的进程树（pidfile 记录），不碰他人实例
#     （链内 api 成员由 concurrently 正常终止；残树遗留与 dev:kill 语义不变）。
# 日志：/tmp/water-erp-dev-api-guard.log（dev 守护日志，不入库）
set -u

API_URL="http://127.0.0.1:4001/api/docs"
PROBE_INTERVAL=10
FAIL_THRESHOLD=3
SETTLE_AFTER_START=30
LOG=/tmp/water-erp-dev-api-guard.log
PIDFILE=/tmp/water-erp-dev-api-guard.child
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

log() { echo "[$(date '+%F %T')] $*" >> "$LOG"; }

kill_tree() { # 递归精确 PID 树清理
  local pid="$1" children
  children="$(pgrep -P "$pid" 2>/dev/null || true)"
  kill "$pid" 2>/dev/null || true
  local c
  for c in $children; do kill_tree "$c"; done
}

cleanup() {
  if [ -f "$PIDFILE" ]; then
    local pid
    pid="$(cat "$PIDFILE" 2>/dev/null || true)"
    if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
      log "guard 退出，清理自己拉起的进程树（PID $pid）"
      kill_tree "$pid"
    fi
    rm -f "$PIDFILE"
  fi
}
trap cleanup EXIT INT TERM

start_api() {
  local pid
  pid="$(lsof -ti tcp:4001 -sTCP:LISTEN 2>/dev/null || true)"
  if [ -n "$pid" ]; then
    log "端口 4001 被 PID $pid 占用且探活持续失败，精确清理后重启"
    kill "$pid" 2>/dev/null || true
    sleep 1
  fi
  log "后台拉起 dev:api"
  (
    cd "$ROOT" || exit 1
    nohup pnpm dev:api >> "$LOG" 2>&1 &
    echo $! > "$PIDFILE"
  )
}

log "guard 启动（探活 $API_URL 每 ${PROBE_INTERVAL}s，连续 ${FAIL_THRESHOLD} 次失败才干预）"
fails=0
while true; do
  if curl -sf --max-time 3 "$API_URL" > /dev/null 2>&1; then
    fails=0
  else
    fails=$((fails + 1))
    log "探活失败（连续 $fails/$FAIL_THRESHOLD）"
    if [ "$fails" -ge "$FAIL_THRESHOLD" ]; then
      start_api
      fails=0
      sleep "$SETTLE_AFTER_START" # 给 watcher 编译时间，期间不重复干预
    fi
  fi
  sleep "$PROBE_INTERVAL"
done
