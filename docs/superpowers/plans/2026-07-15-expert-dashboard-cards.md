# 专家门户首页统计卡片精简 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把专家门户首页的 4 张统计卡精简为 3 张（待核验/评审中/已完成），统一到「专家工作流进度」单一维度，修复「进行中」标签与 `signedInProjects` 的语义错位，并把「平均得分」移到个人信息页。

**Architecture:** 后端抽 `computeAverageScore` 私有 helper，`getStatistics` 与 `getProfile` 共用（保证口径一致、单一数据源），`getProfile` 增返 `averageScore`。前端首页改为三卡 + 列表标题改名；profile 页消费 `averageScore` 加第 4 张卡。

**Tech Stack:** NestJS 11 + Prisma（API）、Next.js 16 + React 19 + Tailwind v4（expert-portal）、`@water-erp/ui` 的 `MetricCard`、Jest（API 单测）。

## Global Constraints

- 所有 `pnpm` 命令从 `water-erp/` 目录运行（workspace 根）。
- 卡片命名固定：首页 `待核验` / `评审中` / `已完成`；列表标题 `进行中的评审`；profile 新卡 `平均给分`。
- 卡片 tone 固定：待核验=`orange`、评审中=`purple`、已完成=`green`、平均给分=`purple`（均为 `WorkbenchTone` 已有值）。
- `averageScore` 算法口径**不得改变**：按 `supplierId` 聚合每位供应商的总评分 → 对所有供应商求平均 → `Math.round(x*10)/10`；无评分返回 `0`。
- **不改** `getStatistics` 的返回契约（仅内部抽 helper，字段不变）。
- **不改** `packages/shared/src/types.ts`（`ExpertStatistics` 已含 `pendingProjects`/`averageScore` 等）。
- 图标统一 `strokeWidth={1.5}`、`size={16}`（与现有卡片一致）。
- 提交信息以 `Co-Authored-By: Claude <noreply@anthropic.com>` 结尾。

## File Structure

| 文件 | 责任 | 本计划改动 |
|---|---|---|
| `apps/api/src/expert/expert.service.ts` | 专家业务逻辑 | 新增 `private computeAverageScore`；`getStatistics` 复用；`getProfile` 增返 `averageScore` |
| `apps/api/src/expert/expert.service.spec.ts` | ExpertService 单测 | 为 `getProfile.averageScore` 加 2 个用例 |
| `apps/expert-portal/src/app/(app)/page.tsx` | 专家首页 | 4 卡 → 3 卡；列表标题改名 |
| `apps/expert-portal/src/app/(app)/profile/page.tsx` | 个人信息页 | `ExpertProfile` 加字段；统计区 3 → 4 卡 |

---

## Task 1: 后端 — 抽 `computeAverageScore`，`getProfile` 增返 `averageScore`

**Files:**
- Modify: `apps/api/src/expert/expert.service.ts`
- Test: `apps/api/src/expert/expert.service.spec.ts`

**Interfaces:**
- Produces: `ExpertService.getProfile()` 返回值新增 `averageScore: number`（供 Task 3 前端消费）；`computeAverageScore` 为类内 `private` 方法，签名 `computeAverageScore(records: ReadonlyArray<{ scoreRecords: ReadonlyArray<{ supplierId: string; score: Prisma.Decimal | number }> }>): number`。
- Consumes: 无新增依赖。

- [ ] **Step 1: 写失败测试**

在 `expert.service.spec.ts` 的 `describe('getProfile', ...)` 块内（现有用例之后、`describe` 闭合 `})` 之前），追加两个用例：

```typescript
    it('averageScore 与 getStatistics 同口径（按 supplierId 聚合）', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'user-1', username: 'wangjg', displayName: '王建国', role: 'bid_expert', isActive: true,
      });
      prisma.bidExpert.findMany.mockResolvedValue([
        { scoreRecords: [{ score: 85, supplierId: 's1' }, { score: 90, supplierId: 's2' }, { score: 80, supplierId: 's3' }] },
        { scoreRecords: [{ score: 85, supplierId: 's4' }, { score: 80, supplierId: 's5' }] },
        { scoreRecords: [] },
      ]);

      const result = await service.getProfile('user-1');

      // (85+90+80+85+80) / 5 家供应商 = 84
      expect(result.averageScore).toBe(84);
    });

    it('无评分记录时 averageScore 为 0', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'user-1', username: 'wangjg', displayName: '王建国', role: 'bid_expert', isActive: true,
      });
      prisma.bidExpert.findMany.mockResolvedValue([]);

      const result = await service.getProfile('user-1');

      expect(result.averageScore).toBe(0);
    });
```

- [ ] **Step 2: 跑测试确认失败**

Run（从 `water-erp/`）:
```bash
pnpm --filter api test -- expert.service.spec.ts
```
Expected: FAIL — `getProfile` 返回对象上 `averageScore` 为 `undefined`（断言 `toBe(84)` 与 `toBe(0)` 不通过）。

- [ ] **Step 3: 实现 helper + 两处复用**

(a) 在 `expert.service.ts` 顶部 import 区（第 6 行 `import { PrismaService } ...` 之后）加一行：

```typescript
import { Prisma } from '@prisma/client';
```

(b) 在 `/* ── 统计概览 ── */` 区块内、`getStatistics` 方法之后新增 private helper：

```typescript
  /** 平均得分 = 该专家对每位供应商的总评分（按 supplierId 聚合）取平均；无评分返回 0 */
  private computeAverageScore(
    records: ReadonlyArray<{ scoreRecords: ReadonlyArray<{ supplierId: string; score: Prisma.Decimal | number }> }>,
  ): number {
    const supplierScoreMap = new Map<string, number>();
    for (const e of records) {
      for (const r of e.scoreRecords) {
        supplierScoreMap.set(r.supplierId, (supplierScoreMap.get(r.supplierId) ?? 0) + Number(r.score));
      }
    }
    const totals = [...supplierScoreMap.values()];
    return totals.length > 0
      ? Math.round((totals.reduce((s, v) => s + v, 0) / totals.length) * 10) / 10
      : 0;
  }
```

(c) 在 `getStatistics` 中，把现有计算 `averageScore` 的整段（两行注释 + `supplierScoreMap` 循环 + `supplierTotals` + `averageScore` 赋值，即原文 `// 平均得分 = ...` 到 `: 0;` 那段）替换为单行：

```typescript
    const averageScore = this.computeAverageScore(records);
```

（`getStatistics` 返回值 `{ totalProjects, completedProjects, signedInProjects, pendingProjects, averageScore, recentActivity }` 保持不变。）

(d) 在 `getProfile` 中，把最后的 `return { ...safeUser, assignments: expertRecords };` 改为：

```typescript
    return { ...safeUser, assignments: expertRecords, averageScore: this.computeAverageScore(expertRecords) };
```

- [ ] **Step 4: 跑测试确认通过（含 getStatistics 回归）**

Run:
```bash
pnpm --filter api test -- expert.service.spec.ts
```
Expected: PASS — 新增 2 个 `getProfile` 用例通过，且原有 `getStatistics`（`averageScore` 应仍为 84）、`getProfile`（`assignments`/无 `passwordHash`/`findMany` where）用例全部回归通过。

- [ ] **Step 5: 提交**

```bash
git add apps/api/src/expert/expert.service.ts apps/api/src/expert/expert.service.spec.ts
git commit -m "feat(expert): getProfile 增返 averageScore，抽 computeAverageScore 与 statistics 共用

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 2: 前端首页 — 4 卡 → 3 卡 + 列表标题改名

**Files:**
- Modify: `apps/expert-portal/src/app/(app)/page.tsx`

**Interfaces:**
- Consumes: `stats.pendingProjects`、`stats.completedProjects`（`ExpertStatistics` 已有），`activeProjects`（本文件第 28 行已定义 = `stage ∈ {OPENING, EVALUATING}`）。
- 删除对 `stats.signedInProjects`、`stats.averageScore` 的使用。

- [ ] **Step 1: 改 import（移除 TrendingUp，新增 ShieldCheck）**

把第 5 行：
```typescript
import { Clock, CheckCircle, TrendingUp, Clipboard, ScrollText, UserCircle } from 'lucide-react';
```
改为：
```typescript
import { Clock, CheckCircle, Clipboard, ScrollText, UserCircle, ShieldCheck } from 'lucide-react';
```
> `Clock` 仍被空状态（原第 100 行）使用，保留；`TrendingUp` 仅旧「平均得分」卡用，移除。

- [ ] **Step 2: 改统计卡片区（grid + 骨架 + 三张卡）**

把整个统计卡片 `<div className="grid gap-4 md:grid-cols-4">...</div>` 块（loading 分支与 else 分支）替换为：

```jsx
      {/* 统计卡片 */}
      <div className="grid gap-4 md:grid-cols-3">
        {loading ? (
          <>
            {[{ label: '待核验', Icon: ShieldCheck }, { label: '评审中', Icon: Clipboard }, { label: '已完成', Icon: CheckCircle }].map(card => (
              <div key={card.label} className="glass-card glass-card-blue rounded-2xl p-5 animate-pulse">
                <div className="flex items-center gap-3">
                  <card.Icon size={16} strokeWidth={1.5} className="text-[#cbd5e1]" />
                  <div className="flex-1">
                    <div className="h-3 w-16 bg-white/25 rounded mb-2" />
                    <div className="h-6 w-10 bg-white/25 rounded" />
                  </div>
                </div>
              </div>
            ))}
          </>
        ) : (
          <>
            <MetricCard label="待核验" value={stats?.pendingProjects ?? 0} tone="orange" icon={<ShieldCheck size={16} strokeWidth={1.5} />} hint="未完成身份核验" />
            <MetricCard label="评审中" value={activeProjects.length} tone="purple" icon={<Clipboard size={16} strokeWidth={1.5} />} hint="开评标进行中" />
            <MetricCard label="已完成" value={stats?.completedProjects ?? 0} tone="green" icon={<CheckCircle size={16} strokeWidth={1.5} />} />
          </>
        )}
      </div>
```

- [ ] **Step 3: 改列表标题**

把项目列表标题（原 `<h2 ...>我的评审项目</h2>`）改为：

```jsx
            <h2 className="text-lg font-bold text-[oklch(0.18_0.012_265)]">进行中的评审</h2>
```

- [ ] **Step 4: lint + typecheck**

Run:
```bash
pnpm --filter expert-portal lint
```
Expected: 无未使用 import 报错（`TrendingUp` 已移除），无类型错误。`MetricCard` 的 `hint` 为可选 prop（见 `packages/ui/src/metric-card.tsx`）。

- [ ] **Step 5: 提交**

```bash
git add apps/expert-portal/src/app/\(app\)/page.tsx
git commit -m "feat(expert-portal): 首页统计卡片精简为 待核验/评审中/已完成

修复「进行中」标签与 signedInProjects 语义错位；列表标题改为「进行中的评审」。

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 3: 前端个人信息页 — 新增「平均给分」卡

**Files:**
- Modify: `apps/expert-portal/src/app/(app)/profile/page.tsx`

**Interfaces:**
- Consumes: `profile.averageScore`（Task 1 后端 `getProfile` 已提供）。

- [ ] **Step 1: 接口加字段**

在 `ExpertProfile` interface 内（`isActive: boolean;` 之后、`assignments: {...}[];` 之前）加一行：

```typescript
  averageScore: number;
```

- [ ] **Step 2: import 加 TrendingUp**

把第 5 行：
```typescript
import { Pencil, ClipboardList, CheckCircle, FileText } from 'lucide-react';
```
改为：
```typescript
import { Pencil, ClipboardList, CheckCircle, FileText, TrendingUp } from 'lucide-react';
```

- [ ] **Step 3: 统计区 3 → 4 卡**

把统计区容器（原 `<div className="grid gap-4 md:grid-cols-3">`，含「参与项目/已完成/评分记录」三张 `MetricCard`）的容器改为 `md:grid-cols-4`，并在「评分记录」卡之后追加第 4 张卡：

```jsx
          <div className="grid gap-4 md:grid-cols-4">
            <MetricCard
              label="参与项目"
              value={totalProjects}
              tone="purple"
              icon={<ClipboardList size={16} strokeWidth={1.5} />}
            />
            <MetricCard
              label="已完成"
              value={completedProjects}
              tone="green"
              icon={<CheckCircle size={16} strokeWidth={1.5} />}
            />
            <MetricCard
              label="评分记录"
              value={totalScoreRecords}
              tone="orange"
              icon={<FileText size={16} strokeWidth={1.5} />}
            />
            <MetricCard
              label="平均给分"
              value={profile.averageScore ?? 0}
              tone="purple"
              icon={<TrendingUp size={16} strokeWidth={1.5} />}
            />
          </div>
```

- [ ] **Step 4: lint**

Run:
```bash
pnpm --filter expert-portal lint
```
Expected: 通过，无未使用变量/类型错误。

- [ ] **Step 5: 提交**

```bash
git add apps/expert-portal/src/app/\(app\)/profile/page.tsx
git commit -m "feat(expert-portal): 个人信息页新增「平均给分」卡片

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 4: 全量验证（gate，无代码改动）

- [ ] **Step 1: API 全量单测**

Run:
```bash
pnpm --filter api test
```
Expected: 全绿（含 Task 1 新增用例 + `getStatistics` 回归）。

- [ ] **Step 2: expert-portal 构建**

Run:
```bash
pnpm --filter expert-portal build
```
Expected: 构建成功（覆盖 typecheck）。

- [ ] **Step 3: 手动验证（可选但推荐）**

启动 `pnpm dev:expert`（:3006），用专家账号（如 `刘苡池` / `expert@2026`）登录：
- 首页统计区为 3 张卡（待核验 / 评审中 / 已完成），数字与下方列表一致（「评审中」= 列表项目数）。
- 列表标题为「进行中的评审」。
- 个人信息页统计区为 4 张卡，含「平均给分」。

> 本任务为验证 gate，不产生提交。若 lint/build 暴露问题，回到对应 Task 修复后在其 commit 中一并解决。

---

## Self-Review（计划完成后自查记录）

- **Spec 覆盖**：四卡→三卡（Task 2）、列表标题（Task 2）、平均得分移至 profile（Task 1 后端 + Task 3 前端）、`computeAverageScore` helper（Task 1）、测试（Task 1）、grid 调整（Task 2/3）—— spec 各点均有任务对应。
- **占位符扫描**：无 TBD/TODO；所有代码步骤含完整代码。
- **类型一致**：`computeAverageScore` 签名在 Task 1 定义与 `getStatistics`/`getProfile` 调用一致；`profile.averageScore` 在 Task 1 产出、Task 3 消费；`MetricCard` 的 `tone`/`hint` 均为组件既有 prop；`pendingProjects` 已存在于 `ExpertStatistics`。
