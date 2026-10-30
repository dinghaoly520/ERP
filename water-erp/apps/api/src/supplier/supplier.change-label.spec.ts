import { SupplierService } from './supplier.service';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationService } from '../notification/notification.service';
import { VerificationService } from '../verification/verification.service';
import { LlmService } from '../local-ai/llm.service';
import { CompanyScopeService } from '../company/company-scope';

/**
 * 供应商资料变更字段中文名：写侧归一落库 + 读侧存量归一（2026-10-29）。
 * 异构环境实录：待审列表「变更 2 项资料：legalRepresentative、address」——
 * 客户端把英文键当 label 落库直达 :3005/:3004 全部读端。
 */
describe('SupplierService 资料变更字段中文名归一', () => {
  let service: SupplierService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      supplier: {
        findUnique: jest.fn().mockResolvedValue({
          id: 's1', userId: 'u1', name: '测试公司', status: 'APPROVED',
          companyId: null, legalPerson: '张三',
        }),
      },
      supplierChangeRecord: {
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn().mockResolvedValue({ id: 'cr1' }),
      },
      user: { findMany: jest.fn().mockResolvedValue([]) },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
    };
    const { Test } = await import('@nestjs/testing');
    const module = await Test.createTestingModule({
      providers: [
        { provide: CompanyScopeService, useValue: { resolveScope: jest.fn().mockResolvedValue({ all: true }), filter: jest.fn().mockReturnValue({}), assertInScope: jest.fn(), stampFor: jest.fn().mockResolvedValue({}) } },
        SupplierService,
        { provide: PrismaService, useValue: prisma },
        { provide: NotificationService, useValue: { create: jest.fn().mockResolvedValue({}), sendToRole: jest.fn(), sendToUser: jest.fn(), resolveActionable: jest.fn().mockResolvedValue({}) } },
        { provide: 'REDIS_CLIENT', useValue: {} },
        { provide: LlmService, useValue: {} },
        { provide: VerificationService, useValue: {} },
      ],
    }).compile();
    service = module.get(SupplierService);
  });

  it('createChangeRequest：DTO 传英文键当 label → 落库归一为词表中文名', async () => {
    await service.createChangeRequest('s1', 'u1', {
      fieldName: 'legalPerson', fieldLabel: 'legalPerson', newValue: '李四', reason: '变更法人',
    } as any);
    expect(prisma.supplierChangeRecord.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ fieldLabel: '法定代表人', fieldName: 'legalPerson' }),
      }),
    );
  });

  it('listPendingChanges：存量脏行（英文键当 label）读出归一——白名单字段回词表、词表外落通用兜底', async () => {
    prisma.supplierChangeRecord.findMany.mockResolvedValue([
      { id: 'a', fieldName: 'legalPerson', fieldLabel: 'legalPerson', oldValue: null, newValue: null, supplier: { id: 's1', name: '甲', supplierNo: 'SUP-000001' } },
      { id: 'b', fieldName: 'legalRepresentative', fieldLabel: 'legalRepresentative', oldValue: null, newValue: null, supplier: { id: 's2', name: '乙', supplierNo: 'SUP-000002' } },
    ]);
    const rows = await service.listPendingChanges();
    expect(rows[0].fieldLabel).toBe('法定代表人');
    expect(rows[1].fieldLabel).toBe('资料信息');
  });

  it('listChanges：详情页变更记录同样归一（存量脏行不透英文）', async () => {
    prisma.supplierChangeRecord.findMany.mockResolvedValue([
      { id: 'b', fieldName: 'contactPhone', fieldLabel: 'contactPhone', oldValue: null, newValue: null, reviewedBy: null },
    ]);
    const rows = await service.listChanges('s1');
    expect(rows[0].fieldLabel).toBe('资料信息');
  });
});
