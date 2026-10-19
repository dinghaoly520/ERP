import { Test } from '@nestjs/testing';
import { ForbiddenException } from '@nestjs/common';
import { LlmService } from '../local-ai/llm.service';
import { NotificationService } from '../notification/notification.service';
import { PrismaService } from '../prisma/prisma.service';
import { VerificationService } from '../verification/verification.service';
import { SupplierService } from './supplier.service';
import { CompanyScopeService } from '../company/company-scope';

/**
 * 供应商总览/资质预警页公司隔离（2026-10-19）：
 * list/stats/资质预警/评价统计等主查询已接 supplierCompanyWhere，但总览页三个旁路端点
 * 完全裸查——近期动态（auditLog 全量，跨公司供应商名外泄）、分类计数（_count 全量）、
 * 我的收藏（按 id 解析供应商不看视野）。本 spec 锁定三端点按视野收敛：
 *  - listClassifications：_count.suppliers 过滤计数（库口径=APPROVED link-only）；
 *  - getRecentActivities：限定 resourceId∈视野供应商（双谓词=link OR 主归属，审批流转件
 *    终审落 link 前只有 Supplier.companyId，对齐 C1 2026-10-19 审批流口径）；
 *  - getFavorites：解析供应商按 link 视野过滤（出视野收藏不展示）。
 */
describe('SupplierService — 总览旁路端点公司隔离', () => {
  let service: SupplierService;
  let prisma: any;
  let companyScope: { resolveScope: jest.Mock; assertInScope: jest.Mock };
  let notification: any;

  const ACTOR_LEADER = { sub: 'leader-1', role: 'leader', username: 'Swhi-JS-01' };

  beforeEach(async () => {
    prisma = {
      supplier: { count: jest.fn().mockResolvedValue(0), findMany: jest.fn().mockResolvedValue([]), findUnique: jest.fn().mockResolvedValue(null) },
      supplierFavorite: { findMany: jest.fn().mockResolvedValue([]) },
      supplierClassification: { findMany: jest.fn().mockResolvedValue([]) },
      supplierEvaluation: { findMany: jest.fn().mockResolvedValue([]) },
      supplierQualification: { findUnique: jest.fn().mockResolvedValue(null) },
      supplierCompanyLink: { findMany: jest.fn().mockResolvedValue([]) },
      auditLog: { findMany: jest.fn().mockResolvedValue([]), count: jest.fn().mockResolvedValue(0) },
      user: { findUnique: jest.fn().mockResolvedValue(null), findMany: jest.fn().mockResolvedValue([]) },
    };
    companyScope = {
      resolveScope: jest.fn().mockResolvedValue({ all: false, companyIds: ['co-js'] }),
      // 与 CompanyScopeService.assertInScope 同语义（assertSupplierInScope 落空时走它抛 403）
      assertInScope: jest.fn((companyId: string | null | undefined, scope: any) => {
        if (scope.all) return;
        if (companyId == null || !scope.companyIds.includes(companyId)) {
          throw new ForbiddenException({ error: '该数据不属于本公司，无权访问', code: 'COMPANY_SCOPE_FORBIDDEN' });
        }
      }),
    };
    notification = { create: jest.fn(), sendToRole: jest.fn(), sendToUser: jest.fn().mockResolvedValue({ results: {} }) };
    const module = await Test.createTestingModule({
      providers: [
        { provide: CompanyScopeService, useValue: companyScope },
        SupplierService,
        { provide: PrismaService, useValue: prisma },
        { provide: NotificationService, useValue: notification },
        { provide: 'REDIS_CLIENT', useValue: {} },
        { provide: LlmService, useValue: {} },
        { provide: VerificationService, useValue: {} },
      ],
    }).compile();
    service = module.get(SupplierService);
  });

  describe('listClassifications', () => {
    it('有 actor：_count.suppliers 带 link 过滤（公司内计数，非全量）', async () => {
      await service.listClassifications(ACTOR_LEADER as any);
      const arg = prisma.supplierClassification.findMany.mock.calls[0][0];
      expect(arg.include._count.select.suppliers.where).toEqual({
        companyLinks: { some: { companyId: { in: ['co-js'] }, status: 'APPROVED' } },
      });
    });

    it('无 actor（大屏等内部调用）：保持全量计数不变', async () => {
      await service.listClassifications();
      const arg = prisma.supplierClassification.findMany.mock.calls[0][0];
      expect(arg.include._count.select.suppliers).toEqual(true);
    });
  });

  describe('getRecentActivities', () => {
    it('限定公司：先取视野内供应商 id（双谓词 link OR 主归属），auditLog 限定 resourceId', async () => {
      prisma.supplier.findMany.mockResolvedValue([{ id: 'sup-1' }, { id: 'sup-2' }]);
      await service.getRecentActivities(15, ACTOR_LEADER as any);
      // 视野内供应商取数=审批流双谓词（PENDING/RETURNED 流转件终审前只有 Supplier.companyId）
      const supWhere = prisma.supplier.findMany.mock.calls[0][0].where;
      expect(supWhere.OR).toEqual([
        { companyLinks: { some: { companyId: { in: ['co-js'] }, status: 'APPROVED' } } },
        { companyId: { in: ['co-js'] } },
      ]);
      const auditWhere = prisma.auditLog.findMany.mock.calls[0][0].where;
      expect(auditWhere.resourceId).toEqual({ in: ['sup-1', 'sup-2'] });
    });

    it('视野为空集：resourceId IN [] 恒空（不出全量兜底）', async () => {
      prisma.supplier.findMany.mockResolvedValue([]);
      await service.getRecentActivities(15, ACTOR_LEADER as any);
      const auditWhere = prisma.auditLog.findMany.mock.calls[0][0].where;
      expect(auditWhere.resourceId).toEqual({ in: [] });
    });

    it('无 actor：不加 resourceId 过滤（原行为）', async () => {
      await service.getRecentActivities(15);
      const auditWhere = prisma.auditLog.findMany.mock.calls[0][0].where;
      expect(auditWhere.resourceId).toBeUndefined();
      expect(prisma.supplier.findMany).not.toHaveBeenCalled();
    });

    it('admin 全部公司视野：不加 resourceId 过滤', async () => {
      companyScope.resolveScope.mockResolvedValue({ all: true });
      await service.getRecentActivities(15, { sub: 'a', role: 'admin' } as any);
      const auditWhere = prisma.auditLog.findMany.mock.calls[0][0].where;
      expect(auditWhere.resourceId).toBeUndefined();
    });
  });

  describe('getFavorites', () => {
    it('有 actor：解析供应商叠加 link 视野过滤（出视野收藏不返回）', async () => {
      prisma.supplierFavorite.findMany.mockResolvedValue([
        { id: 'fav-1', supplierId: 'sup-in', createdAt: new Date() },
        { id: 'fav-2', supplierId: 'sup-out', createdAt: new Date() },
      ]);
      prisma.supplier.findMany.mockResolvedValue([{ id: 'sup-in', name: '本公司供应商', enterpriseType: null, classification: null }]);
      const res = await service.getFavorites('u-1', ACTOR_LEADER as any);
      const arg = prisma.supplier.findMany.mock.calls[0][0];
      expect(arg.where).toEqual({
        id: { in: ['sup-in', 'sup-out'] },
        companyLinks: { some: { companyId: { in: ['co-js'] }, status: 'APPROVED' } },
      });
      expect(res).toHaveLength(1);
      expect(res[0].supplierId).toBe('sup-in');
    });

    it('无 actor：保持按 id 原样解析', async () => {
      prisma.supplierFavorite.findMany.mockResolvedValue([
        { id: 'fav-1', supplierId: 'sup-in', createdAt: new Date() },
      ]);
      prisma.supplier.findMany.mockResolvedValue([{ id: 'sup-in', name: 'x', enterpriseType: null, classification: null }]);
      await service.getFavorites('u-1');
      const arg = prisma.supplier.findMany.mock.calls[0][0];
      expect(arg.where).toEqual({ id: { in: ['sup-in'] } });
    });
  });

  describe('reviewEliminationCandidates（淘汰候选）', () => {
    it('限定公司：候选扫描叠加 link 过滤，知会只发视野公司 approvers（不再平台全员）', async () => {
      prisma.supplier.findMany.mockResolvedValue([{ id: 'sup-1', name: '低分供应商' }]); // 候选扫描
      prisma.user.findMany.mockResolvedValue([{ id: 'approver-1' }]); // resolveCompanyApprovers
      prisma.supplierEvaluation.findMany.mockResolvedValue([{ finalGrade: 'E' }, { finalGrade: 'E' }, { finalGrade: 'E' }]);
      await service.reviewEliminationCandidates(ACTOR_LEADER as any);
      expect(prisma.supplier.findMany.mock.calls[0][0].where).toEqual({
        status: 'APPROVED',
        companyLinks: { some: { companyId: { in: ['co-js'] }, status: 'APPROVED' } },
      });
      expect(prisma.user.findMany).toHaveBeenCalledWith(expect.objectContaining({
        where: expect.objectContaining({ companyId: 'co-js' }),
      }));
      expect(notification.create).toHaveBeenCalled();
      expect(notification.sendToRole).not.toHaveBeenCalled();
    });

    it('全部公司视野（admin 默认）：保持平台全员 sendToRole 原行为', async () => {
      companyScope.resolveScope.mockResolvedValue({ all: true });
      prisma.supplier.findMany.mockResolvedValue([]);
      await service.reviewEliminationCandidates({ sub: 'a', role: 'admin' } as any);
      expect(notification.sendToRole).not.toHaveBeenCalled(); // 无候选不发
      prisma.supplier.findMany.mockResolvedValue([{ id: 's', name: 'n' }]);
      prisma.supplierEvaluation.findMany.mockResolvedValue([{ finalGrade: 'E' }, { finalGrade: 'E' }, { finalGrade: 'E' }]);
      await service.reviewEliminationCandidates({ sub: 'a', role: 'admin' } as any);
      expect(notification.sendToRole).toHaveBeenCalledWith('leader', expect.anything());
      expect(notification.sendToRole).toHaveBeenCalledWith('staff', expect.anything());
    });
  });

  describe('listSupplierAuditLogs（操作历史）', () => {
    it('全局模式限定公司：resourceId∈视野供应商（双谓词集）', async () => {
      prisma.supplier.findMany.mockResolvedValue([{ id: 'sup-1' }]);
      await service.listSupplierAuditLogs({ page: 1, pageSize: 10 }, ACTOR_LEADER as any);
      const supWhere = prisma.supplier.findMany.mock.calls[0][0].where;
      expect(supWhere.OR).toEqual([
        { companyLinks: { some: { companyId: { in: ['co-js'] }, status: 'APPROVED' } } },
        { companyId: { in: ['co-js'] } },
      ]);
      expect(prisma.auditLog.findMany.mock.calls[0][0].where.resourceId).toEqual({ in: ['sup-1'] });
      expect(prisma.auditLog.count.mock.calls[0][0].where.resourceId).toEqual({ in: ['sup-1'] });
    });

    it('按供应商模式：出视野供应商 → 403；视野内放行', async () => {
      prisma.supplier.findUnique.mockResolvedValue({ id: 'sup-x', companyId: 'co-other' });
      await expect(service.listSupplierAuditLogs({ page: 1, pageSize: 10, supplierId: 'sup-x' }, ACTOR_LEADER as any))
        .rejects.toMatchObject({ response: { code: 'COMPANY_SCOPE_FORBIDDEN' } });
      prisma.supplier.findUnique.mockResolvedValue({ id: 'sup-x', companyId: 'co-js' });
      await expect(service.listSupplierAuditLogs({ page: 1, pageSize: 10, supplierId: 'sup-x' }, ACTOR_LEADER as any))
        .resolves.toBeDefined();
      expect(prisma.auditLog.findMany.mock.calls[0][0].where.resourceId).toBe('sup-x');
    });

    it('无 actor：原行为不变（不注入视野）', async () => {
      await service.listSupplierAuditLogs({ page: 1, pageSize: 10 });
      const where = prisma.auditLog.findMany.mock.calls[0][0].where;
      expect(where.resourceId).toBeUndefined();
    });
  });

  describe('notifyQualificationAlert（资质提醒发送）', () => {
    it('资质属他司供应商 → 403（原可直打 id 向任意供应商发提醒）', async () => {
      prisma.supplierQualification.findUnique.mockResolvedValue({
        id: 'q1', name: '资质', validTo: new Date(),
        supplier: { userId: 'u-sup', id: 'sup-x', companyId: 'co-other' },
      });
      await expect(service.notifyQualificationAlert('q1', 'u-staff', ACTOR_LEADER as any))
        .rejects.toMatchObject({ response: { code: 'COMPANY_SCOPE_FORBIDDEN' } });
      expect(notification.create).not.toHaveBeenCalled();
    });

    it('视野内供应商 → 正常发送', async () => {
      prisma.supplierQualification.findUnique.mockResolvedValue({
        id: 'q1', name: '资质', validTo: new Date(),
        supplier: { userId: 'u-sup', id: 'sup-x', companyId: 'co-js' },
      });
      const res = await service.notifyQualificationAlert('q1', 'u-staff', ACTOR_LEADER as any);
      expect(res).toEqual({ success: true });
      expect(notification.create).toHaveBeenCalled();
    });
  });

  describe('notifySuppliers（批量通知）', () => {
    it('出视野目标被过滤不发送，响应带 outOfScope 计数', async () => {
      prisma.supplier.findMany
        .mockResolvedValueOnce([{ id: 's1' }, { id: 's2' }]) // 存在性
        .mockResolvedValueOnce([{ id: 's1', name: '本公司', userId: 'u1' }]); // 视野内
      const res = await service.notifySuppliers(['s1', 's2', 's-nope'], ['inapp'], { type: 'T', title: 't', content: 'c' }, ACTOR_LEADER as any);
      expect(res.sent).toBe(1);
      expect(res.notFound).toBe(1);
      expect(res.outOfScope).toBe(1);
      expect(notification.sendToUser).toHaveBeenCalledTimes(1);
    });

    it('无 actor：原行为（全量发送，不滤）', async () => {
      prisma.supplier.findMany
        .mockResolvedValueOnce([{ id: 's1' }])
        .mockResolvedValueOnce([{ id: 's1', name: '本公司', userId: 'u1' }]);
      const res = await service.notifySuppliers(['s1'], ['inapp'], { type: 'T', title: 't', content: 'c' });
      expect(res.sent).toBe(1);
      expect(res.outOfScope).toBe(0);
    });
  });

  describe('compareProfiles（对比面板）', () => {
    it('有 actor：批量取数叠加 link 视野过滤（明文联系人电话不得出视野）', async () => {
      prisma.supplier.findMany.mockResolvedValue([]);
      await service.compareProfiles(['s1', 's2'], ACTOR_LEADER as any);
      const arg = prisma.supplier.findMany.mock.calls[0][0];
      expect(arg.where).toEqual({
        id: { in: ['s1', 's2'] },
        companyLinks: { some: { companyId: { in: ['co-js'] }, status: 'APPROVED' } },
      });
    });

    it('无 actor：原行为（不滤）', async () => {
      prisma.supplier.findMany.mockResolvedValue([]);
      await service.compareProfiles(['s1']);
      expect(prisma.supplier.findMany.mock.calls[0][0].where).toEqual({ id: { in: ['s1'] } });
    });
  });
});
