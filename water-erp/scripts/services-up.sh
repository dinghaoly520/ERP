#!/usr/bin/env bash
# 常驻服务拉起（2026-11-19 用户裁定「embedding/ocr 常驻，dev 重启不连带」）：
#   用法: services-up.sh [ocr|embedding]   # 无参 = 两个都确保常驻
#
#   - 已有同 label 的 dev-supervise 守护器在跑 → 跳过（**进程锁而非端口锁**：
#     vLLM 模型加载窗口端口未监听，只查端口会双拉两只抢 GPU）
#   - 端口被监听但无守护器（裸实例）→ 也跳过并提示，不接管不叠树
#   - 否则 setsid 脱离会话拉起 dev-supervise 守护器：Ctrl+C / 关终端不连坐，
#     崩溃自动重启（ocr 5s / embedding 10s），日志 /tmp/water-erp-service-<label>.log
#   - 停止: pnpm services:down（= dev-kill --services）；彻底重置: pnpm dev:kill --all
#
# 服务命令行（vLLM 参数等）的**唯一权威在此**——package.json 的 dev:ocr/dev:embedding
# 与 dev 链成员都走本脚本，勿再散落副本（改参数只改这里）。
# 前台调试想盯着跑: 直接 `bash scripts/dev-supervise.sh <label> <port> <delay> <cmd...>`。
set -u
cd "$(dirname "$0")/.."

supervised() { # 同 label 守护器存活（含模型加载窗口）。逐 PID 复核 cmdline 非空且形态
               # 吻合——僵尸进程 cmdline 为空、暂态误命中被滤掉；误报跳过=服务永久停机，宁严勿松
  local pid cmd
  for pid in $(pgrep -f "dev-supervise\.sh ${1} [0-9]" 2>/dev/null); do
    cmd="$(tr '\0' ' ' < "/proc/$pid/cmdline" 2>/dev/null)"
    case "$cmd" in
      *dev-supervise.sh\ ${1}\ *) echo "[services] ${1} 守护器已在运行（PID $pid），跳过"; return 0 ;;
    esac
  done
  return 1
}
port_busy() { ss -tln 2>/dev/null | grep -q ":${1} "; }

up() {
  local label="$1" port="$2" delay="$3"; shift 3
  if supervised "$label"; then
    return 0
  fi
  if port_busy "$port"; then
    echo "[services] :${port} 已有监听（无守护器的裸实例？），跳过拉起；如需接管先 pnpm services:down"
    return 0
  fi
  local log="/tmp/water-erp-service-${label}.log"
  # setsid 是 Linux 独有（脱离控制组防 TERM 连坐）——macOS 无此命令，2026-11-25 实录
  # 「setsid: command not found」致守护器零拉起；回退裸 nohup 后台（少一层会话隔离，守护语义不变）
  if command -v setsid >/dev/null 2>&1; then
    setsid nohup bash scripts/dev-supervise.sh "$label" "$port" "$delay" "$@" >> "$log" 2>&1 < /dev/null &
  else
    nohup bash scripts/dev-supervise.sh "$label" "$port" "$delay" "$@" >> "$log" 2>&1 < /dev/null &
  fi
  echo "[services] ${label} 常驻守护已拉起（端口 :${port}，日志 ${log}）"
}

WANT="${1:-}"

if [ -z "$WANT" ] || [ "$WANT" = ocr ]; then
  up ocr 8110 5 bash services/ocr/start.sh
fi
if [ -z "$WANT" ] || [ "$WANT" = embedding ]; then
  up embedding 8003 10 /home/asus/vllm_venv/bin/vllm serve /home/asus/models/bge-m3 --host 0.0.0.0 --port 8003 --convert embed --max-model-len 8192 --gpu-memory-utilization 0.40 --enforce-eager
fi
