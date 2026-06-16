import type { VizDeclaration } from './tools/assistant-tool';

const P = [
  '#2563EB', '#0891b2', '#7dd3fc', '#0d9488', '#6366f1',
  '#3b82f6', '#06b6d4', '#818cf8',
];
const ACCENT = P[0]; // 强调色 — 用于最大值
const MUTED = 'rgba(148, 163, 184, 0.55)'; // 弱化色 — 用于小值对比

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

export function mapToChart(table: TableLike): ChartCard | null {
  const { viz, title } = table;
  // 排除表格总计行（_total），避免合计值扭曲图表比例
  const rows = table.rows.filter((r) => !(r as Record<string, unknown>)._total);
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

function fmtNum(n: number): string {
  if (n >= 10000) return `${(n / 10000).toFixed(1)}万`;
  return String(n);
}

/* ================================================================
   distribution — 自动选择饼图/柱状图/横柱
   ================================================================ */
function mapDistribution(
  title: string,
  rows: Array<Record<string, unknown>>,
  viz: VizDeclaration,
): ChartCard | null {
  const catKey = viz.category || 'name';
  const n = rows.length;
  if (n < 2) return null;

  const data = rows.map((r) => ({
    name: String(r[catKey] ?? '-'),
    value: num(r[viz.value]),
  }));

  /* 饼图：≤ 5 类 */
  if (n <= 5) {
    const sum = data.reduce((s, d) => s + d.value, 0);
    const sorted = [...data].sort((a, b) => b.value - a.value);
    return {
      type: 'chart',
      title,
      chartType: 'pie',
      caption: `共 ${fmtNum(sum)}，最大占比"${sorted[0].name}"`,
      option: {
        tooltip: { trigger: 'item', formatter: '{b}: {c} ({d}%)' },
        legend: { bottom: 0, itemWidth: 8, itemHeight: 8, itemGap: 16, textStyle: { fontSize: 12 } },
        series: [{
          type: 'pie',
          radius: ['42%', '70%'],
          center: ['50%', '43%'],
          data: sorted,
          label: { formatter: '{b}\n{d}%', fontSize: 12, lineHeight: 18 },
          itemStyle: { borderColor: '#fff', borderWidth: 2 },
          emphasis: { scaleSize: 8, label: { fontSize: 16, fontWeight: 'bold' } },
          color: P,
        }],
      },
    };
  }

  /* 柱图：6-12 类 */
  if (n <= 12) {
    const sorted = [...data].sort((a, b) => b.value - a.value);
    const bars = sorted.map((d, idx) => ({
      value: d.value,
      itemStyle: {
        color: {
          type: 'linear' as const, x: 0, y: 0, x2: 0, y2: 1,
          colorStops: [
            { offset: 0, color: P[idx % P.length] },
            { offset: 1, color: P[(idx + 1) % P.length] },
          ],
        },
        borderRadius: [5, 5, 0, 0],
      },
    }));
    return {
      type: 'chart',
      title,
      chartType: 'bar',
      caption: `${sorted.length} 个类别，最高"${sorted[0].name}"（${fmtNum(sorted[0].value)}）`,
      option: {
        tooltip: { trigger: 'axis' },
        grid: { left: '2%', right: '5%', bottom: '2%', top: '8%', containLabel: true },
        xAxis: {
          type: 'category',
          data: sorted.map((d) => d.name),
          axisLabel: { fontSize: 12, rotate: sorted.length > 8 ? 30 : 0 },
          axisTick: { show: false },
        },
        yAxis: { type: 'value', axisLabel: { fontSize: 12 }, splitLine: { lineStyle: { color: 'rgba(201,217,239,0.3)', type: 'dashed' } } },
        series: [{
          type: 'bar',
          data: bars,
          label: { show: true, position: 'top', fontSize: 11, color: '#5a6d8a' },
          barMaxWidth: sorted.length > 6 ? 32 : 44,
          barGap: '20%',
        }],
        color: P,
      },
    };
  }

  /* 横柱：> 12 类 → top 10 */
  const sorted = [...data].sort((a, b) => b.value - a.value);
  const shown = sorted.slice(0, 10);
  const reversed = [...shown].reverse();
  const bars = reversed.map((d, idx) => ({
    value: d.value,
    itemStyle: {
      color: {
        type: 'linear' as const, x: 0, y: 0, x2: 1, y2: 0,
        colorStops: [
          { offset: 0, color: P[idx % P.length] },
          { offset: 1, color: P[(idx + 1) % P.length] },
        ],
      },
      borderRadius: [0, 5, 5, 0],
    },
  }));

  return {
    type: 'chart',
    title,
    chartType: 'hbar',
    caption: `前 10 名（共 ${n} 项），最高"${shown[0].name}"（${fmtNum(shown[0].value)}）`,
    option: {
      tooltip: { trigger: 'axis' },
      grid: { left: '2%', right: '10%', bottom: '2%', top: '4%', containLabel: true },
      xAxis: { type: 'value', axisLabel: { fontSize: 12 }, splitLine: { lineStyle: { color: 'rgba(201,217,239,0.3)', type: 'dashed' } } },
      yAxis: {
        type: 'category',
        data: reversed.map((d) => d.name),
        axisLabel: { fontSize: 12 },
        axisTick: { show: false },
        inverse: true,
      },
      series: [{
        type: 'bar',
        data: bars,
        label: { show: true, position: 'right', fontSize: 11, color: '#5a6d8a' },
        barMaxWidth: 24,
      }],
      color: P,
    },
  };
}

/* ================================================================
   composition — 环形，中心总计，百分比标签
   ================================================================ */
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
  const sorted = [...data].sort((a, b) => b.value - a.value);

  return {
    type: 'chart',
    title,
    chartType: 'pie',
    caption: `共 ${fmtNum(total)}，最大占比"${sorted[0].name}"（${((sorted[0].value / total) * 100).toFixed(0)}%）`,
    option: {
      tooltip: { trigger: 'item', formatter: '{b}: {c} ({d}%)' },
      legend: { bottom: 0, itemWidth: 8, itemHeight: 8, itemGap: 16, textStyle: { fontSize: 12 } },
      graphic: {
        type: 'text',
        left: 'center',
        top: '36%',
        style: { text: `共 ${fmtNum(total)}`, textAlign: 'center', fontSize: 18, fontWeight: 'bold', fill: '#1a2332' },
      },
      series: [{
        type: 'pie',
        radius: ['55%', '75%'],
        center: ['50%', '43%'],
        data: sorted,
        label: { formatter: '{b}\n{d}%', fontSize: 12, lineHeight: 18 },
        emphasis: { scaleSize: 8, label: { fontSize: 16, fontWeight: 'bold' } },
        itemStyle: { borderColor: '#fff', borderWidth: 2.5 },
        color: P,
      }],
    },
  };
}

/* ================================================================
   trend — 面积 + 平滑折线，最大点高亮
   ================================================================ */
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

  const values = sorted.map((r) => num(r[viz.value]));
  const maxVal = Math.max(...values);

  return {
    type: 'chart',
    title,
    chartType: 'line',
    caption: `${sorted.length} 个时间点，最高 ${fmtNum(maxVal)}`,
    option: {
      tooltip: { trigger: 'axis' },
      grid: { left: '2%', right: '5%', bottom: '2%', top: '8%', containLabel: true },
      xAxis: {
        type: 'category',
        data: sorted.map((r) => String(r[timeKey] ?? '-')),
        boundaryGap: false,
        axisLabel: { fontSize: 12 },
        axisTick: { show: false },
      },
      yAxis: { type: 'value', axisLabel: { fontSize: 12 }, splitLine: { lineStyle: { color: 'rgba(201,217,239,0.3)', type: 'dashed' } } },
      series: [{
        type: 'line',
        smooth: 0.4,
        data: values,
        symbol: 'circle',
        symbolSize: 7,
        lineStyle: { width: 2.5, color: ACCENT },
        itemStyle: { color: ACCENT },
        areaStyle: {
          color: { type: 'linear' as const, x: 0, y: 0, x2: 0, y2: 1,
            colorStops: [
              { offset: 0, color: 'rgba(37,99,235,0.18)' },
              { offset: 1, color: 'rgba(37,99,235,0.02)' },
            ],
          },
        },
        label: { show: true, fontSize: 11, color: '#5a6d8a' },
        markPoint: {
          data: [{ type: 'max', name: '最高', symbolSize: 40, itemStyle: { color: ACCENT } }],
          label: { fontSize: 11 },
        },
      }],
    },
  };
}

/* ================================================================
   ranking — 横柱降序，top N，强调前三
   ================================================================ */
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

  const reversed = [...sorted].reverse();
  const bars = reversed.map((d, idx) => ({
    value: d.value,
    itemStyle: {
      color: {
        type: 'linear' as const, x: 0, y: 0, x2: 1, y2: 0,
        colorStops: [
          { offset: 0, color: P[idx % P.length] },
          { offset: 1, color: P[(idx + 1) % P.length] },
        ],
      },
      borderRadius: [0, 5, 5, 0],
    },
  }));

  return {
    type: 'chart',
    title,
    chartType: 'hbar',
    caption: `Top ${sorted.length}，最高"${sorted[0].name}"（${fmtNum(sorted[0].value)}）`,
    option: {
      tooltip: { trigger: 'axis' },
      grid: { left: '2%', right: '10%', bottom: '2%', top: '4%', containLabel: true },
      xAxis: { type: 'value', axisLabel: { fontSize: 12 }, splitLine: { lineStyle: { color: 'rgba(201,217,239,0.3)', type: 'dashed' } } },
      yAxis: {
        type: 'category',
        data: reversed.map((d, i) => {
          const rank = sorted.length - i;
          return rank <= 3 ? `${rank}. ${d.name}` : d.name;
        }),
        axisLabel: { fontSize: 12, fontWeight: 'normal' },
        axisTick: { show: false },
        inverse: true,
      },
      series: [{
        type: 'bar',
        data: bars,
        label: { show: true, position: 'right', fontSize: 11, color: '#5a6d8a' },
        barMaxWidth: 22,
      }],
    },
  };
}

/* ================================================================
   comparison — 分组柱，每组各色
   ================================================================ */
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

  const series = seriesNames.map((sName, idx) => ({
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
    itemStyle: {
      borderRadius: [5, 5, 0, 0],
      color: idx % 2 === 0
        ? { type: 'linear' as const, x: 0, y: 0, x2: 0, y2: 1,
            colorStops: [
              { offset: 0, color: P[idx % P.length] },
              { offset: 1, color: 'rgba(37,99,235,0.25)' },
            ],
          }
        : { type: 'linear' as const, x: 0, y: 0, x2: 0, y2: 1,
            colorStops: [
              { offset: 0, color: P[idx % P.length] },
              { offset: 1, color: 'rgba(8,145,178,0.25)' },
            ],
          },
    },
  }));

  return {
    type: 'chart',
    title,
    chartType: 'grouped_bar',
    caption: `${categories.length} × ${seriesNames.length} 维度对比`,
    option: {
      tooltip: { trigger: 'axis' },
      legend: { bottom: 0, itemWidth: 10, itemHeight: 10, itemGap: 18, textStyle: { fontSize: 12 } },
      grid: { left: '2%', right: '5%', bottom: '14%', top: '6%', containLabel: true },
      xAxis: { type: 'category', data: categories, axisLabel: { fontSize: 12 }, axisTick: { show: false } },
      yAxis: { type: 'value', axisLabel: { fontSize: 12 }, splitLine: { lineStyle: { color: 'rgba(201,217,239,0.3)', type: 'dashed' } } },
      series,
    },
  };
}
