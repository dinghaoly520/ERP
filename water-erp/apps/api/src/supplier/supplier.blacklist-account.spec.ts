import { Test, TestingModule } from '@nestjs/testing';
import { VerificationService } from '../verification/verification.service';
import { SupplierService } from './supplier.service';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationService } from '../notification/notification.service';
import { LlmService } from '../local-ai/llm.service';
import { CompanyScopeService } from '../company/company-scope';

/**
 * A-215 黑名单端点（POST :id/blacklist / :id/unblacklist）账号联动不变式（2026-10-15）。
 *
 * 拉黑入口有两条：PATCH :id/status（updateStatus，停账号）与 A-215 专用端点。
 * 此前 A-215 两侧都不碰 User.isActive——「列表页拉黑 → 详情页解除」混用两条入口时，
 * 解除后供应商回到 APPROVED 但账号仍停用，登录永返 ACCOUNT_PENDING（实测复现）。
 * 本 spec 锁定：两条 A-215 端点必须与 updateStatus/restoreStatus 同步联动账号。
 */
describe('SupplierService — blacklist 账号联动（A-215）', () => {
  let service: SupplierService;
  let prisma: any;

  const leader = { sub: 'u-leader', username: '领导', role: 'leader' } as never;

  beforeEach(async () => {
    prisma = {
      supplier: { findUnique: jest.fn(), updateMany: jest.fn(), findFirst: jest.fn() },
      user: { update: jest.fn().mockResolvedValue(undefined) },
      auditLog: { create: jest.fn().mockResolvedValue(undefined) },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        { provide: CompanyScopeService, useValue: { resolveScope: jest.fn().mockResolvedValue({ all: true }), filter: jest.fn().mockReturnValue({}), assertInScope: jest.fn(), stampFor: jest.fn().mockResolvedValue({}) } },
        SupplierService,
        { provide: VerificationService, useValue: {} },
        { provide: PrismaService, useValue: prisma },
        { provide: NotificationService, useValue: { create: jest.fn().mockResolvedValue(undefined), sendToUser: jest.fn().mockResolvedValue(undefined), sendToRole: jest.fn().mockResolvedValue(undefined) } },
        { provide: 'REDIS_CLIENT', useValue: { get: jest.fn(), set: jest.fn(), del: jest.fn(), incr: jest.fn(), expire: jest.fn(), ttl: jest.fn() } },
        { provide: LlmService, useValue: {} },
      ],
    }).compile();
    service = module.get<SupplierService>(SupplierService);
  });

  describe('blacklistSupplier', () => {
    it('拉黑必须联动停用账号（isActive=false），与 updateStatus 同口径', async () => {
      // 首次调用=入口校验取数，末次调用=回读结果；同一 shape 两用即可
      prisma.supplier.findUnique.mockResolvedValue({ id: 's1', name: '甲公司', status: 'APPROVED', userId: 'u1', companyId: null });
      prisma.supplier.updateMany.mockResolvedValue({ count: 1 });

      await service.blacklistSupplier('s1', '违规', leader);

      expect(prisma.user.update).toHaveBeenCalledWith({ where: { id: 'u1' }, data: { isActive: false } });
    });

    it('乐观锁冲突时不落账号停用', async () => {
      prisma.supplier.findUnique.mockResolvedValue({ id: 's1', name: '甲公司', status: 'APPROVED', userId: 'u1', companyId: null });
      prisma.supplier.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.blacklistSupplier('s1', '违规', leader)).rejects.toMatchObject({ response: { code: 'CONCURRENT_UPDATE' } });
      expect(prisma.user.update).not.toHaveBeenCalled();
    });
  });

  describe('unblacklistSupplier', () => {
    it('解除黑名单必须联动复激活账号（isActive=true）——混合入口断头态的病根', async () => {
      // 场景：供应商可能经 PATCH :id/status 拉黑（账号已被停用），详情页走 A-215 解除。
      // 解除只回滚 Supplier.status 不回滚账号 → APPROVED + isActive=false，供应商永无法登录。
      prisma.supplier.findUnique.mockResolvedValue({ id: 's1', name: '甲公司', status: 'BLACKLIST', userId: 'u1', companyId: null });
      prisma.supplier.updateMany.mockResolvedValue({ count: 1 });

      await service.unblacklistSupplier('s1', '整改完毕', leader);

      expect(prisma.supplier.updateMany).toHaveBeenCalledWith({
        where: { id: 's1', status: 'BLACKLIST' },
        data: { status: 'APPROVED', disableReason: null, eliminatedAt: null },
      });
      expect(prisma.user.update).toHaveBeenCalledWith({ where: { id: 'u1' }, data: { isActive: true } });
    });

    it('乐观锁冲突时不落账号复激活', async () => {
      prisma.supplier.findUnique.mockResolvedValue({ id: 's1', name: '甲公司', status: 'BLACKLIST', userId: 'u1', companyId: null });
      prisma.supplier.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.unblacklistSupplier('s1', '整改完毕', leader)).rejects.toMatchObject({ response: { code: 'CONCURRENT_UPDATE' } });
      expect(prisma.user.update).not.toHaveBeenCalled();
    });
  });
});
