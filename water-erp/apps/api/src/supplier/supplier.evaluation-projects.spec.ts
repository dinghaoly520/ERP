import { Test } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { SupplierService } from './supplier.service';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationService } from '../notification/notification.service';
import { VerificationService } from '../verification/verification.service';
import { LlmService } from '../local-ai/llm.service';
import { CompanyScopeService } from '../company/company-scope';

/**
 * 供应商评价·关联项目（真实参评）：
 * listEvaluationProjects / listEvaluations（附项目名）/ createEvaluation（projectId 真实性校验）。
 * 关键口径：BidEvaluationResult.supplierId = BidSupplier.id（与 generateEvaluationResults 写入一致）。
 */
describe('SupplierService — 评价关联项目（真实参评）', () => {
  let service: SupplierService;
  let prisma: any;

  const now = new Date('2026-10-01T09:00:00Z');

  beforeEach(async () => {
    prisma = {
      supplier: { findUnique: jest.fn().mockResolvedValue({ id: 's1', status: 'APPROVED' }) },
      supplierEvaluation: { findMany: jest.fn(), findFirst: jest.fn().mockResolvedValue(null), create: jest.fn().mockResolvedValue({ id: 'ev-new' }) },
      bidProject: { findUnique: jest.fn().mockResolvedValue({ id: 'p1' }), findMany: jest.fn() },
      bidSupplier: { findMany: jest.fn(), findFirst: jest.fn().mockResolvedValue({ id: 'bs1' }) },
      bidEvaluationResult: { findMany: jest.fn() },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
    };
    const module = await Test.createTestingModule({
      providers: [
        { provide: CompanyScopeService, useValue: { resolveScope: jest.fn().mockResolvedValue({ all: true }), assertInScope: jest.fn() } },
        SupplierService,
        { provide: PrismaService, useValue: prisma },
        { provide: NotificationService, useValue: { sendToRole: jest.fn(), sendToUser: jest.fn() } },
        { provide: 'REDIS_CLIENT', useValue: {} },
        { provide: LlmService, useValue: {} },
        { provide: VerificationService, useValue: {} },
      ],
    }).compile();
    service = module.get(SupplierService);
  });

  const gradesDto = {
    completenessGrade: 'A', responsivenessGrade: 'A', cooperationGrade: 'B',
    complianceGrade: 'A', comprehensiveGrade: 'B',
  } as any;

  describe('listEvaluationProjects（真实参评列表）', () => {
    it('供应商不存在 → 404 NOT_FOUND', async () => {
      prisma.supplier.findUnique.mockResolvedValue(null);
      await expect(service.listEvaluationProjects('nope')).rejects.toMatchObject({
        response: { code: 'NOT_FOUND' },
      });
      await expect(service.listEvaluationProjects('nope')).rejects.toThrow(NotFoundException);
    });

    it('按 BidSupplier 行返回，评标结果按 BidSupplier.id 匹配（非 Supplier.id）', async () => {
      prisma.bidSupplier.findMany.mockResolvedValue([
        {
          id: 'bs1', projectId: 'p1', downloadStatus: '已下载', submitStatus: '已提交',
          decryptStatus: 'SUCCESS', confirmStatus: 'CONFIRMED',
          project: { id: 'p1', name: '英雄项目', stage: 'EVALUATING', procurementMethod: '公开招标', openTime: now, deadline: now },
        },
        {
          id: 'bs2', projectId: 'p2', downloadStatus: '已下载', submitStatus: '已提交',
          decryptStatus: 'SUCCESS', confirmStatus: 'CONFIRMED',
          project: { id: 'p2', name: '常规项目', stage: 'ARCHIVED', procurementMethod: '公开招标', openTime: now, deadline: now },
        },
      ]);
      // 结果只挂 bs1（rank 1 中标候选）；若误用 Supplier.id('s1') 匹配则两条都空
      prisma.bidEvaluationResult.findMany.mockResolvedValue([
        { supplierId: 'bs1', rank: 1, recommended: true, disqualified: false, bidPrice: '980000.00', generatedAt: now },
      ]);

      const rows = await service.listEvaluationProjects('s1');
      expect(rows).toHaveLength(2);
      expect(rows[0]).toMatchObject({ projectId: 'p1', submitStatus: '已提交' });
      expect(rows[0].result).toMatchObject({ rank: 1, recommended: true, disqualified: false, bidPrice: 980000 });
      expect(rows[1].result).toBeNull();
      expect(prisma.bidEvaluationResult.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { supplierId: { in: ['bs1', 'bs2'] } } }),
      );
    });
  });

  describe('listEvaluations（附项目名）', () => {
    it('projectId 裸列手工补齐项目名；通用评价 project=null', async () => {
      prisma.supplierEvaluation.findMany.mockResolvedValue([
        { id: 'ev1', projectId: 'p1', createdAt: now },
        { id: 'ev2', projectId: null, createdAt: now },
      ]);
      prisma.bidProject.findMany.mockResolvedValue([{ id: 'p1', name: '英雄项目', stage: 'EVALUATING' }]);

      const rows = await service.listEvaluations('s1');
      expect(rows[0].project).toMatchObject({ id: 'p1', name: '英雄项目' });
      expect(rows[1].project).toBeNull();
    });
  });

  describe('createEvaluation（关联项目真实性校验）', () => {
    it('项目不存在 → 400 PROJECT_NOT_FOUND', async () => {
      prisma.bidProject.findUnique.mockResolvedValue(null);
      await expect(service.createEvaluation('s1', 'staff-1', { ...gradesDto, projectId: 'pX' }, 'staff'))
        .rejects.toMatchObject({ response: { code: 'PROJECT_NOT_FOUND' } });
      expect(prisma.supplierEvaluation.create).not.toHaveBeenCalled();
    });

    it('供应商未参与该项目 → 400 SUPPLIER_NOT_ON_PROJECT', async () => {
      prisma.bidSupplier.findFirst.mockResolvedValue(null);
      await expect(service.createEvaluation('s1', 'staff-1', { ...gradesDto, projectId: 'p1' }, 'staff'))
        .rejects.toMatchObject({ response: { code: 'SUPPLIER_NOT_ON_PROJECT' } });
      expect(prisma.supplierEvaluation.create).not.toHaveBeenCalled();
    });

    it('真实参与 → projectId 随评价落库', async () => {
      await service.createEvaluation('s1', 'staff-1', { ...gradesDto, projectId: 'p1' }, 'staff');
      expect(prisma.supplierEvaluation.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ supplierId: 's1', projectId: 'p1', evaluatorId: 'staff-1' }) }),
      );
    });

    it('不传 projectId（通用评价）→ 不触发项目校验、projectId 落 null', async () => {
      await service.createEvaluation('s1', 'staff-1', gradesDto, 'staff');
      expect(prisma.bidProject.findUnique).not.toHaveBeenCalled();
      expect(prisma.supplierEvaluation.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ projectId: undefined }) }),
      );
    });
  });
});
