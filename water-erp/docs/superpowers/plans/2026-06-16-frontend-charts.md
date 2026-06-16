# 前端交互式图表 — 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用数据驱动的 ECharts 前端图表替代 Python 沙箱方案。数据工具声明可视化形态，映射器确定选图，前端 ECharts 交互式渲染。

**Architecture:** 三层 —— 数据工具返回 table + `viz` 声明；后端纯函数映射器 `mapToChartOption` 根据 `viz.kind` 和数据形状生成 ECharts option；前端 `ChartRenderer` 渲染。LLM 不参与画图。删除整套 Python 沙箱链路。

**Tech Stack:** NestJS 11 + Prisma（后端），Next.js 16 + ECharts 5 + echarts-for-react（前端）

---

## Task 1: 安装 ECharts 依赖

**Files:**
- Modify: `apps/assistant/package.json`

- [ ] **Step 1: 安装 echarts 和 echarts-for-react**

```bash
cd /Users/qihao/Desktop/ERP/water-erp
pnpm --filter assistant add echarts echarts-for-react
```

- [ ] **Step 2: 验证安装**

```bash
grep -E "echarts" apps/assistant/package.json
```

Expected: 输出包含 `"echarts": "^5"` 和 `"echarts-for-react": "^3"`

- [ ] **Step 3: Commit**

```bash
git add apps/assistant/package.json pnpm-lock.yaml
git commit -m "chore(assistant): add echarts + echarts-for-react dependencies

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 2: 定义 viz 类型（前后端）

**Files:**
- Modify: `apps/api/src/assistant/tools/assistant-tool.ts`
- Modify: `apps/assistant/src/lib/types.ts`

### Step 1: 后端 assistant-tool.ts — 扩展 ToolResult 的 table card 加 viz 字段

读取 `apps/api/src/assistant/tools/assistant-tool.ts`，将 cards 数组类型改为：

```typescript
export interface ToolResult {
  success: boolean;
  data?: unknown;
  error?: string;
  cards?: Array<
    | {
        type: 'metric' | 'table';
        title: string;
        [key: string]: unknown;
      }
    | {
        type: 'chart';
        title: string;
        chartType: 'bar' | 'line' | 'pie' | 'hbar' | 'grouped_bar';
        option: Record<string, unknown>;
        caption?: string;
      }
  >;
  citations?: Array<{
    type: string;
    title: string;
    entityId: string;
  }>;
}

/** 可视化声明 —— 数据工具附带，告诉映射器如何画图 */
export interface VizDeclaration {
  kind: 'distribution' | 'composition' | 'trend' | 'ranking' | 'comparison';
  /** 分类/实体字段名（distribution / ranking / comparison） */
  category?: string;
  /** 数值字段名 */
  value: string;
  /** 时间字段名（trend） */
  timeField?: string;
  /** 分组字段名（comparison） */
  seriesField?: string;
  /** 排名只取前 N（ranking） */
  topN?: number;
}
```

注意：chart card 的字段从 `imageUrl` 改为 `option`（ECharts 配置对象）。

- [ ] **Step 2: 验证后端编译**

```bash
cd /Users/qihao/Desktop/ERP/water-erp && npx tsc --noEmit --project apps/api/tsconfig.json 2>&1 | grep -v "baseUrl\|migration information" | head -10
```

Expected: 无新错误（可能有 assistant.service.ts 因 imageUrl 变 option 的错误，Task 3 会修复）

### Step 3: 前端 types.ts — 更新 AssistantCard 的 chart 类型

读取 `apps/assistant/src/lib/types.ts`，将 chart 分支改为：

```typescript
export type AssistantCard =
  | { type: 'metric'; title: string; value: string; trend?: string }
  | {
      type: 'chart';
      title: string;
      chartType: 'bar' | 'line' | 'pie' | 'hbar' | 'grouped_bar';
      option: Record<string, unknown>;
      caption?: string;
    }
  | {
      type: 'table';
      title: string;
      columns: Array<{ key: string; label: string }>;
      rows: unknown[];
      viz?: import('./viz-types').VizDeclaration;
    }
  | {
      type: 'actionPlan';
      title: string;
      riskLevel: string;
      actionId: string;
      changes: unknown[];
    };
```

并创建 `apps/assistant/src/lib/viz-types.ts`：

```typescript
export interface VizDeclaration {
  kind: 'distribution' | 'composition' | 'trend' | 'ranking' | 'comparison';
  category?: string;
  value: string;
  timeField?: string;
  seriesField?: string;
  topN?: number;
}
```

- [ ] **Step 4: 验证前端编译**

```bash
npx tsc --noEmit --project apps/assistant/tsconfig.json 2>&1 | head -10
```

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/assistant/tools/assistant-tool.ts apps/assistant/src/lib/types.ts apps/assistant/src/lib/viz-types.ts
git commit -m "feat: define viz declaration + chart option types (frontend + backend)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 3: 创建后端可视化映射器

**Files:**
- Create: `apps/api/src/assistant/chart.mapper.ts`
- Create: `apps/api/src/assistant/chart.mapper.spec.ts`

这是核心纯函数，输入 `{title, columns, rows, viz}`，输出 chart card 或 null。

### Step 1: 创建 chart.mapper.ts

```typescript
// apps/api/src/assistant/chart.mapper.ts
import type { VizDeclaration } from './tools/assistant-tool';

/** 品牌蓝系配色（循环使用） */
const PALETTE = ['#2563EB', '#0891b2', '#7dd3fc', '#0d9488', '#6366f1', '#3b82f6', '#06b6d4', '#818cf8'];

/** chart card 输出类型 */
export interface ChartCard {
  type: 'chart';
  title: string;
  chartType: 'bar' | 'line' | 'pie' | 'hbar' | 'grouped_bar';
  option: Record<string, unknown>;
  caption?: string;
}

interface TableLike {
  title: string;
  columns: Array<{ key: string; label: string }>;
  rows: Array<Record<string, unknown>>;
  viz?: VizDeclaration;
}

/**
 * 将带 viz 声明的 table 映射为 ECharts chart card。
 * 无 viz 或数据不足时返回 null（调用方应只渲染表格）。
 */
export function mapToChart(table: TableLike): ChartCard | null {
  const { viz, rows, columns, title } = table;

  if (!viz || rows.length === 0) return null;

  switch (viz.kind) {
    case 'distribution':
      return mapDistribution(title, rows, viz);
    case 'composition':
      return mapComposition(title, rows, viz);
    case 'trend':
      return mapTrend(title, rows, viz);
    case 'ranking':
      return mapRanking(title, rows, viz);
    case 'comparison':
      return mapComparison(title, rows, viz);
    default:
      return null;
  }
}

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** distribution: ≤5类→饼图；6-12→竖柱；>12→横柱top10 */
function mapDistribution(
  title: string,
  rows: Array<Record<string, unknown>>,
  viz: VizDeclaration,
): ChartCard | null {
  const catKey = viz.category || 'name';
  const valKey = viz.value;
  const n = rows.length;
  if (n < 2) return null; // 单一分类不出图

  const data = rows.map((r) => ({
    name: String(r[catKey] ?? '-'),
    value: num(r[valKey]),
  }));

  if (n <= 5) {
    // 饼图
    return {
      type: 'chart',
      title,
      chartType: 'pie',
      option: {
        tooltip: { trigger: 'item', formatter: '{b}: {c} ({d}%)' },
        legend: { bottom: 0, type: 'scroll' },
        series: [
          {
            type: 'pie',
            radius: ['38%', '68%'],
            center: ['50%', '45%'],
            data,
            label: { formatter: '{b}\n{d}%', fontSize: 12 },
            itemStyle: { borderColor: '#fff', borderWidth: 2 },
            color: PALETTE,
          },
        ],
      },
    };
  }

  // 柱状图（降序）
  const sorted = [...data].sort((a, b) => b.value - a.value);
  const useHbar = n > 12;
  const shown = useHbar ? sorted.slice(0, 10) : sorted;

  return {
    type: 'chart',
    title,
    chartType: useHbar ? 'hbar' : 'bar',
    option: {
      tooltip: { trigger: 'axis' },
      grid: { left: '3%', right: '6%', bottom: '3%', top: '8%', containLabel: true },
      xAxis: {
        type: useHbar ? 'value' : 'category',
        data: useHbar ? undefined : shown.map((d) => d.name),
        axisLabel: { fontSize: 12 },
      },
      yAxis: {
        type: useHbar ? 'category' : 'value',
        data: useHbar ? shown.map((d) => d.name).reverse() : undefined,
        axisLabel: { fontSize: 12 },
      },
      series: [
        {
          type: useHbar ? 'bar' : 'bar',
          data: useHbar ? shown.map((d) => d.value).reverse() : shown.map((d) => d.value),
          itemStyle: { color: PALETTE[0], borderRadius: useHbar ? [0, 4, 4, 0] : [4, 4, 0, 0] },
          label: { show: true, position: useHbar ? 'right' : 'top', fontSize: 11 },
          barMaxWidth: 36,
        },
      ],
      color: PALETTE,
    },
  };
}

/** composition: 环形饼图，中心显示总数 */
function mapComposition(
  title: string,
  rows: Array<Record<string, unknown>>,
  viz: VizDeclaration,
): ChartCard | null {
  const catKey = viz.category || 'name';
  const data = rows.map((r) => ({
    name: String(r[catKey] ?? '-'),
    value: num(r[viz.value]),
  }));
  if (data.length < 2) return null;

  const total = data.reduce((s, d) => s + d.value, 0);

  return {
    type: 'chart',
    title,
    chartType: 'pie',
    option: {
      tooltip: { trigger: 'item', formatter: '{b}: {c} ({d}%)' },
      legend: { bottom: 0, type: 'scroll' },
      graphic: {
        type: 'text',
        left: 'center',
        top: '38%',
        style: { text: `共 ${total}`, textAlign: 'center', fontSize: 16, fontWeight: 'bold' },
      },
      series: [
        {
          type: 'pie',
          radius: ['52%', '72%'],
          center: ['50%', '45%'],
          data,
          label: { formatter: '{b}\n{d}%', fontSize: 12 },
          itemStyle: { borderColor: '#fff', borderWidth: 2 },
          color: PALETTE,
        },
      ],
    },
  };
}

/** trend: 折线图，x 轴按时间字段排序 */
function mapTrend(
  title: string,
  rows: Array<Record<string, unknown>>,
  viz: VizDeclaration,
): ChartCard | null {
  const timeKey = viz.timeField || 'time';
  const sorted = [...rows].sort((a, b) =>
    String(a[timeKey] ?? '').localeCompare(String(b[timeKey] ?? '')),
  );
  if (sorted.length < 2) return null;

  return {
    type: 'chart',
    title,
    chartType: 'line',
    option: {
      tooltip: { trigger: 'axis' },
      grid: { left: '3%', right: '6%', bottom: '3%', top: '8%', containLabel: true },
      xAxis: {
        type: 'category',
        data: sorted.map((r) => String(r[timeKey] ?? '-')),
        boundaryGap: false,
        axisLabel: { fontSize: 12 },
      },
      yAxis: { type: 'value', axisLabel: { fontSize: 12 } },
      series: [
        {
          type: 'line',
          smooth: true,
          data: sorted.map((r) => num(r[viz.value])),
          symbol: 'circle',
          symbolSize: 7,
          lineStyle: { width: 2.5, color: PALETTE[0] },
          itemStyle: { color: PALETTE[0] },
          areaStyle: { opacity: 0.12 },
          label: { show: true, fontSize: 11 },
        },
      ],
      color: PALETTE,
    },
  };
}

/** ranking: 横向柱状图降序，top N */
function mapRanking(
  title: string,
  rows: Array<Record<string, unknown>>,
  viz: VizDeclaration,
): ChartCard | null {
  const catKey = viz.category || 'name';
  const topN = viz.topN || 10;
  const sorted = [...rows]
    .map((r) => ({ name: String(r[catKey] ?? '-'), value: num(r[viz.value]) }))
    .sort((a, b) => b.value - a.value)
    .slice(0, topN);
  if (sorted.length < 2) return null;

  // 横向柱: ECharts 从下往上画，需 reverse 让最大值在顶部
  const reversed = [...sorted].reverse();

  return {
    type: 'chart',
    title,
    chartType: 'hbar',
    option: {
      tooltip: { trigger: 'axis' },
      grid: { left: '3%', right: '10%', bottom: '3%', top: '8%', containLabel: true },
      xAxis: { type: 'value', axisLabel: { fontSize: 12 } },
      yAxis: {
        type: 'category',
        data: reversed.map((d) => d.name),
        axisLabel: { fontSize: 12 },
      },
      series: [
        {
          type: 'bar',
          data: reversed.map((d) => d.value),
          itemStyle: { color: PALETTE[0], borderRadius: [0, 4, 4, 0] },
          label: { show: true, position: 'right', fontSize: 11 },
          barMaxWidth: 28,
        },
      ],
      color: PALETTE,
    },
  };
}

/** comparison: 分组柱状图 */
function mapComparison(
  title: string,
  rows: Array<Record<string, unknown>>,
  viz: VizDeclaration,
): ChartCard | null {
  const catKey = viz.category || 'name';
  const seriesKey = viz.seriesField;
  if (!seriesKey) return null;

  // 收集所有类别和分组
  const categories = [...new Set(rows.map((r) => String(r[catKey] ?? '-')))];
  const seriesNames = [...new Set(rows.map((r) => String(r[seriesKey] ?? '-')))];

  if (categories.length < 2 || seriesNames.length < 2) return null;

  const series = seriesNames.map((sName, idx) => ({
    name: sName,
    type: 'bar' as const,
    data: categories.map((cat) => {
      const row = rows.find(
        (r) => String(r[catKey] ?? '-') === cat && String(r[seriesKey] ?? '-') === sName,
      );
      return row ? num(row[viz.value]) : 0;
    }),
    itemStyle: { borderRadius: [4, 4, 0, 0] },
  }));

  return {
    type: 'chart',
    title,
    chartType: 'grouped_bar',
    option: {
      tooltip: { trigger: 'axis' },
      legend: { bottom: 0, type: 'scroll' },
      grid: { left: '3%', right: '6%', bottom: '12%', top: '8%', containLabel: true },
      xAxis: { type: 'category', data: categories, axisLabel: { fontSize: 12 } },
      yAxis: { type: 'value', axisLabel: { fontSize: 12 } },
      series,
      color: PALETTE,
    },
  };
}
```

### Step 2: 创建单元测试 chart.mapper.spec.ts

```typescript
// apps/api/src/assistant/chart.mapper.spec.ts
import { mapToChart } from './chart.mapper';

describe('mapToChart', () => {
  const baseTable = {
    title: '测试',
    columns: [{ key: 'name', label: '名称' }, { key: 'count', label: '数量' }],
  };

  it('returns null when no viz', () => {
    expect(mapToChart({ ...baseTable, rows: [{ name: 'A', count: 1 }] })).toBeNull();
  });

  it('returns null when rows empty', () => {
    expect(mapToChart({ ...baseTable, rows: [], viz: { kind: 'distribution', value: 'count', category: 'name' } })).toBeNull();
  });

  it('returns null for single category distribution', () => {
    expect(mapToChart({
      ...baseTable,
      rows: [{ name: 'A', count: 5 }],
      viz: { kind: 'distribution', value: 'count', category: 'name' },
    })).toBeNull();
  });

  it('distribution ≤5 categories → pie chart', () => {
    const result = mapToChart({
      ...baseTable,
      rows: [{ name: 'A', count: 3 }, { name: 'B', count: 2 }, { name: 'C', count: 1 }],
      viz: { kind: 'distribution', value: 'count', category: 'name' },
    });
    expect(result?.chartType).toBe('pie');
    expect(result?.option).toBeDefined();
  });

  it('distribution >5 categories → bar chart, sorted descending', () => {
    const result = mapToChart({
      ...baseTable,
      rows: [
        { name: 'A', count: 1 }, { name: 'B', count: 5 }, { name: 'C', count: 3 },
        { name: 'D', count: 2 }, { name: 'E', count: 4 }, { name: 'F', count: 6 },
      ],
      viz: { kind: 'distribution', value: 'count', category: 'name' },
    });
    expect(result?.chartType).toBe('bar');
    const xData = (result!.option.xAxis as any).data;
    expect(xData[0]).toBe('F'); // 最大值排第一
  });

  it('distribution >12 categories → hbar, top 10', () => {
    const rows = Array.from({ length: 15 }, (_, i) => ({ name: `项${i}`, count: 15 - i }));
    const result = mapToChart({
      ...baseTable,
      rows,
      viz: { kind: 'distribution', value: 'count', category: 'name' },
    });
    expect(result?.chartType).toBe('hbar');
  });

  it('trend sorts by time and returns line', () => {
    const result = mapToChart({
      title: '月度趋势',
      columns: [{ key: 'month', label: '月份' }, { key: 'count', label: '数量' }],
      rows: [
        { month: '2026-03', count: 5 }, { month: '2026-01', count: 3 }, { month: '2026-02', count: 4 },
      ],
      viz: { kind: 'trend', value: 'count', timeField: 'month' },
    });
    expect(result?.chartType).toBe('line');
    const xData = (result!.option.xAxis as any).data;
    expect(xData).toEqual(['2026-01', '2026-02', '2026-03']);
  });

  it('ranking returns hbar sorted descending, capped at topN', () => {
    const rows = Array.from({ length: 15 }, (_, i) => ({ name: `供应商${i}`, count: 20 - i }));
    const result = mapToChart({
      ...baseTable,
      rows,
      viz: { kind: 'ranking', value: 'count', category: 'name', topN: 5 },
    });
    expect(result?.chartType).toBe('hbar');
    const yData = (result!.option.yAxis as any).data;
    expect(yData.length).toBe(5);
  });

  it('comparison requires seriesField, returns grouped_bar', () => {
    const result = mapToChart({
      title: '部门对比',
      columns: [{ key: 'dept', label: '部门' }, { key: 'status', label: '状态' }, { key: 'count', label: '数量' }],
      rows: [
        { dept: 'A部门', status: '已通过', count: 5 }, { dept: 'A部门', status: '待审核', count: 2 },
        { dept: 'B部门', status: '已通过', count: 3 }, { dept: 'B部门', status: '待审核', count: 4 },
      ],
      viz: { kind: 'comparison', value: 'count', category: 'dept', seriesField: 'status' },
    });
    expect(result?.chartType).toBe('grouped_bar');
    expect((result!.option.series as any[]).length).toBe(2);
  });
});
```

### Step 3: 运行测试

```bash
cd /Users/qihao/Desktop/ERP/water-erp && pnpm --filter api test -- chart.mapper 2>&1 | tail -20
```

Expected: 8 个测试全部通过

### Step 4: Commit

```bash
git add apps/api/src/assistant/chart.mapper.ts apps/api/src/assistant/chart.mapper.spec.ts
git commit -m "feat(api): add chart.mapper — deterministic data-to-ECharts mapping

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 4: 集成映射器到 AssistantService，删除 Python 链路

**Files:**
- Modify: `apps/api/src/assistant/assistant.service.ts`
- Modify: `apps/api/src/assistant/assistant.module.ts`

### Step 1: 删除 PythonSandbox 注入和所有图表相关代码

读取 `apps/api/src/assistant/assistant.service.ts`，做以下删除：
1. 删除 `import { PythonSandboxService } from './python-sandbox.service';`
2. 构造函数中删除 `private readonly pythonSandbox: PythonSandboxService,` 参数
3. 删除 `handleNormalChat` 中提取 Python 代码块的整段（从 `// Extract Python code block` 到 `}` 结束的 if 块，约 lines 277-301）
4. 删除三个私有方法 `inferChartTitle`、`inferChartType`、`inferChartCaption`

### Step 2: 新增映射器调用 —— 在工具执行后、第二次模型调用前

在 `handleNormalChat` 中，找到工具执行后收集 cards 的代码段：

```typescript
const result = await tool.execute(toolCall.args || {});
if (result.success && result.cards) {
  for (const c of result.cards) cards.push(c);
}
```

改为（对每个 table card 检查 viz 声明，生成对应 chart card）：

```typescript
const result = await tool.execute(toolCall.args || {});
if (result.success && result.cards) {
  for (const c of result.cards) {
    cards.push(c);
    // 若 table 带 viz 声明，生成对应图表
    if (c.type === 'table' && (c as any).viz) {
      const chartCard = mapToChart({
        title: c.title,
        columns: c.columns,
        rows: c.rows,
        viz: (c as any).viz,
      });
      if (chartCard) cards.push(chartCard);
    }
  }
}
```

在文件顶部加 import：
```typescript
import { mapToChart } from './chart.mapper';
```

### Step 3: 从 AssistantModule 删除 PythonSandboxService

读取 `apps/api/src/assistant/assistant.module.ts`，删除：
1. `import { PythonSandboxService } from './python-sandbox.service';`
2. providers 数组中的 `PythonSandboxService,`

### Step 4: 验证编译

```bash
cd /Users/qihao/Desktop/ERP/water-erp && npx tsc --noEmit --project apps/api/tsconfig.json 2>&1 | grep -v "baseUrl\|migration information" | head -10
```

Expected: 无新错误

### Step 5: Commit

```bash
git add apps/api/src/assistant/assistant.service.ts apps/api/src/assistant/assistant.module.ts
git commit -m "feat(api): integrate chart.mapper into chat flow, remove Python sandbox injection

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 5: 删除 Python 沙箱文件和系统提示词图表规则

**Files:**
- Delete: `apps/api/src/assistant/python-sandbox.service.ts`
- Delete: `apps/api/src/assistant/python-sandbox.service.spec.ts`
- Modify: `apps/api/src/assistant/knowledge/system-knowledge.ts`

### Step 1: 删除沙箱文件

```bash
rm apps/api/src/assistant/python-sandbox.service.ts
rm apps/api/src/assistant/python-sandbox.service.spec.ts
```

### Step 2: 从系统提示词删除图表生成规则

读取 `apps/api/src/assistant/knowledge/system-knowledge.ts`，删除末尾的整个 `【图表生成规则】` 段落（从 `\n【图表生成规则】` 开始到该段结束，大约是文件最后 15 行）。

保留文件最后的 `\n\`;` 结尾。

### Step 3: 验证编译

```bash
cd /Users/qihao/Desktop/ERP/water-erp && npx tsc --noEmit --project apps/api/tsconfig.json 2>&1 | grep -v "baseUrl\|migration information" | head -10
```

Expected: 无错误

### Step 4: Commit

```bash
git add -A apps/api/src/assistant/
git commit -m "refactor(api): remove Python sandbox + chart prompt rules

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 6: 创建前端 ChartRenderer 组件 + ECharts 主题

**Files:**
- Create: `apps/assistant/src/components/chart-renderer.tsx`
- Create: `apps/assistant/src/lib/echarts-theme.ts`

### Step 1: 创建 ECharts 主题文件

```typescript
// apps/assistant/src/lib/echarts-theme.ts
import type { EChartsOption } from 'echarts';

/** 品牌蓝系配色（与后端 PALETTE 一致） */
export const CHART_PALETTE = [
  '#2563EB', '#0891b2', '#7dd3fc', '#0d9488', '#6366f1',
  '#3b82f6', '#06b6d4', '#818cf8',
];

/** 全局基础配置 —— 与后端 option 合并 */
export const BASE_OPTION: Partial<EChartsOption> = {
  textStyle: {
    fontFamily:
      '"PingFang SC", "Microsoft YaHei", "Heiti SC", "Noto Sans CJK SC", sans-serif',
  },
  grid: {
    left: '3%',
    right: '6%',
    bottom: '3%',
    top: '10%',
    containLabel: true,
  },
  tooltip: {
    backgroundColor: 'rgba(255,255,255,0.96)',
    borderColor: 'rgba(201,217,239,0.6)',
    borderWidth: 1,
    textStyle: { color: '#1a2332', fontSize: 12 },
    extraCssText: 'box-shadow: 0 4px 16px rgba(19,36,62,0.1); border-radius: 8px;',
  },
  color: CHART_PALETTE,
};
```

### Step 2: 创建 ChartRenderer 组件

```typescript
// apps/assistant/src/components/chart-renderer.tsx
'use client';

import { useEffect, useRef, useState } from 'react';
import * as echarts from 'echarts';
import { BASE_OPTION } from '@/lib/echarts-theme';

export function ChartRenderer({
  option,
  height = 280,
}: {
  option: Record<string, unknown>;
  height?: number;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<echarts.ECharts | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!containerRef.current) return;

    try {
      if (!chartRef.current) {
        chartRef.current = echarts.init(containerRef.current);
      }
      // 合并主题基础配置
      const merged = { ...BASE_OPTION, ...option };
      chartRef.current.setOption(merged, true);
      setError(false);
    } catch {
      setError(true);
    }

    return () => {};
  }, [option]);

  // 自适应宽度
  useEffect(() => {
    const handleResize = () => chartRef.current?.resize();
    window.addEventListener('resize', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
      chartRef.current?.dispose();
      chartRef.current = null;
    };
  }, []);

  if (error) {
    return (
      <div
        style={{
          height,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--text-muted)',
          fontSize: 'var(--font-xs)',
        }}
      >
        图表加载失败
      </div>
    );
  }

  return <div ref={containerRef} style={{ width: '100%', height }} />;
}
```

### Step 3: 验证编译

```bash
cd /Users/qihao/Desktop/ERP/water-erp && npx tsc --noEmit --project apps/assistant/tsconfig.json 2>&1 | head -10
```

Expected: 无错误

### Step 4: Commit

```bash
git add apps/assistant/src/components/chart-renderer.tsx apps/assistant/src/lib/echarts-theme.ts
git commit -m "feat(assistant): add ChartRenderer component + ECharts theme

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 7: 更新 DataCanvas 渲染 chart 卡片（用 ChartRenderer 替代 img）

**Files:**
- Modify: `apps/assistant/src/components/data-canvas.tsx`

### Step 1: 更新 chart card 渲染分支

读取 `apps/assistant/src/components/data-canvas.tsx`。当前 chart 分支用 `<img src={card.imageUrl}>`。改为用 `ChartRenderer`。

1. 顶部加 import：`import { ChartRenderer } from './chart-renderer';`
2. 移除不再使用的 import：从 `lucide-react` 移除 `Maximize2`、`Download`（chart 不再用图片，不需要下载/放大按钮 —— 前端图本身可交互）。保留 `BarChart3`（空状态用）。
3. 替换 chart 分支的 JSX：

将现有的 chart card JSX（从 `if (card.type === 'chart')` 到对应的 `</div>` 闭合）替换为：

```tsx
          if (card.type === 'chart') {
            return (
              <div key={`chart-${i}`} className={styles.chartCard}>
                {card.title && (
                  <div className={styles.chartTitle}>{card.title}</div>
                )}
                <div className={styles.chartBody}>
                  <ChartRenderer
                    option={card.option}
                    height={card.chartType === 'pie' ? 260 : 280}
                  />
                </div>
                {card.caption && (
                  <div className={styles.chartCaption}>{card.caption}</div>
                )}
              </div>
            );
          }
```

### Step 2: 更新 CSS —— 替换图片相关样式为图表容器样式

读取 `apps/assistant/src/components/data-canvas.module.css`。删除 `.chartImage`、`.chartOverlay`、`.chartToolBtn` 样式。新增 `.chartBody`：

```css
.chartBody {
  padding: 8px 12px 12px;
}
```

将 `.chartCard` 的 `cursor: pointer` 和 hover transform 删除（不再可点击放大）：

```css
.chartCard {
  position: relative;
  z-index: 1;
  border-radius: 14px;
  overflow: hidden;
  background: rgba(255, 255, 255, 0.7);
  border: 1px solid rgba(201, 217, 239, 0.45);
  box-shadow: 0 1px 4px rgba(19, 36, 62, 0.03);
}
```

### Step 3: 验证编译

```bash
cd /Users/qihao/Desktop/ERP/water-erp && npx tsc --noEmit --project apps/assistant/tsconfig.json 2>&1 | head -10
```

Expected: 无错误

### Step 4: Commit

```bash
git add apps/assistant/src/components/data-canvas.tsx apps/assistant/src/components/data-canvas.module.css
git commit -m "feat(assistant): render chart cards with ChartRenderer instead of images

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 8: 移除 ChartLightbox（前端图本身可交互，不再需要灯箱）

**Files:**
- Delete: `apps/assistant/src/components/chart-lightbox.tsx`
- Delete: `apps/assistant/src/components/chart-lightbox.module.css`
- Modify: `apps/assistant/src/components/chat-workspace.tsx`

### Step 1: 删除灯箱文件

```bash
rm apps/assistant/src/components/chart-lightbox.tsx
rm apps/assistant/src/components/chart-lightbox.module.css
```

### Step 2: 从 ChatWorkspace 移除灯箱引用

读取 `apps/assistant/src/components/chat-workspace.tsx`：
1. 删除 `import { ChartLightbox } from './chart-lightbox';`
2. 删除 `const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);`
3. 删除 `handleChartDownload` 函数
4. DataCanvas 的 props 中删除 `onChartClick={setLightboxUrl}` 和 `onChartDownload={handleChartDownload}`（DataCanvas 已不再传这些，Task 7 已移除）
5. 删除末尾的 `<ChartLightbox imageUrl={lightboxUrl} onClose={() => setLightboxUrl(null)} />`

如果 `useState` 不再使用，从 import 中移除。

### Step 3: 验证编译

```bash
cd /Users/qihao/Desktop/ERP/water-erp && npx tsc --noEmit --project apps/assistant/tsconfig.json 2>&1 | head -10
```

Expected: 无错误

### Step 4: Commit

```bash
git add -A apps/assistant/src/components/
git commit -m "refactor(assistant): remove ChartLightbox (frontend charts are interactive)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 9: 给数据工具补 viz 声明

**Files:**
- Modify: `apps/api/src/assistant/tools/global-overview.tool.ts`
- Modify: `apps/api/src/assistant/tools/bid.tool.ts`
- Modify: `apps/api/src/assistant/tools/procurement.tool.ts`
- Modify: `apps/api/src/assistant/tools/supplier.tool.ts`
- Modify: `apps/api/src/assistant/tools/expert.tool.ts`
- Modify: `apps/api/src/assistant/tools/announcement.tool.ts`
- Modify: `apps/api/src/assistant/tools/mall.tool.ts`

对每个工具的分布/统计类 table card，添加 `viz` 字段。规则：
- 状态/阶段/类别 + 数量 → `viz: { kind: 'distribution', category: '<key>', value: 'count' }`
- 专业方向分布 → `distribution`
- 概览统计表（统计项+数值）→ **不加 viz**（这不是分布数据，是 KPI 列表，不适合画图）

### 具体改动示例（global-overview.tool.ts）

读取文件，对以下 table cards 加 viz：

1. **采购项目状态分布**（已有，rows 有 status/count/budget）：
```typescript
{
  type: 'table',
  title: '采购项目状态分布',
  columns: [...],
  rows: [...],
  viz: { kind: 'distribution', category: 'status', value: 'count' },
}
```

2. **招标项目阶段分布**：
```typescript
viz: { kind: 'distribution', category: 'stage', value: 'count' },
```

3. **供应商状态分布**：
```typescript
viz: { kind: 'distribution', category: 'status', value: 'count' },
```

4. **专家专业方向分布**：
```typescript
viz: { kind: 'distribution', category: 'specialty', value: 'count' },
```

5. **全局概览统计**（统计项+数值+备注）→ **不加 viz**

### bid.tool.ts

- `stats` action 的"招标项目阶段分布" → `viz: { kind: 'distribution', category: 'stage', value: 'count' }`
- `active`/`risks` action 的项目列表表（projectCode/name/stage/...）→ **不加 viz**（明细列表，不适合画图）

### procurement.tool.ts

- `stats` action 的"采购项目统计"（status/count/budget）→ `viz: { kind: 'distribution', category: 'status', value: 'count' }`

### supplier.tool.ts

- `stats` action 的"供应商状态分布" → `viz: { kind: 'distribution', category: 'status', value: 'count' }`

### expert.tool.ts

- `stats` action 的"专业方向分布" → `viz: { kind: 'distribution', category: 'specialty', value: 'count' }`
- "专家资源概览"（统计项+数值）→ **不加 viz**

### announcement.tool.ts

- `stats` action 的"按类型分布" → `viz: { kind: 'distribution', category: 'type', value: 'count' }`
- "公告概览" → **不加 viz**

### mall.tool.ts

- `stats` action 的"目录类别分布" → `viz: { kind: 'distribution', category: 'category', value: 'count' }`
- "商城概览" → **不加 viz**

### 验证

```bash
cd /Users/qihao/Desktop/ERP/water-erp && npx tsc --noEmit --project apps/api/tsconfig.json 2>&1 | grep -v "baseUrl\|migration information" | head -10
```

### Commit

```bash
git add apps/api/src/assistant/tools/
git commit -m "feat(api): add viz declarations to data tools for chart mapping

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 10: 端到端验证

- [ ] **Step 1: 启动 API**

```bash
cd /Users/qihao/Desktop/ERP/water-erp && pnpm dev:api
```

确认无 PythonSandbox 相关日志（应已消失），无启动错误。

- [ ] **Step 2: 启动助手前端**

```bash
cd /Users/qihao/Desktop/ERP/water-erp && pnpm dev:assistant
```

- [ ] **Step 3: 手动验证**

打开 http://localhost:3008：
1. 点击"全系统数据问答"快捷入口
2. AI 回答后，底部 IndicatorBar 显示卡片数量
3. 点击 IndicatorBar → 数据模式
4. 验证：
   - 表格正常显示（中文标签，无英文）
   - 招标阶段分布、供应商状态分布等出现**交互式 ECharts 图表**（饼图，因 ≤5 类）
   - hover 图表显示 tooltip（数值+百分比）
   - 图例可点击筛选
   - 无 Python 相关错误
   - 无图片加载失败
5. `Cmd+D` 切换对话/数据模式正常

- [ ] **Step 4: 运行全部 API 测试**

```bash
cd /Users/qihao/Desktop/ERP/water-erp && pnpm --filter api test 2>&1 | tail -20
```

Expected: 全部通过（含 chart.mapper 8 个 + 其他现有测试）

- [ ] **Step 5: Commit（如有验证修复）**

```bash
git add -A
git commit -m "test: end-to-end verification of frontend charts" --allow-empty
```

---

## 任务依赖关系

```
Task 1 (deps) ──> Task 6 (ChartRenderer) ──┐
                                           v
Task 2 (types) ──> Task 3 (mapper) ──> Task 4 (service) ──> Task 7 (DataCanvas) ──> Task 8 (remove lightbox)
                       │                          │
                       │                          v
                       │                     Task 5 (remove python)
                       │
                       v
                  Task 9 (viz declarations)

Task 10 (verification) — 最后
```

## 验证清单

- [ ] `pnpm --filter api build` — API 编译通过
- [ ] `pnpm --filter assistant build` — 前端编译通过
- [ ] `pnpm --filter api test` — 全部测试通过（含 chart.mapper）
- [ ] 无 PythonSandboxService 残留引用
- [ ] 数据模式显示交互式 ECharts 图表
- [ ] 图表 hover/图例交互正常
- [ ] 表格中文标签，无英文代码
- [ ] Cmd+D 模式切换正常
