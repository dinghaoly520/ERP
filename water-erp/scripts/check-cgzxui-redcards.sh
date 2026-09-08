#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# cgzxui 红牌检查 —— 新拟态设计标准合规闸
#
# 规范源：water-erp/apps/public-portal/.claude/skills/cgzxui/SKILL.md
#   核心原则：单一 CSS 源 / 方向性双影 / oklch / 三态 / reduced-motion / 禁外侧框线
#
# 用法：
#   bash scripts/check-cgzxui-redcards.sh                 # 全量报告（硬性 + 报告模式）
#   bash scripts/check-cgzxui-redcards.sh --ci            # 仅硬性模式（整改范围内），命中即 exit 1
#   bash scripts/check-cgzxui-redcards.sh --app web       # 单应用（web|bid-portal|supplier-portal-next|expert-portal|public-portal）
#   bash scripts/check-cgzxui-redcards.sh --files <路径…> # 指定文件/目录
#
# --ci 执法范围（2026-09-04 链路整改范围；范围外存量违规不阻断，报告模式仍可见）：
#   - apps/bid-portal/src 全部
#   - apps/supplier-portal-next/src 全部
#   - apps/expert-portal/src 全部
#   - apps/web 仅链路区块：bid-confirm-panel.tsx / bid-confirm/** /
#     procurements/archive-detail-modal.tsx / app/(main)/archive/**
#
# 模式分级：
#   硬性（--ci 阻断）：H1 bg-white · H2 border-gray-* · H3 shadow-lg/xl/2xl/3xl
#     H4 内联 boxShadow · H5 CSS box-shadow 内 rgba/hex · H6 深色蒙层 · H7 exp-alert(仅 web)
#   报告（不阻断）：B1 style={{ 计数 · B2 扁平影启发 · B3 卡片框线启发 · B4 shadow-sm/md
#
# 豁免（SKILL 条款）：
#   - <th style={{ width: N }}>（SKILL「数据表格」模板原文许可）→ B1 豁免
#   - page-hero hairline 内联 borderTop: "1px solid oklch(…"（SKILL page-hero 示例自带）→ B1 豁免
#   - 模态浮影 0 20px 60px（SKILL 模态规范规定值）→ B2 白名单
#   - 焦点环 0 0 0 Npx（环无方向性）→ B2 白名单（色空间仍受 H5 约束）
#   - CSS 变量传递/动态宽高等需上下文判断者：B1 逐条输出由人工/台账对账
# ─────────────────────────────────────────────────────────────────────────────
set -u

CI_MODE=0
APP_FILTER=""
declare -a FILE_ARGS=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --ci) CI_MODE=1; shift ;;
    --app) APP_FILTER="${2:-}"; shift 2 ;;
    --files) shift; while [[ $# -gt 0 ]]; do FILE_ARGS+=("$1"); shift; done ;;
    *) echo "未知参数: $1" >&2; exit 2 ;;
  esac
done

# 定位 water-erp 根（脚本位于 water-erp/scripts/）
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(dirname "$SCRIPT_DIR")"

APPS=(web bid-portal supplier-portal-next expert-portal public-portal)
declare -a TSX_FILES=() CSS_FILES=()

# --ci 执法范围（见头注）：三门户全量 + web 链路区块
CI_SCOPE=(
  "$ROOT/apps/bid-portal/src"
  "$ROOT/apps/supplier-portal-next/src"
  "$ROOT/apps/expert-portal/src"
  "$ROOT/apps/web/src/components/projects/bid-confirm-panel.tsx"
  "$ROOT/apps/web/src/components/projects/bid-confirm"
  "$ROOT/apps/web/src/components/procurements/archive-detail-modal.tsx"
  "$ROOT/apps/web/src/app/(main)/archive"
)

collect_files() {
  local roots=()
  if [[ ${#FILE_ARGS[@]} -gt 0 ]]; then
    roots=("${FILE_ARGS[@]}")
  elif [[ $CI_MODE -eq 1 ]]; then
    roots=("${CI_SCOPE[@]}")
  elif [[ -n "$APP_FILTER" ]]; then
    roots=("$ROOT/apps/$APP_FILTER/src")
  else
    for a in "${APPS[@]}"; do roots+=("$ROOT/apps/$a/src"); done
  fi
  TSX_FILES=()
  CSS_FILES=()
  local f
  while IFS= read -r -d '' f; do TSX_FILES+=("$f"); done < <(
    find "${roots[@]}" \( -name node_modules -o -name .next -o -name dist \) -prune -o \
      -type f -name '*.tsx' ! -name '*.test.tsx' ! -path '*__tests__*' -print0 2>/dev/null)
  while IFS= read -r -d '' f; do CSS_FILES+=("$f"); done < <(
    find "${roots[@]}" \( -name node_modules -o -name .next -o -name dist \) -prune -o \
      -type f -name '*.css' -print0 2>/dev/null)
}
collect_files

rel() { echo "${1#"$ROOT"/}"; }

HARD_HITS=0
declare -a HARD_LINES=()

scan_tsx() { # $1=模式名 $2=扩展正则 $3=限定路径前缀(可空)
  local name="$1" pat="$2" prefix="${3:-}" hits=0 f out
  for f in "${TSX_FILES[@]}"; do
    [[ -n "$prefix" && "$f" != *"$prefix"* ]] && continue
    out="$(grep -rnE "$pat" "$f" 2>/dev/null)" || true
    if [[ -n "$out" ]]; then
      local n; n="$(echo "$out" | wc -l)"
      hits=$((hits + n))
      while IFS= read -r line; do HARD_LINES+=("[$name] $(rel "$f"):$line"); done <<< "$out"
    fi
  done
  if [[ $hits -gt 0 ]]; then
    HARD_HITS=$((HARD_HITS + hits))
    echo "== $name: $hits 处 =="
  fi
  return 0
}

if [[ ${#TSX_FILES[@]} -gt 0 || ${#CSS_FILES[@]} -gt 0 ]]; then :; else
  echo "未找到可扫描文件（检查 --app/--files 参数）" >&2; exit 2
fi

echo "cgzxui 红牌检查 $(date +%F) · 模式: $( [[ $CI_MODE -eq 1 ]] && echo '--ci 硬性' || echo '全量报告' )"
echo "扫描：${#TSX_FILES[@]} tsx · ${#CSS_FILES[@]} css"
echo

# ── 硬性模式 ──────────────────────────────────────────────────────────────────
echo "──── 硬性模式（--ci 阻断级）────"
scan_tsx "H1 bg-white" 'bg-white(/|[^a-zA-Z]|$)'
scan_tsx "H2 border-gray-*" 'border-gray-'
scan_tsx "H3 扁平预设阴影" 'shadow-(lg|xl|2xl|3xl)([^a-zA-Z]|$)'
scan_tsx "H4 内联 boxShadow" 'boxShadow[[:space:]]*[:=]'
scan_tsx "H6 深色蒙层" 'bg-(black|slate-9|gray-9)[0-9a-zA-Z/]*'
scan_tsx "H7 exp-alert 幽灵类" 'exp-alert' "apps/web/"

# H5 CSS box-shadow 声明块内 rgba/hex（awk 跨行至分号）
H5_OUT="$(awk '
  function bad(v) { return (v ~ /rgba\(/ || v ~ /#[0-9a-fA-F][0-9a-fA-F][0-9a-fA-F]/) }
  indecl {
    buf = buf " " $0
    if (index($0, ";") > 0) {
      val = substr(buf, 1, index(buf, ";") - 1)
      if (bad(val)) printf "%s:%d:%s\n", FILENAME, startline, val
      indecl = 0; buf = ""
    }
    next
  }
  {
    p = index($0, "box-shadow")
    if (p > 0) {
      rest = substr($0, p)
      if (index(rest, ";") > 0) {
        val = substr(rest, 1, index(rest, ";") - 1)
        if (bad(val)) printf "%s:%d:%s\n", FILENAME, FNR, val
      } else {
        buf = rest; indecl = 1; startline = FNR
      }
    }
  }
' "${CSS_FILES[@]}" 2>/dev/null)" || true
if [[ -n "$H5_OUT" ]]; then
  H5_N="$(echo "$H5_OUT" | wc -l)"
  HARD_HITS=$((HARD_HITS + H5_N))
  echo "== H5 CSS box-shadow 内 rgba/hex: $H5_N 处 =="
  while IFS= read -r line; do HARD_LINES+=("[H5] $(rel "${line%%:*}" 2>/dev/null || echo "$line"):${line#*:}"); done <<< "$H5_OUT"
fi

if [[ $CI_MODE -eq 1 ]]; then
  echo
  if [[ $HARD_HITS -gt 0 ]]; then
    printf '%s\n' "${HARD_LINES[@]}" | head -200
    echo
    echo "红牌 --ci：$HARD_HITS 处硬性违规 → FAIL"
    exit 1
  fi
  echo "红牌 --ci：0 处硬性违规 → PASS"
  exit 0
fi

# 全量模式：打印硬性命中明细
if [[ $HARD_HITS -gt 0 ]]; then
  printf '%s\n' "${HARD_LINES[@]}"
else
  echo "（无硬性命中）"
fi
echo

# ── 报告模式 ──────────────────────────────────────────────────────────────────
echo "──── 报告模式（不阻断，供基线/对账）────"

# B1 style={{ 计数（逐文件：总数 / 疑似豁免 / 待核）
#   疑似豁免启发：同一逻辑行内含 "--（CSS 变量）或 <th style={{ width: 数字 }} 或
#   borderTop: "1px solid oklch(（SKILL 模板豁免项）；跨行对象需人工台账对账
echo "== B1 内联 style={{ 逐文件计数 =="
for f in "${TSX_FILES[@]}"; do
  total="$(grep -c 'style={{' "$f" 2>/dev/null)" || total=0
  [[ "$total" -eq 0 ]] && continue
  exempt="$(grep -n 'style={{' "$f" | grep -cE "(['\"]--|width:[[:space:]]*[0-9]+[[:space:]]*}|borderTop.*1px solid oklch)" || true)"
  echo "  $(rel "$f"): 总 $total / 疑似豁免 $exempt / 待核 $((total - exempt))"
done
echo

# B2 扁平影启发（CSS：box-shadow 声明含 0 Npx Npx 层、非 inset、非环、非模态浮影白名单）
echo "== B2 疑似扁平无方向阴影 =="
awk '
  function flat(v) {
    return (v ~ /(^|,)[[:space:]]*0[[:space:]]+[0-9.]+px[[:space:]]+[0-9.]+px/ \
            && v !~ /inset/ && v !~ /0 0 0/ && v !~ /0 20px 60px/)
  }
  indecl {
    buf = buf " " $0
    if (index($0, ";") > 0) {
      val = substr(buf, 1, index(buf, ";") - 1)
      if (flat(val)) printf "  %s:%d\n", FILENAME, startline
      indecl = 0; buf = ""
    }
    next
  }
  {
    p = index($0, "box-shadow")
    if (p > 0) {
      rest = substr($0, p)
      if (index(rest, ";") > 0) {
        val = substr(rest, 1, index(rest, ";") - 1)
        if (flat(val)) printf "  %s:%d\n", FILENAME, FNR
      } else {
        buf = rest; indecl = 1; startline = FNR
      }
    }
  }
' "${CSS_FILES[@]}" 2>/dev/null | sed "s|$ROOT/||" | sort | uniq | head -80
echo

# B3 卡片族块级表面外侧框线启发（选择器含 card/panel/module/tile/banner 且声明非 none 的 border）
echo "== B3 卡片族疑似外侧框线 =="
awk '
  {
    if ($0 ~ /(^|[\s,{.])([A-Za-z0-9_-]*(card|panel|module|tile|banner)[A-Za-z0-9_-]*)[[:space:]]*[^;]*\{/ ) { inblock=1; sel=$0; start=FNR }
    if (inblock && $0 ~ /border[[:space:]]*:[[:space:]]*[^;]*[0-9]/ && $0 !~ /border[[:space:]]*:[[:space:]]*none/ && $0 !~ /border-(top|bottom|left|right|radius|collapse)/) {
      printf "  %s:%d: %s\n", FILENAME, FNR, $0
    }
    if (inblock && index($0, "}") > 0) inblock=0
  }
' "${CSS_FILES[@]}" 2>/dev/null | sed "s|$ROOT/||" | head -80
echo

# B4 轻量扁平预设（shadow-sm/md）与提示项
echo "== B4 shadow-sm/md（提示级）=="
grep -rnE 'shadow-(sm|md)([^a-zA-Z]|$)' "${TSX_FILES[@]}" 2>/dev/null | sed "s|$ROOT/||" | head -40
echo

echo "报告完毕。基线对账：docs/cgzxui-remediation/baseline-*.txt"
