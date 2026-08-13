# 开评标全流程第二轮缺漏修复方案

> **背景：** 2026-08-11 首轮审计 7 项 + 第二轮变更后复查，最终确认 6 项待修复（1 HIGH + 5 MEDIUM）。

---

## 全局约束

- 迁移禁止 `prisma migrate dev`（交互式），用三步非交互流程：`--create-only` → `db execute` → `migrate resolve --applied`
- `pnpm --filter api test` 跑单元测试；每轮 commit 前确认在正确分支
- commit 后只提醒未推送，不主动 `git push`
- 不引入新依赖

---

## Task 1: 专家交叉回避接线 🔴 HIGH

**目标：** 将已实现但孤立的 `ExpertCrossConflictService` 接入专家抽取流程，同单位专家自动告警。

**Files:**
- Modify: `water-erp/apps/api/src/expert/expert.module.ts`
- Modify: `water-erp/apps/api/src/expert/expert-admin.service.ts`
- Test: `water-erp/apps/api/src/expert/expert-cross-conflict.service.spec.ts`（已存在，验证通过）

### Step 1: 在 `expert.module.ts` 注册

```ts
// providers 数组新增：
ExpertCrossConflictService
```

同时顶部 import：

```ts
import { ExpertCrossConflictService } from './expert-cross-conflict.service';
```

### Step 2: 注入到 `ExpertAdminService`

在 `expert-admin.service.ts` constructor 注入：

```ts
private readonly crossConflict: ExpertCrossConflictService,
```

### Step 3: 在 `confirmExtraction` 的事务外调用

`expert-admin.service.ts` 的 `confirmExtraction` 方法——事务结束（line 738 `});`）之后、return 之前——插入交叉回避检查。**放在事务外**：交叉冲突不阻塞抽取、不同步写入（ExpertProfile 在事务外读即可），避免增加事务复杂度：

```ts
// ── 事务外：交叉回避检查（不阻塞，仅告警留痕）──
const selectedUserIds = dto.experts.map(e => e.userId);
const crossConflicts = await this.crossConflict.checkCrossConflicts(selectedUserIds);
if (crossConflicts.length > 0) {
  await this.prisma.bidSupervisionLog.create({
    data: {
      projectId, time: new Date(), role: '系统', target: '专家抽取',
      action: '交叉回避告警',
      result: crossConflicts.map(c => `${c.expertName} - ${c.conflictWith}（${c.conflictType}）`).join('；'),
      riskFlag: '中风险',
    },
  }).catch(() => {});
  this.logger.warn(`[CrossConflict] 项目 ${projectId} 发现 ${crossConflicts.length} 条专家交叉冲突`);
}

### Step 4: 运行测试

```bash
pnpm --filter api test -- expert-cross-conflict.service
pnpm --filter api test -- expert-admin.service
```

### Step 5: Commit

```bash
git add apps/api/src/expert/expert.module.ts apps/api/src/expert/expert-admin.service.ts
git commit -m "fix(expert): 交叉回避接线——confirmExtraction 后检查同单位专家并告警

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 2: 开标 checklist 采购方式感知化 🟡 MEDIUM

**目标：** `startOpeningInternal` 的 checklist 从硬编码 `supplierCount < 3` 改为与 `startEvaluation` 一致的采购方式感知门槛。

**Files:**
- Modify: `water-erp/apps/api/src/bid/bid.service.ts`（line 1077-1097）
- Test: `water-erp/apps/api/src/bid/bid.service.spec.ts`

**接口：**
- 复用 `startEvaluation` 已有的 `minBidders` 计算（直接采购=1，谈判=2，其余=3）
- 无需引入新依赖或配置

### Step 1: 修复 `startOpeningInternal` 的 select —— 补 `procurementMethod`

`bid.service.ts:1050` 当前 select 不含 `procurementMethod`，加一行：

```ts
select: { stage: true, name: true, deadline: true, projectManagementItemId: true, round: true, assignedHostUserId: true, procurementMethod: true },
```

### Step 2: 提取 minBidders 计算为共享方法

在 `bid.service.ts` 中新增 private 方法（放在 `startOpeningInternal` 之前）：

```ts
/** 按采购方式返回法定最少投标家数。消费方：开标 checklist + 启动评标 */
private getMinBidders(procurementMethod: string | null): number {
  if (procurementMethod === '直接采购') return 1;
  if (procurementMethod === '谈判采购') return 2;
  return 3;
}
```

### Step 3: 修改开标 checklist

`bid.service.ts:1083` 从：

```ts
if (supplierCount < 3) blocking.push(`有效投标供应商仅 ${supplierCount} 家(不足 3 家)`);
```

改为：

```ts
const minBidders = this.getMinBidders(project.procurementMethod);
if (supplierCount < minBidders) blocking.push(`有效投标供应商仅 ${supplierCount} 家(法定最少 ${minBidders} 家，${project.procurementMethod ?? '未知方式'})`);
```

### Step 4: `startEvaluation` 同步使用共享方法

`bid.service.ts:1311-1313` 从：

```ts
const minBidders = project.procurementMethod === '直接采购' ? 1
  : project.procurementMethod === '谈判采购' ? 2 : 3;
```

改为：

```ts
const minBidders = this.getMinBidders(project.procurementMethod);
```

### Step 5: 写测试

```ts
describe('getMinBidders procurement-method-aware', () => {
  const service = new BidService(/* minimal deps */);
  it('直接采购→1', () => expect(service.getMinBidders('直接采购')).toBe(1));
  it('谈判采购→2', () => expect(service.getMinBidders('谈判采购')).toBe(2));
  it('邀请招标→3', () => expect(service.getMinBidders('邀请招标')).toBe(3));
  it('询比采购→3', () => expect(service.getMinBidders('询比采购')).toBe(3));
  it('null→3', () => expect(service.getMinBidders(null)).toBe(3));
});
```

### Step 6: 运行测试

```bash
pnpm --filter api test -- bid.service.spec
```

### Step 7: Commit

```bash
git add apps/api/src/bid/bid.service.ts apps/api/src/bid/bid.service.spec.ts
git commit -m "fix(bid): 开标 checklist 改为采购方式感知——与 startEvaluation 同口径

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 3: 开标异议超时自动处理 🟡 MEDIUM

**目标：** `disputeTimeoutMinutes` 和 `disputedSince` 从死字段变为活功能——超时后自动告警或强制裁决。

**设计决策：** 不自动强制裁决（法律风险——强制裁决须人工确认），改为超时后写监督日志告警 + 向 bid_host/leader 发通知催促。如需自动裁决，配置环境变量 `OPENING_DISPUTE_AUTO_RESOLVE=true`。

**Files:**
- Modify: `water-erp/apps/api/src/bid/bid.service.ts`（新增 `assertDisputeNotTimedOut` 方法 + `completeOpening` 入口调用）
- Test: `water-erp/apps/api/src/bid/bid.service.spec.ts`

### Step 1: 新增超时检查方法

在 `assertOpeningDone` 之后新增：

```ts
/**
 * 检查开标异议是否已超时。超时写监督日志 + 可选自动裁决。
 * 不抛异常——超时不阻塞 completeOpening，由主持人决定是否强制裁决。
 */
private async checkDisputeTimeout(projectId: string): Promise<void> {
  const session = await this.prisma.bidOpeningSession.findUnique({
    where: { projectId },
    select: { disputeTimeoutMinutes: true, disputedSince: true },
  });
  if (!session?.disputeTimeoutMinutes || !session?.disputedSince) return;

  const timeoutAt = new Date(session.disputedSince.getTime() + session.disputeTimeoutMinutes * 60 * 1000);
  if (new Date() <= timeoutAt) return; // 未超时

  const disputedSuppliers = await this.prisma.bidSupplier.findMany({
    where: { projectId, confirmStatus: 'DISPUTED', submitStatus: { not: '已撤回' } },
    select: { id: true, supplierName: true },
  });
  if (disputedSuppliers.length === 0) return;

  const names = disputedSuppliers.map(s => s.supplierName).join('、');
  const timeoutStr = `异议已超时 ${session.disputeTimeoutMinutes} 分钟（自 ${session.disputedSince.toISOString()}）`;

  await this.prisma.bidSupervisionLog.create({
    data: {
      projectId, time: new Date(), role: '系统', target: names,
      action: '异议超时告警', result: timeoutStr, riskFlag: '高风险',
    },
  }).catch(() => {});

  // 自动裁决开关（默认关闭，需显式开启）
  if (process.env.OPENING_DISPUTE_AUTO_RESOLVE === 'true') {
    for (const s of disputedSuppliers) {
      // 自动按 EXCEPTION 处理（每个供应商独立裁决，互不阻塞）
      await this.overrideDispute(projectId, s.id, `[自动裁决·超时] ${timeoutStr}`, undefined, 'exception')
        .catch(err => this.logger.error(`自动裁决 ${s.supplierName} 失败`, err));
    }
  }

  // 通知主持人
  try {
    await this.notificationService.sendToRole('bid_host', {
      type: 'BID_DISPUTE_TIMEOUT',
      title: '开标异议处理已超时',
      content: `${names} 的异议已超过 ${session.disputeTimeoutMinutes} 分钟。请前往开标大厅强制裁决。`,
      link: `/bid/project/${projectId}`,
    });
  } catch { /* 通知失败不阻塞 */ }
}
```

### Step 2: 在 `completeOpening` 中调用

`bid.service.ts` 的 `completeOpening` 方法，在 `assertOpeningDone(id)` 之后、事务之前插入：

```ts
// 异议超时检查（告警 + 可选自动裁决；不阻塞移交）
await this.checkDisputeTimeout(id);
```

同时在 `startEvaluation` 中也可同步调用（在 `assertOpeningDone` 之后），防止进入评标后仍有超时异议未处理。

### Step 3: 写测试

```ts
describe('checkDisputeTimeout', () => {
  it('超时且 OPENING_DISPUTE_AUTO_RESOLVE=false 应仅写监督日志 + 通知（不裁决）', async () => {
    // mock: session.disputeTimeoutMinutes=30, disputedSince=31min ago
    // mock: supplier with DISPUTED status
    // verify: supervisionLog create called with '异议超时告警'
    // verify: overrideDispute NOT called
  });

  it('未超时应 no-op', async () => {
    // mock: disputedSince=5min ago, timeout=30min
    // verify: no supervisionLog created for timeout
  });

  it('无 DISPUTED 供应商应 no-op（maybe 已经 resolve）', async () => {
    // mock: disputedSince expired but no suppliers with DISPUTED status
    // verify: no overrideDispute called
  });
});
```

### Step 4: 运行测试

```bash
pnpm --filter api test -- bid.service.spec -- --testNamePattern="disputeTimeout|checkDispute"
```

### Step 5: Commit

```bash
git add apps/api/src/bid/bid.service.ts apps/api/src/bid/bid.service.spec.ts
git commit -m "feat(bid): 开标异议超时告警——checkDisputeTimeout 在 completeOpening/startEvaluation 入口调用

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 4: `abortBidProject` 增加 FOR UPDATE 行锁 🟡 MEDIUM

**目标：** 防止 `abortBidProject` 与 `startOpening`/`startEvaluation` 并发竞态。

**Files:**
- Modify: `water-erp/apps/api/src/bid/bid.service.ts`（line 930-950）
- Test: `water-erp/apps/api/src/bid/bid.service.spec.ts`

### Step 1: 改写为事务 + 行锁

`abortBidProject` 的 stage update 从裸 `this.prisma.bidProject.update` 改为 `$transaction` + `lockAndReassertStage`：

```ts
const updated = await this.prisma.$transaction(async (tx) => {
  await this.lockAndReassertStage(tx, id, 'ABORTED');

  const result = await tx.bidProject.update({
    where: { id },
    data: { stage: 'ABORTED', riskNote },
    select: { id: true, stage: true },
  });

  await tx.bidSupervisionLog.create({
    data: {
      projectId: id, time: new Date(abortAt), role: '系统', target: project.name,
      action: '流标', result: riskNote, riskFlag: '高风险',
    },
  });

  return result;
});
```

### Step 2: 写测试

```ts
describe('abortBidProject concurrency', () => {
  it('应使用事务 + FOR UPDATE 防止竞态', async () => {
    // 验证 lockAndReassertStage 在 abort 中被调用
    // mock: 项目处于 SUBMIT 阶段
    // verify: prisma.$transaction 被调用
    // verify: 写入监督日志
  });
});
```

### Step 3: 运行测试

```bash
pnpm --filter api test -- bid.service.spec -- --testNamePattern="abort"
```

### Step 4: Commit

```bash
git add apps/api/src/bid/bid.service.ts apps/api/src/bid/bid.service.spec.ts
git commit -m "fix(bid): abortBidProject 增加 FOR UPDATE 行锁——防并发竞态

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 5: 开标启动时通知已投递供应商 🟡 MEDIUM

**目标：** 按时开标后，所有已投递的供应商收到站内信提醒去开标大厅解密。

**Files:**
- Modify: `water-erp/apps/api/src/bid/bid.service.ts`（line 1174-1184）
- Test: `water-erp/apps/api/src/bid/bid.service.spec.ts`

### Step 1: 在 `startOpeningInternal` 的通知段增加供应商通知

`bid.service.ts:1174-1184`，在现有的 `sendToRole('bid_host', ...)` 之后（同 `isTransitioning` 分支内）追加：

```ts
// 通知所有已投递的供应商——开标已启动，请前往开标大厅
try {
  const submittedSuppliers = await this.prisma.bidSupplier.findMany({
    where: { projectId: id, submitStatus: '已提交' },
    select: { supplierId: true, supplierName: true },
  });
  // 批量取 Supplier.userId，避免 N+1
  const supplierIds = submittedSuppliers.map(s => s.supplierId).filter(Boolean);
  if (supplierIds.length > 0) {
    const suppliers = await this.prisma.supplier.findMany({
      where: { id: { in: supplierIds } },
      select: { id: true, userId: true },
    });
    const userIdBySupplierId = new Map(suppliers.map(s => [s.id, s.userId]));
    for (const s of submittedSuppliers) {
      const userId = s.supplierId ? userIdBySupplierId.get(s.supplierId) : null;
      if (userId) {
        await this.notificationService.sendToUser(userId, ['in_app'], {
          type: 'BID_OPENING_STARTED',
          title: `开标已启动：${project.name}`,
          content: '请前往开标大厅查看解密窗口时间并参与开标。',
          link: `/supplier/bid/${id}`,
        });
      }
    }
  }
} catch { /* 通知失败不阻塞阶段流转 */ }
```

### Step 2: 写测试

```ts
describe('startOpeningInternal supplier notification', () => {
  it('阶段推进时应向已投递供应商发送站内信', async () => {
    // mock: 3 suppliers with submitStatus='已提交'
    // verify: sendToUser called 3 times with type 'BID_OPENING_STARTED'
  });

  it(':3007 组建会话的同阶段调用不发送供应商通知', async () => {
    // mock: isTransitioning=false, 同阶段 OPENING 调用
    // verify: sendToUser NOT called
  });
});
```

### Step 3: 运行测试

```bash
pnpm --filter api test -- bid.service.spec -- --testNamePattern="supplier notification"
```

### Step 4: Commit

```bash
git add apps/api/src/bid/bid.service.ts apps/api/src/bid/bid.service.spec.ts
git commit -m "feat(bid): 按时开标后通知已投递供应商——站内信提醒去开标大厅

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 6: winnerCount 按采购方式 + 评标办法感知化 🟡 MEDIUM

**目标：** `DEFAULT_WINNER_COUNT=3` 改为按采购方式/评标办法动态计算：最低价类→1，综合评估→3，直接采购→1。

**Files:**
- Modify: `water-erp/apps/api/src/bid/bid.service.ts`（line 67 + line 3056）
- Test: `water-erp/apps/api/src/bid/bid.service.spec.ts`

### Step 1: 提取 winnerCount 计算逻辑

在 `bid.service.ts` 中新增 private 方法（放在 `generateEvaluationResults` 之前）。`getEvaluationDefault` 已在 line 40 导入，无需额外 import：

```ts
/**
 * 按采购方式/评标办法确定中标候选人数。
 * - 最低价类(lowest_price/qualified_lowest_price)→1
 * - 综合评估(comprehensive)→3
 * - 直接采购(none)→1
 * - 未知/其他→回退 DEFAULT_WINNER_COUNT(3)
 */
private getWinnerCount(procurementMethod: string | null, evaluationMethod: string | null, qualifiedCount: number): number {
  if (qualifiedCount === 0) return 0;
  const method = evaluationMethod ?? 
    getEvaluationDefault(procurementMethod).evaluationMethod;

  switch (method) {
    case 'lowest_price':
    case 'qualified_lowest_price':
    case 'none':
      return Math.min(1, qualifiedCount);
    case 'comprehensive':
    default:
      return Math.min(this.DEFAULT_WINNER_COUNT, qualifiedCount);
  }
}
```

### Step 2: 替换调用处

`bid.service.ts:3056` 从：

```ts
const winnerCount = Math.min(isNegotiation ? 1 : this.DEFAULT_WINNER_COUNT, qualifiedRanked.length);
```

改为：

```ts
const winnerCount = this.getWinnerCount(
  project.procurementMethod,
  project.evaluationMethod ?? null,
  qualifiedRanked.length,
);
```

同时删除局部变量 `isNegotiation`（如果仅用于 winnerCount），或保留不动（也用于排序分支和日志文案，所以保留）。

### Step 3: 日志文案同步更新

`bid.service.ts:3099` 的 `action` result 字符串中，`isNegotiation ? '，谈判采购·最低价中标' : ...` 保持不变（排序分支逻辑不受影响）。

### Step 4: 写测试

```ts
describe('getWinnerCount', () => {
  it('邀请招标(comprehensive)×5 合格→3', () => { /* ... */ });
  it('询比采购(lowest_price)×5 合格→1', () => { /* ... */ });
  it('谈判采购(qualified_lowest_price)×5 合格→1', () => { /* ... */ });
  it('直接采购(none)×1 合格→1', () => { /* ... */ });
  it('直接采购(none)×0 合格→0', () => { /* ... */ });
});
```

### Step 5: 运行测试

```bash
pnpm --filter api test -- bid.service.spec -- --testNamePattern="winnerCount|getWinner"
```

### Step 6: Commit

```bash
git add apps/api/src/bid/bid.service.ts apps/api/src/bid/bid.service.spec.ts
git commit -m "feat(bid): winnerCount 按评标办法感知化——最低价类=1, 综合评估=3, 直接采购=1

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## 执行顺序与依赖

```
无依赖，6 个 Task 可串行可独立并行：

Task 1 (交叉回避) ──── 仅依赖 expert.module / expert-admin.service，无冲突
Task 2 (checklist)  ──── 仅修改 startOpeningInternal + startEvaluation 的供应商计数
Task 3 (超时告警)   ──── 在 completeOpening + startEvaluation 入口追加调用
Task 4 (abort 行锁) ──── 仅修改 abortBidProject，无冲突
Task 5 (供应商通知) ──── 仅修改 startOpeningInternal 的通知段
Task 6 (winnerCount)─── 仅修改 generateEvaluationResults 的排序/winnerCount

建议顺序：Task 1 → Task 2 → Task 4 → Task 6 → Task 3 → Task 5
（无硬依赖，此顺序按一致性——业务逻辑相近的放一起）
```

## 自检

- [ ] 6 项全无 TBD / TODO / placeholder
- [ ] 无新依赖引入（均用现有 Prisma / NestJS 内置 API）
- [ ] 每项有对应测试用例
- [ ] `getMinBidders` 共享方法不改变 `startEvaluation` 行为（仅重构）
- [ ] `getWinnerCount` 不改变 谈判采购 行为（1 已由 `isNegotiation` 处理）
- [ ] `checkDisputeTimeout` 默认不自动裁决（`OPENING_DISPUTE_AUTO_RESOLVE` 需显式开启）
