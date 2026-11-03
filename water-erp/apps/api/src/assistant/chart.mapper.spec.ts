import { mapToChart } from './chart.mapper';

describe('mapToChart', () => {
  const baseTable = {
    title: '测试',
    columns: [
      { key: 'name', label: '名称' },
      { key: 'count', label: '数量' },
    ],
  };

  it('returns null when no viz', () => {
    expect(
      mapToChart({ ...baseTable, rows: [{ name: 'A', count: 1 }] }),
    ).toBeNull();
  });

  it('returns null when rows empty', () => {
    expect(
      mapToChart({
        ...baseTable,
        rows: [],
        viz: { kind: 'distribution', value: 'count', category: 'name' },
      }),
    ).toBeNull();
  });

  it('returns null for single category distribution', () => {
    expect(
      mapToChart({
        ...baseTable,
        rows: [{ name: 'A', count: 5 }],
        viz: { kind: 'distribution', value: 'count', category: 'name' },
      }),
    ).toBeNull();
  });

  it('distribution ≤5 categories → pie chart with caption', () => {
    const result = mapToChart({
      ...baseTable,
      rows: [
        { name: 'A', count: 3 },
        { name: 'B', count: 2 },
        { name: 'C', count: 1 },
      ],
      viz: { kind: 'distribution', value: 'count', category: 'name' },
    });
    expect(result?.chartType).toBe('pie');
    expect(result?.option).toBeDefined();
    expect(result?.caption).toContain('共 6');
  });

  it('distribution 6-12 categories → bar, max highlighted', () => {
    const rows = [
      { name: 'A', count: 1 }, { name: 'B', count: 5 }, { name: 'C', count: 3 },
      { name: 'D', count: 2 }, { name: 'E', count: 4 }, { name: 'F', count: 6 },
    ];
    const result = mapToChart({
      ...baseTable, rows,
      viz: { kind: 'distribution', value: 'count', category: 'name' },
    });
    expect(result?.chartType).toBe('bar');
    expect(result?.caption).toContain('6 个类别');
    expect(result?.caption).toContain('F'); // F=6 is the max
    const series = (result!.option.series as any[])[0];
    expect(series.data[0].itemStyle).toBeDefined(); // gradient fill
  });

  it('distribution >12 categories → hbar top 10', () => {
    const rows = Array.from({ length: 15 }, (_, i) => ({
      name: `项${i}`,
      count: 15 - i,
    }));
    const result = mapToChart({
      ...baseTable, rows,
      viz: { kind: 'distribution', value: 'count', category: 'name' },
    });
    expect(result?.chartType).toBe('hbar');
    expect(result?.caption).toContain('前 10 名');
    const yData = (result!.option.yAxis as any).data;
    expect(yData.length).toBe(10);
  });

  it('trend sorts by time and returns line with markPoint', () => {
    const result = mapToChart({
      title: '月度趋势',
      columns: [
        { key: 'month', label: '月份' },
        { key: 'count', label: '数量' },
      ],
      rows: [
        { month: '2026-03', count: 5 },
        { month: '2026-01', count: 3 },
        { month: '2026-02', count: 4 },
      ],
      viz: { kind: 'trend', value: 'count', timeField: 'month' },
    });
    expect(result?.chartType).toBe('line');
    const xData = (result!.option.xAxis as any).data;
    expect(xData).toEqual(['2026-01', '2026-02', '2026-03']);
    const series = (result!.option.series as any[])[0];
    expect(series.markPoint).toBeDefined();
  });

  it('ranking returns hbar with top-N label, top 3 emphasized', () => {
    const rows = Array.from({ length: 15 }, (_, i) => ({
      name: `供应商${i}`,
      count: 20 - i,
    }));
    const result = mapToChart({
      ...baseTable, rows,
      viz: { kind: 'ranking', value: 'count', category: 'name', topN: 5 },
    });
    expect(result?.chartType).toBe('hbar');
    const yData = (result!.option.yAxis as any).data;
    expect(yData.length).toBe(5);
    expect(yData[4]).toContain('1.'); // top rank gets number prefix
    expect(result?.caption).toContain('最高');
  });

  it('comparison returns grouped_bar with gradient fills', () => {
    const result = mapToChart({
      title: '部门对比',
      columns: [
        { key: 'dept', label: '部门' },
        { key: 'status', label: '状态' },
        { key: 'count', label: '数量' },
      ],
      rows: [
        { dept: 'A部门', status: '已通过', count: 5 },
        { dept: 'A部门', status: '待审核', count: 2 },
        { dept: 'B部门', status: '已通过', count: 3 },
        { dept: 'B部门', status: '待审核', count: 4 },
      ],
      viz: { kind: 'comparison', value: 'count', category: 'dept', seriesField: 'status' },
    });
    expect(result?.chartType).toBe('grouped_bar');
    expect((result!.option.series as any[]).length).toBe(2);
    expect(result?.caption).toContain('2 × 2');
  });

  it('composition returns ring pie with center total and caption', () => {
    const result = mapToChart({
      ...baseTable,
      rows: [
        { name: '货物', count: 60 },
        { name: '工程', count: 30 },
        { name: '服务', count: 10 },
      ],
      viz: { kind: 'composition', value: 'count', category: 'name' },
    });
    expect(result?.chartType).toBe('pie');
    expect((result!.option as any).graphic).toBeDefined();
    expect(result?.caption).toContain('共 100');
    expect(result?.caption).toContain('货物');
  });
});

describe('图卡自包含 data（:3011 脱离表卡渲染，2026-11-03）', () => {
  const cols = [
    { key: '阶段', label: '阶段' },
    { key: '项目数', label: '项目数' },
  ];

  it('distribution 饼分支携带 points（降序）与 total', () => {
    const card = mapToChart({
      title: '阶段分布',
      columns: cols,
      rows: [{ 阶段: 'A', 项目数: 3 }, { 阶段: 'B', 项目数: 7 }],
      viz: { kind: 'distribution', category: '阶段', value: '项目数' },
    });
    expect(card).toBeTruthy();
    expect(card!.data?.points).toEqual([{ name: 'B', value: 7 }, { name: 'A', value: 3 }]);
    expect(card!.data?.total).toBe(10);
    expect(card!.data?.rows).toHaveLength(2);
  });

  it('distribution 柱分支（6-12 类）携带降序 points', () => {
    const rows = 'ABCDEFGH'.split('').map((n, i) => ({ 阶段: n, 项目数: i + 1 }));
    const card = mapToChart({
      title: '分布',
      columns: cols,
      rows,
      viz: { kind: 'distribution', category: '阶段', value: '项目数' },
    });
    expect(card!.chartType).toBe('bar');
    expect(card!.data?.points?.[0]).toEqual({ name: 'H', value: 8 });
  });

  it('trend 携带时间升序 labels 与 points', () => {
    const card = mapToChart({
      title: '趋势',
      columns: [{ key: 'month', label: '月份' }, { key: 'count', label: '数量' }],
      rows: [{ month: '2026-03', count: 2 }, { month: '2026-01', count: 5 }, { month: '2026-02', count: 1 }],
      viz: { kind: 'trend', value: 'count', timeField: 'month' },
    });
    expect(card!.chartType).toBe('line');
    expect(card!.data?.labels).toEqual(['2026-01', '2026-02', '2026-03']);
    expect(card!.data?.points?.map((p) => p.value)).toEqual([5, 1, 2]);
  });

  it('ranking 携带降序 points', () => {
    const card = mapToChart({
      title: '排行',
      columns: [{ key: '项目', label: '项目' }, { key: '节资率数值', label: '节资率' }],
      rows: [{ 项目: '甲', 节资率数值: 5.4 }, { 项目: '乙', 节资率数值: 12.8 }, { 项目: '丙', 节资率数值: 8 }],
      viz: { kind: 'ranking', category: '项目', value: '节资率数值' },
    });
    expect(card!.chartType).toBe('hbar');
    expect(card!.data?.points?.[0]).toEqual({ name: '乙', value: 12.8 });
  });

  it('comparison 携带 labels 与 series', () => {
    const card = mapToChart({
      title: '对比',
      columns: [],
      rows: [
        { 公司: '甲', 指标: '成交', 值: 3 },
        { 公司: '甲', 指标: '节资', 值: 1 },
        { 公司: '乙', 指标: '成交', 值: 5 },
        { 公司: '乙', 指标: '节资', 值: 2 },
      ],
      viz: { kind: 'comparison', category: '公司', value: '值', seriesField: '指标' },
    });
    expect(card!.chartType).toBe('grouped_bar');
    expect(card!.data?.labels).toEqual(['甲', '乙']);
    expect(card!.data?.series).toEqual([
      { name: '成交', values: [3, 5] },
      { name: '节资', values: [1, 2] },
    ]);
  });
});
