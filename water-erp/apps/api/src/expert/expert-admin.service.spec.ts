import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { ExpertAdminService } from './expert-admin.service';
import { PrismaService } from '../prisma/prisma.service';

describe('ExpertAdminService', () => {
  let service: ExpertAdminService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      user: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
      },
      bidExpert: {
        findMany: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ExpertAdminService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<ExpertAdminService>(ExpertAdminService);
  });

  describe('listExperts', () => {
    it('应返回专家列表含评审统计', async () => {
      prisma.user.findMany.mockResolvedValue([
        { id: 'u1', displayName: '王建国', email: 'wang@test.com', department: { id: 'd1', name: '工程部' }, bidExperts: [{ id: 'e1', progress: 80, major: '水利工程', project: { name: '测试项目', stage: 'EVALUATING' } }] },
        { id: 'u2', displayName: '刘晓梅', email: 'liu@test.com', department: null, bidExperts: [] },
      ]);

      const result = await service.listExperts();
      expect(result).toHaveLength(2);
      expect(prisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { role: 'bid_expert', isActive: true } }),
      );
    });

    it('应支持搜索', async () => {
      prisma.user.findMany.mockResolvedValue([]);
      await service.listExperts('王');
      expect(prisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ displayName: { contains: '王', mode: 'insensitive' } }),
        }),
      );
    });
  });

  describe('getExpert', () => {
    it('应返回专家详情含统计', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'u1', displayName: '王建国', username: 'wangjg' });
      prisma.bidExpert.findMany.mockResolvedValue([
        { progress: 100, signedIn: true, project: { name: '项目A' }, scoreRecords: [] },
        { progress: 50, signedIn: false, project: { name: '项目B' }, scoreRecords: [] },
      ]);

      const result = await service.getExpert('u1');
      expect(result.statistics.totalProjects).toBe(2);
      expect(result.statistics.completedProjects).toBe(1);
      expect(result.statistics.signedInProjects).toBe(1);
    });

    it('用户不存在应抛 NotFoundException', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      await expect(service.getExpert('nonexistent')).rejects.toThrow(NotFoundException);
    });
  });

  describe('listExpertProjects', () => {
    it('应返回专家参与的项目列表', async () => {
      prisma.bidExpert.findMany.mockResolvedValue([
        { id: 'e1', project: { id: 'p1', name: '项目A', stage: 'EVALUATING' } },
      ]);

      const result = await service.listExpertProjects('u1');
      expect(result).toHaveLength(1);
      expect(prisma.bidExpert.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { userId: 'u1' } }),
      );
    });
  });
});
