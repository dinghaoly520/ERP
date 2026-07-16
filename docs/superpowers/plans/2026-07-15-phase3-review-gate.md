# Phase ③ 桌面核对关口 — 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`).

**Goal:** 专家打分后，必须在桌面端逐供应商"核对（审阅+可微调+确认）"才能进入报告确认——`draft→verified→reportConfirmed` 状态机。防止平板/误操作直接生效。

**Architecture:** 新建 `BidScoreReview`（per expert+project+supplier，status draft|verified）。`submitScores` 事务内为每个涉及的 supplier upsert 一条 `draft`。新端点 `verifyScoreReview` 把 draft→verified（仅桌面语义，后端不区分设备）。`confirmReport` 加 gate：该专家所有供应商 review 全 verified 才放行（否则 REVIEW_PENDING）。专家端新增 `verify-score` step（scoring 与 report 之间），复用 phase ② 的 `PointChecklistScoring` 只读+微调态。

**Tech Stack:** NestJS 11 + Prisma；Next.js 16 + React 19 + Tailwind v4；Jest。

## Global Constraints

- 工作目录 `water-erp/`。
- **新关系名 `scoreReviews`**（不用 `reviews`——`BidExpert.reviews` 已被 `BidRequirementReview` 占用，schema.prisma:367）。
- 分数不进 WS（bid-events.ts:7 铁律）。核对是专家本地操作，不发 WS 事件（spec §4，与 point decisions 一致）。
- `$transaction` mock 模式：`jest.fn(async (fn) => fn(prisma))` 重用外层 prisma mock（expert.service.spec.ts）。
- commit：中文 conventional + 空行 + `Co-Authored-By: Claude <noreply@anthropic.com>`。
- phase ② 已交付：`BidScorePointDecision`、`submitScores` checklist 汇总、`PointChecklistScoring` 组件、`recomputeExpertProgress`。

## 现状锚点（已核实，phase ② 后）

- `submitScores`（`expert.service.ts:741`）：事务 `:889-980`。事务内顺序：stage 检查 :891 → reportConfirmed 检查 :902 → **BidScorePointDecision upsert :912-921** → **BidScoreRecord upsert :922-941** → BidScoreDelta :943-957 → recomputeExpertProgress :960 → bidExpert.update :961-964 → supervisionLog :967-977。**BidScoreReview draft upsert 插在 :964 后（bidExpert.update 后、supervisionLog 前/并行）**。`supplierIds = Array.from(new Set(dto.scores.map(s=>s.supplierId)))`（:786）已算好去重 supplier 列表。
- `confirmReport`（`expert.service.ts:1213-1255`）：`:1227` `expert.progress < 100 → SCORING_INCOMPLETE`；`:1242-1245` 设 reportConfirmed。**verified gate 插在 :1227 后**。
- `getProject`（`:151-241`）：myExpertRecord 构造在 `:185-191`（展开 BidExpert 字段）。返回 `:234-240`。
- `getReport`（`:1198-1210` 附近）：返回 `canConfirm: expert.progress >= 100`。
- `BidExpert`（schema.prisma:350-376）：有 `scoreRecords`/`pointDecisions`/`reviews`(=BidRequirementReview)。加 `scoreReviews BidScoreReview[]`。
- controller（expert.controller.ts）：scores POST :156、my-scores GET :169、clarifications :174。review 端点插 :172-174 之间。
- evaluate page：Step 类型 :20、STEPS :21-28、stepAccessible/stepCompleted :128-146、SupplierSidebar 渲染条件 :783、report 渲染 :1437、activeSupplier :39。
- `report-step.tsx`（85 行）：props `{report, busy, onConfirmReport}`，canConfirm 按钮。
- `BidScoreReview` 确认不存在。

## File Structure

| 文件 | 责任 |
|------|------|
| `apps/api/prisma/schema.prisma` | `BidScoreReview` 模型 + `scoreReviews` relations（BidExpert/BidProject/BidSupplier）|
| `apps/api/src/expert/expert.service.ts` | submitScores 加 draft upsert；`verifyScoreReview`；confirmReport gate；getProject/getReport 返回 review |
| `apps/api/src/expert/expert.controller.ts` | verify 端点 + score-reviews 列表端点 |
| `apps/api/src/expert/expert.service.spec.ts` | draft upsert / verify / gate 测试 |
| `apps/expert-portal/src/components/evaluate/verify-score-step.tsx`（新） | 核对关口组件 |
| `apps/expert-portal/src/app/(app)/evaluate/[id]/page.tsx` | verify-score step + 渲染 + gating |
| `apps/expert-portal/src/lib/api.ts` | verifyScoreReview + 类型 |

---

### Task 1: `BidScoreReview` 模型 + migration

**Files:** `apps/api/prisma/schema.prisma`

- [ ] **Step 1: 加 relations**。`BidExpert`（:370 pointDecisions 后）加 `scoreReviews BidScoreReview[]`；`BidProject` 加 `scoreReviews BidScoreReview[]`；`BidSupplier`（pointDecisions 后）加 `scoreReviews BidScoreReview[]`。
- [ ] **Step 2: 新模型**（BidScorePointDecision 后，~:445）：
```prisma
model BidScoreReview {
  id          String    @id @default(cuid())
  expertId    String
  projectId   String
  supplierId  String
  status      String    @default("draft")   // "draft" | "verified"
  verifiedAt  DateTime?
  expert      BidExpert   @relation("BidScoreReviews", fields: [expertId], references: [id], onDelete: Cascade)
  project     BidProject  @relation(fields: [projectId], references: [id], onDelete: Cascade)
  supplier    BidSupplier @relation(fields: [supplierId], references: [id], onDelete: Restrict)
  createdAt   DateTime    @default(now())
  updatedAt   DateTime    @updatedAt

  @@unique([expertId, projectId, supplierId])
  @@index([expertId, supplierId])
  @@index([projectId, supplierId])
}
```
- [ ] **Step 3: migration** `PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION=1 npx prisma migrate dev --name add_score_review`（在 apps/api/；若遇 DB drift 用 surgical `migrate diff + db execute + migrate resolve`，见 memory expert-scoring-phases-status）。
- [ ] **Step 4: 验证** migrate status up to date + `pnpm db:generate`。
- [ ] **Step 5: Commit** `feat(db): 新增 BidScoreReview 核对关口模型` + trailer。

---

### Task 2: `submitScores` 事务内 upsert `BidScoreReview{draft}`（TDD）

**Files:** `expert.service.ts`（submitScores 事务 :964 后）；`expert.service.spec.ts`

**Interfaces:** Consumes Task 1 模型。Produces：每次 submitScores 为每个 distinct supplierId 写一条 draft review。

- [ ] **Step 1: spec mock 加 bidScoreReview**。外层 beforeEach prisma mock 加 `bidScoreReview: { upsert: jest.fn().mockResolvedValue({}), findMany: jest.fn().mockResolvedValue([]) }`。
- [ ] **Step 2: 写失败测试**（submitScores describe 内）：
```ts
it('submitScores：为每个供应商 upsert 一条 draft review', async () => {
  // 复用现有 signedExpert mock + 两供应商
  prisma.bidExpert.findFirst.mockResolvedValue({ ...signedExpert, id: 'exp1', expertName: '刘' });
  prisma.bidScoreItem.findMany.mockResolvedValue([{ id: 'si1', maxScore: 100, category: 'TECHNICAL' }]);
  prisma.bidScorePoint.findMany.mockResolvedValue([]);
  prisma.bidSupplier.findMany.mockResolvedValue([
    { id: 'sup1', supplierName: '甲', decryptStatus: 'SUCCESS', submitStatus: 'submitted' },
    { id: 'sup2', supplierName: '乙', decryptStatus: 'SUCCESS', submitStatus: 'submitted' },
  ]);
  prisma.bidProject.findUnique.mockResolvedValue({ stage: 'EVALUATING' });
  prisma.bidScoreRecord.upsert.mockResolvedValue({});
  prisma.bidScoreRecord.count.mockResolvedValue(1);
  prisma.bidScoreRecord.findMany.mockResolvedValue([{ score: 80 }]);

  await service.submitScores('user-1', 'proj-1', {
    supplierName: '甲、乙',
    scores: [
      { scoreItemId: 'si1', supplierId: 'sup1', score: 80, reason: '' },
      { scoreItemId: 'si1', supplierId: 'sup2', score: 70, reason: '' },
    ],
  } as any);

  expect(prisma.bidScoreReview.upsert).toHaveBeenCalledTimes(2);
  expect(prisma.bidScoreReview.upsert).toHaveBeenCalledWith(expect.objectContaining({
    where: { expertId_projectId_supplierId: { expertId: 'exp1', projectId: 'proj-1', supplierId: 'sup1' } },
    update: expect.objectContaining({ status: 'draft' }),   // 重新提交重置为 draft（专家改了分需重新核对）
    create: expect.objectContaining({ expertId: 'exp1', projectId: 'proj-1', supplierId: 'sup1', status: 'draft' }),
  }));
});
```
- [ ] **Step 3: 运行确认失败** `pnpm --filter api test -- expert.service.spec` → 新 case FAIL。
- [ ] **Step 4: 实现**（submitScores 事务内，`tx.bidExpert.update` 后 `:964`、supervisionLog 前）：
```ts
      // phase ③：为每个涉及的供应商 upsert draft review（已 verified 的，专家改分后重置为 draft 需重新核对）
      const reviewSupplierIds = Array.from(new Set(dto.scores.map(s => s.supplierId)));
      for (const sid of reviewSupplierIds) {
        await tx.bidScoreReview.upsert({
          where: { expertId_projectId_supplierId: { expertId: expert.id, projectId, supplierId: sid } },
          update: { status: 'draft', verifiedAt: null },
          create: { expertId: expert.id, projectId, supplierId: sid, status: 'draft' },
        });
      }
```
- [ ] **Step 5: 运行确认通过**（含原 submitScores 测试）。
- [ ] **Step 6: tsc clean。Commit** `feat(api): submitScores 为每供应商写 draft 核对记录` + trailer。

---

### Task 3: `verifyScoreReview` service + 端点（TDD）

**Files:** `expert.service.ts`（新方法）；`expert.controller.ts`（端点）；`expert.service.spec.ts`

**Interfaces:** Produces `verifyScoreReview(userId, projectId, supplierId)`：draft→verified。

- [ ] **Step 1: 写失败测试**：
```ts
describe('verifyScoreReview', () => {
  it('draft → verified，设 verifiedAt', async () => {
    prisma.bidExpert.findFirst.mockResolvedValue({ ...signedExpert, id: 'exp1' });
    prisma.bidScoreReview.upsert.mockResolvedValue({ id: 'rv1', status: 'verified' });
    prisma.bidScoreReview.findUnique.mockResolvedValue({ id: 'rv1', expertId: 'exp1', projectId: 'p1', supplierId: 'sup1', status: 'draft' });
    prisma.bidScoreReview.update.mockResolvedValue({ id: 'rv1', status: 'verified' });
    prisma.bidScoreRecord.findMany.mockResolvedValue([{ scoreItemId: 'si1', score: 80 }]); // 已有评分
    const r = await service.verifyScoreReview('user-1', 'p1', 'sup1');
    expect(prisma.bidScoreReview.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { expertId_projectId_supplierId: { expertId: 'exp1', projectId: 'p1', supplierId: 'sup1' } },
      data: expect.objectContaining({ status: 'verified' }),
    }));
    expect(r.status).toBe('verified');
  });
  it('未提交评分的供应商不能核对 → SCORING_INCOMPLETE', async () => {
    prisma.bidExpert.findFirst.mockResolvedValue({ ...signedExpert, id: 'exp1' });
    prisma.bidScoreRecord.findMany.mockResolvedValue([]); // 无评分
    await expect(service.verifyScoreReview('user-1', 'p1', 'sup1')).rejects.toMatchObject({ response: { code: 'SCORING_INCOMPLETE' } });
  });
  it('报告已锁定 → SCORE_LOCKED', async () => {
    prisma.bidExpert.findFirst.mockResolvedValue({ ...signedExpert, id: 'exp1', reportConfirmed: true });
    await expect(service.verifyScoreReview('user-1', 'p1', 'sup1')).rejects.toMatchObject({ response: { code: 'SCORE_LOCKED' } });
  });
});
```
- [ ] **Step 2: 运行确认失败**。
- [ ] **Step 3: 实现**（expert.service.ts，新方法）：
```ts
async verifyScoreReview(userId: string, projectId: string, supplierId: string) {
  const expert = await this.prisma.bidExpert.findFirst({ where: { userId, projectId } });
  if (!expert) throw new ForbiddenException({ error: '您不是该项目的评审专家', code: 'NOT_PROJECT_EXPERT' });
  if (expert.reportConfirmed) throw new BadRequestException({ error: '评审报告已确认，评分已锁定', code: 'SCORE_LOCKED' });
  // 必须先有评分记录
  const hasScores = await this.prisma.bidScoreRecord.findFirst({ where: { expertId: expert.id, supplierId } });
  if (!hasScores) throw new BadRequestException({ error: '该供应商尚未评分，无法核对', code: 'SCORING_INCOMPLETE' });
  const updated = await this.prisma.bidScoreReview.update({
    where: { expertId_projectId_supplierId: { expertId: expert.id, projectId, supplierId } },
    data: { status: 'verified', verifiedAt: new Date() },
  });
  await this.prisma.bidSupervisionLog.create({ data: { projectId, time: new Date(), role: '评审专家', target: expert.expertName, action: `核对评分完成（供应商）`, result: '已核对', riskFlag: '无' } });
  return updated;
}
```
- [ ] **Step 4: controller 端点**（:172 my-scores 后、clarifications 前）：
```ts
  @Post('projects/:projectId/suppliers/:supplierId/score-review/verify')
  @ApiOperation({ summary: '核对评分（draft→verified，桌面核对关口）' })
  verifyScoreReview(@Param('projectId') projectId: string, @Param('supplierId') supplierId: string) {
    return this.expertService.verifyScoreReview(req.userId, projectId, supplierId);
  }
```
> 注意：controller 需从 `@CurrentUser` 或现有方式拿 userId——看现有端点怎么取 userId（如 `getProject(@Param projectId, @Req req)` 或 `@CurrentUser`）。读现有 :43-46 getProject 的 userId 取法对齐。
- [ ] **Step 5: 运行确认通过** + tsc clean。**Step 6: Commit** `feat(api): 核对评分端点（draft→verified）` + trailer。

---

### Task 4: `confirmReport` 加 verified gate（TDD）

**Files:** `expert.service.ts`（confirmReport :1227 后）；`expert.service.spec.ts`

- [ ] **Step 1: 写失败测试**（confirmReport describe；若无则新建）：
```ts
it('confirmReport：有未核对供应商 → REVIEW_PENDING', async () => {
  prisma.bidExpert.findFirst.mockResolvedValue({ ...mockExpert, id: 'exp1', signedIn: true, avoidanceConfirmed: true, aiConsentConfirmed: true, progress: 100, reportConfirmed: false });
  prisma.bidProject.findUnique.mockResolvedValue({ stage: 'EVALUATING' });
  // 活跃供应商 2 个，但只有 1 个 verified
  prisma.bidSupplier.findMany.mockResolvedValue([{ id: 'sup1' }, { id: 'sup2' }]);
  prisma.bidScoreReview.findMany.mockResolvedValue([{ supplierId: 'sup1', status: 'verified' }]); // sup2 未核对
  await expect(service.confirmReport('user-1', 'p1')).rejects.toMatchObject({ response: { code: 'REVIEW_PENDING' } });
});
it('confirmReport：全部核对 → 通过', async () => {
  prisma.bidExpert.findFirst.mockResolvedValue({ ...mockExpert, id: 'exp1', signedIn: true, avoidanceConfirmed: true, aiConsentConfirmed: true, progress: 100, reportConfirmed: false });
  prisma.bidProject.findUnique.mockResolvedValue({ stage: 'EVALUATING' });
  prisma.bidSupplier.findMany.mockResolvedValue([{ id: 'sup1' }, { id: 'sup2' }]);
  prisma.bidScoreReview.findMany.mockResolvedValue([{ supplierId: 'sup1', status: 'verified' }, { supplierId: 'sup2', status: 'verified' }]);
  prisma.bidExpert.update.mockResolvedValue({});
  prisma.bidScoreDelta.updateMany.mockResolvedValue({ count: 0 });
  await service.confirmReport('user-1', 'p1'); // 不抛错
  expect(prisma.bidExpert.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ reportConfirmed: true }) }));
});
```
- [ ] **Step 2: 运行确认失败**。
- [ ] **Step 3: 实现**（confirmReport，`progress < 100` 检查后 `:1227`）：
```ts
  // phase ③：所有活跃供应商必须已核对
  const activeSuppliers = await this.prisma.bidSupplier.findMany({
    where: { projectId, decryptStatus: 'SUCCESS', submitStatus: { not: '已撤回' } },
    select: { id: true },
  });
  const verifiedReviews = await this.prisma.bidScoreReview.findMany({
    where: { expertId: expert.id, projectId, status: 'verified' },
    select: { supplierId: true },
  });
  const verifiedSet = new Set(verifiedReviews.map(r => r.supplierId));
  const unverified = activeSuppliers.filter(s => !verifiedSet.has(s.id));
  if (unverified.length > 0) {
    throw new BadRequestException({ error: `有 ${unverified.length} 个供应商评分未核对`, code: 'REVIEW_PENDING' });
  }
```
- [ ] **Step 4: 运行确认通过** + tsc clean。**Step 5: Commit** `feat(api): confirmReport 加核对关口 gate（REVIEW_PENDING）` + trailer。

---

### Task 5: `getProject`/`getReport` 返回 review 状态

**Files:** `expert.service.ts`（getProject :185 myExpertRecord；getReport canConfirm）

- [ ] **Step 1: getProject** —— 查该专家的所有 review，附到 myExpertRecord：
```ts
// 在 myExpertRecord 构造前（:185 前）查 reviews
const scoreReviews = await this.prisma.bidScoreReview.findMany({
  where: { expertId: expertRecord.id, projectId },
  select: { supplierId: true, status: true, verifiedAt: true },
});
// myExpertRecord 加字段
const myExpertRecord = { ...expertRecord, phoneVerified: ..., user: undefined,
  scoreReviews: scoreReviews.map(r => ({ supplierId: r.supplierId, status: r.status, verifiedAt: r.verifiedAt })),
};
```
- [ ] **Step 2: getReport** —— `canConfirm` 加 `&& allVerified`（与 confirmReport gate 一致）：
```ts
const allVerified = activeSuppliers.every(s => verifiedSet.has(s.id));
canConfirm: expert.progress >= 100 && allVerified,
```
并在 report 的 supplierScores 附每供应商 review 状态（供 report-step 显示核对徽章）。
- [ ] **Step 3: tsc clean。Step 4: Commit** `feat(api): getProject/getReport 返回核对状态` + trailer。

---

### Task 6: 专家端核对关口 UI（verify-score step）

**Files:**
- Create `apps/expert-portal/src/components/evaluate/verify-score-step.tsx`
- Modify `apps/expert-portal/src/app/(app)/evaluate/[id]/page.tsx`（Step 类型 :20、STEPS :21-28、gating :128-146、sidebar :783、渲染 :1437 前）
- Modify `apps/expert-portal/src/lib/api.ts`（verifyScoreReview 函数 + 类型）

- [ ] **Step 1: api.ts 加函数**：
```ts
export async function verifyScoreReview(projectId: string, supplierId: string) {
  return api.post<{ id: string; status: string; verifiedAt: string | null }>(`/expert/projects/${projectId}/suppliers/${supplierId}/score-review/verify`, {});
}
```
- [ ] **Step 2: 新建 `verify-score-step.tsx`**（镜像 report-step 结构；复用 PointChecklistScoring 只读态展示已评分；"确认核对"按钮调 verifyScoreReview）：
```tsx
'use client';
import { Check, ShieldCheck } from 'lucide-react';
import { useState } from 'react';

interface Props {
  projectId: string;
  supplierId: string;
  supplierName: string;
  scoreItems: any[];                 // project.scoreItems（含 points）
  scores: Record<string, any>;       // 该 supplier 的评分
  reviewStatus?: 'draft' | 'verified';
  onVerified: () => void;            // 核对成功后 reload
}
export function VerifyScoreStep({ projectId, supplierId, supplierName, scoreItems, scores, reviewStatus, onVerified }: Props) {
  const [busy, setBusy] = useState(false);
  const key = (sid: string, iid: string) => `${sid}:${iid}`;
  async function handleVerify() {
    setBusy(true);
    try {
      const { verifyScoreReview } = await import('@/lib/api');
      await verifyScoreReview(projectId, supplierId);
      onVerified();
    } catch (e: any) { /* toast */ } finally { setBusy(false); }
  }
  return (
    <div className="p-6">
      <div className="mb-6 flex items-center gap-2">
        <ShieldCheck size={20} className="text-[#064ea2]" />
        <h2 className="text-lg font-bold text-[oklch(0.18_0.012_265)]">核对评分 — {supplierName}</h2>
        {reviewStatus === 'verified' && <span className="text-xs bg-green-50 text-green-700 px-2 py-0.5 rounded-full">已核对</span>}
      </div>
      <p className="text-sm text-[oklch(0.55_0.01_264)] mb-4">请审阅以下评分，确认无误后点击「确认核对」。核对后评分将进入下一环节。</p>
      {/* 只读展示评分（复用 PointChecklistScoring readOnly 态 或 简单列表）*/}
      <div className="space-y-3">
        {scoreItems.map(si => (
          <div key={si.id} className="glass-card glass-card-lighter rounded-lg p-4 border-blue-100">
            <div className="flex justify-between"><span className="font-semibold">{si.name}</span>
              <span className="text-sm text-[oklch(0.55_0.01_264)]">{scores[key(supplierId, si.id)]?.score ?? 0} / {Number(si.maxScore)}</span></div>
          </div>
        ))}
      </div>
      <button onClick={handleVerify} disabled={busy || reviewStatus === 'verified'}
        className="mt-6 w-full py-3 bg-[#11a874] text-white rounded-lg font-bold disabled:opacity-50 flex items-center justify-center gap-2">
        <Check size={16} /> {reviewStatus === 'verified' ? '已核对' : busy ? '核对中…' : '确认核对'}
      </button>
    </div>
  );
}
```
> 注：若要支持核对时微调（spec §4.4 审阅+可微调+确认），可在此集成 `PointChecklistScoring`（非 readOnly）+ 提交时调 submitScores 改分 + verifyScoreReview。本 task 先做只读审阅+确认；微调作为增强（见 self-review）。
- [ ] **Step 3: page.tsx 集成**：
  - Step 类型加 `'verify-score'`（:20）。
  - STEPS 数组在 scoring 和 report 之间加 `{ key: 'verify-score', label: '核对', Icon: ShieldCheck }`（:26 后）。
  - stepAccessible 加 `case 'verify-score': return (expert?.progress ?? 0) >= 100;`（:128）。
  - stepCompleted 加 `case 'verify-score': return /* 该专家所有 supplier verified */ expert?.allScoreVerified ?? false;`（或基于 myExpertRecord.scoreReviews 判断）。
  - SupplierSidebar 渲染条件加 `|| step === 'verify-score'`（:783）。
  - 渲染：在 `{step === 'report' && ...}`（:1437）前加：
    ```tsx
    {step === 'verify-score' && activeSupplier && (
      <VerifyScoreStep
        projectId={projectId!}
        supplierId={activeSupplier}
        supplierName={project!.suppliers.find(s => s.id === activeSupplier)?.supplierName || ''}
        scoreItems={project!.scoreItems}
        scores={scores}
        reviewStatus={(project!.myExpertRecord as any)?.scoreReviews?.find((r:any) => r.supplierId === activeSupplier)?.status}
        onVerified={loadProject}
      />
    )}
    ```
- [ ] **Step 4: tsc clean**（`pnpm --filter expert-portal exec tsc --noEmit`）。手动验证（controller/human）。
- [ ] **Step 5: Commit** `feat(expert-portal): 核对关口 step（verify-score）` + trailer。

---

## Self-Review 结论

- **Spec 覆盖**：spec §3③ BidScoreReview → Task 1；§4.1 状态机 draft→verified→locked → Task 2/3/4；§4.4 核对（审阅+确认）→ Task 6；§4.3 仅桌面核对 → 后端不区分设备（前端 verify-score step 提供 UI，gate 在 confirmReport）。✅
- **关键设计**：① 重新提交评分重置 draft（专家改分需重新核对，Task 2 `update: {status:'draft', verifiedAt:null}`）；② confirmReport gate 复用 activeSuppliers 定义（Task 4）；③ 不发 WS（spec §4，核对本地操作）；④ 关系名 scoreReviews 避免冲突。
- **微调增强未含**（Task 6 只读审阅+确认）：spec §4.4 说"审阅+可微调+确认"。本 plan 的 verify-score-step 先做只读+确认（最小可用）。若需核对时微调，在 verify-score-step 集成 PointChecklistScoring（非 readOnly）+ 提交改分 → 作为 Task 6 增强或后续。**建议先 ship 只读版，微调作为 follow-up**（避免 task 过大）。
- **行号锚点**基于 phase ② 后调研，SDD 时 implementer 按实际确认（phase ②/③ 之间若有并行改动会漂移）。
