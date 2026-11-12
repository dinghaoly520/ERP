import { Test, TestingModule } from '@nestjs/testing';
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
