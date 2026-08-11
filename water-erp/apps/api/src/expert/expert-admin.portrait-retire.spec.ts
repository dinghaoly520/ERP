import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { ExpertAdminService } from './expert-admin.service';
import { PrismaService } from '../prisma/prisma.service';
import { ExpertExtractionAiService } from './expert-extraction-ai.service';
import { NotificationService } from '../notification/notification.service';
import { EmbeddingService } from '../local-ai/embedding.service';
import { LlmService } from '../local-ai/llm.service';
import { OcrService } from '../local-ai/ocr.service';
import { ExpertCrossConflictService } from './expert-cross-conflict.service';

describe('ExpertAdminService — portrait & retire (Track D §3.4)', () => {
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
      $transaction: jest.fn().mockResolvedValue([]),
    };
    notification = { create: jest.fn(), sendToRole: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ExpertAdminService,
        { provide: PrismaService, useValue: prisma },
        { provide: ExpertExtractionAiService, useValue: { analyzeAndScore: jest.fn(), getMetrics: jest.fn().mockReturnValue({}), recordFallback: jest.fn() } },
        { provide: NotificationService, useValue: notification },
        { provide: EmbeddingService, useValue: { embed: jest.fn().mockResolvedValue([]) } },
        { provide: LlmService, useValue: { chat: jest.fn(), chatJson: jest.fn(), getModel: jest.fn().mockReturnValue(null) } },
        { provide: OcrService, useValue: { isAvailable: jest.fn().mockResolvedValue(false), ocrImage: jest.fn() } },
        { provide: ExpertCrossConflictService, useValue: { checkCrossConflicts: jest.fn().mockResolvedValue([]) } },
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

  describe('reviewRetirementCandidates', () => {
    it('标记连续 E 级专家为候选，但不改 availability', async () => {
      prisma.user.findMany.mockResolvedValue([
        { id: 'u1', displayName: '差专家', expertProfile: { specialty: '水利' } },
      ]);
      // 最近 2 次都是 E（shouldDeactivateExpert 现在看连续 E 级）
      // 与 service 的 select 一致：仅 expertUserId + overallGrade + createdAt
      prisma.expertEvaluation.findMany.mockResolvedValue([
        { expertUserId: 'u1', overallGrade: 'E', createdAt: new Date() },
        { expertUserId: 'u1', overallGrade: 'E', createdAt: new Date() },
      ]);
      // 近期有分配（仍因连续 E 级进候选）
      prisma.bidExpert.findMany.mockResolvedValue([{ userId: 'u1', id: 'r1' }]);

      const candidates = await service.reviewRetirementCandidates();

      expect(candidates).toHaveLength(1);
      expect(candidates[0].userId).toBe('u1');
      expect(candidates[0].reason).toContain('E');
      // 预警只通知，不改状态
      expect(prisma.expertProfile.updateMany).not.toHaveBeenCalled();
      expect(notification.sendToRole).toHaveBeenCalled();
    });

    it('连续 D 级不再触发退库预警（阈值已收紧为连续 E 级）', async () => {
      prisma.user.findMany.mockResolvedValue([
        { id: 'u1', displayName: '待改进专家', expertProfile: { specialty: '水利' } },
      ]);
      prisma.expertEvaluation.findMany.mockResolvedValue([
        { expertUserId: 'u1', overallGrade: 'D', createdAt: new Date() },
        { expertUserId: 'u1', overallGrade: 'D', createdAt: new Date() },
      ]);
      prisma.bidExpert.findMany.mockResolvedValue([{ userId: 'u1', id: 'r1' }]); // 近期有分配

      const candidates = await service.reviewRetirementCandidates();
      expect(candidates).toHaveLength(0);
    });

    it('评价正常的专家不进候选', async () => {
      prisma.user.findMany.mockResolvedValue([
        { id: 'u2', displayName: '好专家', expertProfile: { specialty: '水利' } },
      ]);
      prisma.expertEvaluation.findMany.mockResolvedValue([
        { expertUserId: 'u2', overallGrade: 'A', createdAt: new Date() },
      ]);
      prisma.bidExpert.findMany.mockResolvedValue([{ userId: 'u2', id: 'recent' }]); // 近期有分配

      const candidates = await service.reviewRetirementCandidates();
      expect(candidates).toHaveLength(0);
    });

    it('近 12 个月无分配的专家进候选', async () => {
      prisma.user.findMany.mockResolvedValue([
        { id: 'u3', displayName: '闲置专家', expertProfile: { specialty: '水利' } },
      ]);
      prisma.expertEvaluation.findMany.mockResolvedValue([
        { expertUserId: 'u3', overallGrade: 'B', createdAt: new Date() },
      ]); // 评价正常
      prisma.bidExpert.findMany.mockResolvedValue([]); // 近期无分配

      const candidates = await service.reviewRetirementCandidates();
      expect(candidates).toHaveLength(1);
      expect(candidates[0].reason).toContain('12');
    });
  });

  describe('confirmRetire', () => {
    it('写入停用 + retiredAt + retireReason', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'u1', role: 'bid_expert' });
      prisma.expertProfile.updateMany.mockResolvedValue({ count: 1 });

      const res = await service.confirmRetire('u1', '长期不胜任');
      expect(res.success).toBe(true);
      expect(prisma.expertProfile.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: 'u1' },
          data: expect.objectContaining({ availability: '停用', retireReason: '长期不胜任' }),
        }),
      );
      expect(prisma.expertProfile.updateMany.mock.calls[0][0].data.retiredAt).toBeInstanceOf(Date);
      // 退库须同步禁用登录（关键写操作，不能被静默删除）
      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'u1' }, data: { isActive: false } }),
      );
      // 停用与禁登须在同一事务内提交
      expect(prisma.$transaction).toHaveBeenCalled();
    });

    it('专家不存在时抛 NotFoundException', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      await expect(service.confirmRetire('nope', 'x')).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
