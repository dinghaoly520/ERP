import type { VizDeclaration } from './tools/assistant-tool';

/** 品牌蓝系配色（循环使用） */
const PALETTE = [
  '#2563EB', '#0891b2', '#7dd3fc', '#0d9488', '#6366f1',
  '#3b82f6', '#06b6d4', '#818cf8',
];

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
  const { viz, rows, title } = table;

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
  if (n < 2) return null;

  const data = rows.map((r) => ({
    name: String(r[catKey] ?? '-'),
    value: num(r[valKey]),
  }));

  if (n <= 5) {
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
        ...(useHbar ? {} : { data: shown.map((d) => d.name) }),
        axisLabel: { fontSize: 12 },
      },
      yAxis: {
        type: useHbar ? 'category' : 'value',
        ...(useHbar ? { data: shown.map((d) => d.name).reverse() } : {}),
        axisLabel: { fontSize: 12 },
      },
      series: [
        {
          type: 'bar',
          data: useHbar
            ? shown.map((d) => d.value).reverse()
            : shown.map((d) => d.value),
          itemStyle: {
            color: PALETTE[0],
            borderRadius: useHbar ? [0, 4, 4, 0] : [4, 4, 0, 0],
          },
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
        style: {
          text: `共 ${total}`,
          textAlign: 'center',
          fontSize: 16,
          fontWeight: 'bold',
        },
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

  const categories = [...new Set(rows.map((r) => String(r[catKey] ?? '-')))];
  const seriesNames = [...new Set(rows.map((r) => String(r[seriesKey] ?? '-')))];

  if (categories.length < 2 || seriesNames.length < 2) return null;

  const series = seriesNames.map((sName) => ({
    name: sName,
    type: 'bar' as const,
    data: categories.map((cat) => {
      const row = rows.find(
        (r) =>
          String(r[catKey] ?? '-') === cat &&
          String(r[seriesKey] ?? '-') === sName,
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
