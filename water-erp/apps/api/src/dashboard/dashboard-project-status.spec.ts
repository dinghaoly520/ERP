import { DashboardService, priorWindow } from './dashboard.service';

/** getProjectStatusCounts（2026-11-19 用户裁定：数据总览首排）——归档项目=台账中的项目
 *  （ProcurementRound 全时段行数，含终止留痕、不含回收站）；进行中/异常(=终止)为 PMI
 *  当前状态快照（回收站不计）；总数=归档+进行中（不含异常项目）。
 *  带 startDate 时附 flow（cur/yoy/prev 三窗流量口径，供「同比/环比」子行）：
 *  归档=窗内 procurementDate 轮次；进行中/异常=窗内 createdAt PMI。 */
describe('DashboardService.getProjectStatusCounts', () => {
  type FC = { archived: number; active: number; terminated: number; total: number };
  let calls: Array<{ kind: 'round' | 'pmi'; key: string }> = [];
  const keyOf = (range?: { gte?: Date; lte?: Date }) =>
    range ? `${range.gte?.toISOString() ?? ''}~${range.lte?.toISOString() ?? ''}` : 'base';
  /** 按窗口 gte 键派发 canned 计数/分组 */
  const makePrisma = (roundBy: Record<string, number>, pmiBy: Record<string, Array<{ status: string; _count: { _all: number } }>>) => {
    calls = [];
    const prisma: any = {
      procurementRound: {
        count: jest.fn().mockImplementation(({ where }) => {
          const k = keyOf(where.procurementDate);
          calls.push({ kind: 'round', key: k });
          return Promise.resolve(roundBy[k] ?? 0);
        }),
      },
      projectManagementItem: {
        groupBy: jest.fn().mockImplementation(({ where }) => {
          const k = keyOf(where.createdAt);
          calls.push({ kind: 'pmi', key: k });
          return Promise.resolve(pmiBy[k] ?? []);
        }),
      },
    };
    return prisma;
  };
  const iso = (s: string) => new Date(`${s}T00:00:00+08:00`).toISOString();
  const isoE = (s: string) => new Date(`${s}T23:59:59.999+08:00`).toISOString();

  it('无 startDate：headline 全时段口径，flow=null，仅 2 查（回收站排除+公司过滤注入）', async () => {
    const prisma = makePrisma(
      { base: 166 },
      { base: [{ status: 'ACTIVE', _count: { _all: 2 } }, { status: 'TERMINATED', _count: { _all: 4 } }] },
    );
    const svc = new (DashboardService as any)(prisma);
    const r: FC & { flow: unknown } = await svc.getProjectStatusCounts({ companyId: 'co-1' });
    expect(r).toEqual({ archived: 166, active: 2, terminated: 4, total: 168, flow: null });
    expect(prisma.procurementRound.count).toHaveBeenCalledWith({
      where: { companyId: 'co-1', isRecycled: false },
    });
    expect(calls).toHaveLength(2);
  });

  it('带 startDate：cur=本窗 / yoy=去年同窗 / prev=priorWindow 紧邻等长前窗', async () => {
    const curKey = `${iso('2026-01-01')}~${isoE('2026-11-19')}`;
    const yoyKey = `${iso('2025-01-01')}~${isoE('2025-11-19')}`;
    const prev = priorWindow('2026-01-01', '2026-11-19')!;
    const prevKey = `${iso(prev.startDate)}~${isoE(prev.endDate)}`;
    const prisma = makePrisma(
      { base: 166, [curKey]: 150, [yoyKey]: 90, [prevKey]: 120 },
      {
        base: [{ status: 'ACTIVE', _count: { _all: 2 } }, { status: 'TERMINATED', _count: { _all: 4 } }],
        [curKey]: [{ status: 'TERMINATED', _count: { _all: 3 } }],
        [yoyKey]: [{ status: 'ACTIVE', _count: { _all: 5 } }],
        [prevKey]: [],
      },
    );
    const svc = new (DashboardService as any)(prisma);
    const r = await svc.getProjectStatusCounts(undefined, '2026-01-01', '2026-11-19');
    expect(r.archived).toBe(166); // headline 仍全时段
    expect(r.active).toBe(2);
    expect(r.total).toBe(168);
    expect(r.flow).toEqual({
      cur: { archived: 150, active: 0, terminated: 3, total: 150 },
      yoy: { archived: 90, active: 5, terminated: 0, total: 95 },
      prev: { archived: 120, active: 0, terminated: 0, total: 120 },
    });
    expect(calls).toHaveLength(8); // 4 窗 × (轮次 count + PMI groupBy)
    // 同比窗起点=2025-01-01（闰日回夹由 shiftYearIso 边界语义覆盖）
    expect(calls.some((c) => c.key === yoyKey)).toBe(true);
  });

  it('endDate 缺省（月/季/年至今天径）：同比窗终点=今天前移一年，不跨进本年', async () => {
    const today = new Date();
    const todayIso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    const [ty, tm, td] = todayIso.split('-').map(Number);
    const yoyToday = (() => {
      let t = new Date(Date.UTC(ty - 1, tm - 1, td));
      if (t.getUTCMonth() !== tm - 1) t = new Date(Date.UTC(ty - 1, tm, 0));
      return t.toISOString().slice(0, 10);
    })();
    const prisma = makePrisma(
      { base: 166 },
      { base: [{ status: 'ACTIVE', _count: { _all: 2 } }] },
    );
    const svc = new (DashboardService as any)(prisma);
    await svc.getProjectStatusCounts(undefined, '2026-11-01');
    const yoyKeys = calls.filter((c) => c.kind === 'round' && c.key !== 'base').map((c) => c.key);
    expect(yoyKeys).toContain(`${iso('2025-11-01')}~${isoE(yoyToday)}`);
  });

  it('垃圾日期参按缺省处理（卫兵防 Invalid Date 穿 Prisma 500）', async () => {
    const prisma = makePrisma(
      { base: 166 },
      { base: [{ status: 'ACTIVE', _count: { _all: 2 } }] },
    );
    const svc = new (DashboardService as any)(prisma);
    const r = await svc.getProjectStatusCounts(undefined, 'garbage', '2026-13-99');
    expect(r.flow).toBeNull(); // 非法窗=无窗
    expect(calls).toHaveLength(2); // 只发 base 两查
  });

  it('空库全 0（缺态不 NaN）', async () => {
    const prisma = makePrisma({}, {});
    const svc = new (DashboardService as any)(prisma);
    const r = await svc.getProjectStatusCounts(undefined);
    expect(r).toEqual({ archived: 0, active: 0, terminated: 0, total: 0, flow: null });
  });
});
