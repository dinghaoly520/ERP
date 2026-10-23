import { SupplierPortalService } from './supplier-portal.service';

process.env.KMS_SECRET = process.env.KMS_SECRET || 'unit-test-kms-secret-32-chars-long!!';

type EvalRow = {
  supplierId: string; rank: number; recommended: boolean;
  disqualified: boolean; bidPrice: any; averageScore: any;
};

/** 已完结项目「我的结果」（2026-10-23）：中标事实源 = 评标结果（rank/recommended）
 *  + 中标通知书投递——ProcurementRound 属 legacy 域（projectId 引 Project 表），
 *  与 BidProject 零交集，此前据其判中标恒不命中（本次一并修复列表同源缺陷）。 */
describe('SupplierPortalService.getMyOutcome', () => {
  const PROJ = (stage: string, companyId: string | null = 'co-1') => ({
    id: 'p1', projectCode: 'BID-1', name: '某项目', procurementMethod: '公开招标',
    stage, updatedAt: new Date('2026-10-01'), companyId,
  });
  const ME = 's1';

  const mk = (over: {
    stage?: string; companyId?: string | null; link?: boolean;
    roster?: any; sub?: any; evals?: EvalRow[]; letter?: boolean;
  } = {}) => {
    const prisma: any = {
      bidProject: { findUnique: jest.fn().mockResolvedValue(PROJ(over.stage ?? 'ARCHIVED', over.companyId ?? 'co-1')) },
      supplierCompanyLink: { findMany: jest.fn().mockResolvedValue(over.link ? [{ companyId: 'co-1' }] : []) },
      bidSupplier: { findFirst: jest.fn().mockResolvedValue(over.roster ?? null) },
      supplierBidSubmission: { findFirst: jest.fn().mockResolvedValue(over.sub ?? null) },
    };
    prisma.bidEvaluationResult = {
      findMany: jest.fn().mockImplementation(async () =>
        (over.evals ?? []).map((e) => ({ projectId: 'p1', ...e }))),
    };
    prisma.awardLetterDelivery = {
      findMany: jest.fn().mockImplementation(async () => (over.letter ? [{ projectId: 'p1' }] : [])),
    };
    return { prisma, svc: new (SupplierPortalService as any)(prisma) as SupplierPortalService };
  };

  it('评标 rank=1（本人）→ AWARDED，中标金额=第一名报价（元侧），名次/得分齐', async () => {
    const { svc } = mk({
      evals: [
        { supplierId: ME, rank: 1, recommended: true, disqualified: false, bidPrice: 1530000, averageScore: 92.5 },
        { supplierId: 's2', rank: 2, recommended: false, disqualified: false, bidPrice: 1600000, averageScore: 88.1 },
      ],
      roster: { submitStatus: '已提交' }, sub: { bidPrice: null, submittedAt: new Date() },
    });
    const r = await svc.getMyOutcome(ME, 'p1');
    expect(r).toMatchObject({
      outcome: 'AWARDED', awardAmount: 1530000, myRank: 1, myScore: 92.5, myBidPrice: 1530000,
    });
  });

  it('中标通知书投递（无评标行兜底）→ AWARDED', async () => {
    const { svc } = mk({ letter: true, roster: { submitStatus: '已提交' } });
    const r = await svc.getMyOutcome(ME, 'p1');
    expect(r.outcome).toBe('AWARDED');
  });

  it('rank=2 未中标 → PARTICIPATED（名次/得分/报价仍回显）', async () => {
    const { svc } = mk({
      evals: [
        { supplierId: 's2', rank: 1, recommended: true, disqualified: false, bidPrice: 1500000, averageScore: 93 },
        { supplierId: ME, rank: 2, recommended: false, disqualified: false, bidPrice: 1550000, averageScore: 90 },
      ],
      roster: { submitStatus: '已提交' },
    });
    const r = await svc.getMyOutcome(ME, 'p1');
    expect(r).toMatchObject({ outcome: 'PARTICIPATED', myRank: 2, awardAmount: 1500000 });
  });

  it('rank=1 但被废标 → 不算中标；中标金额取未废标第一名', async () => {
    const { svc } = mk({
      evals: [
        { supplierId: ME, rank: 1, recommended: true, disqualified: true, bidPrice: 1400000, averageScore: 95 },
        { supplierId: 's2', rank: 2, recommended: false, disqualified: false, bidPrice: 1500000, averageScore: 90 },
      ],
      roster: { submitStatus: '已提交' },
    });
    const r = await svc.getMyOutcome(ME, 'p1');
    expect(r.outcome).toBe('PARTICIPATED');
    expect(r.awardAmount).toBe(1500000);
    expect(r.disqualified).toBe(true);
  });

  it('ABORTED → 流标；进行中 → outcome=null；仅有名册 → INVITED', async () => {
    expect((await mk({ stage: 'ABORTED', roster: { submitStatus: '已提交' } }).svc.getMyOutcome(ME, 'p1')).outcome).toBe('ABORTED');
    expect((await mk({ stage: 'EVALUATING', link: true }).svc.getMyOutcome(ME, 'p1')).outcome).toBeNull();
    expect((await mk({ roster: { submitStatus: '未提交' }, link: true }).svc.getMyOutcome(ME, 'p1')).outcome).toBe('INVITED');
  });

  it('公司隔离：无 APPROVED link/邀请/投递 → 403 COMPANY_SCOPE_FORBIDDEN', async () => {
    const { svc } = mk({ companyId: 'co-other', roster: null, sub: null });
    await expect(svc.getMyOutcome(ME, 'p1')).rejects.toMatchObject({
      response: { code: 'COMPANY_SCOPE_FORBIDDEN' },
    });
  });
});
