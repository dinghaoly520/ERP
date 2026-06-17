import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException } from '@nestjs/common';
import { ExpertService } from './expert.service';
import { PrismaService } from '../prisma/prisma.service';
import { AiService } from '../ai/ai.service';
import { ExpertConflictService } from './expert-conflict.service';

describe('ExpertService', () => {
  let service: ExpertService;
  let prisma: any;
  let ai: any;

  const mockExpert = {
    id: 'exp-1',
    userId: 'user-1',
    expertName: '王建国',
    projectId: 'proj-1',
    major: '水利工程',
    signedIn: false,
    avoidanceConfirmed: false,
    progress: 0,
    totalScore: 0,
    phoneVerified: true,
    reportConfirmed: false,
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
      bidSupplier: { findFirst: jest.fn(), findMany: jest.fn(), count: jest.fn() },
      supplierBidSubmission: { findUnique: jest.fn() },
      fileAsset: { findMany: jest.fn() },
      bidScoreRecord: {
        findMany: jest.fn(),
        deleteMany: jest.fn(),
        create: jest.fn(),
        createMany: jest.fn(),
        count: jest.fn(),
      },
      bidScoreItem: { findMany: jest.fn() },
      bidSupplierCount: jest.fn(),
      bidSupervisionLog: { create: jest.fn(), findMany: jest.fn() },
      bidClarification: { create: jest.fn() },
    };

    ai = { analyzeBid: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ExpertService,
        { provide: PrismaService, useValue: prisma },
        { provide: AiService, useValue: ai },
        { provide: ExpertConflictService, useValue: { detectForProject: jest.fn().mockResolvedValue([]) } },
      ],
    }).compile();

    service = module.get<ExpertService>(ExpertService);
  });

  describe('getStatistics', () => {
    it('应返回专家统计数据', async () => {
      prisma.bidExpert.findMany.mockResolvedValue([
        { progress: 100, signedIn: true, totalScore: 90, expertName: '王建国', project: {} },
        { progress: 50, signedIn: true, totalScore: 80, expertName: '王建国', project: {} },
        { progress: 0, signedIn: false, totalScore: 0, expertName: '王建国', project: {} },
      ]);
      prisma.bidSupervisionLog.findMany.mockResolvedValue([]);

      const stats = await service.getStatistics('user-1');

      expect(stats.totalProjects).toBe(3);
      expect(stats.completedProjects).toBe(1);
      expect(stats.signedInProjects).toBe(2);
      expect(stats.pendingProjects).toBe(1);
      expect(stats.averageScore).toBeGreaterThan(0);
      expect(stats.recentActivity).toBeDefined();
      // 不应调用 user.findUnique
      expect(prisma.user.findUnique).not.toHaveBeenCalled();
    });
  });

  describe('signIn', () => {
    it('签到成功应更新专家状态', async () => {
      prisma.bidProject.findUnique.mockResolvedValue({ stage: 'OPENING' });
      prisma.bidExpert.findFirst.mockResolvedValue(mockExpert);
      prisma.bidExpert.update.mockResolvedValue({ ...mockExpert, signedIn: true });

      const result = await service.signIn('user-1', 'proj-1');

      expect(prisma.bidExpert.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: 'user-1', projectId: 'proj-1' },
        }),
      );
      expect(prisma.bidExpert.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { signedIn: true } }),
      );
    });
  });

  describe('getAssistData', () => {
    it('应调用 AI 引擎进行分析', async () => {
      prisma.bidProject.findUnique.mockResolvedValue({ stage: 'OPENING' });
      prisma.bidExpert.findFirst.mockResolvedValue(mockExpert);
      ai.analyzeBid.mockResolvedValue({ supplierName: '川水建设', keyPoints: [] });

      const result = await service.getAssistData('user-1', 'proj-1', 'sup-1');

      expect(ai.analyzeBid).toHaveBeenCalledWith('proj-1', 'sup-1', 'exp-1');
    });
  });

  describe('updateProfile', () => {
    it('应更新用户 displayName 和 email', async () => {
      prisma.user.update.mockResolvedValue({ id: 'user-1', displayName: '王工', email: 'wang@test.com' });

      await service.updateProfile('user-1', { displayName: '王工', email: 'wang@test.com' });

      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'user-1' },
          data: expect.objectContaining({ displayName: '王工', email: 'wang@test.com' }),
        }),
      );
    });
  });

  describe('身份隔离', () => {
    it('未分配到项目的专家不能签到', async () => {
      prisma.bidExpert.findFirst.mockResolvedValue(null);

      await expect(service.signIn('user-1', 'proj-1'))
        .rejects.toThrow(ForbiddenException);
    });

    it('未分配到项目的专家不能查看项目', async () => {
      prisma.bidExpert.findFirst.mockResolvedValue(null);

      await expect(service.getProject('user-1', 'proj-1'))
        .rejects.toThrow(ForbiddenException);
    });

    it('未分配到项目的专家不能查看报告', async () => {
      prisma.bidExpert.findFirst.mockResolvedValue(null);

      await expect(service.getReport('user-1', 'proj-1'))
        .rejects.toThrow(ForbiddenException);
    });
  });

  describe('submitScores', () => {
    const signedExpert = { ...mockExpert, signedIn: true, avoidanceConfirmed: true };

    beforeEach(() => {
      prisma.bidExpert.findFirst.mockResolvedValue(signedExpert);
      prisma.bidProject.findUnique.mockResolvedValue({ stage: 'EVALUATING' });
      prisma.bidScoreItem.findMany.mockResolvedValue([{ id: 'item-1', maxScore: 100 }]);
    });

    it('rejects supplier ids outside the project', async () => {
      prisma.bidSupplier.findMany.mockResolvedValue([]);

      await expect(service.submitScores('user-1', 'proj-1', {
        supplierName: '外部供应商',
        scores: [{ supplierId: 'supplier-other', scoreItemId: 'item-1', score: 80 }],
      })).rejects.toMatchObject({ response: { code: 'SUPPLIER_NOT_IN_PROJECT' } });
    });

    it('rejects suppliers that are not decrypted successfully', async () => {
      prisma.bidSupplier.findMany.mockResolvedValue([{ id: 'supplier-1', decryptStatus: 'PENDING', submitStatus: '已提交' }]);

      await expect(service.submitScores('user-1', 'proj-1', {
        supplierName: '未解密供应商',
        scores: [{ supplierId: 'supplier-1', scoreItemId: 'item-1', score: 80 }],
      })).rejects.toMatchObject({ response: { code: 'SUPPLIER_NOT_DECRYPTED' } });
    });

    it('rejects scoring after report is confirmed (locked)', async () => {
      prisma.bidExpert.findFirst.mockResolvedValue({ ...signedExpert, reportConfirmed: true });
      await expect(service.submitScores('user-1', 'proj-1', {
        supplierName: '已锁',
        scores: [{ supplierId: 'supplier-1', scoreItemId: 'item-1', score: 80 }],
      })).rejects.toMatchObject({ response: { code: 'SCORE_LOCKED' } });
    });
  });

  describe('confirmReport', () => {
    it('locks scoring by setting reportConfirmed and reportConfirmedAt', async () => {
      prisma.bidProject.findUnique.mockResolvedValue({ stage: 'EVALUATING' });
      prisma.bidExpert.findFirst.mockResolvedValue({ ...mockExpert, signedIn: true, avoidanceConfirmed: true, progress: 100 });
      prisma.bidExpert.update.mockResolvedValue({});
      prisma.bidSupervisionLog.create.mockResolvedValue({});

      await service.confirmReport('user-1', 'proj-1', '确认完成');

      expect(prisma.bidExpert.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ progress: 100, reportConfirmed: true, reportConfirmedAt: expect.any(Date) }),
        }),
      );
    });
  });

  describe('getDecryptedDocuments', () => {
    const signedExpert = { ...mockExpert, signedIn: true, avoidanceConfirmed: true };

    beforeEach(() => {
      prisma.bidProject.findUnique.mockResolvedValue({ stage: 'OPENING' });
      prisma.bidExpert.findFirst.mockResolvedValue(signedExpert);
    });

    it('returns real uploaded file assets with download urls after decrypt success', async () => {
      prisma.bidSupplier.findFirst.mockResolvedValue({
        id: 'bs-1', supplierId: 'supplier-1', supplierName: '川水建设', decryptStatus: 'SUCCESS',
      });
      prisma.supplierBidSubmission.findUnique.mockResolvedValue({
        technicalFileAssetId: 'fa-1', businessFileAssetId: 'fa-2', coverLetterAssetId: null,
      });
      prisma.fileAsset.findMany.mockResolvedValue([
        { id: 'fa-1', originalName: '技术方案.pdf', mimeType: 'application/pdf', size: 131072, sha256: 'hash1' },
        { id: 'fa-2', originalName: '商务文件.pdf', mimeType: 'application/pdf', size: 65536, sha256: 'hash2' },
      ]);

      const result = await service.getDecryptedDocuments('user-1', 'proj-1', 'bs-1');

      expect(result.canView).toBe(true);
      expect(result.documents.length).toBe(2);
      expect(result.documents[0].downloadUrl).toBe('/api/upload/files/fa-1');
      expect(result.documents[0].sha256).toBe('hash1');
    });

    it('hides download urls and sha256 when supplier is not decrypted', async () => {
      prisma.bidSupplier.findFirst.mockResolvedValue({
        id: 'bs-1', supplierId: 'supplier-1', supplierName: '川水建设', decryptStatus: 'PENDING',
      });
      prisma.supplierBidSubmission.findUnique.mockResolvedValue({ technicalFileAssetId: 'fa-1' });
      prisma.fileAsset.findMany.mockResolvedValue([
        { id: 'fa-1', originalName: '技术方案.pdf', mimeType: 'application/pdf', size: 131072, sha256: 'hash1' },
      ]);

      const result = await service.getDecryptedDocuments('user-1', 'proj-1', 'bs-1');

      expect(result.canView).toBe(false);
      expect(result.documents[0].downloadUrl).toBeUndefined();
      expect(result.documents[0].sha256).toBeUndefined();
      expect(result.documents[0].status).toBe('加密中');
    });

    it('returns empty document list when no submission exists', async () => {
      prisma.bidSupplier.findFirst.mockResolvedValue({
        id: 'bs-1', supplierId: null, supplierName: '管理员录入供应商', decryptStatus: 'SUCCESS',
      });
      prisma.supplierBidSubmission.findUnique.mockResolvedValue(null);
      prisma.fileAsset.findMany.mockResolvedValue([]);

      const result = await service.getDecryptedDocuments('user-1', 'proj-1', 'bs-1');

      expect(result.documents).toEqual([]);
    });
  });

  describe('getProfile', () => {
    it('应返回用户信息和专家分配列表', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'user-1', username: 'wangjg', displayName: '王建国', role: 'bid_expert', isActive: true,
      });
      prisma.bidExpert.findMany.mockResolvedValue([]);

      const result = await service.getProfile('user-1');

      expect(result).toHaveProperty('assignments');
      expect(result).not.toHaveProperty('passwordHash');
      // 应通过 userId 查询专家记录
      expect(prisma.bidExpert.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { userId: 'user-1' } }),
      );
    });
  });
});
