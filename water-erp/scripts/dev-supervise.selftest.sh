#!/usr/bin/env bash
# dev-supervise.sh 契约自测：A 端口让位 / B 崩溃重启 / C TERM 不复活
# （对齐 dev-api-guard.selftest.sh 先例；跑真实 dev-supervise.sh + 桩命令，不 mock）
set -u
cd "$(dirname "$0")"
TMP="$(mktemp -d)"; PORT=59801; MARK="$TMP/mark"
trap 'rm -rf "$TMP"; pkill -f "dev-supervise.sh tst" 2>/dev/null' EXIT

echo "== 用例 A：端口已占用 → 让位 exit 0 =="
python3 -m http.server "$PORT" --bind 127.0.0.1 >/dev/null 2>&1 &
STUB=$!
sleep 0.5
timeout 3 bash dev-supervise.sh tstA "$PORT" 1 sleep 60
A=$?
kill "$STUB" 2>/dev/null
if [ "$A" = 0 ]; then echo "  PASS（退出码 0=让位）"; else echo "  FAIL（退出码 $A，期望 0=让位而非 124=超时驻留）"; exit 1; fi

echo "== 用例 B：子进程退出 → 延迟后重启 =="
: > "$MARK"
bash dev-supervise.sh tstB 0 1 bash -c "echo run >> '$MARK'; exit 3" &
SUP=$!
sleep 4   # delay=1s，4s 内应至少跑两轮
N=$(wc -l < "$MARK" 2>/dev/null || echo 0)

echo "== 用例 C：TERM → 杀子退出、不再重启 =="
kill -TERM "$SUP"
sleep 2
if pgrep -f "dev-supervise.sh tstB" >/dev/null; then echo "  FAIL（守护器残活）"; exit 1; fi
N2=$(wc -l < "$MARK" 2>/dev/null || echo 0)
if [ "$N" -ge 2 ]; then echo "  PASS（B：${N} 轮 ≥2，崩溃后重启）"; else echo "  FAIL（B：仅 ${N} 轮，未重启）"; exit 1; fi
if [ "$N2" = "$N" ]; then echo "  PASS（C：TERM 后 ${N2} 轮无增长，不复活）"; else echo "  FAIL（C：TERM 后仍重启）"; exit 1; fi
echo "全部通过"
