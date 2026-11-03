# 水叮当·表下真图 + 回答跟随提问 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 图卡在 :3011 真实渲染（五类 SVG），卡片按问题需要挂载（规则闸，两端一致）。

**Architecture:** 后端三步——chart 卡自包含派生数据、cockpit 补 viz、`pushCardsWithCharts` 重构为「规则闸过滤+汇报」并让两条路径的提示词随挂载结果自适应（删除强制补挂 global_overview）；前端一步——按 `chartType` 分发的手写 SVG 渲染器消费 `card.data`。

**Tech Stack:** NestJS 11 + jest（apps/api）；Next.js 16 + React 19 手写 SVG（apps/mobile-portal，零新依赖）。

## Global Constraints

- **两端一致**：卡片策略只在服务端收口；:3005 的 ECharts `option` 原样不动（仅多 `data` 字段无人消费）。
- **确定性规则闸**：不加 LLM 决策步骤（零延迟零成本）。
- 公司隔离/allowedTools/ctx 不动——闸只过滤呈现，不碰工具执行与权限。
- 存量历史 chart 卡（无 data）回退占位文案，不迁移。
- 并行会话约定：禁 `git add -A`；`feat(chat3011):`/`fix(chat3011):` 前缀；结尾 `Co-Authored-By: Claude Code <noreply@anthropic.com>`。
- 图表遵循 dataviz 规范：细 mark、直接标签（非逐点数值）、reduced-motion 直通；调色板与 mapper 同源 8 色。

## 接口契约

**ChartCard 增量**（`chart.mapper.ts`）：

```typescript
data: {
  rows: Array<Record<string, unknown>>;      // 原始行（已滤 _total）
  points?: Array<{ name: string; value: number }>;  // pie/bar/hbar：已排序降序
  labels?: string[];                          // line/grouped_bar：x 轴标签（line 已按时间升序）
  series?: Array<{ name: string; values: number[] }>; // grouped_bar
  total?: number;                             // pie 中心和
}
```

**规则闸**（新文件 `card-gate.ts`）：`applyCardGate(card) → { keep: boolean; droppedText?: string }`，规则见 Task 1。

---

### Task 1: card-gate.ts 规则闸纯函数（TDD）

**Files:**
- Create: `apps/api/src/assistant/card-gate.ts`
- Test: `apps/api/src/assistant/card-gate.spec.ts`

**Interfaces:**
- Produces: `export function applyCardGate(card: Record<string, unknown>): { keep: boolean; droppedText?: string }`

- [ ] **Step 1: 失败测试**

```typescript
import { applyCardGate } from './card-gate';

describe('卡片规则闸（回答跟随提问，2026-11-03）', () => {
  const table = (o: Partial<Record<string, unknown>>) => ({ type: 'table', title: 'T', ...o });

  it('metric 卡原样保留', () => {
    expect(applyCardGate({ type: 'metric', title: '概览', metrics: [] }).keep).toBe(true);
  });
  it('带 viz 的表卡保留（图即答案形状）', () => {
    expect(applyCardGate(table({ viz: { kind: 'distribution' }, rows: [{ a: 1 }] })).keep).toBe(true);
  });
  it('无 viz 且行≤3、键≤2 的小表丢弃并给正文序列化', () => {
    const r = applyCardGate(table({ rows: [{ 项目: 'X', 天数: 5 }, { 项目: 'Y', 天数: 2 }] }));
    expect(r.keep).toBe(false);
    expect(r.droppedText).toContain('T：');
    expect(r.droppedText).toContain('项目=X');
  });
  it('无 viz 多行(>3)表保留', () => {
    expect(applyCardGate(table({ rows: [1, 2, 3, 4].map(() => ({ a: 1, b: 2 })) })).keep).toBe(true);
  });
  it('无 viz 但键>2 的表保留（如全局概览 item/value/note 三键）', () => {
    expect(applyCardGate(table({ rows: [{ item: 'a', value: 1, note: 'x' }] })).keep).toBe(true);
  });
  it('键计数忽略 _total', () => {
    const r = applyCardGate(table({ rows: [{ 项目: 'X', 数: 1, _total: true }] }));
    expect(r.keep).toBe(false); // _total 不计入键数 → 2 键小表 → 丢弃
  });
});
```

- [ ] **Step 2: 红** — `cd apps/api && npx jest src/assistant/card-gate.spec.ts`（模块不存在）
- [ ] **Step 3: 实现**

```typescript
/** 卡片规则闸（2026-11-03 用户裁定：回答跟随提问——确定性规则，无 LLM 步骤）：
 *  metric 保留 / 带 viz 表保留（图即答案形状）/ 无 viz 小表（行≤3 且数据键≤2，
 *  _total 不计）丢弃→数字进正文 / 其余无 viz 表保留（多行明细）。 */
export function applyCardGate(card: Record<string, unknown>): { keep: boolean; droppedText?: string } {
  if (card.type !== 'table' || card.viz) return { keep: true };
  const rows = (card.rows as Array<Record<string, unknown>> | undefined) ?? [];
  if (rows.length === 0) return { keep: true }; // 空表交由前端空态
  const keys = Object.keys(rows[0]).filter((k) => k !== '_total');
  if (rows.length > 3 || keys.length > 2) return { keep: true };
  const droppedText = `${card.title ?? '数据'}：` + rows
    .map((r) => keys.map((k) => `${k}=${String(r[k] ?? '')}`).join('，'))
    .join('；');
  return { keep: false, droppedText };
}
```

- [ ] **Step 4: 绿 → Commit** — `git add apps/api/src/assistant/card-gate.ts apps/api/src/assistant/card-gate.spec.ts`，`feat(chat3011): 卡片规则闸纯函数——metric/viz表保留、小表丢弃数字进正文`

---

### Task 2: chart.mapper 图卡自包含 data（TDD）

**Files:**
- Modify: `apps/api/src/assistant/chart.mapper.ts`（ChartCard 接口 + 五个 mapXxx 各填 data）
- Test: `apps/api/src/assistant/chart.mapper.spec.ts`（追加）

- [ ] **Step 1: 追加失败测试**（沿用既有 spec 的造数风格）

```typescript
it('图卡携带自包含 data（points 降序/total），:3011 可脱离表卡渲染', () => {
  const card = mapToChart({
    title: '阶段分布',
    columns: [{ key: '阶段', label: '阶段' }, { key: '项目数', label: '项目数' }],
    rows: [{ 阶段: 'A', 项目数: 3 }, { 阶段: 'B', 项目数: 7 }],
    viz: { kind: 'distribution', category: '阶段', value: '项目数' },
  });
  expect(card).toBeTruthy();
  expect(card!.data?.points).toEqual([{ name: 'B', value: 7 }, { name: 'A', value: 3 }]);
  expect(card!.data?.total).toBe(10);
  expect(card!.data?.rows).toHaveLength(2);
});
```

- [ ] **Step 2: 红 → Step 3: 实现**——`ChartCard` 接口增 `data?: {...}`（契约见全局节）；`mapDistribution` 饼分支填 `{ rows, points: sorted, total: sum }`、柱/hbar 分支填 `{ rows, points: sorted/shown }`；`mapComposition` 同饼；`mapTrend` 填 `{ rows, labels: sorted.map(timeKey), points: sorted.map(value) }`；`mapRanking` 填 `{ rows, points: sorted }`；`mapComparison` 填 `{ rows, labels: categories, series }`（series 与 option 同源数组）。
- [ ] **Step 4: 全 spec 绿 → Commit** — `feat(chat3011): 图卡自包含 data——points/labels/series/total 随卡下发`

---

### Task 3: cockpit 补 viz（TDD）

**Files:**
- Modify: `apps/api/src/assistant/tools/cockpit.tool.ts`（stages/savings 两卡）
- Test: `apps/api/src/assistant/tools/cockpit.tool.spec.ts`（追加）

- [ ] **Step 1: 追加失败测试**

```typescript
it('stages 卡带 distribution viz（阶段分布出图）', async () => {
  const r = await tool.execute({ action: 'stages' }, ctx);
  const card = r.cards![0] as any;
  expect(card.viz).toEqual({ kind: 'distribution', category: '阶段', value: '项目数' });
});
it('savings 卡带 ranking viz + columns 隐藏数值键（节资率数值不进表列）', async () => {
  const r = await tool.execute({ action: 'savings' }, ctx);
  const card = r.cards![0] as any;
  expect(card.viz).toEqual({ kind: 'ranking', category: '项目', value: '节资率数值' });
  expect(card.columns.map((c: any) => c.key)).toEqual(['项目', '节资率', '节约额']);
  expect(card.rows[0].节资率数值).toBeTypeOf('number');
});
```

- [ ] **Step 2: 红 → Step 3: 实现**——stages 卡加 `viz: { kind: 'distribution', category: '阶段', value: '项目数' }`；savings 卡 rows 增 `节资率数值: s.savingsRate`（number），加 `columns: [{key:'项目',label:'项目'},{key:'节资率',label:'节资率'},{key:'节约额',label:'节约额'}]` 与 `viz: { kind: 'ranking', category: '项目', value: '节资率数值' }`；risk 卡不动（spec 裁定不配图）。
- [ ] **Step 4: 绿 → Commit** — `feat(chat3011): cockpit stages/savings 补 viz 声明——驾驶舱问答出图`

---

### Task 4: assistant.service 接线（闸+提示词自适应+去强制补挂，TDD）

**Files:**
- Modify: `apps/api/src/assistant/assistant.service.ts`：`pushCardsWithCharts`（:692-716）、直派路径（:291-332）、正常路径（:415-421 强制补挂块删除、:424-427 工具循环、:453-456 早退）
- Test: `apps/api/src/assistant/card-gate.spec.ts` 追加服务级用例（沿用 assistant.service.spec 的 mock 模式则更重——闸已纯函数化，服务级仅验证接线，两条路径各一用例即可，放 card-gate.spec 内 mock pushCardsWithCharts 太浅；改为在 assistant.service.spec.ts 追加，沿用其既有 mock 构造）

- [ ] **Step 1: 改造 `pushCardsWithCharts`**——返回 `{ attachedCount: number; droppedData: string[] }`；循环内每卡先 `applyCardGate`：keep 才走现有去重+push+图生成，drop 则收 `droppedText`。

```typescript
private pushCardsWithCharts(
  result: { success: boolean; cards?: unknown[] },
  cards: unknown[],
): { attachedCount: number; droppedData: string[] } {
  const droppedData: string[] = [];
  if (!result.success || !result.cards) return { attachedCount: 0, droppedData };
  let attachedCount = 0;
  for (const c of result.cards) {
    const ct = c as Record<string, unknown>;
    const gate = applyCardGate(ct);
    if (!gate.keep) { droppedData.push(gate.droppedText!); continue; }
    const cardKey = `${ct.type}:${ct.title}`;
    if (cards.some((e) => { const et = e as Record<string, unknown>; return `${et.type}:${et.title || ''}` === cardKey; })) continue;
    cards.push(c);
    attachedCount++;
    if (ct.type !== 'table' || !ct.viz) continue;
    const chartCard = mapToChart({ /* 现状参数不动 */ });
    if (chartCard) { cards.push(chartCard); attachedCount++; }
  }
  return { attachedCount, droppedData };
}
```

- [ ] **Step 2: 直派路径提示词自适应**（:314-331）

```typescript
const { attachedCount, droppedData } = this.pushCardsWithCharts(result, cards);
// ……citations 不动
const toolSummary = result.success
  ? attachedCount > 0
    ? `查询成功，已生成 ${attachedCount} 张数据卡片。请基于这些卡片中的数据，按照系统提示词中的回答格式规范，给董事长一份针对性的分析与建议。`
    : `查询成功。本次不展示数据卡片：${droppedData.join('；')}。请把这些关键数字自然地写进正文回答（原样引用，不得改动），不要罗列元描述。`
  : `工具调用失败: ${result.error}`;
// directMessages 系统消息末句二选一：
// attachedCount > 0 → 现状「不要罗列数字，卡片已在前端渲染。」
// 否则 → 「数据不挂卡片，请将上述关键数字写进正文。」
```

- [ ] **Step 3: 正常路径**——删除 :415-421 强制补挂块（含日志行）；工具循环 `const { attachedCount, droppedData } = this.pushCardsWithCharts(...)` 累加；早退条件改：

```typescript
if (cards.length === 0 && successCount === 0) {
  return answer.trim() || '抱歉，数据查询失败，请稍后重试或换一种方式提问。';
}
```

toolSummary 头部（overviewText 之前）插：`droppedAll.length ? '【不挂卡片的小结果 —— 关键数字必须原样写进正文】\n' + droppedAll.join('\n') + '\n\n' : ''`（droppedAll 为循环累计数组）。第二轮 LLM 照常（卡空时表格 JSON 段自然为空数组）。

- [ ] **Step 4: 测试** — card-gate.spec 追加两用例：①直派路径 mock 工具返回 2 行小表 → answer 提示词含「不挂卡片」（或直接断言 pushCardsWithCharts 返回值——若服务级 mock 过重，以 card-gate 纯函数 + 代码走查代替，注明）；②`applyCardGate` 对 global_overview 四表（均带 viz）全保留。跑 `npx jest src/assistant --silent`。
- [ ] **Step 5: API tsc → Commit** — `feat(chat3011): 卡片挂载跟随提问——规则闸接线+提示词自适应+删除强制补挂 global_overview`

---

### Task 5: :3011 五类 SVG 渲染器 + chat-card 接线

**Files:**
- Create: `apps/mobile-portal/src/components/m/chart-card-svg.tsx`
- Modify: `apps/mobile-portal/src/lib/api/assistant.ts:18`（chart 分支类型加 `data?`）
- Modify: `apps/mobile-portal/src/components/m/chat-card.tsx:5-12`（chart 分支接渲染器）

- [ ] **Step 1: 类型**——assistant.ts chart 分支：

```typescript
| { type: "chart"; title: string; chartType: string; caption?: string;
   data?: { rows?: Array<Record<string, unknown>>; points?: Array<{ name: string; value: number }>;
            labels?: string[]; series?: Array<{ name: string; values: number[] }>; total?: number };
   [k: string]: unknown };
```

- [ ] **Step 2: 渲染器**（完整实现，dataviz 规范：细 mark/直接标签/2px 间隙/reduced-motion 由 CSS 动画类承担、静态图本体无动画）——核心骨架（配色常量与 mapper 同源 8 色 `#2563EB #0891b2 #7dd3fc #0d9488 #6366f1 #3b82f6 #06b6d4 #818cf8`）：

```tsx
const P = ['#2563EB', '#0891b2', '#7dd3fc', '#0d9488', '#6366f1', '#3b82f6', '#06b6d4', '#818cf8'];
const fmt = (n: number) => (n >= 10000 ? `${(n / 10000).toFixed(1)}万` : String(n));

export function ChartCardSvg({ card }: { card: ChartCard }) {
  const d = card.data;
  if (!d) return <ChartStub card={card} />; // 存量历史卡回退占位
  if (card.chartType === 'pie') return <PieChart points={d.points ?? []} total={d.total} />;
  if (card.chartType === 'line') return <LineChart labels={d.labels ?? []} points={d.points ?? []} />;
  if (card.chartType === 'grouped_bar') return <GroupedBar labels={d.labels ?? []} series={d.series ?? []} />;
  if (card.chartType === 'hbar') return <HBarChart points={d.points ?? []} />;
  return <BarChart points={d.points ?? []} />;
}
```

五个子组件（每个 40-60 行手写 SVG，375px 宽基准 viewBox）：
- `PieChart`：donut（stroke-dasharray 弧段，`stroke-width 26`、段间 2px 白隙）、中心 total、右侧图例（色点+名+值；>5 类图例纵排滚动区）
- `BarChart`：竖柱降序、柱顶值直接标签、x 轴名截断 4 字、首柱强调色其余 `P` 循环、柱宽 ≤44、4px 顶部圆角
- `HBarChart`：横柱降序（首行排名前缀 `1.`）、右端值标签、名左对齐截断、行高 24
- `LineChart`：时间升序折线（2px stroke、≥8px 端点）、最高点强调+标签、x 标签抽稀（每 2 个显 1）
- `GroupedBar`：分组柱、组内 2 系 `P[0]/P[1]`、顶部图例横排、组间 2px 间隙
- `ChartStub`：现状占位文案（原 :5-12 分支平移）

- [ ] **Step 3: chat-card.tsx 接线**——chart 分支改 `<ChartCardSvg card={card} />`（外框 m-tile + title + caption 结构留在渲染器内，与表卡同款）。
- [ ] **Step 4: 门禁** — `npx tsc --noEmit && pnpm lint`（0 error）`&& pnpm build`。
- [ ] **Step 5: Commit** — `feat(chat3011): 移动端五类图卡真实渲染——手写 SVG 消费自包含 data`

---

### Task 6: 回归 + 文档

- [ ] **Step 1: 后端** `npx jest src/assistant --silent` 全绿（含既有 21 用例回归）；`npx tsc --noEmit`。
- [ ] **Step 2: 前端三闸** + 手动冒烟（五类各问一次）：「哪个阶段最堵」→柱图；「节资排名」→横柱；「本月成交额」→metric 卡；随口追问→纯文字；「各公司对比」→分组柱。
- [ ] **Step 3: spec 补记**（data 派生序列字段说明并入 2026-11-03 spec §3.1）+ CLAUDE.md :3011 行追加一句。Commit：`docs(chat3011): 图卡 data 契约补记 + CLAUDE.md 摘要`。

## Self-Review

- 覆盖：spec §3.1→T2、§3.2→T3、§3.3→T1+T4、§3.4→T4、§3.5→T5、§6→各任务步骤+T6 ✓
- 类型一致：`applyCardGate` T1 定义 T4 消费；`data.points/labels/series/total` T2 产出 T5 消费同名 ✓
- 已知留白：T4 Step 4 服务级用例允许以纯函数断言+走查替代（服务 spec mock 重，注明即可）——非占位符而是明确的双轨验收。
