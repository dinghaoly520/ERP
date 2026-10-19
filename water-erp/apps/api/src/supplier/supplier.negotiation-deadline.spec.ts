import { ConflictException } from '@nestjs/common';
import { BID_DEADLINE_BEFORE_OPENING_MS } from '@water-erp/shared';
import { SupplierService } from './supplier.service';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationService } from '../notification/notification.service';
import { VerificationService } from '../verification/verification.service';
import { LlmService } from '../local-ai/llm.service';
import { CompanyScopeService } from '../company/company-scope';

/**
 * 谈判配置下发截标推导（2026-10-19 实录修复）：sendNegotiationConfig 曾硬编码
 * 「开标前 24h」推 deadline，与 2026-10-16 正式口径（BID_DEADLINE_BEFORE_OPENING_MS=10 分钟）
 * 漂移——当天开标的谈判项目 deadline 直接落到一天前，供应商端投标机会列表
 * （deadline > now 闸门）整体不可见。本 spec 锁定：截标=开标−共享常量，间隔随常量走。
 */
describe('SupplierService.sendNegotiationConfig — 截标=开标前共享间隔常量', () => {
  let service: SupplierService;
  let prisma: any;
  let redis: any;

  const dto = {
    projectId: 'p-nego-1',
    supplierIds: [],
    acquireStartTime: '2026-10-17 09:00',
    acquireEndTime: '2026-10-26 15:00',
    bidOpeningTime: '2026-10-19 11:30',
    refFileKeys: [],
    attachFileIds: [],
    downloadMode: 'free',
  };

  beforeEach(async () => {
    prisma = {
      bidProject: {
        findUnique: jest.fn().mockResolvedValue(null),
        update: jest.fn().mockResolvedValue({}),
      },
      supplier: { findMany: jest.fn().mockResolvedValue([]) },
      bidSupplier: { upsert: jest.fn().mockResolvedValue({}), findMany: jest.fn().mockResolvedValue([]) },
      notification: { findMany: jest.fn().mockResolvedValue([]) },
    };
    redis = { get: jest.fn().mockResolvedValue(null), set: jest.fn().mockResolvedValue(undefined) };
    const { Test } = await import('@nestjs/testing');
    const module = await Test.createTestingModule({
      providers: [
        CompanyScopeService,
        SupplierService,
        { provide: PrismaService, useValue: prisma },
        { provide: NotificationService, useValue: { sendToRole: jest.fn(), sendToUser: jest.fn() } },
        { provide: 'REDIS_CLIENT', useValue: redis },
        { provide: LlmService, useValue: { chat: jest.fn().mockResolvedValue('概览') } },
        { provide: VerificationService, useValue: { assertRegistrationCodeForUpload: jest.fn() } },
      ],
    }).compile();
    service = module.get(SupplierService);
  });

  const writtenData = () => prisma.bidProject.update.mock.calls[0][0].data;

  it('首次下发：deadline = bidOpeningTime − BID_DEADLINE_BEFORE_OPENING_MS（非硬编码 24h）', async () => {
    await service.sendNegotiationConfig(dto as any);
    const opening = new Date(dto.bidOpeningTime);
    const data = writtenData();
    expect(data.openTime.getTime()).toBe(opening.getTime());
    expect(opening.getTime() - data.deadline.getTime()).toBe(BID_DEADLINE_BEFORE_OPENING_MS);
  });

  it('曾下发且截标已固化（过期）→ 重发派生出不同截标 → 409 DEADLINE_FROZEN', async () => {
    redis.get.mockResolvedValue(JSON.stringify({ deliveredAt: '2026-10-19T02:38:00Z' }));
    prisma.bidProject.findUnique.mockResolvedValue({ deadline: new Date(Date.now() - 3600_000) });
    const err = await service.sendNegotiationConfig(dto as any).catch((e) => e);
    expect(err).toBeInstanceOf(ConflictException);
    expect((err.getResponse?.() as any).code).toBe('DEADLINE_FROZEN');
    expect(prisma.bidProject.update).not.toHaveBeenCalled();
  });

  it('曾下发但派生截标与已固化值相同 → 放行（幂等重发不触发冻结）', async () => {
    redis.get.mockResolvedValue(JSON.stringify({ deliveredAt: '2026-10-19T02:38:00Z' }));
    const sameDeadline = new Date(new Date(dto.bidOpeningTime).getTime() - BID_DEADLINE_BEFORE_OPENING_MS);
    prisma.bidProject.findUnique.mockResolvedValue({ deadline: sameDeadline });
    await expect(service.sendNegotiationConfig(dto as any)).resolves.toBeTruthy();
    expect(prisma.bidProject.update).toHaveBeenCalled();
  });
});
