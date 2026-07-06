import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { ExpertAdminService } from './expert-admin.service';
import { PrismaService } from '../prisma/prisma.service';
import { ExpertExtractionAiService } from './expert-extraction-ai.service';
import { NotificationService } from '../notification/notification.service';

describe('ExpertAdminService — portrait & retire (Track D §3.4)', () => {
  let service: ExpertAdminService;
  let prisma: any;
  let notification: any;

  beforeEach(async () => {
    prisma = {
      user: { findUnique: jest.fn(), findMany: jest.fn().mockResolvedValue([]), update: jest.fn().mockResolvedValue({}) },
      expertProfile: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
      expertEvaluation: { findMany: jest.fn().mockResolvedValue([]) },
      bidExpert: { findMany: jest.fn().mockResolvedValue([]), findFirst: jest.fn() },
      bidScoreRecord: { findMany: jest.fn().mockResolvedValue([]) },
    };
    notification = { create: jest.fn(), sendToRole: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ExpertAdminService,
        { provide: PrismaService, useValue: prisma },
        { provide: ExpertExtractionAiService, useValue: { analyzeAndScore: jest.fn() } },
        { provide: NotificationService, useValue: notification },
      ],
    }).compile();
    service = module.get<ExpertAdminService>(ExpertAdminService);
  });

  describe('getExpertPortrait', () => {
    it('聚合参与、完成率、均分、偏离度', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'u1', displayName: '王某国' });
      prisma.bidExpert.findMany.mockResolvedValue([
        { progress: 100, totalScore: 90 },
        { progress: 100, totalScore: 80 },
      ]);
      prisma.bidScoreRecord.findMany.mockResolvedValue([
        { score: 90, scoreItemId: 'si1', supplierId: 'sup1', expert: { userId: 'u1' } },
      ]);
      prisma.expertEvaluation.findMany.mockResolvedValue([
        { level: 'A', overallScore: 92, createdAt: new Date('2026-06-14') },
      ]);

      const p = await service.getExpertPortrait('u1');
      expect(p.participationCount).toBe(2);
      expect(p.completedCount).toBe(2);
      expect(p.completionRate).toBe(1);
      expect(p.averageScore).toBe(85);
      expect(p.evalAvg).toBe(92);
    });

    it('专家不存在时抛 NotFoundException', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      await expect(service.getExpertPortrait('nope')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('reviewRetirementCandidates', () => {
    it('标记连续 D 级专家为候选，但不改 availability', async () => {
      prisma.user.findMany.mockResolvedValue([
        { id: 'u1', displayName: '差专家', expertProfile: { specialty: '水利' } },
      ]);
      // 最近 2 次都是 D
      prisma.expertEvaluation.findMany.mockResolvedValue([
        { expertUserId: 'u1', level: 'D' },
        { expertUserId: 'u1', level: 'D' },
      ]);
      prisma.bidExpert.findMany.mockResolvedValue([{ userId: 'u1' }]); // 近期有分配 → reason 取"D"而非"无分配"

      const candidates = await service.reviewRetirementCandidates();

      expect(candidates).toHaveLength(1);
      expect(candidates[0].userId).toBe('u1');
      expect(candidates[0].reason).toContain('D');
      // 预警只通知，不改状态
      expect(prisma.expertProfile.updateMany).not.toHaveBeenCalled();
      expect(notification.sendToRole).toHaveBeenCalled();
    });

    it('评价正常的专家不进候选', async () => {
      prisma.user.findMany.mockResolvedValue([
        { id: 'u2', displayName: '好专家', expertProfile: { specialty: '水利' } },
      ]);
      prisma.expertEvaluation.findMany.mockResolvedValue([{ level: 'A' }]);
      prisma.bidExpert.findMany.mockResolvedValue([{ userId: 'u2' }]); // 近期有分配 → 不候选

      const candidates = await service.reviewRetirementCandidates();
      expect(candidates).toHaveLength(0);
    });

    it('近 12 个月无分配的专家进候选', async () => {
      prisma.user.findMany.mockResolvedValue([
        { id: 'u3', displayName: '闲置专家', expertProfile: { specialty: '水利' } },
      ]);
      prisma.expertEvaluation.findMany.mockResolvedValue([{ level: 'B' }]); // 评价正常
      prisma.bidExpert.findFirst.mockResolvedValue(null); // 近期无分配

      const candidates = await service.reviewRetirementCandidates();
      expect(candidates).toHaveLength(1);
      expect(candidates[0].reason).toContain('12');
    });
  });

  describe('confirmRetire', () => {
    it('写入停用 + retiredAt + retireReason', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'u1' });
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
    });

    it('专家不存在时抛 NotFoundException', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      await expect(service.confirmRetire('nope', 'x')).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
