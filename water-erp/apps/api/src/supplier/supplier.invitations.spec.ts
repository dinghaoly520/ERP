import { SupplierService } from './supplier.service';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationService } from '../notification/notification.service';
import { VerificationService } from '../verification/verification.service';
import { LlmService } from '../local-ai/llm.service';
import { CompanyScopeService, NO_COMPANY } from '../company/company-scope';

/**
 * 邀请码历史公司隔离（2026-10-16 用户裁定）：非 admin 仅看本司创建人生成的邀请码——
 * 经创建人 User.companyId 关联过滤（真实 CompanyScopeService + mock prisma），
 * admin 全量；无归属创建人落 NO_COMPANY 哨兵=空集。
 */
describe('SupplierService.listInvitations — 公司隔离', () => {
  let service: SupplierService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      supplierInvitation: {
        updateMany: jest.fn().mockResolvedValue({ count: 0 }), // syncExpiredStatus
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
      },
      user: { findUnique: jest.fn().mockResolvedValue(null), findFirst: jest.fn().mockResolvedValue(null), create: jest.fn(), findMany: jest.fn().mockResolvedValue([]) },
      company: { findUnique: jest.fn().mockResolvedValue(null), findMany: jest.fn().mockResolvedValue([]), upsert: jest.fn() },
      supplierContact: { findFirst: jest.fn().mockResolvedValue(null) },
      fileAsset: { findMany: jest.fn().mockResolvedValue([]), updateMany: jest.fn() },
      $transaction: jest.fn(async (fn: any) => fn({ ...prisma })),
    };
    const { Test } = await import('@nestjs/testing');
    const module = await Test.createTestingModule({
      providers: [
        CompanyScopeService, // 真 scope 引擎：resolveScope/filter 逻辑一并覆盖
        SupplierService,
        { provide: PrismaService, useValue: prisma },
        { provide: NotificationService, useValue: { sendToRole: jest.fn().mockResolvedValue({}), sendToUser: jest.fn().mockResolvedValue({}) } },
        { provide: 'REDIS_CLIENT', useValue: {} },
        { provide: LlmService, useValue: {} },
        { provide: VerificationService, useValue: { assertRegistrationCodeForUpload: jest.fn().mockResolvedValue({}) } },
      ],
    }).compile();
    service = module.get(SupplierService);
  });

  const whereUsed = () => prisma.supplierInvitation.findMany.mock.calls[0][0].where;

  it('admin → 全量视角：where 不含 createdBy 关联过滤', async () => {
    await service.listInvitations({ actor: { sub: 'u-admin', role: 'admin' } });
    expect(whereUsed()).toEqual({});
  });

  it('admin + status 过滤 → 仅按 status，无公司过滤', async () => {
    await service.listInvitations({ status: 'USED', actor: { sub: 'u-admin', role: 'admin' } });
    expect(whereUsed()).toEqual({ status: 'USED' });
  });

  it('leader（有公司）→ 经创建人 companyId 过滤仅本司', async () => {
    prisma.user.findUnique.mockResolvedValue({ companyId: 'co-swhi' });
    await service.listInvitations({ actor: { sub: 'u-leader', role: 'leader' } });
    expect(whereUsed()).toEqual({ createdBy: { companyId: { in: ['co-swhi'] } } });
  });

  it('leader（无公司）→ NO_COMPANY 哨兵空集，不泄漏无归属创建人', async () => {
    prisma.user.findUnique.mockResolvedValue({ companyId: null });
    await service.listInvitations({ actor: { sub: 'u-leader', role: 'leader' } });
    expect(whereUsed()).toEqual({ createdBy: { companyId: { in: [NO_COMPANY] } } });
  });

  it('leader + status → 过滤叠加', async () => {
    prisma.user.findUnique.mockResolvedValue({ companyId: 'co-swhi' });
    await service.listInvitations({ status: 'ACTIVE', actor: { sub: 'u-leader', role: 'leader' } });
    expect(whereUsed()).toEqual({ status: 'ACTIVE', createdBy: { companyId: { in: ['co-swhi'] } } });
  });

  it('count 与 findMany 同 where（分页计数隔离口径一致）', async () => {
    prisma.user.findUnique.mockResolvedValue({ companyId: 'co-swhi' });
    await service.listInvitations({ actor: { sub: 'u-leader', role: 'leader' } });
    expect(prisma.supplierInvitation.count).toHaveBeenCalledWith({ where: whereUsed() });
  });
});
