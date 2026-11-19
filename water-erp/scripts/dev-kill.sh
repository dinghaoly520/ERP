#!/usr/bin/env bash
# dev 链清理。本脚本 = fuser 清端口 + 按 /proc 的 cwd+cmdline 清 apps/api 残树 + 清 dev-api-guard。
# 注意：nest CLI 的 node 进程 cmdline 为 ".../@nestjs/cli/bin/nest.js start --watch"，
# "nest start" 子串匹配不到它（中间隔 .js）——须单列 "@nestjs/cli/bin/nest.js" 模式（2026-10-16 实测漏杀实录）。
# 归属判定只认 cwd=apps/api（lsof 对 pnpm 硬链接有假命中，勿用）；pnpm/concurrently
# 祖先进程 cwd 在仓库根，天然不中弹。procurement / ukey / MCP watchdog 的 cwd
# 均不在 apps/api，无需显式排除。
# guard 清理（2026-11-04）：dev-api-guard 是 :4001 的拉起者，不先杀它端口清完 30s 内
# 被陈旧 guard 拉回、叠出多层 nest watch。必须先杀拉起者再清端口；TERM 对旧版无效
# （trap 缺 exit），0.5s 后 -9 兜底。
# 守护器清理（2026-11-16）：dev-supervise.sh（ocr :8110 / embedding :8003）是两服务的
# 崩溃重启者——不先杀它，端口清完 5~10s 后孤儿复活抢新链端口。
#
# 模式分级（2026-11-19 用户裁定「embedding/ocr 常驻，dev 重启不连带」）：
#   pnpm dev:kill              # 默认=链清理：guard + 10 链端口（8 门户+3003+4001）+ apps/api 残树
#                              #   ——**不动 OCR/embedding 常驻服务**（守护器与 :8003/:8110 均不碰）
#   pnpm dev:kill --api        # 只清 guard + :4001 + apps/api 残树（不动 9 个 portal、不动常驻服务）
#   pnpm dev:kill --services   # 只清常驻服务（两个 dev-supervise 守护器 + :8003/:8110），链不动
#   pnpm dev:kill --all        # 全量 = 链 + 常驻服务（服务僵死/彻底重置用；等价旧版默认）
#   pnpm dev:kill --list       # 干跑：只列出将杀对象，不动手
# 常驻服务的拉起见 scripts/services-up.sh（pnpm services:up / dev 链 dev:ocr/dev:embedding 自动确保）。
# web3005-watch.sh（/tmp 守尸网）不在本列——它是 :3005 的留置缓解，按 memory 另行维护。
set -u
cd "$(dirname "$0")/.."
ROOT="$(pwd)"

MODE=chain
DRY=0
for arg in "$@"; do
  case "$arg" in
    --api) MODE=api ;;
    --services) MODE=services ;;
    --all) MODE=all ;;
    --list) DRY=1 ;;
  esac
done

kill_guard() {      # guard 在除 --services 外所有模式下清理
  case "$MODE" in services) return 1 ;; *) return 0 ;; esac
}
kill_supervisor() { # 守护器仅 --services/--all 清理（默认模式下常驻服务必须存活）
  case "$MODE" in services|all) return 0 ;; *) return 1 ;; esac
}

echo "[dev-kill] 模式: ${MODE}$( [ "$DRY" = 1 ] && echo '（干跑）' )"
echo "[dev-kill] 1/3 清拉起者/守护器（dev-api-guard 是 :4001 拉起者、dev-supervise.sh 是 OCR/embedding 守护器——不先杀它们，端口清了会被拉回叠树/孤儿复活抢口）"
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
    *dev-api-guard.sh*|*dev:api-guard*) KIND=guard ;;
    # 守护器 pattern 收紧为 shell 执行形态（2026-11-16）：裸 *dev-supervise.sh* 会附带杀伤
    # vim/grep/timeout 等仅引用文件名的进程（含 selftest 的 timeout/KILL_WAIT= 前缀调用）。
    # env 赋值前缀等异形态直调不中弹——其 uvicorn/vllm 子进程持端口，第 2/3 步兜底。
    bash\ *dev-supervise.sh*|sh\ *dev-supervise.sh*|*bin/bash\ *dev-supervise.sh*|*bin/sh\ *dev-supervise.sh*) KIND=supervisor ;;
    *) continue ;;
  esac
  if [ "$KIND" = supervisor ]; then
    kill_supervisor || continue
  else
    kill_guard || continue
  fi
  cwd=$(readlink "/proc/$pid/cwd" 2>/dev/null) || cwd=""
  case "$cwd" in
    "$ROOT"|"$ROOT"/*) gpids+=("$pid"); gdescs+=("${cmd:0:70}") ;;
    *)
      # cwd 不在本仓库的实例（绝对路径拉起），只在其 cmdline 指向本仓库时收杀
      case "$cmd" in
        *"$ROOT"*) gpids+=("$pid"); gdescs+=("${cmd:0:70}") ;;
      esac ;;
  esac
done
if [ ${#gpids[@]} -eq 0 ]; then
  echo "[dev-kill]   无 guard/守护器实例"
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
  case "$MODE" in
    api)      fuser -k 4001/tcp 2>/dev/null ;;
    services) fuser -k 8003/tcp 8110/tcp 2>/dev/null ;;
    all)      fuser -k 3002/tcp 3003/tcp 3004/tcp 3005/tcp 3006/tcp 3007/tcp 3008/tcp 3010/tcp 3011/tcp 4001/tcp 8003/tcp 8110/tcp 2>/dev/null ;;
    *)        fuser -k 3002/tcp 3003/tcp 3004/tcp 3005/tcp 3006/tcp 3007/tcp 3008/tcp 3010/tcp 3011/tcp 4001/tcp 2>/dev/null ;;
  esac
  sleep 0.5
else
  echo "[dev-kill]   （干跑，跳过）"
fi

echo "[dev-kill] 3/3 清 apps/api 残树（watch 链 / 孤儿 dist / ai-worker）"
if [ "$MODE" = services ]; then
  echo "[dev-kill]   services 模式不动 api 残树，跳过"
else
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
fi

if [ "$DRY" = 0 ]; then
  sleep 0.5
  case "$MODE" in
    services) CHECK_PORTS="8003 8110" ;;
    *)        CHECK_PORTS="4001" ;;
  esac
  busy=0
  for p in $CHECK_PORTS; do
    if ss -tln 2>/dev/null | grep -q ":${p} "; then
      echo "[dev-kill] ⚠ :${p} 仍被占用："
      ss -tlnp 2>/dev/null | grep ":${p} "
      busy=1
    fi
  done
  if [ "$busy" = 1 ]; then
    echo "[dev-kill]   按上述 PID 手工处理（kill -9 兜底）"
    exit 1
  fi
  echo "[dev-kill] ✓ 端口检查通过（${CHECK_PORTS}），可 pnpm dev"
fi
