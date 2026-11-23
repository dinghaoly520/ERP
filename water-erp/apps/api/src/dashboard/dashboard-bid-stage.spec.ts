import { DashboardService, priorWindow } from './dashboard.service';

/** getBidStageStatus（2026-11-19 用户裁定：实时态势四 KPI）——标段生命周期盘点：
 *  标前=确认开标前（DOWNLOAD/SUBMIT）；标中=已确认开标未完成开评标（OPENING/EVALUATING）；
 *  标后=完成开评标（ARCHIVED）；运行中=标前+标中。ABORTED（流标终态）不入任何桶。
 *  带 startDate 附 flow 三窗（同比/环比子行，createdAt=立项流口径）。 */
describe('DashboardService.getBidStageStatus', () => {
  let calls: string[] = [];
  const iso = (s: string) => new Date(`${s}T00:00:00+08:00`).toISOString();
  const isoE = (s: string) => new Date(`${s}T23:59:59.999+08:00`).toISOString();
  const keyOf = (range?: { gte?: Date; lte?: Date }) =>
    range ? `${range.gte?.toISOString() ?? ''}~${range.lte?.toISOString() ?? ''}` : 'base';
  const makePrisma = (by: Record<string, Array<{ stage: string; _count: { _all: number } }>>) => {
    calls = [];
    const prisma: any = {
      bidProject: {
        groupBy: jest.fn().mockImplementation(({ where }) => {
          const k = keyOf(where.createdAt);
          calls.push(k);
          return Promise.resolve(by[k] ?? []);
        }),
      },
    };
    return prisma;
  };

  it('headline 四桶口径正确（ABORTED 不计；运行中=标前+标中），无 startDate flow=null', async () => {
    const prisma = makePrisma({
      base: [
        { stage: 'SUBMIT', _count: { _all: 2 } },
        { stage: 'DOWNLOAD', _count: { _all: 1 } },
        { stage: 'OPENING', _count: { _all: 1 } },
        { stage: 'ARCHIVED', _count: { _all: 5 } },
        { stage: 'ABORTED', _count: { _all: 4 } },
      ],
    });
    const svc = new (DashboardService as any)(prisma);
    const r = await svc.getBidStageStatus({ companyId: 'co-1' });
    expect(r).toEqual({ running: 4, pre: 3, in: 1, post: 5, flow: null });
    expect(prisma.bidProject.groupBy).toHaveBeenCalledWith({
      by: ['stage'],
      _count: { _all: true },
      where: { companyId: 'co-1' },
    });
    expect(calls).toHaveLength(1);
  });

  it('带 startDate：cur/yoy/prev 三窗（yoy 终点=今天前移一年——不跨进本年）', async () => {
    const today = new Date();
    const tIso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    const [ty, tm, td] = tIso.split('-').map(Number);
    const yoyToday = (() => {
      let t = new Date(Date.UTC(ty - 1, tm - 1, td));
      if (t.getUTCMonth() !== tm - 1) t = new Date(Date.UTC(ty - 1, tm, 0));
      return t.toISOString().slice(0, 10);
    })();
    const prisma = makePrisma({
      base: [{ stage: 'SUBMIT', _count: { _all: 2 } }],
      [`${iso('2026-01-01')}~`]: [{ stage: 'SUBMIT', _count: { _all: 1 } }, { stage: 'EVALUATING', _count: { _all: 2 } }],
      [`${iso('2025-01-01')}~${isoE(yoyToday)}`]: [{ stage: 'ARCHIVED', _count: { _all: 7 } }],
      // prev 窗键由 priorWindow 现算，给空 → 全 0
    });
    const svc = new (DashboardService as any)(prisma);
    const r = await svc.getBidStageStatus(undefined, '2026-01-01');
    expect(r.running).toBe(2);
    expect(r.pre).toBe(2);
    expect(r.flow).toEqual({
      cur: { running: 3, pre: 1, in: 2, post: 0 },
      yoy: { running: 0, pre: 0, in: 0, post: 7 },
      prev: { running: 0, pre: 0, in: 0, post: 0 },
    });
    expect(calls).toHaveLength(4);
  });

  /* 进展页模式（2026-11-23 用户裁定：态势卡内容跟随板块选择器）——pmiFilter 存在时：
   * 时间/部门/经办人走 BidProject→PMI 关系过滤，方式走 BidProject 自有列；headline 也按窗计
   * （首页模式不变：headline 存量、日期只进 flow 子窗） */
  describe('进展页模式 pmiFilter', () => {
    const makePmiPrisma = (rows: Array<{ stage: string; _count: { _all: number } }>) => {
      const seen: any[] = [];
      const prisma: any = {
        bidProject: {
          groupBy: jest.fn().mockImplementation(({ where }) => {
            seen.push(where);
            const r = where.projectManagementItem?.createdAt;
            const k = r ? `${r.gte?.toISOString() ?? ''}~${r.lte?.toISOString() ?? ''}` : 'base';
            return Promise.resolve(k === 'base' ? [{ stage: 'SUBMIT', _count: { _all: 99 } }] : rows);
          }),
        },
      };
      return { prisma, seen };
    };

    it('带窗：headline 与 cur 均按 PMI 立项窗计；方式/部门/经办人进 where；不裸写 createdAt', async () => {
      const { prisma, seen } = makePmiPrisma([{ stage: 'OPENING', _count: { _all: 2 } }, { stage: 'ARCHIVED', _count: { _all: 1 } }]);
      const svc = new (DashboardService as any)(prisma);
      const r = await svc.getBidStageStatus(undefined, '2026-01-01', '2026-01-31', { procurementMethods: ['公开招标'], departments: ['工程设计院'], createdBy: ['u-1'] });
      expect(r).toMatchObject({ running: 2, pre: 0, in: 2, post: 1 });
      expect(r.flow?.cur).toEqual({ running: 2, pre: 0, in: 2, post: 1 });
      const w = seen[0];
      expect(w.procurementMethod).toEqual({ in: ['公开招标'] });
      expect(w.projectManagementItem).toEqual({
        requesterDepartment: { in: ['工程设计院'] },
        createdById: { in: ['u-1'] },
        createdAt: { gte: new Date('2026-01-01T00:00:00+08:00'), lte: new Date('2026-01-31T23:59:59.999+08:00') },
      });
      expect(w.createdAt).toBeUndefined();
    });

    it('无窗（时间=全部）：仅方式/部门/经办人过滤 headline，flow=null，单次查询', async () => {
      const { prisma, seen } = makePmiPrisma([]);
      const svc = new (DashboardService as any)(prisma);
      const r = await svc.getBidStageStatus({ companyId: 'co-1' }, undefined, undefined, { departments: ['工程设计院'] });
      expect(r).toEqual({ running: 99, pre: 99, in: 0, post: 0, flow: null });
      expect(prisma.bidProject.groupBy).toHaveBeenCalledTimes(1);
      expect(seen[0]).toEqual({ companyId: 'co-1', projectManagementItem: { requesterDepartment: { in: ['工程设计院'] } } });
    });

    it('空 pmiFilter 对象仍是进展页模式（headline 按窗、日期落 PMI 关系）；undefined 才是首页模式', async () => {
      const { prisma, seen } = makePmiPrisma([{ stage: 'OPENING', _count: { _all: 2 } }]);
      const svc = new (DashboardService as any)(prisma);
      const r = await svc.getBidStageStatus(undefined, '2026-01-01', '2026-01-31', {});
      expect(r).toMatchObject({ running: 2, pre: 0, in: 2, post: 0 });
      expect(seen[0].projectManagementItem).toEqual({
        createdAt: { gte: new Date('2026-01-01T00:00:00+08:00'), lte: new Date('2026-01-31T23:59:59.999+08:00') },
      });
      expect(seen[0].createdAt).toBeUndefined();
    });
  });

  it('空库全 0', async () => {
    const prisma = makePrisma({});
    const svc = new (DashboardService as any)(prisma);
    const r = await svc.getBidStageStatus(undefined);
    expect(r).toEqual({ running: 0, pre: 0, in: 0, post: 0, flow: null });
  });
});
