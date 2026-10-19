import { backfillGbCodes } from './gb-code.backfill';
import { GbCodeService } from './gb-code.service';

/** 内存版 prisma 替身：PMI/BidProject 两表 + 宿主查询，update 原位生效 */
function makePrisma(seed: { pmis: any[]; bids: any[] }) {
  return {
    projectManagementItem: {
      findMany: jest.fn(({ where }: any) =>
        seed.pmis.filter(p => where?.gbProjectCode === null ? p.gbProjectCode == null : true),
      ),
      findUnique: jest.fn(({ where }: any) => seed.pmis.find(p => p.id === where?.id) ?? null),
      update: jest.fn(({ where, data }: any) => {
        const row = seed.pmis.find(p => p.id === where?.id);
        if (row) Object.assign(row, data);
        return Promise.resolve(row);
      }),
    },
    bidProject: {
      findMany: jest.fn(({ where }: any) =>
        seed.bids.filter(b => where?.gbProcureCode === null ? b.gbProcureCode == null : true),
      ),
      update: jest.fn(({ where, data }: any) => {
        const row = seed.bids.find(b => b.id === where?.id);
        if (row) Object.assign(row, data);
        return Promise.resolve(row);
      }),
    },
  };
}

/** GbCodeService 替身：18 位基码按宿主传入值派生 21 位，自立时用固定基码 */
function makeGb() {
  return {
    allocateProjectCode: jest.fn(async () => '511510000260909001'),
    allocateProcureCode: jest.fn(async (host: string | null) => ({
      gbProcureCode: `${host ?? '51151SWSELF0000999'}21`,
      gbSectionCode: '0001',
    })),
  } as unknown as GbCodeService;
}

describe('backfillGbCodes（seed 尾部自动回填——发布赋码闸闭环）', () => {
  it('缺码行补齐：PMI 得 18 位基码；BidProject 有宿主复用宿主码、无宿主自立', async () => {
    const seed = {
      pmis: [
        { id: 'pmi-1', title: '谈判立项', gbProjectCode: null },
        { id: 'pmi-2', title: '已有码', gbProjectCode: '511510000260909001' },
      ],
      bids: [
        { id: 'bp-1', name: '有宿主', projectCode: 'SWHI-TP-1', projectManagementItemId: 'pmi-1', gbProcureCode: null },
        { id: 'bp-2', name: '无宿主', projectCode: 'SWHI-TP-2', projectManagementItemId: null, gbProcureCode: null },
      ],
    };
    const prisma: any = makePrisma(seed);
    const gb = makeGb();

    const rows = await backfillGbCodes(prisma, gb);

    // 已有码的 pmi-2 不在回填集；两台 BidProject 都补
    expect(rows).toHaveLength(3);
    expect(rows.filter(r => r.scope === 'PMI')).toHaveLength(1);
    expect(seed.pmis[0].gbProjectCode).toBe('511510000260909001');
    expect(seed.pmis[1].gbProjectCode).toBe('511510000260909001'); // 未被重写（幂等：findMany 只取 null）
    // bp-1 宿主 pmi-1——先回填 PMI 再派生 21 位，宿主码被复用
    expect((gb.allocateProcureCode as jest.Mock).mock.calls[0][0]).toBe('511510000260909001');
    expect(seed.bids[0].gbProcureCode).toBe('51151000026090900121');
    // bp-2 无宿主——自立基码
    expect((gb.allocateProcureCode as jest.Mock).mock.calls[1][0]).toBeNull();
    expect(seed.bids[1].gbProcureCode).toBe('51151SWSELF000099921');
  });

  it('execute=false（dry-run）：只产清单不写库', async () => {
    const seed = {
      pmis: [{ id: 'pmi-1', title: 'X', gbProjectCode: null }],
      bids: [{ id: 'bp-1', name: 'Y', projectCode: 'C-1', projectManagementItemId: null, gbProcureCode: null }],
    };
    const prisma: any = makePrisma(seed);
    const rows = await backfillGbCodes(prisma, makeGb(), { execute: false });
    expect(rows).toHaveLength(2);
    expect(prisma.projectManagementItem.update).not.toHaveBeenCalled();
    expect(prisma.bidProject.update).not.toHaveBeenCalled();
    expect(seed.pmis[0].gbProjectCode).toBeNull();
  });

  it('全量有码（重灌后 seed 二跑 / 已回填）：零行零写', async () => {
    const seed = {
      pmis: [{ id: 'pmi-1', title: 'X', gbProjectCode: 'G1' }],
      bids: [{ id: 'bp-1', name: 'Y', projectCode: 'C-1', projectManagementItemId: 'pmi-1', gbProcureCode: 'G21' }],
    };
    const prisma: any = makePrisma(seed);
    const rows = await backfillGbCodes(prisma, makeGb());
    expect(rows).toHaveLength(0);
    expect(prisma.projectManagementItem.update).not.toHaveBeenCalled();
    expect(prisma.bidProject.update).not.toHaveBeenCalled();
  });
});
