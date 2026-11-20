import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException } from '@nestjs/common';
import { VerificationService } from '../verification/verification.service';
import { SupplierService } from './supplier.service';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationService } from '../notification/notification.service';
import { LlmService } from '../local-ai/llm.service';
import { CompanyScopeService } from '../company/company-scope';

describe('SupplierService — 业务标签审批待办消音（2026-11-12 举一反三）', () => {
  let service: SupplierService;
  let prisma: any;
  let notification: any;

  beforeEach(async () => {
    prisma = {
      supplier: { findUnique: jest.fn() },
      businessTag: { findUnique: jest.fn(), update: jest.fn().mockResolvedValue({}) },
    };
    notification = {
      create: jest.fn(),
      sendToRole: jest.fn(),
      resolveActionable: jest.fn().mockResolvedValue({ count: 0 }),
      resolveActionableBySupplierName: jest.fn().mockResolvedValue({ count: 0 }),
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        { provide: CompanyScopeService, useValue: { resolveScope: jest.fn().mockResolvedValue({ all: true }), filter: jest.fn().mockReturnValue({}), assertInScope: jest.fn(), stampFor: jest.fn().mockResolvedValue({}) } },
        SupplierService,
        { provide: VerificationService, useValue: {} },
        { provide: PrismaService, useValue: prisma },
        { provide: NotificationService, useValue: notification },
        { provide: 'REDIS_CLIENT', useValue: { get: jest.fn(), set: jest.fn(), del: jest.fn(), incr: jest.fn(), expire: jest.fn(), ttl: jest.fn() } },
        { provide: LlmService, useValue: {} },
      ],
    }).compile();
    service = module.get<SupplierService>(SupplierService);
  });

  it('approveBusinessTag：按供应商名归因消音——甲司标签审毕只清甲司待办，并行在审的乙司不受牵连', async () => {
    prisma.businessTag.findUnique.mockResolvedValue({ id: 'tag1', status: 'PENDING', createdBySupplierId: 's-jia' });
    prisma.supplier.findUnique.mockResolvedValue({ name: '甲公司' });

    await service.approveBusinessTag('tag1');

    expect(notification.resolveActionableBySupplierName).toHaveBeenCalledWith('SUPPLIER_PENDING', '/supplier', '甲公司');
    // 不再无条件全清 generic 行（旧写法会把其它在审标签的审批待办一并抹掉=漏审）
    expect(notification.resolveActionable).not.toHaveBeenCalled();
  });

  it('rejectBusinessTag：同款名归因消音', async () => {
    prisma.businessTag.findUnique.mockResolvedValue({ id: 'tag2', status: 'PENDING', createdBySupplierId: 's-yi' });
    prisma.supplier.findUnique.mockResolvedValue({ name: '乙公司' });

    await service.rejectBusinessTag('tag2', 'rev1');

    expect(notification.resolveActionableBySupplierName).toHaveBeenCalledWith('SUPPLIER_PENDING', '/supplier', '乙公司');
    expect(notification.resolveActionable).not.toHaveBeenCalled();
  });

  it('无归属标签（createdBySupplierId 空）：名缺席不消音（宁留勿杀，由 sweep 队列对账兜底）', async () => {
    prisma.businessTag.findUnique.mockResolvedValue({ id: 'tag3', status: 'PENDING', createdBySupplierId: null });
    prisma.supplier.findUnique.mockResolvedValue(null);

    await service.approveBusinessTag('tag3');

    // resolveActionableBySupplierName 对空名是服务端 no-op——断言未退回无条件全清即可
    expect(notification.resolveActionable).not.toHaveBeenCalled();
  });
});

describe('SupplierService — 业务标签公司隔离（2026-11-20：审批中心「信息更新审批·业务标签」）', () => {
  let service: SupplierService;
  let prisma: any;
  let scopeSvc: any;

  beforeEach(async () => {
    prisma = {
      supplier: { findUnique: jest.fn(), findFirst: jest.fn() },
      businessTag: { findUnique: jest.fn(), findMany: jest.fn().mockResolvedValue([]), update: jest.fn().mockResolvedValue({}) },
    };
    const notification: any = {
      create: jest.fn(),
      sendToRole: jest.fn(),
      resolveActionable: jest.fn().mockResolvedValue({ count: 0 }),
      resolveActionableBySupplierName: jest.fn().mockResolvedValue({ count: 0 }),
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        { provide: CompanyScopeService, useValue: { resolveScope: jest.fn().mockResolvedValue({ all: true }), filter: jest.fn().mockReturnValue({}), assertInScope: jest.fn(), stampFor: jest.fn().mockResolvedValue({}) } },
        SupplierService,
        { provide: VerificationService, useValue: {} },
        { provide: PrismaService, useValue: prisma },
        { provide: NotificationService, useValue: notification },
        { provide: 'REDIS_CLIENT', useValue: { get: jest.fn(), set: jest.fn(), del: jest.fn(), incr: jest.fn(), expire: jest.fn(), ttl: jest.fn() } },
        { provide: LlmService, useValue: {} },
      ],
    }).compile();
    service = module.get(SupplierService);
    scopeSvc = module.get(CompanyScopeService);
  });

  const leaderJia = { sub: 'u-leader-jia', role: 'leader', companyId: 'co-jia' } as any;

  it('listBusinessTags：非 admin 注入 createdBySupplier 双谓词（APPROVED link OR 注册主归属——注册件尚无 link）', async () => {
    scopeSvc.resolveScope.mockResolvedValue({ all: false, companyIds: ['co-jia'] });

    await service.listBusinessTags('PENDING', leaderJia);

    expect(prisma.businessTag.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        status: 'PENDING',
        createdBySupplier: {
          OR: [
            { companyLinks: { some: { companyId: { in: ['co-jia'] }, status: 'APPROVED' } } },
            { companyId: { in: ['co-jia'] } },
          ],
        },
      }),
    }));
  });

  it('listBusinessTags：admin 全量视野零公司谓词（他司标签照常可见）', async () => {
    scopeSvc.resolveScope.mockResolvedValue({ all: true });

    await service.listBusinessTags('PENDING', { sub: 'u-admin', role: 'admin' } as any);

    const arg = prisma.businessTag.findMany.mock.calls[0][0];
    expect(arg.where).toEqual({ status: 'PENDING' });
    expect(arg.where).not.toHaveProperty('createdBySupplier');
  });

  it('approveBusinessTag：来源供应商不在本公司视野 → 403 COMPANY_SCOPE_FORBIDDEN，不落审、不消音', async () => {
    scopeSvc.resolveScope.mockResolvedValue({ all: false, companyIds: ['co-jia'] });
    prisma.businessTag.findUnique.mockResolvedValue({ id: 'tag-yi', status: 'PENDING', createdBySupplierId: 's-yi' });
    prisma.supplier.findFirst.mockResolvedValue(null); // 双谓词均未命中=乙司供应商

    await expect(service.approveBusinessTag('tag-yi', 'u-leader-jia', leaderJia))
      .rejects.toMatchObject({ response: { code: 'COMPANY_SCOPE_FORBIDDEN' } });
    expect(prisma.businessTag.update).not.toHaveBeenCalled();
  });

  it('approveBusinessTag：来源供应商经 APPROVED link 在本公司视野 → 放行落审', async () => {
    scopeSvc.resolveScope.mockResolvedValue({ all: false, companyIds: ['co-jia'] });
    prisma.businessTag.findUnique.mockResolvedValue({ id: 'tag-jia', status: 'PENDING', createdBySupplierId: 's-jia' });
    prisma.supplier.findFirst.mockResolvedValue({ id: 's-jia' });
    prisma.supplier.findUnique.mockResolvedValue({ name: '甲公司' });

    await service.approveBusinessTag('tag-jia', 'u-leader-jia', leaderJia);

    expect(prisma.businessTag.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'tag-jia' },
      data: expect.objectContaining({ status: 'APPROVED' }),
    }));
  });

  it('rejectBusinessTag：无归属标签（来源供应商已删/SetNull）非 admin → 403（未归属件归 admin，同注册审批口径）', async () => {
    scopeSvc.resolveScope.mockResolvedValue({ all: false, companyIds: ['co-jia'] });
    prisma.businessTag.findUnique.mockResolvedValue({ id: 'tag-orphan', status: 'PENDING', createdBySupplierId: null });

    await expect(service.rejectBusinessTag('tag-orphan', 'u-leader-jia', leaderJia))
      .rejects.toMatchObject({ response: { code: 'COMPANY_SCOPE_FORBIDDEN' } });
    expect(prisma.businessTag.update).not.toHaveBeenCalled();
  });

  it('approveBusinessTag：admin 对无归属标签照常可审（代审口径）', async () => {
    scopeSvc.resolveScope.mockResolvedValue({ all: true });
    prisma.businessTag.findUnique.mockResolvedValue({ id: 'tag-orphan', status: 'PENDING', createdBySupplierId: null });
    prisma.supplier.findUnique.mockResolvedValue(null);

    await service.approveBusinessTag('tag-orphan', 'u-admin', { sub: 'u-admin', role: 'admin' } as any);

    expect(prisma.businessTag.update).toHaveBeenCalled();
  });
});
