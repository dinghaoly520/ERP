import { Test, TestingModule } from '@nestjs/testing';
import { ExpertAdminService } from './expert-admin.service';
import { ExpertExtractionService } from './expert-extraction.service';
import { PrismaService } from '../prisma/prisma.service';
import { ExpertExtractionAiService } from './expert-extraction-ai.service';
import { NotificationService } from '../notification/notification.service';
import { EmbeddingService } from '../local-ai/embedding.service';
import { LlmService } from '../local-ai/llm.service';
import { OcrService } from '../local-ai/ocr.service';
import { CompanyScopeService } from '../company/company-scope';
import { ExpertCrossConflictService } from './expert-cross-conflict.service';

/**
 * 2026-11-05 生产回归：procurement-ssyc /expert/repository 退库 404。
 * 根因＝专家只有 User 行（role=bid_expert）而无 ExpertProfile 行（sys_dump 迁移带入），
 * 列表按 role 过滤仍可见，updateProfileStatus 却在「专家档案不存在」上 404。
 * 修复＝状态机前置查询发现档案缺失时自愈补建最小档案，再走既有状态迁移。
 */
describe('ExpertAdminService — updateProfileStatus 无档案专家自愈建档', () => {
  let service: ExpertAdminService;
  let prisma: any;

  const admin = { sub: 'admin-1', role: 'admin', username: 'Swhi-CGZX-admin' } as any;

  beforeEach(async () => {
    prisma = {
      user: { findUnique: jest.fn(), update: jest.fn() },
      expertProfile: { findUnique: jest.fn(), create: jest.fn(), updateMany: jest.fn() },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
      $transaction: jest.fn().mockResolvedValue([]),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        { provide: CompanyScopeService, useValue: { resolveScope: jest.fn().mockResolvedValue({ all: true }), filter: jest.fn().mockReturnValue({}), assertInScope: jest.fn(), stampFor: jest.fn().mockResolvedValue({}) } },
        ExpertAdminService,
        { provide: PrismaService, useValue: prisma },
        { provide: ExpertExtractionAiService, useValue: { analyzeAndScore: jest.fn(), getMetrics: jest.fn().mockReturnValue({}), recordFallback: jest.fn() } },
        { provide: NotificationService, useValue: { create: jest.fn(), sendToRole: jest.fn() } },
        { provide: EmbeddingService, useValue: { embed: jest.fn().mockResolvedValue([]) } },
        { provide: LlmService, useValue: { chat: jest.fn(), chatJson: jest.fn(), getModel: jest.fn().mockReturnValue(null) } },
        { provide: OcrService, useValue: { isAvailable: jest.fn().mockResolvedValue(false), ocrImage: jest.fn() } },
        { provide: ExpertCrossConflictService, useValue: { checkCrossConflicts: jest.fn().mockResolvedValue([]) } },
        { provide: ExpertExtractionService, useValue: { extendedRuleScore: jest.fn() } },
      ],
    }).compile();
    service = module.get<ExpertAdminService>(ExpertAdminService);
  });

  it('退库：无档案行时补建最小档案并完成状态迁移（不再 404）', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: 'e1', displayName: '杨睿', role: 'bid_expert', companyId: 'co-1' });
    // 第 1 次＝状态机前置查询（null 触发自愈）；第 2 次＝事务后回显
    prisma.expertProfile.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValue({ userId: 'e1', entryStatus: 'RETIRED', statusNote: '测试退库', retiredAt: new Date('2026-11-05') });
    prisma.expertProfile.create.mockResolvedValue({ entryStatus: 'PENDING', retiredAt: null });
    prisma.expertProfile.updateMany.mockResolvedValue({ count: 1 });
    prisma.user.update.mockResolvedValue({});

    const res = await service.updateProfileStatus('e1', { status: 'RETIRED', reason: '测试退库' }, admin);

    // 自愈建档：占位专业 + 留痕备注
    expect(prisma.expertProfile.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ userId: 'e1', specialty: '未登记' }),
    }));
    // 状态迁移照常：档案 RETIRED+停用，账号下线
    expect(prisma.expertProfile.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { userId: 'e1' },
      data: expect.objectContaining({ entryStatus: 'RETIRED', availability: '停用' }),
    }));
    expect(prisma.user.update).toHaveBeenCalledWith({ where: { id: 'e1' }, data: { isActive: false } });
    expect(res?.entryStatus).toBe('RETIRED');
  });

  it('档案齐全时行为不变：不触发自愈建档', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: 'e2', displayName: '张某', role: 'bid_expert', companyId: 'co-1' });
    prisma.expertProfile.findUnique
      .mockResolvedValueOnce({ entryStatus: 'ACTIVE', retiredAt: null })
      .mockResolvedValue({ userId: 'e2', entryStatus: 'SUSPENDED', statusNote: '暂停事由' });
    prisma.expertProfile.updateMany.mockResolvedValue({ count: 1 });

    const res = await service.updateProfileStatus('e2', { status: 'SUSPENDED', reason: '暂停事由' }, admin);

    expect(prisma.expertProfile.create).not.toHaveBeenCalled();
    expect(prisma.expertProfile.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ entryStatus: 'SUSPENDED' }),
    }));
    expect(res?.entryStatus).toBe('SUSPENDED');
  });
});
