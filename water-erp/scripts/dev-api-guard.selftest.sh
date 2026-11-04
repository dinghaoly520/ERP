#!/usr/bin/env bash
# dev-api-guard.selftest.sh —— guard 契约自测（TDD 伴生，2026-11-04 叠树事故后补）
#
# 断言三件事（对应 scripts/dev-api-guard.sh 的两条修复 + 锁释放回归）：
#   B. 单实例锁：已有实例持锁时，第二个实例必须 3s 内自行退出（flock）；
#   A. TERM 可杀：kill -TERM 后 2s 内退出——trap 处理函数缺 exit + 裸 sleep 不可打断
#      都会让它超时（2026-11-04 实录：TERM 触发 cleanup 后继续循环，只能 -9）；
#   C. 锁随死释放：持锁实例退出后，新实例能立刻拿到锁继续跑。
#
# 隔离：GUARD_* 环境变量覆盖路径/探活 URL，不触碰生产 lock/log/pidfile；
#       探活目标用一次性 python http.server，全程零接触生产 :4001。
# 用法：bash scripts/dev-api-guard.selftest.sh（退出码 0=全绿）
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
GUARD="$ROOT/scripts/dev-api-guard.sh"
T="$(mktemp -d /tmp/guard-selftest.XXXXXX)"

PORT=$(python3 -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1",0)); print(s.getsockname()[1]); s.close()')
python3 -m http.server "$PORT" --bind 127.0.0.1 --directory "$T" >/dev/null 2>&1 &
HTTP_PID=$!
PIDS=()
cleanup() {
  for p in "${PIDS[@]:-}"; do kill -9 "$p" 2>/dev/null; done
  kill -9 "$HTTP_PID" 2>/dev/null
  rm -rf "$T"
}
trap cleanup EXIT INT TERM

export GUARD_LOG="$T/guard.log" GUARD_PIDFILE="$T/child.pid" \
       GUARD_LOCK="$T/guard.lock" GUARD_API_URL="http://127.0.0.1:$PORT/"

# 注意：调用方须在父作用域登记返回的 PID（start_guard 在 $( ) 子 shell 里跑，
# 函数内 PIDS+=() 改不到父数组——首版实测 RED 跑漏杀 3 个实例成流弹）
start_guard() { bash "$GUARD" >/dev/null 2>&1 & echo $!; }
alive() { kill -0 "$1" 2>/dev/null; }
wait_dead() { # $1=pid $2=最多等多少个 0.1s → 存活返回 1（仍活），死亡返回 0
  local i; for i in $(seq 1 "$2"); do alive "$1" || return 0; sleep 0.1; done
  alive "$1" && return 1 || return 0
}
wait_log() { # $1=模式 $2=最多轮数(×0.1s)
  local i; for i in $(seq 1 "$2"); do /usr/bin/grep -q "$1" "$GUARD_LOG" 2>/dev/null && return 0; sleep 0.1; done
  return 1
}

FAIL=0

# ── 持锁实例 H ──
H=$(start_guard); PIDS+=("$H")
wait_log '启动' 30 || echo "  （未见启动日志——旧代码未接 GUARD_LOG 覆盖属预期，按存活判定继续）"
alive "$H" || { echo "✗ 前置：guard 启动后未存活"; exit 1; }

# B. 单实例锁
B=$(start_guard); PIDS+=("$B")
if wait_dead "$B" 30; then
  echo "✓ B 单实例锁：第二实例 3s 内退出"
  /usr/bin/grep -q '已有实例' "$GUARD_LOG" && echo "  （日志已记「已有实例…退出」）" \
    || echo "  ⚠ 退出但日志未见「已有实例」——请补记名日志"
else
  echo "✗ B 单实例锁：第二实例 3s 后仍存活（无 flock 锁）"; FAIL=1
fi
alive "$H" || { echo "✗ B 前置失效：持锁实例 H 反而死了"; FAIL=1; }

# A. TERM 可杀（≤2s：sleep 须可打断，否则裸 sleep 10 最长拖 10s）
kill -TERM "$H"
if wait_dead "$H" 20; then
  echo "✓ A TERM 可杀：2s 内退出（trap exit + 可打断 sleep）"
else
  echo "✗ A TERM 可杀：TERM 2s 后仍存活（trap 缺 exit 或 sleep 不可打断）"; FAIL=1
fi

# C. 锁随死释放
C=$(start_guard); PIDS+=("$C")
sleep 2
if alive "$C"; then
  echo "✓ C 锁释放：持锁实例死后新实例能持锁运行"
else
  echo "✗ C 锁释放：新实例未能启动（锁未释放/误判已有实例）"; FAIL=1
fi
kill -TERM "$C"; wait_dead "$C" 20 \
  && echo "✓ C 补充：新实例同样 TERM 可杀" \
  || { echo "✗ C 补充：新实例 TERM 杀不死"; FAIL=1; }

if [ "$FAIL" = 0 ]; then echo "== 自测全绿 =="; else echo "== 自测有红 =="; fi
exit "$FAIL"
