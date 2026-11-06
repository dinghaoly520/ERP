#!/usr/bin/env bash
# dev 全链清理（2026-10-16 升级）：旧版只 fuser 杀端口持有者，nest watch 树残骸
# （sh -c nest start --watch → nest.js start --watch → sh -c node dist/main）与 ai-worker
# 树会留下；下次 pnpm dev 再拉一棵 → 两棵 watch 同写 dist/ 抢 :4001 → 撞车半死（叠树）。
#
# 本脚本 = fuser 清端口 + 按 /proc 的 cwd+cmdline 清 apps/api 残树 + 清 dev-api-guard。
# 注意：nest CLI 的 node 进程 cmdline 为 ".../@nestjs/cli/bin/nest.js start --watch"，
# "nest start" 子串匹配不到它（中间隔 .js）——须单列 "@nestjs/cli/bin/nest.js" 模式（2026-10-16 实测漏杀实录）。
# 归属判定只认 cwd=apps/api（lsof 对 pnpm 硬链接有假命中，勿用）；pnpm/concurrently
# 祖先进程 cwd 在仓库根，天然不中弹。procurement / ukey / OCR / MCP watchdog 的 cwd
# 均不在 apps/api，无需显式排除。
# guard 清理（2026-11-04）：dev-api-guard 是 :4001 的拉起者，旧版不在此列——
# 端口清完 30s 内被陈旧 guard 拉回、叠出多层 nest watch（当日 4 陈旧 guard 实录）。
# 必须先杀拉起者再清端口；TERM 对旧版无效（trap 缺 exit），0.5s 后 -9 兜底。
# web3005-watch.sh（/tmp 守尸网）不在本列——它是 :3005 的留置缓解，按 memory 另行维护。
#
# 用法：
#   pnpm dev:kill              # 全量：guard + 10 个端口 + apps/api 残树
#   pnpm dev:kill --api        # 只清 guard + :4001 + apps/api 残树（不动 9 个 portal）
#   pnpm dev:kill --list       # 干跑：只列出将杀对象，不动手
set -u
cd "$(dirname "$0")/.."
ROOT="$(pwd)"

MODE=all
DRY=0
for arg in "$@"; do
  case "$arg" in
    --api) MODE=api ;;
    --list) DRY=1 ;;
  esac
done

echo "[dev-kill] 1/3 清 dev-api-guard 拉起者（不先杀它，端口清了也会被拉回叠树）"
gpids=()
gdescs=()
for pid in $(ls /proc 2>/dev/null | grep -E '^[0-9]+$'); do
  [ "$pid" = "$$" ] && continue
  cmd=$(tr '\0' ' ' 2>/dev/null < "/proc/$pid/cmdline") || continue # 重定向顺序：2>/dev/null 在前，扫描竞态（进程刚死）不喷错
  case "$cmd" in
    *shell-snapshots*|*selftest*) continue ;;
    *dev:kill*) continue ;; # 链根 sh -c 'pnpm dev:kill && concurrently …'——pnpm dev 启动期杀它会断链（&& 后半不执行）；手动停链时它等 concurrently 死后自然退出
  esac
  case "$cmd" in
    *dev-api-guard.sh*|*dev:api-guard*)
      cwd=$(readlink "/proc/$pid/cwd" 2>/dev/null) || cwd=""
      case "$cwd" in
        "$ROOT"|"$ROOT"/*) gpids+=("$pid"); gdescs+=("${cmd:0:70}") ;;
        *)
          # cwd 不在本仓库的实例（绝对路径拉起），只在其 cmdline 指向本仓库时收杀
          case "$cmd" in
            *"$ROOT"*) gpids+=("$pid"); gdescs+=("${cmd:0:70}") ;;
          esac ;;
      esac
      ;;
  esac
done
if [ ${#gpids[@]} -eq 0 ]; then
  echo "[dev-kill]   无 guard 实例"
else
  for i in "${!gpids[@]}"; do
    if [ "$DRY" = 1 ]; then
      echo "[dev-kill]   (干跑) 将杀 PID ${gpids[$i]}  ${gdescs[$i]}"
    else
      kill "${gpids[$i]}" 2>/dev/null
      echo "[dev-kill]   已 TERM PID ${gpids[$i]}  ${gdescs[$i]}"
    fi
  done
  if [ "$DRY" = 0 ]; then
    sleep 0.5
    for i in "${!gpids[@]}"; do
      kill -0 "${gpids[$i]}" 2>/dev/null || continue
      kill -9 "${gpids[$i]}" 2>/dev/null && echo "[dev-kill]   TERM 未死升级 -9：PID ${gpids[$i]}（旧版 trap 缺 exit 实例）"
    done
  fi
fi

echo "[dev-kill] 2/3 清端口持有者"
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

echo "[dev-kill] 3/3 清 apps/api 残树（watch 链 / 孤儿 dist / ai-worker）"
API_DIR="$(cd apps/api && pwd)"
pids=()
descs=()
for pid in $(ls /proc 2>/dev/null | grep -E '^[0-9]+$'); do
  [ "$pid" = "$$" ] && continue
  cwd=$(readlink "/proc/$pid/cwd" 2>/dev/null) || continue
  [ "$cwd" = "$API_DIR" ] || continue
  cmd=$(tr '\0' ' ' 2>/dev/null < "/proc/$pid/cmdline") || continue
  # Claude 会话工具 shell（snapshot 包装器）cwd 可能恰在 apps/api，且其 cmdline 嵌着任意
  # 命令文本（含 "nest start" 字样）会误中——按包装器特征排除，绝不能杀会话 shell
  case "$cmd" in
    *shell-snapshots*) continue ;;
  esac
  case "$cmd" in
    *"nest start"*|*"nest build"*|*"@nestjs/cli/bin/nest.js"*|*"dist/main"*|*"ai-bid-analysis-worker"*)
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
