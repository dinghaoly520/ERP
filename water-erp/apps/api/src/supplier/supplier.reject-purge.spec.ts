import { SupplierService } from './supplier.service';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationService } from '../notification/notification.service';
import { VerificationService } from '../verification/verification.service';
import { LlmService } from '../local-ai/llm.service';
import { CompanyScopeService } from '../company/company-scope';

describe('SupplierService.reject — 数据最小化清洗', () => {
  let service: SupplierService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      supplier: {
        findUnique: jest.fn()
          .mockResolvedValueOnce({ id: 's1', userId: 'u1', name: '测试公司', creditCode: '91510000MA62K5XX0X', supplierNo: 'SUP-000001', reviewStage: 'STAFF', companyId: null, status: 'PENDING' })
          .mockResolvedValueOnce({ id: 's1' })
          .mockResolvedValue(null), // buildApprovalSnapshot → null → recordApproval 短路
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        update: jest.fn().mockResolvedValue({}),
      },
      user: {
        findUnique: jest.fn().mockResolvedValue({ id: 'u1', role: 'admin' }),
        update: jest.fn().mockResolvedValue({}),
      },
      supplierContact: { deleteMany: jest.fn().mockResolvedValue({ count: 1 }) },
      supplierQualification: { deleteMany: jest.fn().mockResolvedValue({ count: 1 }) },
      supplierBankAccount: { deleteMany: jest.fn().mockResolvedValue({ count: 1 }) },
      supplierPerformance: { deleteMany: jest.fn().mockResolvedValue({ count: 1 }) },
      supplierClassificationLink: { deleteMany: jest.fn().mockResolvedValue({ count: 1 }) },
      supplierApprovalRecord: {
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn().mockResolvedValue({}),
        update: jest.fn().mockResolvedValue({}),
      },
      fileAsset: { findMany: jest.fn().mockResolvedValue([]), deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
      $transaction: jest.fn(async (fn: any) => fn({ ...prisma, $queryRaw: jest.fn() })),
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

  it('reject 后清洗：子表删空（where=supplierId）', async () => {
    await service.reject('s1', '资料不合规', 'u1', []);

    expect(prisma.supplierContact.deleteMany).toHaveBeenCalledWith({ where: { supplierId: 's1' } });
    expect(prisma.supplierQualification.deleteMany).toHaveBeenCalledWith({ where: { supplierId: 's1' } });
    expect(prisma.supplierBankAccount.deleteMany).toHaveBeenCalledWith({ where: { supplierId: 's1' } });
    expect(prisma.supplierPerformance.deleteMany).toHaveBeenCalledWith({ where: { supplierId: 's1' } });
    expect(prisma.supplierClassificationLink.deleteMany).toHaveBeenCalledWith({ where: { supplierId: 's1' } });
  });

  it('reject 后清洗：Supplier 业务字段置空（仅留壳字段）', async () => {
    await service.reject('s1', '资料不合规', 'u1', []);

    const supplierUpdate = prisma.supplier.update.mock.calls.find((c: any[]) => c[0]?.where?.id === 's1');
    expect(supplierUpdate).toBeTruthy();
    expect(supplierUpdate[0].data).toMatchObject({
      enterpriseType: '',
      legalPerson: '',
      registeredAddress: '',
      businessScope: '',
      legalPersonIdCard: null,
      legalPersonPhone: null,
      organizationCode: null,
      tags: [],
    });
  });

  it('reject 后清洗：User 敏感列置 null（phoneIdx 释放账号手机号 + passwordHash 置 null）', async () => {
    await service.reject('s1', '资料不合规', 'u1', []);

    const userUpdate = prisma.user.update.mock.calls.find((c: any[]) => c[0]?.where?.id === 'u1');
    expect(userUpdate).toBeTruthy();
    expect(userUpdate[0].data).toMatchObject({
      displayName: '',
      email: null,
      phone: null,
      phoneIdx: null,
      passwordHash: null,
      passwordVault: null,
    });
  });

  it('reject 后清洗：审批快照最小化（按 supplierId 拉取全量记录）', async () => {
    await service.reject('s1', '资料不合规', 'u1', []);

    expect(prisma.supplierApprovalRecord.findMany).toHaveBeenCalledWith({
      where: { supplierId: 's1' },
      select: { id: true, action: true, stage: true, reason: true },
    });
  });

  it('reject 后清洗：删除该用户 qualification/general 附件元数据', async () => {
    await service.reject('s1', '资料不合规', 'u1', []);

    expect(prisma.fileAsset.findMany).toHaveBeenCalledWith({
      where: { uploaderId: 'u1', category: { in: ['qualification', 'general'] } },
      select: { id: true, key: true, sealedPath: true },
    });
  });

  it('reject（F5）：审计 payload 含 purged:true（驳回即清洗，留痕与快照口径一致）', async () => {
    await service.reject('s1', '资料不合规', 'u1', []);

    expect(prisma.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        userId: 'u1',
        action: 'SUPPLIER_REJECTED',
        resourceId: 's1',
        details: expect.objectContaining({ purged: true }),
      }),
    }));
  });

  it('reject（F6）：清洗事务崩溃 → 驳回仍成功返回不 500（清洗残留留日志由运维收敛）', async () => {
    prisma.$transaction.mockRejectedValueOnce(new Error('db down'));

    await expect(service.reject('s1', '资料不合规', 'u1', [])).resolves.toBeTruthy();

    // 驳回语义已完整落库：REJECTED 状态写在前、清洗失败不回滚驳回结果
    expect(prisma.supplier.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: 's1' }),
      data: expect.objectContaining({ status: 'REJECTED' }),
    }));
  });
});
