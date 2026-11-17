import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
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

describe('ExpertAdminService — portrait (Track D §3.4)', () => {
  let service: ExpertAdminService;
  let prisma: any;
  let notification: any;

  beforeEach(async () => {
    prisma = {
      user: { findUnique: jest.fn(), findMany: jest.fn(), update: jest.fn() },
      expertProfile: { updateMany: jest.fn() },
      expertEvaluation: { findMany: jest.fn() },
      bidExpert: { findMany: jest.fn(), findFirst: jest.fn() },
      bidScoreRecord: { findMany: jest.fn() },
      // 退库批报取代（2026-10-22）：发新批前消解旧未消解批报
      notification: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
      $transaction: jest.fn().mockResolvedValue([]),
    };
    notification = {
      create: jest.fn(), sendToRole: jest.fn(),
      sendToCompanyRoles: jest.fn().mockResolvedValue({ sent: 1, fallbackAdmin: false, userIds: ['u-admin'] }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        { provide: CompanyScopeService, useValue: { resolveScope: jest.fn().mockResolvedValue({ all: true }), filter: jest.fn().mockReturnValue({}), assertInScope: jest.fn(), stampFor: jest.fn().mockResolvedValue({}) } },
        ExpertAdminService,
        { provide: PrismaService, useValue: prisma },
        { provide: ExpertExtractionAiService, useValue: { analyzeAndScore: jest.fn(), getMetrics: jest.fn().mockReturnValue({}), recordFallback: jest.fn() } },
        { provide: NotificationService, useValue: notification },
        { provide: EmbeddingService, useValue: { embed: jest.fn().mockResolvedValue([]) } },
        { provide: LlmService, useValue: { chat: jest.fn(), chatJson: jest.fn(), getModel: jest.fn().mockReturnValue(null) } },
        { provide: OcrService, useValue: { isAvailable: jest.fn().mockResolvedValue(false), ocrImage: jest.fn() } },
        { provide: ExpertCrossConflictService, useValue: { checkCrossConflicts: jest.fn().mockResolvedValue([]) } },
        { provide: ExpertExtractionService, useValue: { extendedRuleScore: jest.fn() } },
      ],
    }).compile();
    service = module.get<ExpertAdminService>(ExpertAdminService);
  });

  describe('getExpertPortrait', () => {
    it('聚合参与、完成率、等级分布、偏离度', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'u1', displayName: '王某国', role: 'bid_expert' });
      prisma.bidExpert.findMany.mockResolvedValue([
        { progress: 100, totalScore: 90 },
        { progress: 100, totalScore: 80 },
      ]);
      prisma.bidScoreRecord.findMany.mockResolvedValue([
        { score: 90, scoreItemId: 'si1', supplierId: 'sup1', expert: { userId: 'u1' } },
      ]);
      // 与 service 的 select 一致：仅 overallGrade + createdAt
      prisma.expertEvaluation.findMany.mockResolvedValue([
        { overallGrade: 'A', createdAt: new Date('2026-06-14') },
      ]);

      const p = await service.getExpertPortrait('u1');
      expect(p.participationCount).toBe(2);
      expect(p.completedCount).toBe(2);
      expect(p.completionRate).toBe(1);
      expect(p.evalCount).toBe(1);
      expect(p.gradeCounts).toEqual({ A: 1 });
      expect(p.recentLevels).toEqual(['A']);
    });

    it('专家不存在时抛 NotFoundException', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      await expect(service.getExpertPortrait('nope')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

});
