# 投标·开标·评标 UI 二轮审查整改实施计划（2026-09-08）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复二轮 UI 审查确认的 3 项 P1 + 红牌 3 处回归 + P2 交互语义精选批（9 项），核心是恢复公告直建项目的开标确认入口可达性、数值/按钮/告警条的口径与 cgzxui 合规统一。

**Architecture:** 三层推进——①P1-B 数据链修复（后端直建置 IN_PROGRESS + 前端入口条件放宽 + 存量 migrate 三件套）；②P1-A/P1-C 展示层修复（按钮类名、表头单位、投递报价归一）；③P2 精选批按文件域分组小步提交。法定开评标交互（解密/唱标/异议/流标/签字）只改展示与输入方式，不改任何守卫语义。

**Tech Stack:** pnpm monorepo；NestJS 11 + Prisma（apps/api）；Next.js 16 + React 19（三门户）；jest ts-jest（api）；tsx --test（supplier-portal-next）。

**Spec:** `water-erp/docs/投标开标评标UI易用性审查报告-2026-09-08-第二轮.md`（本轮审查报告，任务背景引用其 §三/§四编号）

## Global Constraints

- **并行会话协作**：动工前 `git status` 必须干净；禁用 `git add -A`/`git add .`，只 add 本任务明确改动的文件。
- **commit 前缀** `fix(ui-audit2):`（Task 6 用 `fix(cgzxui):`、Task 4 用 `fix(data):`）。
- **法定交互不动**：解密异常定性（Task 12）只把 `window.prompt` 换成受控弹窗，`acceptSupplierDanger` 的调用条件与参数语义不变；签字/流标/异议行为零改动。
- **前端无单测基建的门户**（bid-portal/expert-portal/web）验证 = `pnpm --filter <app> lint` + app 目录内 `npx tsc --noEmit`；API = `pnpm --filter api test -- <spec 名>`；supplier = `pnpm --filter supplier-portal-next test`。
- 红牌闸 `bash scripts/check-cgzxui-redcards.sh --ci` 在 Task 6 后必须 exit 0。
- **Task 4 是增量 UPDATE 不是 seed**——禁止跑 `pnpm db:seed`（破坏性全量重载，会清引大济岷演示数据）。

---

### Task 1: P1-A 价格配置卡——保存按钮无样式 + 脏检查禁用 + 公式键提示

**背景**（报告 §三 P1-A/P2-16）：`price-config-card.tsx:118` 用了 web 端不存在的 `.neu-btn` 裸类（globals.css 只有 `neu-btn-primary/-soft/-xs`）→ 渲染为浏览器默认灰按钮；保存钮常亮可点（点了才 toast「没有修改」），与唱标字段配置卡 `disabled={!dirty}` 行为不一致；价格分公式 JSON 无合法键文档。

**Files:**
- Modify: `apps/web/src/components/projects/price-config-card.tsx`

**Interfaces:**
- Consumes: 既有 `updatePriceConfig`、`detail` props。
- Produces: 无对外接口（展示组件内部修复）。

- [ ] **Step 1: 修按钮类名**——`:118` 附近：

```tsx
      <div className="flex justify-end">
        <button
          type="button"
          className="neu-btn-primary !h-[34px] !text-xs"
          disabled={saving || !detail || !dirty}
          title={!dirty ? '无修改' : undefined}
          onClick={save}
        >
          {saving ? "保存中…" : "保存配置"}
        </button>
      </div>
```

- [ ] **Step 2: 加 dirty 计算**（在 `const stage = ...` 行后）：

```tsx
  // P1-A：脏检查——与唱标字段配置卡口径一致（无修改时禁用而非点击后提示）
  const dirty = useMemo(() => (
    ceilingPrice !== (detail?.ceilingPrice != null ? String(detail.ceilingPrice) : "")
    || evaluationMethod !== (detail?.evaluationMethod ?? "")
    || formulaRaw.trim() !== formulaCanonical.trim()
  ), [ceilingPrice, evaluationMethod, formulaRaw, detail?.ceilingPrice, detail?.evaluationMethod, formulaCanonical]);
```

（`save()` 内已有的三段比对与 `toast.info("没有需要保存的修改")` 保留——防回退兜底。）

- [ ] **Step 3: 公式键提示**——高级区 textarea 下方（`{advancedOpen && (...)}` 内、textarea 后）追加：

```tsx
        <p className="mt-1 text-[10px] leading-relaxed text-[var(--muted-foreground)]">
          可用键：benchmarkMode（average 平均|lowest 最低价基准）、lowPriceRatio（低于基准扣分起点，0-1）、highPriceRatio（高于基准扣分起点，0-1）、priceWeight（价格分权重）。留空 = 内置默认公式。
        </p>
```

（键名以 `apps/api` 价格分计算的实际读取键为准——执行时 `grep -rn "priceFormulaConfig" apps/api/src --include="*.ts" | head` 核对，多删少补后写真实键集，勿虚构。）

- [ ] **Step 4: 验证 + Commit**

Run: `cd apps/web && npx tsc --noEmit && pnpm lint`

```bash
git add apps/web/src/components/projects/price-config-card.tsx
git commit -m "fix(ui-audit2): P1-A 价格配置卡保存钮改 neu-btn-primary（.neu-btn 裸类不存在致无样式）+脏检查禁用+公式可用键提示"
```

---

### Task 2: P1-B 后端——公告直建 PMI 的 BID_EVALUATION 阶段置 IN_PROGRESS

**背景**（报告 §三 P1-B）：`createItemFromAnnouncement` 置 `currentStage='BID_EVALUATION'` 但阶段 createMany 里 BID_EVALUATION 落 NOT_STARTED（不在 completedKeys）→ :3005 流程卡 `isInProgress` 条件不满足、「开标确认」入口按钮不渲染。BidProject 在 DOWNLOAD/SUBMIT 期（数周）采购员无法进面板做开标前准备（供应商投标状态/专家确认/评分标准编制）。`syncPmStage` 只在 OPENING 流转时才补 IN_PROGRESS，太晚。

**Files:**
- Modify: `apps/api/src/project-management/project-management.service.ts`（createItemFromAnnouncement 的 createMany，约 :364-373）
- Test: `apps/api/src/project-management/project-management.service.spec.ts`（N16-A describe 块内追加）

**Interfaces:**
- Produces: 直建 PMI 的 BID_EVALUATION stage `status='IN_PROGRESS'`（供 :3005 `pm-stage-action-btn` 渲染）。

- [ ] **Step 1: 写失败测试**（N16-A describe 内、竞价采购用例后追加）：

```ts
    it('P1-B：BID_EVALUATION 阶段落 IN_PROGRESS（currentStage 指向的阶段必须可操作，否则 :3005 开标确认入口不渲染）', async () => {
      const { service, prisma } = makeService();
      (prisma as any).user = { findUnique: jest.fn().mockResolvedValue(null) };
      prisma.projectManagementItem.create.mockResolvedValue({ id: 'pm-18', projectCode: 'GK-2099010101' });

      await service.createItemFromAnnouncement({} as any, prisma as any, {
        title: '直建入口测试', procurementMethod: '公开招标', budget: null, authorId: null,
      });

      const stages = prisma.projectManagementStage.createMany.mock.calls[0][0].data as any[];
      const bidEval = stages.find((x) => x.stageKey === 'BID_EVALUATION');
      expect(bidEval).toBeDefined();
      expect(bidEval.status).toBe('IN_PROGRESS');
      expect(bidEval.completedAt).toBeNull();
      // 其余非前置阶段仍 NOT_STARTED（EXPERT_SELECTION 不动）
      const expert = stages.find((x) => x.stageKey === 'EXPERT_SELECTION');
      expect(expert?.status).toBe('NOT_STARTED');
    });
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd apps/api && pnpm test -- project-management.service.spec -t "P1-B"`
Expected: FAIL（`bidEval.status` 为 `'NOT_STARTED'`）

- [ ] **Step 3: 实现**——createMany 的 status 三元改四态：

```ts
    await tx.projectManagementStage.createMany({
      data: stagesToCreate.map((stage, index) => ({
        projectManagementItemId: item.id,
        stageKey: stage.key,
        stageName: stage.label,
        stageOrder: index + 1,
        round: 1,
        // P1-B：currentStage 指向的开标评标阶段置 IN_PROGRESS——:3005 流程卡动作按钮按
        // isInProgress 渲染，NOT_STARTED 会让开标确认面板在 DOWNLOAD/SUBMIT 期（开标前准备窗口）不可达
        status: stage.key === 'BID_EVALUATION'
          ? PROJECT_STAGE_STATUS.IN_PROGRESS
          : completedKeys.has(stage.key) ? PROJECT_STAGE_STATUS.COMPLETED : PROJECT_STAGE_STATUS.NOT_STARTED,
        completedAt: completedKeys.has(stage.key) ? now : null,
      })),
    });
```

（确认 `PROJECT_STAGE_STATUS` 枚举含 `IN_PROGRESS`——`grep -n "IN_PROGRESS" apps/api/src/project-management/project-management.types.ts`。）

- [ ] **Step 4: 跑测试确认通过 + 全量 spec 回归**

Run: `cd apps/api && pnpm test -- project-management.service.spec`
Expected: PASS（含既有 N16-A 两用例——`completed.has('BID_EVALUATION')` 断言仍成立，IN_PROGRESS≠COMPLETED）

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/project-management/project-management.service.ts apps/api/src/project-management/project-management.service.spec.ts
git commit -m "fix(ui-audit2): P1-B 公告直建 PMI 的 BID_EVALUATION 置 IN_PROGRESS——currentStage 指向阶段 NOT_STARTED 致 :3005 开标确认入口按钮不渲染"
```

---

### Task 3: P1-B 前端——流程卡入口条件放宽（currentStage 兜底）

**背景**：防御层——存量/边缘数据 `currentStage` 指向某阶段但该阶段 status≠IN_PROGRESS 时，该阶段卡的动作按钮也应渲染（currentStage 表示项目当前所处阶段，必然应可操作）。类型层面防 Task 2 遗漏的同类数据。

**Files:**
- Modify: `apps/web/src/components/projects/project-stage-timeline.tsx:332`

**Interfaces:**
- Consumes: 组件已有 `activeStageKey` prop（`project-detail-panel.tsx:2139` 传 `selectedStage.stageKey`）。

- [ ] **Step 1: 条件放宽**——`:332` 的渲染条件：

```tsx
                          {/* 步骤操作按钮对"进行中"或"当前聚焦"步骤开放——P1-B：currentStage 指向的阶段
                              即为项目实际所处阶段，status 脱节（直建/存量数据）时入口不能消失 */}
                          {actionLabel && onStageAction && (entry.isInProgress || stageKey === activeStageKey) && entry.stageKey !== 'PROCUREMENT_DEMAND' && entry.stageKey !== 'INITIATION' && entry.stageKey !== 'CONTRACT' && (
```

（`stageKey` 与 `activeStageKey` 均在该 map 作用域内可访问；若 `activeStageKey` 未在循环作用域解构，执行时核对 props 变量名后引用。readOnly 归档态本就在 `onStageAction=undefined` 时短路，无需另加。）

- [ ] **Step 2: 验证 + Commit**

Run: `cd apps/web && npx tsc --noEmit && pnpm lint`

```bash
git add apps/web/src/components/projects/project-stage-timeline.tsx
git commit -m "fix(ui-audit2): P1-B 流程卡入口条件放宽——isInProgress 或 currentStage 指向均可操作（数据态脱节兜底）"
```

---

### Task 4: P1-B 存量——5 条直建 PMI 数据 migrate

**背景**：GK-2026082001~005 五项目 `currentStage='BID_EVALUATION'` 但 stage NOT_STARTED。通用条件修复（不限 GK 编号，防同类遗漏）。

**Files:**
- Create: `water-erp/scripts/fix-pmi-bid-eval-in-progress.ts`

- [ ] **Step 1: 写脚本**（参考 `scripts/align-opening-deadline-24h.ts` 的 prisma 客户端获取方式）：

```ts
/**
 * P1-B 存量修复（2026-09-08 二轮 UI 审查）：currentStage=BID_EVALUATION 的 ACTIVE PMI，
 * 其 BID_EVALUATION 阶段 status 置 IN_PROGRESS——否则 :3005 开标确认入口按钮不渲染。
 * 幂等：IN_PROGRESS/COMPLETED 不动；带 --dry-run 只打印清单。
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const dry = process.argv.includes('--dry-run');

async function main() {
  const items = await prisma.projectManagementItem.findMany({
    where: { currentStage: 'BID_EVALUATION', status: 'ACTIVE' },
    select: { id: true, projectCode: true, stages: { where: { stageKey: 'BID_EVALUATION', status: 'NOT_STARTED' } } },
  });
  const targets = items.filter((i) => i.stages.length > 0);
  console.log(`命中 ${targets.length} 条：`, targets.map((t) => t.projectCode).join(', ') || '（无）');
  if (dry || targets.length === 0) return;
  const res = await prisma.projectManagementStage.updateMany({
    where: { projectManagementItemId: { in: targets.map((t) => t.id) }, stageKey: 'BID_EVALUATION', status: 'NOT_STARTED' },
    data: { status: 'IN_PROGRESS' },
  });
  console.log(`已更新 ${res.count} 条 stage → IN_PROGRESS`);
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
```

- [ ] **Step 2: dry-run 审阅**

Run: `cd water-erp && npx tsx scripts/fix-pmi-bid-eval-in-progress.ts --dry-run`
Expected: `命中 5 条：GK-2026082005, GK-2026082004, GK-2026082003, GK-2026082002, GK-2026082001`

- [ ] **Step 3: 执行 + DB 验证**

Run: `npx tsx scripts/fix-pmi-bid-eval-in-progress.ts && docker exec water-erp-postgres psql -U water_erp -d water_erp -t -c "SELECT count(*) FROM \"ProjectManagementStage\" s JOIN \"ProjectManagementItem\" p ON p.id=s.\"projectManagementItemId\" WHERE p.\"currentStage\"='BID_EVALUATION' AND p.status='ACTIVE' AND s.\"stageKey\"='BID_EVALUATION' AND s.status='NOT_STARTED'"`
Expected: 更新 5 条；SQL 计数 `0`

- [ ] **Step 4: Commit**

```bash
git add scripts/fix-pmi-bid-eval-in-progress.ts
git commit -m "fix(data): P1-B 存量 5 条直建 PMI 的 BID_EVALUATION 置 IN_PROGRESS——修复 :3005 开标确认入口不可达（幂等脚本留档）"
```

---

### Task 5: P1-C 唱标表头单位 + 投递报价归一

**背景**（报告 §三 P1-C/P2-20）：:3004 公开唱标表表头「报价（元）」而值「1080万元」原文直出——单位矛盾；同面板本司区「投递报价 10800000 元」裸数字无千分位（`opening-hall/page.tsx:106-114` 的 fallback `n >= 10000 ? '${bidPrice} 元' : '${bidPrice} 万元'` 语义混乱）。

**Files:**
- Modify: `apps/supplier-portal-next/src/lib/opening-fields.ts:32`（STATUTORY_COLUMNS.amount.label）
- Modify: `apps/supplier-portal-next/src/app/(main)/my-bids/[projectId]/opening-hall/page.tsx:106-114`
- Test: `apps/supplier-portal-next/src/lib/__tests__/opening-fields.test.ts`

**Interfaces:**
- Produces: `opening-fields.ts` 新增导出 `formatBidSubmissionPrice(raw: string | number | null | undefined, yuan?: number | null): string`——投递报价显示文本（数字千分位+元、带单位原文直出、空 '—'）。

- [ ] **Step 1: 写失败测试**（opening-fields.test.ts 追加）：

```ts
test('P1-C：投递报价格式化——bidPriceInYuan 千分位+元、带单位原文直出、空占位', () => {
  expect(formatBidSubmissionPrice(null, 10800000)).toBe('10,800,000 元');
  expect(formatBidSubmissionPrice('1080万元', null)).toBe('1080万元');
  expect(formatBidSubmissionPrice('1485000', null)).toBe('1,485,000 元');
  expect(formatBidSubmissionPrice('', null)).toBe('—');
});
```

- [ ] **Step 2: 确认失败**

Run: `cd apps/supplier-portal-next && pnpm test`
Expected: FAIL（formatBidSubmissionPrice 未导出）

- [ ] **Step 3: 实现**——opening-fields.ts：

```ts
/** P1-C（二轮 UI 审查）：投递报价显示文本。bidPriceInYuan（后端已折算的元数字）→千分位+元；
    仅有自由文本 bidPrice（如「1080万元」/「1485000」）→ 走 formatOpeningAmount 同口径（原文直出或归一）。 */
export function formatBidSubmissionPrice(
  raw: string | null | undefined,
  yuan: number | null | undefined,
): string {
  if (yuan != null && Number.isFinite(yuan)) return `${yuan.toLocaleString('zh-CN')} 元`;
  return formatOpeningAmount(raw ?? null);
}
```

`STATUTORY_COLUMNS.amount` 的 label 改 `"报价"`（值含单位——裸数字经 formatOpeningAmount 已带「元」尾巴，带单位原文自带「万元」）。

- [ ] **Step 4: 页面接线**——opening-hall/page.tsx:106-114 的函数体替换：

```ts
  /** 投递报价显示文本（P1-C：与唱标总表同口径——千分位+元 / 带单位原文直出） */
  const bidPriceText = (s: SubmissionLike): string => formatBidSubmissionPrice(s?.bidPrice, s?.bidPriceInYuan);
```

（原函数名以 :106 处实际为准——执行时保留原函数签名，仅替换实现体；调用点不变。）

- [ ] **Step 5: 跑测试 + lint + Commit**

Run: `cd apps/supplier-portal-next && pnpm test && pnpm lint`

```bash
git add apps/supplier-portal-next/src/lib/opening-fields.ts "apps/supplier-portal-next/src/app/(main)/my-bids/[projectId]/opening-hall/page.tsx" apps/supplier-portal-next/src/lib/__tests__/opening-fields.test.ts
git commit -m "fix(ui-audit2): P1-C 唱标表头去「（元）」（值自带单位）+投递报价千分位归一——消表头/值单位矛盾与裸数字"
```

---

### Task 6: 红牌 3 处 H5 清零（cgzxui 硬闸恢复绿）

**背景**（报告 §四 红牌）：09-07 归零后 e04f7007（冻结回填）+8568f40d（视觉迭代）带回 3 处。

**Files:**
- Modify: `apps/supplier-portal-next/src/styles/pages/register2.css:471`
- Modify: `apps/supplier-portal-next/src/app/globals.css:13634`（.mobile-fab）
- Modify: `apps/supplier-portal-next/src/app/globals.css:13655`（.lp-register-option__icon）

- [ ] **Step 1: register2.css `.reg-stage-stack .reg-block`**——`box-shadow: 0 8px 24px oklch(0.4 0.04 258 / 0.05), inset 0 1px 0 #fff;` 改方向性双影：

```css
  box-shadow:
    inset 0 1px 0 oklch(1 0 0 / 0.8),
    2px 2px 6px oklch(0.55 0.03 258 / 0.1),
    -1px -1px 3px oklch(1 0 0 / 0.85);
```

- [ ] **Step 2: globals.css `.mobile-fab`**——`box-shadow: 0 4px 16px rgba(10, 94, 184, 0.4);` 改：

```css
  border: none; box-shadow: inset 0 1px 0 oklch(1 0 0 / 0.35), 2px 2px 6px oklch(0.45 0.08 258 / 0.14), -1px -1px 3px oklch(1 0 0 / 0.6); cursor: pointer; z-index: 100; transition: transform 0.2s;
```

- [ ] **Step 3: globals.css `.lp-register-option__icon`**——`box-shadow: inset 0 1px 0 rgba(255,255,255,.8)` 改：

```css
  box-shadow: inset 0 1px 0 oklch(1 0 0 / 0.8);
```

- [ ] **Step 4: 红牌闸验证**

Run: `cd water-erp && bash scripts/check-cgzxui-redcards.sh --ci && echo GREEN`
Expected: `GREEN`（exit 0）

- [ ] **Step 5: Commit**

```bash
git add apps/supplier-portal-next/src/styles/pages/register2.css apps/supplier-portal-next/src/app/globals.css
git commit -m "fix(cgzxui): 红牌 3 处 H5 清零——mobile-fab/lp-register-option__icon rgba 化 oklch、reg-block 无方向影改双影（--ci 恢复绿）"
```

---

### Task 7: 解密进度数字串语义化

**背景**（报告 P2-1）：:3007 大厅「2/1/3(100%)」三个数字连排无标签不可解读。

**Files:**
- Modify: `apps/bid-portal/src/components/opening-hall.tsx:935-943`

- [ ] **Step 1: 数字串改带语义**（span 结构替换）：

```tsx
              <span className="whitespace-nowrap text-[11px] font-mono font-bold tabular-nums text-[color:var(--foreground)]">
                <span className="text-[var(--success)]">{decryptProgress.success}</span>
                <span className="text-[color:var(--muted-foreground)]">/{decryptProgress.total} 已处理</span>
                {decryptProgress.danger > 0 && <span className="text-[var(--danger)]"> · {decryptProgress.danger} 异常</span>}
                <span className="ml-1 text-[color:var(--muted-foreground)]">({Math.round(decryptProgress.pct * 100)}%)</span>
              </span>
```

（「已处理」口径 = (success+danger)/total——pct 本就是这个算法，success 段写「已处理」不写「已解密」防歧义。）

- [ ] **Step 2: 验证 + Commit**

Run: `cd apps/bid-portal && npx tsc --noEmit && pnpm lint`

```bash
git add apps/bid-portal/src/components/opening-hall.tsx
git commit -m "fix(ui-audit2): 解密进度数字串语义化——2/1/3(100%) 改「2/3 已处理 · 1 异常」"
```

---

### Task 8: 任务板「异议」徽标去分母

**背景**（报告 P2-8）：「异议 0/3」读作"3 条异议处理 0 条"——异议不是每家必达动作，done/total 语境反直觉。

**Files:**
- Modify: `apps/bid-portal/src/app/(dashboard)/bid/page.tsx:21-35`（MiniStat）、`:130`（异议行）

- [ ] **Step 1: MiniStat 加 hideTotal 可选参数**：

```tsx
function MiniStat({ icon, label, done, total, tone, hideTotal }: {
  icon: React.ReactNode; label: string; done: number; total: number; tone: 'accent' | 'danger'; hideTotal?: boolean;
}) {
  const danger = tone === 'danger' && done > 0;
  return (
    <span
      className={`inline-flex items-center gap-1 text-[11px] tabular-nums ${danger ? 'text-[var(--danger)]' : 'text-[color:var(--accent-strong)]'}`}
      title={hideTotal ? `${label} ${done} 件` : `${label} ${done}/${total}`}
    >
      {icon}
      <b className="font-bold">{done}</b>{!hideTotal && <span className="opacity-50">/{total}</span>}
      {hideTotal && <span className="font-normal opacity-70"> 件</span>}
    </span>
  );
}
```

- [ ] **Step 2: 异议行启用**——`:130` 改：

```tsx
                        <MiniStat icon={<AlertTriangle size={11} />} label="异议" done={disputed} total={total} tone="danger" hideTotal />
```

- [ ] **Step 3: 验证 + Commit**

Run: `cd apps/bid-portal && npx tsc --noEmit && pnpm lint`

```bash
git add "apps/bid-portal/src/app/(dashboard)/bid/page.tsx"
git commit -m "fix(ui-audit2): 任务板异议徽标去分母——「异议 0/3」改「0 件异议」（done/total 对非必达动作反直觉）"
```

---

### Task 9: 「不可投标」按钮原因提示

**背景**（报告 P2-9）：hero 主 CTA 禁用时无解释（未审批/非递交期/已截止三种原因不可区分）。

**Files:**
- Modify: `apps/supplier-portal-next/src/app/(main)/bids/[id]/page.tsx:468-470`

- [ ] **Step 1: 原因推导 + title**（canSubmit 定义 :156 附近已有 isApproved/stage/depline 三条件）：

```tsx
                    <button
                      type="button"
                      className="neu-btn-primary !h-10 !px-5"
                      disabled={!canSubmit}
                      title={canSubmit ? undefined : (
                        !isApproved ? "供应商资料未审核通过，暂不可投标"
                          : !["DOWNLOAD", "SUBMIT"].includes(project?.stage || "") ? "项目不在投标期内（下载/递交阶段）"
                          : "投标截止时间已过"
                      )}
                      onClick={goToSubmit}
                    >
                      <Upload size={14} strokeWidth={1.75} />{canSubmit ? "提交标书" : "不可投标"}
                    </button>
```

- [ ] **Step 2: 验证 + Commit**

Run: `cd apps/supplier-portal-next && npx tsc --noEmit && pnpm lint`

```bash
git add "apps/supplier-portal-next/src/app/(main)/bids/[id]/page.tsx"
git commit -m "fix(ui-audit2): 不可投标禁用钮补原因 title——未审批/不在投标期/已截止三分支"
```

---

### Task 10: :3006 登录页默认专家 tab

**背景**（报告 P2-7）：186 名专家 vs 少数管理员，默认「管理员登录」表单倒置。

**Files:**
- Modify: `apps/expert-portal/src/app/login/page.tsx:51`

- [ ] **Step 1: 默认值改 expert**：

```tsx
  const [tab, setTab] = useState<Tab>(fromInvitation ? 'expert' : 'expert');
```

简化为 `useState<Tab>('expert')`（fromInvitation 分支已无意义，一并删掉该三处引用中失效的注释；若 fromInvitation 还有其它用途则仅改默认值保留变量）。

- [ ] **Step 2: 验证 + Commit**

Run: `cd apps/expert-portal && npx tsc --noEmit && pnpm lint`

```bash
git add apps/expert-portal/src/app/login/page.tsx
git commit -m "fix(ui-audit2): :3006 登录默认专家 tab——主用户群 186 专家 vs 少数管理员，原默认 admin 表单倒置"
```

---

### Task 11: 评标签字 tab 六步流程引导条

**背景**（报告 P2-6）：五块卡片平铺无步骤编号/进度指示，新主持人不知顺序与当前位置。

**Files:**
- Modify: `apps/bid-portal/src/components/workspace/signing-tab.tsx`

**Interfaces:**
- Consumes: 既有 `data: SignPacketResponse | null`（含 `packet.closed`/`packet.handoverFileAssetId`/`allClosed`/`canGenerate`）。

- [ ] **Step 1: 组件顶部加 stepper**（signing-tab 返回 JSX 最外层顶部，面包屑/标题之后、第一块卡片之前）：

```tsx
      {/* P2（二轮审查）：签字流程六步引导——当前步按数据态推导（只读指示，不可点击跳转）。
          推导口径：无包→待①生成；有包未闭环→待⑤回传登记（②③④为线下步骤，不判✓只显中性）；
          闭环未回流→待⑥；已回流→全部完成。cur≥6 时 ①-⑤ 全✓（闭环间接证实线下链路完成）。 */}
      {(() => {
        const cur = !data?.packet ? 1
          : !data.packet.closed ? 5
          : !data.packet.handoverFileAssetId ? 6 : 7;
        const steps = ['① 生成签字包', '② 打印', '③ 现场签字', '④ 扫描', '⑤ 回传登记', '⑥ 闭环回流'];
        return (
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-xl bg-[oklch(0.985 0.006 258 / 0.6)] px-4 py-2.5 text-[11px] font-semibold">
            <span className="text-[color:var(--muted-foreground)]">签字流程：</span>
            {steps.map((s, i) => {
              const n = i + 1;
              const done = n < cur && (cur >= 6 || n === 1);
              return (
                <span key={s} className={
                  n === cur ? 'text-[var(--accent-strong)]'
                  : done ? 'text-[var(--success)]'
                  : 'text-[color:var(--muted-foreground)] opacity-60'
                }>
                  {done ? '✓ ' : ''}{s}
                </span>
              );
            })}
            <span className="ml-auto text-[color:var(--muted-foreground)] opacity-50 font-normal">②③④为线下步骤</span>
          </div>
        );
      })()}
```

- [ ] **Step 2: 验证 + Commit**

Run: `cd apps/bid-portal && npx tsc --noEmit && pnpm lint`

```bash
git add apps/bid-portal/src/components/workspace/signing-tab.tsx
git commit -m "fix(ui-audit2): 评标签字 tab 六步流程引导条——生成/打印/签字/扫描/回传/闭环，当前步按数据态高亮"
```

---

### Task 12: 解密异常定性 prompt → 受控弹窗

**背景**（报告 P2-11）：`opening-hall.tsx:1098` 裸 `window.prompt` 收集定性原因——影响供应商权益的重要操作走原生弹窗，无样式无校验。范本：`adjudicate-dialog.tsx` 的 `.bid-overlay`+`.bid-dialog` 三层 JSX。

**Files:**
- Modify: `apps/bid-portal/src/components/opening-hall.tsx`

**Interfaces:**
- Consumes: 既有 `acceptSupplierDanger(projectId, submissionId, reason)`——**调用条件与参数完全不变**。

- [ ] **Step 1: 加弹窗 state**（组件 state 区）：

```tsx
  /** P2（二轮审查）：解密异常定性受控弹窗——替代 window.prompt（原生弹窗无样式无校验） */
  const [dangerQualify, setDangerQualify] = useState<{ submissionId: string; supplierName: string } | null>(null);
  const [dangerReason, setDangerReason] = useState('');
  const [dangerBusy, setDangerBusy] = useState(false);
```

- [ ] **Step 2: 按钮 onClick 改开弹窗**（原 `:1098` 的 prompt 逻辑替换）：

```tsx
                          <button type="button"
                            onClick={() => setDangerQualify({ submissionId: s.id, supplierName: s.supplierName })}
                            className="flex items-center gap-1 text-[11px] font-semibold tracking-tight text-[var(--danger)] transition-colors hover:opacity-80 disabled:opacity-50">
                            定性异常
                          </button>
```

- [ ] **Step 3: 弹窗 JSX**（组件返回树末尾，与既有 drawer/dialog 同层）：

```tsx
      {dangerQualify && (
        <>
          <div className="bid-overlay-backdrop" onClick={() => !dangerBusy && setDangerQualify(null)} />
          <div className="bid-overlay">
            <div className="bid-dialog" role="dialog" aria-label="解密异常定性">
              <h3 className="text-base font-black text-[color:var(--foreground)]">解密异常定性 — {dangerQualify.supplierName}</h3>
              <p className="mt-1 text-xs text-[color:var(--muted-foreground)]">
                定性后该供应商解密状态记为异常（EXCEPTION），将计入开标记录与监督日志，请填写事实性原因。
              </p>
              <textarea
                className="neu-input w-full text-sm"
                rows={3}
                maxLength={200}
                placeholder="如：供应商未在解密窗口内完成解密 / 文件完整性校验不通过"
                value={dangerReason}
                onChange={(e) => setDangerReason(e.target.value)}
                disabled={dangerBusy}
              />
              <div className="mt-3 flex justify-end gap-2">
                <button type="button" className="neu-btn-soft !h-8 !text-xs" disabled={dangerBusy} onClick={() => setDangerQualify(null)}>取消</button>
                <button
                  type="button"
                  className="neu-btn-primary !h-8 !text-xs"
                  disabled={dangerBusy || dangerReason.trim().length < 5}
                  onClick={async () => {
                    setDangerBusy(true);
                    try {
                      await acceptSupplierDanger(project.id, dangerQualify.submissionId, dangerReason.trim());
                      toast.success('已定性为解密异常（EXCEPTION）');
                      setDangerQualify(null);
                      setDangerReason('');
                      onRefresh();
                    } catch (e) {
                      toast.error(e instanceof Error ? e.message : '定性失败');
                    } finally {
                      setDangerBusy(false);
                    }
                  }}
                >
                  确认定性
                </button>
              </div>
            </div>
          </div>
        </>
      )}
```

（`acceptSupplierDanger`/`onRefresh`/`project`/`s.supplierName` 字段名以该文件既有引用为准——prompt 原文里用的就是 `acceptSupplierDanger(project.id, s.id, reason)` 与 `onRefresh()`，直接沿用；reason 校验 ≥5 字为前端拦截，后端校验仍为权威。）

- [ ] **Step 4: 验证 + Commit**

Run: `cd apps/bid-portal && npx tsc --noEmit && pnpm lint`

```bash
git add apps/bid-portal/src/components/opening-hall.tsx
git commit -m "fix(ui-audit2): 解密异常定性 window.prompt 改受控弹窗——原生理由输入无样式无校验；acceptSupplierDanger 语义不变"
```

---

### Task 13: 两新卡告警条统一 .wb-alert

**背景**（报告 P2-12）：同一面板两种自拼告警条（配置卡内联 style / 价格卡带 border），web 已有 `.wb-alert`+`--warning` 变体（globals.css:11043）。

**Files:**
- Modify: `apps/web/src/components/projects/opening-field-config-card.tsx:147-158`
- Modify: `apps/web/src/components/projects/price-config-card.tsx:76-80`

- [ ] **Step 1: 配置卡锁定提示条**（内联 style 版替换）：

```tsx
      {locked && (
        <div className="wb-alert wb-alert--warning mb-3 flex items-center gap-2 text-xs">
          <Lock size={13} /> 开标已开始，唱标字段配置已锁定（《招标投标法》开标程序确定性）
        </div>
      )}
```

- [ ] **Step 2: 价格卡软提示条**（border 版替换）：

```tsx
      {softLocked && (
        <div className="wb-alert wb-alert--warning text-xs">
          项目已进入评标/归档阶段——修改评标办法或公式会影响后续评分口径，请谨慎操作。
        </div>
      )}
```

- [ ] **Step 3: 验证 + Commit**

Run: `cd apps/web && npx tsc --noEmit && pnpm lint`

```bash
git add apps/web/src/components/projects/opening-field-config-card.tsx apps/web/src/components/projects/price-config-card.tsx
git commit -m "fix(ui-audit2): 两新卡告警条统一 .wb-alert--warning——去内联 style 与 border（wb-alert 无边框 tone 化是 web 端规范）"
```

---

### Task 14: 模板库弹窗按钮体系 + border 清理

**背景**（报告 P2-13）：应用/编辑/删除按钮手写扁平样式（同行「设为生效」却是 neu-btn-xs）；模板行/行内编辑区/底部存模板区 3 处 `border` 违反「块级表面无外侧框线」。

**Files:**
- Modify: `apps/web/src/components/projects/opening-template-library-dialog.tsx`

- [ ] **Step 1: 「应用」按钮改体系**（原 `rounded-lg bg-[var(--accent)]...` 类替换）：

```tsx
                      <button
                        onClick={() => handleApply(t)}
                        disabled={locked || applyingId === t.id || fieldCount === 0}
                        title={locked ? '开标已开始，字段配置已锁定' : fieldCount === 0 ? '模板未定义唱标字段' : '应用到此项目'}
                        className="neu-btn-xs !h-[30px]"
                      >
                        {applyingId === t.id ? '应用中…' : '应用'}
                      </button>
```

- [ ] **Step 2: 「编辑」「删除」图标钮改 neu-btn-xs**：

```tsx
                      <button
                        onClick={() => (editing?.id === t.id ? setEditing(null) : startEdit(t))}
                        title={editing?.id === t.id ? '收起编辑' : '编辑模板'}
                        className="neu-btn-xs !h-[30px] !w-[30px] !p-0"
                      >
                        {editing?.id === t.id ? <span className="text-xs font-bold">收起</span> : <Pencil size={13} strokeWidth={1.5} />}
                      </button>
                      <button
                        onClick={() => setDeleteTarget(t)}
                        disabled={t.isActive}
                        title={t.isActive ? '生效中不可删，先启用其他模板' : '删除模板'}
                        className="neu-btn-xs !h-[30px] !w-[30px] !p-0 is-danger"
                      >
                        <Trash2 size={13} strokeWidth={1.5} />
                      </button>
```

- [ ] **Step 3: 三处 border 去除**（用背景差异+既有阴影替代）：
  - 模板行容器：`border border-[color-mix(in_oklch,var(--foreground)_8%,transparent)] bg-[var(--surface)]` → `bg-[var(--surface)]`（补 `rounded-xl` 维持圆角）
  - 行内编辑区：`border border-[color-mix(in_oklch,var(--accent)_25%,transparent)] bg-[var(--accent-soft)]` → `bg-[var(--accent-soft)] rounded-xl`
  - 底部存模板区：`border border-[color-mix(in_oklch,var(--foreground)_8%,transparent)] bg-[var(--accent-soft)]` → `bg-[var(--accent-soft)] rounded-xl`

- [ ] **Step 4: 验证 + Commit**

Run: `cd apps/web && npx tsc --noEmit && pnpm lint`

```bash
git add apps/web/src/components/projects/opening-template-library-dialog.tsx
git commit -m "fix(ui-audit2): 模板库弹窗按钮归 neu-btn-xs 体系+三处块级 border 清除——同区不再两种按钮语言"
```

---

## 本轮不做（留档下轮）

- **P2-2 解密时间列全「—」**：种子 `BidOpeningRecord.decryptedAt` 缺——修种子数据需连带快照一致性核对，单独做。
- **P2-3 已确认+未签名双徽标**：涉及 A-114 语义分层设计，非纯展示改。
- **P2-4 结果已生成 vs 可生成否三角矛盾**：种子演示态固有，需「演示数据」解释层设计。
- **P2-5/P2-10 进度口径统一（评分进度 40% 来源/完成度 vs 步骤进度）**：需先梳理五口径定义再统一，独立 spec。
- **P2-14 配置卡恢复默认裸 confirm、P2-15 原生 checkbox**：与 signing-tab 既有 confirm 一并统一时再做（全端确认模式/表单控件普查）。
- **P2-17 EVALUATING+ 评标办法硬闸**：后端合规项（对照 OPENING_FIELDS_LOCKED），单开 design spec。
- **P2-18 澄清表发起人/供应商重复列、P2-19 计数徽标 aria-label、P2-20 my-bids「1080.00 万元」尾零**：低频小修，与下次触达同文件时顺带。
- **register2.css 其余 border 风格块**：红牌闸外的存量风格（reg-* 体系），重制归 cgzxui 全量移植线。

## Self-Review 记录

- 覆盖：P1-A→T1、P1-B→T2/T3/T4（后端/前端防御/存量三件套）、P1-C→T5、红牌→T6、P2-1→T7、P2-8→T8、P2-9→T9、P2-7→T10、P2-6→T11、P2-11→T12、P2-12→T13、P2-13→T14。报告 §八 1-4 全覆盖 + 第 5 批（1/6/7/8/9/11）全覆盖。
- 占位符：T1 Step 3 公式键集要求执行时 grep 后端核实（键名不确定处已标注核实方法，非 TBD）；T5 Step 4 原函数名以 :106 实际为准（签名不变只换实现体）；T12 字段名已按既有 prompt 调用核对。
- 类型一致性：`formatBidSubmissionPrice(raw, yuan)` 在 T5 定义并同任务消费；`hideTotal` T8 内闭环；`dangerQualify` state T12 内闭环；`activeStageKey` T3 消费组件既有 prop。
- 风险核对：T2 既有断言 `completed.has('BID_EVALUATION')).toBe(false)` 与 IN_PROGRESS 不冲突（已核对语义）；T4 幂等（NOT_STARTED 才更新）；T6 改动仅阴影行不触布局。
