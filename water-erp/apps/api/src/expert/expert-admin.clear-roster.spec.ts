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

/** 一键清空专家库名单（2026-11-09 用户裁定：仅名单、评审记录保留、强保险） */
describe('ExpertAdminService.clearExpertRoster', () => {
  let service: ExpertAdminService;
  let prisma: any;
  let tx: any;

  beforeEach(async () => {
    tx = {
      auditLog: { updateMany: jest.fn().mockResolvedValue(7) },
      reviewTask: { deleteMany: jest.fn().mockResolvedValue(0) },
      user: { deleteMany: jest.fn().mockResolvedValue(180) },
    };
    prisma = {
      bidProject: { count: jest.fn().mockResolvedValue(0) },
      user: { findMany: jest.fn().mockResolvedValue([{ id: 'e1' }, { id: 'e2' }]) },
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
    await expect(service.clearExpertRoster('op1', '清空列表')).rejects.toThrow(BadRequestException);
    expect(prisma.bidProject.count).not.toHaveBeenCalled();
  });

  it('生产环境 → 403 硬拒', async () => {
    process.env.NODE_ENV = 'production';
    await expect(service.clearExpertRoster('op1', '清空')).rejects.toThrow(ForbiddenException);
    process.env.NODE_ENV = 'test';
  });

  it('存在开标/评标中项目 → 409 BID_IN_PROGRESS', async () => {
    prisma.bidProject.count.mockResolvedValue(2);
    await expect(service.clearExpertRoster('op1', '清空')).rejects.toThrow(ConflictException);
    expect(prisma.user.findMany).not.toHaveBeenCalled();
  });

  it('空名单 → 短路返回 0，不开事务', async () => {
    prisma.user.findMany.mockResolvedValue([]);
    const r = await service.clearExpertRoster('op1', '清空');
    expect(r).toEqual({ clearedExperts: 0, auditDetached: 0, reviewTasksRemoved: 0 });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('正常清空：先断审计链 → 删审查任务 → 删账号，事后写审计', async () => {
    const r = await service.clearExpertRoster('op-admin', '清空');
    expect(r).toEqual({ clearedExperts: 180, auditDetached: 7, reviewTasksRemoved: 0 });
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
    // 审计在事务外写（操作人=admin 不在删除集，自身留痕不被清）
    expect(prisma.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ userId: 'op-admin', action: 'EXPERT_ROSTER_CLEARED' }),
    }));
  });
});
