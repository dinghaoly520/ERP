#!/usr/bin/env bash
# A-97 送测证据固化——「截止时间应使用国家授时中心标准时间」现场证据采集
# 配套文档：docs/ops-ntp.md「送测演示与证据固化」章节
#
# 用法:   scripts/ntp-evidence.sh [API_BASE]    # API_BASE 默认 http://localhost:4001
# 产物:   docs/认证送测材料/ntp-证据/ntp-evidence-<UTC时间戳>.txt（目录 gitignore，证据仅本地留存）
# 退出码: 0 = 证据有效（chrony 已同步、偏差<1s、含 NTSC 源；/api/time 偏差≤2s）
#         1 = chrony 未安装/未同步/无 NTSC 源——证据无效，先按 docs/ops-ntp.md 配置
#         2 = chrony 部分有效但 API 时间校验未通过（或 API 不可达）
set -uo pipefail

API_BASE="${1:-${API_BASE:-http://localhost:4001}}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_DIR="${REPO_ROOT}/docs/认证送测材料/ntp-证据"
OUT_FILE="$OUT_DIR/ntp-evidence-$(date -u +%Y%m%dT%H%M%SZ).txt"
mkdir -p "$OUT_DIR"

CHRONY_OK=0 API_OK=0
chrony_reason="" api_reason="" offset_ms="" api_offset_ms=""

TRACKING="$(LC_ALL=C chronyc tracking 2>&1)"; TRACK_RC=$?
SOURCES="$(LC_ALL=C chronyc sources -v 2>&1)"
SOURCESTATS="$(LC_ALL=C chronyc sourcestats 2>&1)"

if ! command -v chronyc >/dev/null 2>&1; then
  chrony_reason="chronyc 未安装——Ubuntu 默认 systemd-timesyncd 的同步源为发行版 NTP 池，不构成国家授时中心证据；请按 docs/ops-ntp.md 安装 chrony 并指向 ntp.ntsc.ac.cn"
elif [ "$TRACK_RC" -ne 0 ]; then
  chrony_reason="chronyc tracking 调用失败（chronyd 未运行?）"
else
  leap="$(printf '%s\n' "$TRACKING" | awk -F: '/^Leap status/{gsub(/ /,"",$2); print $2}')"
  offset_ms="$(printf '%s\n' "$TRACKING" | awk -F: '/^System time/{print $2}' | awk '{printf "%d", ($1<0?-$1:$1)*1000}')"
  ntsc_count="$(printf '%s\n' "$SOURCES" | grep -ci 'ntsc')"
  if [ "$leap" != "Normal" ]; then
    chrony_reason="Leap status = ${leap:-（空）}，未正常同步"
  elif [ -z "$offset_ms" ] || [ "$offset_ms" -gt 1000 ]; then
    chrony_reason="系统时间偏差 ${offset_ms:-未解析}ms（要求 <1000ms）"
  elif [ "${ntsc_count:-0}" -eq 0 ]; then
    chrony_reason="chrony sources 中无国家授时中心源（ntsc）——请检查 chrony.conf server 配置"
  else
    CHRONY_OK=1
    chrony_reason="OK（Leap=Normal，偏差 ${offset_ms}ms <1000ms，NTSC 源在线）"
  fi
fi

local_ms="$(date +%s%3N)"
resp="$(curl -fsS -m 5 "$API_BASE/api/time" 2>&1)"; CURL_RC=$?
if [ "$CURL_RC" -ne 0 ]; then
  api_reason="API 不可达（$API_BASE/api/time）：${resp}"
else
  server_ms="$(printf '%s' "$resp" | sed -n 's/.*"serverTime":\([0-9]\{10,\}\).*/\1/p')"
  if [ -z "$server_ms" ]; then
    api_reason="响应无 serverTime 字段：$resp"
  else
    api_offset_ms=$(( server_ms - local_ms ))
    [ "$api_offset_ms" -lt 0 ] && api_offset_ms=$(( -api_offset_ms ))
    if [ "$api_offset_ms" -le 2000 ]; then
      API_OK=1; api_reason="OK（偏差 ${api_offset_ms}ms ≤2000ms，含网络 RTT）"
    else
      api_reason="API 时间偏差 ${api_offset_ms}ms >2000ms"
    fi
  fi
fi

verdict="FAIL"; exit_code=1
if [ "$CHRONY_OK" -eq 1 ] && [ "$API_OK" -eq 1 ]; then
  verdict="PASS"; exit_code=0
elif [ "$CHRONY_OK" -eq 1 ]; then
  exit_code=2
fi

cat > "$OUT_FILE" <<EOF
# A-97 国家授时中心标准时间——送测证据快照
# 采集时间(本地): $(date '+%Y-%m-%d %H:%M:%S %Z')
# 采集时间(UTC) : $(date -u '+%Y-%m-%dT%H:%M:%SZ')
# 主机          : $(uname -srm) / $(hostname)
# 判定          : $verdict
#   chrony      : $chrony_reason
#   /api/time   : $api_reason
#
# ---- chronyc tracking ----
${TRACKING:-（无）}
#
# ---- chronyc sources -v ----
${SOURCES:-（无）}
#
# ---- chronyc sourcestats ----
${SOURCESTATS:-（无）}
#
# ---- GET $API_BASE/api/time ----
本地采集时刻(ms): $local_ms
API 响应        : ${resp:-（无）}
API 时间偏差(ms): ${api_offset_ms:-未解析}
EOF

echo "[$verdict] A-97 证据判定（总）"
echo "[chrony $([ "$CHRONY_OK" -eq 1 ] && echo PASS || echo FAIL)] $chrony_reason"
echo "[api    $([ "$API_OK" -eq 1 ] && echo PASS || echo FAIL)] $api_reason"
echo "证据文件: $OUT_FILE"
exit "$exit_code"
