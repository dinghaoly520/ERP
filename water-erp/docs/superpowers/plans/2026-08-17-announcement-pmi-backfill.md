# N16 方案 A：公告直建项目自动补建最小 PMI 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 公告发布联动创建 BidProject 时（`createFromAnnouncement` 路径）自动补建最小 ProjectManagementItem 并回填关联，使 :3005 开标确认面板（评分标准编制/主持人指派/按时开标/归档/公示全链）对公告直建项目可用——关闭 N16。

**Architecture:** 单任务后端改动。新增 `ProjectManagementService.createItemFromAnnouncement(tx, dto)`（复用本文件既有 `procurementMethodPrefix`(:62) 与 `PROJECT_WORKFLOW_STAGES`(:122 附近) 阶段集），由 `announcement.service.ts:288-300` 的 else 分支在既有 `$transaction` 语义下编排调用并回填 `bidProject.projectManagementItemId`。前端零改动（面板自动获得宿主）；`syncPmStage` 从 no-op 恢复正常联动。

**Tech Stack:** NestJS 11 + Prisma（既有模块，无新依赖）。

**Spec:** `water-erp/docs/投标至归档路线第三轮复核-边界专项-2026-08-16晚.md` §二 N16（需产品拍板项，已拍板方案 A，2026-08-17）；决策依据见会话记录（B 方案做全 ≥1.5 天且破坏分工 v3 双宿主）。

## Global Constraints

- 阶段状态规则（本计划裁定，实现不得偏离）：COMPLETED 集合 = 阶段列表中 key ∈ `{PROCUREMENT_DEMAND, INITIATION, TENDER_DOCUMENT, PUBLIC_ANNOUNCEMENT, SUPPLIER_INVITATION}` 的全部阶段（公告直建=前置链路以公告为准补记），`completedAt=now`；其余 NOT_STARTED；`currentStage='BID_EVALUATION'`；`currentRound=1`、`round=1`、`status=ACTIVE`。
- PMI 必填非空字段兜底：`procurementCategory='其他'`、`procurementOrganizationForm='—'`、`projectReason='（公告直建自动补齐 PMI——N16 A 方案）'`、`requesterName/RequesterDepartment` 从公告 `authorId` 解析（`user.displayName` + `user.department?.name ?? '采购中心'`）。
- 编号复用 :656 同款规则（`procurementMethodPrefix` + 当日序号），不得另造格式。
- 提交信息 `fix(...)` 中文主题；不主动 git push。
- **CLAUDE.md 编辑必须走 Bash**（ARS 守卫拦 Edit/Write，memory `edit-claude-via-bash`）。
- 已验证事实（勿重复排查）：`createFromAnnouncement`（`bid.service.ts:539`）现不写 PMI；`syncPmStage:1308` 注释自认 no-op；`REPROC_STAGE_SEGMENTS`(:123) 未导出（本计划不用它，用 `PROJECT_WORKFLOW_STAGES` 全套+方法过滤，与新建项目 :621+ 同源）；`User.departmentId` 可空关联 `Department`。

---

### Task 1: 公告直建自动补 PMI（后端 + 单测 + CLAUDE.md 口径）

**Files:**
- Modify: `apps/api/src/project-management/project-management.service.ts`（新增 `createItemFromAnnouncement`，约 :658 create 流程之后；复用 :62/:122 的既有常量与函数）
- Modify: `apps/api/src/project-management/project-management.service.spec.ts`（新用例）
- Modify: `apps/api/src/announcement/announcement.service.ts:288-300`（else 分支编排）
- Modify: `apps/api/src/announcement/announcement.service.spec.ts`（若无既有文件则新建）
- Modify: `CLAUDE.md`（Bash 追加一行口径，见 Step 7）

**Interfaces:**
- Produces: `createItemFromAnnouncement(tx: Prisma.TransactionClient, dto: { title: string; procurementMethod: string; budget: number | null; authorId: string | null }): Promise<{ id: string; projectCode: string }>` —— 供 announcement.service 编排层调用；阶段行、编号、状态规则全部内聚于此方法。
- Consumes: `bidService.createFromAnnouncement`（返回 project，`project.id` 用于回填）；`validateMetadata` 白名单（method/budget 可得）。

- [ ] **Step 1: 写失败单测（PM service 层）**

```ts
describe('N16-A 公告直建补 PMI', () => {
  it('createItemFromAnnouncement：生成 TP 型编号 + 全套阶段 + 前置阶段 COMPLETED + currentStage=BID_EVALUATION', async () => {
    const tx = makeTx(); // 沿用本 spec 既有 prisma mock 的 tx 形状；projectManagementItem.count -> 0
    const res = await service.createItemFromAnnouncement(tx, {
      title: '公告直建测试项目', procurementMethod: '竞价采购', budget: 900000, authorId: 'u-1',
    });
    expect(tx.projectManagementItem.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        title: '公告直建测试项目', procurementMethod: '竞价采购',
        currentStage: 'BID_EVALUATION', status: 'ACTIVE',
        requesterName: expect.any(String), requesterDepartment: expect.any(String),
      }),
    }));
    const stages = tx.projectManagementStage.createMany.mock.calls[0][0].data;
    const completed = new Set(stages.filter((s: any) => s.status === 'COMPLETED').map((s: any) => s.stageKey));
    expect(completed.has('PROCUREMENT_DEMAND')).toBe(true);
    expect(completed.has('TENDER_DOCUMENT')).toBe(true);
    expect(completed.has('PUBLIC_ANNOUNCEMENT')).toBe(true);
    expect(completed.has('EXPERT_SELECTION')).toBe(false);
    expect(stages.find((s: any) => s.stageKey === 'BID_EVALUATION').status).toBe('NOT_STARTED');
  });

  it('createItemFromAnnouncement：谈判采购（无 PUBLIC_ANNOUNCEMENT 段）SUPPLIER_INVITATION 记 COMPLETED', async () => {
    /* 同上前置，procurementMethod:'谈判采购'；断言 SUPPLIER_INVITATION ∈ completed 且 PUBLIC_ANNOUNCEMENT 不在阶段集 */
  });
});
```

- [ ] **Step 2: 跑测确认失败**

Run: `pnpm --filter api test -- project-management.service.spec.ts -t "N16-A"`
Expected: FAIL（方法不存在）。

- [ ] **Step 3: 实现 `createItemFromAnnouncement`**

要点（对照 :656 create 流程抄结构）：
1. 编号：`const projectCode = \`${procurementMethodPrefix(dto.procurementMethod)}-${ymd}${String(todayCount + 1).padStart(2, '0')}\``（count 用 `tx.projectManagementItem.count` 当日范围）。
2. requester 解析：`authorId` → `tx.user.findUnique({ where: { id }, select: { displayName: true, department: { select: { name: true } } } })`；空则 `'采购中心'`/`'采购中心'`。
3. 阶段集：取 `PROJECT_WORKFLOW_STAGES`（与新建项目同源全套；若该常量含方法过滤逻辑则按 procurementMethod 过滤，以 :621+ 现行为准）。
4. 状态规则按 Global Constraints 的 COMPLETED 集合；`stageOrder` 用数组下标。
5. `tx.projectManagementItem.create` + `tx.projectManagementStage.createMany`；返回 `{ id, projectCode }`。

- [ ] **Step 4: announcement.service 编排 + 失败单测（集成层）**

`announcement.service.ts:293` else 分支：把 `createFromAnnouncement` + `createItemFromAnnouncement` + `bidProject.update({ projectManagementItemId })` + 既有 `announcement.update(relatedProjectCode)` 包进一个 `this.prisma.$transaction`（BidDocument 挂钩 update 一并纳入）；`riskNote` 追加 `；PMI ${projectCode}`。

新用例（announcement spec）：发布无既有项目的 BID_NOTICE → PMI 建立、bidProject.projectManagementItemId 非空、relatedProjectCode 已写；**再发布同公告（existing 分支）不重复建 PMI**（`createItemFromAnnouncement` 仅在 else 分支被调，断言第二次调用次数 0）。

模块接线：确认 `announcement.module` 能拿到的 prisma 即可（方法在 PM service 上但经 tx 传入——announcement.service 需注入 `ProjectManagementService`，检查 `announcement.module imports` 是否已有 `ProjectManagementModule`，没有则加；若形成环（PM module 反向依赖 announcement），降级方案：把 `createItemFromAnnouncement` 改放 `bid.service`（bid 已被 announcement 引用，方法体内联 :62/:122 同款逻辑+引用注释）——二选一以无环为准，报告注明所选）。

- [ ] **Step 5: 跑全量**

Run: `pnpm --filter api test`
Expected: 全绿（基线 1239 + 新增 ≥3）。

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/project-management apps/api/src/announcement
git commit -m "fix(bid): 公告直建项目自动补建最小 PMI——:3005 面板全链恢复宿主（N16 方案 A）"
```

- [ ] **Step 7: CLAUDE.md 口径（Bash 追加，勿用 Edit/Write）**

```bash
cat >> /home/asus/桌面/ERP/CLAUDE.md << 'EOF'
- **公告直建项目（N16 A 方案，2026-08-17）**：信息发布中心独立发布 BID_NOTICE 且无既有项目时，联动创建 BidProject 的同时自动补建最小 PMI（前置阶段补记 COMPLETED、currentStage=BID_EVALUATION）并回填关联——:3005 开标确认面板对公告直建项目可用。
EOF
git add ../CLAUDE.md 2>/dev/null || git -C /home/asus/桌面/ERP add CLAUDE.md
git -C /home/asus/桌面/ERP commit -m "docs: N16 A 方案口径——公告直建自动补 PMI"
```

（提交工作目录：CLAUDE.md 在仓库根，water-erp 之外的提交用 `git -C /home/asus/桌面/ERP`。）

- [ ] **Step 8: 合并后人工验证（写入交付说明）**

信息发布中心发一条测试 BID_NOTICE（无关联项目）→ :3005 项目管理出现新 PMI（编号 TP-…）→ 开标确认面板可打开、评分标准可编制、供应商投标状态可见；后续按时开标后 PMI 阶段卡正常推进（syncPmStage 生效）。

---

## Self-Review 记录

- 覆盖：N16 报告原文 + 2026-08-17 拍板（A）。无遗漏面（存量迁移：dev 库已重灌无孤儿；生产无此历史路径，零迁移——已在拍板记录）。
- 接缝裁决：模块接线二选一（PM service 注入 vs 降级 bid.service 内联）以无循环依赖为准，两案接口签名不变（Step 4 已写明判据）。
- 类型一致：`createItemFromAnnouncement(tx, dto)` 返回形状在 Step 1/3/4 三处一致。
