import { Test, TestingModule } from '@nestjs/testing';
import { ExpertService } from './expert.service';
import { PrismaService } from '../prisma/prisma.service';
import { AiService } from '../ai/ai.service';

describe('ExpertService', () => {
  let service: ExpertService;
  let prisma: any;
  let ai: any;

  const mockUser = { id: 'user-1', displayName: '王建国', username: 'wangjg', role: 'bid_expert' };
  const mockExpert = {
    id: 'exp-1',
    expertName: '王建国',
    projectId: 'proj-1',
    major: '水利工程',
    signedIn: false,
    avoidanceConfirmed: false,
    progress: 0,
    totalScore: 0,
  };

  beforeEach(async () => {
    prisma = {
      user: { findUnique: jest.fn(), update: jest.fn() },
      bidExpert: {
        findMany: jest.fn(),
        findFirst: jest.fn(),
        update: jest.fn(),
      },
      bidProject: { findUnique: jest.fn() },
      bidSupplier: { findFirst: jest.fn() },
      bidScoreRecord: {
        findMany: jest.fn(),
        deleteMany: jest.fn(),
        create: jest.fn(),
        count: jest.fn(),
      },
      bidScoreItem: { findMany: jest.fn() },
      bidSupplierCount: jest.fn(),
      bidSupervisionLog: { create: jest.fn() },
      bidClarification: { create: jest.fn() },
    };

    ai = { analyzeBid: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ExpertService,
        { provide: PrismaService, useValue: prisma },
        { provide: AiService, useValue: ai },
      ],
    }).compile();

    service = module.get<ExpertService>(ExpertService);
  });

  describe('getStatistics', () => {
    it('应返回专家统计数据', async () => {
      prisma.user.findUnique.mockResolvedValue(mockUser);
      prisma.bidExpert.findMany.mockResolvedValue([
        { progress: 100, signedIn: true, totalScore: 90, project: {} },
        { progress: 50, signedIn: true, totalScore: 80, project: {} },
        { progress: 0, signedIn: false, totalScore: 0, project: {} },
      ]);
      prisma.bidSupervisionLog.findMany = jest.fn().mockResolvedValue([]);

      const stats = await service.getStatistics('user-1');

      expect(stats.totalProjects).toBe(3);
      expect(stats.completedProjects).toBe(1);
      expect(stats.signedInProjects).toBe(2);
      expect(stats.pendingProjects).toBe(1);
      expect(stats.averageScore).toBeGreaterThan(0);
      expect(stats.recentActivity).toBeDefined();
    });
  });

  describe('signIn', () => {
    it('签到成功应更新专家状态', async () => {
      prisma.user.findUnique.mockResolvedValue(mockUser);
      prisma.bidExpert.findFirst.mockResolvedValue(mockExpert);
      prisma.bidExpert.update.mockResolvedValue({ ...mockExpert, signedIn: true });

      const result = await service.signIn('user-1', 'proj-1');

      expect(prisma.bidExpert.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { signedIn: true } }),
      );
    });
  });

  describe('getAssistData', () => {
    it('应调用 AI 引擎进行分析', async () => {
      prisma.user.findUnique.mockResolvedValue(mockUser);
      prisma.bidExpert.findFirst.mockResolvedValue(mockExpert);
      ai.analyzeBid.mockResolvedValue({ supplierName: '川水建设', keyPoints: [] });

      const result = await service.getAssistData('user-1', 'proj-1', 'sup-1');

      expect(ai.analyzeBid).toHaveBeenCalledWith('proj-1', 'sup-1', 'exp-1');
    });
  });

  describe('updateProfile', () => {
    it('应更新用户 displayName 和 email', async () => {
      prisma.user.update.mockResolvedValue({ ...mockUser, displayName: '王工', email: 'wang@test.com' });

      await service.updateProfile('user-1', { displayName: '王工', email: 'wang@test.com' });

      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'user-1' },
          data: expect.objectContaining({ displayName: '王工', email: 'wang@test.com' }),
        }),
      );
    });
  });
});
