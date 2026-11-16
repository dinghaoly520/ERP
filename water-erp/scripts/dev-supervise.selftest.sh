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

echo "== 用例 D：重启前复查端口——被抢跑者占住则让位退出 =="
: > "$MARK"
PORT2=$((PORT + 1))
bash dev-supervise.sh tstD "$PORT2" 1 bash -c "echo run >> '$MARK'; sleep 2; exit 3" &
SUPD=$!
sleep 0.7                                # 首轮子进程在跑（2s 窗口）
python3 -m http.server "$PORT2" --bind 127.0.0.1 >/dev/null 2>&1 &   # 模拟抢跑者占用端口
STUBD=$!
sleep 5                                  # 首轮子进程退出 → 复查 → 应让位退出（而非 1s 后重启）
ND=$(wc -l < "$MARK" 2>/dev/null || echo 0)
kill "$STUBD" 2>/dev/null
DSTATE=$(awk '{print $3}' "/proc/$SUPD/stat" 2>/dev/null || echo GONE)
case "$DSTATE" in ""|GONE|Z) echo "  PASS（D：让位退出）";; *) pkill -f 'dev-supervise[.]sh tstD'; echo "  FAIL（D：守护器仍活 state=$DSTATE——重启前未复查端口）"; exit 1;; esac
[ "$ND" = 1 ] && echo "  PASS（D：仅 ${ND} 轮，未撞端口重载）" || { echo "  FAIL（D：${ND} 轮——落选方在无限重启）"; exit 1; }

echo "== 用例 E：TERM 后顽固子进程被 -9 升级收尸（KILL_WAIT=1s） =="
EPID="$TMP/epid"
KILL_WAIT=1 bash dev-supervise.sh tstE 0 1 bash -c 'echo $$ > "$1"; trap "" TERM; sleep 300' _ "$EPID" &
SUPE=$!
for _ in $(seq 1 30); do [ -s "$EPID" ] && break; sleep 0.1; done
ECHILD=$(cat "$EPID" 2>/dev/null)
[ -n "$ECHILD" ] || { pkill -f 'dev-supervise[.]sh tstE'; echo "  FAIL（E：子进程未起）"; exit 1; }
kill -TERM "$SUPE"
sleep 3
kill -0 "$ECHILD" 2>/dev/null && { kill -9 "$ECHILD" 2>/dev/null; pkill -f 'dev-supervise[.]sh tstE'; echo "  FAIL（E：顽固子进程残活——TERM 未升级 -9）"; exit 1; }
ESTATE=$(awk '{print $3}' "/proc/$SUPE/stat" 2>/dev/null || echo GONE)
case "$ESTATE" in ""|GONE|Z) : ;; *) pkill -f 'dev-supervise[.]sh tstE'; echo "  FAIL（E：守护器残活 state=$ESTATE）"; exit 1;; esac
echo "  PASS（E：顽固子进程 1s 窗内被 -9 收尸，守护器干净退出）"
echo "全部通过"
