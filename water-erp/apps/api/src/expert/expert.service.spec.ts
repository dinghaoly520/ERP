import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException, BadRequestException } from '@nestjs/common';
import { ExpertService } from './expert.service';
import { PrismaService } from '../prisma/prisma.service';
import { AiService } from '../ai/ai.service';
import { ExpertConflictService } from './expert-conflict.service';
import { encryptBuffer } from '../announcement/bid-document.crypto';
import { wrapKey } from '../common/crypto/envelope-crypto';
import { minioClient } from '../upload/minio.client';

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
        upsert: jest.fn(),
      },
      bidScoreItem: { findMany: jest.fn() },
      bidSupplierCount: jest.fn(),
      bidSupervisionLog: { create: jest.fn(), findMany: jest.fn() },
      bidClarification: { create: jest.fn() },
      aiBidderResult: { findFirst: jest.fn() },
      $transaction: jest.fn(async (fn: any) => fn(prisma)),
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
        { progress: 100, signedIn: true, totalScore: 255, expertName: '王建国', project: {}, scoreRecords: [{ score: 85, supplierId: 's1' }, { score: 90, supplierId: 's2' }, { score: 80, supplierId: 's3' }] },
        { progress: 50, signedIn: true, totalScore: 165, expertName: '王建国', project: {}, scoreRecords: [{ score: 85, supplierId: 's4' }, { score: 80, supplierId: 's5' }] },
        { progress: 0, signedIn: false, totalScore: 0, expertName: '王建国', project: {}, scoreRecords: [] },
      ]);
      prisma.bidSupervisionLog.findMany.mockResolvedValue([]);

      const stats = await service.getStatistics('user-1');

      expect(stats.totalProjects).toBe(3);
      expect(stats.completedProjects).toBe(1);
      expect(stats.signedInProjects).toBe(2);
      expect(stats.pendingProjects).toBe(1);
      // 平均分 = (255 + 165 + 0) / 5家供应商 = 84.0
      expect(stats.averageScore).toBe(84);
      expect(stats.recentActivity).toBeDefined();
      // 统计应仅计算 OPENING+ 阶段的项目
      expect(prisma.bidExpert.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: 'user-1', project: { stage: { in: ['OPENING', 'EVALUATING', 'ARCHIVED'] } } },
        }),
      );
      // 不应调用 user.findUnique
      expect(prisma.user.findUnique).not.toHaveBeenCalled();
    });
  });

  describe('listProjects', () => {
    it('应仅返回 OPENING/EVALUATING/ARCHIVED 阶段的项目', async () => {
      prisma.bidExpert.findMany.mockResolvedValue([
        {
          id: 'exp-1', expertName: '王建国', major: '水利工程', signedIn: true,
          progress: 50, totalScore: 80, createdAt: new Date(),
          project: { id: 'proj-1', stage: 'OPENING', projectCode: 'GC-001', name: '水库项目', openTime: new Date(), suppliers: [], scoreItems: [], _count: { clarifications: 0 } },
          scoreRecords: [],
        },
      ]);

      const result = await service.listProjects('user-1');

      expect(prisma.bidExpert.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: 'user-1', project: { stage: { in: ['OPENING', 'EVALUATING', 'ARCHIVED'] } } },
        }),
      );
      expect(result).toHaveLength(1);
      expect(result[0].project.stage).toBe('OPENING');
    });

    it('应将 OPENING 排在 EVALUATING 之前', async () => {
      prisma.bidExpert.findMany.mockResolvedValue([
        { id: 'exp-2', expertName: '李专家', major: '电气', signedIn: false, progress: 0, totalScore: 0, createdAt: new Date('2026-01-02'), project: { id: 'proj-2', stage: 'EVALUATING', projectCode: 'GC-002', name: '电网项目', openTime: new Date(), suppliers: [], scoreItems: [], _count: { clarifications: 0 } }, scoreRecords: [] },
        { id: 'exp-1', expertName: '王建国', major: '水利', signedIn: true, progress: 50, totalScore: 80, createdAt: new Date('2026-01-01'), project: { id: 'proj-1', stage: 'OPENING', projectCode: 'GC-001', name: '水库项目', openTime: new Date(), suppliers: [], scoreItems: [], _count: { clarifications: 0 } }, scoreRecords: [] },
      ]);

      const result = await service.listProjects('user-1');

      // OPENING（priority 0）在 EVALUATING（priority 1）之前
      expect(result[0].project.stage).toBe('OPENING');
      expect(result[1].project.stage).toBe('EVALUATING');
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
      // 4.5: AiBidderResult 未就绪 → 降级走规则引擎（ai.analyzeBid）
      prisma.aiBidderResult.findFirst.mockResolvedValue(null);
      ai.analyzeBid.mockResolvedValue({ supplierName: '川水建设', keyPoints: [] });

      const result = await service.getAssistData('user-1', 'proj-1', 'sup-1');

      expect(ai.analyzeBid).toHaveBeenCalledWith('proj-1', 'sup-1', 'exp-1');
    });

    it('返回 requirements + requirementResponses + 本人 reviews', async () => {
      prisma.bidProject.findUnique.mockResolvedValue({ stage: 'EVALUATING' });
      prisma.bidExpert.findFirst.mockResolvedValue({ id: 'exp-1', userId: 'u1', conflictedSupplierIds: [] });
      prisma.aiBidderResult.findFirst.mockResolvedValue({
        id: 'br-1', status: 'COMPLETED', totalScore: 80, scoreItems: [], categoryTotals: {}, keyInfo: {},
        strengths: [], weaknesses: [], overallComment: '', qualificationStatus: '通过', riskLevel: 'low',
        requirementResponses: [{ requirementId: 'r1', category: 'technical', status: 'met', location: { fileId: 'fa1', page: 1 } }],
        concordance: null,
        bidSupplier: { supplierName: '甲公司' },
      });
      prisma.aiBidAnalysisTask = { findUnique: jest.fn().mockResolvedValue({ id: 't-1', requirements: { technicalRequirements: [{ id: 'r1', content: '工期', isStarred: true }] } }) };
      prisma.aiBidReport = { findUnique: jest.fn().mockResolvedValue(null) };
      prisma.bidRequirementReview = { findMany: jest.fn().mockResolvedValue([{ requirementId: 'r1', verdict: 'dispute', note: '存疑' }]) };

      const out = await service.getAssistData('u1', 'proj-1', 'sup-1');
      expect(out.source).toBe('ai_bidder_result');
      expect(out.requirements).toEqual({ technicalRequirements: [{ id: 'r1', content: '工期', isStarred: true }] });
      expect(out.requirementResponses).toHaveLength(1);
      expect(out.reviews).toEqual([{ requirementId: 'r1', verdict: 'dispute', note: '存疑' }]);
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

    it('submitScores：通过性项接收 passed、跳过 maxScore、落库 score=0', async () => {
      prisma.bidExpert.findFirst.mockResolvedValue({
        id: 'exp1', userId: 'u1', projectId: 'p1', reportConfirmed: false,
        signedIn: true, avoidanceConfirmed: true, conflictedSupplierIds: [], expertName: '刘',
      });
      // 通过性项 maxScore=0
      prisma.bidScoreItem.findMany.mockResolvedValue([
        { id: 'si1', maxScore: 0, category: 'QUALIFICATION' },
      ]);
      prisma.bidSupplier.findMany.mockResolvedValue([
        { id: 'sup1', supplierName: '甲', decryptStatus: 'SUCCESS', submitStatus: 'submitted' },
      ]);
      prisma.bidProject.findUnique.mockResolvedValue({ stage: 'EVALUATING' });
      prisma.bidScoreRecord.upsert.mockResolvedValue({});
      prisma.bidScoreItem.findMany // progress 回读
        .mockResolvedValueOnce([{ id: 'si1', maxScore: 0, category: 'QUALIFICATION' }])
        .mockResolvedValueOnce([{ id: 'si1' }]);
      prisma.bidScoreRecord.count.mockResolvedValue(1);
      prisma.bidScoreRecord.findMany.mockResolvedValue([{ score: 0 }]);
      prisma.bidExpert.update.mockResolvedValue({});

      await service.submitScores('u1', 'p1', {
        supplierName: '甲',
        scores: [{ scoreItemId: 'si1', supplierId: 'sup1', passed: false, reason: '资质不符' }],
      } as any);

      expect(prisma.bidScoreRecord.upsert).toHaveBeenCalledWith(expect.objectContaining({
        update: expect.objectContaining({ score: 0, passed: false, reason: '资质不符' }),
        create: expect.objectContaining({ score: 0, passed: false }),
      }));
    });

    it('submitScores：通过性项缺 passed 报错', async () => {
      prisma.bidExpert.findFirst.mockResolvedValue({
        id: 'exp1', userId: 'u1', projectId: 'p1', reportConfirmed: false,
        signedIn: true, avoidanceConfirmed: true, conflictedSupplierIds: [], expertName: '刘',
      });
      prisma.bidScoreItem.findMany.mockResolvedValue([{ id: 'si1', maxScore: 0, category: 'RESPONSIVE' }]);
      prisma.bidSupplier.findMany.mockResolvedValue([
        { id: 'sup1', supplierName: '甲', decryptStatus: 'SUCCESS', submitStatus: 'submitted' },
      ]);
      await expect(service.submitScores('u1', 'p1', {
        supplierName: '甲',
        scores: [{ scoreItemId: 'si1', supplierId: 'sup1', score: 0 }],
      } as any)).rejects.toThrow(BadRequestException);
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
      // 应通过 userId + 阶段过滤查询专家记录
      expect(prisma.bidExpert.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { userId: 'user-1', project: { stage: { in: ['OPENING', 'EVALUATING', 'ARCHIVED'] } } } }),
      );
    });
  });

  describe('getReport — 进度口径 (G7)', () => {
    beforeEach(() => {
      prisma.bidExpert.findFirst.mockResolvedValue({
        id: 'exp-1', expertName: '王建国', progress: 100, signedIn: true, avoidanceConfirmed: true,
      });
      prisma.user.findUnique.mockResolvedValue({ id: 'u1' });
      prisma.bidProject.findUnique.mockResolvedValue({
        id: 'p1', name: '项目', projectCode: 'BID-1',
        suppliers: [{ id: 's1', supplierName: '甲' }],
        scoreItems: [{ id: 'si1', category: 'TECHNICAL', name: '技术', maxScore: 10 }],
      });
      prisma.bidScoreRecord.findMany.mockResolvedValue([
        { supplierId: 's1', score: 8, scoreItem: { id: 'si1', category: 'TECHNICAL', name: '技术', maxScore: 10 } },
      ]);
    });

    it('返回 perSupplierComplete（单供应商维度）与 overallComplete（整体）', async () => {
      const report = await service.getReport('u1', 'p1');
      expect(report.overallComplete).toBe(true); // progress=100
      expect(report.supplierScores[0].perSupplierComplete).toBe(true); // 该供应商 1 项已评 1 项
      // 旧字段 completed 不应再出现
      expect((report.supplierScores[0] as any).completed).toBeUndefined();
    });

    it('progress<100 时 overallComplete=false（即便单供应商评分已齐）', async () => {
      // G7: overallComplete 仅由 expert.progress>=100 决定，与 perSupplierComplete 无强耦合
      prisma.bidExpert.findFirst.mockResolvedValue({
        id: 'exp-1', expertName: '王建国', progress: 80, signedIn: true, avoidanceConfirmed: true,
      });

      const report = await service.getReport('u1', 'p1');

      expect(report.overallComplete).toBe(false); // progress=80
      // perSupplierComplete 仍可 true（mock 数据中该供应商 1 项已评 1 项）
      expect(report.supplierScores[0].perSupplierComplete).toBe(true);
    });

    it('通过性类别的 item 带 passed（供前端 Task 8 渲染）', async () => {
      prisma.bidProject.findUnique.mockResolvedValue({
        id: 'p1', name: '项目', projectCode: 'P1',
        suppliers: [{ id: 'sup1', supplierName: '甲' }],
        scoreItems: [{ id: 'si1', category: 'QUALIFICATION', name: '资格性审查', maxScore: 0 }],
      });
      prisma.bidScoreRecord.findMany.mockResolvedValue([
        { supplierId: 'sup1', score: 0, passed: false, reason: '不符', scoreItem: { id: 'si1', category: 'QUALIFICATION', name: '资格性审查', maxScore: 0 } },
      ]);
      const report = await service.getReport('u1', 'p1');
      const item = report.supplierScores[0].categoryScores['QUALIFICATION'].items[0];
      expect(item.passed).toBe(false);
    });
  });

  describe('getTenderDocument — 招标文件元信息', () => {
    const signedExpert = { ...mockExpert, id: 'exp-1', expertName: '王建国', signedIn: true, avoidanceConfirmed: true };

    beforeEach(() => {
      prisma.bidProject.findUnique.mockResolvedValue({ stage: 'EVALUATING' });
      prisma.bidExpert.findFirst.mockResolvedValue(signedExpert);
      prisma.bidDocument = { findFirst: jest.fn() };
    });

    it('有招标文件 → 返回元信息与下载地址', async () => {
      prisma.bidDocument.findFirst.mockResolvedValue({
        id: 'bd-1', title: '招标文件', decryptKey: 'xxx',
        fileAsset: { id: 'fa-1', originalName: 'tender.pdf', size: 4979 },
      });

      const result = await service.getTenderDocument('user-1', 'proj-1');

      expect(result).toEqual({
        title: '招标文件',
        fileName: 'tender.pdf',
        fileSize: 4979,
        downloadUrl: '/api/expert/projects/proj-1/tender-document/download',
      });
      expect(prisma.bidDocument.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { bidProjectId: 'proj-1' } }),
      );
    });

    it('无招标文件 → 返回 null', async () => {
      prisma.bidDocument.findFirst.mockResolvedValue(null);

      const result = await service.getTenderDocument('user-1', 'proj-1');

      expect(result).toBeNull();
    });

    it('非本项目专家 → 403 NOT_PROJECT_EXPERT', async () => {
      prisma.bidExpert.findFirst.mockResolvedValue(null);

      await expect(service.getTenderDocument('user-1', 'proj-1'))
        .rejects.toMatchObject({ response: { code: 'NOT_PROJECT_EXPERT' } });
    });

    it('未完成签到/回避 → 403 VERIFICATION_REQUIRED', async () => {
      prisma.bidExpert.findFirst.mockResolvedValue({ ...mockExpert, signedIn: false, avoidanceConfirmed: false });

      await expect(service.getTenderDocument('user-1', 'proj-1'))
        .rejects.toMatchObject({ response: { code: 'VERIFICATION_REQUIRED' } });
    });

    it('项目阶段不在 OPENING/EVALUATING → 403 PROJECT_NOT_ACTIVE', async () => {
      prisma.bidProject.findUnique.mockResolvedValue({ stage: 'ARCHIVED' });

      await expect(service.getTenderDocument('user-1', 'proj-1'))
        .rejects.toMatchObject({ response: { code: 'PROJECT_NOT_ACTIVE' } });
    });
  });

  describe('downloadTenderDocument — 招标文件解密下载', () => {
    const signedExpert = { ...mockExpert, id: 'exp-1', expertName: '王建国', signedIn: true, avoidanceConfirmed: true };
    const origKms = process.env.KMS_SECRET;

    beforeEach(() => {
      prisma.bidProject.findUnique.mockResolvedValue({ stage: 'EVALUATING' });
      prisma.bidExpert.findFirst.mockResolvedValue(signedExpert);
      prisma.bidDocument = { findFirst: jest.fn() };
      process.env.KMS_SECRET = 'test-kms-secret';
    });

    afterEach(() => {
      process.env.KMS_SECRET = origKms;
      jest.restoreAllMocks();
    });

    it('无招标文件 → 404 NOT_FOUND', async () => {
      prisma.bidDocument.findFirst.mockResolvedValue(null);

      await expect(service.downloadTenderDocument('user-1', 'proj-1'))
        .rejects.toMatchObject({ response: { code: 'NOT_FOUND' } });
    });

    it('成功解密明文 PDF 并写入访问日志（wrapped key）', async () => {
      const plaintext = Buffer.from('%PDF-1.4 fake tender content');
      const { ciphertext, decryptKey } = encryptBuffer(plaintext);
      const wrapped = wrapKey(decryptKey, process.env.KMS_SECRET!);
      prisma.bidDocument.findFirst.mockResolvedValue({
        id: 'bd-1', title: '招标文件', decryptKey: wrapped,
        fileAsset: { id: 'fa-1', key: 'seed/hero/tender.pdf', originalName: 'tender.pdf' },
      });
      jest.spyOn(minioClient, 'getObject').mockResolvedValue({
        async *[Symbol.asyncIterator]() { yield ciphertext; },
      } as any);
      prisma.bidSupervisionLog.create.mockResolvedValue({});

      const result = await service.downloadTenderDocument('user-1', 'proj-1');

      expect(result.buffer.equals(plaintext)).toBe(true);
      expect(result.fileName).toBe('tender.pdf');
      expect(result.mimeType).toBe('application/pdf');
      expect(prisma.bidSupervisionLog.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({
          projectId: 'proj-1',
          role: '评审专家',
          target: '王建国',
          action: '访问招标文件',
          riskFlag: '无',
        }),
      }));
    });
  });

  describe('getProject — 附带招标文件元信息', () => {
    beforeEach(() => {
      prisma.bidExpert.findFirst.mockResolvedValue({
        id: 'exp-1', userId: 'user-1', phoneVerified: true, expertName: '王建国',
        user: { expertProfile: { phone: '13800001111' } },
      });
      prisma.bidProject.findUnique.mockResolvedValue({
        id: 'proj-1', stage: 'EVALUATING', projectCode: 'BID-1', name: '项目',
        suppliers: [], openingSession: null, openingRecords: [], experts: [],
        scoreItems: [], clarifications: [], supervisionLogs: [],
      });
      prisma.bidScoreRecord.findMany.mockResolvedValue([]);
      prisma.bidDocument = { findFirst: jest.fn() };
    });

    it('active 项目附带 tenderDocument 元信息', async () => {
      prisma.bidDocument.findFirst.mockResolvedValue({
        title: '招标文件', fileAsset: { originalName: 'tender.pdf', size: 4979 },
      });

      const result = await service.getProject('user-1', 'proj-1');

      expect(result.restricted).toBe(false);
      expect(result.tenderDocument).toEqual({
        title: '招标文件',
        fileName: 'tender.pdf',
        fileSize: 4979,
        downloadUrl: '/api/expert/projects/proj-1/tender-document/download',
      });
    });

    it('无招标文件 → tenderDocument 为 null（仍 active）', async () => {
      prisma.bidDocument.findFirst.mockResolvedValue(null);

      const result = await service.getProject('user-1', 'proj-1');

      expect(result.restricted).toBe(false);
      expect(result.tenderDocument).toBeNull();
    });
  });

  describe('getMyScores', () => {
    it('返回 records + disputeCategories（映射为大写）', async () => {
      prisma.bidExpert.findFirst.mockResolvedValue({ id: 'exp-1', userId: 'u1', signedIn: true, avoidanceConfirmed: true });
      prisma.bidScoreRecord.findMany.mockResolvedValue([]);
      prisma.bidRequirementReview = { findMany: jest.fn().mockResolvedValue([
        { category: 'technical', verdict: 'dispute' },
        { category: 'commercial', verdict: 'dispute' },
        { category: 'qualification', verdict: 'ack' }, // 非异议不计
      ]) };
      const out = await service.getMyScores('u1', 'proj-1');
      expect(out.records).toEqual([]);
      expect(out.disputeCategories).toEqual(['TECHNICAL', 'BUSINESS']);
    });
  });

  describe('requirement reviews', () => {
    beforeEach(() => {
      prisma.bidProject.findUnique.mockResolvedValue({ stage: 'EVALUATING' });
      prisma.bidExpert.findFirst.mockResolvedValue({ id: 'exp-1', userId: 'u1', conflictedSupplierIds: [], signedIn: true, avoidanceConfirmed: true });
      prisma.aiBidderResult.findFirst.mockResolvedValue({ id: 'br-1', status: 'COMPLETED' });
      prisma.bidRequirementReview = { upsert: jest.fn(), findMany: jest.fn() };
    });

    it('upsert 写入本人标注（唯一约束 upsert）', async () => {
      prisma.bidRequirementReview.upsert.mockResolvedValue({ id: 'rv-1' });
      await service.upsertRequirementReview('u1', 'proj-1', 'sup-1', { requirementId: 'r1', category: 'technical', verdict: 'dispute', note: 'x' });
      expect(prisma.bidRequirementReview.upsert).toHaveBeenCalledWith(expect.objectContaining({
        where: { projectId_bidderResultId_expertId_requirementId: { projectId: 'proj-1', bidderResultId: 'br-1', expertId: 'exp-1', requirementId: 'r1' } },
        create: expect.objectContaining({ verdict: 'dispute', expertId: 'exp-1' }),
      }));
    });

    it('list 仅返回本人标注', async () => {
      prisma.bidRequirementReview.findMany.mockResolvedValue([{ requirementId: 'r1' }]);
      const out = await service.listRequirementReviews('u1', 'proj-1', 'sup-1');
      expect(prisma.bidRequirementReview.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ expertId: 'exp-1' }) }));
      expect(out).toHaveLength(1);
    });

    it('非本项目专家 → 403', async () => {
      prisma.bidExpert.findFirst.mockResolvedValue(null);
      await expect(service.upsertRequirementReview('u1', 'proj-1', 'sup-1', { requirementId: 'r1', category: 'technical', verdict: 'ack' }))
        .rejects.toMatchObject({ response: { code: 'NOT_PROJECT_EXPERT' } });
    });

    it('回避名单中的供应商 → 403', async () => {
      prisma.bidExpert.findFirst.mockResolvedValue({ id: 'exp-1', conflictedSupplierIds: ['sup-1'] });
      await expect(service.upsertRequirementReview('u1', 'proj-1', 'sup-1', { requirementId: 'r1', category: 'technical', verdict: 'ack' }))
        .rejects.toMatchObject({ response: { code: 'CONFLICTED_SUPPLIER' } });
    });
  });
});
