# 开标后·评标启动前 未签到正选替换候补（方案 A）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 开标后（OPENING）、评标启动前、正选尚未签到时，:3005 开标确认面板仍可执行正选↔候补替换；评标启动（EVALUATING）后或该正选已签到即锁定。

**Architecture:** 后端 `swapExpertRole` 本就放行 OPENING（只拦 EVALUATING/ARCHIVED），本计划不动其阶段闸门，只补三道防守闸（方向/已签到/已婉拒）并把递补者 `invitationStatus` 落为 confirmed（保 `startEvaluation` 委员会校验不跌破）；前端把替换按钮的解冻界碑从 `stage=OPENING` 改为 `stage=EVALUATING 或 e.signedIn`，新增签到列与两段确认弹窗。无新端点、无 schema 迁移、无新依赖。

**Tech Stack:** NestJS 11 + Prisma（apps/api）；Next.js 16 + React 19 + Tailwind v4（apps/web）；jest（api 单测/e2e）。

**Spec:** `docs/superpowers/specs/2026-09-18-expert-identity-verification-design.md`（R5：2026-09-20 裁定「开标后不可替换」）。本计划实现其 **2026-09-23 修订口径**（用户拍板）：**开标后、评标启动前、未签到正选可替换**——修订本意是把锁死界碑从「按时开标」移到「评标启动/专家进场」，覆盖现场「开标 → 专家签到 → 评标」之间发现缺席的真实窗口。

## Global Constraints

- **并行会话协作（2026-08-26 约定）**：开工前先 `git status` 确认对方会话无未提交改动。**本计划动笔时（2026-09-23）工作区已有另一会话未提交改动，且覆盖 `apps/api/src/bid/bid.service.ts`、`apps/api/src/bid/bid.controller.ts`、`apps/api/src/expert/expert.service.ts` 等共享文件**——执行 Task 1 前必须等对方提交（或与对方协调）；提交时只 `git add` 自己明确改动的文件路径，**禁用 `git add -A` / `git add .`**；若共享文件仍脏，用 `git add -p` 只摘自己的 hunk。
- 提交信息末尾加 `Co-Authored-By: Claude Code <noreply@anthropic.com>`；**不主动 push**。
- 所有命令在 `water-erp/` 下执行。
- web 应用无 jest——前端验证 = `pnpm --filter web exec tsc --noEmit` + `pnpm --filter web lint` + 浏览器 QA（见各任务 QA 步）。
- 本次不加新路由（RolesGuard 默认拒绝不涉及）、不动 schema、不动 `@water-erp/client`/shared 包。
- 唱标金额单位铁律、双信封等不涉及；`swapExpertRole` 改动的监督日志留痕保持既有口径。

---

### Task 1: 后端 swapExpertRole 递补口径加固（TDD）

**Files:**
- Modify: `apps/api/src/bid/bid.service.ts`（`swapExpertRole`，约 5828-5899 行区域，以锚点文本为准）
- Test: `apps/api/src/bid/bid.service.spec.ts`（`describe('backlog C — swapExpertRole 阶段闸门…')`，约 4530-4570 行）

**Interfaces:**
- Consumes: 无新依赖；`findOpenEvaluationWindows`（`apps/api/src/bid/expert-room.util.ts`）沿用。
- Produces: `swapExpertRole(projectId, fromExpertId, toExpertId)` 签名不变，新增错误码：
  - `400 INVALID_SWAP_ROLES`（BadRequestException）——from 非正选或 to 非候补
  - `409 EXPERT_ALREADY_SIGNED_IN`（ConflictException）——被换正选已签到进场
  - `409 ALTERNATE_DECLINED`（ConflictException）——递补候补已婉拒
  - `400 ALTERNATE_CANNOT_LEAD`（BadRequestException）——换出组长且候补为采购人代表（P1-7）
  - 递补行（toExpert）更新数据含 `invitationStatus: 'confirmed'`；若被换正选是组长（isLead），组长标记同步转移到递补者（toExpert `isLead: true`、fromExpert `isLead: false`）——下游 Task 2/3 前端依赖这些错误码透出 toast、依赖组长转移保证评标链不因换人失去组长。

- [ ] **Step 1: 协调共享文件**

```bash
cd /home/asus/桌面/ERP/water-erp && git status --short
```
若 `apps/api/src/bid/bid.service.ts` 仍有他人未提交改动：等待其提交后再继续本任务（约定第 1 条）。`bid.service.spec.ts` 当前干净，可先写测试。

- [ ] **Step 2: 写失败测试**

在 `bid.service.spec.ts` 的 `backlog C` describe 中：先改 beforeEach 捕获事务参数，再把既有「DOWNLOAD 放行」用例的 mock 补全字段，最后追加 4 个新用例。

改 beforeEach（在 `let prisma: any;` 后加一行，并把 `$transaction` mock 改为捕获版）：

```ts
  let txArgs: any[] = [];
```

```ts
      $transaction: jest.fn().mockImplementation(async (ops: any) => {
        txArgs = Array.isArray(ops) ? ops : [];
        return Array.isArray(ops) ? Promise.all(ops) : ops(prisma);
      }),
```

替换既有「DOWNLOAD（评标前递补）→ 放行」用例（旧 mock `{ id: 'e1' }` 缺角色字段，新方向闸会误伤）：

```ts
  it('DOWNLOAD（评标前递补）→ 放行', async () => {
    prisma.bidProject.findUnique.mockResolvedValue({ stage: 'DOWNLOAD' });
    prisma.bidExpert.findFirst.mockImplementation(async ({ where }: any) =>
      where.id === 'e1'
        ? { id: 'e1', expertName: '甲', expertRole: '正选', signedIn: false, invitationStatus: 'confirmed', userId: 'u1' }
        : { id: 'e2', expertName: '乙', expertRole: '候补', signedIn: false, invitationStatus: 'pending', userId: 'u2' },
    );
    const res = await svc.swapExpertRole('p1', 'e1', 'e2');
    expect(res.success).toBe(true);
    expect(prisma.$transaction).toHaveBeenCalled();
  });
```

追加新用例（同 describe 内）：

```ts
  it('OPENING 且正选未签到 → 放行，且递补者 invitationStatus 落 confirmed（2026-09-23 口径）', async () => {
    prisma.bidProject.findUnique.mockResolvedValue({ stage: 'OPENING' });
    prisma.bidExpert.findFirst.mockImplementation(async ({ where }: any) =>
      where.id === 'e1'
        ? { id: 'e1', expertName: '甲', expertRole: '正选', signedIn: false, invitationStatus: 'confirmed', userId: 'u1' }
        : { id: 'e2', expertName: '乙', expertRole: '候补', signedIn: false, invitationStatus: 'pending', userId: 'u2' },
    );
    const res = await svc.swapExpertRole('p1', 'e1', 'e2');
    expect(res.success).toBe(true);
    const e2Update = txArgs.find((u: any) => u.where?.id === 'e2');
    expect(e2Update?.data).toMatchObject({ expertRole: '正选', invitationStatus: 'confirmed' });
  });

  it('OPENING 但正选已签到 → 409 EXPERT_ALREADY_SIGNED_IN 且零更新', async () => {
    prisma.bidProject.findUnique.mockResolvedValue({ stage: 'OPENING' });
    prisma.bidExpert.findFirst.mockImplementation(async ({ where }: any) =>
      where.id === 'e1'
        ? { id: 'e1', expertName: '甲', expertRole: '正选', signedIn: true, invitationStatus: 'confirmed', userId: 'u1' }
        : { id: 'e2', expertName: '乙', expertRole: '候补', signedIn: false, invitationStatus: 'pending', userId: 'u2' },
    );
    await expect(svc.swapExpertRole('p1', 'e1', 'e2'))
      .rejects.toMatchObject({ response: { code: 'EXPERT_ALREADY_SIGNED_IN' } });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('方向不匹配（from 非正选 / to 非候补）→ 400 INVALID_SWAP_ROLES', async () => {
    prisma.bidProject.findUnique.mockResolvedValue({ stage: 'SUBMIT' });
    prisma.bidExpert.findFirst.mockImplementation(async ({ where }: any) =>
      where.id === 'e1'
        ? { id: 'e1', expertName: '乙', expertRole: '候补', signedIn: false, invitationStatus: 'pending', userId: 'u2' }
        : { id: 'e2', expertName: '甲', expertRole: '正选', signedIn: false, invitationStatus: 'confirmed', userId: 'u1' },
    );
    await expect(svc.swapExpertRole('p1', 'e1', 'e2'))
      .rejects.toMatchObject({ response: { code: 'INVALID_SWAP_ROLES' } });
  });

  it('候补已婉拒 → 409 ALTERNATE_DECLINED', async () => {
    prisma.bidProject.findUnique.mockResolvedValue({ stage: 'SUBMIT' });
    prisma.bidExpert.findFirst.mockImplementation(async ({ where }: any) =>
      where.id === 'e1'
        ? { id: 'e1', expertName: '甲', expertRole: '正选', signedIn: false, invitationStatus: 'confirmed', userId: 'u1' }
        : { id: 'e2', expertName: '乙', expertRole: '候补', signedIn: false, invitationStatus: 'declined', userId: 'u2' },
    );
    await expect(svc.swapExpertRole('p1', 'e1', 'e2'))
      .rejects.toMatchObject({ response: { code: 'ALTERNATE_DECLINED' } });
  });

  it('换出组长 → 递补者接任组长（isLead 转移，防组长缺席死锁）', async () => {
    prisma.bidProject.findUnique.mockResolvedValue({ stage: 'OPENING' });
    prisma.bidExpert.findFirst.mockImplementation(async ({ where }: any) =>
      where.id === 'e1'
        ? { id: 'e1', expertName: '甲', expertRole: '正选', signedIn: false, invitationStatus: 'confirmed', isLead: true, isPurchaserRepresentative: false, userId: 'u1' }
        : { id: 'e2', expertName: '乙', expertRole: '候补', signedIn: false, invitationStatus: 'pending', isLead: false, isPurchaserRepresentative: false, userId: 'u2' },
    );
    const res = await svc.swapExpertRole('p1', 'e1', 'e2');
    expect(res.success).toBe(true);
    const e1Update = txArgs.find((u: any) => u.where?.id === 'e1');
    const e2Update = txArgs.find((u: any) => u.where?.id === 'e2');
    expect(e1Update?.data).toMatchObject({ expertRole: '候补', isLead: false });
    expect(e2Update?.data).toMatchObject({ expertRole: '正选', invitationStatus: 'confirmed', isLead: true });
  });

  it('换出组长但候补为采购人代表 → 400 ALTERNATE_CANNOT_LEAD（P1-7：采购人代表不得任组长）', async () => {
    prisma.bidProject.findUnique.mockResolvedValue({ stage: 'OPENING' });
    prisma.bidExpert.findFirst.mockImplementation(async ({ where }: any) =>
      where.id === 'e1'
        ? { id: 'e1', expertName: '甲', expertRole: '正选', signedIn: false, invitationStatus: 'confirmed', isLead: true, isPurchaserRepresentative: false, userId: 'u1' }
        : { id: 'e2', expertName: '乙', expertRole: '候补', signedIn: false, invitationStatus: 'pending', isLead: false, isPurchaserRepresentative: true, userId: 'u2' },
    );
    await expect(svc.swapExpertRole('p1', 'e1', 'e2'))
      .rejects.toMatchObject({ response: { code: 'ALTERNATE_CANNOT_LEAD' } });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
```

- [ ] **Step 3: 运行测试确认失败**

Run: `pnpm --filter api test -- bid.service.spec.ts -t "swapExpertRole"`
Expected: 新增 4 用例 FAIL（`INVALID_SWAP_ROLES` 等码不存在），既有「DOWNLOAD 放行」已随 mock 更新保持 PASS。

- [ ] **Step 4: 实现守卫与递补确认**

在 `bid.service.ts` 的 `swapExpertRole` 中，锚点 A（`if (!e1 || !e2) throw new BadRequestException({ error: '专家记录不存在', code: 'NOT_FOUND' });`）之后、窗口复查之前插入：

```ts
    // 2026-09-23 方案 A：方向校验——此前任意两行互换无方向约束（API 层防呆，UI 只暴露合法组合）
    if (e1.expertRole !== '正选' || e2.expertRole !== '候补') {
      throw new BadRequestException({ error: '互换角色不匹配：被替换方须为正选、递补方须为候补', code: 'INVALID_SWAP_ROLES' });
    }
    // 2026-09-23 方案 A：已签到=已进场（评标委员会组成实际形成），换出会遗留 open window 与已交材料——禁止
    if (e1.signedIn) {
      throw new ConflictException({ error: `正选专家【${e1.expertName}】已签到进场，不可替换`, code: 'EXPERT_ALREADY_SIGNED_IN' });
    }
    // 2026-09-23 方案 A：婉拒候补不可递补（此前前端候选列表未过滤，可换入 declined 行卡死启动评标）
    if (e2.invitationStatus === 'declined') {
      throw new ConflictException({ error: `候补专家【${e2.expertName}】已婉拒邀请，不可递补`, code: 'ALTERNATE_DECLINED' });
    }
    // 2026-09-23 方案 A：换出组长时递补者须接任组长（否则委员会失去组长，末签/异议/表决全链死锁）。
    // P1-7（#47）：采购人代表不得担任评审组长——此类情形须先走 PATCH /expert-admin/extract/leader 换组长再替换。
    if (e1.isLead && e2.isPurchaserRepresentative) {
      throw new BadRequestException({ error: '递补候补为采购人代表，不可接任组长——请先更换评审组长再替换', code: 'ALTERNATE_CANNOT_LEAD' });
    }
```

锚点 B（事务块）：

```ts
    await this.prisma.$transaction([
      this.prisma.bidExpert.update({ where: { id: e1.id }, data: { expertRole: '候补' } }),
      this.prisma.bidExpert.update({ where: { id: e2.id }, data: { expertRole: '正选' } }),
    ]);
```

替换为：

```ts
    await this.prisma.$transaction([
      // 换出组长时同步摘除其 isLead，防止组长标记残留在候补行
      this.prisma.bidExpert.update({ where: { id: e1.id }, data: { expertRole: '候补', ...(e1.isLead ? { isLead: false } : {}) } }),
      // 2026-09-23 方案 A：递补即确认进场——startEvaluation 委员会校验只数 confirmed 正选，
      // 不置 confirmed 则换掉 confirmed 正选后 confirmed 数悄悄跌破法定下限（INSUFFICIENT_COMMITTEE_SIZE/EVEN_COMMITTEE_SIZE）；
      // 换出组长则递补者接任组长（isLead 转移）
      this.prisma.bidExpert.update({ where: { id: e2.id }, data: { expertRole: '正选', invitationStatus: 'confirmed', ...(e1.isLead ? { isLead: true } : {}) } }),
    ]);
```

监督日志 result 串（同函数内，紧随事务块）改为：

```ts
        result: `正选【${e1.expertName}】⇄ 候补【${e2.expertName}】（${e2.expertName} 递补为正选${e1.isLead ? '并接任组长' : ''}）`,
```

- [ ] **Step 5: 运行测试确认通过**

Run: `pnpm --filter api test -- bid.service.spec.ts -t "swapExpertRole"`
Expected: 全部 PASS（阶段闸 2 + DOWNLOAD 放行 1 + 新 4 = 7 用例）。

- [ ] **Step 6: Commit**

先确认 `git status --short` 中 `apps/api/src/bid/bid.service.ts` 是否仍含他人改动：

```bash
git add apps/api/src/bid/bid.service.spec.ts
git add apps/api/src/bid/bid.service.ts
git commit -m "fix(api): 正选↔候补互换口径加固——方向/已签到/婉拒/组长四闸+递补即确认（2026-09-23 方案A）

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

若 commit 前发现 `bid.service.ts` 仍有**他人未提交的改动**（`git diff -- apps/api/src/bid/bid.service.ts` 里出现与本任务无关的 hunk）：**不要整文件 add**（本环境不支持 `git add -p` 交互式摘 hunk）。改为：本任务只提交 spec 文件，`bid.service.ts` 的改动等对方会话提交后（或经用户协调）再单独 commit——提交信息同上，不留半提交状态，由 Task 5 回归前补交。

---

### Task 2: 前端解冻替换入口 + 签到列 + 口径文案（:3005）

**Files:**
- Modify: `apps/web/src/components/projects/bid-confirm-panel.tsx`（约 362-364、507-514、645-648、659、679、704、706 行，以锚点文本为准）

**Interfaces:**
- Consumes: Task 1 错误码（toast 透出）；`BidWorkspaceExpert.signedIn`/`invitationStatus` 已随 `GET /bid/projects/:id/workspace` 返回（`getWorkspace` 的 experts 用 `include` 全字段，前端类型 `apps/web/src/lib/api/bid.ts:66-78` 已声明 `signedIn`）——**无需改 API payload**。
- Produces: 组件层常量 `isEvalStarted`、`availableAlts`（Task 3 复用）。

- [ ] **Step 1: 新增派生常量**

锚点（362-364 行）：

```tsx
  const stage = bidProject?.stage;
  // 开标已开始（OPENING/EVALUATING/ARCHIVED）→ 供应商和专家均锁定，不可修改
  const isOpened = stage === 'OPENING' || stage === 'EVALUATING' || stage === 'ARCHIVED';
```

改为：

```tsx
  const stage = bidProject?.stage;
  // 开标已开始（OPENING/EVALUATING/ARCHIVED）→ 供应商和专家均锁定，不可修改
  const isOpened = stage === 'OPENING' || stage === 'EVALUATING' || stage === 'ARCHIVED';
  // 2026-09-23 口径修订（方案 A）：评标启动后才锁死专家组——OPENING 且正选未签到仍可递补（现场签到前换人窗口）
  const isEvalStarted = stage === 'EVALUATING' || stage === 'ARCHIVED';
  // 可用候补：排除已婉拒（后端 409 ALTERNATE_DECLINED 双保险）
  const availableAlts = (workspace?.experts ?? []).filter(
    x => x.expertRole === '候补' && x.invitationStatus !== 'declined',
  );
```

- [ ] **Step 2: 更新开标后锁定横幅文案**

锚点（507-514 行）：

```tsx
          {isOpened && (
            <div className="wb-tone-banner wb-tone-banner--info mb-3">
              <Shield size={16} className="shrink-0" />
              <div className="text-[11px] leading-relaxed text-[color:var(--foreground)]">
                <strong>已开标</strong>——供应商名单、专家组、采购文件、评分标准等前置信息均已锁定。开标确认页面仅供查看。
              </div>
            </div>
          )}
```

改为：

```tsx
          {isOpened && (
            <div className="wb-tone-banner wb-tone-banner--info mb-3">
              <Shield size={16} className="shrink-0" />
              <div className="text-[11px] leading-relaxed text-[color:var(--foreground)]">
                <strong>已开标</strong>——供应商名单、采购文件、评分标准均已锁定；专家组仅在正选签到前可替换（评标启动后不可替换）。其余仅供查看。
              </div>
            </div>
          )}
```

- [ ] **Step 3: 更新专家卡徽标**

锚点（645-648 行）：

```tsx
                action={
                  isOpened ? (
                    <span className="rounded-full bg-[color-mix(in_oklch,var(--accent)_10%,transparent)] px-2.5 py-1 text-[10px] font-bold text-[var(--accent)]">已开标·锁定</span>
                  ) : undefined
                }
```

改为：

```tsx
                action={
                  isOpened ? (
                    <span className="rounded-full bg-[color-mix(in_oklch,var(--accent)_10%,transparent)] px-2.5 py-1 text-[10px] font-bold text-[var(--accent)]">
                      {isEvalStarted ? '评标已启动·锁定' : '已开标·签到前可递补'}
                    </span>
                  ) : undefined
                }
```

- [ ] **Step 4: hasAlts 改用过滤后的 availableAlts**

锚点（659 行）：

```tsx
                    const hasAlts = workspace.experts.some(x => x.expertRole === '候补');
```

改为：

```tsx
                    const hasAlts = availableAlts.length > 0;
```

- [ ] **Step 5: 新增签到列**

锚点 A（679-680 行，表头）：

```tsx
                              <th>确认状态</th>
                              <th style={{ width: 60 }}>操作</th>
```

改为：

```tsx
                              <th>确认状态</th>
                              <th>签到</th>
                              <th style={{ width: 60 }}>操作</th>
```

锚点 B（704-709 行，单元格+按钮条件）：

```tsx
                                  <td>{isAlt ? <span className="text-[11px] text-[var(--muted-foreground)]">—</span> : e.invitationStatus === 'confirmed' ? <StatusBadge tone="green">确认参加</StatusBadge> : <StatusBadge tone="blue">待回复</StatusBadge>}</td>
                                  <td className="text-center">
                                    {!isAlt && hasAlts && !isOpened && (
                                      <button onClick={() => { setReplaceModalExpert({ id: e.id, name: e.expertName }); setReplaceModalOpen(true); }} className="neu-btn-xs">替换</button>
                                    )}
                                  </td>
```

改为：

```tsx
                                  <td>{isAlt ? <span className="text-[11px] text-[var(--muted-foreground)]">—</span> : e.invitationStatus === 'confirmed' ? <StatusBadge tone="green">确认参加</StatusBadge> : <StatusBadge tone="blue">待回复</StatusBadge>}</td>
                                  <td>
                                    {isAlt ? <span className="text-[11px] text-[var(--muted-foreground)]">—</span> : e.signedIn ? <StatusBadge tone="green">已签到</StatusBadge> : <StatusBadge tone="gray">未签到</StatusBadge>}
                                  </td>
                                  <td className="text-center">
                                    {!isAlt && hasAlts && !isEvalStarted && !e.signedIn && (
                                      <button onClick={() => { setReplaceModalExpert({ id: e.id, name: e.expertName }); setReplaceModalOpen(true); }} className="neu-btn-xs">替换</button>
                                    )}
                                  </td>
```

（`tone="gray"` 在 `@water-erp/shared` 的 `WorkbenchTone` 取值内：`packages/shared/src/workbench.ts:30`。）

- [ ] **Step 6: 类型检查与 lint**

Run: `pnpm --filter web exec tsc --noEmit` → Expected: 无新错误
Run: `pnpm --filter web lint` → Expected: 无新告警

- [ ] **Step 7: 浏览器 QA（解冻逻辑）**

前置：API (:4001) 与 web (:3005) 在跑；用演示项目快照 `JJ-2026091003`（或任一 SUBMIT/OPENING 阶段且有候补的项目）。

1. :3005 登录 `Swhi-CGZX-05 / Swhi-CGZX-05@2026` → 项目管理 → 打开目标项目「开标确认」。
2. 专家表应出现「签到」列，全员「未签到」；SUBMIIT 阶段正选行「替换」按钮存在。
3. 点击「按时开标」→ 面板横幅显示新文案；专家卡徽标变为「已开标·签到前可递补」；**未签到正选行「替换」按钮仍在**；供应商卡仍显示「已开标·锁定」（确认未误放行其他区块）。

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/components/projects/bid-confirm-panel.tsx
git commit -m "feat(web): 开标后评标启动前未签到正选可替换——解冻替换按钮+签到列+口径文案

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 3: 替换弹窗两段确认 + 候选过滤（:3005）

**Files:**
- Modify: `apps/web/src/components/projects/bid-confirm-panel.tsx`（弹窗区块 721-757 行 + state 区 183-185 行 + 类型 import 区）

**Interfaces:**
- Consumes: Task 2 的 `availableAlts`；`swapExpertRole`（`apps/web/src/lib/api/bid.ts:637-640`，签名不变）。
- Produces: 两段确认交互（选候补 → 确认替换），打开弹窗时 `replaceModalAlt` 必须重置为 null。

- [ ] **Step 1: 新增选中候补 state 与类型 import**

锚点（183-185 行）：

```tsx
  // 正选专家替换弹窗
  const [replaceModalOpen, setReplaceModalOpen] = useState(false);
  const [replaceModalExpert, setReplaceModalExpert] = useState<{ id: string; name: string } | null>(null);
```

改为：

```tsx
  // 正选专家替换弹窗
  const [replaceModalOpen, setReplaceModalOpen] = useState(false);
  const [replaceModalExpert, setReplaceModalExpert] = useState<{ id: string; name: string; isLead: boolean } | null>(null);
  /** 两段确认：先选候补，再确认替换（2026-09-23：此前点选即换、误触无挽回） */
  const [replaceModalAlt, setReplaceModalAlt] = useState<BidWorkspaceExpert | null>(null);
```

若文件顶部 `@/lib/api/bid` 的 type import 未含 `BidWorkspaceExpert`，补入（当前 import 区含 `type BidWorkspace` 等，见文件 44 行附近）：

```tsx
  type BidWorkspace,
  type BidWorkspaceExpert,
```

- [ ] **Step 2: 打开/关闭弹窗时重置选中态**

锚点（706-708 行区域，Task 2 改后形态）：

```tsx
                                    {!isAlt && hasAlts && !isEvalStarted && !e.signedIn && (
                                      <button onClick={() => { setReplaceModalExpert({ id: e.id, name: e.expertName }); setReplaceModalOpen(true); }} className="neu-btn-xs">替换</button>
                                    )}
```

改为：

```tsx
                                    {!isAlt && hasAlts && !isEvalStarted && !e.signedIn && (
                                      <button onClick={() => { setReplaceModalExpert({ id: e.id, name: e.expertName, isLead: e.isLead ?? false }); setReplaceModalAlt(null); setReplaceModalOpen(true); }} className="neu-btn-xs">替换</button>
                                    )}
```

锚点（724-725 行）：

```tsx
                  onClose={() => { setReplaceModalOpen(false); setReplaceModalExpert(null); }}
```

改为：

```tsx
                  onClose={() => { setReplaceModalOpen(false); setReplaceModalExpert(null); setReplaceModalAlt(null); }}
```

- [ ] **Step 3: 弹窗主体改为两段式并过滤候选**

锚点（730-755 行，整个 `<div className="space-y-2 max-h-[260px] overflow-y-auto">…</div>` 块）替换为：

```tsx
                  <div className="space-y-2 max-h-[260px] overflow-y-auto">
                    {availableAlts.length === 0 ? (
                      <p className="text-center text-xs text-[var(--muted-foreground)] py-6">无可用候补专家（均已婉拒邀请）</p>
                    ) : replaceModalAlt ? (
                      <div className="space-y-3">
                        <div className="rounded-xl border border-[var(--border)] p-3 text-sm">
                          <div className="text-xs text-[var(--muted-foreground)] mb-1">确认用以下候补替换【{replaceModalExpert.name}】：</div>
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-[var(--foreground)]">{replaceModalAlt.expertName}</span>
                            <span className="text-xs text-[var(--muted-foreground)]">{replaceModalAlt.major || '—'}</span>
                            <StatusBadge tone="orange">候补</StatusBadge>
                          </div>
                          {replaceModalExpert.isLead && (
                            <p className="mt-2 flex items-start gap-1.5 text-[11px] text-[color-mix(in_oklch,var(--warning)_75%,black)]">
                              <AlertTriangle size={12} className="mt-0.5 shrink-0" />
                              该正选为评审组长，替换后组长由候补【{replaceModalAlt.expertName}】接任。
                            </p>
                          )}
                        </div>
                        <div className="flex justify-end gap-2">
                          <button className="neu-btn-soft" onClick={() => setReplaceModalAlt(null)} disabled={busy}>返回重选</button>
                          <button
                            className="neu-btn-primary"
                            disabled={busy}
                            onClick={async () => {
                              setBusy(true);
                              try {
                                await swapExpertRole(bidProject?.id || '', replaceModalExpert.id, replaceModalAlt.id);
                                showToast(`已将 ${replaceModalExpert.name} 与 ${replaceModalAlt.expertName} 角色互换`);
                                setReplaceModalOpen(false);
                                setReplaceModalExpert(null);
                                setReplaceModalAlt(null);
                                void refreshWorkspace();
                              } catch (err: any) { showToast(err?.message || '替换失败', 'err'); }
                              setBusy(false);
                            }}
                          >
                            确认替换
                          </button>
                        </div>
                      </div>
                    ) : (
                      availableAlts.map(alt => (
                        <button
                          key={alt.id}
                          onClick={() => setReplaceModalAlt(alt)}
                          disabled={busy}
                          className="neu-btn-soft w-full text-left flex items-center gap-3 p-3"
                        >
                          <span className="text-sm font-bold text-[var(--foreground)]">{alt.expertName}</span>
                          <span className="text-xs text-[var(--muted-foreground)]">{alt.major || '—'}</span>
                          <StatusBadge tone="orange">候补</StatusBadge>
                        </button>
                      ))
                    )}
                  </div>
```

（`neu-btn-primary`/`neu-btn-soft` 均为 :3005 既有样式：`apps/web/src/app/globals.css:8995` / `:5022`。）

- [ ] **Step 4: 类型检查与 lint**

Run: `pnpm --filter web exec tsc --noEmit` → Expected: 无新错误
Run: `pnpm --filter web lint` → Expected: 无新告警

- [ ] **Step 5: 浏览器 QA（替换全链路）**

1. 接 Task 2 QA 状态（OPENING、全员未签到）：点某正选「替换」→ 弹窗列出的候补**不含已婉拒者**。
2. 点一名候补 → 进入确认页（显示「确认用以下候补替换…」），点「返回重选」回到列表；再选一次后点「确认替换」。
3. toast「已将 A 与 B 角色互换」→ 表格刷新：A 变候补、B 变正选且确认状态「确认参加」（验证递补即 confirmed）。
4. 组长场景：换出带 Crown 组长徽标的正选 → 确认屏出现组长接任警告 → 替换后新正选带 Crown 徽标（验证 isLead 转移与 workspace 刷新联动）。
5. 若项目有已签到正选（可用 API 造态：`POST /api/expert/projects/:id/sign-in` 或等现场签一个），其「替换」按钮应消失、签到列「已签到」。
6. 反向验证：阶段到 EVALUATING 后（:3007 启动评标），替换按钮应全部消失、徽标「评标已启动·锁定」。

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/projects/bid-confirm-panel.tsx
git commit -m "feat(web): 替换弹窗两段确认+过滤已婉拒候补——防误触与 declined 递补卡死

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 4: 口径落档（spec 修订记录 + CLAUDE.md）

**Files:**
- Modify: `docs/superpowers/specs/2026-09-18-expert-identity-verification-design.md`（文末追加修订记录）
- Modify: `CLAUDE.md`（:3005 分工描述一处，**经 Bash 修改**——ARS 守卫拦 Edit/Write 改 CLAUDE.md）

**Interfaces:**
- Consumes: Task 1-3 的行为口径。
- Produces: 未来会话/审查者可见的口径修订记录。

- [ ] **Step 1: spec 文末追加修订记录**

用 Bash 追加（文件若被其他会话改动，先 `git status` 确认）：

```bash
cd /home/asus/桌面/ERP/water-erp && cat >> docs/superpowers/specs/2026-09-18-expert-identity-verification-design.md <<'EOF'

## 修订记录（2026-09-23）

**R5 口径修订（用户裁定）：**「开标后不可替换」细化为「**评标启动后不可替换**」——
OPENING 阶段、正选尚未签到（未进场）时，:3005 开标确认面板仍可正选↔候补递补，覆盖现场「开标→专家签到→评标」之间发现缺席的窗口。已签到正选视为进场，不可换出（后端 409 `EXPERT_ALREADY_SIGNED_IN`）。同时补三闸：方向校验 400 `INVALID_SWAP_ROLES`、婉拒候补不可递补 409 `ALTERNATE_DECLINED`、递补者 `invitationStatus` 落 `confirmed`（保启动评标委员会校验不跌破法定下限）。实施计划：`docs/superpowers/plans/2026-09-23-opening-stage-expert-swap-fallback.md`。
EOF
```

- [ ] **Step 2: CLAUDE.md 分工描述加注**

用 Bash python3 精确替换一处（旧串在「:3005 保留（不迁）」段落内）：

```bash
cd /home/asus/桌面/ERP && python3 - <<'PYEOF'
p = 'CLAUDE.md'
s = open(p, encoding='utf-8').read()
old = '专家确认·正选候补替换'
new = '专家确认·正选候补替换（开标后、评标启动前、未签到可换；2026-09-23 口径修订）'
assert s.count(old) == 1, f'unexpected occurrences: {s.count(old)}'
open(p, 'w', encoding='utf-8').write(s.replace(old, new))
print('done')
PYEOF
```

- [ ] **Step 3: Commit**

```bash
cd /home/asus/桌面/ERP
git add water-erp/docs/superpowers/specs/2026-09-18-expert-identity-verification-design.md CLAUDE.md
git commit -m "docs: 落档 2026-09-23 正选候补替换口径修订（开标后·评标启动前·未签到可换）

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 5: E2E 复核与全量回归

**Files:**
- Test: `apps/api/test/expert-room-window.e2e-spec.ts`（P2-4 swap 用例 363-390 行——预期**无需改动**，仅验证）
- 若跑出夹具失败，按失败信息最小调整本文件。

**Interfaces:**
- Consumes: Task 1 的新闸门（e2e P2-4 的「放行」分支：正选→候补、候补 pending、正选未签到——应全部通过；「阻断」分支仍撞 `EXPERT_WINDOW_CONFLICT`，不受新闸影响）。

- [ ] **Step 1: API 单测全量回归**

Run: `pnpm --filter api test -- bid.service.spec.ts`
Expected: 全 PASS（swap 用例之外的既有用例不受影响）。

- [ ] **Step 2: E2E 定向复核**

前置：`pnpm infra:up` + DB 已 migrate/seed（或沿用 CI 配方：`migrate deploy` → `db:seed`）。

Run: `pnpm --filter api test:e2e -- expert-room-window`
Expected: 全 PASS。若 P2-4 用例失败，检查失败码是否符合新闸预期（如夹具候补是 declined 则改夹具行 `invitationStatus`），改完重跑本文件。

- [ ] **Step 3: 前端全量类型/lint**

Run: `pnpm --filter web exec tsc --noEmit` → Expected: 无新错误
Run: `pnpm --filter web lint` → Expected: 无新告警

- [ ] **Step 4: （可选，改动收尾前）CI 链路冒烟**

按 CI validate job 配方本地复刻：`pnpm --filter api exec tsc --noEmit`、`pnpm --filter api lint`、`pnpm --filter api test`（全量，时间较长）。
Expected: 全绿（`main 既有测试红 2026-09-18` memory 提示：先 `git stash` 基线复测再归因，若基线即红不属本计划）。

- [ ] **Step 5: Commit（如 Step 2/4 有夹具或回归修复）**

```bash
git add apps/api/test/expert-room-window.e2e-spec.ts   # 仅当有改动
git commit -m "test(api): 适配 2026-09-23 递补三闸的 e2e 夹具

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

## Self-Review 记录

- **口径覆盖**：修订口径三点（OPENING 可换 / 签到即锁 / 评标启动即锁）分别落于 Task 1（后端 `EXPERT_ALREADY_SIGNED_IN` + 既有 `EXPERT_SWAP_LOCKED`）、Task 2（按钮条件 `!isEvalStarted && !e.signedIn`）；原 09-20 裁定文本在 Task 4 落档修订。
- **此前审计发现的四坑**：递补 pending 不计数 → Task 1 落 confirmed；候选含婉拒 → Task 2/3 前端过滤 + Task 1 后端 409；无确认弹窗 → Task 3 两段确认；方向无校验 → Task 1 `INVALID_SWAP_ROLES`。
- **审查新增发现（2026-09-23 首轮审查后补入）**：
  - **组长死锁洞**：原方案换出 `isLead` 正选会留下「组长标记在候补行、正选中无组长」——组长独占末签（`expert.service.ts:2433 NOT_LEADER`）/异议提交（`:2395`）/表决发起（`:2465`），评标链直接死锁。修复：Task 1 组长标记随换转移（`isLead: true` 落递补者）+ 采购人代表候补例外 400 `ALTERNATE_CANNOT_LEAD`（P1-7）+ 监督日志注明「并接任组长」+ Task 3 确认屏显式警告。
  - **`git add -p` 不可用**：本环境不支持交互式 git 命令，Task 1 Step 6 已改为「等待对方提交 + 分步提交」的落地方案。
  - **e2e 兼容性已核**：`expert-room-window.e2e-spec.ts` P2-6 及后续用例只依赖 texp 的 User 级口令锁，不依赖其在 projectD 的 invitationStatus——Task 1 的递补即 confirmed 不破坏后续用例（Task 5 跑一遍兜底）。
  - **CLAUDE.md 替换串唯一性已核**（`grep -c` = 1），Task 4 的 python assert 可安全执行。
  - **单测断言机制已核**：`rejects.toMatchObject({ response: { code } })` 对 BadRequestException/ConflictException 同机制生效（HttpException 对象体透传，与既有阶段闸用例一致）。
- **类型一致性**：`availableAlts`（Task 2 定义）在 Task 3 弹窗复用；`replaceModalAlt: BidWorkspaceExpert | null` 的 import 已在 Task 3 Step 1 给出；`replaceModalExpert` 扩为 `{ id, name, isLead }`（Task 3 Step 1/2 同步）；`AlertTriangle` 已在 bid-confirm-panel.tsx 既有 import（24h 横幅在用），Task 3 确认屏直接复用；错误码字符串 Task 1 与前端 toast 透传路径（ApiError.message 取自 body.error）一致。
- **遗留风险（不属本计划）**：OPENING 阶段若有人先签到再被「误换出」的后门已由 `EXPERT_ALREADY_SIGNED_IN` 关闭；全系统仍无「撤销签到」端点——已签到换人仍需走异议裁决/流标，属 09-20 裁定保留项。`autoPromoteCandidate`（RSVP 婉拒自动递补路径）同样不更新 invitationStatus——与本计划同根问题，但触达路径不同，暂不动。
