# :3011 领导驾驶舱创新（水叮当 Tab + 感知层 + 影响力层）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 按 spec `docs/superpowers/specs/2026-10-22-mobile-3011-leader-cockpit-innovation-design.md` 落地 P0（今日要报/环比箭头/Tab 角标）+ P1（水叮当第四 Tab，工具公司口径收口 + cockpit 工具）+ P2（转发简报/关键节点/公司龙虎榜）。

**Architecture:** 后端在 `dashboard`/`progress`/`ai`/`assistant` 四模块新增只读端点与工具；水叮当移动端完整复用 `assistant` 模块（会话属主隔离 + 工具调用链），仅补「工具执行上下文（含公司口径）」与 `cockpit` 工具。前端在 `apps/mobile-portal` 扩展三页 + 新增 `/chat`。

**Tech Stack:** NestJS 11 + Prisma（后端）；Next.js 16 App Router + React 19 + Tailwind v4（前端）；DeepSeek 经 `local-ai/LlmService` 收口。

## Global Constraints

- **只读铁律**：本计划全部为读路径；移动端水叮当不渲染 `pendingActions` 的确认/取消按钮。
- **公司隔离**：新端点一律 `resolveScope(user, companyId) → companyScope.filter(scope)` 注入（`CompanyWhere = { companyId?: string | { in: string[] } }`）；非 admin 传 companyId 一律忽略。
- **LLM 收口**：全部走 `LlmService`；推理模型 `maxTokens ≥ 1024`（96 截断事故教训）；欢迎语/要报禁词「审批」出口替换为「查阅」。
- **cgzxui**：新 UI 一律用既有类（`m-tile`/`neu-card-static`/`m-chip`/`SectionCard`/`MetricCard`/`m-input`）；禁内联 style（除 CSS 变量传递）、禁 bg-white/border-gray/扁平阴影；字号阶梯 12-21px（2026-10-22 +2 后口径）。
- **无 mock**：新区块展示真实数据或空态。
- **路由守卫**：新路由必须 `@Roles(...)`（RolesGuard 默认拒绝）。
- **提交纪律**：并行会话在制——`git add` 只加本任务列出的精确路径；提交信息 `feat(mobile):`/`feat(assistant):` 等带模块前缀。
- 验证命令：API 在 `apps/api/` 下 `npx tsc --noEmit && npx eslint <改动文件>` + `pnpm --filter api test -- <spec>`；前端在 `apps/mobile-portal/` 下 `npx tsc --noEmit && pnpm lint`。dev 全链已在跑（:4001/:3011 热更）。

---

### Task 1: `GET /dashboard/badges` — Tab 角标聚合端点

**Files:**
- Modify: `apps/api/src/dashboard/dashboard.service.ts`（末尾追加方法）
- Modify: `apps/api/src/dashboard/dashboard.controller.ts`
- Test: `apps/api/src/dashboard/dashboard-badges.spec.ts`（新建）

**Interfaces:**
- Produces: `DashboardService.getBadges(companyFilter?: CompanyWhere): Promise<{ abnormalCount: number; pendingCount: number; stalledCount: number }>`；`GET /api/dashboard/badges` 返回同形 JSON（Task 8 前端消费）。

- [ ] **Step 1: 写失败测试**（mock prisma 三连 count）

```ts
// apps/api/src/dashboard/dashboard-badges.spec.ts
import { DashboardService } from './dashboard.service';

describe('DashboardService.getBadges', () => {
  const makePrisma = (stalledWhere: unknown) => ({
    procurementRound: { count: jest.fn().mockResolvedValueOnce(3).mockResolvedValueOnce(7) },
    projectManagementStage: { count: jest.fn().mockImplementation(({ where }) => {
      (makePrisma as any).lastStageWhere = where;
      expect((where as any).projectManagementItem).toEqual({ companyId: 'co-1' });
      return Promise.resolve(stalledWhere === null ? 2 : stalledWhere);
    }) },
  });
  it('三计数口径正确且公司过滤注入', async () => {
    const prisma: any = makePrisma(2);
    const svc = new (DashboardService as any)(prisma);
    const r = await svc.getBadges({ companyId: 'co-1' });
    expect(r).toEqual({ abnormalCount: 3, pendingCount: 7, stalledCount: 2 });
    expect(prisma.procurementRound.count).toHaveBeenNthCalledWith(1, {
      where: { companyId: 'co-1', resultStatus: { notIn: ['AWARDED', 'PENDING'] } },
    });
  });
  it('无过滤（admin 全部）同样工作', async () => {
    const prisma: any = makePrisma(0);
    const svc = new (DashboardService as any)(prisma);
    await svc.getBadges(undefined);
    expect(prisma.procurementRound.count).toHaveBeenCalledWith({
      where: { resultStatus: { notIn: ['AWARDED', 'PENDING'] } },
    });
  });
});
```

- [ ] **Step 2: 跑测确认失败**

Run: `cd apps/api && npx jest src/dashboard/dashboard-badges.spec.ts`
Expected: FAIL `svc.getBadges is not a function`

- [ ] **Step 3: 实现**（dashboard.service.ts 末尾追加；文件顶部如无 `ResultStatus` import 则补——getDashboard 内已用到，通常已在）

```ts
  /** :3011 Tab 角标——异常/待处理/停滞三计数（与 getDashboard abnormalCount 同口径：
   *  异常=非 AWARDED 且非 PENDING；停滞=active PMI 当前阶段停留>30 天） */
  async getBadges(companyFilter?: CompanyWhere) {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 3600 * 1000);
    const [abnormalCount, pendingCount, stalledCount] = await Promise.all([
      this.prisma.procurementRound.count({
        where: { ...companyFilter, resultStatus: { notIn: ['AWARDED', 'PENDING'] } },
      }),
      this.prisma.procurementRound.count({
        where: { ...companyFilter, resultStatus: 'PENDING' },
      }),
      this.prisma.projectManagementStage.count({
        where: {
          status: { not: 'COMPLETED' },
          updatedAt: { lt: thirtyDaysAgo },
          ...(companyFilter ? { projectManagementItem: companyFilter } : {}),
        },
      }),
    ]);
    return { abnormalCount, pendingCount, stalledCount };
  }
```

- [ ] **Step 4: 跑测通过**（同 Step 2 命令，Expected: PASS）

- [ ] **Step 5: 挂控制器**（dashboard.controller.ts，仿既有 `@Get()` 的守卫三件套）

```ts
  @Get('badges')
  @ApiOperation({ summary: ':3011 Tab 角标（异常/待处理/停滞）' })
  async getBadges(
    @CurrentUser() user: AuthenticatedUser,
    @Query('companyId') companyId?: string,
  ) {
    if (!canViewGlobalBusinessData(user.role)) {
      throw new ForbiddenException('普通账号无法查看数据库页面。');
    }
    const scope = await this.companyScope.resolveScope(user, companyId);
    return this.dashboardService.getBadges(this.companyScope.filter(scope));
  }
```

（`ApiOperation` 需在文件顶部 Swagger import 中补入，若未引入。）

- [ ] **Step 6: 验证 + 提交**

Run: `cd apps/api && npx tsc --noEmit && npx eslint src/dashboard/dashboard.service.ts src/dashboard/dashboard.controller.ts && npx jest src/dashboard/dashboard-badges.spec.ts`
Expected: 全绿。curl 冒烟：`TOKEN=$(curl -s -X POST localhost:4001/api/auth/login -H 'Content-Type: application/json' -H 'X-Portal: web' -d '{"username":"Swhi-CGZX-01","password":"Swhi-CGZX-01@2026"}' | python3 -c 'import sys,json;print(json.load(sys.stdin)["access_token"])') && curl -s -H 'X-Portal: web' -H "X-Web-Token: $TOKEN" localhost:4001/api/dashboard/badges`（注意：此登录会顶掉该账号既有 web 会话，仅允许在无人占用时执行）

```bash
git add apps/api/src/dashboard/dashboard.service.ts apps/api/src/dashboard/dashboard.controller.ts apps/api/src/dashboard/dashboard-badges.spec.ts
git commit -m "feat(dashboard): :3011 Tab 角标端点 GET /dashboard/badges——异常/待处理/停滞三计数（CompanyScope 同口径）"
```

---

### Task 2: 环比——`getDashboard` 增 `compare` 块

**Files:**
- Modify: `apps/api/src/dashboard/dashboard.service.ts`
- Modify: `apps/api/src/dashboard/dashboard.controller.ts`
- Test: `apps/api/src/dashboard/dashboard-compare.spec.ts`（新建）

**Interfaces:**
- Produces: `priorWindow(startDate?: string, endDate?: string): { startDate: string; endDate: string } | null`（导出纯函数，Task 3 复用）；`getDashboard` 第 4 参 `compare = false`，响应新增 `compare?: { prevRange: { startDate: string; endDate: string } | null; summary: Record<string, number> | null }`；`GET /api/dashboard?compare=true`（Task 4 前端消费）。
- Consumes: `CompanyWhere`（既有）。

- [ ] **Step 1: 写失败测试**（纯函数口径）

```ts
// apps/api/src/dashboard/dashboard-compare.spec.ts
import { priorWindow } from './dashboard.service';

describe('priorWindow（等长前移）', () => {
  it('双边界区间前移一等长区间', () => {
    expect(priorWindow('2026-09-15', '2026-10-14')).toEqual({
      startDate: '2026-08-16', endDate: '2026-09-14',
    });
  });
  it('只有起始日（本月口径）→ 上月同日到起始前一日', () => {
    expect(priorWindow('2026-10-01', undefined)).toEqual({
      startDate: '2026-09-01', endDate: '2026-09-30',
    });
  });
  it('无起始日返回 null（"全部"区间无上期）', () => {
    expect(priorWindow(undefined, '2026-10-01')).toBeNull();
  });
});
```

- [ ] **Step 2: 跑测确认失败**

Run: `cd apps/api && npx jest src/dashboard/dashboard-compare.spec.ts`
Expected: FAIL（`priorWindow` 未导出）

- [ ] **Step 3: 实现**

3a. dashboard.service.ts 顶部（class 外）导出纯函数：

```ts
/** 环比上期窗口：等长前移；仅起始日时按"上月起同日 → 起始前一日"；无起始日（全部）无上期 */
export function priorWindow(
  startDate?: string,
  endDate?: string,
): { startDate: string; endDate: string } | null {
  if (!startDate) return null;
  const start = new Date(`${startDate}T00:00:00`);
  const end = endDate ? new Date(`${endDate}T00:00:00`) : new Date(start); end.setDate(end.getDate() + 1); end.setDate(end.getDate() - 1); // 单边=当日
  const spanMs = end.getTime() - start.getTime() + 24 * 3600 * 1000;
  const prevEnd = new Date(start.getTime() - 1); // 起始前一日末
  const prevStart = new Date(prevEnd.getTime() + 1 - spanMs);
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  return { startDate: iso(prevStart), endDate: iso(prevEnd) };
}
```

3b. `getDashboard` 签名加第 4 参 `compare = false`；方法末 return 前插入：

```ts
    let compareBlock: undefined | { prevRange: { startDate: string; endDate: string } | null; summary: Record<string, number> | null } = undefined;
    if (compare) {
      const prev = priorWindow(startDate, endDate);
      if (prev) {
        const prevRounds = await this.prisma.procurementRound.findMany({
          where: {
            ...companyFilter,
            procurementDate: { gte: startOfDay(prev.startDate), lte: endOfDay(prev.endDate) },
          },
          select: { resultStatus: true, budgetAmount: true, awardAmount: true },
        });
        const n = (x: unknown) => (x == null ? 0 : Number(x));
        compareBlock = {
          prevRange: prev,
          summary: {
            totalCount: prevRounds.length,
            completedCount: prevRounds.filter((r) => r.resultStatus === ResultStatus.AWARDED).length,
            abnormalCount: prevRounds.filter((r) => r.resultStatus !== ResultStatus.AWARDED && r.resultStatus !== ResultStatus.PENDING).length,
            awardedBudget: prevRounds.filter((r) => r.resultStatus === ResultStatus.AWARDED).reduce((s, r) => s + n(r.budgetAmount), 0),
            totalAward: prevRounds.reduce((s, r) => s + n(r.awardAmount), 0),
            totalSavings: prevRounds.reduce((s, r) => s + Math.max(n(r.budgetAmount) - n(r.awardAmount), 0), 0),
          },
        };
      } else {
        compareBlock = { prevRange: null, summary: null };
      }
    }
```

返回对象展开 `...(compare ? { compare: compareBlock } : {})`（返回字面量处合并；`startOfDay/endOfDay` 为本文件既有 util，Task 内确认已在顶部 import）。注意 totalSavings 口径须与主 summary 的 totalSavings 计算式一致——实现时对照主口径源码行，若主口径为 `budget - award`（仅 AWARDED 参与）则同步限定。

3c. 控制器 `@Query('compare') compare?: string` 透传 `compare === 'true'`。

- [ ] **Step 4: 跑测通过**（`npx jest src/dashboard/dashboard-compare.spec.ts` + `npx tsc --noEmit`）

- [ ] **Step 5: 提交**

```bash
git add apps/api/src/dashboard/dashboard.service.ts apps/api/src/dashboard/dashboard.controller.ts apps/api/src/dashboard/dashboard-compare.spec.ts
git commit -m "feat(dashboard): getDashboard 增 compare=true 环比块——等长前移上期六指标（:3011 指标箭头数据源）"
```

---

### Task 3: `GET /ai/mobile-brief` — 今日要报

**Files:**
- Create: `apps/api/src/ai/mobile-brief.service.ts`
- Modify: `apps/api/src/ai/ai.controller.ts`、`apps/api/src/ai/ai.module.ts`
- Test: `apps/api/src/ai/mobile-brief.service.spec.ts`（新建）

**Interfaces:**
- Consumes: `LlmService.chatJson<T>(system, user, temperature, signal, seed, options)`（既有）；`DashboardService.getDashboard(start?, end?, filter?)`（既有）；`CompanyScopeService.resolveScope/filter`（既有）；`priorWindow`（Task 2）。
- Produces: `MobileBriefService.getBrief(user: AuthenticatedUser, companyId?: string): Promise<MobileBriefResult>`；`MobileBriefResult = { available: true; focus: BriefItem; metric: BriefItem; reminder: BriefItem; shareText: string } | { available: false }`，`BriefItem = { text: string; jump: '/dashboard' | '/ledger' | '/progress' }`（Task 4 前端消费）。

- [ ] **Step 1: 写失败测试**

```ts
// apps/api/src/ai/mobile-brief.service.spec.ts
import { MobileBriefService, sanitizeBriefText } from './mobile-brief.service';

describe('sanitizeBriefText', () => {
  it('禁词「审批」→「查阅」、剥引号、截断 40 字', () => {
    expect(sanitizeBriefText('「静待您审批」')).toBe('静待您查阅');
    expect(sanitizeBriefText(`${'长'.repeat(50)}`)).toHaveLength(40);
  });
});
describe('MobileBriefService.getBrief', () => {
  const scope: any = { resolveScope: jest.fn().mockResolvedValue({ kind: 'ALL' }), filter: jest.fn().mockReturnValue(undefined) };
  const dashboard: any = { getDashboard: jest.fn().mockResolvedValue({
    summary: { totalCount: 20, completedCount: 12, abnormalCount: 2, totalAwardLabel: '1,200万', totalSavingsLabel: '80万' },
    riskProjects: [{ project: 'X项目', pendingDays: 15, reason: '评标滞留' }],
    savingsRanking: [{ project: 'Y项目', savingsRate: 18 }],
    stageDistribution: [{ stage: 'CONTRACT', count: 3 }],
  }) };
  const llmOk: any = { chatJson: jest.fn().mockResolvedValue({
    focus: { text: 'X项目评标滞留15天，需关注' },
    metric: { text: '本月成交1,200万，节资80万' },
    reminder: { text: '合同阶段3项待推进' },
    shareText: '【蜀水云采】今日要报：成交1,200万，节资80万；X项目滞留15天请关注。',
  }) };
  it('正常生成三句+shareText，jump 映射', async () => {
    const svc = new MobileBriefService(llmOk, dashboard, scope as any);
    const r = await svc.getBrief({ sub: 'u1', role: 'admin' } as any);
    expect(r.available).toBe(true);
    if (r.available) {
      expect(r.focus.jump).toBe('/dashboard');
      expect(r.shareText).toContain('1,200万');
    }
  });
  it('LLM 失败 → available:false（不抛错）', async () => {
    const llmBad: any = { chatJson: jest.fn().mockRejectedValue(new Error('down')) };
    const svc = new MobileBriefService(llmBad, dashboard, scope as any);
    await expect(svc.getBrief({ sub: 'u1', role: 'admin' } as any)).resolves.toEqual({ available: false });
  });
});
```

- [ ] **Step 2: 跑测确认失败**

Run: `cd apps/api && npx jest src/ai/mobile-brief.service.spec.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现服务**

```ts
// apps/api/src/ai/mobile-brief.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { LlmService } from '../local-ai/llm.service';
import { DashboardService } from '../dashboard/dashboard.service';
import { CompanyScopeService } from '../company/company-scope';
import type { AuthenticatedUser } from '../auth/auth.types';

export type BriefItem = { text: string; jump: '/dashboard' | '/ledger' | '/progress' };
export type MobileBriefResult =
  | { available: true; focus: BriefItem; metric: BriefItem; reminder: BriefItem; shareText: string }
  | { available: false };

/** 出口净化：禁词替换/剥引号/截断（与 mobile-greeting.sanitize 同规则） */
export function sanitizeBriefText(raw: string): string {
  const t = raw
    .replace(/^[\s"'「」『』“”‘’]+|[\s"'「」『』“”‘’]+$/g, '')
    .replace(/\s+/g, ' ')
    .replace(/审批/g, '查阅')
    .trim();
  return t.length > 40 ? t.slice(0, 40) : t;
}

@Injectable()
export class MobileBriefService {
  private readonly logger = new Logger(MobileBriefService.name);

  constructor(
    private readonly llm: LlmService,
    private readonly dashboard: DashboardService,
    private readonly companyScope: CompanyScopeService,
  ) {}

  async getBrief(user: AuthenticatedUser, companyId?: string): Promise<MobileBriefResult> {
    const scope = await this.companyScope.resolveScope(user, companyId);
    const filter = this.companyScope.filter(scope);
    const now = new Date();
    const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
    const data = await this.dashboard.getDashboard(monthStart, undefined, filter);

    const riskTop = (data.riskProjects ?? []).slice(0, 3)
      .map((r) => `${r.project}（滞留${r.pendingDays}天，${r.reason}）`).join('；') || '无';
    const savingsTop = (data.savingsRanking ?? []).slice(0, 3)
      .map((s) => `${s.project}（节资率${s.savingsRate}%）`).join('；') || '无';
    const stageMax = (data.stageDistribution ?? []).slice().sort((a, b) => b.count - a.count)[0];

    try {
      const r = await this.llm.chatJson(
        [
          '你是「蜀水云采」采购平台给领导写「今日要报」的助手。输出 JSON：',
          '{"focus":{"text":...},"metric":{"text":...},"reminder":{"text":...},"shareText":...}',
          '规则：focus=今天最该关注的一件事（优先风险/停滞，含项目名与天数）；metric=一个关键数字（本月成交额或节资，只用给定数据）；',
          'reminder=一个提醒（阶段拥堵/异常信号）；每句 ≤30 字、只讲需要领导知道的事、禁止 emoji、禁止出现「审批」一词、禁止编造未提供的数据。',
          'shareText=80~120 字一段话，适合发到管理群，含上述三要点，口语但专业。',
        ].join(''),
        `本月数据：总轮次${data.summary.totalCount}，已成交${data.summary.completedCount}，异常${data.summary.abnormalCount}，成交额${data.summary.totalAwardLabel}，累计节资${data.summary.totalSavingsLabel}。风险项目：${riskTop}。节资前三：${savingsTop}。当前最堵阶段：${stageMax ? `${stageMax.stageName ?? stageMax.stage}（${stageMax.count}项）` : '无'}。`,
        0.4,
        undefined,
        Math.floor(Math.random() * 1_000_000),
        { maxTokens: 2048, timeoutMs: 20_000, retries: 1 },
      );
      const pick = (v: unknown): string => sanitizeBriefText(String(v ?? ''));
      const focusText = pick((r as Record<string, unknown>).focus && ((r as any).focus.text));
      const metricText = pick((r as any).metric?.text);
      const reminderText = pick((r as any).reminder?.text);
      const shareText = pick((r as any).shareText).slice(0, 160);
      if (!focusText || !metricText || !reminderText) return { available: false };
      return {
        available: true,
        focus: { text: focusText, jump: '/dashboard' },
        metric: { text: metricText, jump: '/ledger' },
        reminder: { text: reminderText, jump: '/progress' },
        shareText: shareText || `${metricText}；${focusText}`,
      };
    } catch (err) {
      this.logger.warn(`今日要报生成失败：${err instanceof Error ? err.message : err}`);
      return { available: false };
    }
  }
}
```

（若 DashboardData 类型未导出 riskProjects 等字段类型，用结构化取值即可——data 为 any 兼容形状。）

- [ ] **Step 4: 挂控制器与模块**

ai.controller.ts 构造器注入 `MobileBriefService`，端点（放 mobile-greeting 旁）：

```ts
  @Get('mobile-brief')
  @ApiOperation({ summary: '移动驾驶舱（:3011）今日要报——LLM 现场生成（不缓存）' })
  @Roles('admin', 'leader', 'staff')
  getMobileBrief(@CurrentUser() user: AuthenticatedUser, @Query('companyId') companyId?: string) {
    return this.mobileBrief.getBrief(user, companyId);
  }
```

ai.module.ts：import + providers 加 `MobileBriefService`；imports 数组补 `DashboardModule`、`CompanyModule`（CompanyScopeService 所在模块，按既有 import 名对齐——dashboard.controller 同款来源）。

- [ ] **Step 5: 跑测+类型+冒烟**（jest spec PASS；`npx tsc --noEmit`；curl 同 Task 1 Step 6 模式打 `/api/ai/mobile-brief`，应返回三句或 available:false）

- [ ] **Step 6: 提交**

```bash
git add apps/api/src/ai/mobile-brief.service.ts apps/api/src/ai/mobile-brief.service.spec.ts apps/api/src/ai/ai.controller.ts apps/api/src/ai/ai.module.ts
git commit -m "feat(mobile): :3011 今日要报端点 GET /ai/mobile-brief——LLM 三句结构+shareText，本月口径 CompanyScope 同源"
```

---

### Task 4: 前端 P0 接线（角标/箭头/要报卡）

**Files:**
- Modify: `apps/mobile-portal/src/lib/api/dashboard.ts`、`apps/mobile-portal/src/lib/api/ai.ts`
- Modify: `apps/mobile-portal/src/components/m/metric-card.tsx`、`apps/mobile-portal/src/app/(main)/layout.tsx`
- Modify: `apps/mobile-portal/src/app/(main)/dashboard/page.tsx`、`apps/mobile-portal/src/app/(main)/progress/page.tsx`

**Interfaces:**
- Consumes: Task 1 badges JSON、Task 2 `compare` 块、Task 3 brief JSON。
- Produces: `MetricCard` 新 prop `delta?: { pct: number; tone: 'good' | 'bad' | 'neutral' }`；`fetchBadges()`、`fetchMobileBrief()`。

- [ ] **Step 1: API 封装**

`lib/api/dashboard.ts` 追加：

```ts
export type DashboardBadges = { abnormalCount: number; pendingCount: number; stalledCount: number };
export type DashboardCompareSummary = {
  totalCount: number; completedCount: number; abnormalCount: number;
  awardedBudget: number; totalAward: number; totalSavings: number;
};
export type DashboardCompare = { prevRange: { startDate: string; endDate: string } | null; summary: DashboardCompareSummary | null };

export async function fetchDashboardBadges(companyId?: string): Promise<DashboardBadges> {
  const q = companyId && companyId !== 'all' ? `?companyId=${encodeURIComponent(companyId)}` : '';
  return api.get<DashboardBadges>(`/dashboard/badges${q}`);
}
```

（fetchDashboardData 增第 4 参 `compare?: boolean` → `params.set('compare','true')`；`DashboardData` 类型加 `compare?: DashboardCompare`。）

`lib/api/ai.ts` 追加：

```ts
export type MobileBrief = {
  available: true;
  focus: { text: string; jump: string };
  metric: { text: string; jump: string };
  reminder: { text: string; jump: string };
  shareText: string;
} | { available: false };

export async function fetchMobileBrief(companyId?: string): Promise<MobileBrief> {
  const q = companyId && companyId !== 'all' ? `?companyId=${encodeURIComponent(companyId)}` : '';
  return api.get<MobileBrief>(`/ai/mobile-brief${q}`);
}
```

- [ ] **Step 2: MetricCard delta**

`components/m/metric-card.tsx`：props 加 `delta?: { pct: number; tone: "good" | "bad" | "neutral" }`，值行右侧渲染小徽标：

```tsx
      <div className="mt-1 flex items-baseline justify-between gap-1.5">
        <div className="text-[21px] font-black leading-none tabular-nums tracking-[-0.02em]" style={{ color: TONE_COLOR[tone] }}>
          {value}
        </div>
        {delta ? (
          <span
            className={`shrink-0 text-[12px] font-bold tabular-nums ${
              delta.tone === "good" ? "text-[var(--success)]" : delta.tone === "bad" ? "text-[var(--danger)]" : "text-[var(--muted-foreground)]"
            }`}
          >
            {delta.pct > 0 ? "↑" : delta.pct < 0 ? "↓" : "—"}
            {Math.abs(delta.pct)}%
          </span>
        ) : null}
      </div>
```

（原值 div 结构调整为以上两栏；`sub` 行不动。）

- [ ] **Step 3: 数据库页——要报卡 + 环比**

3a. 顶部（PullIndicator 之后、控制行之前）加要报卡：

```tsx
const [brief, setBrief] = useState<MobileBrief | null>(null);
useEffect(() => {
  let active = true;
  fetchMobileBrief(companyIds.length ? companyIds.join(",") : undefined)
    .then((b) => { if (active) setBrief(b); })
    .catch(() => { if (active) setBrief({ available: false }); });
  return () => { active = false; };
}, [companyIds, retryTick]);
```

```tsx
      {/* ── 今日要报（AI 三句）── */}
      <div className="neu-card-static mb-3 rounded-[18px] p-3.5">
        <div className="mb-2 flex items-center gap-2 text-[12px] font-bold uppercase tracking-[0.1em] text-[var(--accent)]">
          <Sparkles size={13} /> 今日要报
        </div>
        {brief === null ? (
          <Skeleton lines={3} height={18} />
        ) : brief.available ? (
          <div className="space-y-1.5">
            {([brief.focus, brief.metric, brief.reminder] as const).map((it, i) => (
              <button key={i} type="button" onClick={() => router.push(it.jump)}
                className="flex w-full items-center gap-2 rounded-[10px] px-1 py-1 text-left active:scale-[0.99]">
                <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--accent)]" />
                <span className="min-w-0 flex-1 truncate text-[14px] font-medium text-[var(--foreground)]">{it.text}</span>
                <ChevronRight size={13} className="shrink-0 text-[var(--muted-foreground)]" />
              </button>
            ))}
          </div>
        ) : (
          <button type="button" onClick={() => setRetryTick((t) => t + 1)}
            className="w-full py-1 text-left text-[13px] text-[var(--muted-foreground)] active:scale-[0.99]">
            今日要报生成中，点击重试
          </button>
        )}
      </div>
```

（`router` 来自 `useRouter`；import 补 `Sparkles`、`ChevronRight`、`MobileBrief`、`fetchMobileBrief`、`Skeleton` 已在。）

3b. 环比：`fetchDashboardData(..., true)` 后，六张汇总 MetricCard 传 delta。帮助函数（组件外）：

```ts
/** 环比箭头语义配色：成交/完成/节资↑=good，异常↑=bad，预算=neutral */
function deltaOf(cur: number, prev: number | undefined, goodWhenUp: boolean | null): { pct: number; tone: "good" | "bad" | "neutral" } | undefined {
  if (prev == null || prev === 0) return undefined;
  const pct = Math.round(((cur - prev) / prev) * 100);
  if (pct === 0) return { pct: 0, tone: "neutral" };
  const up = pct > 0;
  const tone = goodWhenUp == null ? "neutral" : (up === goodWhenUp ? "good" : "bad");
  return { pct: Math.max(Math.min(pct, 999), -99), tone };
}
```

映射（`c = data.compare?.summary`）：
- 项目总数 `deltaOf(summary.totalCount, c?.totalCount, null)`
- 异常项目 `deltaOf(summary.abnormalCount, c?.abnormalCount, false)`
- 总预算 `deltaOf(数值化(summary.totalBudgetLabel), c?.awardedBudget === undefined ? undefined : 0+0, null)` —— 预算无对比基线字段时**不传 delta**（compare.summary 未含 totalBudget，直接省略）
- 已成交预算 `deltaOf(数值化(summary.awardedBudgetLabel), c?.awardedBudget, true)`
- 成交总额 `deltaOf(数值化(summary.totalAwardLabel), c?.totalAward, true)`
- 累计节资 `deltaOf(数值化(summary.totalSavingsLabel), c?.totalSavings, true)`

`数值化` 复用页内已有 `parseBudgetLabel`（"1,234万"→元数值）。

- [ ] **Step 4: 进展页箭头**（纯前端，后端零改动）

四指标中「本月新增」「本月完成」已有 `stats.lastMonthAdded/lastMonthCompleted`：

```tsx
<MetricCard label="本月新增" value={String(stats.monthlyAdded)} delta={deltaOf(stats.monthlyAdded, stats.lastMonthAdded, true)} />
<MetricCard label="本月完成" value={String(stats.monthlyCompleted)} tone="success" sub={`上月 ${stats.lastMonthCompleted}`} delta={deltaOf(stats.monthlyCompleted, stats.lastMonthCompleted, true)} />
```

（`deltaOf` 复制到 progress 页组件外——两页各自本地一份，遵循门户自包含约定。）

- [ ] **Step 5: layout 角标**

`app/(main)/layout.tsx`：

```tsx
import { fetchDashboardBadges, type DashboardBadges } from "@/lib/api/dashboard";
// ...
const [badges, setBadges] = useState<DashboardBadges | null>(null);
useEffect(() => {
  if (!checked) return;
  let active = true;
  const load = () => fetchDashboardBadges().then((b) => { if (active) setBadges(b); }).catch(() => undefined);
  load();
  const onVisible = () => { if (document.visibilityState === "visible") load(); };
  document.addEventListener("visibilitychange", onVisible);
  return () => { active = false; document.removeEventListener("visibilitychange", onVisible); };
}, [checked]);
```

Tab 渲染加角标（TABS 项加 `badge?: number` 映射：数据库→badges.abnormalCount、台账→badges.pendingCount、进展→badges.stalledCount、水叮当→undefined）：

```tsx
<nav className="m-tabbar" aria-label="主导航">
  {TABS.map(({ href, label, icon: Icon }) => {
    const badge = href === "/dashboard" ? badges?.abnormalCount : href === "/ledger" ? badges?.pendingCount : href === "/progress" ? badges?.stalledCount : undefined;
    return (
      <Link key={href} href={href} data-active={pathname.startsWith(href)} className="m-tab-item relative">
        <span className="relative">
          <Icon size={20} strokeWidth={1.5} />
          {badge ? <span className="absolute -right-2.5 -top-1.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-[var(--danger)] px-1 text-[11px] font-bold leading-none text-white">{badge > 99 ? "99+" : badge}</span> : null}
        </span>
        <span>{label}</span>
      </Link>
    );
  })}
</nav>
```

- [ ] **Step 6: 验证 + 提交**

Run: `cd apps/mobile-portal && npx tsc --noEmit && pnpm lint`
浏览器冒烟：:3011/dashboard 见要报卡（LLM 2-8s 后三句出现）+ 六指标箭头；切 Tab 见角标；/progress 见新增/完成箭头。

```bash
git add apps/mobile-portal/src/lib/api/dashboard.ts apps/mobile-portal/src/lib/api/ai.ts apps/mobile-portal/src/components/m/metric-card.tsx "apps/mobile-portal/src/app/(main)/layout.tsx" "apps/mobile-portal/src/app/(main)/dashboard/page.tsx" "apps/mobile-portal/src/app/(main)/progress/page.tsx"
git commit -m "feat(mobile): :3011 P0 感知层——今日要报卡 + 指标环比箭头（语义配色） + Tab 角标（异常/待处理/停滞）"
```

---

### Task 5: 水叮当工具执行上下文（AssistantToolCtx）基建

**Files:**
- Modify: `apps/api/src/assistant/tools/assistant-tool.ts`（接口）
- Modify: `apps/api/src/assistant/assistant.service.ts`（chat 解析 ctx + 穿参 + roleContext 文案修正）
- Modify: `apps/api/src/assistant/tools/*.tool.ts`（8 个工具 execute 签名加可选第二参）
- Test: `apps/api/src/assistant/assistant-context.spec.ts`（新建）

**Interfaces:**
- Produces: `export type AssistantToolCtx = { user?: { sub: string; role: string; companyId: string | null }; companyIds?: string[] }`（assistant-tool.ts 内导出；Task 6/7 消费）；所有 `AssistantTool.execute(args: Record<string, unknown>, ctx?: AssistantToolCtx)`。
- Consumes: `AssistantOwner = { userId: string; role: string } | { guestKey: string }`（既有）。

- [ ] **Step 1: 写失败测试**

```ts
// apps/api/src/assistant/assistant-context.spec.ts
import { resolveToolCtx, pickAdminCompanyIds } from './assistant.service';

describe('工具上下文解析', () => {
  it('认证用户解析出 companyId（prisma 单查）', async () => {
    const prisma: any = { user: { findUnique: jest.fn().mockResolvedValue({ companyId: 'co-1' }) } };
    const ctx = await resolveToolCtx(prisma, { userId: 'u1', role: 'leader' }, undefined);
    expect(ctx.user).toEqual({ sub: 'u1', role: 'leader', companyId: 'co-1' });
  });
  it('匿名访客 ctx 为空对象', async () => {
    const prisma: any = { user: { findUnique: jest.fn() } };
    const ctx = await resolveToolCtx(prisma, { guestKey: 'g' }, undefined);
    expect(ctx).toEqual({});
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });
  it('context.companyIds 仅 admin 采纳，非 admin 忽略', () => {
    expect(pickAdminCompanyIds(['a', 'b', 3], 'admin')).toEqual(['a', 'b']);
    expect(pickAdminCompanyIds(['a'], 'leader')).toBeUndefined();
  });
});
```

- [ ] **Step 2: 跑测确认失败**

Run: `cd apps/api && npx jest src/assistant/assistant-context.spec.ts`
Expected: FAIL（两个函数未导出）

- [ ] **Step 3: 实现**

3a. `assistant-tool.ts` 追加：

```ts
/** 工具执行上下文（2026-10-22 :3011 P1）：认证用户带公司归属；companyIds 仅 admin 经
 *  ChatDto.context 采纳（非 admin 由服务端忽略，防伪造）。匿名访客 ctx = {} */
export interface AssistantToolCtx {
  user?: { sub: string; role: string; companyId: string | null };
  companyIds?: string[];
}
```

`AssistantTool.execute` 签名改为 `execute(args: Record<string, unknown>, ctx?: AssistantToolCtx): Promise<ToolResult>;`

3b. `assistant.service.ts` class 外导出两个纯函数（供测试）：

```ts
export function pickAdminCompanyIds(raw: unknown, role: string): string[] | undefined {
  if (role !== 'admin' || !Array.isArray(raw)) return undefined;
  const ids = raw.filter((v): v is string => typeof v === 'string' && v.length > 0).slice(0, 50);
  return ids.length ? ids : undefined;
}

export async function resolveToolCtx(
  prisma: { user: { findUnique(args: { where: { id: string }; select: { companyId: boolean } }): Promise<{ companyId: string | null } | null> } },
  owner: { userId?: string; role?: string } | null,
  contextCompanyIdList: unknown,
): Promise<import('./tools/assistant-tool').AssistantToolCtx> {
  if (!owner?.userId) return {};
  const u = await prisma.user.findUnique({ where: { id: owner.userId }, select: { companyId: true } });
  const role = owner.role ?? '';
  const ctx: import('./tools/assistant-tool').AssistantToolCtx = {
    user: { sub: owner.userId, role, companyId: u?.companyId ?? null },
  };
  const ids = pickAdminCompanyIds(contextCompanyIdList, role);
  if (ids) ctx.companyIds = ids;
  return ctx;
}
```

3c. `chat()`：在 `allowedTools` 计算之前插入：

```ts
    const toolCtx = await resolveToolCtx(this.prisma, owner, (dto.context as Record<string, unknown> | undefined)?.companyIds);
```

`handleDirectToolCall` 与 `handleNormalChat` 签名各加末参 `ctx: AssistantToolCtx`，其内部两处 `tool.execute(tc.args || {})` / `tool.execute(toolArgs)` 改为 `tool.execute(args, ctx)`；调用点传入 `toolCtx`。

3d. roleContext 文案修正（admin/bid_host 与 leader/staff 分层）：

```ts
      ? ['admin', 'bid_host'].includes(userRole)
        ? '该用户属于管理层，拥有全系统数据访问权限。你可以综合分析所有模块的数据，给出全局视角的建议。'
        : '该用户属于公司管理层（leader/staff），数据权限限于其所属公司；工具会自动按公司过滤，回答时不要跨公司汇总，除非用户明确是管理员。'
```

3e. 8 个 `*.tool.ts`：`async execute(args: Record<string, unknown> = {}, _ctx?: AssistantToolCtx)`（本任务仅签名兼容，不消费；import 类型）。未用参数命名 `_ctx` 防 lint unused。

- [ ] **Step 4: 跑测通过 + 全量 assistant 既有测试回归**

Run: `cd apps/api && npx jest src/assistant/ && npx tsc --noEmit`
Expected: 新 spec PASS、既有 spec 不红。

- [ ] **Step 5: 提交**

```bash
git add apps/api/src/assistant/tools/assistant-tool.ts apps/api/src/assistant/assistant.service.ts apps/api/src/assistant/assistant-context.spec.ts apps/api/src/assistant/tools/announcement.tool.ts apps/api/src/assistant/tools/bid.tool.ts apps/api/src/assistant/tools/expert.tool.ts apps/api/src/assistant/tools/global-overview.tool.ts apps/api/src/assistant/tools/mall.tool.ts apps/api/src/assistant/tools/notification.tool.ts apps/api/src/assistant/tools/procurement.tool.ts apps/api/src/assistant/tools/supplier.tool.ts
git commit -m "feat(assistant): 工具执行上下文 AssistantToolCtx——chat 解析用户公司归属穿参全工具，roleContext 按角色分层（:3011 P1 基建）"
```

---

### Task 6: 数据工具公司口径注入（leader 不越本公司）

**Files:**
- Create: `apps/api/src/assistant/tools/company-filter.ts`
- Modify: `apps/api/src/assistant/tools/procurement.tool.ts`、`bid.tool.ts`、`supplier.tool.ts`、`expert.tool.ts`、`global-overview.tool.ts`
- Test: `apps/api/src/assistant/tools/company-filter.spec.ts`（新建）

**Interfaces:**
- Consumes: `AssistantToolCtx`（Task 5）。
- Produces: `toolCompanyWhere(ctx?: AssistantToolCtx): { companyId?: string | { in: string[] } }`——admin 无 companyIds → `{}`（全部）；admin + companyIds → `{ in }`；leader/staff → 本公司或 `{ in: [] }`（无归属永假）；其余角色/匿名 → `{}`（保持既有公开域行为，allowedTools 门禁已在外层管住）。

- [ ] **Step 1: 写失败测试**

```ts
// apps/api/src/assistant/tools/company-filter.spec.ts
import { toolCompanyWhere } from './company-filter';
import type { AssistantToolCtx } from './assistant-tool';

const ctx = (user?: AssistantToolCtx['user'], companyIds?: string[]): AssistantToolCtx => ({ user, companyIds });

it('admin 无 companyIds = 全部', () => {
  expect(toolCompanyWhere(ctx({ sub: 'a', role: 'admin', companyId: null }))).toEqual({});
});
it('admin + companyIds = in 集合', () => {
  expect(toolCompanyWhere(ctx({ sub: 'a', role: 'admin', companyId: null }, ['x', 'y'])))
    .toEqual({ companyId: { in: ['x', 'y'] } });
});
it('leader = 本公司', () => {
  expect(toolCompanyWhere(ctx({ sub: 'l', role: 'leader', companyId: 'co-1' }))).toEqual({ companyId: 'co-1' });
});
it('staff 无归属公司 = 永假空集', () => {
  expect(toolCompanyWhere(ctx({ sub: 's', role: 'staff', companyId: null }))).toEqual({ companyId: { in: [] } });
});
it('匿名/其他角色 = 不加过滤（外层 allowedTools 门禁管住）', () => {
  expect(toolCompanyWhere({})).toEqual({});
});
```

- [ ] **Step 2: 跑测确认失败**

Run: `cd apps/api && npx jest src/assistant/tools/company-filter.spec.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现 helper + 注入五个工具**

```ts
// apps/api/src/assistant/tools/company-filter.ts
import type { AssistantToolCtx } from './assistant-tool';

/** 数据工具公司口径（2026-10-22 :3011 P1）：与三页 CompanyScope 同语义。
 *  admin：默认全部，companyIds（ChatDto.context 服务端采纳）多选；
 *  leader/staff：强制本公司（无归属=永假空集，绝不放行全部）；
 *  其他角色/匿名：不加过滤——外层 allowedTools 门禁已限制其只能用公开域工具。 */
export function toolCompanyWhere(ctx?: AssistantToolCtx): { companyId?: string | { in: string[] } } {
  if (!ctx?.user) return {};
  const { role, companyId } = ctx.user;
  if (role === 'admin') {
    return ctx.companyIds?.length ? { companyId: { in: ctx.companyIds } } : {};
  }
  if (role === 'leader' || role === 'staff') {
    return companyId ? { companyId } : { companyId: { in: [] } };
  }
  return {};
}
```

注入（每工具改法一致——在该工具所有 prisma 查询的 `where` 上展开 `...companyWhere`）：

- `procurement.tool.ts`：`const companyWhere = toolCompanyWhere(ctx);` 每处 `where: { ... }` 改 `where: { ...companyWhere, ... }`（表 procurementRound/companyId ✓）
- `bid.tool.ts`：同法（表 bidProject/companyId ✓）
- `supplier.tool.ts`：同法（表 supplier/companyId ✓，行 118 `数据隔离依据`）
- `expert.tool.ts`：同法（User.companyId，专家归属 2026-09-24 落列）
- `global-overview.tool.ts`：同法（bidProject/expert 等计数处）

各工具的 `execute(args, _ctx)` 形参去下划线改为消费。

- [ ] **Step 4: 跑测 + 回归**

Run: `cd apps/api && npx jest src/assistant/ && npx tsc --noEmit && npx eslint apps/api/src/assistant/tools/`
Expected: 全绿。

- [ ] **Step 5: 提交**

```bash
git add apps/api/src/assistant/tools/company-filter.ts apps/api/src/assistant/tools/company-filter.spec.ts apps/api/src/assistant/tools/procurement.tool.ts apps/api/src/assistant/tools/bid.tool.ts apps/api/src/assistant/tools/supplier.tool.ts apps/api/src/assistant/tools/expert.tool.ts apps/api/src/assistant/tools/global-overview.tool.ts
git commit -m "feat(assistant): 数据工具公司口径注入——procurement/bid/supplier/expert/global_overview 查询挂 toolCompanyWhere（leader 不越本公司）"
```

---

### Task 7: cockpit 工具（驾驶舱口径问答）

**Files:**
- Create: `apps/api/src/assistant/tools/cockpit.tool.ts`
- Modify: `apps/api/src/assistant/assistant.service.ts`（注册）、`apps/api/src/assistant/assistant.module.ts`（imports/providers）
- Modify: `apps/api/src/progress/progress.module.ts`（exports 补 ProgressService）
- Test: `apps/api/src/assistant/tools/cockpit.tool.spec.ts`（新建）

**Interfaces:**
- Consumes: `DashboardService.getDashboard(start?, end?, filter?)`（既有）、`ProgressService.getProgressStats(userId?, stage?, filter?)`（既有，签名顺序见 progress.controller.ts:19-24）、`toolCompanyWhere`（Task 6）。
- Produces: 工具 `cockpit`——`args: { action: 'summary' | 'risk' | 'savings' | 'stages' }`，返回 metric/table 卡片。

- [ ] **Step 1: 写失败测试**

```ts
// apps/api/src/assistant/tools/cockpit.tool.spec.ts
import { CockpitTool } from './cockpit.tool';

const monthStart = () => `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}-01`;
const dashboard: any = { getDashboard: jest.fn().mockResolvedValue({
  summary: { totalCount: 10, completedCount: 5, abnormalCount: 1, totalAwardLabel: '900万', totalSavingsLabel: '60万' },
  riskProjects: [{ project: 'R1', pendingDays: 20, reason: '评标滞留' }],
  savingsRanking: [{ project: 'S1', savingsRate: 15, savingsLabel: '30万' }],
}) };
const progress: any = { getProgressStats: jest.fn().mockResolvedValue({ totalActive: 7, stageDistribution: [{ stage: 'CONTRACT', stageName: '合同', count: 3 }] }) };

it('summary 返回指标卡，且过滤条件来自 ctx（leader 本公司）', async () => {
  const tool = new CockpitTool(dashboard, progress);
  const r = await tool.execute({ action: 'summary' }, { user: { sub: 'u', role: 'leader', companyId: 'co-1' } });
  expect(r.success).toBe(true);
  expect(r.cards?.[0].type).toBe('metric');
  expect(dashboard.getDashboard).toHaveBeenCalledWith(monthStart(), undefined, { companyId: 'co-1' });
});
it('stages 走 ProgressService', async () => {
  const tool = new CockpitTool(dashboard, progress);
  const r = await tool.execute({ action: 'stages' }, { user: { sub: 'u', role: 'admin', companyId: null } });
  expect(progress.getProgressStats).toHaveBeenCalledWith(undefined, undefined, {});
  expect(r.cards?.[0].type).toBe('table');
});
```

- [ ] **Step 2: 跑测确认失败**

Run: `cd apps/api && npx jest src/assistant/tools/cockpit.tool.spec.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现**

```ts
// apps/api/src/assistant/tools/cockpit.tool.ts
import { Injectable } from '@nestjs/common';
import { DashboardService } from '../../dashboard/dashboard.service';
import { ProgressService } from '../../progress/progress.service';
import { AssistantTool, AssistantToolCtx, ToolResult } from './assistant-tool';
import { toolCompanyWhere } from './company-filter';

/** 领导驾驶舱（:3011）口径问答——与三页同源（本月口径 + 全量风险），公司口径随 ctx */
@Injectable()
export class CockpitTool implements AssistantTool {
  name = 'cockpit';
  description =
    '查询领导驾驶舱口径数据（本月 + 全量风险）。args: { action: "summary"|"risk"|"savings"|"stages" }——summary=核心指标概览，risk=风险项目，savings=节资排行，stages=采购阶段分布。领导驾驶舱类问题优先用本工具。';

  constructor(
    private readonly dashboard: DashboardService,
    private readonly progress: ProgressService,
  ) {}

  async execute(args: Record<string, unknown> = {}, ctx?: AssistantToolCtx): Promise<ToolResult> {
    const where = toolCompanyWhere(ctx);
    const action = (args.action as string) || 'summary';
    const now = new Date();
    const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;

    if (action === 'stages') {
      const stats = await this.progress.getProgressStats(undefined, undefined, where);
      return {
        success: true,
        cards: [{
          type: 'table',
          title: '采购阶段分布（在办）',
          rows: (stats.stageDistribution ?? []).map((d: { stageName?: string; stage: string; count: number }) => ({
            阶段: d.stageName ?? d.stage, 项目数: d.count,
          })),
        }],
      };
    }

    const data = await this.dashboard.getDashboard(monthStart, undefined, where);
    if (action === 'risk') {
      return {
        success: true,
        cards: [{
          type: 'table',
          title: `风险项目（${data.riskProjects?.length ?? 0} 项）`,
          rows: (data.riskProjects ?? []).map((r: { project: string; pendingDays: number; reason: string }) => ({
            项目: r.project, 滞留天数: r.pendingDays, 原因: r.reason,
          })),
        }],
      };
    }
    if (action === 'savings') {
      return {
        success: true,
        cards: [{
          type: 'table',
          title: '节资率排行',
          rows: (data.savingsRanking ?? []).slice(0, 5).map((s: { project: string; savingsRate: number; savingsLabel: string }) => ({
            项目: s.project, 节资率: `${s.savingsRate}%`, 节约额: s.savingsLabel,
          })),
        }],
      };
    }
    const s = data.summary;
    return {
      success: true,
      cards: [{
        type: 'metric',
        title: '本月驾驶舱概览',
        metrics: [
          { label: '采购轮次', value: String(s.totalCount) },
          { label: '已成交', value: String(s.completedCount) },
          { label: '异常', value: String(s.abnormalCount) },
          { label: '成交总额', value: s.totalAwardLabel },
          { label: '累计节资', value: s.totalSavingsLabel },
        ],
      }],
    };
  }
}
```

（若 DashboardData 的 summary label 字段名与此处不符，以 `apps/mobile-portal/src/lib/api/dashboard.ts` 的 `DashboardData` 同名为准对齐。）

接线：`progress.module.ts` providers 已含 ProgressService，补 `exports: [..., ProgressService]`；`assistant.module.ts` imports 加 `DashboardModule`、`ProgressModule`，providers 加 `CockpitTool`；`assistant.service.ts` 构造器注入 `cockpitTool` 并在 register 段加 `this.toolRegistry.register(this.cockpitTool);`。`assistant.module.ts` 若未 import `CompanyModule` 无需——cockpit 只用 toolCompanyWhere。

- [ ] **Step 4: 跑测 + 回归 + 冒烟**

Run: `cd apps/api && npx jest src/assistant/ && npx tsc --noEmit`
curl 冒烟（direct-tool 协议，leader 登录）：`curl -s -X POST localhost:4001/api/assistant/chat -H 'Content-Type: application/json' -H 'X-Portal: web' -H "X-Web-Token: $TOKEN" -d '{"message":"请调用 cockpit 工具，参数 {\"action\":\"summary\"}"}'` → answer+cards 仅本公司口径。

- [ ] **Step 5: 提交**

```bash
git add apps/api/src/assistant/tools/cockpit.tool.ts apps/api/src/assistant/tools/cockpit.tool.spec.ts apps/api/src/assistant/assistant.service.ts apps/api/src/assistant/assistant.module.ts apps/api/src/progress/progress.module.ts
git commit -m "feat(assistant): cockpit 工具——驾驶舱口径问答（summary/risk/savings/stages），Dashboard+Progress 同源随 ctx 公司过滤"
```

---

### Task 8: :3011 水叮当第四 Tab（前端）

**Files:**
- Create: `apps/mobile-portal/src/lib/api/assistant.ts`、`apps/mobile-portal/src/app/(main)/chat/page.tsx`、`apps/mobile-portal/src/components/m/chat-card.tsx`
- Modify: `apps/mobile-portal/src/app/(main)/layout.tsx`（TABS 加第四项）

**Interfaces:**
- Consumes: `POST /assistant/chat` `{ conversationId?, message, context? }` → `{ conversationId, answer, cards, citations, pendingActions }`（既有）；`GET /assistant/conversations/:id`；`POST /assistant/conversations`。
- Produces: `/chat` 路由页；TABS 数组四项。

- [ ] **Step 1: API 封装** `lib/api/assistant.ts`

```ts
import { api } from "../api";

export type ChatCard =
  | { type: "metric" | "table"; title: string; metrics?: Array<{ label: string; value: string }>; rows?: Array<Record<string, string>>; [k: string]: unknown }
  | { type: "chart"; title: string; chartType: string; caption?: string; [k: string]: unknown };

export type ChatMessage = {
  role: "user" | "assistant";
  content: string;
  cards?: ChatCard[];
  pending?: boolean;
};

export type ChatResult = {
  conversationId: string;
  answer: string;
  cards: ChatCard[];
  citations?: unknown[];
  pendingActions?: unknown[];
};

export async function sendChat(message: string, conversationId?: string | null, companyIds?: string[]): Promise<ChatResult> {
  return api.post<ChatResult>("/assistant/chat", {
    message,
    ...(conversationId ? { conversationId } : {}),
    ...(companyIds?.length ? { context: { companyIds } } : {}),
  });
}

export async function fetchConversation(id: string): Promise<{ messages?: Array<{ role: string; content: string; cardsJson?: ChatCard[] }> }> {
  return api.get(`/assistant/conversations/${id}`);
}

export async function createConversation(): Promise<{ id: string }> {
  return api.post<{ id: string }>("/assistant/conversations", { title: "移动驾驶舱对话" });
}
```

- [ ] **Step 2: 卡片渲染组件** `components/m/chat-card.tsx`（防御式——metric/table 直渲，chart 降级为标题行）

```tsx
import type { ChatCard } from "@/lib/api/assistant";

/** 聊天卡片——metric=指标瓷片网格 / table=迷你表 / chart=标题+说明降级（移动端不画图） */
export function ChatCardView({ card }: { card: ChatCard }) {
  if (card.type === "chart") {
    return (
      <div className="mt-1.5 rounded-[12px] m-tile px-3 py-2.5">
        <div className="text-[13px] font-bold text-[var(--foreground)]">{card.title}</div>
        <div className="mt-0.5 text-[12px] text-[var(--muted-foreground)]">{card.caption ?? "图表详见电脑端"}</div>
      </div>
    );
  }
  if (card.type === "metric") {
    const items = (card.metrics ?? []) as Array<{ label: string; value: string }>;
    if (items.length) {
      return (
        <div className="mt-1.5 grid grid-cols-2 gap-1.5">
          {items.map((m, i) => (
            <div key={i} className="rounded-[12px] m-tile px-3 py-2">
              <div className="text-[12px] text-[var(--muted-foreground)]">{m.label}</div>
              <div className="mt-0.5 text-[17px] font-black leading-none tabular-nums text-[var(--foreground)]">{m.value}</div>
            </div>
          ))}
        </div>
      );
    }
    return <FallbackCard card={card} />;
  }
  const rows = (card.rows ?? []) as Array<Record<string, string>>;
  if (!rows.length) return <FallbackCard card={card} />;
  const cols = Object.keys(rows[0]).slice(0, 4);
  return (
    <div className="mt-1.5 overflow-hidden rounded-[12px] m-tile">
      <div className="px-3 pt-2.5 text-[13px] font-bold text-[var(--foreground)]">{card.title}</div>
      <div className="overflow-x-auto px-3 pb-2.5 pt-1.5">
        <table className="w-full text-[12px]">
          <thead>
            <tr className="text-left text-[var(--muted-foreground)]">
              {cols.map((c) => <th key={c} className="whitespace-nowrap py-1 pr-3 font-semibold">{c}</th>)}
            </tr>
          </thead>
          <tbody className="tabular-nums text-[var(--foreground)]">
            {rows.slice(0, 8).map((r, i) => (
              <tr key={i} className="border-t border-[color-mix(in_oklch,var(--border)_45%,transparent)]">
                {cols.map((c) => <td key={c} className="max-w-[10rem] truncate py-1 pr-3">{String(r[c] ?? "")}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function FallbackCard({ card }: { card: ChatCard }) {
  const entries = Object.entries(card).filter(([k]) => k !== "type" && k !== "title").slice(0, 4);
  return (
    <div className="mt-1.5 rounded-[12px] m-tile px-3 py-2.5">
      <div className="text-[13px] font-bold text-[var(--foreground)]">{card.title}</div>
      {entries.map(([k, v]) => (
        <div key={k} className="mt-0.5 truncate text-[12px] text-[var(--muted-foreground)]">
          {k}: {typeof v === "string" ? v : JSON.stringify(v).slice(0, 60)}
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 3: 聊天页** `app/(main)/chat/page.tsx`

```tsx
"use client";

import { useEffect, useRef, useState } from "react";
import { Bot, Plus, SendHorizonal, Sparkles } from "lucide-react";
import { useAuth } from "@/components/m/auth-context";
import { sendChat, fetchConversation, createConversation, type ChatMessage } from "@/lib/api/assistant";
import { ChatCardView } from "@/components/m/chat-card";

const CONV_KEY = "m-shuidingdang-conversation";
const QUICK_QUESTIONS = ["本月成交额多少", "当前最大风险是什么", "节资排名前三", "哪个阶段最堵"];

export default function ChatPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const saved = localStorage.getItem(CONV_KEY);
    if (!saved) return;
    fetchConversation(saved)
      .then((c) => {
        setConversationId(saved);
        setMessages(
          (c.messages ?? []).slice(-20).map((m) => ({ role: m.role === "user" ? "user" : "assistant", content: m.content, cards: m.cardsJson ?? [] })),
        );
      })
      .catch(() => localStorage.removeItem(CONV_KEY));
  }, []);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, sending]);

  async function ask(text: string) {
    const q = text.trim();
    if (!q || sending) return;
    setInput("");
    setSending(true);
    setMessages((prev) => [...prev, { role: "user", content: q }]);
    try {
      const r = await sendChat(q, conversationId, isAdmin ? undefined : undefined);
      if (r.conversationId) { setConversationId(r.conversationId); localStorage.setItem(CONV_KEY, r.conversationId); }
      setMessages((prev) => [...prev, { role: "assistant", content: r.answer, cards: r.cards ?? [] }]);
    } catch {
      setMessages((prev) => [...prev, { role: "assistant", content: "抱歉，水叮当暂时开小差了，请稍后再试。" }]);
    } finally {
      setSending(false);
    }
  }

  async function newConversation() {
    try {
      const c = await createConversation();
      setConversationId(c.id);
      localStorage.setItem(CONV_KEY, c.id);
      setMessages([]);
    } catch { /* 失败保留当前会话 */ }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* 顶部：口径标签 + 新对话 */}
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-1.5 truncate text-[12px] text-[var(--muted-foreground)]">
          <Bot size={13} className="shrink-0 text-[var(--accent)]" />
          {isAdmin ? "当前口径：全部公司（可在数据库页切换后提问）" : "当前口径：本公司数据"}
        </span>
        <button type="button" onClick={newConversation} className="neu-btn-soft h-8 shrink-0 rounded-[9px] px-2.5 text-[13px] active:scale-95">
          <Plus size={12} /> 新对话
        </button>
      </div>

      {/* 消息流 */}
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain pb-2">
        {messages.length === 0 ? (
          <div className="flex flex-col items-center gap-3 px-4 py-10">
            <div className="flex h-12 w-12 items-center justify-center rounded-[14px] bg-[color-mix(in_oklch,var(--accent)_10%,transparent)]">
              <Bot size={22} className="text-[var(--accent)]" />
            </div>
            <p className="text-[15px] font-bold text-[var(--foreground)]">你好，我是水叮当</p>
            <p className="text-center text-[13px] text-[var(--muted-foreground)]">问我任何采购数据问题，我基于你权限内的真实数据作答</p>
            <div className="mt-1 flex flex-wrap justify-center gap-2">
              {QUICK_QUESTIONS.map((q) => (
                <button key={q} type="button" onClick={() => ask(q)} className="m-chip">
                  <Sparkles size={11} /> {q}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((m, i) => (
            <div key={i} className={m.role === "user" ? "flex justify-end" : "flex justify-start"}>
              <div className={m.role === "user" ? "max-w-[85%] rounded-[14px] bg-[color-mix(in_oklch,var(--accent)_12%,transparent)] px-3.5 py-2.5 text-[14px] leading-relaxed text-[var(--foreground)]" : "max-w-[92%]"}>
                {m.role === "assistant" ? (
                  <div className="rounded-[14px] neu-card-static px-3.5 py-2.5 text-[14px] leading-relaxed text-[var(--foreground)]">
                    {m.content}
                    {(m.cards ?? []).map((c, j) => <ChatCardView key={j} card={c} />)}
                  </div>
                ) : m.content}
              </div>
            </div>
          ))
        )}
        {sending ? (
          <div className="flex justify-start">
            <div className="flex items-center gap-1.5 rounded-[14px] neu-card-static px-3.5 py-3">
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-[var(--accent)]" />
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-[var(--accent)] [animation-delay:0.15s]" />
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-[var(--accent)] [animation-delay:0.3s]" />
            </div>
          </div>
        ) : null}
        <div ref={bottomRef} />
      </div>

      {/* 输入条 */}
      <form
        onSubmit={(e) => { e.preventDefault(); ask(input); }}
        className="flex items-center gap-2 pt-1"
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="问点什么…"
          className="m-input h-11 min-w-0 flex-1 rounded-[14px]"
        />
        <button type="submit" disabled={!input.trim() || sending} aria-label="发送"
          className="neu-btn-primary h-11 w-11 shrink-0 rounded-[14px] p-0 disabled:opacity-50">
          <SendHorizonal size={16} />
        </button>
      </form>
    </div>
  );
}
```

（`sendChat(q, conversationId, ...)` 第三参 admin 公司切换留到 Task 12 后按 filter-store 接线；本任务传 undefined。）

- [ ] **Step 4: layout TABS 第四项**

```tsx
import { Bot, Crown, FolderKanban, LayoutDashboard, LogOut, TrendingUp } from "lucide-react";
const TABS = [
  { href: "/dashboard", label: "数据库", icon: LayoutDashboard },
  { href: "/ledger", label: "台账", icon: FolderKanban },
  { href: "/progress", label: "进展", icon: TrendingUp },
  { href: "/chat", label: "水叮当", icon: Bot },
];
```

- [ ] **Step 5: 验证 + 提交**

Run: `cd apps/mobile-portal && npx tsc --noEmit && pnpm lint`
浏览器冒烟：:3011 底部第四 Tab「水叮当」→ 快捷问题点击 → 气泡 + 卡片返回；「新对话」清空；pendingActions 不出现任何按钮。

```bash
git add apps/mobile-portal/src/lib/api/assistant.ts apps/mobile-portal/src/components/m/chat-card.tsx "apps/mobile-portal/src/app/(main)/chat/page.tsx" "apps/mobile-portal/src/app/(main)/layout.tsx"
git commit -m "feat(mobile): :3011 水叮当第四 Tab——气泡+卡片渲染（chart 降级）+快捷问题+会话恢复+只读铁律"
```

---

### Task 9: e2e——工具口径越权闸

**Files:**
- Create: `apps/api/test/mobile-cockpit.e2e-spec.ts`

**Interfaces:** Consumes: 既有 e2e 登录模式（cookie/token，见 `test/*.e2e-spec.ts` 开头）；Task 5-7 的 chat/cockpit 行为。

- [ ] **Step 1: 写用例**（三断言）

```ts
// apps/api/test/mobile-cockpit.e2e-spec.ts
import request from 'supertest';
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { AppModule } from '../src/app.module';

describe('移动驾驶舱水叮当（:3011）e2e', () => {
  let app: INestApplication;
  let leaderToken: string;
  let adminToken: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    const login = async (username: string, password: string) =>
      (await request(app.getHttpServer())
        .post('/api/auth/login')
        .set('X-Portal', 'web')
        .send({ username, password })
        .then((r) => r.body.access_token'])) as string;
    leaderToken = await login('Swhi-CGZX-01', 'Swhi-CGZX-01@2026');
    adminToken = await login('Swhi-CGZX-admin', 'Swhi-CGZX-admin@2026');
  });

  it('leader 直调 cockpit：卡片数字 === 同口径 dashboard API 数字（不越公司）', async () => {
    const chat = await request(app.getHttpServer())
      .post('/api/assistant/chat').set('X-Portal', 'web').set('X-Web-Token', leaderToken)
      .send({ message: '请调用 cockpit 工具，参数 {"action":"summary"}' }).expect(200);
    const dash = await request(app.getHttpServer())
      .get('/api/dashboard').set('X-Portal', 'web').set('X-Web-Token', leaderToken).expect(200);
    const metrics = (chat.body.cards?.[0]?.metrics ?? []) as Array<{ label: string; value: string }>;
    expect(metrics.length).toBeGreaterThan(0);
    expect(metrics.find((m) => m.label === '采购轮次')?.value).toBe(String(dash.body.summary.totalCount));
  });

  it('非 admin 伪造 context.companyIds 被忽略', async () => {
    const chat = await request(app.getHttpServer())
      .post('/api/assistant/chat').set('X-Portal', 'web').set('X-Web-Token', leaderToken)
      .send({ message: '请调用 cockpit 工具，参数 {"action":"summary"}', context: { companyIds: ['some-other-co'] } })
      .expect(200);
    const dash = await request(app.getHttpServer())
      .get('/api/dashboard?companyId=some-other-co').set('X-Portal', 'web').set('X-Web-Token', leaderToken).expect(200);
    // 非admin的dashboard companyId被忽略 → 两个口径都是leader本公司 → 数字一致
    const metrics = (chat.body.cards?.[0]?.metrics ?? []) as Array<{ label: string; value: string }>;
    expect(metrics.find((m) => m.label === '采购轮次')?.value).toBe(String(dash.body.summary.totalCount));
  });

  it('匿名访客调用 cockpit 被拒（公开域门禁）', async () => {
    const r = await request(app.getHttpServer())
      .post('/api/assistant/chat')
      .set('X-Assistant-Guest', 'guestkey12345')
      .send({ message: '请调用 cockpit 工具，参数 {"action":"summary"}' })
      .expect(201);
    expect(r.body.answer).toContain('登录');
  });

  afterAll(async () => { await app.close(); });
});
```

（direct-tool 消息格式 `请调用 X 工具，参数 {...}` 须与 assistant.service.ts `directToolMatch` 正则一致——执行时核对正则并保持一致。）

- [ ] **Step 2: 跑 e2e**

Run: `cd apps/api && pnpm test:e2e -- mobile-cockpit`
Expected: 3 PASS。若 seed 数据某公司轮次为 0，两 API 等值断言依然成立（0===0）。

- [ ] **Step 3: 提交**

```bash
git add apps/api/test/mobile-cockpit.e2e-spec.ts
git commit -m "test(assistant): :3011 水叮当 e2e——leader 口径等值断言/伪造 companyIds 忽略/匿名拒答"
```

---

### Task 10: 一键转发简报

**Files:**
- Create: `apps/mobile-portal/src/lib/copy-to-clipboard.ts`
- Modify: `apps/mobile-portal/src/app/(main)/dashboard/page.tsx`（要报卡加转发钮）

**Interfaces:** Consumes: Task 3 `shareText`、Task 4 要报卡。

- [ ] **Step 1: copy util**（与 web/bid-portal 同款，execCommand 降级返回布尔）

```ts
/** 复制到剪贴板——navigator.clipboard 仅 https/localhost 可用，http 演示环境降级 execCommand */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch { /* 降级 */ }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}
```

- [ ] **Step 2: 要报卡头部加转发钮**

```tsx
const [shared, setShared] = useState<"idle" | "ok" | "fail">("idle");
async function shareBrief() {
  if (!brief?.available) return;
  const text = brief.shareText;
  if (navigator.share) {
    try { await navigator.share({ title: "蜀水云采·今日要报", text }); return; } catch { /* AbortError=用户取消，回落复制 */ }
  }
  const ok = await copyToClipboard(text);
  setShared(ok ? "ok" : "fail");
  window.setTimeout(() => setShared("idle"), 2000);
}
```

要报卡标题行右侧（替换原「今日要报」标题行）：

```tsx
<div className="mb-2 flex items-center justify-between gap-2">
  <div className="flex items-center gap-2 text-[12px] font-bold uppercase tracking-[0.1em] text-[var(--accent)]">
    <Sparkles size={13} /> 今日要报
  </div>
  {brief?.available ? (
    <button type="button" onClick={shareBrief} className="neu-btn-soft h-8 shrink-0 rounded-[9px] px-2.5 text-[13px] active:scale-95">
      <Share2 size={12} /> {shared === "ok" ? "已复制" : shared === "fail" ? "复制失败" : "转发"}
    </button>
  ) : null}
</div>
```

（import 补 `Share2` 与 `copyToClipboard`。）

- [ ] **Step 3: 验证 + 提交**

Run: `cd apps/mobile-portal && npx tsc --noEmit && pnpm lint`
冒烟：点「转发」→ 手机弹原生分享面板（或桌面复制成功提示）；http 局域网环境走 execCommand 降级。

```bash
git add apps/mobile-portal/src/lib/copy-to-clipboard.ts "apps/mobile-portal/src/app/(main)/dashboard/page.tsx"
git commit -m "feat(mobile): :3011 今日要报一键转发——navigator.share 优先/剪贴板降级（execCommand 兜底）"
```

---

### Task 11: `GET /progress/upcoming` + 关键节点时间线

**Files:**
- Modify: `apps/api/src/progress/progress.service.ts`、`apps/api/src/progress/progress.controller.ts`
- Modify: `apps/mobile-portal/src/lib/api/progress.ts`、`apps/mobile-portal/src/app/(main)/progress/page.tsx`
- Test: `apps/api/src/progress/progress-upcoming.spec.ts`（新建）

**Interfaces:**
- Produces: `GET /api/progress/upcoming?days=14` → `{ days: number; items: Array<{ date: string; events: Array<{ type: 'DEADLINE' | 'OPENING'; projectId: string; name: string; time: string }> }> }`。

- [ ] **Step 1: 写失败测试**（mock prisma bidProject.findMany 返回双事件，断言按日分组+升序）

```ts
// apps/api/src/progress/progress-upcoming.spec.ts
import { ProgressService } from './progress.service';

it('未来节点按日分组且升序、含 PMI 项目名', async () => {
  const day = (n: number) => new Date(Date.now() + n * 24 * 3600 * 1000);
  const prisma: any = { bidProject: { findMany: jest.fn().mockResolvedValue([
    { id: 'b1', name: '标段A', deadline: day(3), openTime: day(2),
      projectManagementItem: { title: 'R项目' } },
    { id: 'b2', name: '标段B', deadline: day(2), openTime: day(1), projectManagementItem: null },
  ]) } };
  const svc = new (ProgressService as any)(prisma, ...otherDeps);
  const r = await svc.getUpcoming(14, undefined);
  expect(r.items[0].date).toBe(day(1).toISOString().slice(0, 10));
  expect(r.items[0].events).toHaveLength(1);
  expect(r.items[0].events[0]).toMatchObject({ type: 'OPENING', name: '标段B' });
  expect(r.items[1].events.map((e: { type: string; name: string }) => `${e.type}:${e.name}`).sort()).toEqual(['DEADLINE:标段A', 'OPENING:标段A']);
  expect(r.items[2].events[0].name).toBe('R项目');
});
```

（`...otherDeps` 按 ProgressService 构造器实际依赖补 mock——执行时打开构造器照抄依赖列表置 jest.fn()。）

- [ ] **Step 2: 跑测确认失败**

Run: `cd apps/api && npx jest src/progress/progress-upcoming.spec.ts` → FAIL

- [ ] **Step 3: 实现服务与控制器**

progress.service.ts：

```ts
  /** :3011 未来关键节点——BidProject 截标/开标未来 N 天，含 PMI 关联名（公司口径） */
  async getUpcoming(days = 14, companyFilter?: CompanyWhere) {
    const now = new Date();
    const until = new Date(now.getTime() + days * 24 * 3600 * 1000);
    const rows = await this.prisma.bidProject.findMany({
      where: {
        ...companyFilter,
        OR: [
          { deadline: { gte: now, lte: until } },
          { openTime: { gte: now, lte: until } },
        ],
      },
      select: {
        id: true, name: true, deadline: true, openTime: true,
        projectManagementItem: { select: { title: true } },
      },
      orderBy: { openTime: 'asc' },
    });
    const byDay = new Map<string, Array<{ type: 'DEADLINE' | 'OPENING'; projectId: string; name: string; time: string }>>();
    for (const r of rows) {
      const displayName = r.projectManagementItem?.title || r.name;
      for (const [type, t] of [['OPENING', r.openTime], ['DEADLINE', r.deadline]] as const) {
        if (!t || t < now || t > until) continue;
        const date = t.toISOString().slice(0, 10);
        if (!byDay.has(date)) byDay.set(date, []);
        byDay.get(date)!.push({ type, projectId: r.id, name: displayName, time: t.toISOString() });
      }
    }
    return {
      days,
      items: Array.from(byDay.entries())
        .map(([date, events]) => ({ date, events: events.sort((a, b) => a.time.localeCompare(b.time)) }))
        .sort((a, b) => a.date.localeCompare(b.date)),
    };
  }
```

progress.controller.ts（仿既有 ai-insights 守卫）：

```ts
  @Get('upcoming')
  @ApiOperation({ summary: ':3011 未来关键节点（截标/开标）' })
  async getUpcoming(
    @CurrentUser() user: AuthenticatedUser,
    @Query('days') days?: string,
    @Query('companyId') companyId?: string,
  ) {
    if (!canViewGlobalBusinessData(user.role)) {
      throw new ForbiddenException('普通账号无法查看采购进度。');
    }
    const scope = await this.companyScope.resolveScope(user, companyId);
    const n = Math.min(Math.max(parseInt(days ?? '14', 10) || 14, 1), 60);
    return this.progressService.getUpcoming(n, this.companyScope.filter(scope));
  }
```

（`ApiOperation`/`Query` 若未 import 则补；本控制器已有 canViewGlobalBusinessData import。）

- [ ] **Step 4: 前端**——`lib/api/progress.ts` 加类型与 `fetchUpcoming(days?)`；progress 页顶部（CompanyPicker 后）：

```tsx
const [upcoming, setUpcoming] = useState<UpcomingResult | null>(null);
useEffect(() => {
  let active = true;
  fetchUpcoming(14).then((u) => { if (active) setUpcoming(u); }).catch(() => undefined);
  return () => { active = false; };
}, [filterCompanyId]);

{upcoming?.items.length ? (
  <SectionCard icon={CalendarClock} title="未来 14 天关键节点" index={-1}>
    <div className="flex gap-2 overflow-x-auto pb-1">
      {upcoming.items.map((d) => (
        <div key={d.date} className="w-[7.5rem] shrink-0 rounded-[12px] m-tile px-2.5 py-2">
          <div className="text-[12px] font-bold tabular-nums text-[var(--accent)]">{d.date.slice(5)}</div>
          {d.events.map((e, i) => (
            <div key={i} className="mt-1 flex items-center gap-1">
              <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${e.type === "OPENING" ? "bg-[var(--success)]" : "bg-[var(--warning)]"}`} />
              <span className="min-w-0 flex-1 truncate text-[12px] text-[var(--foreground)]">{e.name}</span>
              <span className="shrink-0 text-[11px] text-[var(--muted-foreground)]">{e.type === "OPENING" ? "开标" : "截标"}</span>
            </div>
          ))}
        </div>
      ))}
    </div>
  </SectionCard>
) : null}
```

（`SectionCard` index 传 -1 或重排后续 index；import `CalendarClock`。）

- [ ] **Step 5: 验证 + 提交**

Run: API jest+tsc；前端 tsc+lint；浏览器 /progress 见时间线（无节点则不渲染——空态不占位）。

```bash
git add apps/api/src/progress/progress.service.ts apps/api/src/progress/progress.controller.ts apps/api/src/progress/progress-upcoming.spec.ts apps/mobile-portal/src/lib/api/progress.ts "apps/mobile-portal/src/app/(main)/progress/page.tsx"
git commit -m "feat(mobile): :3011 未来 14 天关键节点时间线——GET /progress/upcoming（截标/开标，PMI 关联名）"
```

---

### Task 12: 公司龙虎榜

**Files:**
- Modify: `apps/api/src/dashboard/dashboard.service.ts`、`apps/api/src/dashboard/dashboard.controller.ts`
- Modify: `apps/mobile-portal/src/lib/api/dashboard.ts`、`apps/mobile-portal/src/app/(main)/dashboard/page.tsx`
- Test: `apps/api/src/dashboard/dashboard-ranking.spec.ts`（新建）

**Interfaces:**
- Produces: `GET /api/dashboard/company-ranking?range=month|year` →
  admin：`{ range: string; rows: Array<{ companyId: string; companyName: string; totalCount: number; awardedCount: number; awardAmount: number; savings: number; abnormalCount: number }> }`（按 awardAmount 降序）；
  leader/staff：`{ range: string; self: { rank: number; companyName: string; awardAmount: number } | null; groupAvg: { awardAmount: number; totalCount: number } }`。

- [ ] **Step 1: 写失败测试**

```ts
// apps/api/src/dashboard/dashboard-ranking.spec.ts
import { DashboardService } from './dashboard.service';

it('按公司聚合、公司名回填、按成交额降序', async () => {
  const prisma: any = {
    procurementRound: { groupBy: jest.fn().mockResolvedValue([
      { companyId: 'c1', _count: { _all: 10 }, _sum: { awardAmount: 500, budgetAmount: 600 } },
      { companyId: 'c2', _count: { _all: 5 }, _sum: { awardAmount: 900, budgetAmount: 1000 } },
    ]) },
    company: { findMany: jest.fn().mockResolvedValue([{ id: 'c1', name: '甲公司' }, { id: 'c2', name: '乙公司' }]) },
  };
  const svc = new (DashboardService as any)(prisma);
  const r = await svc.getCompanyRanking('2026-10-01');
  expect(r.rows[0]).toMatchObject({ companyName: '乙公司', totalCount: 5 });
  expect(r.rows[1].companyName).toBe('甲公司');
});
```

- [ ] **Step 2: 跑测确认失败** → FAIL

- [ ] **Step 3: 实现**

dashboard.service.ts：

```ts
  /** :3011 公司龙虎榜——区间内轮次按公司聚合（无归属不计排名） */
  async getCompanyRanking(startDate: string) {
    const groups = await this.prisma.procurementRound.groupBy({
      by: ['companyId'],
      where: { procurementDate: { gte: startOfDay(startDate) }, companyId: { not: null } },
      _count: { _all: true },
      _sum: { awardAmount: true, budgetAmount: true },
    });
    const companies = await this.prisma.company.findMany({
      where: { id: { in: groups.map((g) => g.companyId!).filter(Boolean) } },
      select: { id: true, name: true },
    });
    const nameOf = new Map(companies.map((c) => [c.id, c.name]));
    const n = (x: unknown) => (x == null ? 0 : Number(x));
    const rows = groups
      .filter((g) => g.companyId)
      .map((g) => ({
        companyId: g.companyId!,
        companyName: nameOf.get(g.companyId!) ?? '未知公司',
        totalCount: g._count._all,
        awardedCount: g._count._all, // 简化口径：轮次数（成交细分需逐行过滤，榜单主序用成交额）
        awardAmount: n(g._sum.awardAmount),
        savings: Math.max(n(g._sum.budgetAmount) - n(g._sum.awardAmount), 0),
        abnormalCount: 0,
      }))
      .sort((a, b) => b.awardAmount - a.awardAmount);
    return { rows };
  }
```

（`awardedCount/abnormalCount` 需精确值时改用 `findMany` 逐行统计——榜单主排序已由 awardAmount 驱动，两列 v1 以轮次数/0 呈现并在 UI 标注「轮次」。若要精确，改为对 groups 外再 count 查询两组；执行时二选一，勿留 TODO。）

控制器（admin 与 leader 返回不同形状）：

```ts
  @Get('company-ranking')
  @ApiOperation({ summary: ':3011 公司龙虎榜（admin 全榜 / leader 本公司排位+集团均值）' })
  async getCompanyRanking(
    @CurrentUser() user: AuthenticatedUser,
    @Query('range') range?: string,
  ) {
    if (!canViewGlobalBusinessData(user.role)) {
      throw new ForbiddenException('普通账号无法查看数据库页面。');
    }
    const now = new Date();
    const start = range === 'year' ? `${now.getFullYear()}-01-01` : `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
    const { rows } = await this.dashboardService.getCompanyRanking(start);
    if (user.role === 'admin') return { range: range ?? 'month', rows };
    const u = await this.prismaUser(user); // 控制器不直连 prisma——改为 service 提供 getUserCompanyRank(user, start)，实现时把分支逻辑收进 service（本步重构：controller 只透传 role+sub）
    return { range: range ?? 'month', rows }; // ← 以 Step 3b 为准
  }
```

**3b（收口修正，以本块为准）**：控制器只做守卫与透传，分支逻辑放 service——`getCompanyRankingView(user: { sub: string; role: string }, range?: string)`：admin → `{ rows }`；非 admin → 查 `User.companyId`，在 rows 中找排位，并计算 `groupAvg = { awardAmount: rows 平均, totalCount: rows 平均 }`，返回 `{ self: { rank, companyName, awardAmount } | null, groupAvg }`。控制器一行 `return this.dashboardService.getCompanyRankingView(user, range);`。（Step 1 的单测针对 `getCompanyRanking` 聚合口径；分支逻辑补一条 spec：leader 返回 self.rank/groupAvg。）

- [ ] **Step 4: 前端区块**（数据库页「结果构成」后）

`lib/api/dashboard.ts` 加 `CompanyRanking` 类型 + `fetchCompanyRanking(range)`；页面：

```tsx
const [ranking, setRanking] = useState<CompanyRankingView | null>(null);
useEffect(() => {
  let active = true;
  fetchCompanyRanking(rankingRange).then((r) => { if (active) setRanking(r); }).catch(() => undefined);
  return () => { active = false; };
}, [rankingRange, retryTick]);
```

```tsx
<SectionCard icon={Trophy} title="公司龙虎榜" index={6.5}
  right={
    <div className="flex gap-1.5">
      {(["month", "year"] as const).map((k) => (
        <Chip key={k} active={rankingRange === k} onClick={() => setRankingRange(k)}>{k === "month" ? "本月" : "本年"}</Chip>
      ))}
    </div>
  }
>
  {ranking?.rows ? (
    <div className="space-y-1.5">
      {ranking.rows.slice(0, 8).map((r, i) => (
        <div key={r.companyId} className="flex items-center gap-2.5 rounded-[12px] m-tile px-3 py-2">
          <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-[8px] text-[12px] font-black ${i < 3 ? "bg-[color-mix(in_oklch,var(--gold)_14%,transparent)] text-[var(--gold)]" : "text-[var(--muted-foreground)]"}`}>{i + 1}</span>
          <span className="min-w-0 flex-1 truncate text-[14px] font-semibold text-[var(--foreground)]">{r.companyName}</span>
          <span className="shrink-0 text-[13px] font-bold tabular-nums text-[var(--accent)]">{fmtWan(r.awardAmount)}</span>
          <span className="shrink-0 text-[12px] tabular-nums text-[var(--muted-foreground)]">{r.totalCount} 轮</span>
        </div>
      ))}
    </div>
  ) : ranking?.self ? (
    <div className="rounded-[12px] m-tile px-3.5 py-3">
      <div className="text-[14px] font-bold text-[var(--foreground)]">{ranking.self.companyName} · 集团第 {ranking.self.rank} 位</div>
      <div className="mt-1 text-[13px] text-[var(--muted-foreground)]">
        本公司成交 {fmtWan(ranking.self.awardAmount)} · 集团均值 {fmtWan(ranking.groupAvg.awardAmount)}
      </div>
    </div>
  ) : (
    <EmptyState text="暂无可排名的公司数据" />
  )}
</SectionCard>
```

（`fmtWan = (v: number) => (v >= 10000 ? `${(v / 10000).toFixed(1)}万` : `${v.toFixed(0)}元`)`；import `Trophy`；admin 与 leader 共用此卡——`rows` 存在即榜单、否则排位卡。）

- [ ] **Step 5: 验证 + 提交**

Run: API jest/tsc + 前端 tsc/lint + 浏览器（admin 见榜单、Swhi-CGZX-01 见排位卡）。

```bash
git add apps/api/src/dashboard/dashboard.service.ts apps/api/src/dashboard/dashboard.controller.ts apps/api/src/dashboard/dashboard-ranking.spec.ts apps/mobile-portal/src/lib/api/dashboard.ts "apps/mobile-portal/src/app/(main)/dashboard/page.tsx"
git commit -m "feat(mobile): :3011 公司龙虎榜——admin 全榜/leader 排位卡+集团均值（本月/本年切换）"
```

---

### Task 13: 全量验证收尾 + 文档同步

**Files:**
- Modify: `CLAUDE.md`（:3011 行补四 Tab 与新端点一句）、`water-erp/docs/superpowers/specs/2026-10-22-mobile-3011-leader-cockpit-innovation-design.md`（状态改「已实施」）

- [ ] **Step 1: 全量验证**

Run:
```bash
cd apps/api && npx tsc --noEmit && pnpm --filter api lint && pnpm --filter api test
cd ../mobile-portal && npx tsc --noEmit && pnpm lint
cd .. && pnpm --filter api test:e2e
```
Expected: 全绿（e2e 含新 mobile-cockpit 套件；既有 20 套件无回归）。

- [ ] **Step 2: 浏览器冒烟清单**（:3011，375px 视口）

- 四 Tab 角标/切换；水叮当四条快捷问题全走通、卡片渲染、新对话；
- 今日要报三句 + 转发；环比箭头语义（成交↑绿/异常↑红）；
- /progress 关键节点横滑时间线；龙虎榜（admin 账号看榜单、Swhi-CGZX-01 看排位卡）；
- 320px 视口无横向溢出。

- [ ] **Step 3: 文档 + 提交**

CLAUDE.md 移动驾驶舱行追加：「2026-10-22 创新版：今日要报(AI)/环比箭头/Tab 角标/水叮当第四 Tab(复用 assistant 大脑,工具公司口径收口+cockpit 工具)/转发简报/关键节点时间线/公司龙虎榜——spec `docs/superpowers/specs/2026-10-22-mobile-3011-leader-cockpit-innovation-design.md`」。

```bash
git add CLAUDE.md docs/superpowers/specs/2026-10-22-mobile-3011-leader-cockpit-innovation-design.md
git commit -m "docs(mobile): :3011 创新版落成——CLAUDE.md 口径同步 + spec 状态更新"
```

---

## 自审记录（writing-plans Self-Review）

1. **Spec 覆盖**：P0-1→Task 3/4；P0-2→Task 2/4；P0-3→Task 1/4；P1 前端→Task 8；P1 ctx→Task 5；P1 过滤→Task 6；P1 cockpit→Task 7；P1 e2e→Task 9；P2-1→Task 10；P2-2→Task 11；P2-3→Task 12。无遗漏。
2. **占位符**：Task 11 Step 1 `...otherDeps` 与 Task 12 Step 3 半途废弃的 controller 草稿已用「3b 收口修正，以本块为准」消除歧义——执行者以 3b 为准；`...otherDeps` 处已注明按构造器实际依赖补 mock。
3. **类型一致性**：`AssistantToolCtx`（Task 5 定义，6/7/8 消费）、`toolCompanyWhere`（Task 6 定义，7 消费）、`BriefItem/MobileBriefResult`（Task 3 定义，4 消费）、`DashboardBadges`（Task 1 产出 JSON，4 定义类型）、`priorWindow`（Task 2，3 未实际使用——3 内已改用本月固定口径，无需引用，无悬空引用）。
