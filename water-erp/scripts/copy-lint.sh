#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# 文案巡检闸 —— 开发黑话 / 内部代号 / AI 痕迹防回归
#
# 规范源：docs/superpowers/plans/2026-10-16-copy-jargon-remediation.md
# （2026-10-16 全项目文案排查→整改；本闸将当次口径固化为 CI 硬闸，2026-10-18 加强）
#
# 用法：
#   bash scripts/copy-lint.sh              # 全量（前端 9 门户 + packages；API 错误消息）
#   bash scripts/copy-lint.sh <路径…>      # 只扫指定文件/目录（本地预检）
#   bash scripts/copy-lint.sh --ci         # 同全量（旗标与红牌闸风格对齐）
#
# 规则集（命中即 exit 1）：
#   U1 端口号入散文      （:3007）| 在 :3007 | 由 :3005 …
#   U2 内部工单/规范代号 （A-129，|（A-102）| 分工 v3 | BID-P3-02
#   U3 研发黑话          规则兜底 | LLM 综合 | 幂等 | 回滚 | 透传 | payloadHash(schema=) 入散文
#   U4 英文 tab 混排     「…」tab | 对应 tab 操作
#   U5 散文内嵌机器码    （EXCEPTION）
#   U6 emoji 当图标      🔓 ⚠ ✅ ⬜ ✏ ⭐（.impeccable.md 禁 emoji-as-icons）
#   U7 占位/演示痕迹     测试账号 | 测试: | 即将上线
#   A1 API 错误消息黑话  error: 行含 旧轨/新轨/dual-v3/.env/DEEPSEEK/API Key/
#                        （全大写机器码）——码归 code: 字段，不进散文
#
# 扫描范围：
#   U1-U7 → 前端门户（public-portal/mall/supplier-portal-next/web/expert-portal/
#           bid-portal/assistant/bigscreen/mobile-portal）+ packages 的 ts/tsx
#   A1    → apps/api/src 非 spec 的 error: 消息行
#   （apps/api 的 console/Swagger/注释不在 U 范围——内部件，黑话合法）
#
# 注释豁免（awk 状态机）：//、*、/* 行与跨行 /* */ 块、行尾 //（避开 URL "://"）、
# 行内 /*...*/ 段均剔除后才匹配。确属误报时行尾加 `copy-lint-allow`（附理由）。
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail
cd "$(dirname "$0")/.."

FRONTEND=(apps/public-portal apps/supplier-portal-next apps/web \
  apps/expert-portal apps/bid-portal apps/assistant apps/bigscreen apps/mobile-portal)

ARGS=("$@")
PATHS=()
for a in "${ARGS[@]:-}"; do [[ -n "$a" && "$a" != "--ci" ]] && PATHS+=("$a"); done
[[ ${#PATHS[@]} -eq 0 ]] && PATHS=("${FRONTEND[@]}" packages)

RULES=(
  'U1|（:300[0-9]|\p{Han} :300[0-9]'
  'U2|（A-1[0-9]{2}[，）]|分工 v[0-9]|BID-P[0-9]'
  'U3|规则兜底|LLM 综合|幂等|回滚|透传|[\p{Han}\d] payloadHash|（payloadHash）|payloadHash（|schema=[a-z]'
  'U4|」tab|\p{Han} tab \p{Han}'
  'U5|（EXCEPTION）'
  'U6|🔓|⚠|✅|⬜|✏|⭐'
  'U7|测试账号|测试: |即将上线'
)

# ── 注释感知行过滤器：stdin=文件列表(argv)，stdout=FILENAME:FNR:代码行 ──
AWK_FILTER='
BEGIN { inb = 0 }
function isblank(s) { return s ~ /^[ \t]*$/ }
FNR == 1 { inb = 0 }
{
  l = $0
  if (inb) {                                  # 块注释内部
    if (match(l, /\*\//)) { inb = 0; l = substr(l, RSTART + 2) }   # 丢弃 */ 前的注释体
    else next
  }
  if (l ~ /^[ \t]*(\/\/|\*)/) next            # // 行与 * 续行
  if (l ~ /^[ \t]*\/\*/) {                    # /* 行首
    if (l !~ /\*\//) { inb = 1; next }
    sub(/\/\*.*\*\//, "", l)                  # 同行闭合
  }
  while (l ~ /\/\*[^*]*\*([^/*][^*]*\*)*\//) sub(/\/\*[^*]*\*([^/*][^*]*\*)*\//, "", l)   # 行内闭合段
  if (l ~ /\/\*/ && l !~ /\*\//) { sub(/\/\*.*$/, "", l); inb = 1 }   # 未闭合：保前段
  if (match(l, /(^|[^:])\/\//)) {             # 行尾 //（避开 URL）
    pos = RSTART + RLENGTH - 2
    l = (pos > 0) ? substr(l, 1, pos + 1) : ""
  }
  if (isblank(l) || l ~ /copy-lint-allow/) next
  printf "%s:%d:%s\n", FILENAME, FNR, l
}'

violations=0
UI_DIRTY=0
scan_set() {  # $@=路径；报告直印，脏标记置全局 UI_DIRTY
  local entry label pattern n hits
  find "$@" -type f \( -name '*.ts' -o -name '*.tsx' \) \
    ! -path '*/node_modules/*' ! -path '*/dist/*' ! -path '*/.next/*' \
    ! -name '*.spec.ts' ! -name '*.spec.tsx' ! -path '*/__tests__/*' ! -path '*/test/*' \
    ! -path '*/.superpowers/*' 2>/dev/null | xargs -r -d '\n' awk "$AWK_FILTER" 2>/dev/null > /tmp/copylint-lines.$$
  if [[ -s /tmp/copylint-lines.$$ ]]; then
    for entry in "${RULES[@]}"; do
      label="${entry%%|*}"; pattern="${entry#*|}"
      hits=$(grep -P "$pattern" /tmp/copylint-lines.$$ | head -5)
      if [[ -n "$hits" ]]; then
        n=$(grep -cP "$pattern" /tmp/copylint-lines.$$)
        echo "  [$label] ${n} 处（最多列 5）："
        while IFS= read -r line; do echo "    $line"; done <<< "$hits"
        UI_DIRTY=1
      fi
    done
  fi
  rm -f /tmp/copylint-lines.$$
}

echo "── copy-lint: 扫描前端+packages（U1-U7）与 apps/api/src error: 消息（A1）"
scan_set "${PATHS[@]}"
[[ $UI_DIRTY -eq 1 ]] && violations=$((violations+1))

# A1：API 错误消息
api_hits=$(grep -rnP 'error\s*:' apps/api/src --include='*.ts' --exclude='*.spec.ts' 2>/dev/null \
  | grep -vP ':[0-9]+:\s*(//|\*)' \
  | grep -P '旧轨|新轨|dual-v3|\.env|DEEPSEEK|API Key|（[A-Z][A-Z_]{3,}）' \
  | grep -v 'copy-lint-allow' | head -5)
if [[ -n "$api_hits" ]]; then
  n=$(grep -rnP 'error\s*:' apps/api/src --include='*.ts' --exclude='*.spec.ts' 2>/dev/null \
    | grep -vP ':[0-9]+:\s*(//|\*)' \
    | grep -P '旧轨|新轨|dual-v3|\.env|DEEPSEEK|API Key|（[A-Z][A-Z_]{3,}）' \
    | grep -v 'copy-lint-allow' | wc -l)
  echo "  [A1] ${n} 处（最多列 5）："
  while IFS= read -r line; do echo "    $line"; done <<< "$api_hits"
  violations=$((violations+1))
fi

if [[ $violations -gt 0 ]]; then
  echo "✗ 文案巡检不通过——修文案，或行尾加 copy-lint-allow 豁免（附理由）"
  exit 1
fi
echo "✓ 文案巡检通过"
