import { Test } from '@nestjs/testing';
import { BadRequestException, ForbiddenException, ConflictException } from '@nestjs/common';
import { ExpertAdminService } from './expert-admin.service';
import { PrismaService } from '../prisma/prisma.service';
import { ExpertCrossConflictService } from './expert-cross-conflict.service';
import { ExpertExtractionAiService } from './expert-extraction-ai.service';
import { NotificationService } from '../notification/notification.service';
import { EmbeddingService } from '../local-ai/embedding.service';
import { LlmService } from '../local-ai/llm.service';
import { OcrService } from '../local-ai/ocr.service';
import { ExpertExtractionService } from './expert-extraction.service';
import { CompanyScopeService } from '../company/company-scope';

/** 清空专家库名单·勾选式（2026-11-09 用户裁定：弹窗勾选+搜索+全选；仅勾选账号、评审记录保留） */
describe('ExpertAdminService.clearExpertRoster', () => {
  let service: ExpertAdminService;
  let prisma: any;
  let tx: any;

  const EXPERTS = [
    { id: 'e1', role: 'bid_expert', isTempExpert: false },
    { id: 'e2', role: 'bid_expert', isTempExpert: true }, // 临时需求方代表同属专家域
  ];

  beforeEach(async () => {
    tx = {
      auditLog: { updateMany: jest.fn().mockResolvedValue(7) },
      reviewTask: { deleteMany: jest.fn().mockResolvedValue(0) },
      user: { deleteMany: jest.fn().mockResolvedValue(2) },
    };
    prisma = {
      // 按 where.id.in 动态过滤（目标校验语义与真实查询一致）
      user: { findMany: jest.fn(async (args: any) =>
        EXPERTS.filter(e => (args?.where?.id?.in ?? EXPERTS.map(x => x.id)).includes(e.id))) },
      bidExpert: { findMany: jest.fn().mockResolvedValue([]) }, // 勾选集无项目绑定
      bidProject: { findMany: jest.fn().mockResolvedValue([]) },
      $transaction: jest.fn(async (fn: any) => fn(tx)),
      auditLog: { create: jest.fn().mockResolvedValue({}) },
    };
    const module = await Test.createTestingModule({
      providers: [
        ExpertAdminService,
        { provide: PrismaService, useValue: prisma },
        { provide: ExpertCrossConflictService, useValue: {} },
        { provide: ExpertExtractionAiService, useValue: {} },
        { provide: NotificationService, useValue: {} },
        { provide: EmbeddingService, useValue: {} },
        { provide: LlmService, useValue: {} },
        { provide: OcrService, useValue: {} },
        { provide: ExpertExtractionService, useValue: {} },
        { provide: CompanyScopeService, useValue: {} },
      ],
    }).compile();
    service = module.get(ExpertAdminService);
  });

  afterEach(() => { process.env.NODE_ENV = 'test'; });

  it('确认词不匹配 → 400，不触库', async () => {
    await expect(service.clearExpertRoster('op1', '清空列表', ['e1'])).rejects.toThrow(BadRequestException);
    expect(prisma.user.findMany).not.toHaveBeenCalled();
  });

  it('生产环境 → 403 硬拒', async () => {
    process.env.NODE_ENV = 'production';
    await expect(service.clearExpertRoster('op1', '清空', ['e1'])).rejects.toThrow(ForbiddenException);
    process.env.NODE_ENV = 'test';
  });

  it('未勾选（userIds 空）→ 400 EMPTY_SELECTION', async () => {
    await expect(service.clearExpertRoster('op1', '清空', [])).rejects.toThrow(BadRequestException);
    await expect(service.clearExpertRoster('op1', '清空', undefined)).rejects.toThrow(BadRequestException);
  });

  it('勾选含不存在或非专家域账号（如管理员 id）→ 400 INVALID_TARGET', async () => {
    prisma.user.findMany.mockResolvedValue([
      ...EXPERTS,
      { id: 'admin1', role: 'admin', isTempExpert: false }, // 传入 id 命中了管理员
    ]);
    await expect(service.clearExpertRoster('op1', '清空', ['e1', 'e2', 'admin1'])).rejects.toThrow(BadRequestException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('勾选专家绑定开标/评标中项目 → 409 并点名项目', async () => {
    prisma.bidExpert.findMany.mockResolvedValue([{ projectId: 'p1' }]);
    prisma.bidProject.findMany.mockResolvedValue([{ name: '钻机采购' }]);
    await expect(service.clearExpertRoster('op1', '清空', ['e1'])).rejects.toThrow(ConflictException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('正常清空勾选集：先断审计链 → 删审查任务 → 删账号，事后写审计', async () => {
    const r = await service.clearExpertRoster('op-admin', '清空', ['e1', 'e2', 'e1']); // 去重
    expect(r).toEqual({ clearedExperts: 2, auditDetached: 7, reviewTasksRemoved: 0 });
    // 断链在删号之前（Cascade 会毁留痕——顺序即安全）
    const order = [
      tx.auditLog.updateMany.mock.invocationCallOrder[0],
      tx.reviewTask.deleteMany.mock.invocationCallOrder[0],
      tx.user.deleteMany.mock.invocationCallOrder[0],
    ];
    expect(order[0]).toBeLessThan(order[2]);
    expect(order[1]).toBeLessThan(order[2]);
    expect(tx.auditLog.updateMany).toHaveBeenCalledWith({
      where: { userId: { in: ['e1', 'e2'] } },
      data: { userId: null },
    });
    expect(tx.user.deleteMany).toHaveBeenCalledWith({ where: { id: { in: ['e1', 'e2'] } } });
    // 审计在事务外写（操作人=admin 不在删除集，自身留痕不被清）
    expect(prisma.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ userId: 'op-admin', action: 'EXPERT_ROSTER_CLEARED' }),
    }));
  });
});
