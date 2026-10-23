# 开标现场异常触达（暂停/上报→创建人通知）+ OPENING 流标窗口放行 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 暂停开标与监督上报时通知 PMI 创建人（:3005 站内+WS 弹窗）；:3005 流标按钮对 OPENING 恒放行、前窗去下界。

**Architecture:** 复用 2026-10-09 串号修复的通知管线——`resolveProjectCreatorId`（宁可不发不回退）+ `renderNotificationPayload`（registry 模板）+ `NotificationService.sendToUser(['in_app'])`。注册表加两条 bid 域通知；前端只改一处窗口判定。

**Tech Stack:** NestJS 11 + Prisma（apps/api）、@water-erp/shared（注册表+常量，改后须 build dist）、Next.js（apps/web）。

**Spec:** `docs/superpowers/specs/2026-10-23-opening-anomaly-escalation-design.md`（已定稿，含 2026-10-23 用户裁定 A=仅创建人）

## Global Constraints

- 收件人**仅 PMI 创建人**：`resolveProjectCreatorId`，解析失败（无宿主 PMI/创建人停用）**宁可不发、不回退任何角色**（2026-10-09 裁定，spec §4.2）
- 通道仅 `['in_app']`；`actionable: false`（防永滞待办，spec §5#6）
- BID_ANOMALY_ESCALATED 仅**迁移至** escalated 时发（旧值非 escalated），防重复 upsert 刷屏（spec §5#3）
- 通知发送失败**不阻塞**主流程（try/catch + logger.warn，同 completeOpening 惯例 bid.service.ts:1194-1197）
- 文案中文；registry 条目必须带 `render` + `link`（走 `renderNotificationPayload`）
- **shared 改后必须 `pnpm --filter @water-erp/shared build`**（dist 消费）；前端验证用 `tsc --noEmit`（main 上 lint 不可用）
- **并行会话 git 约定**：禁 `git add -A`；`bid.service.ts`/`notification-registry.ts` 为共享高危文件，提交前 `git status` 核对只含本任务文件，混入他人 hunk 时外科手术暂存（git apply --cached 只取自己的 hunk）
- 本计划**无 schema 变更**（不需要 prisma migrate/validate）

## Review Focus

1. **无宿主 PMI**（`projectManagementItemId` null，公告直建等）→ 不发送、暂停仍成功——Task 2 测试 `projectManagementItemId null 不发送`；Task 3 同口径
2. **创建人停用**（`createdBy.isActive=false`）→ 不发送（宁可不发）——Task 2 测试断言 sendToUser 零调用
3. **通知失败不阻塞**（sendToUser reject）→ pauseOpening 正常返回 `{paused:true}`——Task 2 测试
4. **重复上报刷屏**（旧 status=escalated 再 upsert）→ 不重发——Task 3 测试
5. **开标过点仍 SUBMIT 的滞留项目**（diff<0）→ 流标按钮可用——Task 4 逻辑（无组件测试基建，浏览器验收步骤覆盖）

---

### Task 1: 注册表新增两条 bid 域通知

**Files:**
- Modify: `packages/shared/src/notification-registry.ts`（bid 域，置于 `BID_OPENING_HANDED_OVER` 条目后，样式对齐 :149-171）

**Interfaces:**
- Produces（Task 2/3 消费）：类型码 `BID_OPENING_PAUSED`、`BID_ANOMALY_ESCALATED`；render ctx 字段 `{ projectName: string; reason?: string; supplierName?: string; notes?: string; projectManagementItemId?: string | null }`；link 同 HANDED_OVER 模式（`ctx.projectManagementItemId ? LINKS.mgmtBidConfirm(String(ctx.projectManagementItemId)) : LINKS.mgmtProjects()`）

- [ ] **Step 1: 写入两条注册表条目**

两条均为：`domain: 'bid'`、`actionable: false`、`audiences: [{ kind: 'PROJECT_CREATOR' }]`、`channels: IN_APP`。
- `BID_OPENING_PAUSED`：label `开标暂停告警`，icon `PauseCircle`，tone `orange`；render：title `项目${ctx.projectName}开标已暂停`，content = `${ctx.reason ? `暂停原因：${ctx.reason}。` : ''}解密窗口已冻结，请关注现场处置，必要时在开标确认面板决策流标`（含注释：2026-10-23 突发触达，spec 链接）
- `BID_ANOMALY_ESCALATED`：label `现场异常上报`，icon `ShieldAlert`，tone `red`；render：title `项目${ctx.projectName}监督上报异常：${ctx.supplierName ?? ''}`，content = `供应商${ctx.supplierName}被标记为已上报异常${ctx.notes ? `，批注：${ctx.notes}` : ''}，请核验监督视图与开标现场记录`（**注：本行文案已被终审修复批更新，现行文案以 spec §4.2 为准**）

- [ ] **Step 2: 构建 shared dist 并验证类型**

Run: `pnpm --filter @water-erp/shared build`
Expected: 构建成功，`dist/notification-registry.d.ts` 含两个新类型码

- [ ] **Step 3: Commit**

```bash
git add packages/shared/src/notification-registry.ts
git commit -m "feat(shared): 注册 BID_OPENING_PAUSED/BID_ANOMALY_ESCALATED 通知类型（开标现场异常触达）"
```

### Task 2: pauseOpening 通知 PMI 创建人

**Files:**
- Modify: `apps/api/src/bid/bid.service.ts:2822-2853`（pauseOpening）
- Test: `apps/api/src/bid/bid.service.spec.ts`（既有 TestBed，NotificationService 已 mock 于 :185）

**Interfaces:**
- Consumes: Task 1 的 `BID_OPENING_PAUSED` + `renderNotificationPayload`（签名见 registry :585-593）、`resolveProjectCreatorId(prisma, projectManagementItemId)`（bid-project-notify.util.ts:17，现已被本文件 import——先确认，未 import 则补）
- Produces: pauseOpening 行为不变 + 成功路径发通知；select 增列 `projectManagementItemId`

- [ ] **Step 1: 写失败测试（追加到 pauseOpening 相关 describe，或新建 describe `'暂停开标通知'`）**

三条用例，全部走 service 直调 + mocked prisma/notificationService（仿 :894-941 既有通知用例的取用方式 `(service as any).notificationService`）：
- `暂停成功且宿主PMI创建人有效 → 通知创建人`：prisma mock 令 `bidProject.findUnique` 返回 `{stage:'OPENING', name:'测试项目', projectManagementItemId:'pmi-1'}`、`bidOpeningSession.findUnique` 返回未暂停会话、`projectManagementItem.findUnique` 返回 `{createdById:'u-1', createdBy:{isActive:true}}`；断言 `sendToUser` 以 `('u-1', ['in_app'], expect.objectContaining({ type: 'BID_OPENING_PAUSED' }))` 调用一次，且返回值仍为 `{paused:true}`
- `projectManagementItemId 为 null → 不发送`：断言 `sendToUser` 零调用、返回 `{paused:true}`
- `通知发送失败 → 暂停仍成功`：`sendToUser` mock reject；断言不抛错、返回 `{paused:true}`（可另断言 logger.warn 被调，可选）

- [ ] **Step 2: 跑测试确认失败**

Run: `cd apps/api && npx jest src/bid/bid.service.spec.ts -t "暂停"`
Expected: 第一条 FAIL（sendToUser 未被调用）

- [ ] **Step 3: 实现**

`pauseOpening` 的项目 select 增 `projectManagementItemId: true`；在 `gateway?.notifySupervisionLog(...)`（:2852）之后、`return` 之前插通知块：`resolveProjectCreatorId` → 非空则 `renderNotificationPayload('BID_OPENING_PAUSED', { projectName, reason, projectManagementItemId: project.projectManagementItemId ?? undefined })`（**ctx 索引签名不收 null**，`?? undefined` 同 HANDED_OVER 调用点 :1190 先例）→ 非空则 `sendToUser`，整体 try/catch（catch 仅 `this.logger.warn`，文案含 projectId，同 :1196 惯例）。`resolveProjectCreatorId` 与 `renderNotificationPayload` 均已在文件头 import（bid.service.ts:3/:35，零新增 import）。

- [ ] **Step 4: 跑测试确认通过**

Run: `cd apps/api && npx jest src/bid/bid.service.spec.ts -t "暂停"`
Expected: 全 PASS

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/bid/bid.service.ts apps/api/src/bid/bid.service.spec.ts
git commit -m "feat(bid): 暂停开标通知 PMI 创建人（宁可不发不回退，失败不阻塞）"
```

### Task 3: 监督上报迁移至 escalated 时通知创建人

**Files:**
- Modify: `apps/api/src/bid/bid.service.ts:5633-5656`（upsertSupervisionAnnotation）
- Modify: `apps/api/src/bid/bid.controller.ts:1017-1020`（POST supervision-annotations 补 AssignedHostGuard，见 Step 3）
- Test: `apps/api/src/bid/bid.service.spec.ts`

**Interfaces:**
- Consumes: 同 Task 2（`BID_ANOMALY_ESCALATED`、`resolveProjectCreatorId`、`renderNotificationPayload`）
- Produces: upsert 行为不变 + 迁移时发通知

- [ ] **Step 1: 写失败测试（describe `'监督上报通知'`）**

**先扩 prisma mock**（评审发现 1）：TestBed 的 prisma mock（bid.service.spec.ts:113-165）现无 `bidSupervisionAnnotation` 模型，先增 `bidSupervisionAnnotation: { findUnique: jest.fn(), upsert: jest.fn() }`——否则红阶段失败原因是 TypeError 而非断言失败。

三条用例：
- `null→escalated → 发送`：mock `bidSupplier.findFirst` 命中、`bidSupervisionAnnotation.findUnique` 返回 null（或 status:'flagged'）、`bidProject.findUnique` 返回 `{name:'测试项目', projectManagementItemId:'pmi-1'}`、`projectManagementItem.findUnique` 有效创建人；断言 `sendToUser` 一次、type=`BID_ANOMALY_ESCALATED`、upsert 照常执行（返回值不变）
- `escalated→escalated（重复保存/改注）→ 不发送`：`findUnique` 返回 `{status:'escalated'}`；断言 `sendToUser` 零调用
- `创建人停用 → 不发送`：`createdBy.isActive=false`；断言零调用

- [ ] **Step 2: 跑测试确认失败**

Run: `cd apps/api && npx jest src/bid/bid.service.spec.ts -t "监督上报"`
Expected: 第一条 FAIL

- [ ] **Step 3: 实现**

`upsertSupervisionAnnotation` 内：归属校验后按 `supplierId` `findUnique(bidSupervisionAnnotation)` 取旧 status；**供应商名直接读 `bidSupplier.supplierName`**（归属校验的 findFirst 无 select、全列返回，评审发现 3——勿改它的 select）；补查项目（`bidProject.findUnique` select `{name, projectManagementItemId}`，项目不存在则跳过通知）；upsert 成功后当 `dto.status === 'escalated' && old?.status !== 'escalated'` 时发通知（render ctx：`{projectName, supplierName: bidSupplier.supplierName, notes: dto.notes, projectManagementItemId: project.projectManagementItemId ?? undefined}`——null 语义同 Task 2），try/catch+warn 同 Task 2。

**同任务顺带（评审发现 2）**：`bid.controller.ts:1017-1020` 的 `POST projects/:id/supervision-annotations` 补 `@UseGuards(AssignedHostGuard)`（import 已在 :529 pause 用例存在）——该端点现状=类级四角色、无指派闸，通知功能会把它放大为跨公司触达向量；与 pause 端点（:527-530 四角色+AssignedHostGuard）对齐，且 :3007 读侧本就只允许被指派主持人/admin 进入（getProject L6 隔离 :542），UI 无感知。GET/DELETE 两端点维持现状（未被本功能放大，spec §5 留痕）。

- [ ] **Step 4: 跑测试确认通过**

Run: `cd apps/api && npx jest src/bid/bid.service.spec.ts -t "监督上报"`
Expected: 全 PASS

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/bid/bid.service.ts apps/api/src/bid/bid.service.spec.ts apps/api/src/bid/bid.controller.ts
git commit -m "feat(bid): 监督上报迁移至 escalated 时通知创建人（重复不重发）；POST 端点补 AssignedHostGuard"
```

### Task 4: :3005 流标按钮窗口放行 + AFTER 常量退役

**Files:**
- Modify: `apps/web/src/components/projects/bid-confirm-panel.tsx:25,141-145,1336-1341`（import、isWithinAbortWindow、按钮条件与 title）
- Modify: `packages/shared/src/constants.ts:182`（删除 `BID_ABORT_WINDOW_AFTER_OPENING_MS`）

**Interfaces:**
- Consumes: 无新接口
- Produces: 流标按钮可用性新口径（OPENING 恒放行；DOWNLOAD/SUBMIT `diff <= 24h` 无下界）

- [ ] **Step 1: 修改 `isWithinAbortWindow` 与按钮条件**

`isWithinAbortWindow`（:141-145）改为仅 `diff <= BID_ABORT_WINDOW_BEFORE_OPENING_MS`（删 `diff >= -BID_ABORT_WINDOW_AFTER_OPENING_MS` 下界，函数更名与否跟随局部语义——保持现名即可，注释更新：无下界=开标过点滞留项目保持可流标）。按钮 disabled（:1336 区域）改为：`stage === 'OPENING' ? busy : (!isWithinAbortWindow || busy)`；title 分支同步（OPENING 态不显示 24h 提示）。import 行去掉 `BID_ABORT_WINDOW_AFTER_OPENING_MS`。**同步更新两处旧窗口契约注释（评审发现 4）**：`constants.ts:179-180` 的 doc comment（删「至开标后 48 小时」表述）与 `bid-confirm-panel.tsx:121` 的「仅开标前 24h 内可点击」注释。

- [ ] **Step 2: 删除退役常量并重建 shared**

`constants.ts:182` 删除（全库消费点仅 Task 本处，已核实）；Run: `pnpm --filter @water-erp/shared build`，Expected: 成功。

- [ ] **Step 3: 类型检查**

Run: `cd apps/web && npx tsc --noEmit`
Expected: 0 错误（若 dist 陈旧报错，先确认 Step 2 已跑）

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/projects/bid-confirm-panel.tsx packages/shared/src/constants.ts
git commit -m "fix(web): OPENING 流标按钮恒放行+前窗无下界；退役 BID_ABORT_WINDOW_AFTER_OPENING_MS"
```

### Task 5: 回归与浏览器验收

**Files:** 无新改动（验证任务；发现问题时回上游任务修）

- [ ] **Step 1: API 单测全量**

Run: `cd apps/api && npx jest --testPathPattern src/ 2>&1 | tail -5`
Expected: 全绿（对照 main 既有基线，若有既有红先确认非本计划引入）

- [ ] **Step 2: 浏览器验收（spec §6 清单）**

需 dev 环境在跑。用 :3007 admin（Swhi-CGZX-admin/...@2026）对测试项目（可用 2026年测试谈判采购004，先临时 DB 手术 stage=OPENING+会话未暂停+窗口未过期，**验收后还原**，金仓 ksql 配方见 memory）：
1. 暂停 → :3005 以该项目 PMI 创建人登录收到 WS 弹窗+通知列表条目，点开深链落项目详情开标确认面板、面板显示已暂停（若创建人非本机已知账号，用 DB 查 `ProjectManagementItem.createdById` 对应账号）
2. 监督视图对 DANGER 供应商点上报 → 同上触达；重复保存不重发（通知列表条目数不变）
3. openTime 改 72h 前（DB 手术）→ OPENING 流标按钮可点、AbortDialog 能打开（**不必走完流标**，打开即证；走完会改项目状态）
4. DB 还原（stage/窗口/handoverAt 原值——参照原值先存后改）

- [ ] **Step 3: 收尾提交（如有修复）与报告**

验收发现的问题回对应任务修复并补提交；报告逐条对照 spec §6 验收清单。
