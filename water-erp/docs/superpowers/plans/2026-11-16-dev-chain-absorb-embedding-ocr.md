# dev 链收编 bge-m3 :8003 与 erp-ocr :8110 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `pnpm dev` 一键拉起 OCR `:8110` 与 bge-m3 vLLM `:8003` 并保住崩溃自愈语义，PM2 轨退役。

**Architecture:** 新增通用 shell 守护器 `scripts/dev-supervise.sh`（端口让位 / 崩溃延迟重启 / TERM 整链退出），OCR 与 embedding 两个服务经它挂进 concurrently dev 链；`dev:kill` 扩清两端口并先杀守护器再清端口；删除 PM2 ecosystem 并同步三处文档。

**Tech Stack:** bash（对齐 `dev-kill.sh` 风格）、pnpm scripts + concurrently（既有）、FastAPI/uvicorn（OCR）、vLLM（机器级 venv `/home/asus/vllm_venv`）。

**Spec:** `docs/superpowers/specs/2026-11-16-dev-chain-absorb-embedding-ocr-design.md`

## Global Constraints

- 仅 dev 机工作流；生产拓扑（B 机 Docker OCR）与 `apps/api/.env`（`OCR_SERVICE_URL=:8110`、`EMBEDDING_BASE_URL=:8003/v1`）零改动。
- 端口 canon：OCR=**8110**、embedding=**8003**。
- 不新增依赖、不新增常驻服务（无 systemd/PM2 新单元）。
- shell 风格对齐 `scripts/dev-kill.sh`：`bash` + `set -u`、中文注释、端口探测 `ss -tln | grep -q ":<port> "`（尾空格）。
- **CLAUDE.md 编辑必须走 Bash**（ARS 守卫拦 Edit/Write，memory `edit-claudemd-via-bash`）。
- git 只 add 显式路径（并行会话协作约定，禁 `-A`）；commit 信息尾行 `Co-Authored-By: Claude Code <noreply@anthropic.com>`。
- vLLM 启动命令**逐字照抄** procurement PM2 实测参数（勿增删 flag）。

## Review Focus

1. **OCR watchdog 自杀（`os._exit(1)`）后无人拉起**——守护器必须在 5s 内重启子进程 → Task 1 selftest 用例 B 锁定。
2. **dev 链退出后守护器残活、延迟后拉起孤儿抢端口**——TERM 必须杀子且不再重启 → Task 1 selftest 用例 C + Task 2 验证 dev:kill 先杀守护器再清端口。
3. **端口被残留实例占用时双开撞车**——守护器端口让位 exit 0 → Task 1 selftest 用例 A；`--api` 模式不误杀守护器 → Task 2 干跑验证。
4. **vLLM 模型加载分钟级被误判启动失败**——验收一律轮询带超时（≤180s），禁即时判定 → Task 4 步骤内建。
5. **pm2-asus systemd enabled：下次重启复活 procurement 全家桶抢 :8003/:4000**——用户侧 `sudo systemctl disable pm2-asus` → Task 4 收尾核对 `is-enabled` 期望 `disabled`。

---

### Task 1: 通用守护器 `dev-supervise.sh` + 自测

**Files:**
- Create: `water-erp/scripts/dev-supervise.sh`（可执行）
- Test: `water-erp/scripts/dev-supervise.selftest.sh`（可执行）

**Interfaces:**
- Produces: `dev-supervise.sh <label> <port> <restart_delay_s> <cmd> [args...]`——端口已监听 → 打印让位信息 `exit 0`；TERM/INT → 杀子进程并 `exit 0`（不重启）；子进程非 TERM 退出 → 打印退出码、`sleep delay` 后重启。Task 2 的 dev 链条目与 `dev:ocr`/`dev:embedding` 均以此签名调用。

- [x] **Step 1: 写自测脚本（三用例，先红）**

`scripts/dev-supervise.selftest.sh`，对齐 `dev-api-guard.selftest.sh` 先例；临时文件 `mktemp -d`、测试端口 `59801`（避免与真实服务冲突）、`pgrep -f` 用带 `tst` 的唯一 label 防自匹配：

```bash
#!/usr/bin/env bash
# dev-supervise.sh 契约自测：A 端口让位 / B 崩溃重启 / C TERM 不复活
set -u
cd "$(dirname "$0")"
TMP="$(mktemp -d)"; PORT=59801; MARK="$TMP/mark"
trap 'rm -rf "$TMP"; pkill -f "dev-supervise.sh tst" 2>/dev/null' EXIT

echo "== 用例 A：端口已占用 → 让位 exit 0 =="
python3 -m http.server "$PORT" --bind 127.0.0.1 >/dev/null 2>&1 &
STUB=$!
timeout 3 bash dev-supervise.sh tstA "$PORT" 1 sleep 60
A=$?
kill "$STUB" 2>/dev/null
[ "$A" = 0 ] && echo "  PASS（退出码 0）" || { echo "  FAIL（退出码 $A，期望 0=让位而非 124=超时驻留）"; exit 1; }

echo "== 用例 B：子进程退出 → 延迟后重启 =="
bash dev-supervise.sh tstB 0 1 bash -c "echo run >> '$MARK'; exit 3" &
SUP=$!
sleep 4   # delay=1s，4s 内应至少跑两轮
N=$(wc -l < "$MARK" 2>/dev/null || echo 0)
echo "== 用例 C：TERM → 杀子退出、不再重启 =="
kill -TERM "$SUP"
sleep 2
if pgrep -f "dev-supervise.sh tstB" >/dev/null; then echo "  FAIL（守护器残活）"; exit 1; fi
N2=$(wc -l < "$MARK" 2>/dev/null || echo 0)
[ "$N" -ge 2 ]   && echo "  PASS（B：${N} 轮 ≥2）"   || { echo "  FAIL（B：仅 ${N} 轮，未重启）"; exit 1; }
[ "$N2" = "$N" ] && echo "  PASS（C：TERM 后 ${N2} 轮无增长）" || { echo "  FAIL（C：TERM 后仍重启）"; exit 1; }
echo "全部通过"
```

（注意用例 B 的 port 传 `0`：不探测真实端口，`ss` 对 `:0 ` 无监听必然放行——参数仍占位保持签名。）

- [x] **Step 2: 跑自测确认红**

Run: `bash scripts/dev-supervise.selftest.sh`
Expected: 用例 A 即 FAIL（`dev-supervise.sh: No such file or directory`，timeout 速退非 0）

- [x] **Step 3: 实现 `scripts/dev-supervise.sh`**

trap/wait 交互是签名测不出的算法，整体给出：

```bash
#!/usr/bin/env bash
# dev 链服务守护器（2026-11-16）：替代 PM2 autorestart 语义（OCR watchdog 自杀→拉起；
# ecosystem.config.js 已退役）。用法: dev-supervise.sh <label> <port> <restart_delay_s> <cmd...>
# 端口已监听→让位 exit 0（残留实例仍可用，勿双开）；TERM/INT→杀子退出不重启
# （配合 dev-kill 先杀守护器再清端口的顺序，防延迟后孤儿复活抢端口）。
set -u
LABEL="${1:?用法: dev-supervise.sh <label> <port> <restart_delay_s> <cmd...>}"
PORT="${2:?}"
DELAY="${3:?}"
shift 3

if ss -tln 2>/dev/null | grep -q ":${PORT} "; then
  echo "[${LABEL}] :${PORT} 已有监听（残留实例？），跳过启动；如需重启先 pnpm dev:kill"
  exit 0
fi

CHILD=0
on_term() { [ "$CHILD" -gt 0 ] && kill "$CHILD" 2>/dev/null; exit 0; }
trap on_term TERM INT

echo "[${LABEL}] 启动: $*（守护: 崩溃 ${DELAY}s 后重启）"
while true; do
  "$@" &
  CHILD=$!
  wait "$CHILD"
  CODE=$?
  echo "[${LABEL}] 子进程退出码 ${CODE}，${DELAY}s 后重启"
  sleep "$DELAY"
done
```

（`wait` 被信号打断时 trap 已 `exit 0`，循环内不会走到重启——这就是 TERM 不复活的机制。）

- [x] **Step 4: 跑自测确认绿**

Run: `chmod +x scripts/dev-supervise.sh scripts/dev-supervise.selftest.sh && bash scripts/dev-supervise.selftest.sh`
Expected: 三用例全 PASS，末行 `全部通过`

- [x] **Step 5: Commit（含 spec 与本计划）**

```bash
git add scripts/dev-supervise.sh scripts/dev-supervise.selftest.sh \
  docs/superpowers/specs/2026-11-16-dev-chain-absorb-embedding-ocr-design.md \
  docs/superpowers/plans/2026-11-16-dev-chain-absorb-embedding-ocr.md
git commit -m "feat(dev): 通用守护器 dev-supervise.sh——端口让位/崩溃重启/TERM 不复活（收编 OCR 与 bge-m3 前置件）

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 2: 接线 dev 链（package.json / start.sh / dev-kill.sh）

**Files:**
- Modify: `water-erp/package.json`（dev 链 + `dev:ocr` + 新 `dev:embedding`）
- Modify: `water-erp/services/ocr/start.sh:28`（默认端口）
- Modify: `water-erp/scripts/dev-kill.sh`（端口清单 + 守护器扫杀 + 注释）

**Interfaces:**
- Consumes: Task 1 的 `dev-supervise.sh` 签名。
- Produces: dev 链 13 成员（尾部新增 `ocr`、`embedding`）；`dev:kill` 全量模式清 12 端口（原 10 + 8003 + 8110）并扫杀 `*dev-supervise.sh*`（`--api` 模式不杀守护器）。

- [x] **Step 1: `start.sh` 默认端口 8100→8110**

行 `OCR_PORT="${OCR_PORT:-8100}"` → `OCR_PORT="${OCR_PORT:-8110}"`；上一行注释改为 `# 端口参数化：OCR_PORT/OCR_HOST（默认 8110=ERP canon；procurement :8100 已随项目停用 2026-11-16）`

- [x] **Step 2: `package.json` 三处**

`dev` 链：names 尾部追加 `,ocr,embedding`；colors 追加 `,#f06292,#7e57c2`；命令尾部追加两条：

```
"bash scripts/dev-supervise.sh ocr 8110 5 bash services/ocr/start.sh"
"bash scripts/dev-supervise.sh embedding 8003 10 /home/asus/vllm_venv/bin/vllm serve /home/asus/models/bge-m3 --host 127.0.0.1 --port 8003 --convert embed --max-model-len 8192 --gpu-memory-utilization 0.40 --enforce-eager"
```

`dev:ocr` 改为 `"dev:ocr": "bash scripts/dev-supervise.sh ocr 8110 5 bash services/ocr/start.sh"`；新增 `"dev:embedding": "bash scripts/dev-supervise.sh embedding 8003 10 /home/asus/vllm_venv/bin/vllm serve /home/asus/models/bge-m3 --host 127.0.0.1 --port 8003 --convert embed --max-model-len 8192 --gpu-memory-utilization 0.40 --enforce-eager"`

- [x] **Step 3: `dev-kill.sh` 两处**

① 端口行（第 83 行全量分支）追加两端口：
`fuser -k 3002/tcp 3003/tcp 3004/tcp 3005/tcp 3006/tcp 3007/tcp 3008/tcp 3010/tcp 3011/tcp 4001/tcp 8003/tcp 8110/tcp 2>/dev/null`
② 第 45 行 pattern `*dev-api-guard.sh*|*dev:api-guard*)` 扩为 `*dev-api-guard.sh*|*dev:api-guard*|*dev-supervise.sh*)`——**但守卫杀须全模式、守护器杀须限 `MODE=all`**：把该 case 命中后按 cmdline 细分（guard 两条 pattern 任何 MODE 都收杀；`dev-supervise.sh` 仅 `MODE=all` 时入列），实现方式自选（如两个独立 case 分支）。头注释补一行：守护器清理防「fuser 清端口后 10s 孤儿复活」；用法注释 `10 个端口`→`12 个端口`。

- [x] **Step 4: 语法与干跑验证**

Run: `bash -n scripts/dev-kill.sh && node -e "JSON.parse(require('fs').readFileSync('package.json'))" && bash scripts/dev-kill.sh --list`
Expected: 三条全无错；干跑列出将杀对象（当前无守护器运行则显示无）
再 Run: `bash scripts/dev-kill.sh --api --list`（如有守护器在跑，确认其**不在** --api 清单）——静态审查 MODE 闸实现亦可。

- [x] **Step 5: Commit**

```bash
git add package.json services/ocr/start.sh scripts/dev-kill.sh
git commit -m "feat(dev): OCR :8110 与 bge-m3 :8003 收编 pnpm dev 链——dev-supervise 守护 + dev:kill 12 端口/先杀守护器

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 3: PM2 轨退役 + 文档同步

**Files:**
- Delete: `water-erp/services/ocr/ecosystem.config.js`
- Modify: `water-erp/services/ocr/ARCHITECTURE.md`（14 处 PM2/dev 托管表述，生产 Docker 表述不动）
- Modify: `water-erp/services/ocr/.env.example:33` 与 `.env` 同行注释
- Modify: `/home/asus/桌面/ERP/CLAUDE.md`（**走 Bash 改**，三处）

**Interfaces:** 无代码接口；纯退役与文档。产出约定：后续文档/记忆中 OCR 与 :8003 的托管表述统一为「`pnpm dev` 链 `scripts/dev-supervise.sh` 守护」。

- [x] **Step 1: 删 ecosystem.config.js**

`git rm services/ocr/ecosystem.config.js`（2026-11-04 的「勿并入 pnpm dev」警示已由守护循环推翻，spec 有案）

- [x] **Step 2: ARCHITECTURE.md 扫旧表述**

逐处替换（行号为 2026-11-16 现状）：L6 变更摘要「PM2 `erp-ocr` 独立实例」→「dev 链 `dev-supervise.sh` 守护实例（2026-11-16 PM2 退役）」；L15 拓扑图标签；L46「→ PM2 ~5s 拉起」→「→ dev-supervise ~5s 拉起」；L57-58 bge-m3 托管方改「`pnpm dev` 链 `dev:embedding`（procurement 已停用）」、L58 整句改历史注记；L70/L204「PM2 重启循环」→「守护器重启循环」；L147 `max_memory_restart` 表述改「守护循环拉起（max_memory 语义随 PM2 退役移除，OOM 后同 5s 重启）」；L159 `PM2 restart_delay=5s`→`dev-supervise delay=5s`；L175「（PM2 env 块）」→「（dev-supervise 所在 shell env）」；L177 标题「（PM2 env）」→「（会话 env）」；L260-262 对照表改历史注记或重写为「erp-ocr（dev 链 :8110）」；L276「PM2: procurement-embedding」→「dev:embedding」；L300 文件清单删 ecosystem 行。`grep -n 'PM2\|pm2' ARCHITECTURE.md` 复核：仅允许历史变更摘要里的年份叙述残留。

- [x] **Step 3: `.env.example` / `.env` 注释同步**

「超时自杀交 PM2 拉起（默认 180）」→「超时自杀交 dev-supervise 守护循环拉起（默认 180）」（两个文件同一行）

- [x] **Step 4: CLAUDE.md 三处（Bash + python3 替换，ARS 守卫拦 Edit/Write）**

① L44 OCR 段「**ERP 自管 PM2 \`erp-ocr\` 实例 \`:8110\`（2026-11-04 接管，v1.3.0）**——不再复用 procurement 的 :8100（procurement-ocr 属对方项目、继续自用）。」→「**dev 链 \`dev-supervise.sh\` 守护实例 \`:8110\`（2026-11-04 自 procurement 接管；2026-11-16 PM2 退役收编 \`pnpm dev\`，崩溃 5s 守护重启，watchdog 自杀语义保留）**——procurement 项目已停用（其 :8100/:8003 宿主职责由本链接管）。」
② Development Commands：`pnpm dev` 注释「Start all (9 portals — includes bigscreen + mobile-portal + ai-bid worker)」→「Start all（9 portals + bigscreen + mobile + ai-bid worker + OCR :8110 + bge-m3 embedding :8003）」；`pnpm dev:ocr` 注释「# OCR 微服务（Python，:8100）」→「# OCR 微服务 :8110（dev-supervise 守护）」；其下新增一行 `pnpm dev:embedding   # bge-m3 embedding vLLM :8003（dev-supervise 守护；procurement PM2 停用后由本链托管）`（对齐邻近注释缩进）。
③ TenderReview 硬依赖句「\`EMBEDDING_BASE_URL\` 须指本机在跑的 vLLM bge-m3 \`http://localhost:8003/v1\`」后追加「（:8003 由 \`pnpm dev\` 链 dev:embedding 拉起，2026-11-16 起不再依赖 procurement PM2）」。

- [x] **Step 5: 复核 + Commit**

Run: `grep -rn 'erp-ocr\|procurement-embedding' --include='*.md' services/ docs/ ../CLAUDE.md 2>/dev/null | grep -v 已停用 | grep -v 2026-11-16`（人为复核残行是否均为历史叙述）
```bash
git add services/ocr/ecosystem.config.js services/ocr/ARCHITECTURE.md services/ocr/.env.example services/ocr/.env ../CLAUDE.md
git commit -m "chore(dev): PM2 轨退役——删 OCR ecosystem，文档三处同步收编口径

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 4: 端到端验收

**Files:** 无新文件（验证 + 计划勾选回写）。

**Interfaces:** Consumes Task 2 的 `dev:ocr`/`dev:embedding`/`dev:kill`。

- [x] **Step 1: 单服务——OCR 崩溃自愈**

后台 `pnpm dev:ocr` → 轮询 `curl -s --noproxy '*' http://127.0.0.1:8110/health`（≤60s）→ 200。
找到 uvicorn 进程 PID（`ss -tlnp | grep :8110`）`kill -9` → 轮询 :8110 重新监听（≤15s=5s delay+启动）→ `/health` 复 200。

- [x] **Step 2: 单服务——embedding 冒烟**

`pnpm dev:kill` 清场 → 后台 `pnpm dev:embedding` → 轮询 `curl -s --noproxy '*' http://127.0.0.1:8003/v1/models`（**≤180s**，模型加载分钟级，禁即时判定）→ 响应含 `bge-m3`；再 `curl -s --noproxy '*' -X POST http://127.0.0.1:8003/v1/embeddings -H 'Content-Type: application/json' -d '{"model":"/home/asus/models/bge-m3","input":["测试"]}'` → 返回 1024 维向量（jq 数长度）。

- [x] **Step 3: 全链集成**

`pnpm dev:kill` 清场 → 后台 `pnpm dev`（自带 dev:kill 前置）→ 等编译+模型加载 → 断言 13 端口全监听：3002 3004 3005 3006 3007 3008 3010 3011 4001 8003 8110（`ss -tln` 逐一核对；3003 ukey 不在链）；`curl /api/docs` 200。→ `pnpm dev:kill` → 断言 12 端口全释放、`pgrep -f dev-supervise.sh` 为空。

- [x] **Step 4: pm2-asus 核对（用户侧动作闭环）**

提醒用户执行 `! sudo systemctl disable pm2-asus`；执行后 `systemctl is-enabled pm2-asus` 期望 `disabled`。若用户暂不执行，在交付说明中标注遗留风险。

- [x] **Step 5: 收尾**

计划文档勾选回写、记忆更新（`bge-m3-pm2-procurement-shared` 与 `ocr-service-pm2-managed-hangs` 改托管现状、MEMORY.md 钩子同步）、向用户汇报验收结果与未推送提交数（不主动 push）。
