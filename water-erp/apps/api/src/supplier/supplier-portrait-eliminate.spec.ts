import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { SupplierService } from './supplier.service';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationService } from '../notification/notification.service';

describe('SupplierService — portrait & eliminate (Track E §3.3)', () => {
  let service: SupplierService;
  let prisma: any;
  let notification: any;

  beforeEach(async () => {
    prisma = {
      supplier: { findUnique: jest.fn(), findMany: jest.fn(), update: jest.fn() },
      bidSupplier: { findMany: jest.fn() },
      supplierEvaluation: { findMany: jest.fn() },
      supplierBidSubmission: { findMany: jest.fn() },
      bidEvaluationResult: { findMany: jest.fn(), findFirst: jest.fn() },
    };
    notification = { create: jest.fn(), sendToRole: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SupplierService,
        { provide: PrismaService, useValue: prisma },
        { provide: NotificationService, useValue: notification },
      ],
    }).compile();
    service = module.get<SupplierService>(SupplierService);
  });

  describe('getSupplierPortrait', () => {
    it('聚合参与、中标率、绩效均分', async () => {
      prisma.supplier.findUnique.mockResolvedValue({ id: 's1', name: '甲公司' });
      prisma.bidSupplier.findMany.mockResolvedValue([
        { id: 'bs1', projectId: 'p1' },
        { id: 'bs2', projectId: 'p2' },
      ]);
      prisma.bidEvaluationResult.findFirst
        .mockResolvedValueOnce({ supplierId: 's1', recommended: true })  // p1 中标
        .mockResolvedValueOnce({ supplierId: 's1', recommended: false }); // p2 未中标
      prisma.supplierEvaluation.findMany.mockResolvedValue([
        { score: 80, level: 'B', createdAt: new Date('2026-06-14') },
      ]);

      const p = await service.getSupplierPortrait('s1');
      expect(p.participationCount).toBe(2);
      expect(p.winCount).toBe(1);
      expect(p.winRate).toBeCloseTo(0.5, 2);
      expect(p.avgEvalScore).toBe(80);
    });

    it('供应商不存在时抛 NotFoundException', async () => {
      prisma.supplier.findUnique.mockResolvedValue(null);
      await expect(service.getSupplierPortrait('nope')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('reviewEliminationCandidates', () => {
    it('标记连续低分供应商为候选，但不改 status', async () => {
      prisma.supplier.findMany.mockResolvedValue([{ id: 's1', name: '差供应商' }]);
      prisma.supplierEvaluation.findMany.mockResolvedValue([
        { score: 50 }, { score: 48 }, { score: 45 },
      ]);

      const candidates = await service.reviewEliminationCandidates();
      expect(candidates).toHaveLength(1);
      expect(candidates[0].supplierId).toBe('s1');
      expect(prisma.supplier.update).not.toHaveBeenCalled();
      expect(notification.sendToRole).toHaveBeenCalled();
    });

    it('绩效正常的供应商不进候选', async () => {
      prisma.supplier.findMany.mockResolvedValue([{ id: 's2', name: '好供应商' }]);
      prisma.supplierEvaluation.findMany.mockResolvedValue([
        { score: 90 }, { score: 88 }, { score: 92 },
      ]);
      const candidates = await service.reviewEliminationCandidates();
      expect(candidates).toHaveLength(0);
    });
  });

  describe('confirmEliminate', () => {
    it('置 status=DISABLED', async () => {
      prisma.supplier.findUnique.mockResolvedValue({ id: 's1', status: 'APPROVED' });
      prisma.supplier.update.mockResolvedValue({ id: 's1' });
      const res = await service.confirmEliminate('s1', '连续差评');
      expect(res.success).toBe(true);
      expect(prisma.supplier.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 's1' }, data: expect.objectContaining({ status: 'DISABLED' }) }),
      );
    });

    it('供应商不存在时抛 NotFoundException', async () => {
      prisma.supplier.findUnique.mockResolvedValue(null);
      await expect(service.confirmEliminate('nope', 'x')).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
