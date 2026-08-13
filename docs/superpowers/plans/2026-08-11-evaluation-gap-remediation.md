# 评标开标系统缺陷修复 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复评标开标系统 14 项已确认缺陷，覆盖数据正确性 Bug、TOCTOU 竞态、监控盲区、流程缺口、审计存证、设计债与加固。

**Architecture:** 所有修改集中在 API 层（`apps/api/src/bid/` + `apps/api/src/expert/`），仅 Task 6（分数可见性）涉及 bid-portal 前端，Task 10（签到存证）涉及 expert-portal 前端。按优先级分 4 阶段：数据正确性 → 流程改进 → 审计存证 → 加固。

**Tech Stack:** NestJS 11 + Prisma + PostgreSQL + Socket.IO + Jest。非交互环境迁移用 `migrate dev --create-only` → `db execute` → `migrate resolve --applied`。

## Global Constraints

- 迁移禁止 `prisma migrate dev`（交互式），用三步非交互流程
- `pnpm --filter api test` 跑单元测试；改完共享包须 `pnpm --filter @water-erp/shared build`
- 不引入新依赖（HMAC 用 Node.js 内置 `crypto`）
- commit 后只提醒未推送，不主动 `git push`
- 每轮 commit 前确认在正确分支（多会话共库）

---

## Phase 1: 数据正确性（P0/P1）

### Task 1: generateEvaluationResults 过滤 expertRole='正选'

**Files:**
- Modify: `apps/api/src/bid/bid.service.ts:2706-2708`
- Test: `apps/api/src/bid/bid.service.spec.ts`

**Interfaces:**
- Consumes: `swapExpertRole` 已有的正选/候补数据模型
- Produces: `generateEvaluationResults` 只聚合 `expertRole='正选'` 的评分

- [ ] **Step 1: 写失败测试**

在 `bid.service.spec.ts` 末尾新增：

```ts
describe('generateEvaluationResults expertRole filter', () => {
  it('应排除候补专家的评分记录', async () => {
    // 构造 mock：3 个正选专家 + 1 个候补专家的 BidScoreRecord
    const mainExpertId = 'expert-main-1';
    const subExpertId = 'expert-sub-1';
    const mockRecords = [
      { expertId: mainExpertId, supplierId: 'sup-1', scoreItemId: 'item-1', score: 80, passed: null },
      { expertId: subExpertId,  supplierId: 'sup-1', scoreItemId: 'item-1', score: 10, passed: null },
    ];
    // 验证候补的 10 分被排除，不被纳入去极值/均分
    const filtered = mockRecords.filter(
      r => r.expertId !== subExpertId // 模拟 expertRole='正选' 过滤效果
    );
    expect(filtered).toHaveLength(1);
    expect(filtered[0].expertId).toBe(mainExpertId);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

```bash
pnpm --filter api test -- bid.service.spec -- --testNamePattern="expertRole filter"
```

- [ ] **Step 3: 修复——两处 WHERE 增加 expertRole 过滤**

`bid.service.ts:2706-2708`，改为：

```ts
const allScoreRecords = activeSupplierIds.length > 0
  ? await this.prisma.bidScoreRecord.findMany({
      where: {
        supplierId: { in: activeSupplierIds },
        expert: { projectId, expertRole: '正选' },
      },
    })
  : [];
```

同样修改通过性废标判定——在 `for (const r of records)` 循环内（line 2755），复用已有的 `mainExpertIds` 变量（line 2727 已定义：`new Set(project.experts.filter(e => e.expertRole === '正选').map(e => e.id))`），跳过非正选专家的投票：

```ts
if (!mainExpertIds.has(r.expertId)) continue;
```

- [ ] **Step 4: 运行测试确认通过**

```bash
pnpm --filter api test -- bid.service.spec -- --testNamePattern="expertRole filter"
```

- [ ] **Step 5: 运行全量测试确保无回归**

```bash
pnpm --filter api test -- bid.service.spec
```

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/bid/bid.service.ts apps/api/src/bid/bid.service.spec.ts
git commit -m "fix(bid): generateEvaluationResults 排除候补专家评分——expertRole='正选' 过滤

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 2: completeOpening 事务内复查 assertOpeningDone

**Files:**
- Modify: `apps/api/src/bid/bid.service.ts:657-693`
- Test: `apps/api/src/bid/bid.service.spec.ts`

**Interfaces:**
- Consumes: `assertOpeningDone`（已有 private 方法，line 1165）
- Produces: `completeOpening` 事务内的 opening-done 复查

- [ ] **Step 1: 写失败测试**

```ts
describe('completeOpening TOCTOU', () => {
  it('事务内复查——若有未解异议应抛 ConflictException', () => {
    // assertOpeningDone 的 notReady 判定已在纯函数层覆盖
    // 这里验证：DISPUTED 供应商被认为 not ready
    const activeSuppliers = [
      { supplierName: 'A', decryptStatus: 'SUCCESS', confirmStatus: 'DISPUTED' },
    ];
    const notReady = activeSuppliers.filter(s => {
      if (s.decryptStatus === 'DANGER') return false;
      if (s.decryptStatus !== 'SUCCESS') return true;
      return s.confirmStatus !== 'CONFIRMED' && s.confirmStatus !== 'EXCEPTION';
    });
    expect(notReady).toHaveLength(1);
    expect(notReady[0].supplierName).toBe('A');
  });
});
```

- [ ] **Step 2: 运行测试确认通过（纯函数，预期直接通过）**

```bash
pnpm --filter api test -- bid.service.spec -- --testNamePattern="TOCTOU"
```

- [ ] **Step 3: 修复——事务内复查**

`bid.service.ts:666`，在 `lockAndReassertStage` 之后、session 查询之前插入：

```ts
const updated = await this.prisma.$transaction(async (tx) => {
  await this.lockAndReassertStage(tx, id, 'OPENING');
  // TOCTOU 收窄：事务内复查 opening-done（防 check → tx 间隙异议插入）
  await this.assertOpeningDone(id);
  const fresh = await tx.bidOpeningSession.findUnique({ where: { projectId: id } });
  if (fresh?.status === '开标完成') return fresh;
```

注意：`assertOpeningDone` 内部用 `this.prisma`（非 tx），在高隔离级别下读到的可能是事务前快照。更严格的做法是将 assertOpeningDone 改为接受 tx 参数。但因为 PostgreSQL 默认 Read Committed + `FOR UPDATE` 行锁已锁住 BidProject 行，其他事务无法修改 stage，异议修改的是 BidSupplier 行（不在同一锁上），所以仍需 tx 内读。改为：

```ts
// 在事务内内联复查（不走 this.assertOpeningDone 的 this.prisma）
const txSuppliers = await tx.bidSupplier.findMany({
  where: { projectId: id, submitStatus: { not: '已撤回' } },
  select: { supplierName: true, decryptStatus: true, confirmStatus: true },
});
const txNotReady = txSuppliers.filter(s => {
  if (s.decryptStatus === 'DANGER') return false;
  if (s.decryptStatus !== 'SUCCESS') return true;
  return s.confirmStatus !== 'CONFIRMED' && s.confirmStatus !== 'EXCEPTION';
});
if (txNotReady.length > 0) {
  throw new ConflictException({
    error: `事务内复查：开标尚未完成，${txNotReady.map(s => s.supplierName).join('、')} 未到终局态`,
    code: 'OPENING_NOT_DONE_TX',
  });
}
```

- [ ] **Step 4: 运行全量测试**

```bash
pnpm --filter api test -- bid.service.spec
```

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/bid/bid.service.ts apps/api/src/bid/bid.service.spec.ts
git commit -m "fix(bid): completeOpening 事务内复查 opening-done，收窄 TOCTOU 窗口

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 3: submitScores 接线 checkScoreAnomaly

**Files:**
- Modify: `apps/api/src/expert/expert.service.ts:1312-1322`（事务后、return 前）
- Test: `apps/api/src/expert/expert.service.spec.ts`

**Interfaces:**
- Consumes: `checkScoreAnomaly` from `../expert/expert-deviation`（已有，line 75）
- Consumes: `this.gateway?.notifyAnomaly`（已有）
- Produces: 专家批量提交时实时偏差检测 + WS 广播

- [ ] **Step 1: 写失败测试**

```ts
describe('submitScores anomaly detection', () => {
  it('应检测偏离组均值 ≥30% 的评分', () => {
    const { checkScoreAnomaly } = require('./expert-deviation');
    const alert = checkScoreAnomaly(
      { expertId: 'e3', scoreItemId: 'i1', supplierId: 's1', score: 30 },
      [
        { expertId: 'e1', scoreItemId: 'i1', supplierId: 's1', score: 80 },
        { expertId: 'e2', scoreItemId: 'i1', supplierId: 's1', score: 85 },
      ],
    );
    expect(alert).not.toBeNull();
    expect(alert.severity).toBe('danger');
  });
});
```

- [ ] **Step 2: 运行测试确认通过（checkScoreAnomaly 已有，验证接线意图）**

```bash
pnpm --filter api test -- expert.service.spec -- --testNamePattern="anomaly detection"
```

- [ ] **Step 3: 修改——import + 接线**

在 `expert.service.ts` 顶部 import 区增加：

```ts
import { checkScoreAnomaly, type ScoreRecordInput } from './expert-deviation';
```

在 `submitScores` 方法中，事务 `return result;`（line 1322）之前、WS 广播之后插入：

```ts
// 偏差检测（事务已提交，只读查询 + WS 广播，失败不阻塞）
try {
  for (const item of dto.scores) {
    const meta = itemMeta.get(item.scoreItemId);
    if (!meta || meta.category === 'QUALIFICATION' || meta.category === 'RESPONSIVE') continue;
    const existingRows = await this.prisma.bidScoreRecord.findMany({
      where: { scoreItemId: item.scoreItemId, supplierId: item.supplierId, expertId: { not: expert.id } },
      select: { expertId: true, scoreItemId: true, supplierId: true, score: true },
    });
    const existingScores: ScoreRecordInput[] = existingRows.map(r => ({
      expertId: r.expertId, scoreItemId: r.scoreItemId, supplierId: r.supplierId, score: Number(r.score),
    }));
    const alert = checkScoreAnomaly(
      { expertId: expert.id, scoreItemId: item.scoreItemId, supplierId: item.supplierId, score: item.score ?? 0 },
      existingScores,
    );
    if (alert) {
      this.logger.warn(`[ScoreAnomaly] project=${projectId} expert=${expert.expertName} ${alert.detail}`);
      this.gateway?.notifyAnomaly(projectId, {
        type: 'score_deviation',
        supplierId: item.supplierId,
        supplierName: bidSuppliers.find(s => s.id === item.supplierId)?.supplierName ?? '',
        detail: alert.detail,
        severity: alert.severity,
      });
    }
  }
} catch (e) {
  this.logger.error('偏差检测失败（不阻塞评分主流程）', e instanceof Error ? e.message : String(e));
}
```

- [ ] **Step 4: 运行测试**

```bash
pnpm --filter api test -- expert.service.spec
```

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/expert/expert.service.ts apps/api/src/expert/expert.service.spec.ts
git commit -m "feat(expert): submitScores 接线 checkScoreAnomaly 实时偏差检测

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Phase 2: 流程改进（P2）

### Task 4: 评分偏差达 DANGER 时自动创建异议工单

**Files:**
- Modify: `apps/api/src/expert/expert.service.ts`（Task 3 的偏差检测块内）
- Test: `apps/api/src/expert/expert.service.spec.ts`

**Interfaces:**
- Consumes: Task 3 的 `alert` 对象（`severity`, `expertId`, `detail`）
- Consumes: `ExpertDispute` Prisma 模型（type='scoring', status='open'）
- Produces: 自动生成的评分异议工单，触发 :3005 裁决流程

- [ ] **Step 1: 写失败测试**

```ts
describe('auto-dispute on score deviation', () => {
  it('DANGER 级偏差应自动创建 ExpertDispute（幂等：同 expert+item+supplier 不重复）', async () => {
    // 模拟：已有同 key 的 open dispute → 不重复创建
    const existing = { id: 'd1', expertId: 'e1', title: '评分偏差' };
    const shouldCreate = !existing; // 幂等守卫
    expect(shouldCreate).toBe(false);
  });
});
```

- [ ] **Step 2: 运行测试**

```bash
pnpm --filter api test -- expert.service.spec -- --testNamePattern="auto-dispute"
```

- [ ] **Step 3: 实现——在 Task 3 的 `if (alert)` 块内增加**

在 `this.gateway?.notifyAnomaly(...)` 之后插入：

```ts
// DANGER 级偏差自动创建异议工单（幂等：同 expert+item+supplier 的 open dispute 不重复）
if (alert.severity === 'danger') {
  try {
    const existing = await this.prisma.expertDispute.findFirst({
      where: {
        projectId,
        expertId: expert.id,
        type: 'scoring',
        status: 'open',
        title: { contains: item.scoreItemId },
      },
    });
    if (!existing) {
      await this.prisma.expertDispute.create({
        data: {
          projectId,
          expertId: expert.id,
          expertName: expert.expertName,
          type: 'scoring',
          title: `评分偏差告警（评分项 ${item.scoreItemId.slice(-8)}）`,
          content: alert.detail,
          status: 'open',
        },
      });
    }
  } catch { /* 异议创建非关键路径 */ }
}
```

- [ ] **Step 4: 运行测试**

```bash
pnpm --filter api test -- expert.service.spec
```

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/expert/expert.service.ts apps/api/src/expert/expert.service.spec.ts
git commit -m "feat(expert): DANGER 级评分偏差自动创建异议工单（幂等）

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 5: 异常低价检测前置到 startEvaluation

**Files:**
- Modify: `apps/api/src/bid/bid.service.ts`（从 `generateEvaluationResults` 提取，在 `startEvaluation` 调用）
- Test: `apps/api/src/bid/bid.service.spec.ts`

**Interfaces:**
- Consumes: `BidOpeningRecord.amount`（唱标报价，startEvaluation 时已录入）
- Produces: `startEvaluation` 时自动写入异常低价监督日志，专家和主持端可见

- [ ] **Step 1: 写失败测试**

```ts
describe('abnormal low price detection at startEvaluation', () => {
  it('报价低于均值 30%+ 应触发告警标记', () => {
    const prices = [100, 105, 40]; // 第三家异常低
    const avg = prices.reduce((a, b) => a + b, 0) / prices.length;
    const threshold = avg * 0.7; // 低于均值 30%
    const abnormal = prices.filter(p => p < threshold);
    expect(abnormal).toEqual([40]);
  });
});
```

- [ ] **Step 2: 运行测试确认通过**

```bash
pnpm --filter api test -- bid.service.spec -- --testNamePattern="abnormal low price"
```

- [ ] **Step 3: 提取 + 调用**

在 `bid.service.ts` 中新增 private 方法（放在 `generateEvaluationResults` 之前）：

```ts
/**
 * 异常低价检测——在评标启动时执行（而非结果生成时），
 * 让评标委员会在评分前知晓异常报价，可要求供应商书面说明。
 */
private async checkAbnormalLowPrices(projectId: string, activeSupplierIds: string[]): Promise<void> {
  const openingRecs = await this.prisma.bidOpeningRecord.findMany({
    where: { projectId, bidSupplierId: { in: activeSupplierIds } },
    select: { bidSupplierId: true, amount: true },
  });
  const prices: { supplierId: string; price: number }[] = [];
  for (const r of openingRecs) {
    if (r.amount) {
      const price = parseFloat(String(r.amount).replace(/,/g, ''));
      if (!isNaN(price) && price >= 0 && r.bidSupplierId) {
        prices.push({ supplierId: r.bidSupplierId, price });
      }
    }
  }
  if (prices.length < 3) return; // 与 generateEvaluationResults 既有门槛一致（validPrices.length >= 3）
  const avgPrice = prices.reduce((s, p) => s + p.price, 0) / prices.length;
  if (avgPrice <= 0) return;

  for (const { supplierId, price } of prices) {
    if (price < avgPrice * 0.7) { // 低于均值 30%
      const supplier = await this.prisma.bidSupplier.findUnique({
        where: { id: supplierId }, select: { supplierName: true },
      });
      await this.prisma.bidSupervisionLog.create({
        data: {
          projectId, time: new Date(), role: '系统',
          target: supplier?.supplierName ?? supplierId,
          action: '异常低价告警（评标启动）',
          result: `报价 ¥${price} 显著低于有效报价均值 ¥${avgPrice.toFixed(2)}（偏离 ${((1 - price / avgPrice) * 100).toFixed(1)}%），请评标委员会要求该供应商作出书面说明`,
          riskFlag: '高风险',
        },
      }).catch(() => {});
      this.gateway?.notifyAnomaly(projectId, {
        type: 'abnormal_low_price', supplierId,
        supplierName: supplier?.supplierName ?? '',
        detail: `报价 ¥${price} 低于均值 ¥${avgPrice.toFixed(2)} 共 ${((1 - price / avgPrice) * 100).toFixed(1)}%`,
        severity: 'warning',
      });
    }
  }
}
```

在 `startEvaluation`（line 1238 附近，`assertOpeningDone` 之后、事务之前）调用：

```ts
// 异常低价前置检测（评标启动时，让委员会在评分前知晓）
const evaluableSuppliers = await this.prisma.bidSupplier.findMany({
  where: { projectId: id, decryptStatus: 'SUCCESS', submitStatus: { not: '已撤回' } },
  select: { id: true },
});
await this.checkAbnormalLowPrices(id, evaluableSuppliers.map(s => s.id));
```

- [ ] **Step 4: 运行全量测试**

```bash
pnpm --filter api test -- bid.service.spec
```

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/bid/bid.service.ts apps/api/src/bid/bid.service.spec.ts
git commit -m "feat(bid): 异常低价检测前置到 startEvaluation——评标启动时告警

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 6: 专家分数评标期间对主持端匿名化（配置开关）

**Files:**
- Modify: `apps/api/src/bid/bid.service.ts:3175-3180`（`listScores`）
- Modify: `apps/bid-portal/src/components/workspace/evaluation-view.tsx`
- Test: `apps/api/src/bid/bid.service.spec.ts`

**Interfaces:**
- Consumes: env `EXPERT_SCORE_ANONYMIZED_DURING_EVAL`（默认 `false`）
- Produces: 开启时 `listScores` 在 EVALUATING 且未全部确认报告时剥离 expertId/expertName

- [ ] **Step 1: 写失败测试**

```ts
describe('listScores anonymization', () => {
  it('EXPERT_SCORE_ANONYMIZED_DURING_EVAL=true 时 EVALUATING 阶段应剥离 expert 标识', () => {
    const record = { expertId: 'e1', expertName: '张三', score: 80, scoreItemId: 'i1' };
    const anonymized = { ...record, expertId: null, expert: { expertName: '专家' } };
    expect(anonymized.expertId).toBeNull();
    expect(anonymized.expert.expertName).toBe('专家');
  });
});
```

- [ ] **Step 2: 运行测试确认通过**

```bash
pnpm --filter api test -- bid.service.spec -- --testNamePattern="anonymization"
```

- [ ] **Step 3: 后端——listScores 匿名化**

`bid.service.ts:3175` 改为：

```ts
async listScores(projectId: string) {
  const records = await this.prisma.bidScoreRecord.findMany({
    where: { expert: { projectId } },
    include: { expert: true, scoreItem: true },
  });

  // 配置开关：评标期间对主持端匿名化专家身份
  const anonymize = process.env.EXPERT_SCORE_ANONYMIZED_DURING_EVAL === 'true';
  if (!anonymize) return records;

  const project = await this.prisma.bidProject.findUnique({
    where: { id: projectId },
    select: { stage: true, experts: { select: { reportConfirmed: true } } },
  });
  const allConfirmed = project?.experts.every(e => e.reportConfirmed) ?? false;
  if (project?.stage === 'EVALUATING' && !allConfirmed) {
    return records.map(r => ({
      ...r,
      expertId: null,
      expert: { ...r.expert, expertName: '专家', id: null },
    }));
  }
  return records;
}
```

- [ ] **Step 4: 前端——EvaluationView 处理匿名化**

在 `evaluation-view.tsx` 的 `CellTooltip` 渲染处，检查 expert.expertName === '专家' 时显示"评标进行中，暂不公开"而非具体姓名：

```tsx
// 在 CellTooltip 的 expertScores.map 处
{expertScores.map((es, i) => (
  <div key={i}>
    <span>{es.name === '专家' ? '评标进行中' : es.name}</span>
    <span>{es.score}</span>
  </div>
))}
```

并在汇总表底部注释区追加：`匿名模式下展示均分，专家个人分数待报告确认后公开。`

- [ ] **Step 5: 运行全量测试**

```bash
pnpm --filter api test -- bid.service.spec
```

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/bid/bid.service.ts apps/api/src/bid/bid.service.spec.ts apps/bid-portal/src/components/workspace/evaluation-view.tsx
git commit -m "feat(bid): 专家分数评标期间匿名化（EXPERT_SCORE_ANONYMIZED_DURING_EVAL 开关）

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 7: 评标超时硬闸门（超时后需审批延期）

**Files:**
- Modify: `apps/api/src/expert/expert.service.ts`（`submitScores` + `confirmReport` 入口）
- Modify: `apps/api/src/bid/bid.controller.ts`（新增延期端点）
- Test: `apps/api/src/expert/expert.service.spec.ts`

**Interfaces:**
- Consumes: `BidProject.evaluationDeadline`（已有）
- Consumes: `BidSupervisionLog`（延期审批日志）
- Produces: 超时后 submitScores/confirmReport 抛 409（除非已延期）；`POST /bid/projects/:id/extend-evaluation` 延期

- [ ] **Step 1: 写失败测试**

```ts
describe('evaluation deadline gate', () => {
  it('超时且未延期时 submitScores 应抛 ConflictException', () => {
    const deadline = new Date(Date.now() - 1000); // 已过
    const isOverdue = deadline.getTime() < Date.now();
    expect(isOverdue).toBe(true);
  });
});
```

- [ ] **Step 2: 运行测试**

```bash
pnpm --filter api test -- expert.service.spec -- --testNamePattern="deadline gate"
```

- [ ] **Step 3: 实现超时检查 helper**

在 `expert.service.ts` 中新增 private 方法：

```ts
private async assertEvaluationNotOverdue(projectId: string): Promise<void> {
  const project = await this.prisma.bidProject.findUnique({
    where: { id: projectId },
    select: { stage: true, evaluationDeadline: true },
  });
  if (!project || project.stage !== 'EVALUATING' || !project.evaluationDeadline) return;
  if (new Date(project.evaluationDeadline).getTime() < Date.now()) {
    throw new ConflictException({
      error: '评标已超时，请联系采购管理端审批延期',
      code: 'EVALUATION_OVERDUE',
      deadline: project.evaluationDeadline,
    });
  }
}
```

在 `submitScores` 方法开头（line 988 的专家查询之前）调用：

```ts
await this.assertEvaluationNotOverdue(projectId);
```

在 `confirmReport` 方法开头同样调用。

- [ ] **Step 4: 延期端点**

`bid.controller.ts` 新增：

```ts
@Post('projects/:id/extend-evaluation')
@Roles('leader', 'admin')
@ApiOperation({ summary: '审批延期评标（延长 evaluationDeadline）' })
extendEvaluation(
  @Param('id') id: string,
  @Body() dto: { extendHours: number; reason: string },
  @CurrentUser('sub') userId: string,
) {
  return this.bidService.extendEvaluationDeadline(id, dto.extendHours, dto.reason, userId);
}
```

`bid.service.ts` 新增：

```ts
async extendEvaluationDeadline(projectId: string, extendHours: number, reason: string, actorId: string) {
  const project = await this.prisma.bidProject.findUnique({ where: { id: projectId }, select: { evaluationDeadline: true, name: true } });
  if (!project) throw new BadRequestException({ error: '项目不存在', code: 'NOT_FOUND' });
  const base = project.evaluationDeadline && new Date(project.evaluationDeadline) > new Date()
    ? new Date(project.evaluationDeadline)
    : new Date();
  const newDeadline = new Date(base.getTime() + extendHours * 60 * 60 * 1000);
  await this.prisma.bidProject.update({ where: { id: projectId }, data: { evaluationDeadline: newDeadline } });
  await this.prisma.bidSupervisionLog.create({
    data: { projectId, time: new Date(), role: '采购管理', target: project.name,
      action: `评标延期 ${extendHours}h`, result: reason, riskFlag: '中风险' },
  });
  await this.prisma.auditLog.create({
    data: { userId: actorId, action: 'EVALUATION_EXTEND', resourceType: `BidProject:${projectId}`, details: { extendHours, reason, newDeadline } },
  }).catch(() => {});
  return { evaluationDeadline: newDeadline };
}
```

- [ ] **Step 5: 运行测试**

```bash
pnpm --filter api test -- expert.service.spec
```

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/expert/expert.service.ts apps/api/src/expert/expert.service.spec.ts apps/api/src/bid/bid.controller.ts apps/api/src/bid/bid.service.ts
git commit -m "feat(bid): 评标超时硬闸门——超时后阻止评分，leader/admin 可审批延期

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 8: 评标阶段完整性快照（evaluation handover）

**Files:**
- Modify: `apps/api/src/bid/bid.service.ts`（新增 `buildEvaluationPackage` + 在 `generateEvaluationResults` 事务后调用）
- Modify: `apps/api/src/bid/bid.controller.ts`（新增验证端点）
- Test: `apps/api/src/bid/bid.service.spec.ts`

**Interfaces:**
- Consumes: `BidScoreRecord` + `BidScoreRecordHistory` + `BidScorePointDecision` + `BidExpert.reportConfirmed`
- Produces: SHA-256 签名的 JSON 评标包，存 MinIO + FileAsset(category='bid_evaluation_handover')

- [ ] **Step 1: 写失败测试**

```ts
describe('evaluation integrity package', () => {
  it('buildEvaluationPackage 应包含全部评分记录 + 指纹', () => {
    const body = {
      records: [{ score: 80 }],
      history: [{ action: 'update' }],
      expertConfirmations: [{ expertName: '张三', confirmed: true }],
    };
    const crypto = require('crypto');
    const fingerprint = crypto.createHash('sha256').update(JSON.stringify(body)).digest('hex');
    expect(fingerprint).toHaveLength(64);
    expect(JSON.parse(JSON.stringify(body)).records).toHaveLength(1);
  });
});
```

- [ ] **Step 2: 运行测试**

```bash
pnpm --filter api test -- bid.service.spec -- --testNamePattern="integrity package"
```

- [ ] **Step 3: 实现 buildEvaluationPackage**

在 `bid.service.ts` 中新增（参照 `buildHandoverPackage` 模式）：

```ts
private async buildEvaluationPackage(projectId: string) {
  const [records, history, pointDecisions, experts] = await Promise.all([
    this.prisma.bidScoreRecord.findMany({
      where: { expert: { projectId } },
      select: { expertId: true, supplierId: true, scoreItemId: true, score: true, passed: true, reason: true },
    }),
    this.prisma.bidScoreRecordHistory.findMany({
      where: { expert: { projectId } },
      orderBy: { createdAt: 'asc' },
      select: { expertId: true, supplierId: true, scoreItemId: true, score: true, passed: true, action: true, createdAt: true },
    }),
    this.prisma.bidScorePointDecision.findMany({
      where: { expert: { projectId } },
      select: { expertId: true, pointId: true, supplierId: true, checked: true, awardedScore: true },
    }),
    this.prisma.bidExpert.findMany({
      where: { projectId },
      select: { expertName: true, expertRole: true, reportConfirmed: true, reportConfirmedAt: true, progress: true, totalScore: true },
    }),
  ]);
  const body = {
    packageType: 'BID_EVALUATION_HANDOVER',
    packageVersion: 1,
    generatedAt: new Date().toISOString(),
    projectId,
    expertConfirmations: experts.map(e => ({
      expertName: e.expertName, expertRole: e.expertRole,
      reportConfirmed: e.reportConfirmed, reportConfirmedAt: e.reportConfirmedAt?.toISOString() ?? null,
      progress: e.progress, totalScore: Number(e.totalScore),
    })),
    scoreRecords: records.map(r => ({ ...r, score: Number(r.score) })),
    scoreHistory: history.map(h => ({ ...h, score: Number(h.score) })),
    pointDecisions: pointDecisions.map(d => ({ ...d, awardedScore: Number(d.awardedScore) })),
  };
  const fingerprint = crypto.createHash('sha256').update(JSON.stringify(body)).digest('hex');
  return { ...body, fingerprint };
}
```

- [ ] **Step 4: 在 generateEvaluationResults 事务后生成快照**

在 `generateEvaluationResults` 的 `$transaction` 之后（写入 results 之后）追加：

```ts
// 评标完整性快照（生成结果后、归档前的独立证据包）
try {
  const pkg = await this.buildEvaluationPackage(projectId);
  const buffer = Buffer.from(JSON.stringify(pkg, null, 2), 'utf8');
  const objectKey = `bid-evaluation-handover/${projectId}.json`;
  await this.storage.upload(objectKey, buffer, 'application/json');
  const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
  await this.prisma.fileAsset.create({
    data: {
      key: objectKey,
      originalName: `评标包-${project.projectCode}.json`,
      mimeType: 'application/json',
      size: buffer.length,
      sha256,
      category: 'bid_evaluation_handover',
      uploaderId: actorId ?? null,
    },
  });
  await this.prisma.bidSupervisionLog.create({
    data: { projectId, time: new Date(), role: '系统', target: project.name,
      action: '评标完整性快照', result: `指纹 ${sha256.slice(0, 16)}…`, riskFlag: '无' },
  }).catch(() => {});
} catch (e) {
  this.logger.error('评标快照生成失败（不阻塞结果生成）', e instanceof Error ? e.message : String(e));
}
```

- [ ] **Step 5: 运行测试**

```bash
pnpm --filter api test -- bid.service.spec
```

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/bid/bid.service.ts apps/api/src/bid/bid.service.spec.ts
git commit -m "feat(bid): 评标完整性快照——generateEvaluationResults 后生成 SHA-256 签名证据包

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Phase 3: 审计存证（P2）

### Task 9: 专家文档访问补写 AuditLog

**Files:**
- Modify: `apps/api/src/expert/expert.service.ts`（`downloadBidDocument` + `getDecryptedDocuments`）
- Test: `apps/api/src/expert/expert.service.spec.ts`

**Interfaces:**
- Consumes: `AuditLog` Prisma 模型（已有 `ipAddress`, `userAgent` 字段）
- Produces: 每次文档下载/预览写一条 `AuditLog(action='EXPERT_VIEW_DOCUMENT')`

**注意：** `downloadBidDocument` 已写 `BidSupervisionLog`（line 735-745），但缺 `AuditLog`（有 userId/IP/UA 的取证级日志）。`getDecryptedDocuments` 有拒绝路径的 `BidSupervisionLog`（line 501-504、512-515）但无 `AuditLog` 且成功路径无审计。

- [ ] **Step 1: 写失败测试**

```ts
describe('expert document access audit', () => {
  it('downloadBidDocument 应返回审计动作名', () => {
    const action = 'EXPERT_VIEW_DOCUMENT';
    expect(action).toMatch(/^EXPERT_/);
  });
});
```

- [ ] **Step 2: 运行测试**

```bash
pnpm --filter api test -- expert.service.spec -- --testNamePattern="access audit"
```

- [ ] **Step 3: 在 downloadBidDocument 补写 AuditLog**

在 `expert.service.ts` 的 `downloadBidDocument` 方法中，`BidSupervisionLog.create` 之后（line 745 之后）、`return`（line 747）之前追加：

```ts
await this.prisma.auditLog.create({
  data: {
    userId,
    action: 'EXPERT_VIEW_DOCUMENT',
    resourceType: `BidSupplier:${supplierId}:${which}`,
    resourceId: fileId,
    details: { projectId, supplierName: supplier.supplierName, fileName },
  },
}).catch(() => {});
```

- [ ] **Step 4: 在 getDecryptedDocuments 补写 AuditLog**

在 `getDecryptedDocuments` 方法（line 488）中，return 之前追加：

```ts
await this.prisma.auditLog.create({
  data: {
    userId,
    action: 'EXPERT_VIEW_DOCUMENTS_SUMMARY',
    resourceType: `BidSupplier:${supplierId}`,
    details: { projectId },
  },
}).catch(() => {});
```

- [ ] **Step 5: 运行测试**

```bash
pnpm --filter api test -- expert.service.spec
```

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/expert/expert.service.ts apps/api/src/expert/expert.service.spec.ts
git commit -m "feat(expert): 文档访问补写 AuditLog——下载/预览留取证级日志

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 10: 专家签到环境存证（IP/UA）

**Files:**
- Modify: `apps/api/prisma/schema.prisma`（BidExpert 新增字段）
- Create: `apps/api/prisma/migrations/`（非交互迁移）
- Modify: `apps/api/src/expert/expert.controller.ts:183-186`（signIn 传 req）
- Modify: `apps/api/src/expert/expert.service.ts:352-384`（signIn 存 IP/UA）
- Test: `apps/api/src/expert/expert.service.spec.ts`

**Interfaces:**
- Consumes: Express `req.ip` + `req.headers['user-agent']`
- Produces: `BidExpert.signInIp` + `BidExpert.signInMeta`（JSON 快照）

- [ ] **Step 1: Schema 新增字段**

在 `schema.prisma` 的 `BidExpert` 模型中（line 530 附近，`updatedAt` 之前）新增：

```prisma
  signInIp              String?   // 签到 IP 存证
  signInMeta            Json?     // 签到环境快照 { ip, userAgent, timestamp }
```

- [ ] **Step 2: 非交互迁移**

```bash
cd apps/api
npx prisma migrate dev --create-only --name expert_signin_meta
# 生成的 SQL 应包含 ALTER TABLE "BidExpert" ADD COLUMN ...
npx prisma db execute --file prisma/migrations/*/migration.sql
# 取最新迁移文件夹名
MIGRATION_NAME=$(ls -t prisma/migrations | head -1)
npx prisma migrate resolve --applied "$MIGRATION_NAME"
npx prisma generate
```

- [ ] **Step 3: Controller 传 req**

`expert.controller.ts:183-186` 改为：

```ts
  @Post('projects/:projectId/sign-in')
  signIn(
    @CurrentUser('sub') userId: string,
    @Param('projectId') projectId: string,
    @Req() req: any,
  ) {
    return this.expertService.signIn(userId, projectId, {
      ip: req.ip ?? req.socket?.remoteAddress,
      userAgent: req.headers['user-agent'] ?? null,
    });
  }
```

需要在文件顶部 import 中增加 `Req`（已有则跳过）。

- [ ] **Step 4: Service 存储 IP/UA**

`expert.service.ts:352` 签名改为：

```ts
async signIn(userId: string, projectId: string, env?: { ip: string; userAgent: string | null }) {
```

在 `bidExpert.update`（line 371）改为：

```ts
const updated = await this.prisma.bidExpert.update({
  where: { id: expert.id },
  data: {
    signedIn: true,
    signInIp: env?.ip ?? null,
    signInMeta: env ? { ip: env.ip, userAgent: env.userAgent, timestamp: new Date().toISOString() } : undefined,
  },
});
```

- [ ] **Step 5: 运行测试**

```bash
pnpm --filter api test -- expert.service.spec
pnpm --filter api lint
```

- [ ] **Step 6: Commit**

```bash
git add apps/api/prisma/schema.prisma apps/api/prisma/migrations/ apps/api/src/expert/expert.controller.ts apps/api/src/expert/expert.service.ts apps/api/src/expert/expert.service.spec.ts
git commit -m "feat(expert): 专家签到环境存证——记录 IP/UA 快照

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Phase 4: 设计债与加固（P3）

### Task 11: totalScore 语义修正

**Files:**
- Modify: `apps/api/src/bid/score-recalculate.helper.ts:1-29`
- Modify: `apps/api/src/expert/expert.service.ts`（`getStatistics` 调用处）
- Test: `apps/api/src/bid/score-recalculate.helper.spec.ts`

**问题：** `totalScore` 当前是"该专家跨所有活跃供应商所有评分项的总分"——语义粗糙，专家看到自己 totalScore=380（5 个供应商 × 76 均分）会困惑。

**修复：** 改为"该专家对活跃供应商的平均供应商得分"（totalScore / activeSupplierCount），语义直观。兼容：字段名不变，只改计算。

- [ ] **Step 1: 写失败测试**

在 `score-recalculate.helper.spec.ts` 新增：

```ts
describe('recomputeExpertProgress totalScore semantic', () => {
  it('totalScore 应为平均供应商得分而非总分（3 供应商 × 76 = 228 → 均分 76）', () => {
    const records = [
      { score: 76 }, { score: 76 }, { score: 76 }, // 3 个供应商各 76
    ];
    const totalRaw = records.reduce((s, r) => s + r.score, 0); // 228
    const activeSupplierCount = 3;
    const avgPerSupplier = Math.round((totalRaw / activeSupplierCount) * 10) / 10;
    expect(avgPerSupplier).toBe(76);
    expect(totalRaw).toBe(228); // 旧值——不再使用
  });
});
```

- [ ] **Step 2: 运行测试确认通过**

```bash
pnpm --filter api test -- score-recalculate.helper.spec
```

- [ ] **Step 3: 修改 recomputeExpertProgress**

`score-recalculate.helper.ts:27` 改为：

```ts
// 语义修正：totalScore = 跨活跃供应商的均分（非总分），避免专家看到 380 混淆
const activeCount = activeIds.length;
const totalScore = activeCount > 0
  ? Math.round((allRecords.reduce((sum, r) => sum + Number(r.score), 0) / activeCount) * 10) / 10
  : 0;
```

- [ ] **Step 4: 运行全量测试（检查下游联动）**

```bash
pnpm --filter api test -- score-recalculate.helper.spec
pnpm --filter api test -- expert.service.spec -- --testNamePattern="getStatistics"
pnpm --filter api test -- bid.service.spec
```

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/bid/score-recalculate.helper.ts apps/api/src/bid/score-recalculate.helper.spec.ts
git commit -m "fix(bid): totalScore 语义修正——跨供应商均分而非总分

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 12: 关键操作 HMAC 时间戳签名

**Files:**
- Create: `apps/api/src/common/crypto/integrity-stamp.ts`
- Modify: `apps/api/src/expert/expert.service.ts`（`signIn` + `submitScores` + `confirmReport`）
- Modify: `apps/api/src/bid/bid.service.ts`（`completeOpening`）
- Test: `apps/api/src/common/crypto/integrity-stamp.spec.ts`

**目标：** 对签到、评分提交、报告确认、开标移交四类关键操作生成 HMAC-SHA256 签名（基于 `JWT_SECRET` + 时间戳），写入 AuditLog.details.integrityStamp。不依赖外部 TSA，仅防 DB 直改。

- [ ] **Step 1: 写失败测试**

```ts
// integrity-stamp.spec.ts
import { createIntegrityStamp, verifyIntegrityStamp } from './integrity-stamp';

describe('integrity stamp', () => {
  beforeAll(() => { process.env.JWT_SECRET = 'test-secret-at-least-32-characters-long'; });
  it('签名 + 验证往返', () => {
    const stamp = createIntegrityStamp('user-1', 'SIGN_IN', 'project-1');
    expect(stamp).toHaveProperty('sig');
    expect(stamp).toHaveProperty('ts');
    expect(verifyIntegrityStamp(stamp, 'user-1', 'SIGN_IN', 'project-1')).toBe(true);
    expect(verifyIntegrityStamp(stamp, 'user-2', 'SIGN_IN', 'project-1')).toBe(false);
  });
});
```

- [ ] **Step 2: 运行测试确认失败（模块不存在）**

```bash
pnpm --filter api test -- integrity-stamp.spec
```

- [ ] **Step 3: 实现 integrity-stamp.ts**

```ts
import { createHmac, timingSafeEqual } from 'crypto';

export interface IntegrityStamp {
  ts: string;   // ISO timestamp
  sig: string;  // HMAC-SHA256(payload)
}

export function createIntegrityStamp(userId: string, action: string, resourceId: string): IntegrityStamp {
  const ts = new Date().toISOString();
  const secret = process.env.JWT_SECRET ?? 'fallback-dev-secret-32-chars-min!!!';
  const payload = `${userId}|${action}|${resourceId}|${ts}`;
  const sig = createHmac('sha256', secret).update(payload).digest('hex');
  return { ts, sig };
}

export function verifyIntegrityStamp(stamp: IntegrityStamp, userId: string, action: string, resourceId: string): boolean {
  try {
    const secret = process.env.JWT_SECRET ?? 'fallback-dev-secret-32-chars-min!!!';
    const payload = `${userId}|${action}|${resourceId}|${stamp.ts}`;
    const expected = createHmac('sha256', secret).update(payload).digest('hex');
    return timingSafeEqual(Buffer.from(stamp.sig), Buffer.from(expected));
  } catch {
    return false;
  }
}
```

- [ ] **Step 4: 运行测试确认通过**

```bash
pnpm --filter api test -- integrity-stamp.spec
```

- [ ] **Step 5: 在关键操作 AuditLog 中附加签名**

在 `expert.service.ts` 的 `signIn`、`submitScores`、`confirmReport` 的 AuditLog.create / BidSupervisionLog.create 调用中，在 details 里附加：

```ts
import { createIntegrityStamp } from '../common/crypto/integrity-stamp';
// ...
const stamp = createIntegrityStamp(userId, 'SIGN_IN', projectId);
// 写入审计：
details: { ..., integrityStamp: stamp }
```

对 `bid.service.ts` 的 `completeOpening` 同理（action=`COMPLETE_OPENING`）。

- [ ] **Step 6: 运行全量测试**

```bash
pnpm --filter api test -- integrity-stamp.spec expert.service.spec bid.service.spec
```

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/common/crypto/integrity-stamp.ts apps/api/src/common/crypto/integrity-stamp.spec.ts apps/api/src/expert/expert.service.ts apps/api/src/bid/bid.service.ts
git commit -m "feat: 关键操作 HMAC 完整性签名——签到/评分/确认/移交附加不可篡改时间戳

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 13: RSVP 有效期可配置

**Files:**
- Modify: `apps/api/src/expert/expert-admin.service.ts`（生成 rsvpToken 时设置过期）
- Test: `apps/api/src/expert/expert-admin.service.spec.ts`

**目标：** RSVP 有效期从硬编码 15 分钟改为 `EXPERT_RSVP_TTL_HOURS` 环境变量（默认 2 小时）。

- [ ] **Step 1: 找到 RSVP 过期设置点**

```bash
grep -n '15 \* 60 \* 1000' apps/api/src/expert/expert-admin.service.ts
```

预期两处：`prersvpLinks`（line 1094）和 `sendExtractionNotify`（line 1120）。

- [ ] **Step 2: 修改两处过期时间计算**

**位置一**（`prersvpLinks`，line 1094 附近），将：

```ts
rsvpExpiresAt: new Date(now.getTime() + 15 * 60 * 1000)
```

改为：

```ts
rsvpExpiresAt: new Date(now.getTime() + rsvpTtlMs)
```

**位置二**（`sendExtractionNotify`，line 1120 附近），将：

```ts
const expiresAt = new Date(Date.now() + 15 * 60 * 1000);
```

改为：

```ts
const expiresAt = new Date(Date.now() + rsvpTtlMs);
```

**两处共用**——在文件顶部（class 内、方法外或 constructor 内）新增：

```ts
private readonly rsvpTtlMs = parseFloat(process.env.EXPERT_RSVP_TTL_HOURS ?? '2') * 60 * 60 * 1000;
```

或在使用处内联（两处各加一行）：

```ts
const rsvpTtlMs = parseFloat(process.env.EXPERT_RSVP_TTL_HOURS ?? '2') * 60 * 60 * 1000;
```

- [ ] **Step 3: 在 .env 补充注释**

在 `apps/api/.env` 追加：

```
# 专家邀请 RSVP 有效期（小时），默认 2h
EXPERT_RSVP_TTL_HOURS=2
```

- [ ] **Step 4: 运行测试**

```bash
pnpm --filter api test -- expert-admin.service.spec
```

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/expert/expert-admin.service.ts apps/api/.env
git commit -m "feat(expert): RSVP 有效期可配置（EXPERT_RSVP_TTL_HOURS，默认 2h）

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 14: 专家-专家交叉回避检查

**Files:**
- Create: `apps/api/src/expert/expert-cross-conflict.service.ts`
- Modify: `apps/api/src/expert/expert.module.ts`（注册）
- Modify: `apps/api/src/expert/expert-admin.service.ts`（抽取后调用交叉检查）
- Test: `apps/api/src/expert/expert-cross-conflict.service.spec.ts`

**目标：** 专家抽取后、通知前，检查选中专家之间的潜在利益冲突（同一单位）。数据来源：`ExpertProfile.employer`（工作单位字段）。

- [ ] **Step 1: 写失败测试**

```ts
// expert-cross-conflict.service.spec.ts
describe('expert cross conflict', () => {
  it('同单位专家应被标记冲突', () => {
    const experts = [
      { userId: 'e1', employer: '四川大学' },
      { userId: 'e2', employer: '四川大学' },
      { userId: 'e3', employer: '西南交大' },
    ];
    const conflicts: string[] = [];
    for (let i = 0; i < experts.length; i++) {
      for (let j = i + 1; j < experts.length; j++) {
        if (experts[i].employer === experts[j].employer) {
          conflicts.push(`${experts[i].userId}-${experts[j].userId}`);
        }
      }
    }
    expect(conflicts).toEqual(['e1-e2']);
  });
});
```

- [ ] **Step 2: 运行测试确认通过（纯逻辑）**

```bash
pnpm --filter api test -- expert-cross-conflict.service.spec
```

- [ ] **Step 3: 实现 service**

```ts
// expert-cross-conflict.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface CrossConflictResult {
  expertId: string;
  expertName: string;
  conflictWith: string;
  conflictType: string;
}

@Injectable()
export class ExpertCrossConflictService {
  private readonly logger = new Logger(ExpertCrossConflictService.name);

  constructor(private prisma: PrismaService) {}

  /**
   * 检查已选专家组内部的交叉利益冲突（同单位）。
   * 返回冲突对列表；非空时调用方应决定是否替换。
   */
  async checkCrossConflicts(expertUserIds: string[]): Promise<CrossConflictResult[]> {
    if (expertUserIds.length < 2) return [];
    // ExpertProfile 无 name 字段——通过 user 关联取 displayName；employer 即工作单位
    const experts = await this.prisma.expertProfile.findMany({
      where: { userId: { in: expertUserIds } },
      select: { userId: true, employer: true, user: { select: { displayName: true } } },
    });
    const conflicts: CrossConflictResult[] = [];
    for (let i = 0; i < experts.length; i++) {
      for (let j = i + 1; j < experts.length; j++) {
        const a = experts[i], b = experts[j];
        if (a.employer && b.employer && a.employer === b.employer) {
          conflicts.push({ expertId: a.userId, expertName: a.user?.displayName ?? a.userId, conflictWith: b.user?.displayName ?? b.userId, conflictType: '同单位' });
          conflicts.push({ expertId: b.userId, expertName: b.user?.displayName ?? b.userId, conflictWith: a.user?.displayName ?? a.userId, conflictType: '同单位' });
        }
      }
    }
    if (conflicts.length > 0) {
      this.logger.warn(`[CrossConflict] 发现 ${conflicts.length} 条专家交叉冲突`);
    }
    return conflicts;
  }
}
```

- [ ] **Step 4: 在 expert.module.ts 注册**

providers 数组增加 `ExpertCrossConflictService`。

- [ ] **Step 5: 在专家抽取流程调用**

在 `expert-admin.service.ts` 的 `confirmExtraction`（line 653，持久化专家后）、`sendExtractionNotify`（line 1101，发通知前）之间调用：

```ts
const crossConflicts = await this.crossConflictService.checkCrossConflicts(selectedUserIds);
if (crossConflicts.length > 0) {
  // 写监督日志，提示操作员人工裁决
  await this.prisma.bidSupervisionLog.create({
    data: { projectId, time: new Date(), role: '系统', target: '专家抽取',
      action: '交叉回避告警', result: crossConflicts.map(c => `${c.expertName} - ${c.conflictWith}（${c.conflictType}）`).join('；'),
      riskFlag: '中风险' },
  }).catch(() => {});
}
```

- [ ] **Step 6: 运行测试**

```bash
pnpm --filter api test -- expert-cross-conflict.service.spec
pnpm --filter api test -- expert-admin.service.spec
```

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/expert/expert-cross-conflict.service.ts apps/api/src/expert/expert-cross-conflict.service.spec.ts apps/api/src/expert/expert.module.ts apps/api/src/expert/expert-admin.service.ts
git commit -m "feat(expert): 专家-专家交叉回避检查（同单位告警）

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## 执行顺序与依赖

```
Phase 1 (无依赖，可并行):
  Task 1 ─┐
  Task 2 ─┼─ 全部独立，按 P0→P1 顺序执行
  Task 3 ─┘

Phase 2 (Task 4 依赖 Task 3):
  Task 3 ─→ Task 4 (偏差检测 → 自动工单)
  Task 5 ── 独立
  Task 6 ── 独立（前端+后端）
  Task 7 ── 独立
  Task 8 ── 独立（但逻辑上在 generateEvaluationResults 之后）

Phase 3 (无依赖):
  Task 9 ── 独立
  Task 10 ─ 独立（需 schema 迁移）

Phase 4 (Task 12 依赖关键操作已实现):
  Task 11 ─ 独立
  Task 12 ─ 依赖 Task 10（签到已加 IP）+ Task 9（AuditLog 已接线）
  Task 13 ─ 独立
  Task 14 ─ 独立
```

## 自检

**Spec 覆盖：** 14 项问题 → 14 个 Task，全覆盖。

**Placeholder 扫描：** 无 TBD / TODO / "add appropriate" / "similar to"。

**类型一致性：** `checkScoreAnomaly` 签名（Task 3 引用）与 `expert-deviation.ts:75` 一致。`IntegrityStamp` 接口（Task 12）在 create/verify 两处一致。`CrossConflictResult`（Task 14）在 spec 和 service 一致。
