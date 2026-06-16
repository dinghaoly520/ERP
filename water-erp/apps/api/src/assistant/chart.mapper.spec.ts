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

  it('distribution ≤5 categories → pie chart', () => {
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
  });

  it('distribution >5 categories → bar chart, sorted descending', () => {
    const result = mapToChart({
      ...baseTable,
      rows: [
        { name: 'A', count: 1 },
        { name: 'B', count: 5 },
        { name: 'C', count: 3 },
        { name: 'D', count: 2 },
        { name: 'E', count: 4 },
        { name: 'F', count: 6 },
      ],
      viz: { kind: 'distribution', value: 'count', category: 'name' },
    });
    expect(result?.chartType).toBe('bar');
    const xData = (result!.option.xAxis as any).data;
    expect(xData[0]).toBe('F'); // 最大值排第一
  });

  it('distribution >12 categories → hbar, top 10', () => {
    const rows = Array.from({ length: 15 }, (_, i) => ({
      name: `项${i}`,
      count: 15 - i,
    }));
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
  });

  it('ranking returns hbar sorted descending, capped at topN', () => {
    const rows = Array.from({ length: 15 }, (_, i) => ({
      name: `供应商${i}`,
      count: 20 - i,
    }));
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
      viz: {
        kind: 'comparison',
        value: 'count',
        category: 'dept',
        seriesField: 'status',
      },
    });
    expect(result?.chartType).toBe('grouped_bar');
    expect((result!.option.series as any[]).length).toBe(2);
  });

  it('composition returns pie with total in center', () => {
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
  });
});
