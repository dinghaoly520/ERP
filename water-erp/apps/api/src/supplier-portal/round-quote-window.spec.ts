import { BidService } from '../bid/bid.service';
import { SupplierPortalController } from './supplier-portal.controller';

/** 报价窗口闸（2026-10-19）：多轮报价与专家个人评审同口径——结果生成即冻结、
 *  归档/流标后僵尸轮次不可投。submitQuote 原有五闸（轮次态/截止/名单/废标/一报制）
 *  不含项目阶段与结果冻结，本组锁定补齐后的行为。 */
describe('round quote window locks', () => {
  const baseMember = { id: 'bid-supplier-1', supplierId: 'supplier-1', bidValidity: 'valid' };
  const openRound = {
    id: 'round-1', projectId: 'project-1', status: 'open',
    deadline: null, eligibleSupplierIds: ['bid-supplier-1'],
  };

  const makeController = (prisma: Record<string, any>) => {
    const controller = Object.create(SupplierPortalController.prototype) as SupplierPortalController;
    Object.assign(controller as object, {
      prisma,
      notificationService: { resolveActionableForUser: jest.fn() },
    });
    return controller;
  };

  it('submitQuote 在项目已归档（轮次忘关）→ 409 PROJECT_NOT_ACTIVE，零报价写入', async () => {
    const prisma = {
      supplier: { findUnique: jest.fn().mockResolvedValue({ id: 'supplier-1' }) },
      bidSupplier: { findFirst: jest.fn().mockResolvedValue(baseMember) },
      bidProject: { findUnique: jest.fn().mockResolvedValue({ id: 'project-1', stage: 'ARCHIVED' }) },
      bidRound: { findUnique: jest.fn().mockResolvedValue(openRound) },
      bidEvaluationResult: { count: jest.fn().mockResolvedValue(0) },
      bidQuote: { create: jest.fn() },
    };
    await expect(
      makeController(prisma).submitQuote(
        { user: { sub: 'user-1' } }, 'project-1', 'round-1',
        { bidSupplierId: 'bid-supplier-1', quotePrice: 100 },
      ),
    ).rejects.toMatchObject({ response: { code: 'PROJECT_NOT_ACTIVE' } });
    expect(prisma.bidQuote.create).not.toHaveBeenCalled();
  });

  it('submitQuote 在评标结果已生成后（轮次仍 open）→ 409 RESULTS_FROZEN，零报价写入', async () => {
    const prisma = {
      supplier: { findUnique: jest.fn().mockResolvedValue({ id: 'supplier-1' }) },
      bidSupplier: { findFirst: jest.fn().mockResolvedValue(baseMember) },
      bidProject: { findUnique: jest.fn().mockResolvedValue({ id: 'project-1', stage: 'EVALUATING' }) },
      bidRound: { findUnique: jest.fn().mockResolvedValue(openRound) },
      bidEvaluationResult: { count: jest.fn().mockResolvedValue(3) },
      bidQuote: { create: jest.fn() },
    };
    await expect(
      makeController(prisma).submitQuote(
        { user: { sub: 'user-1' } }, 'project-1', 'round-1',
        { bidSupplierId: 'bid-supplier-1', quotePrice: 100 },
      ),
    ).rejects.toMatchObject({ response: { code: 'RESULTS_FROZEN' } });
    expect(prisma.bidQuote.create).not.toHaveBeenCalled();
  });

  it('createRound 在评标结果已生成后 → 409 RESULTS_FROZEN，零轮次写入', async () => {
    const project = { id: 'project-1', stage: 'EVALUATING', procurementMethod: '谈判采购', roundMode: 'negotiation', leaderCoSigned: true };
    const prisma = {
      bidProject: { findUnique: jest.fn().mockResolvedValue(project) },
      // E6 前置全过：正选全确认+组长末签+无未决异议——聚焦结果冻结闸
      bidExpert: { findMany: jest.fn().mockResolvedValue([{ reportConfirmed: true }]) },
      expertDispute: { count: jest.fn().mockResolvedValue(0) },
      bidEvaluationResult: { count: jest.fn().mockResolvedValue(1) },
      bidRound: { findFirst: jest.fn().mockResolvedValue(null), create: jest.fn() },
    };
    const service = Object.create(BidService.prototype) as BidService;
    Object.assign(service as object, { prisma });
    await expect(
      service.createRound('project-1', 'negotiation'),
    ).rejects.toMatchObject({ response: { code: 'RESULTS_FROZEN' } });
    expect(prisma.bidRound.create).not.toHaveBeenCalled();
  });
});
