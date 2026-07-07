# 辅助评标页 IA 重排 · 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 重排专家门户辅助评标页（`<AssistPanel>`）为「门 / 证据 / 打分 / 横向对比」四层，修复项目级数据口径，清理孤儿代码，并亮出已存在但被前端藏起的 AI 数据丰富度。

**Architecture:** 前端把 1378 行的 `assist-panel.tsx` 按层拆成 `status-bar / gate-layer / evidence-layer / scoring-layer / cross-bidder-layer` + `shared/` 小组件；后端把 `fraudSummary` 与 `reportDocxUrl` 两个项目级数据从 per-supplier 的 `getAssistData` 迁到 `getAssistCompare`，`getAssistData` 新增返回 `starredResponse`；`packages/shared` 的 `AssistData` 补 `keyObservations` / `starredResponse` 类型、清前端 `as any`。

**Tech Stack:** Next.js 16 (React 19 + Tailwind v4)，NestJS 11 + Prisma + Jest，`packages/shared`（tsc 编译到 dist），`@water-erp/shared`。

## Global Constraints

- **视觉系统不动**：glass-card、oklch 冷灰色阶、tabular-nums、Lucide `strokeWidth={1.5}`、5 类评审色（QUALIFICATION `#064ea2` / RESPONSIVE `#8b5cf6` / BUSINESS `#f5a623` / TECHNICAL `#11a874` / PRICE `#e74c3c`）。
- **不动 AI / prompt / worker / 模型 / 输出校验**（属独立工作流 Y）。
- **不动 compare / scoring / verify / documents / report 步**。
- **Node 24 + Turbopack 规避**：所有 Next.js dev 脚本的 `--webpack` 不可删（lightningcss 不支持 Node 24）。
- **编辑 `packages/shared` 后必须 `pnpm --filter @water-erp/shared build`**，下游才看得到类型变更。
- 工作目录：仓库根 `/home/asus/桌面/ERP`；pnpm workspace 在 `water-erp/`。当前分支 `assist-panel-ia-redesign`。
- 后端用 TDD（Jest，`apps/api/src/**/*.spec.ts`）；前端无测试运行器，验证靠 `lint` + `build` + 手动 IA 清单。
- 行为细节以 spec 为准：`docs/superpowers/specs/2026-07-07-assist-panel-ia-redesign-design.md`。本计划给出文件、接口契约、关键代码与验证；不重复粘贴未改动的 JSX。

---

## File Structure

**后端**
- `apps/api/src/expert/expert.service.ts` — `getAssistData`（删 AiBidReport 查询/fraudSummary/reportDocxUrl、加 starredResponse）、`getAssistCompare`（加 AiBidReport 查询、返回 projectFraudSummary + reportDocxUrl）
- `apps/api/src/expert/expert.service.spec.ts` — 更新 `getAssistData` 断言、新增 `getAssistCompare` 用例

**共享类型**
- `packages/shared/src/types.ts` — `AssistData` 补 `keyObservations?` / `starredResponse?`；（视 Task 1 结论）`AiScoreItem` 补 `priceAnalysis?`；新增 `AssistCompareResponse` 导出类型

**前端 · 删除（孤儿）**
- `apps/expert-portal/src/components/evaluate/assist/tabs/`（整目录）
- `apps/expert-portal/src/components/evaluate/assist/cross-bidder-overview.tsx`
- `apps/expert-portal/src/components/evaluate/assist/charts/assist-kpi-card.tsx`
- `apps/expert-portal/src/components/evaluate/assist/charts/index.ts`

**前端 · 新建**
- `apps/expert-portal/src/components/evaluate/assist/status-bar.tsx`
- `apps/expert-portal/src/components/evaluate/assist/gate-layer.tsx`
- `apps/expert-portal/src/components/evaluate/assist/evidence-layer.tsx`
- `apps/expert-portal/src/components/evaluate/assist/scoring-layer.tsx`
- `apps/expert-portal/src/components/evaluate/assist/cross-bidder-layer.tsx`
- `apps/expert-portal/src/components/evaluate/assist/shared/{collapsible-section,section-header,pass-fail-card,sw-card,field-card,rank-badge}.tsx`

**前端 · 重写**
- `apps/expert-portal/src/components/evaluate/assist/assist-panel.tsx` — 瘦成主壳（4 态 + 四层编排）

**前端 · 保留不动**
- `charts/{radar-chart,score-bar-chart,price-comparison-chart,score-breakdown-bars}.tsx`（仅 `score-breakdown-bars` 按 Task 10 调默认值）

---

## Task 1: 前置核对 — 真实数据填充率 + priceAnalysis 持久化

**Why first:** spec 5.3 的诚实前提。`priceAnalysis` 是否在 PRICE scoreItem 里持久化、各丰富字段实际填充率，决定 ③a 渲染与若干 B' 卡片是否需优雅降级。结论记录进 spec，参数化后续任务。

**Files:**
- Modify: `docs/superpowers/specs/2026-07-07-assist-panel-ia-redesign-design.md`（末尾追加「前置核对结论」一节）

- [ ] **Step 1: 启动依赖服务 + 确认种子项目存在**

```bash
cd /home/asus/桌面/ERP/water-erp
pnpm infra:up                # PostgreSQL/Redis/MinIO
pnpm db:migrate
pnpm db:seed                 # 英雄项目 cmqhero-bid-proj01 + 3 家供应商
```

- [ ] **Step 2: 用 Prisma Studio 查一条真实 AiBidderResult**

```bash
pnpm --filter api db:studio   # 打开 Prisma Studio
# 在 AiBidderResult 表里找一条 status=COMPLETED、属 cmqhero-bid-proj01 的行，点开 Json 字段
```

记录以下字段的实际值/填充情况（直接抄进 spec 结论节）：
- `scoreItems` 里 PRICE 项是否含 `priceAnalysis`（关键字段：deviation / strategyAssessment）
- `scoreItems` 各项的 `reason / evidence / confidence / unstable` 填充率
- `strengths / weaknesses` 各几条、`evidence/impact` 是否填
- `overallComment` 字数、`keyObservations` 条数
- `requirementResponses` 条数、`excerpt/location/verified` 填充率
- `starredResponse` 是否为 `{ allMet, unmet[] }`

> 备选命令行方式（若 Studio 不便）：`psql` 直连 `postgresql://water_erp:water_erp_dev@localhost:5432/water_erp`，`select "scoreItems","starredResponse","strengths" from "AiBidderResult" where status='COMPLETED' limit 1;`

- [ ] **Step 3: 把结论追加到 spec 末尾**

在 spec 末尾追加（据实填写，下面是模板）：

```markdown

---

## 8. 前置核对结论（Task 1 实测）

- **PRICE `priceAnalysis` 持久化**：[是/否] → ③a [使用 priceAnalysis / 退化 reason/evidence]，AiScoreItem 类型 [需要/不需要] 补 priceAnalysis。
- **evidence 填充率**：[高/低] → per-item evidence 常驻 [全量显/有则显无则隐]。
- **confidence/unstable**：[实测情况]。
- **requirementResponses**：[实测条数与字段填充]。
- **starredResponse**：[实测结构与填充]。
- **降级处理**：[列出本轮需优雅降级的字段]。
```

- [ ] **Step 4: Commit**

```bash
git -C /home/asus/桌面/ERP add docs/superpowers/specs/2026-07-07-assist-panel-ia-redesign-design.md
git -C /home/asus/桌面/ERP commit -m "docs(spec): 补 Task1 前置核对结论（数据填充率/priceAnalysis）"
```

---

## Task 2: 共享类型 — AssistData 补字段 + AssistCompareResponse

**Files:**
- Modify: `packages/shared/src/types.ts:228`（AssistData）、`:14`（AiScoreItem，视 Task 1）、文件末尾新增 `AssistCompareResponse`
- Rebuild: `packages/shared`

**Interfaces:**
- Produces: `AssistData.keyObservations`, `AssistData.starredResponse`,（可选）`AiScoreItem.priceAnalysis`, `AssistCompareResponse`

- [ ] **Step 1: 给 AssistData 补字段（types.ts:228-254 的 interface 内）**

在 `AssistData` 里 `overallComment?: string;` 附近加：

```ts
  keyObservations?: string[];
  starredResponse?: { allMet: boolean; unmet?: string[] };
```

- [ ] **Step 2: （仅当 Task 1 结论为"PRICE 持久化了 priceAnalysis"）给 AiScoreItem 补字段**

在 `AiScoreItem`（types.ts:14-26）`unstable?: boolean;` 后加：

```ts
  /** PRICE 项的报价分析（公式分 + LLM 分析层）；仅 PRICE 类别可能存在 */
  priceAnalysis?: { deviation?: string; strategyAssessment?: { type?: string; confidence?: number } };
```

> 若 Task 1 结论为"未持久化"，跳过本步。

- [ ] **Step 3: 新增 AssistCompareResponse 类型（types.ts 末尾，AssistData 之后）**

```ts
export interface AssistCompareBidder {
  supplierId: string;
  supplierName: string;
  totalScore: number;
  categoryTotals: Record<string, { score: number; max: number }>;
  qualificationStatus: string;
  riskLevel: string;
}

export interface AssistCompareResponse {
  bidders: AssistCompareBidder[];
  projectFraudSummary: { riskLevel: string; indicatorCount: number } | null;
  reportDocxUrl: string | null;
}
```

- [ ] **Step 4: 编译 shared**

Run: `pnpm --filter @water-erp/shared build`
Expected: `tsc` 无错误，`dist/index.d.ts` 含新字段。

- [ ] **Step 5: Commit**

```bash
git -C /home/asus/桌面/ERP add packages/shared/src/types.ts
git -C /home/asus/桌面/ERP commit -m "feat(shared): AssistData 补 keyObservations/starredResponse；新增 AssistCompareResponse"
```

---

## Task 3: 后端 getAssistData — 删项目级数据、加 starredResponse（TDD）

**Files:**
- Modify: `apps/api/src/expert/expert.service.ts:576-608`
- Test: `apps/api/src/expert/expert.service.spec.ts:161-194`

**Interfaces:**
- Consumes: Task 2 的 `AssistData`（现在类型化了 `starredResponse`）
- Produces: `getAssistData` return 不再含 `fraudSummary`/`reportDocxUrl`，新增 `starredResponse`

- [ ] **Step 1: 更新现有测试断言（先改测试，让它驱动实现）**

`expert.service.spec.ts:174-193` 的第二个 `it` 内：

(a) mock 的 bidderResult（:177-183）加 `starredResponse`：

```ts
      prisma.aiBidderResult.findFirst.mockResolvedValue({
        id: 'br-1', status: 'COMPLETED', totalScore: 80, scoreItems: [], categoryTotals: {}, keyInfo: {},
        strengths: [], weaknesses: [], overallComment: '', qualificationStatus: '通过', riskLevel: 'low',
        starredResponse: { allMet: true, unmet: [] },
        requirementResponses: [{ requirementId: 'r1', category: 'technical', status: 'met', location: { fileId: 'fa1', page: 1 } }],
        concordance: null,
        bidSupplier: { supplierName: '甲公司' },
      });
```

(b) 删掉 :185 的 `prisma.aiBidReport = {...}` 行（getAssistData 不再查 AiBidReport）。

(c) 在 :192 的断言后追加：

```ts
      expect(out.starredResponse).toEqual({ allMet: true, unmet: [] });
      expect(out).not.toHaveProperty('fraudSummary');
      expect(out).not.toHaveProperty('reportDocxUrl');
      expect(prisma.aiBidReport).toBeUndefined(); // 不再查 AiBidReport
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `pnpm --filter api test -- expert.service.spec.ts`
Expected: FAIL（`out.starredResponse` 为 undefined、`fraudSummary` 仍存在）。

- [ ] **Step 3: 改 getAssistData 实现（service.ts:576-608）**

把这段：

```ts
      // 15.4: 串通检测分层可见 — 专家端只看摘要（不暴露检测细节）
      const task = await this.prisma.aiBidAnalysisTask.findUnique({
        where: { projectId },
        select: { id: true, requirements: true },
      });
      let fraudSummary: { riskLevel: string; indicatorCount: number } | null = null;
      let reportDocxId: string | null = null;
      // 本人针对该投标人的条款标注（Task 3 BidRequirementReview）
      let myReviews: any[] = [];
      if (task) {
        const report = await this.prisma.aiBidReport.findUnique({
          where: { taskId: task.id },
          select: { fraudIndicators: true, docxFileId: true },
        });
        if (report?.fraudIndicators) {
          const fi = report.fraudIndicators as any;
          fraudSummary = { riskLevel: fi.riskLevel ?? 'low', indicatorCount: fi.summary?.totalCount ?? fi.indicators?.length ?? 0 };
        }
        reportDocxId = report?.docxFileId ?? null;
        myReviews = await this.prisma.bidRequirementReview.findMany({
          where: { bidderResultId: bidderResult.id, expertId: expert.id },
        });
      }
```

替换为：

```ts
      const task = await this.prisma.aiBidAnalysisTask.findUnique({
        where: { projectId },
        select: { id: true, requirements: true },
      });
      // 本人针对该投标人的条款标注（Task 3 BidRequirementReview）
      let myReviews: any[] = [];
      if (task) {
        myReviews = await this.prisma.bidRequirementReview.findMany({
          where: { bidderResultId: bidderResult.id, expertId: expert.id },
        });
      }
```

然后把 return 对象（:589-608）里的两行删除：

```ts
        fraudSummary, // B5: ...
        reportDocxUrl: reportDocxId ? `/api/upload/files/${reportDocxId}` : null, // B6: ...
```

并在 return 里 `riskLevel: bidderResult.riskLevel,` 之后加一行：

```ts
        starredResponse: (bidderResult.starredResponse as { allMet: boolean; unmet?: string[] } | null) ?? null,
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `pnpm --filter api test -- expert.service.spec.ts`
Expected: PASS（两个 `it` 全绿）。

- [ ] **Step 5: Commit**

```bash
git -C /home/asus/桌面/ERP add apps/api/src/expert/expert.service.ts apps/api/src/expert/expert.service.spec.ts
git -C /home/asus/桌面/ERP commit -m "refactor(api/expert): getAssistData 删 fraudSummary/reportDocxUrl、加 starredResponse"
```

---

## Task 4: 后端 getAssistCompare — 接收项目级 fraudSummary + reportDocxUrl（TDD）

**Files:**
- Modify: `apps/api/src/expert/expert.service.ts:618-645`
- Test: `apps/api/src/expert/expert.service.spec.ts`（新增 describe）

**Interfaces:**
- Produces: `getAssistCompare` return 形如 `{ bidders, projectFraudSummary, reportDocxUrl }`（契约见 Task 2 `AssistCompareResponse`）

- [ ] **Step 1: 写失败测试（spec 文件 `describe('getAssistData')` 之后新增）**

```ts
  describe('getAssistCompare', () => {
    it('返回 bidders + projectFraudSummary + reportDocxUrl（项目级）', async () => {
      prisma.bidExpert.findFirst.mockResolvedValue({ id: 'exp-1', userId: 'u1' });
      prisma.aiBidAnalysisTask.findUnique.mockResolvedValue({ id: 't-1' });
      prisma.aiBidderResult.findMany.mockResolvedValue([
        { bidSupplierId: 's1', totalScore: 80, categoryTotals: {}, qualificationStatus: '通过', riskLevel: 'low',
          bidSupplier: { supplierName: '甲' } },
      ]);
      prisma.aiBidReport.findUnique.mockResolvedValue({
        fraudIndicators: { riskLevel: 'medium', summary: { totalCount: 3 } },
        docxFileId: 'doc-1',
      });

      const out = await service.getAssistCompare('u1', 'proj-1');
      expect(out.bidders).toHaveLength(1);
      expect(out.bidders[0]).toMatchObject({ supplierId: 's1', supplierName: '甲', totalScore: 80 });
      expect(out.projectFraudSummary).toEqual({ riskLevel: 'medium', indicatorCount: 3 });
      expect(out.reportDocxUrl).toBe('/api/upload/files/doc-1');
    });

    it('无 task 时返回空 bidders + null 摘要', async () => {
      prisma.bidExpert.findFirst.mockResolvedValue({ id: 'exp-1', userId: 'u1' });
      prisma.aiBidAnalysisTask.findUnique.mockResolvedValue(null);
      const out = await service.getAssistCompare('u1', 'proj-1');
      expect(out.bidders).toEqual([]);
      expect(out.projectFraudSummary).toBeNull();
      expect(out.reportDocxUrl).toBeNull();
    });
  });
```

> 注意：`prisma.aiBidAnalysisTask.findUnique` / `prisma.aiBidReport` 在该 spec 里可能已被前面的 `prisma.aiBidAnalysisTask = {...}` 赋值覆盖（:184）。若如此，改用 `jest.fn()` 挂回标准 mock 形式（`prisma.aiBidAnalysisTask.findUnique = jest.fn()`）。实现前先看 spec 文件顶部的 mock 设置方式，与之保持一致。

- [ ] **Step 2: 运行测试，确认失败**

Run: `pnpm --filter api test -- expert.service.spec.ts`
Expected: FAIL（`out.projectFraudSummary` 为 undefined）。

- [ ] **Step 3: 改 getAssistCompare 实现（service.ts:618-645）**

把：

```ts
  async getAssistCompare(userId: string, projectId: string) {
    const expert = await this.prisma.bidExpert.findFirst({
      where: { userId, projectId },
    });
    if (!expert) throw new ForbiddenException({ error: '您不是该项目的评审专家', code: 'NOT_PROJECT_EXPERT' });

    const task = await this.prisma.aiBidAnalysisTask.findUnique({
      where: { projectId },
      select: { id: true },
    });
    if (!task) return { bidders: [] };

    const results = await this.prisma.aiBidderResult.findMany({
      where: { taskId: task.id, status: 'COMPLETED' },
      include: { bidSupplier: { select: { supplierName: true } } },
    });

    return {
      bidders: results.map((r) => ({
        supplierId: r.bidSupplierId,
        supplierName: r.bidSupplier.supplierName,
        totalScore: r.totalScore != null ? Number(r.totalScore) : 0,
        categoryTotals: (r.categoryTotals as Record<string, { score: number; max: number }>) ?? {},
        qualificationStatus: r.qualificationStatus ?? '待审查',
        riskLevel: r.riskLevel ?? 'low',
      })),
    };
  }
```

替换为：

```ts
  async getAssistCompare(userId: string, projectId: string) {
    const expert = await this.prisma.bidExpert.findFirst({
      where: { userId, projectId },
    });
    if (!expert) throw new ForbiddenException({ error: '您不是该项目的评审专家', code: 'NOT_PROJECT_EXPERT' });

    const task = await this.prisma.aiBidAnalysisTask.findUnique({
      where: { projectId },
      select: { id: true },
    });
    if (!task) return { bidders: [], projectFraudSummary: null, reportDocxUrl: null };

    const [results, report] = await Promise.all([
      this.prisma.aiBidderResult.findMany({
        where: { taskId: task.id, status: 'COMPLETED' },
        include: { bidSupplier: { select: { supplierName: true } } },
      }),
      this.prisma.aiBidReport.findUnique({
        where: { taskId: task.id },
        select: { fraudIndicators: true, docxFileId: true },
      }),
    ]);

    let projectFraudSummary: { riskLevel: string; indicatorCount: number } | null = null;
    if (report?.fraudIndicators) {
      const fi = report.fraudIndicators as any;
      projectFraudSummary = {
        riskLevel: fi.riskLevel ?? 'low',
        indicatorCount: fi.summary?.totalCount ?? fi.indicators?.length ?? 0,
      };
    }
    const reportDocxUrl = report?.docxFileId ? `/api/upload/files/${report.docxFileId}` : null;

    return {
      bidders: results.map((r) => ({
        supplierId: r.bidSupplierId,
        supplierName: r.bidSupplier.supplierName,
        totalScore: r.totalScore != null ? Number(r.totalScore) : 0,
        categoryTotals: (r.categoryTotals as Record<string, { score: number; max: number }>) ?? {},
        qualificationStatus: r.qualificationStatus ?? '待审查',
        riskLevel: r.riskLevel ?? 'low',
      })),
      projectFraudSummary,
      reportDocxUrl,
    };
  }
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `pnpm --filter api test -- expert.service.spec.ts`
Expected: PASS（含新增两个 `getAssistCompare` 用例）。

- [ ] **Step 5: 跑全量 api 测试 + lint，确认无回归**

Run: `pnpm --filter api test && pnpm --filter api lint`
Expected: 全绿。

- [ ] **Step 6: Commit**

```bash
git -C /home/asus/桌面/ERP add apps/api/src/expert/expert.service.ts apps/api/src/expert/expert.service.spec.ts
git -C /home/asus/桌面/ERP commit -m "refactor(api/expert): getAssistCompare 接收 projectFraudSummary + reportDocxUrl"
```

---

## Task 5: 前端孤儿清理

**Files:**
- Delete: `apps/expert-portal/src/components/evaluate/assist/tabs/`（整目录）
- Delete: `apps/expert-portal/src/components/evaluate/assist/cross-bidder-overview.tsx`
- Delete: `apps/expert-portal/src/components/evaluate/assist/charts/assist-kpi-card.tsx`
- Delete: `apps/expert-portal/src/components/evaluate/assist/charts/index.ts`
- Modify: `apps/expert-portal/src/components/evaluate/assist/assist-panel.tsx:43`（删 `import { AssistKpiCard }`）

- [ ] **Step 1: 删孤儿文件**

```bash
cd /home/asus/桌面/ERP/water-erp
rm -rf apps/expert-portal/src/components/evaluate/assist/tabs
rm apps/expert-portal/src/components/evaluate/assist/cross-bidder-overview.tsx
rm apps/expert-portal/src/components/evaluate/assist/charts/assist-kpi-card.tsx
rm apps/expert-portal/src/components/evaluate/assist/charts/index.ts
```

- [ ] **Step 2: 删 assist-panel.tsx 的死 import（:43）**

删除这一行：

```ts
import { AssistKpiCard } from './charts/assist-kpi-card';
```

- [ ] **Step 3: 类型检查 + lint + build**

Run: `pnpm --filter expert-portal lint && pnpm build:expert`
Expected: 无未解析 import，build 成功。

- [ ] **Step 4: 确认无残留引用**

Run: `grep -rn "tabs/\|cross-bidder-overview\|AssistKpiCard\|charts/index" apps/expert-portal/src`
Expected: 零命中。

- [ ] **Step 5: Commit**

```bash
git -C /home/asus/桌面/ERP add -A apps/expert-portal
git -C /home/asus/桌面/ERP commit -m "chore(expert-portal): 清理 assist 孤儿代码（tabs/ cross-bidder-overview AssistKpiCard 死barrel）"
```

---

## Task 6: 抽出 shared/ 小组件（过渡、不改变运行行为）

**Why:** 这些子组件被多个层复用（折叠容器、编号标题、pass-fail 卡、SW 卡、字段卡、排名徽标）。先抽出来，后续各层任务直接 import；此步不改任何渲染行为。

**Files:**
- Create: `apps/expert-portal/src/components/evaluate/assist/shared/{collapsible-section,section-header,pass-fail-card,sw-card,field-card,rank-badge}.tsx`
- Modify: `apps/expert-portal/src/components/evaluate/assist/assist-panel.tsx`（改为从 shared/ import 同名组件，删本地定义）

**Interfaces:**
- Produces（每个 named export，签名与现状完全一致，纯搬迁）：
  - `CollapsibleSection({title,icon,accent?,defaultOpen?,summary?})` — 来自 assist-panel.tsx:193-231
  - `SectionHeader({number,title,subtitle?})` + `SectionNumber({n})` — :1166-1194
  - `PassFailReviewCard({item}: {item: AiScoreItem})` — :102-140
  - `SwCard({item,type}: {item: SwItem; type:'strength'|'weakness'})` — :144-189（`SwItem` 类型随之搬到 shared/sw-card.tsx 并 export）
  - `FieldCard({icon,label,value,suffix?})` — :235-257
  - `RankBadge({rank}: {rank: number})` — :261-285

- [ ] **Step 1: 建目录 + 6 个文件**

把 assist-panel.tsx 里对应函数体原样剪切到各自文件，加 `'use client';`（含 hooks 的 `CollapsibleSection` 需要）和必要 import（`AiScoreItem` from `@water-erp/shared`、lucide 图标按各组件实际用量）。每个文件 `export function X(...)`。

示例 `shared/sw-card.tsx` 顶部：

```tsx
'use client';
import { TrendingUp, AlertCircle } from 'lucide-react';

export interface SwItem {
  dimension: string; title: string; detail: string;
  evidence?: string; impact?: string;
}
const DIMENSION_LABEL: Record<string, string> = { qualification:'资质', technical:'技术', commercial:'商务', price:'价格', risk:'风险' };
const DIMENSION_COLOR: Record<string, string> = { qualification:'#064ea2', technical:'#11a874', commercial:'#f5a623', price:'#e74c3c', risk:'#8b5cf6' };

export function SwCard({ item, type }: { item: SwItem; type: 'strength' | 'weakness' }) {
  // ...原 assist-panel.tsx:144-189 的函数体，原样
}
```

> `DIMENSION_LABEL/COLOR` 随 `SwCard` 一起搬（仅它用）。

- [ ] **Step 2: assist-panel.tsx 改为 import，删本地定义**

文件顶部加：

```ts
import { CollapsibleSection } from './shared/collapsible-section';
import { SectionHeader, SectionNumber } from './shared/section-header';
import { PassFailReviewCard } from './shared/pass-fail-card';
import { SwCard, type SwItem } from './shared/sw-card';
import { FieldCard } from './shared/field-card';
import { RankBadge } from './shared/rank-badge';
```

删掉 assist-panel.tsx 里 :102-285 的本地 `PassFailReviewCard / SwCard / CollapsibleSection / FieldCard / RankBadge / SectionNumber / SectionHeader` 定义，以及文件顶部本地的 `DIMENSION_LABEL/COLOR` 和 `SwItem`（已搬走）。

- [ ] **Step 3: 验证行为不变**

Run: `pnpm --filter expert-portal lint && pnpm build:expert`
手动：`pnpm dev:expert`，访问 `/evaluate/cmqhero-bid-proj01` 选 assist 步，确认页面与 Task 5 之后完全一致（折叠、评分条、SW 卡、排名徽标渲染正常）。
Expected: 编译通过；视觉/交互无变化。

- [ ] **Step 4: Commit**

```bash
git -C /home/asus/桌面/ERP add apps/expert-portal
git -C /home/asus/桌面/ERP commit -m "refactor(expert-portal/assist): 抽出 shared/ 小组件（行为不变）"
```

---

## Task 7: status-bar.tsx — 档案头条重构

**Implements:** spec 3.2。移除 资格审查/风险/一致性/我的评分/评审进度；保留 供应商名+解密 / 投标报价 / AI 总分(降级) / 模型+生成时间。

**Files:**
- Create: `apps/expert-portal/src/components/evaluate/assist/status-bar.tsx`
- Modify: `apps/expert-portal/src/components/evaluate/assist/assist-panel.tsx`（删本地 `StatusBar`，import 新组件）

**Interfaces:**
- Produces: `StatusBar({ assistData, supplierName, decryptStatus }: { assistData: AssistData; supplierName: string; decryptStatus: string })`

- [ ] **Step 1: 写 status-bar.tsx**

```tsx
'use client';
import type { AssistData } from '@water-erp/shared';

export function StatusBar({
  assistData,
  supplierName,
  decryptStatus,
}: {
  assistData: AssistData;
  supplierName: string;
  decryptStatus: string;
}) {
  const score = assistData.totalScore != null ? Number(assistData.totalScore).toFixed(1) : '—';
  const quote = (assistData.keyInfo as any)?.quotePriceYuan ?? null;
  const dotColor =
    decryptStatus === 'SUCCESS' ? 'bg-[#11a874]'
    : decryptStatus === 'DANGER' ? 'bg-[#e74c3c]'
    : 'bg-[#f5a623]';
  const decryptLabel = decryptStatus === 'SUCCESS' ? '已解密' : decryptStatus === 'DANGER' ? '解密异常' : decryptStatus === 'RUNNING' ? '解密中' : '待解密';

  return (
    <div className="grid gap-x-10 gap-y-2 mb-3 px-6 py-4 bg-white/60 rounded-xl border border-[oklch(0.91_0.006_264)]"
      style={{ gridTemplateColumns: '1fr auto auto auto', alignItems: 'center' }}>
      {/* 供应商 + 解密 */}
      <div className="flex items-center gap-2 min-w-0">
        <span className={`w-2 h-2 rounded-full shrink-0 ${dotColor}`} />
        <span className="text-sm font-bold text-[oklch(0.18_0.012_265)] truncate">{supplierName}</span>
        <span className="text-[10px] text-[oklch(0.55_0.01_264)] shrink-0">{decryptLabel}</span>
      </div>
      {/* 投标报价 */}
      <div className="flex flex-col gap-0.5">
        <span className="text-[10px] font-medium uppercase tracking-[0.1em] text-[oklch(0.50_0.010_264)] select-none">投标报价</span>
        <span className="text-sm font-bold tabular-nums text-[oklch(0.18_0.012_265)]">{quote ?? '—'}</span>
      </div>
      {/* AI 总分（降级，不再 44px 英雄） */}
      <div className="flex flex-col gap-0.5">
        <span className="text-[10px] font-medium uppercase tracking-[0.1em] text-[oklch(0.50_0.010_264)] select-none">AI 总分</span>
        <span className="text-xl font-bold tabular-nums text-[var(--color-primary)]">{score}</span>
      </div>
      {/* provenance */}
      <div className="flex flex-col gap-0.5 text-right">
        <span className="text-[10px] text-[oklch(0.62_0.008_264)]">{assistData.model ?? 'AI 分析'}</span>
        {assistData.generatedAt && (
          <span className="text-[10px] text-[oklch(0.62_0.008_264)]">{new Date(assistData.generatedAt).toLocaleString('zh-CN')}</span>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: assist-panel.tsx 接入**

删本地 `StatusBar` 函数（原 :367-421），顶部加 `import { StatusBar } from './status-bar';`。把正常态里 `<StatusBar assistData={assistData} />`（原 :1286）改为：

```tsx
<StatusBar assistData={assistData} supplierName={supplierName} decryptStatus={...} />
```

`decryptStatus` 由调用方传入：在 `AssistPanel` props 增加 `activeSupplierDecryptStatus`（或从父 page.tsx 传 `project.suppliers.find(...).decryptStatus`）。本任务内：给 `AssistPanelProps` 加 `decryptStatus: string`，page.tsx 调用处（page.tsx:1149-1158）补传 `decryptStatus={project.suppliers.find(s=>s.id===activeSupplier)?.decryptStatus ?? ''}`。

- [ ] **Step 3: 验证**

Run: `pnpm --filter expert-portal lint && pnpm build:expert`
手动：头条显示 供应商名+解密点 / 投标报价 / AI 总分（小号）/ 模型+时间；**不再**显示 资格审查/风险/一致性。
Expected: 符合 spec 3.2。

- [ ] **Step 4: Commit**

```bash
git -C /home/asus/桌面/ERP add apps/expert-portal
git -C /home/asus/桌面/ERP commit -m "feat(expert-portal/assist): 档案头条重构（去重资格/风险，加报价+provenance）"
```

---

## Task 8: gate-layer.tsx — ① 合规门

**Implements:** spec 3.3。资格审查以 `qualificationStatus` 为权威、响应性以 `starredResponse.allMet` 为权威；门带常驻展开；阻断条归位；亮出条款级证据（requirementResponses 资格计数 + starredResponse.unmet）。

**Files:**
- Create: `apps/expert-portal/src/components/evaluate/assist/gate-layer.tsx`
- Modify: `assist-panel.tsx`（删资格不通过独立阻断条 :1289-1301；接入 GateLayer）

**Interfaces:**
- Produces: `GateLayer({ assistData }: { assistData: AssistData })`

- [ ] **Step 1: 写 gate-layer.tsx**

```tsx
'use client';
import { ShieldCheck, ClipboardCheck, ShieldAlert, CheckCircle, XCircle, Star } from 'lucide-react';
import type { AssistData, RequirementResponse } from '@water-erp/shared';

export function GateLayer({ assistData }: { assistData: AssistData }) {
  const qualOk = assistData.qualificationStatus === '通过';
  const qualFail = assistData.qualificationStatus === '不通过';
  const responsiveOk = assistData.starredResponse?.allMet === true;
  const responsiveFail = assistData.starredResponse?.allMet === false;
  const allOk = qualOk && responsiveOk;
  const anyFail = qualFail || responsiveFail;

  // 资格条款证据（requirementResponses 里 category=qualification）
  const qualResps = (assistData.requirementResponses ?? []).filter((r) => r.category === 'qualification');
  const tally = (arr: RequirementResponse[], status: RequirementResponse['status']) => arr.filter((r) => r.status === status).length;
  const unmetQual = qualResps.filter((r) => r.status === 'unmet' || r.status === 'not_found');

  // 资格不通过的 [自动] 说明（原来自 overallComment）
  const qualAutoNote = qualFail
    ? (assistData.overallComment ?? '').split('\n').find((l) => l.includes('[自动]'))
    : null;

  const bandCls = anyFail
    ? 'bg-red-50/80 border-red-200 text-red-700'
    : allOk ? 'bg-emerald-50/80 border-emerald-200 text-emerald-700' : 'bg-amber-50/80 border-amber-200 text-amber-700';

  return (
    <section>
      <div className={`flex items-center gap-3 px-4 py-3 rounded-xl border ${bandCls}`}>
        <span className="text-sm font-bold">合规门</span>
        <Verdict ok={qualOk} fail={qualFail} label="资格审查" icon={<ShieldCheck size={13} />} />
        <Verdict ok={responsiveOk} fail={responsiveFail} label="响应性" icon={<ClipboardCheck size={13} />} />
      </div>

      {/* 阻断条归位（原浮在头条下） */}
      {qualFail && (
        <div className="flex items-start gap-2.5 px-4 py-2.5 mt-2 rounded-xl border border-red-200 bg-red-50/80">
          <ShieldAlert size={15} className="text-red-500 shrink-0 mt-0.5" />
          <div className="text-xs text-red-700">
            <span className="font-semibold">资格审查不通过 · AI 自动判定</span>
            <p className="mt-0.5 text-red-600/90">{qualAutoNote ?? '存在资质一致性冲突或★实质性条款未响应，建议重点核实资格材料。'}</p>
          </div>
        </div>
      )}

      {/* 资格条款证据（亮出 B'） */}
      {qualResps.length > 0 && (
        <div className="mt-2 text-[11px] text-[oklch(0.45_0.01_264)] flex flex-wrap gap-x-4 gap-y-1 px-4">
          <span>资格条款：满足 {tally(qualResps,'met')} · 部分 {tally(qualResps,'partial')} · 不满足 {tally(qualResps,'unmet')} · 未提及 {tally(qualResps,'not_found')}</span>
        </div>
      )}
      {unmetQual.length > 0 && (
        <ul className="mt-1.5 space-y-1 px-4">
          {unmetQual.slice(0,4).map((r,i) => (
            <li key={i} className="text-[11px] text-red-700 flex items-start gap-1">
              <XCircle size={11} className="mt-0.5 shrink-0" />
              <span className="truncate" title={r.excerpt}>{r.excerpt || r.requirementId}{r.location ? `（第${r.location.page}页）` : ''}</span>
            </li>
          ))}
        </ul>
      )}

      {/* 响应性 unmet（starredResponse） */}
      {responsiveFail && assistData.starredResponse?.unmet && assistData.starredResponse.unmet.length > 0 && (
        <ul className="mt-1.5 space-y-1 px-4">
          {assistData.starredResponse.unmet.slice(0,4).map((u,i) => (
            <li key={i} className="text-[11px] text-amber-700 flex items-start gap-1">
              <Star size={11} className="mt-0.5 shrink-0 fill-amber-400 text-amber-500" />
              <span className="truncate" title={u}>{u}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Verdict({ ok, fail, label, icon }: { ok: boolean; fail: boolean; label: string; icon: React.ReactNode }) {
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full
      ${ok ? 'bg-emerald-100 text-emerald-700' : fail ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'}`}>
      {icon}
      {label}
      {ok ? <CheckCircle size={11}/> : fail ? <XCircle size={11}/> : null}
    </span>
  );
}
```

- [ ] **Step 2: assist-panel.tsx 接入 + 删旧阻断条**

顶部加 `import { GateLayer } from './gate-layer';`。删 :1289-1301 的资格不通过独立阻断条块。在 StatusBar 之后、评分分析之前插入 `<GateLayer assistData={assistData} />`。

- [ ] **Step 3: 验证**

Run: `pnpm --filter expert-portal lint && pnpm build:expert`
手动核对 spec 5.2 第 1/2 条：
- 资格审查全页只在门带出现一次（头条/打分层无）。
- 资格用 `qualificationStatus`、响应性用 `starredResponse.allMet`；unmet 列出。
Expected: 符合。

- [ ] **Step 4: Commit**

```bash
git -C /home/asus/桌面/ERP add apps/expert-portal
git -C /home/asus/桌面/ERP commit -m "feat(expert-portal/assist): ① 合规门层（权威判据+阻断条归位+条款证据）"
```

---

## Task 9: evidence-layer.tsx — ② 证据（关键信息 + 数据一致性子块）

**Implements:** spec 3.4。关键信息原样；数据一致性并入为质量子块；非一致项不再 `slice(0,4)`。

**Files:**
- Create: `apps/expert-portal/src/components/evaluate/assist/evidence-layer.tsx`
- Modify: `assist-panel.tsx`（`KeyInfoSection`/`ConcordanceSection` 搬进 evidence-layer；`ConcordanceSection` 内 `slice(0,4)` 放宽）

**Interfaces:**
- Produces: `EvidenceLayer({ assistData, supplierName }: { assistData: AssistData; supplierName: string })`

- [ ] **Step 1: 建 evidence-layer.tsx，搬入 KeyInfoSection（原 :615-730）与 ConcordanceSection（原 :768-847）**

把这两个函数原样搬进 evidence-layer.tsx（含它们用到的 `FieldCard` import、`CONCORDANCE_STATUS_CONFIG` 常量），导出：

```tsx
export function EvidenceLayer({ assistData, supplierName }: { assistData: AssistData; supplierName: string }) {
  return (
    <section className="space-y-3">
      <KeyInfoSection keyInfo={assistData.keyInfo} supplierName={supplierName} />
      <div>
        <div className="flex items-center gap-2 mb-2 text-xs font-bold text-[oklch(0.45_0.01_264)]">
          <span className="w-1.5 h-1.5 rounded-full bg-[#064ea2]" /> 数据一致性（系统 vs OCR）
        </div>
        <ConcordanceSection concordance={assistData.concordance} concordanceStatus={assistData.concordanceStatus} />
      </div>
    </section>
  );
}
```

- [ ] **Step 2: 放宽 ConcordanceSection 的 slice**

把原 `sorted.filter(c => c.status !== 'consistent').slice(0, 4)` 改为不限 4 条、超 6 条折叠：

```tsx
        {(() => {
          const items = sorted.filter(c => c.status !== 'consistent');
          const [showAll, setShowAll] = useState(false);   // 顶层 import useState
          const shown = showAll ? items : items.slice(0, 6);
          return (<>
            {shown.map(/* 原渲染 */)}
            {items.length > 6 && (
              <button onClick={() => setShowAll(v=>!v)} className="mt-1.5 text-[11px] text-[var(--color-primary)] hover:underline">
                {showAll ? '收起' : `展开全部 ${items.length} 项`}
              </button>
            )}
          </>);
        })()}
```

> 若嫌 IIFE+hook 别扭，把这部分抽成 `ConcordanceList` 子组件。二选一，保持一致。

- [ ] **Step 3: assist-panel.tsx 接入**

删本地 `KeyInfoSection`/`ConcordanceSection` 定义和 `CONCORDANCE_STATUS_CONFIG`；import `EvidenceLayer`。在主壳 ② 位置渲染（替代原 ② 与 ③ 双列块里的一致性部分）。删除原 `grid-cols-2` 包裹一致性+串通的双列结构（:1335-1361）——串通检测在 Task 11 另处理。

- [ ] **Step 4: 验证**

Run: `pnpm --filter expert-portal lint && pnpm build:expert`
手动：关键信息 + 数据一致性上下排列；非一致项 >6 时有"展开全部"按钮。
Expected: 符合 spec 3.4 / 5.2 第 5 条。

- [ ] **Step 5: Commit**

```bash
git -C /home/asus/桌面/ERP add apps/expert-portal
git -C /home/asus/桌面/ERP commit -m "feat(expert-portal/assist): ② 证据层（一致性并入、非一致项展开）"
```

---

## Task 10: scoring-layer.tsx — ③ 打分（主观/客观切分 + 亮出 B'）

**Implements:** spec 3.5。③a 客观价格（紧凑、不显 confidence/unstable）；③b 主观商务/技术（默认展开、reason 多行不截断、evidence 常驻、单项 confidence/unstable、条款佐证、偏差表加 reason）；③c 综合。

**Files:**
- Create: `apps/expert-portal/src/components/evaluate/assist/scoring-layer.tsx`
- Modify: `charts/score-breakdown-bars.tsx`（默认 `reasonLines` 与 evidence 显示策略）
- Modify: `assist-panel.tsx`（`ScoringSection`/`ExpertComparisonTable` 搬进 scoring-layer）

**Interfaces:**
- Produces: `ScoringLayer({ assistData, expertScores, activeSupplier, projectScoreItems }: { assistData: AssistData; expertScores: Record<string,{score:number;reason:string}>; activeSupplier: string; projectScoreItems: BidScoreItem[] })`

- [ ] **Step 1: 改 score-breakdown-bars.tsx 默认值（reason 多行 + evidence 常驻）**

把 `ScoreBar`（:38）默认 `reasonLines = 1` 改 `reasonLines = 2`；并把 evidence 显示条件从 `expanded && evidence`（:55）改为 `evidence`（常驻）。即：

```tsx
function ScoreBar({ ..., reasonLines = 2, expanded = false }: ...) {
  ...
  {comment && <p className={`... ${clampClass}`}>{comment}</p>}            // clampClass: expanded→'' / 2→'line-clamp-2'
  {evidence && <p className="...">证据：{evidence}</p>}                    // 去掉 expanded&&
}
```

> 价格项（③a）不显 confidence/unstable 是上层渲染选择（见 Step 2， PRICE 不进 ScoreBreakdownBars 的置信度区），本步只调文本密度。

- [ ] **Step 2: 建 scoring-layer.tsx**

```tsx
'use client';
import { useState } from 'react';
import { ShieldCheck, ClipboardCheck, FileText, AlertCircle, TrendingUp, Lightbulb, MessageSquare, Edit3 } from 'lucide-react';
import type { AssistData, AiScoreItem, BidScoreItem } from '@water-erp/shared';
import { CollapsibleSection } from './shared/collapsible-section';
import { SectionHeader } from './shared/section-header';
import { PassFailReviewCard } from './shared/pass-fail-card';
import { SwCard, type SwItem } from './shared/sw-card';
import { ScoreBreakdownBars, CATEGORY_LABEL } from './charts/score-breakdown-bars';

const TAG = { objectivePrice: '客观·公式', subjective: '主观·AI 建议', summary: 'AI 综合' };

export function ScoringLayer({ assistData, expertScores, activeSupplier, projectScoreItems }: {
  assistData: AssistData;
  expertScores: Record<string, { score: number; reason: string }>;
  activeSupplier: string;
  projectScoreItems: BidScoreItem[];
}) {
  const items = assistData.scoreItems ?? [];
  const price = items.filter(i => i.category === 'PRICE');
  const subjective = items.filter(i => i.category === 'BUSINESS' || i.category === 'TECHNICAL');

  return (
    <section className="space-y-4">
      <SectionHeader number={3} title="打分" />

      {/* ③a 客观·价格 */}
      {price.length > 0 && (
        <div className="glass-card rounded-xl p-4">
          <Tag>{TAG.objectivePrice}</Tag>
          <div className="mt-2"><ScoreBreakdownBars scoreItems={price} flat reasonLines={2} /></div>
          {/* 不显 confidence/unstable（客观公式项） */}
        </div>
      )}

      {/* ③b 主观·商务/技术（默认展开） */}
      {subjective.length > 0 && (
        <div className="glass-card rounded-xl p-4 space-y-3">
          <Tag>{TAG.subjective}</Tag>
          {/* 单项 confidence/unstable 警告 */}
          <ConfidenceWarnings items={subjective} />
          {/* 按 category 默认展开折叠组 */}
          {['BUSINESS','TECHNICAL'].map(cat => {
            const sub = subjective.filter(i => i.category === cat);
            if (!sub.length) return null;
            return (
              <CollapsibleSection key={cat} defaultOpen
                title={CATEGORY_LABEL[cat] ?? cat}
                accent={cat==='BUSINESS' ? '#f5a623' : '#11a874'}
                summary={<ScoreBreakdownBars scoreItems={sub} flat reasonLines={2} />}
              />
            );
          })}
          {/* 条款佐证（技术/商务 requirementResponses） */}
          <ClauseEvidence resp={(assistData.requirementResponses ?? []).filter(r => r.category==='technical' || r.category==='commercial')} />
          {/* AI vs 专家偏差表（回看才出现） */}
          <ExpertComparisonTable items={subjective} projectScoreItems={projectScoreItems} expertScores={expertScores} activeSupplier={activeSupplier} />
        </div>
      )}

      {/* ③c 综合 */}
      <Summary assistData={assistData} />
    </section>
  );
}
```

实现 `Tag` / `ConfidenceWarnings` / `ClauseEvidence` / `Summary` 子组件：

```tsx
function Tag({ children }: { children: React.ReactNode }) {
  return <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-[oklch(0.94_0.004_264)] text-[oklch(0.45_0.01_264)]">{children}</span>;
}

function ConfidenceWarnings({ items }: { items: AiScoreItem[] }) {
  const low = items.filter(i => i.confidence != null && i.confidence < 0.6);
  const unstable = items.filter(i => i.unstable);
  return (<>
    {low.length > 0 && <Warn cls="amber">{`有 ${low.length} 项评分置信度较低（<60%），建议人工重点复核。`}</Warn>}
    {unstable.length > 0 && <Warn cls="orange">{`⚙ 有 ${unstable.length} 项评分多次采样差异大（AI 把握度低），请重点复核。`}</Warn>}
  </>);
}
function Warn({ cls, children }: { cls: 'amber'|'orange'; children: React.ReactNode }) {
  const c = cls==='amber' ? 'border-amber-200 bg-amber-50 text-amber-700' : 'border-orange-200 bg-orange-50 text-orange-700';
  return <div className={`p-2.5 rounded-lg border ${c} text-[11px] flex items-start gap-1.5`}><AlertCircle size={12} className="mt-px shrink-0"/>{children}</div>;
}

function ClauseEvidence({ resp }: { resp: AssistData['requirementResponses'] }) {
  if (!resp || !resp.length) return null;
  const bad = resp.filter(r => r.status === 'unmet' || r.status === 'partial' || r.status === 'not_found').slice(0,3);
  if (!bad.length) return null;
  return (
    <div className="rounded-lg border border-[oklch(0.91_0.006_264)] bg-[oklch(0.985_0.002_264)] p-2.5">
      <div className="text-[10px] font-semibold text-[oklch(0.45_0.01_264)] mb-1">条款响应佐证</div>
      {bad.map((r,i) => (
        <div key={i} className="text-[11px] text-[oklch(0.35_0.01_264)] truncate" title={r.excerpt}>
          · {r.excerpt || r.requirementId}{r.location ? `（第${r.location.page}页）`:''}
        </div>
      ))}
    </div>
  );
}

function Summary({ assistData }: { assistData: AssistData }) {
  const obs = assistData.keyObservations ?? [];
  const s = (assistData.strengths as SwItem[] | null) ?? [];
  const w = (assistData.weaknesses as SwItem[] | null) ?? [];
  return (
    <div className="glass-card rounded-xl p-4 space-y-3">
      <Tag>{TAG.summary}</Tag>
      {obs.length > 0 && (
        <div>
          <div className="flex items-center gap-1.5 mb-1.5 text-sm font-bold text-[var(--color-primary)]"><Lightbulb size={13}/> 关键观察</div>
          <ol className="space-y-1">{obs.map((o,i)=>(<li key={i} className="text-xs flex gap-1.5"><span className="font-bold">{i+1}.</span>{o}</li>))}</ol>
        </div>
      )}
      {s.length > 0 && (<div><div className="flex items-center gap-1.5 mb-1 text-sm font-bold"><TrendingUp size={13} className="text-emerald-500"/> 正向依据（{s.length}）</div><div className="space-y-1.5">{s.map((x,i)=><SwCard key={i} item={x} type="strength"/>)}</div></div>)}
      {w.length > 0 && (<div><div className="flex items-center gap-1.5 mb-1 text-sm font-bold"><AlertCircle size={13} className="text-amber-500"/> 需关注事项（{w.length}）</div><div className="space-y-1.5">{w.map((x,i)=><SwCard key={i} item={x} type="weakness"/>)}</div></div>)}
      {assistData.overallComment && (<div><div className="flex items-center gap-1.5 mb-1 text-sm font-bold"><MessageSquare size={13}/> AI 分析评语</div><p className="text-xs leading-relaxed text-[var(--color-text-secondary)]">{assistData.overallComment}</p></div>)}
    </div>
  );
}
```

`ExpertComparisonTable`：搬原 assist-panel.tsx:289-357，加一列 reason。关键改动——表头加 `<th>理由对照</th>`，行内：

```tsx
<td className="py-2 text-[11px] text-[var(--color-text-tertiary)] max-w-[200px]">
  <div className="truncate" title={aiItem?.reason}>AI：{aiItem?.reason ?? '—'}</div>
  <div className="truncate" title={myScore?.reason}>我：{myScore?.reason ?? '—'}</div>
</td>
```

且 `hasComparison` 门控不变（`myScoredItems.length > 0` 才渲染）。

> PRICE 项是否额外展示 `priceAnalysis`：若 Task 1 结论为"持久化了"，`ScoreBar`/③a 增加 `{i.priceAnalysis && <p>策略：{i.priceAnalysis.strategyAssessment?.type}</p>}`；否则忽略。本步按 Task 1 结论二选一。

- [ ] **Step 3: assist-panel.tsx 接入**

删本地 `ScoringSection`/`ExpertComparisonTable`；import `ScoringLayer`。主壳 ③ 位置渲染 `<ScoringLayer ... />`，传 `assistData`/`expertScores`/`activeSupplier`/`projectScoreItems`。

- [ ] **Step 4: 验证**

Run: `pnpm --filter expert-portal lint && pnpm build:expert`
手动核对 spec 5.2 第 6/7/8 条：
- 三标签在；价格项无 confidence/unstable，商务/技术项有；
- 主观类别默认展开、reason 多行、evidence 常驻、每项置信度（通过聚合警告 + 折叠组内 ScoreBreakdownBars）；
- 条款佐证块出现；偏差表（回看时）含 reason 列。
Expected: 符合。

- [ ] **Step 5: Commit**

```bash
git -C /home/asus/桌面/ERP add apps/expert-portal
git -C /home/asus/桌面/ERP commit -m "feat(expert-portal/assist): ③ 打分层（主观/客观切分+亮出 evidence/confidence/条款佐证/偏差reason）"
```

---

## Task 11: cross-bidder-layer.tsx — ④ 横向对比（排名 + 项目级围标 + 导出报告）

**Implements:** spec 3.6。搬入 `RankingSection`；新增 projectFraudSummary 摘要（从 compare 响应）；新增"导出 AI 分析报告"按钮（reportDocxUrl）；per-bidder riskLevel 仍在排名表；删旧单供应商区 `FraudSection`。

**Files:**
- Create: `apps/expert-portal/src/components/evaluate/assist/cross-bidder-layer.tsx`
- Modify: `assist-panel.tsx`（删 `FraudSection` 定义 :860-900 及其调用；接入 CrossBidderLayer）

**Interfaces:**
- Produces: `CrossBidderLayer({ projectId, activeSupplier }: { projectId: string; activeSupplier: string })`（内部自取 `/assist/compare`）

- [ ] **Step 1: 建 cross-bidder-layer.tsx，搬入 RankingSection 主体（原 :904-1160）**

把原 `RankingSection` 函数体搬入，fetch 类型更新为 `AssistCompareResponse`：

```tsx
'use client';
import { useEffect, useState } from 'react';
import { BarChart3, Download, ShieldAlert } from 'lucide-react';
import type { AssistCompareResponse } from '@water-erp/shared';
import { api } from '@/lib/api';
import { SectionHeader } from './shared/section-header';
import { RankBadge } from './shared/rank-badge';
import { RadarChart } from './charts/radar-chart';
import type { RadarAxis } from './charts/radar-chart';
import { ScoreBarChart } from './charts/score-bar-chart';
import type { ScoreBarChartData } from './charts/score-bar-chart';
import { PriceComparisonChart } from './charts/price-comparison-chart';

export function CrossBidderLayer({ projectId, activeSupplier }: { projectId: string; activeSupplier: string }) {
  const [data, setData] = useState<AssistCompareResponse | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let cancelled = false; setLoading(true);
    api.get<AssistCompareResponse>(`/expert/projects/${projectId}/assist/compare`)
      .then(d => { if (!cancelled) { setData(d); setLoading(false); } })
      .catch(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [projectId]);

  if (loading) return <div className="text-center py-8 text-xs text-[oklch(0.55_0.01_264)]">加载排名数据…</div>;
  const bidders = data?.bidders ?? [];
  if (bidders.length === 0) return <div className="text-center py-6 text-sm text-[oklch(0.55_0.01_264)]">排名数据在所有供应商分析完成后生成</div>;

  // ……原 RankingSection 的 sorted/radarAxes/barChartData 计算与渲染……
  // 末尾追加两块：
  return (<div className="space-y-4">
    {/* 原：排名表 + 维度对比(雷达/柱) + 报价对比 —— 原样 */}

    {/* 项目级围标风险摘要（原 FraudSection 内容，标注项目级） */}
    {data?.projectFraudSummary && (
      <div className="glass-card rounded-xl p-4">
        <div className="flex items-center gap-2 mb-1">
          <ShieldAlert size={14} className="text-amber-500"/>
          <span className="text-sm font-bold">本项目围标风险</span>
          <span className={`text-xs font-bold ${data.projectFraudSummary.riskLevel==='high'?'text-red-600':data.projectFraudSummary.riskLevel==='medium'?'text-amber-600':'text-emerald-600'}`}>
            {data.projectFraudSummary.riskLevel==='high'?'高':data.projectFraudSummary.riskLevel==='medium'?'中':'低'}
          </span>
          <span className="text-[11px] text-[oklch(0.55_0.01_264)]">· {data.projectFraudSummary.indicatorCount} 项指标</span>
        </div>
        <p className="text-[11px] text-[oklch(0.55_0.01_264)]">详细检测结果仅对管理端可见，此处展示风险摘要供参考。</p>
      </div>
    )}

    {/* 导出 AI 分析报告（B' 亮出 reportDocxUrl） */}
    {data?.reportDocxUrl && (
      <div className="text-center">
        <a href={data.reportDocxUrl} target="_blank" rel="noopener"
           className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg border border-[oklch(0.91_0.006_264)] text-xs font-bold text-[oklch(0.45_0.01_264)] hover:text-[var(--color-primary)] hover:border-[var(--color-primary)] transition">
          <Download size={13}/> 导出 AI 分析报告（DOCX）
        </a>
      </div>
    )}

    <p className="text-[10px] text-[oklch(0.55_0.01_264)] text-center">以上排名与数据由 AI 分析引擎生成，最终评审结果以专家人工评分为准。</p>
  </div>);
}
```

> 原样搬入排名表 + 雷达/柱 + 报价对比三块 JSX（从 RankingSection :1020-1157）。报价对比里仍 `unit="分"`。

- [ ] **Step 2: assist-panel.tsx 接入 + 删旧串通/双列**

删本地 `FraudSection`（:860-900）和 `RISK_DIMENSIONS`（:851-858）；删原 ③④ 双列块（:1334-1361）里残留的 FraudSection 调用。主壳 ④ 位置渲染 `<CrossBidderLayer projectId={projectId} activeSupplier={activeSupplier} />`（替代原 `RankingSection` 调用）。

- [ ] **Step 3: 验证**

Run: `pnpm --filter expert-portal lint && pnpm build:expert`
手动核对 spec 5.2 第 3/4 条：
- 串通检测在 ④，标"本项目围标风险"；**切供应商时摘要与导出按钮不变**（验证项目级）。
- "导出 AI 分析报告（DOCX）"按钮在，点击下载。
Expected: 符合。

- [ ] **Step 4: Commit**

```bash
git -C /home/asus/桌面/ERP add apps/expert-portal
git -C /home/asus/桌面/ERP commit -m "feat(expert-portal/assist): ④ 横向对比层（排名+项目级围标摘要+导出报告按钮）"
```

---

## Task 12: assist-panel.tsx 主壳收尾 + 清 as any

**Implements:** 主壳编排四层；删旧子区段残留；清 `(assistData as any).keyObservations`。

**Files:**
- Modify: `assist-panel.tsx`

- [ ] **Step 1: 主壳正常态 return 收敛为四层**

正常态 return（原 :1283-1376）改为按顺序：`<StatusBar/>` → `<GateLayer/>` → `<EvidenceLayer/>` → `<ScoringLayer/>` → `<CrossBidderLayer/>` → 页脚免责。每层之间用 spec 3.1 的分隔线（单供应商区与跨供应商区之间一条 `<div className="border-t ..."/>` + "跨供应商对比" 标识）。

删除已搬走的旧 section 包装（原 SectionHeader①②③④⑤ 调用、双列 grid 等），只留四层组件。

- [ ] **Step 2: 清 keyObservations 的 as any**

`ScoringLayer` 已用类型化 `assistData.keyObservations`（Task 10），故 assist-panel.tsx :1316-1320 那段 `Array.isArray((assistData as any).keyObservations) ? ...` 整段删除（逻辑已迁入 ScoringLayer.Summary）。

- [ ] **Step 3: 确认 as any 清零（fraudSummary 那个在 Task 11 删 FraudSection 时已去）**

Run: `grep -n "as any" apps/expert-portal/src/components/evaluate/assist/assist-panel.tsx`
Expected: 零命中（或仅剩与本重构无关的既有项——若有，说明来源并决定是否清）。

- [ ] **Step 4: 验证**

Run: `pnpm --filter expert-portal lint && pnpm build:expert`
手动：整页顺序 = 头条 → 合规门 → 证据 → 打分 → 横向对比 → 免责；四态（loading/空/降级/正常）切换正常；切供应商竞态无回闪。
Expected: 符合 spec 3.1 / 5.2 第 9/10 条。

- [ ] **Step 5: Commit**

```bash
git -C /home/asus/桌面/ERP add apps/expert-portal
git -C /home/asus/桌面/ERP commit -m "refactor(expert-portal/assist): 主壳编排四层、清 as any"
```

---

## Task 13: 最终验证

- [ ] **Step 1: 后端全量**

Run: `cd /home/asus/桌面/ERP/water-erp && pnpm --filter api test && pnpm --filter api lint`
Expected: 全绿。

- [ ] **Step 2: 前端 lint + build**

Run: `pnpm --filter expert-portal lint && pnpm build:expert`
Expected: 全绿。

- [ ] **Step 3: shared 已编译**

Run: `pnpm --filter @water-erp/shared build`
Expected: 无错。

- [ ] **Step 4: 手动 IA 清单（spec 5.2 全 12 条）**

启动 `pnpm dev`（含 api + expert）+ 确保 ai-bid-analysis worker 在跑（`pnpm --filter api dev:worker:ai-bid-analysis`），登录专家门户访问 `/evaluate/cmqhero-bid-proj01` 选 assist 步，逐条核对 spec 5.2 第 1-12 条并截图存档。

- [ ] **Step 5: 孤儿零残留**

Run: `grep -rn "tabs/\|cross-bidder-overview\|AssistKpiCard\|charts/index\|fraudSummary" apps/expert-portal/src apps/api/src/expert --include=*.ts --include=*.tsx | grep -v spec`
Expected: 零命中（spec 文件注释里出现 `fraudSummary` 字样是历史描述，可接受）。

- [ ] **Step 6: Commit（如有最终微调）+ 收尾**

```bash
git -C /home/asus/桌面/ERP add -A
git -C /home/asus/桌面/ERP commit -m "test(expert-portal/assist): IA 重排最终验证通过" --allow-empty
```

---

## Self-Review（计划作者自查）

**1. Spec 覆盖**
- 3.1 顶层骨架 → Task 12（主壳编排）+ 各层任务。
- 3.2 头条 → Task 7。
- 3.3 合规门 → Task 8（含权威判据、阻断条归位、条款证据）。
- 3.4 证据 → Task 9（一致性并入、slice 放宽）。
- 3.5 打分 → Task 10（③a/③b/③c、B' 亮出、偏差表 reason）。
- 3.6 横向对比 → Task 11（排名、projectFraudSummary、导出按钮、per-bidder riskLevel）。
- 3.7 后端 + 类型 → Task 2/3/4。
- 3.8 组件拆分 → Task 6/7/8/9/10/11/12。
- 3.9 孤儿清理 → Task 5。
- 4 数据流 → Task 3/4。
- 5 验收 → Task 13（自动 + 手动）+ 各任务 Step 验证；5.3 前置核对 → Task 1。
- 6 风险 → 已在 Task 1（priceAnalysis 分支）、Task 10（偏差表首评隐藏）、Task 4（测试 mock 一致性注释）体现。
- 7 未尽事项 Y → 显式非目标，不在计划内。
- **无遗漏。**

**2. Placeholder 扫描** — 无 TBD/TODO；Task 1 的 priceAnalysis 分支在 Task 2 Step 2 与 Task 10 Step 2 均给出两套完整写法，非占位。

**3. 类型一致性** — `AssistData.keyObservations` / `starredResponse`（Task 2 定义）被 Task 8/10/12 消费；`AssistCompareResponse`（Task 2）被 Task 4 返回、Task 11 消费；`SwItem`（Task 6 定义于 shared/sw-card.tsx）被 Task 10 消费；`getAssistData` 去 fraudSummary/reportDocxUrl + 加 starredResponse（Task 3）与 Task 7/8 消费一致。

**已知执行注意**
- 后端 spec 文件里 `prisma.aiBidAnalysisTask` / `prisma.aiBidReport` 的 mock 挂载方式（对象赋值 vs jest.fn）需与文件顶部 setup 一致（Task 4 Step 1 已标注）。
- 前端无单测，验证依赖 build + 手动清单，执行者需实际跑 `pnpm dev` 看 UI。
- `score-breakdown-bars.tsx` 的默认值改动（Task 10 Step 1）会被所有调用方继承——当前仅 AssistPanel 用它，安全；执行时 grep 确认无其他消费者。
