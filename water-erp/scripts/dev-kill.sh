#!/usr/bin/env bash
# dev 全链清理（2026-10-16 升级）：旧版只 fuser 杀端口持有者，nest watch 树残骸
# （sh -c nest start --watch → nest.js start --watch → sh -c node dist/main）与 ai-worker
# 树会留下；下次 pnpm dev 再拉一棵 → 两棵 watch 同写 dist/ 抢 :4001 → 撞车半死（叠树）。
#
# 本脚本 = fuser 清端口 + 按 /proc 的 cwd+cmdline 清 apps/api 残树。
# 归属判定只认 cwd=apps/api（lsof 对 pnpm 硬链接有假命中，勿用）；pnpm/concurrently
# 祖先进程 cwd 在仓库根，天然不中弹。procurement / ukey / OCR / MCP watchdog 的 cwd
# 均不在 apps/api，无需显式排除。
#
# 用法：
#   pnpm dev:kill              # 全量：11 个端口 + apps/api 残树
#   pnpm dev:kill --api        # 只清 :4001 + apps/api 残树（不动 9 个 portal）
#   pnpm dev:kill --list       # 干跑：只列出将杀对象，不动手
set -u
cd "$(dirname "$0")/.."

MODE=all
DRY=0
for arg in "$@"; do
  case "$arg" in
    --api) MODE=api ;;
    --list) DRY=1 ;;
  esac
done

echo "[dev-kill] 1/2 清端口持有者"
if [ "$DRY" = 0 ]; then
  if [ "$MODE" = "api" ]; then
    fuser -k 4001/tcp 2>/dev/null
  else
    fuser -k 3002/tcp 3003/tcp 3004/tcp 3005/tcp 3006/tcp 3007/tcp 3008/tcp 3010/tcp 3011/tcp 4001/tcp 2>/dev/null
  fi
  sleep 0.5
else
  echo "[dev-kill]   （干跑，跳过）"
fi

echo "[dev-kill] 2/2 清 apps/api 残树（watch 链 / 孤儿 dist / ai-worker）"
API_DIR="$(cd apps/api && pwd)"
pids=()
descs=()
for pid in $(ls /proc 2>/dev/null | grep -E '^[0-9]+$'); do
  [ "$pid" = "$$" ] && continue
  cwd=$(readlink "/proc/$pid/cwd" 2>/dev/null) || continue
  [ "$cwd" = "$API_DIR" ] || continue
  cmd=$(tr '\0' ' ' < "/proc/$pid/cmdline" 2>/dev/null) || continue
  # Claude 会话工具 shell（snapshot 包装器）cwd 可能恰在 apps/api，且其 cmdline 嵌着任意
  # 命令文本（含 "nest start" 字样）会误中——按包装器特征排除，绝不能杀会话 shell
  case "$cmd" in
    *shell-snapshots*) continue ;;
  esac
  case "$cmd" in
    *"nest start"*|*"nest build"*|*"dist/main"*|*"ai-bid-analysis-worker"*)
      pids+=("$pid")
      descs+=("${cmd:0:70}")
      ;;
  esac
done

if [ ${#pids[@]} -eq 0 ]; then
  echo "[dev-kill]   无残树"
else
  for i in "${!pids[@]}"; do
    if [ "$DRY" = 1 ]; then
      echo "[dev-kill]   (干跑) 将杀 PID ${pids[$i]}  ${descs[$i]}"
    else
      kill "${pids[$i]}" 2>/dev/null && echo "[dev-kill]   已杀 PID ${pids[$i]}  ${descs[$i]}"
    fi
  done
fi

if [ "$DRY" = 0 ]; then
  sleep 0.5
  if ss -tln 2>/dev/null | grep -q ':4001 '; then
    echo "[dev-kill] ⚠ :4001 仍被占用："
    ss -tlnp 2>/dev/null | grep ':4001 '
    echo "[dev-kill]   按上述 PID 手工处理（kill -9 兜底）"
    exit 1
  fi
  echo "[dev-kill] ✓ :4001 已释放，可 pnpm dev"
fi
