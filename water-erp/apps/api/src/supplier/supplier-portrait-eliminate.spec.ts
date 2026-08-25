import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { VerificationService } from '../verification/verification.service';
import { SupplierService } from './supplier.service';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationService } from '../notification/notification.service';
import { LlmService } from '../local-ai/llm.service';

describe('SupplierService — portrait & eliminate (Track E §3.3)', () => {
  let service: SupplierService;
  let prisma: any;
  let notification: any;

  beforeEach(async () => {
    prisma = {
      supplier: { findUnique: jest.fn(), findMany: jest.fn(), updateMany: jest.fn() },
      bidSupplier: { findMany: jest.fn() },
      supplierEvaluation: { findMany: jest.fn() },
      supplierBidSubmission: { findMany: jest.fn() },
      bidEvaluationResult: { findMany: jest.fn(), findFirst: jest.fn() },
      user: { update: jest.fn() },
    };
    notification = { create: jest.fn(), sendToRole: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SupplierService,
        { provide: VerificationService, useValue: {} },
        { provide: PrismaService, useValue: prisma },
        { provide: NotificationService, useValue: notification },
        // SupplierService 构造器 @Inject('REDIS_CLIENT')（口径同 verification.service.spec.ts）
        { provide: 'REDIS_CLIENT', useValue: { get: jest.fn(), set: jest.fn(), del: jest.fn(), incr: jest.fn(), expire: jest.fn(), ttl: jest.fn() } },
        // 构造器第 4 参（本 spec 不触达 LLM，空 mock 即可）
        { provide: LlmService, useValue: {} },
      ],
    }).compile();
    service = module.get<SupplierService>(SupplierService);
  });

  describe('getSupplierPortrait', () => {
    it('聚合参与、中标率、绩效等级', async () => {
      prisma.supplier.findUnique.mockResolvedValue({ id: 's1', name: '甲公司' });
      prisma.bidSupplier.findMany.mockResolvedValue([
        { id: 'bs1', projectId: 'p1' },
        { id: 'bs2', projectId: 'p2' },
      ]);
      prisma.bidEvaluationResult.findFirst
        .mockResolvedValueOnce({ supplierId: 's1', recommended: true })  // p1 中标
        .mockResolvedValueOnce({ supplierId: 's1', recommended: false }); // p2 未中标
      prisma.supplierEvaluation.findMany.mockResolvedValue([
        { finalGrade: 'B', createdAt: new Date('2026-06-14') },
      ]);

      const p = await service.getSupplierPortrait('s1');
      expect(p.participationCount).toBe(2);
      expect(p.winCount).toBe(1);
      expect(p.winRate).toBeCloseTo(0.5, 2);
      expect(p.avgGradeScore).toBe(4); // B = 4
      expect(p.evalCount).toBe(1);
    });

    it('供应商不存在时抛 NotFoundException', async () => {
      prisma.supplier.findUnique.mockResolvedValue(null);
      await expect(service.getSupplierPortrait('nope')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('reviewEliminationCandidates', () => {
    it('连续3次E级供应商为候选，但不改 status', async () => {
      prisma.supplier.findMany.mockResolvedValue([{ id: 's1', name: '差供应商' }]);
      prisma.supplierEvaluation.findMany.mockResolvedValue([
        { finalGrade: 'E' }, { finalGrade: 'E' }, { finalGrade: 'E' },
      ]);

      const candidates = await service.reviewEliminationCandidates();
      expect(candidates).toHaveLength(1);
      expect(candidates[0].supplierId).toBe('s1');
      expect(prisma.supplier.updateMany).not.toHaveBeenCalled();
      expect(notification.sendToRole).toHaveBeenCalled();
    });

    it('绩效正常的供应商不进候选', async () => {
      prisma.supplier.findMany.mockResolvedValue([{ id: 's2', name: '好供应商' }]);
      prisma.supplierEvaluation.findMany.mockResolvedValue([
        { finalGrade: 'A' }, { finalGrade: 'B' }, { finalGrade: 'A' },
      ]);
      const candidates = await service.reviewEliminationCandidates();
      expect(candidates).toHaveLength(0);
    });
  });

  describe('confirmEliminate', () => {
    it('置 status=DISABLED', async () => {
      prisma.supplier.findUnique.mockResolvedValue({ id: 's1', status: 'APPROVED', name: '差供应商', userId: 'u1' });
      prisma.supplier.updateMany.mockResolvedValue({ count: 1 });
      prisma.user.update.mockResolvedValue({ id: 'u1' });
      const res = await service.confirmEliminate('s1', '连续差评');
      expect(res.success).toBe(true);
      expect(prisma.supplier.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 's1', status: 'APPROVED' },
          data: expect.objectContaining({ status: 'DISABLED' }),
        }),
      );
    });

    it('供应商不存在时抛 NotFoundException', async () => {
      prisma.supplier.findUnique.mockResolvedValue(null);
      await expect(service.confirmEliminate('nope', 'x')).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
