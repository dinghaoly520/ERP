import { applyCardGate } from './card-gate';

describe('卡片规则闸（回答跟随提问，2026-11-03）', () => {
  const table = (o: Partial<Record<string, unknown>>) => ({ type: 'table', title: 'T', ...o });

  it('metric 卡原样保留', () => {
    expect(applyCardGate({ type: 'metric', title: '概览', metrics: [] }).keep).toBe(true);
  });

  it('带 viz 的表卡保留（图即答案形状）', () => {
    expect(applyCardGate(table({ viz: { kind: 'distribution' }, rows: [{ a: 1 }] })).keep).toBe(true);
  });

  it('chart 等其他类型卡保留（闸只管 table）', () => {
    expect(applyCardGate({ type: 'chart', title: 'X' }).keep).toBe(true);
  });

  it('无 viz 且行≤3、键≤2 的小表丢弃并给正文序列化', () => {
    const r = applyCardGate(table({ rows: [{ 项目: 'X', 天数: 5 }, { 项目: 'Y', 天数: 2 }] }));
    expect(r.keep).toBe(false);
    expect(r.droppedText).toContain('T：');
    expect(r.droppedText).toContain('项目=X');
    expect(r.droppedText).toContain('天数=5');
    expect(r.droppedText).toContain('项目=Y');
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
    expect(r.droppedText).toContain('项目=X，数=1');
  });

  it('global_overview 四张分布表（带 viz）全部保留——两端既有图表能力不回退', () => {
    const mk = (title: string) => table({
      title,
      viz: { kind: 'distribution', category: 'status', value: 'count' },
      rows: [{ status: 'A', count: 1 }, { status: 'B', count: 2 }],
    });
    for (const c of ['采购项目状态分布', '招标项目阶段分布', '供应商状态分布', '专家专业分布'].map(mk)) {
      expect(applyCardGate(c).keep).toBe(true);
    }
  });
});
