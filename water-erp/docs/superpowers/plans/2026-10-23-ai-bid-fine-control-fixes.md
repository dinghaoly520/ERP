# AI 辅助评标精细操作修复批 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 补齐 :3007 AI 辅助评标卡片的补救操作（单家重试、停摆豁免、文案纠偏），清理 dev 链退役残留，并删除两个 SUBMIT 僵尸演示项目。

**Architecture:** 四项独立修复——后端 `rerunAiAnalysis` F15 闸加「可证停摆」豁免（复用 F14 `probeWorkerIdle` 队列探测）；前端 `ai-analysis-card.tsx` 加单家重试 chips 选择与停摆文案；根 `package.json` dev 链摘除 `dev:ukey-mw-guard`；金仓 SQL 删两条僵尸项目（27 子表级联 + PMI/公告软链手工处理）。不改 worker、不改 API 契约（`retryAiBidders(projectId, bidderResultIds?)` 前端 client 与 DTO 均已支持单家，仅卡片未接线）。

**Tech Stack:** NestJS 11 + Prisma（金仓 54321）/ Next.js 16 + React 19（bid-portal，无 jest，验证走 tsc）/ jest（api 单测）

**Spec:** 本对话 2026-10-23 分析报告（开评标现场问题分析）+ 用户四项裁定。无独立 spec 文档，本计划自含全部决策。

> **2026-10-28 对照实际代码复核更新**（四项修复均未实施，前提仍成立；以下为漂移修正）：
> ① 停摆豁免编号 F16→**F19**——F16 已被「评标延期单次上限 720h 封顶」（2026-08-28，spec:5523）占用，F14–F18 全在用。
> ② 行号漂移：`rerunAiAnalysis` 2400→**2424**、F15 块→**2458**、spec harness `getAiAnalysisProgress` describe 3258→**3290**；F15 块内容与卡片文案逐字未变（bid.service.ts 近 5 天改动为留痕串码/婉拒除名，不涉本批）。
> ③ 金仓现多一个同款等待态 `SWHI-YQ-2026102602`（SUBMIT、ANALYZING、0 家、10-26）——**不在删除授权内**，T4 dry-run 顺带报告即可。
> ④ 工作区有并行会话未提交文件（`scripts/db-migrate-kingbase.sh` 改动 + 未跟踪 `Dockerfile`/`backend/`/`docker-compose.frontend.yml`，生产部署线）——本批只 add 自有文件，勿动勿收。
> ⑤ dev 链现为健康单树（concurrently+watch+worker 全活，10 端口齐）；T1 改 package.json 对运行中树无影响，下次 `pnpm dev` 生效。

## Global Constraints

- 报错/界面文案一律中文；既有错误码风格 `UPPER_SNAKE`（如 `TASK_IN_PROGRESS`）。
- main 分支 lint 不可用：前端验证 = `npx tsc --noEmit`（apps/bid-portal 下）。
- api 单测：`pnpm --filter api test -- bid.service.spec`（jest + ts-jest；新依赖 ESM 才需动 allowlist，本批零新依赖）。
- UI 改动遵循 cgzxui 设计体系（实现 Task 3 前先调 cgzxui skill；复用卡片内既有 `neu-btn-xs` 尺度）。
- 卡停阈值 30 分钟 = `AI_STUCK_THRESHOLD_MS`（bid.service.ts:66），前端镜像常量须带同步注释（卡片 :184 已有同款惯例）。
- 多会话共库：commit 前必查分支与 `git status`；**禁 `git add -A`**，只 add 本任务文件。2026-10-28 现状：工作区有生产部署线的未提交改动（`M scripts/db-migrate-kingbase.sh` + 未跟踪 `Dockerfile`/`backend/`/`docker-compose.frontend.yml`/`.dockerignore`）——勿动勿收。
- 不主动 push（memory 裁定）；commit message 末尾 `Co-Authored-By: Claude Code <noreply@anthropic.com>`。
- dev 链在跑（API watch 14:42 链）：改 `bid.service.ts` 触发 watch 自动重载即可，**勿 pnpm dev:kill 重启全链**（会打断演示环境）；若 watch 半死（tsc 重编译但接口不重启）再按 memory 处置。
- 金仓操作配方：`docker exec kingbase-pg-kingbase-1 ksql "host=127.0.0.1 port=54321 user=system password=<.env DATABASE_URL 口令> dbname=water_erp" -c "…"`（宿主机无 psql；口令从 URL `postgresql://system:…@` 段提取）。

## Review Focus

1. **rerun 豁免被当作频控旁路连点**——全部 PENDING + 队列空转时连点两次 rerun：第二次因 task 复位 PENDING 且 tender job 已入队、probe 探得 waiting>0/active>0 而仍被 F15 挡；即使竞态穿透，F7 remove-first + 认领守卫兜底。→ Task 2 测试 4 锁「worker 忙时仍 409」。
2. **chips 选择态被 3s 轮询冲掉**——retryable 集合签名变化时须重置选择，否则选中 id 指向已失效行（后端 `ids` 过滤后可能空 → 400 `NO_RETRYABLE_BIDDERS`）。→ Task 3 以 ids-join 签名 useEffect 重置。
3. **0 家停摆文案在非评标阶段误报**——公告发布即建 task（A-87），SUBMIT 前的 ANALYZING+0 家是合法等待态，不得显示停摆警告。→ Task 3 文案与按钮均以 `stage==='EVALUATING'` 门控（与既有 `actionsEnabled` 同口径）。
4. **probeWorkerIdle 异常时的语义**——队列探测 throw 时返回 false（保守 → 仍 409），不得把「探测失败」当「无人消费」放行。→ Task 2 沿用 probe 现有 catch-false，测试 5 显式锁。
5. **僵尸项目删除遇真实评审痕迹**——dry-run 发现 `BidScoreRecord`/`BidEvaluationResult`/`BidSignPacket` 任一 >0 即中止并报告（本应零产出；有则说明项目被用过，需用户再确认）。→ Task 4 Guard 步。

---

### Task 1: dev 链摘除 dev:ukey-mw-guard

**Files:**
- Modify: `water-erp/package.json:8`（dev 脚本）
- Modify: `/home/asus/桌面/ERP/CLAUDE.md:193-195`（Mock U盾中间件注释块）

**Interfaces:**
- Produces: `pnpm dev` 启动 11 命令（10 portal + ai-worker），不再拉起 :17999。`dev:ukey-mw*` 三个脚本本体保留（退役但保留命令，口径不变）。

- [ ] **Step 1: 改 package.json dev 脚本**

`concurrently -n` 名单去掉 `ukey-mw`、`-c` 色表去掉 `#41b883`、命令串去掉 `\"pnpm dev:ukey-mw-guard\"`。三处列表长度须一致（11 名/11 色/11 命令）。`pnpm dev:kill &&` 前缀保持不动。

- [ ] **Step 2: 改 CLAUDE.md 对应注释**

「Development Commands」区 Mock U盾 注释块两行 `# pnpm dev:ukey-mw` / `# pnpm dev:ukey-mw-guard` 下补一行：`# （2026-10-23 已从 pnpm dev 链移除 guard——dev 不再复活 :17999）`。

- [ ] **Step 3: 验证**

Run: `cd water-erp && node -e "const d=JSON.parse(require('fs').readFileSync('package.json')).scripts.dev; const n=d.match(/-n (\S+)/)[1].split(',').length, c=d.match(/-c (\S+)/)[1].split(',').length, q=(d.match(/\"pnpm dev:(?!kill)[a-z-]+\"/g)||[]).length; console.log(n,c,q); if(n!==c||n!==q)process.exit(1)"`
Expected: `11 11 11`，退出码 0。

- [ ] **Step 4: Commit**

```bash
git add water-erp/package.json CLAUDE.md
git commit -m "chore(dev): dev 链摘除 dev:ukey-mw-guard——退役中间件不再随 pnpm dev 复活 :17999"
```

（CLAUDE.md 在仓库根 `git add CLAUDE.md`；提交前 `git branch --show-current` 确认 main。）

---

### Task 2: rerunAiAnalysis F15「可证停摆」豁免（后端，编号 F19）

**Files:**
- Modify: `water-erp/apps/api/src/bid/bid.service.ts`（rerunAiAnalysis 的 F15 块，~2458 行起；函数入口 2424）
- Test: `water-erp/apps/api/src/bid/bid.service.spec.ts`（**3290** 行 `getAiAnalysisProgress` describe 之后新增 describe）

**Interfaces:**
- Consumes: 既有 `private async probeWorkerIdle(taskStatus, taskId, firstBidderResultId)`（bid.service.ts，F14）；`AiBidderResult.status` 枚举。
- Produces: `rerunAiAnalysis` 行为变更（无签名变更）——F15 闸在「全部 bidder PENDING（含 0 家）且队列探测确认无人消费」时放行全量重跑；其余在途态仍 409 `TASK_IN_PROGRESS`。Task 3 的「重新分析」按钮依赖此放行。

**决策依据（F19 豁免为何安全；编号避让：F16=延期 720h 封顶、F17=同阶段早退、F18 已用）**：F15 防的是铲掉在途分析；全 PENDING（或 0 家）+ probe 确认无 active 消费 = 无在途可铲，且 rerun 自带 F7 remove-first 与认领守卫（bid.service.ts 注释在案）。probe 对队列异常 catch 返 false（保守 409）。0 家时 `every` 空集为真、probe 走 tender/bidder 队列 counts 判定，`firstBidderResultId` 传 `''`（ANALYZING 分支才会用到它，0 家时 bidderQueue 探测 counts 已足）。

- [ ] **Step 1: 写失败测试**

在 `bid.service.spec.ts` 的 `getAiAnalysisProgress` describe（3290 行）之后新增 `describe('BidService — rerunAiAnalysis F15/F19 停摆豁免', ...)`，复用其 TestingModule mock（prisma + tenderQueue/bidderQueue mock，参照 F14 用例的 `getJobCounts` mock 法）。用例：

1. `在途保护：ANALYZING 且有 bidder PROCESSING → 409 TASK_IN_PROGRESS`（豁免不放宽——非全 PENDING 直接 throw，不 probe）
2. `F19 放行：ANALYZING 全 PENDING + 队列 active=0/waiting=1 → 走完清空+重建+入队，返回 taskId`（断言 `aiBidderResult.deleteMany`、task update PENDING、`tenderQueue.add` 被调）
3. `F19 放行（0 家）：ANALYZING 且 bidderResults 空 + bidder 队列 active=0/waiting=0/getJob undefined → 放行，且按 decryptStatus SUCCESS 供应商 createMany 重建`
4. `worker 忙（active>0）→ 仍 409 TASK_IN_PROGRESS`
5. `probe 抛异常（getJobCounts reject）→ 保守 409`

- [ ] **Step 2: 跑测试确认红**

Run: `cd water-erp && pnpm --filter api test -- bid.service.spec`
Expected: 用例 2/3/5 FAIL（当前无条件 409），用例 1/4 PASS。

- [ ] **Step 3: 实现**

F15 块内：throw 前先查 `aiBidderResult.findMany({ where: { taskId }, select: { id, status } })`；`const provablyIdle = rows.every(r => r.status === 'PENDING') && await this.probeWorkerIdle(task.status, task.id, rows[0]?.id ?? '')`；`if (!provablyIdle) throw …409…`，否则落注释 `// F19（2026-10-23）：全 PENDING（含 0 家）且队列探测确认无人消费=可证停摆，放行重跑；probe 异常保守 409` 后继续原流程。注意：本次查询放在 F15 块内（task 命中分支），不扰动 N8 补建路径。

- [ ] **Step 4: 跑测试确认绿**

Run: `cd water-erp && pnpm --filter api test -- bid.service.spec`
Expected: 全部 PASS（含既有用例无回归）。

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/bid/bid.service.ts apps/api/src/bid/bid.service.spec.ts
```
（在 `water-erp/` 下 add；message: `fix(bid): rerunAiAnalysis F15 停摆豁免——全 PENDING/0 家且队列探测无消费时放行重跑（F19）+5 用例`）

---

### Task 3: AI 卡片单家重试 chips + 文案纠偏 + 0 家停摆态（前端）

**Files:**
- Modify: `water-erp/apps/bid-portal/src/components/workspace/ai-analysis-card.tsx`
- Modify: `water-erp/apps/bid-portal/src/lib/api/bid.ts`（零改动——仅确认契约；本文件不动）

**Interfaces:**
- Consumes: Task 2 的 F19 放行语义（「重新分析」按钮在 worker 恢复后可点通）；既有 `retryAiBidders(projectId, bidderResultIds?)`；`AiAnalysisProgress.bidders: { id, name, status, updatedAt }[]`。
- Produces: 卡片新交互（无对外接口变更）。

- [ ] **Step 1: 调 cgzxui skill 定 chips 视觉**

chips = 可切换 pill（选中=品牌蓝 accent、未选中=muted），尺寸对齐既有 `neu-btn-xs`（11px 文案），`aria-pressed` 标记。实现前调 Skill(cgzxui) 校准类名。

- [ ] **Step 2: 实现三组改动**

同一文件三处，顺序提交一次：

1. **单家重试 chips**：`retryable = bidders.filter(b => b.status === 'FAILED' || (b.status !== 'PENDING' && b.status !== 'COMPLETED' && Date.now() - new Date(b.updatedAt).getTime() > STUCK_MS))`（`STUCK_MS = 30*60*1000`，注释「与后端 AI_STUCK_THRESHOLD_MS 同口径，改动须双向同步」）。failed/stuck 文案行下渲染 chips（标签 `${name}·失败`/`${name}·卡住`），选中集默认全选；`useEffect` 以 `retryable.map(r=>r.id).join()` 签名变化时重置。按钮文案 `重试所选（N/M 家）`，N=0 禁用；点击 `retryAiBidders(projectId, [...selected])`，toast 沿用。
2. **文案纠偏（用户裁定）**：workerIdle 行改为「AI 分析服务暂未响应——请联系系统管理员重启分析服务；服务恢复后请点击重试」；allPending 行改为「分析尚未启动——请联系系统管理员确认 AI 分析服务已就绪；服务恢复后请点击重新分析」（删「自动继续/自动开始」误导表述）。
3. **0 家停摆态**：`zeroStalled = stage==='EVALUATING' && taskStatus==='ANALYZING' && total===0 && updatedAt 距今 > STUCK_MS` → 状态文案「招标文件已解析完成，但暂无可分析的投标记录（0 家）——请确认开标解密是否完成；确认无误后可点击重新分析重建，若无有效投标请走流标流程」；并入 `showRerun` 条件；轮询控制把它当非进行中（降频 `POLL_SLOW_MS`，不停止——状态可能变化）。非 EVALUATING 阶段不显示（合法等待态）。

- [ ] **Step 3: 验证**

Run: `cd water-erp/apps/bid-portal && npx tsc --noEmit`
Expected: 0 error。

- [ ] **Step 4: 浏览器抽查（可选但推荐）**

:3007 任一 EVALUATING 且有失败家的项目卡：chips 可切换、按钮计数联动、重试 toast 家数=所选。无现成失败数据则只目检文案与布局。

- [ ] **Step 5: Commit**

```bash
git add apps/bid-portal/src/components/workspace/ai-analysis-card.tsx
git commit -m "fix(bid-portal): AI 卡片单家重试选择 chips + worker 停摆文案纠偏 + 0 家停摆态可见化"
```

---

### Task 4: 删除两个 SUBMIT 僵尸项目（金仓 SQL，无代码提交）

**Files:** 无代码文件。操作对象：金仓 `water_erp` 库 + Redis 6380。

**Interfaces:**
- Consumes: 事实——项目 id `cmvkers4s052buuqc8vlcyh1t`（DMGY-YQ-2026102304）、`cmvghjf3z03t0uuf59j11calf`（DMGY-YQ-2026102009）；PMI id `cmvkejg6g04qhuuqcdk591fzj`、`cmvghezrp03l9uuf5jmg8m72z`（`BidProject.projectManagementItemId` 软列）；`Announcement.relatedProjectCode` 字符串软链；27 张子表对 BidProject 全 Cascade、`ProcurementProject` SetNull（当前 0 行）。**范围外顺带报告**（2026-10-28 复核）：`SWHI-YQ-2026102602`（SUBMIT、ANALYZING、0 家）为同款等待态，不属本授权，dry-run 时打印其状态供用户决断。
- Produces: 两项目连同子表/PMI/关联公告物理删除；:3007 板与 :3005 列表不再出现。

- [ ] **Step 1: dry-run 全量计数（执行时现查，不沿用 10-23 数字——期间 DB 有写入）**

ksql 一把查出：两项目在各子表的行数（重点 `BidSupplier`/`BidExpert`/`SupplierBidSubmission`/`BidScoreItem`/**`BidScoreRecord`**/**`BidEvaluationResult`**/**`BidSignPacket`**/`BidOpeningSession`/`BidOpeningRecord`/`ai_bid_analysis_tasks`）、`Announcement WHERE relatedProjectCode IN (两编号)` 行、`Announcement` 的 FK 子表清单（`pg_constraint` 查 confrelid='Announcement'，防删除被 restrict 拦）、Redis `EXISTS negotiation-config:{两id}`；顺带打印 `SWHI-YQ-2026102602` 的同款状态行（范围外，仅报告）。

- [ ] **Step 2: Guard——异常即中止**

`BidScoreRecord`/`BidEvaluationResult`/`BidSignPacket` 任一 >0 → **中止，报告用户再确认**（说明项目有真实评审痕迹，与本批「零产出僵尸」前提冲突）。计数符合预期（仅 supplier/expert/submission/AI task）→ 继续。

- [ ] **Step 3: 事务删除**

```
BEGIN;
DELETE FROM "Announcement" WHERE "relatedProjectCode" IN ('DMGY-YQ-2026102304','DMGY-YQ-2026102009');  -- dry-run 有行才执行；有 restrict 子表则先删子表
DELETE FROM "ProjectManagementItem" WHERE id IN ('cmvkejg6g04qhuuqcdk591fzj','cmvghezrp03l9uuf5jmg8m72z');
DELETE FROM "BidProject" WHERE id IN ('cmvkers4s052buuqc8vlcyh1t','cmvghjf3z03t0uuf59j11calf');  -- 27 子表级联
COMMIT;
```
Redis：`DEL negotiation-config:{id}`（EXISTS=1 才删）。已知残留（有意保留）：FileAsset 行与 MinIO 对象（`bid_inner_ciphertext`/`bid_decrypted`/`bid_document` 三类目删除硬保护；无列表入口，无害）；OperationLog/AuditLog（法定留存）。

- [ ] **Step 4: 验证**

ksql 复查四表计数=0（BidProject/PMI/Announcement by code/ai_bid_analysis_tasks by projectId）；`curl --noproxy '*' -H 'X-Portal: bid'` 带 bid 会话查 `GET /api/bid/projects/dashboard`（或浏览器 :3007 `/bid`）确认两编号不在「开标中/评标中/归档端」任一分区。

---

## 执行顺序与依赖

Task 1 独立；Task 2 → Task 3（前端「重新分析」按钮的可用性依赖 F19 放行）；Task 4 独立（建议最后做，避免与代码验证互相干扰）。全程不动运行中的 dev 链（Task 2 改动靠 API watch 热重载生效）。
