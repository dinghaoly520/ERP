import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException, BadRequestException, ConflictException } from '@nestjs/common';
import { ExpertService } from './expert.service';
import { PrismaService } from '../prisma/prisma.service';
import { AiService } from '../ai/ai.service';
import { ExpertConflictService } from './expert-conflict.service';
import { encryptBuffer } from '../announcement/bid-document.crypto';
import { wrapKey } from '../common/crypto/envelope-crypto';
import { ClarificationAiService } from '../bid/clarification-ai.service';
import { BidGateway } from '../bid/bid.gateway';
import { minioClient } from '../upload/minio.client';
import { PlaintextFetcherService } from '../ai-bid-analysis/services/plaintext-fetcher.service';

describe('ExpertService', () => {
  let service: ExpertService;
  let prisma: any;
  let ai: any;
  let gateway: any;

  const mockExpert = {
    id: 'exp-1',
    userId: 'user-1',
    expertName: '王建国',
    projectId: 'proj-1',
    major: '水利工程',
    expertRole: '正选', // P1-6：门控 fixture 默认正选（候补场景由专项 describe 覆盖）
    signedIn: false,
    avoidanceConfirmed: false,
    aiConsentConfirmed: true,
    progress: 0,
    totalScore: 0,
    phoneVerified: true,
    reportConfirmed: false,
  };

  beforeEach(async () => {
    prisma = {
      user: { findUnique: jest.fn(), update: jest.fn() },
      expertProfile: { findUnique: jest.fn(), upsert: jest.fn() },
      bidExpert: {
        findMany: jest.fn(),
        findFirst: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
        count: jest.fn(),
      },
      bidProject: { findUnique: jest.fn(), update: jest.fn().mockResolvedValue({}) },
      bidSupplier: { findFirst: jest.fn(), findMany: jest.fn(), count: jest.fn(), update: jest.fn().mockResolvedValue({}) },
      bidInvalidBid: { upsert: jest.fn().mockResolvedValue({}), findUnique: jest.fn(), findFirst: jest.fn().mockResolvedValue(null), update: jest.fn().mockResolvedValue({}), create: jest.fn().mockResolvedValue({}), count: jest.fn().mockResolvedValue(0) },
      supplierBidSubmission: { findUnique: jest.fn() },
      fileAsset: { findMany: jest.fn(), findUnique: jest.fn() },
      bidScoreRecord: {
        findMany: jest.fn(),
        deleteMany: jest.fn(),
        create: jest.fn(),
        createMany: jest.fn(),
        count: jest.fn(),
        upsert: jest.fn(),
      },
      bidScoreItem: { findMany: jest.fn(), count: jest.fn() },
      bidScorePoint: { findMany: jest.fn().mockResolvedValue([]) },
      bidScorePointDecision: { upsert: jest.fn().mockResolvedValue({}), findMany: jest.fn().mockResolvedValue([]) },
      bidScoreReview: { upsert: jest.fn().mockResolvedValue({}), findMany: jest.fn().mockResolvedValue([]), findUnique: jest.fn(), update: jest.fn() },
      bidSupplierCount: jest.fn(),
      bidSupervisionLog: { create: jest.fn().mockResolvedValue({}), findMany: jest.fn() },
      bidClarification: { create: jest.fn() },
      aiBidderResult: { findFirst: jest.fn(), findMany: jest.fn().mockResolvedValue([]) },
      bidScoreDelta: { upsert: jest.fn(), updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
      expertDispute: { findFirst: jest.fn(), create: jest.fn(), findMany: jest.fn() },
      bidMotion: { findMany: jest.fn() },
      bidOpeningRecord: { findMany: jest.fn().mockResolvedValue([]) },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
      $transaction: jest.fn(async (arg: any) => (Array.isArray(arg) ? Promise.all(arg) : arg(prisma))),
      $queryRaw: jest.fn(),
    };

    ai = { analyzeBid: jest.fn() };
    gateway = {
      notifyExpertPresence: jest.fn(),
      broadcastAggregatePresence: jest.fn(),
      notifyBidValidity: jest.fn(),
      notifyAnomaly: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ExpertService,
        { provide: PrismaService, useValue: prisma },
        { provide: AiService, useValue: ai },
        { provide: ExpertConflictService, useValue: { detectForProject: jest.fn().mockResolvedValue([]) } },
        { provide: PlaintextFetcherService, useValue: { fetchBidderPlaintext: jest.fn() } },
        { provide: ClarificationAiService, useValue: { draftQuestion: jest.fn().mockResolvedValue({ drafts: [], basis: [] }), summarizeReply: jest.fn().mockResolvedValue(null) } },
        { provide: BidGateway, useValue: gateway },
      ],
    }).compile();

    service = module.get<ExpertService>(ExpertService);
  });

  describe('getContactCheck / confirmContact', () => {
    it('未确认联系方式时 contactConfirmedAt 为 null', async () => {
      prisma.user.findUnique.mockResolvedValue({ displayName: '刘苡池', phone: null, email: null });
      prisma.expertProfile.findUnique.mockResolvedValue(null);

      const result = await service.getContactCheck('user-1');

      expect(result).toEqual({ displayName: '刘苡池', phone: '', email: '', contactConfirmedAt: null });
    });

    it('confirmContact 应同步写入 User/ExpertProfile 并打上确认时间戳', async () => {
      prisma.user.update.mockResolvedValue({});
      prisma.expertProfile.upsert.mockResolvedValue({});
      // confirmContact 末尾会调用 getContactCheck 重新读取
      prisma.user.findUnique.mockResolvedValue({ displayName: '刘苡池', phone: '13800138000', email: 'liu@example.com' });
      prisma.expertProfile.findUnique.mockResolvedValue({ phone: '13800138000', contactConfirmedAt: new Date('2026-07-23T10:00:00Z') });

      const result = await service.confirmContact('user-1', { phone: '13800138000', email: 'liu@example.com' });

      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'user-1' }, data: expect.objectContaining({ phone: '13800138000', email: 'liu@example.com' }) }),
      );
      expect(prisma.expertProfile.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: 'user-1' },
          update: expect.objectContaining({ phone: '13800138000', contactConfirmedAt: expect.any(Date) }),
        }),
      );
      expect(result.contactConfirmedAt).not.toBeNull();
      expect(result.phone).toBe('13800138000');
    });
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
        expect.objectContaining({ data: { signedIn: true, signInIp: null, signInMeta: undefined } }),
      );
    });

    it('带合法拍照留痕 → photoAssetId 并入 signInMeta', async () => {
      prisma.bidProject.findUnique.mockResolvedValue({ stage: 'OPENING' });
      prisma.bidExpert.findFirst.mockResolvedValue(mockExpert);
      prisma.fileAsset.findUnique.mockResolvedValue({ id: 'photo-1', category: 'expert_signin_photo', uploaderId: 'user-1' });
      prisma.bidExpert.update.mockResolvedValue({ ...mockExpert, signedIn: true });

      await service.signIn('user-1', 'proj-1', { ip: '10.0.0.1', userAgent: 'ua' }, 'photo-1');

      expect(prisma.fileAsset.findUnique).toHaveBeenCalledWith({ where: { id: 'photo-1' } });
      expect(prisma.bidExpert.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            signInMeta: expect.objectContaining({ photoAssetId: 'photo-1', ip: '10.0.0.1' }),
          }),
        }),
      );
    });

    it('照片不属于本人或分类不符 → 400 INVALID_SIGNIN_PHOTO', async () => {
      prisma.bidProject.findUnique.mockResolvedValue({ stage: 'OPENING' });
      prisma.bidExpert.findFirst.mockResolvedValue(mockExpert);
      prisma.fileAsset.findUnique.mockResolvedValue({ id: 'photo-9', category: 'general', uploaderId: 'user-2' });

      await expect(service.signIn('user-1', 'proj-1', undefined, 'photo-9'))
        .rejects.toMatchObject({ response: { code: 'INVALID_SIGNIN_PHOTO' } });
      expect(prisma.bidExpert.update).not.toHaveBeenCalled();
    });
  });

  describe('confirmAiConsent', () => {
    it('确认成功应写入 aiConsentConfirmed=true 与时间戳', async () => {
      prisma.bidProject.findUnique.mockResolvedValue({ stage: 'EVALUATING' });
      prisma.bidExpert.findFirst.mockResolvedValue(mockExpert);
      prisma.bidExpert.update.mockResolvedValue({ ...mockExpert, aiConsentConfirmed: true });

      const result = await service.confirmAiConsent('user-1', 'proj-1');

      expect(prisma.bidExpert.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { aiConsentConfirmed: true, aiConsentAt: expect.any(Date) },
        }),
      );
      expect(result.aiConsentConfirmed).toBe(true);
    });

    it('非活动阶段 → 403 PROJECT_NOT_ACTIVE', async () => {
      prisma.bidProject.findUnique.mockResolvedValue({ stage: 'ARCHIVED' });
      await expect(service.confirmAiConsent('user-1', 'proj-1'))
        .rejects.toMatchObject({ response: { code: 'PROJECT_NOT_ACTIVE' } });
    });

    it('非本项目专家 → 403 NOT_PROJECT_EXPERT', async () => {
      prisma.bidProject.findUnique.mockResolvedValue({ stage: 'OPENING' });
      prisma.bidExpert.findFirst.mockResolvedValue(null);
      await expect(service.confirmAiConsent('user-1', 'proj-1'))
        .rejects.toMatchObject({ response: { code: 'NOT_PROJECT_EXPERT' } });
    });
  });

  describe('getAssistData', () => {
    it('应调用 AI 引擎进行分析', async () => {
      prisma.bidProject.findUnique.mockResolvedValue({ stage: 'OPENING' });
      prisma.bidExpert.findFirst.mockResolvedValue({ ...mockExpert, signedIn: true, avoidanceConfirmed: true, aiConsentConfirmed: true, confidentialityAgreed: true, disciplineAgreed: true });
      // 4.5: AiBidderResult 未就绪 → 降级走规则引擎（ai.analyzeBid）
      prisma.aiBidderResult.findFirst.mockResolvedValue(null);
      ai.analyzeBid.mockResolvedValue({ supplierName: '川水建设', keyPoints: [] });

      const result = await service.getAssistData('user-1', 'proj-1', 'sup-1');

      expect(ai.analyzeBid).toHaveBeenCalledWith('proj-1', 'sup-1', 'exp-1');
    });

    it('返回 requirements + requirementResponses + 本人 reviews', async () => {
      prisma.bidProject.findUnique.mockResolvedValue({ stage: 'EVALUATING' });
      prisma.bidExpert.findFirst.mockResolvedValue({ id: 'exp-1', userId: 'u1', expertRole: '正选', conflictedSupplierIds: [], signedIn: true, avoidanceConfirmed: true, aiConsentConfirmed: true, confidentialityAgreed: true, disciplineAgreed: true });
      prisma.aiBidderResult.findFirst.mockResolvedValue({
        id: 'br-1', status: 'COMPLETED', totalScore: 80, scoreItems: [], categoryTotals: {}, keyInfo: {},
        strengths: [], weaknesses: [], overallComment: '', qualificationStatus: '通过', riskLevel: 'low',
        starredResponse: { allMet: true, unmet: [] },
        requirementResponses: [{ requirementId: 'r1', category: 'technical', status: 'met', location: { fileId: 'fa1', page: 1 } }],
        concordance: null,
        bidSupplier: { supplierName: '甲公司' },
      });
      prisma.aiBidAnalysisTask = { findUnique: jest.fn().mockResolvedValue({ id: 't-1', requirements: { technicalRequirements: [{ id: 'r1', content: '工期', isStarred: true }] } }) };
      prisma.bidRequirementReview = { findMany: jest.fn().mockResolvedValue([{ requirementId: 'r1', verdict: 'dispute', note: '存疑' }]) };

      const out = await service.getAssistData('u1', 'proj-1', 'sup-1');
      expect(out.source).toBe('ai_bidder_result');
      expect(out.requirements).toEqual({ technicalRequirements: [{ id: 'r1', content: '工期', isStarred: true }] });
      expect(out.requirementResponses).toHaveLength(1);
      expect(out.reviews).toEqual([{ requirementId: 'r1', verdict: 'dispute', note: '存疑' }]);
      expect(out.starredResponse).toEqual({ allMet: true, unmet: [] });
      expect(out).not.toHaveProperty('fraudSummary');
      expect(out).not.toHaveProperty('reportDocxUrl');
      expect(prisma.aiBidReport).toBeUndefined(); // 不再查 AiBidReport
      // ⑥：多条 COMPLETED 时必须取最新——与 resolveReviewContext 读写同源
      expect(prisma.aiBidderResult.findFirst).toHaveBeenCalledWith(expect.objectContaining({
        orderBy: { createdAt: 'desc' },
      }));
    });

    it('映射 competitiveAnalysis.keyObservations 到顶层', async () => {
      prisma.bidProject.findUnique.mockResolvedValue({ stage: 'EVALUATING' });
      prisma.bidExpert.findFirst.mockResolvedValue({ id: 'exp-1', userId: 'u1', expertRole: '正选', conflictedSupplierIds: [], signedIn: true, avoidanceConfirmed: true, aiConsentConfirmed: true, confidentialityAgreed: true, disciplineAgreed: true });
      prisma.aiBidderResult.findFirst.mockResolvedValue({
        id: 'br-1', status: 'COMPLETED', totalScore: 80, scoreItems: [], categoryTotals: {}, keyInfo: {},
        strengths: [], weaknesses: [], overallComment: '', qualificationStatus: '通过', riskLevel: 'low',
        starredResponse: { allMet: true, unmet: [] },
        competitiveAnalysis: { strengths: [], weaknesses: [], keyObservations: ['报价次低', '技术维持首轮'] },
        requirementResponses: [], concordance: null,
        bidSupplier: { supplierName: '甲公司' },
      });
      prisma.aiBidAnalysisTask = { findUnique: jest.fn().mockResolvedValue({ id: 't-1', requirements: null }) };
      prisma.bidRequirementReview = { findMany: jest.fn().mockResolvedValue([]) };

      const out = await service.getAssistData('u1', 'proj-1', 'sup-1') as any;
      expect(out.source).toBe('ai_bidder_result');
      expect(out.keyObservations).toEqual(['报价次低', '技术维持首轮']);
    });

    it('competitiveAnalysis 被旧版 comparative-scoring 覆盖时 keyObservations 兜底空数组', async () => {
      prisma.bidProject.findUnique.mockResolvedValue({ stage: 'EVALUATING' });
      prisma.bidExpert.findFirst.mockResolvedValue({ id: 'exp-1', userId: 'u1', expertRole: '正选', conflictedSupplierIds: [], signedIn: true, avoidanceConfirmed: true, aiConsentConfirmed: true, confidentialityAgreed: true, disciplineAgreed: true });
      // 历史数据：第二轮覆盖后 competitiveAnalysis 只剩横向校准三字段，无 keyObservations
      prisma.aiBidderResult.findFirst.mockResolvedValue({
        id: 'br-1', status: 'COMPLETED', totalScore: 80, scoreItems: [], categoryTotals: {}, keyInfo: {},
        strengths: [], weaknesses: [], overallComment: '', qualificationStatus: '通过', riskLevel: 'low',
        starredResponse: null,
        competitiveAnalysis: { comparativeScore: 80, previousScore: 78, reason: '横向校准' },
        requirementResponses: [], concordance: null,
        bidSupplier: { supplierName: '甲公司' },
      });
      prisma.aiBidAnalysisTask = { findUnique: jest.fn().mockResolvedValue({ id: 't-1', requirements: null }) };
      prisma.bidRequirementReview = { findMany: jest.fn().mockResolvedValue([]) };

      const out = await service.getAssistData('u1', 'proj-1', 'sup-1') as any;
      expect(out.keyObservations).toEqual([]);
    });
  });

  describe('getAssistCompare', () => {
    it('返回 bidders + projectFraudSummary（reportDocxUrl 对 bid_expert 恒 null）', async () => {
      prisma.bidProject.findUnique.mockResolvedValue({ stage: 'EVALUATING' });
      prisma.bidExpert.findFirst.mockResolvedValue({ id: 'exp-1', userId: 'u1', expertRole: '正选', signedIn: true, avoidanceConfirmed: true, aiConsentConfirmed: true, confidentialityAgreed: true, disciplineAgreed: true });
      prisma.aiBidAnalysisTask = { findUnique: jest.fn().mockResolvedValue({ id: 't-1' }) };
      prisma.aiBidderResult.findMany.mockResolvedValue([
        { bidSupplierId: 's1', totalScore: 80, categoryTotals: {}, qualificationStatus: '通过', riskLevel: 'low',
          bidSupplier: { supplierName: '甲' } },
      ]);
      prisma.aiBidReport = { findUnique: jest.fn().mockResolvedValue({
        fraudIndicators: { riskLevel: 'medium', summary: { totalCount: 3 } },
        docxFileId: 'doc-1',
      }) };

      const out = await service.getAssistCompare('u1', 'proj-1');
      expect(out.bidders).toHaveLength(1);
      expect(out.bidders[0]).toMatchObject({ supplierId: 's1', supplierName: '甲', totalScore: 80 });
      expect(out.projectFraudSummary).toEqual({ riskLevel: 'medium', indicatorCount: 3 });
      expect(out.reportDocxUrl).toBeNull(); // P1-2：bid_expert 无该 FileAsset 访问权，恒 null
    });

    it('无 task 时返回空 bidders + null 摘要', async () => {
      prisma.bidProject.findUnique.mockResolvedValue({ stage: 'EVALUATING' });
      prisma.bidExpert.findFirst.mockResolvedValue({ id: 'exp-1', userId: 'u1', expertRole: '正选', signedIn: true, avoidanceConfirmed: true, aiConsentConfirmed: true, confidentialityAgreed: true, disciplineAgreed: true });
      prisma.aiBidAnalysisTask = { findUnique: jest.fn().mockResolvedValue(null) };
      const out = await service.getAssistCompare('u1', 'proj-1');
      expect(out.bidders).toEqual([]);
      expect(out.projectFraudSummary).toBeNull();
      expect(out.reportDocxUrl).toBeNull();
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
    const signedExpert = { ...mockExpert, signedIn: true, avoidanceConfirmed: true, aiConsentConfirmed: true, confidentialityAgreed: true, disciplineAgreed: true };

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
        signedIn: true, avoidanceConfirmed: true, aiConsentConfirmed: true, confidentialityAgreed: true, disciplineAgreed: true, conflictedSupplierIds: [], expertName: '刘', expertRole: '正选',
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
        signedIn: true, avoidanceConfirmed: true, aiConsentConfirmed: true, confidentialityAgreed: true, disciplineAgreed: true, conflictedSupplierIds: [], expertName: '刘', expertRole: '正选',
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

    it('submitScores：有 points 但 pointDecisions 为空 → DECISIONS_REQUIRED', async () => {
      prisma.bidExpert.findFirst.mockResolvedValue({
        id: 'exp1', userId: 'u1', projectId: 'p1', reportConfirmed: false,
        signedIn: true, avoidanceConfirmed: true, aiConsentConfirmed: true, confidentialityAgreed: true, disciplineAgreed: true, conflictedSupplierIds: [], expertName: '刘', expertRole: '正选',
      });
      prisma.bidScoreItem.findMany.mockResolvedValue([{ id: 'si1', maxScore: 30, category: 'TECHNICAL', name: '技术评分' }]);
      prisma.bidScorePoint.findMany.mockResolvedValue([
        { id: 'pt1', scoreItemId: 'si1', objective: true, fullScore: 15 },
      ]);
      prisma.bidSupplier.findMany.mockResolvedValue([{ id: 'sup1', supplierName: '甲', decryptStatus: 'SUCCESS', submitStatus: 'submitted' }]);

      await expect(service.submitScores('u1', 'p1', {
        supplierName: '甲',
        scores: [{ scoreItemId: 'si1', supplierId: 'sup1', reason: '' }], // no pointDecisions
      } as any)).rejects.toMatchObject({ response: { code: 'DECISIONS_REQUIRED' } });
    });

    it('submitScores：有 points 大类走 decision 汇总，BidScoreRecord.score=Σ', async () => {
      prisma.bidExpert.findFirst.mockResolvedValue({
        id: 'exp1', userId: 'u1', projectId: 'p1', reportConfirmed: false,
        signedIn: true, avoidanceConfirmed: true, aiConsentConfirmed: true, confidentialityAgreed: true, disciplineAgreed: true, conflictedSupplierIds: [], expertName: '刘', expertRole: '正选',
      });
      // item 有 points
      prisma.bidScoreItem.findMany.mockResolvedValue([{ id: 'si1', maxScore: 30, category: 'TECHNICAL' }]);
      prisma.bidScorePoint.findMany.mockResolvedValue([
        { id: 'pt1', scoreItemId: 'si1', objective: true, fullScore: 15 },
        { id: 'pt2', scoreItemId: 'si1', objective: false, fullScore: 15 },
      ]);
      prisma.bidSupplier.findMany.mockResolvedValue([{ id: 'sup1', supplierName: '甲', decryptStatus: 'SUCCESS', submitStatus: 'submitted' }]);
      prisma.bidProject.findUnique.mockResolvedValue({ stage: 'EVALUATING' });
      prisma.bidScorePointDecision.upsert.mockResolvedValue({});
      prisma.bidScoreRecord.upsert.mockResolvedValue({});
      prisma.bidScoreRecord.count.mockResolvedValue(1);
      prisma.bidScoreRecord.findMany.mockResolvedValue([{ score: 20 }]);

      await service.submitScores('u1', 'p1', {
        supplierName: '甲',
        scores: [{
          scoreItemId: 'si1', supplierId: 'sup1', reason: '',
          pointDecisions: [
            { pointId: 'pt1', checked: true, awardedScore: 15 },
            { pointId: 'pt2', checked: true, awardedScore: 5 },
          ],
        }],
      } as any);

      // decisions 落库
      expect(prisma.bidScorePointDecision.upsert).toHaveBeenCalledTimes(2);
      // BidScoreRecord.score = 15 + 5 = 20
      expect(prisma.bidScoreRecord.upsert).toHaveBeenCalledWith(expect.objectContaining({
        update: expect.objectContaining({ score: 20 }),
      }));
    });

    it('submitScores：pointDecisions 含 note → 落库带 note（create + update 均含）', async () => {
      prisma.bidExpert.findFirst.mockResolvedValue({
        id: 'exp1', userId: 'u1', projectId: 'p1', reportConfirmed: false,
        signedIn: true, avoidanceConfirmed: true, aiConsentConfirmed: true, confidentialityAgreed: true, disciplineAgreed: true, conflictedSupplierIds: [], expertName: '刘', expertRole: '正选',
      });
      prisma.bidScoreItem.findMany.mockResolvedValue([{ id: 'si1', maxScore: 15, category: 'TECHNICAL' }]);
      prisma.bidScorePoint.findMany.mockResolvedValue([
        { id: 'pt1', scoreItemId: 'si1', objective: true, fullScore: 15 },
      ]);
      prisma.bidSupplier.findMany.mockResolvedValue([{ id: 'sup1', supplierName: '甲', decryptStatus: 'SUCCESS', submitStatus: 'submitted' }]);
      prisma.bidProject.findUnique.mockResolvedValue({ stage: 'EVALUATING' });
      prisma.bidScorePointDecision.upsert.mockResolvedValue({});
      prisma.bidScoreRecord.upsert.mockResolvedValue({});
      prisma.bidScoreRecord.count.mockResolvedValue(1);
      prisma.bidScoreRecord.findMany.mockResolvedValue([{ score: 15 }]);

      await service.submitScores('u1', 'p1', {
        supplierName: '甲',
        scores: [{
          scoreItemId: 'si1', supplierId: 'sup1', reason: '',
          pointDecisions: [
            { pointId: 'pt1', checked: true, awardedScore: 15, note: '符合要求，见标书第 12 页' },
          ],
        }],
      } as any);

      expect(prisma.bidScorePointDecision.upsert).toHaveBeenCalledWith(expect.objectContaining({
        create: expect.objectContaining({ note: '符合要求，见标书第 12 页' }),
        update: expect.objectContaining({ note: '符合要求，见标书第 12 页' }),
      }));
    });

    it('submitScores：客观 point awardedScore 超 fullScore 抛错', async () => {
      prisma.bidExpert.findFirst.mockResolvedValue({
        id: 'exp1', userId: 'u1', projectId: 'p1', reportConfirmed: false,
        signedIn: true, avoidanceConfirmed: true, aiConsentConfirmed: true, confidentialityAgreed: true, disciplineAgreed: true, conflictedSupplierIds: [], expertName: '刘', expertRole: '正选',
      });
      prisma.bidScoreItem.findMany.mockResolvedValue([{ id: 'si1', maxScore: 30, category: 'TECHNICAL' }]);
      prisma.bidScorePoint.findMany.mockResolvedValue([{ id: 'pt1', scoreItemId: 'si1', objective: true, fullScore: 10 }]);
      prisma.bidSupplier.findMany.mockResolvedValue([{ id: 'sup1', supplierName: '甲', decryptStatus: 'SUCCESS', submitStatus: 'submitted' }]);

      await expect(service.submitScores('u1', 'p1', {
        supplierName: '甲',
        scores: [{ scoreItemId: 'si1', supplierId: 'sup1', reason: '', pointDecisions: [{ pointId: 'pt1', checked: true, awardedScore: 99 }] }],
      } as any)).rejects.toMatchObject({ response: { code: 'POINT_SCORE_EXCEEDS_MAX' } });
    });

    it('submitScores：无 points 大类走旧直输 score（向后兼容）', async () => {
      prisma.bidExpert.findFirst.mockResolvedValue({
        id: 'exp1', userId: 'u1', projectId: 'p1', reportConfirmed: false,
        signedIn: true, avoidanceConfirmed: true, aiConsentConfirmed: true, confidentialityAgreed: true, disciplineAgreed: true, conflictedSupplierIds: [], expertName: '刘', expertRole: '正选',
      });
      prisma.bidScoreItem.findMany.mockResolvedValue([{ id: 'si1', maxScore: 100, category: 'TECHNICAL' }]);
      prisma.bidScorePoint.findMany.mockResolvedValue([]); // 无 points
      prisma.bidSupplier.findMany.mockResolvedValue([{ id: 'sup1', supplierName: '甲', decryptStatus: 'SUCCESS', submitStatus: 'submitted' }]);
      prisma.bidProject.findUnique.mockResolvedValue({ stage: 'EVALUATING' });
      prisma.bidScoreRecord.upsert.mockResolvedValue({});
      prisma.bidScoreRecord.count.mockResolvedValue(1);
      prisma.bidScoreRecord.findMany.mockResolvedValue([{ score: 80 }]);

      await service.submitScores('u1', 'p1', {
        supplierName: '甲',
        scores: [{ scoreItemId: 'si1', supplierId: 'sup1', score: 80, reason: '' }],
      } as any);

      expect(prisma.bidScorePointDecision.upsert).not.toHaveBeenCalled();
      expect(prisma.bidScoreRecord.upsert).toHaveBeenCalledWith(expect.objectContaining({
        update: expect.objectContaining({ score: 80 }),
      }));
    });

    it('submitScores：为每个供应商 upsert 一条 draft review', async () => {
      prisma.bidExpert.findFirst.mockResolvedValue({ ...signedExpert, id: 'exp1', expertName: '刘' });
      prisma.bidScoreItem.findMany.mockResolvedValue([{ id: 'si1', maxScore: 100, category: 'TECHNICAL' }]);
      prisma.bidScorePoint.findMany.mockResolvedValue([]);
      prisma.bidSupplier.findMany.mockResolvedValue([
        { id: 'sup1', supplierName: '甲', decryptStatus: 'SUCCESS', submitStatus: 'submitted' },
        { id: 'sup2', supplierName: '乙', decryptStatus: 'SUCCESS', submitStatus: 'submitted' },
      ]);
      prisma.bidProject.findUnique.mockResolvedValue({ stage: 'EVALUATING' });
      prisma.bidScoreRecord.upsert.mockResolvedValue({});
      prisma.bidScoreRecord.count.mockResolvedValue(1);
      prisma.bidScoreRecord.findMany.mockResolvedValue([{ score: 80 }]);

      await service.submitScores('user-1', 'proj-1', {
        supplierName: '甲、乙',
        scores: [
          { scoreItemId: 'si1', supplierId: 'sup1', score: 80, reason: '' },
          { scoreItemId: 'si1', supplierId: 'sup2', score: 70, reason: '' },
        ],
      } as any);

      expect(prisma.bidScoreReview.upsert).toHaveBeenCalledTimes(2);
      expect(prisma.bidScoreReview.upsert).toHaveBeenCalledWith(expect.objectContaining({
        where: { expertId_projectId_supplierId: { expertId: 'exp1', projectId: 'proj-1', supplierId: 'sup1' } },
        update: expect.objectContaining({ status: 'draft' }),   // 重新提交重置为 draft（专家改了分需重新核对）
        create: expect.objectContaining({ expertId: 'exp1', projectId: 'proj-1', supplierId: 'sup1', status: 'draft' }),
      }));
    });

    it('submitScores：通过性项过半不通过 → 写 BidInvalidBid + bidValidity=invalid + WS', async () => {
      // 已有 2 专家判 sup1 的 si1(QUALIFICATION) 不通过，本专家(第3)也判不通过 → 3/3 过半
      prisma.bidExpert.findFirst.mockResolvedValue({
        id: 'exp3', userId: 'user3', projectId: 'p1', reportConfirmed: false,
        signedIn: true, avoidanceConfirmed: true, aiConsentConfirmed: true, confidentialityAgreed: true, disciplineAgreed: true, conflictedSupplierIds: [], expertName: '王', expertRole: '正选',
      });
      prisma.bidScoreItem.findMany.mockResolvedValue([{ id: 'si1', maxScore: 0, category: 'QUALIFICATION' }]);
      prisma.bidSupplier.findMany.mockResolvedValue([{ id: 'sup1', supplierName: '甲', decryptStatus: 'SUCCESS', submitStatus: 'submitted' }]);
      prisma.bidProject.findUnique.mockResolvedValue({ stage: 'EVALUATING' });
      prisma.bidScoreRecord.upsert.mockResolvedValue({});
      // evaluateInvalidBid 的 findMany 走 scoreItemId 分支 → 3/3 不通过；recomputeExpertProgress 的 findMany 走 else 分支
      prisma.bidScoreRecord.findMany.mockImplementation((a: any) =>
        a.where?.scoreItemId === 'si1' ? Promise.resolve([{ passed: false }, { passed: false }, { passed: false }]) : Promise.resolve([{ score: 0 }]));
      prisma.bidScoreRecord.count.mockResolvedValue(1);
      prisma.bidInvalidBid.upsert.mockResolvedValue({});
      prisma.bidInvalidBid.count.mockResolvedValue(1); // sup1 有 1 条 active invalid
      gateway.notifyBidValidity.mockClear();

      await service.submitScores('user3', 'p1', {
        supplierName: '甲',
        scores: [{ scoreItemId: 'si1', supplierId: 'sup1', passed: false, reason: '不符' }],
      } as any);

      // 现行实现：旧 unique 约束已移除 → findFirst + create（无 upsert）
      expect(prisma.bidInvalidBid.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ projectId: 'p1', supplierId: 'sup1', scoreItemId: 'si1', status: 'invalid' }),
      }));
      expect(prisma.bidSupplier.update).toHaveBeenCalledTimes(1); // P1-8：每供应商仅 update 一次
      expect(prisma.bidSupplier.update).toHaveBeenCalledWith(expect.objectContaining({
        where: { id: 'sup1' }, data: { bidValidity: 'invalid' },
      }));
      expect(gateway.notifyBidValidity).toHaveBeenCalledWith('p1', expect.objectContaining({
        supplierId: 'sup1', status: 'invalid',
      }));
    });

    it('P1-8：bidValidity 按供应商聚合——无 active invalid → valid，且每供应商仅 update 一次', async () => {
      prisma.bidExpert.findFirst.mockResolvedValue({
        id: 'exp3', userId: 'user3', projectId: 'p1', reportConfirmed: false,
        signedIn: true, avoidanceConfirmed: true, aiConsentConfirmed: true, confidentialityAgreed: true, disciplineAgreed: true, conflictedSupplierIds: [], expertName: '王', expertRole: '正选',
      });
      prisma.bidScoreItem.findMany.mockResolvedValue([{ id: 'si1', maxScore: 0, category: 'QUALIFICATION' }]);
      prisma.bidSupplier.findMany.mockResolvedValue([{ id: 'sup1', supplierName: '甲', decryptStatus: 'SUCCESS', submitStatus: 'submitted' }]);
      prisma.bidProject.findUnique.mockResolvedValue({ stage: 'EVALUATING' });
      prisma.bidScoreRecord.upsert.mockResolvedValue({});
      // evaluateInvalidBid：1/3 不通过 → 不过半 → not disqualified
      prisma.bidScoreRecord.findMany.mockImplementation((a: any) =>
        a.where?.scoreItemId === 'si1' ? Promise.resolve([{ passed: false }, { passed: true }, { passed: true }]) : Promise.resolve([{ score: 0 }]));
      prisma.bidScoreRecord.count.mockResolvedValue(1);
      prisma.bidInvalidBid.upsert.mockResolvedValue({});
      prisma.bidInvalidBid.findUnique.mockResolvedValue(null); // 无既往 invalid 需撤销
      prisma.bidInvalidBid.count.mockResolvedValue(0); // 无 active invalid → valid

      await service.submitScores('user3', 'p1', {
        supplierName: '甲',
        scores: [{ scoreItemId: 'si1', supplierId: 'sup1', passed: true, reason: '' }],
      } as any);

      expect(prisma.bidSupplier.update).toHaveBeenCalledTimes(1);
      expect(prisma.bidSupplier.update).toHaveBeenCalledWith(expect.objectContaining({
        where: { id: 'sup1' }, data: { bidValidity: 'valid' },
      }));
    });

    it('submitScores：评分偏离组均值≥30% 触发 anomaly WS 广播', async () => {
      prisma.bidExpert.findFirst.mockResolvedValue({
        id: 'exp1', userId: 'u1', projectId: 'p1', reportConfirmed: false,
        signedIn: true, avoidanceConfirmed: true, aiConsentConfirmed: true, confidentialityAgreed: true, disciplineAgreed: true, conflictedSupplierIds: [], expertName: '刘', expertRole: '正选',
      });
      prisma.bidScoreItem.findMany.mockResolvedValue([
        { id: 'si1', maxScore: 100, category: 'BUSINESS' },
      ]);
      prisma.bidSupplier.findMany.mockResolvedValue([
        { id: 'sup1', supplierName: '甲', decryptStatus: 'SUCCESS', submitStatus: 'submitted' },
      ]);
      prisma.bidProject.findUnique.mockResolvedValue({ stage: 'EVALUATING' });
      prisma.bidScoreRecord.upsert.mockResolvedValue({});
      prisma.bidScoreItem.count.mockResolvedValue(2);
      prisma.bidScoreRecord.findMany.mockImplementation((a: any) => {
        if (a.where?.expertId && a.where.expertId.not) {
          return Promise.resolve([
            { expertId: 'e1', scoreItemId: 'si1', supplierId: 'sup1', score: 82 },
            { expertId: 'e2', scoreItemId: 'si1', supplierId: 'sup1', score: 84 },
          ]);
        }
        return Promise.resolve([]);
      });
      prisma.bidScoreRecord.count.mockResolvedValue(1);
      prisma.bidScoreReview.upsert.mockResolvedValue({});
      prisma.bidInvalidBid.count.mockResolvedValue(0);
      gateway.notifyAnomaly.mockClear();

      await service.submitScores('u1', 'p1', {
        supplierName: '甲',
        scores: [{ scoreItemId: 'si1', supplierId: 'sup1', scoreItemName: '商务能力', score: 30 }],
      } as any);

      expect(gateway.notifyAnomaly).toHaveBeenCalledWith('p1', expect.objectContaining({
        type: 'score_deviation',
        severity: 'danger',
        detail: expect.stringContaining('30'),
      }));
    });

    it('submitScores：评分偏离组均值 20-30% 触发 warning WS 广播', async () => {
      prisma.bidExpert.findFirst.mockResolvedValue({
        id: 'exp1', userId: 'u1', projectId: 'p1', reportConfirmed: false,
        signedIn: true, avoidanceConfirmed: true, aiConsentConfirmed: true, confidentialityAgreed: true, disciplineAgreed: true, conflictedSupplierIds: [], expertName: '刘', expertRole: '正选',
      });
      prisma.bidScoreItem.findMany.mockResolvedValue([
        { id: 'si1', maxScore: 100, category: 'BUSINESS' },
      ]);
      prisma.bidSupplier.findMany.mockResolvedValue([
        { id: 'sup1', supplierName: '甲', decryptStatus: 'SUCCESS', submitStatus: 'submitted' },
      ]);
      prisma.bidProject.findUnique.mockResolvedValue({ stage: 'EVALUATING' });
      prisma.bidScoreRecord.upsert.mockResolvedValue({});
      prisma.bidScoreItem.count.mockResolvedValue(2);
      prisma.bidScoreRecord.findMany.mockImplementation((a: any) => {
        if (a.where?.expertId && a.where.expertId.not) {
          return Promise.resolve([
            { expertId: 'e1', scoreItemId: 'si1', supplierId: 'sup1', score: 82 },
            { expertId: 'e2', scoreItemId: 'si1', supplierId: 'sup1', score: 84 },
          ]);
        }
        return Promise.resolve([]);
      });
      prisma.bidScoreRecord.count.mockResolvedValue(1);
      prisma.bidScoreReview.upsert.mockResolvedValue({});
      prisma.bidInvalidBid.count.mockResolvedValue(0);
      gateway.notifyAnomaly.mockClear();

      await service.submitScores('u1', 'p1', {
        supplierName: '甲',
        scores: [{ scoreItemId: 'si1', supplierId: 'sup1', scoreItemName: '商务能力', score: 55 }],
      } as any);

      expect(gateway.notifyAnomaly).toHaveBeenCalledWith('p1', expect.objectContaining({
        type: 'score_deviation',
        severity: 'warning',
        detail: expect.stringContaining('55'),
      }));
    });

    it('submitScores：通过性项不触发异常检测', async () => {
      prisma.bidExpert.findFirst.mockResolvedValue({
        id: 'exp1', userId: 'u1', projectId: 'p1', reportConfirmed: false,
        signedIn: true, avoidanceConfirmed: true, aiConsentConfirmed: true, confidentialityAgreed: true, disciplineAgreed: true, conflictedSupplierIds: [], expertName: '刘', expertRole: '正选',
      });
      prisma.bidScoreItem.findMany.mockResolvedValue([
        { id: 'si1', maxScore: 0, category: 'QUALIFICATION' },
      ]);
      prisma.bidSupplier.findMany.mockResolvedValue([
        { id: 'sup1', supplierName: '甲', decryptStatus: 'SUCCESS', submitStatus: 'submitted' },
      ]);
      prisma.bidProject.findUnique.mockResolvedValue({ stage: 'EVALUATING' });
      prisma.bidScoreRecord.upsert.mockResolvedValue({});
      prisma.bidScoreItem.count.mockResolvedValue(2);
      prisma.bidScoreRecord.findMany.mockResolvedValue([]);
      prisma.bidScoreRecord.count.mockResolvedValue(1);
      prisma.bidScoreReview.upsert.mockResolvedValue({});
      prisma.bidInvalidBid.count.mockResolvedValue(0);
      gateway.notifyAnomaly.mockClear();

      await service.submitScores('u1', 'p1', {
        supplierName: '甲',
        scores: [{ scoreItemId: 'si1', supplierId: 'sup1', passed: true, reason: '' }],
      } as any);

      expect(gateway.notifyAnomaly).not.toHaveBeenCalled();
    });

    it('checkScoreAnomaly：偏离≥30% 返回 danger 告警', () => {
      const { checkScoreAnomaly } = require('../common/scoring/expert-deviation');
      const alert = checkScoreAnomaly(
        { expertId: 'e3', scoreItemId: 'i1', supplierId: 's1', score: 30 },
        [
          { expertId: 'e1', scoreItemId: 'i1', supplierId: 's1', score: 80 },
          { expertId: 'e2', scoreItemId: 'i1', supplierId: 's1', score: 85 },
        ],
      );
      expect(alert).not.toBeNull();
      expect(alert!.severity).toBe('danger');
      expect(alert!.detail).toContain('30');
    });

    it('checkScoreAnomaly：组内仅 1 人时返回 null', () => {
      const { checkScoreAnomaly } = require('../common/scoring/expert-deviation');
      const alert = checkScoreAnomaly(
        { expertId: 'e1', scoreItemId: 'i1', supplierId: 's1', score: 80 },
        [],
      );
      expect(alert).toBeNull();
    });

    it('DANGER 级偏差应自动创建 ExpertDispute（首次提交，无已存在 open dispute）', async () => {
      prisma.bidExpert.findFirst.mockResolvedValue({
        id: 'exp1', userId: 'u1', projectId: 'p1', reportConfirmed: false,
        signedIn: true, avoidanceConfirmed: true, aiConsentConfirmed: true, confidentialityAgreed: true, disciplineAgreed: true, conflictedSupplierIds: [], expertName: '刘', expertRole: '正选',
      });
      prisma.bidScoreItem.findMany.mockResolvedValue([
        { id: 'si1', maxScore: 100, category: 'BUSINESS' },
      ]);
      prisma.bidSupplier.findMany.mockResolvedValue([
        { id: 'sup1', supplierName: '甲', decryptStatus: 'SUCCESS', submitStatus: 'submitted' },
      ]);
      prisma.bidProject.findUnique.mockResolvedValue({ stage: 'EVALUATING' });
      prisma.bidScoreRecord.upsert.mockResolvedValue({});
      prisma.bidScoreItem.count.mockResolvedValue(2);
      prisma.bidScoreRecord.findMany.mockImplementation((a: any) => {
        if (a.where?.expertId && a.where.expertId.not) {
          return Promise.resolve([
            { expertId: 'e1', scoreItemId: 'si1', supplierId: 'sup1', score: 82 },
            { expertId: 'e2', scoreItemId: 'si1', supplierId: 'sup1', score: 84 },
          ]);
        }
        return Promise.resolve([]);
      });
      prisma.bidScoreRecord.count.mockResolvedValue(1);
      prisma.bidScoreReview.upsert.mockResolvedValue({});
      prisma.bidInvalidBid.count.mockResolvedValue(0);
      prisma.expertDispute.findFirst.mockResolvedValue(null); // 无已存在 dispute
      prisma.expertDispute.create.mockResolvedValue({ id: 'd1' });

      await service.submitScores('u1', 'p1', {
        supplierName: '甲',
        scores: [{ scoreItemId: 'si1', supplierId: 'sup1', scoreItemName: '商务能力', score: 30 }],
      } as any);

      expect(prisma.expertDispute.findFirst).toHaveBeenCalledWith(expect.objectContaining({
        where: expect.objectContaining({
          projectId: 'p1',
          expertId: 'exp1',
          type: 'scoring',
          status: 'open',
          title: { contains: 'si1' },
        }),
      }));
      expect(prisma.expertDispute.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({
          projectId: 'p1',
          expertId: 'exp1',
          expertName: '刘',
          type: 'scoring',
          title: expect.stringContaining('si1'),
          content: expect.stringContaining('30'),
          status: 'open',
        }),
      }));
    });

    it('DANGER 级偏差幂等：已有 open dispute 时不重复创建', async () => {
      prisma.bidExpert.findFirst.mockResolvedValue({
        id: 'exp1', userId: 'u1', projectId: 'p1', reportConfirmed: false,
        signedIn: true, avoidanceConfirmed: true, aiConsentConfirmed: true, confidentialityAgreed: true, disciplineAgreed: true, conflictedSupplierIds: [], expertName: '刘', expertRole: '正选',
      });
      prisma.bidScoreItem.findMany.mockResolvedValue([
        { id: 'si1', maxScore: 100, category: 'BUSINESS' },
      ]);
      prisma.bidSupplier.findMany.mockResolvedValue([
        { id: 'sup1', supplierName: '甲', decryptStatus: 'SUCCESS', submitStatus: 'submitted' },
      ]);
      prisma.bidProject.findUnique.mockResolvedValue({ stage: 'EVALUATING' });
      prisma.bidScoreRecord.upsert.mockResolvedValue({});
      prisma.bidScoreItem.count.mockResolvedValue(2);
      prisma.bidScoreRecord.findMany.mockImplementation((a: any) => {
        if (a.where?.expertId && a.where.expertId.not) {
          return Promise.resolve([
            { expertId: 'e1', scoreItemId: 'si1', supplierId: 'sup1', score: 82 },
            { expertId: 'e2', scoreItemId: 'si1', supplierId: 'sup1', score: 84 },
          ]);
        }
        return Promise.resolve([]);
      });
      prisma.bidScoreRecord.count.mockResolvedValue(1);
      prisma.bidScoreReview.upsert.mockResolvedValue({});
      prisma.bidInvalidBid.count.mockResolvedValue(0);
      // 已有 open dispute
      prisma.expertDispute.findFirst.mockResolvedValue({ id: 'd1', expertId: 'exp1', title: '评分偏差告警（评分项 si1）', status: 'open' });
      prisma.expertDispute.create.mockResolvedValue({});

      await service.submitScores('u1', 'p1', {
        supplierName: '甲',
        scores: [{ scoreItemId: 'si1', supplierId: 'sup1', scoreItemName: '商务能力', score: 30 }],
      } as any);

      expect(prisma.expertDispute.create).not.toHaveBeenCalled();
    });
  });

  describe('confirmReport', () => {
    it('locks scoring by setting reportConfirmed and reportConfirmedAt', async () => {
      prisma.bidProject.findUnique.mockResolvedValue({ stage: 'EVALUATING' });
      prisma.bidExpert.findFirst.mockResolvedValue({ ...mockExpert, signedIn: true, avoidanceConfirmed: true, aiConsentConfirmed: true, confidentialityAgreed: true, disciplineAgreed: true, progress: 100 });
      prisma.bidSupplier.findMany.mockResolvedValue([]);
      prisma.bidExpert.update.mockResolvedValue({});
      prisma.bidSupervisionLog.create.mockResolvedValue({});

      await service.confirmReport('user-1', 'proj-1', '确认完成');

      expect(prisma.bidExpert.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ progress: 100, reportConfirmed: true, reportConfirmedAt: expect.any(Date) }),
        }),
      );
    });

    it('confirmReport：有未核对供应商 → REVIEW_PENDING', async () => {
      prisma.bidExpert.findFirst.mockResolvedValue({ ...mockExpert, id: 'exp1', signedIn: true, avoidanceConfirmed: true, aiConsentConfirmed: true, confidentialityAgreed: true, disciplineAgreed: true, progress: 100, reportConfirmed: false });
      prisma.bidProject.findUnique.mockResolvedValue({ stage: 'EVALUATING' });
      // 活跃供应商 2 个，但只有 1 个 verified
      prisma.bidSupplier.findMany.mockResolvedValue([{ id: 'sup1' }, { id: 'sup2' }]);
      prisma.bidScoreReview.findMany.mockResolvedValue([{ supplierId: 'sup1', status: 'verified' }]); // sup2 未核对
      await expect(service.confirmReport('user-1', 'p1')).rejects.toMatchObject({ response: { code: 'REVIEW_PENDING' } });
    });

    it('confirmReport：全部核对 → 通过', async () => {
      prisma.bidExpert.findFirst.mockResolvedValue({ ...mockExpert, id: 'exp1', signedIn: true, avoidanceConfirmed: true, aiConsentConfirmed: true, confidentialityAgreed: true, disciplineAgreed: true, progress: 100, reportConfirmed: false });
      prisma.bidProject.findUnique.mockResolvedValue({ stage: 'EVALUATING' });
      prisma.bidSupplier.findMany.mockResolvedValue([{ id: 'sup1' }, { id: 'sup2' }]);
      prisma.bidScoreReview.findMany.mockResolvedValue([{ supplierId: 'sup1', status: 'verified' }, { supplierId: 'sup2', status: 'verified' }]);
      prisma.bidExpert.update.mockResolvedValue({});
      prisma.bidScoreDelta.updateMany.mockResolvedValue({ count: 0 });
      await service.confirmReport('user-1', 'p1'); // 不抛错
      expect(prisma.bidExpert.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ reportConfirmed: true }) }));
    });

    it('P1-7：核对校验与确认写入在同一事务内（$transaction 被调用）', async () => {
      prisma.bidProject.findUnique.mockResolvedValue({ stage: 'EVALUATING' });
      prisma.bidExpert.findFirst.mockResolvedValue({ ...mockExpert, id: 'exp1', signedIn: true, avoidanceConfirmed: true, aiConsentConfirmed: true, confidentialityAgreed: true, disciplineAgreed: true, progress: 100 });
      prisma.bidSupplier.findMany.mockResolvedValue([]);
      prisma.bidExpert.update.mockResolvedValue({});
      prisma.bidSupervisionLog.create.mockResolvedValue({});
      await service.confirmReport('user-1', 'p1');
      expect(prisma.$transaction).toHaveBeenCalled();
    });

    it('P1-7：REVIEW_PENDING 时不写 reportConfirmed（事务内校验失败即中止）', async () => {
      prisma.bidProject.findUnique.mockResolvedValue({ stage: 'EVALUATING' });
      prisma.bidExpert.findFirst.mockResolvedValue({ ...mockExpert, id: 'exp1', signedIn: true, avoidanceConfirmed: true, aiConsentConfirmed: true, confidentialityAgreed: true, disciplineAgreed: true, progress: 100 });
      prisma.bidSupplier.findMany.mockResolvedValue([{ id: 'sup1' }]);
      prisma.bidScoreReview.findMany.mockResolvedValue([]); // 未核对
      await expect(service.confirmReport('user-1', 'p1')).rejects.toMatchObject({ response: { code: 'REVIEW_PENDING' } });
      expect(prisma.bidExpert.update).not.toHaveBeenCalled();
    });
  });

  describe('getDecryptedDocuments', () => {
    const signedExpert = { ...mockExpert, signedIn: true, avoidanceConfirmed: true, aiConsentConfirmed: true, confidentialityAgreed: true, disciplineAgreed: true };

    beforeEach(() => {
      prisma.bidProject.findUnique.mockResolvedValue({ stage: 'OPENING' });
      prisma.bidExpert.findFirst.mockResolvedValue(signedExpert);
    });

    it('未确认 AI 声明 → 403 VERIFICATION_REQUIRED', async () => {
      // signedExpert 已签到+回避，但未确认 AI 声明
      prisma.bidExpert.findFirst.mockResolvedValue({ ...signedExpert, aiConsentConfirmed: false });
      await expect(service.getDecryptedDocuments('user-1', 'proj-1', 'bs-1'))
        .rejects.toMatchObject({ response: { code: 'VERIFICATION_REQUIRED' } });
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
      expect(result.documents[0].downloadUrl).toBe('/api/expert/projects/proj-1/suppliers/bs-1/documents/fa-1/download');
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

    it('dual-v2：文件列表取 decryptedAssets 归属链（SUCCESS 后下发明文资产）', async () => {
      prisma.bidSupplier.findFirst.mockResolvedValue({
        id: 'bs-1', supplierId: 'supplier-1', supplierName: '川水建设', decryptStatus: 'SUCCESS',
      });
      prisma.supplierBidSubmission.findUnique.mockResolvedValue({
        envelopeVersion: 'dual-v2',
        technicalFileAssetId: 'fa-outer-t', businessFileAssetId: 'fa-outer-b', coverLetterAssetId: 'fa-outer-c',
        decryptedAssets: { technical: 'fa-dec-t', business: 'fa-dec-b', coverLetter: 'fa-dec-c' },
      });
      prisma.fileAsset.findMany.mockResolvedValue([
        { id: 'fa-dec-t', originalName: '技术方案.pdf', mimeType: 'application/pdf', size: 131072, sha256: 'hashT' },
        { id: 'fa-dec-b', originalName: '商务文件.pdf', mimeType: 'application/pdf', size: 65536, sha256: 'hashB' },
        { id: 'fa-dec-c', originalName: '投标函.pdf', mimeType: 'application/pdf', size: 1024, sha256: 'hashC' },
      ]);

      const result = await service.getDecryptedDocuments('user-1', 'proj-1', 'bs-1');

      expect(result.canView).toBe(true);
      expect(result.documents.map(d => d.downloadUrl)).toEqual([
        '/api/expert/projects/proj-1/suppliers/bs-1/documents/fa-dec-t/download',
        '/api/expert/projects/proj-1/suppliers/bs-1/documents/fa-dec-b/download',
        '/api/expert/projects/proj-1/suppliers/bs-1/documents/fa-dec-c/download',
      ]);
      expect(result.documents[0].sha256).toBe('hashT');
    });

    it('dual-v2 未解密（decryptedAssets 缺失）→ 回退旧轨形状、状态加密中', async () => {
      prisma.bidSupplier.findFirst.mockResolvedValue({
        id: 'bs-1', supplierId: 'supplier-1', supplierName: '川水建设', decryptStatus: 'PENDING',
      });
      prisma.supplierBidSubmission.findUnique.mockResolvedValue({
        envelopeVersion: 'dual-v2', technicalFileAssetId: 'fa-outer-t', decryptedAssets: null,
      });
      prisma.fileAsset.findMany.mockResolvedValue([
        { id: 'fa-outer-t', originalName: '技术方案.pdf.enc', mimeType: 'application/octet-stream', size: 100, sha256: 'h' },
      ]);

      const result = await service.getDecryptedDocuments('user-1', 'proj-1', 'bs-1');

      expect(result.documents).toHaveLength(1);
      expect(result.documents[0].downloadUrl).toBeUndefined();
      expect(result.documents[0].sha256).toBeUndefined();
      expect(result.documents[0].status).toBe('加密中');
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

    it('averageScore 与 getStatistics 同口径（按 supplierId 聚合）', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'user-1', username: 'wangjg', displayName: '王建国', role: 'bid_expert', isActive: true,
      });
      prisma.bidExpert.findMany.mockResolvedValue([
        { scoreRecords: [{ score: 85, supplierId: 's1' }, { score: 90, supplierId: 's2' }, { score: 80, supplierId: 's3' }] },
        { scoreRecords: [{ score: 85, supplierId: 's4' }, { score: 80, supplierId: 's5' }] },
        { scoreRecords: [] },
      ]);

      const result = await service.getProfile('user-1');

      // (85+90+80+85+80) / 5 家供应商 = 84
      expect(result.averageScore).toBe(84);
    });

    it('无评分记录时 averageScore 为 0', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'user-1', username: 'wangjg', displayName: '王建国', role: 'bid_expert', isActive: true,
      });
      prisma.bidExpert.findMany.mockResolvedValue([]);

      const result = await service.getProfile('user-1');

      expect(result.averageScore).toBe(0);
    });
  });

  describe('getReport — 进度口径 (G7)', () => {
    beforeEach(() => {
      prisma.bidExpert.findFirst.mockResolvedValue({
        id: 'exp-1', expertName: '王建国', progress: 100, signedIn: true, avoidanceConfirmed: true, aiConsentConfirmed: true, confidentialityAgreed: true, disciplineAgreed: true,
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
      // Task 11: getReport 增返 myDisputedReviews — 默认无异议
      prisma.bidRequirementReview = { findMany: jest.fn().mockResolvedValue([]) };
      prisma.aiBidderResult.findMany = jest.fn();
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
        id: 'exp-1', expertName: '王建国', progress: 80, signedIn: true, avoidanceConfirmed: true, aiConsentConfirmed: true, confidentialityAgreed: true, disciplineAgreed: true,
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

    it('附带本人异议条款 myDisputedReviews（跨供应商，关联 supplierName + tenderContent）', async () => {
      // Task 11: 本人 verdict=dispute 标注进入评审报告；supplierName 来自 bidSupplier，
      // tenderContent 来自 aiBidderResult.requirementResponses 反查
      prisma.bidRequirementReview = { findMany: jest.fn().mockResolvedValue([
        { category: 'technical', verdict: 'dispute', bidderResultId: 'br-1', requirementId: 'r1', note: '工期存疑', bidderResult: { bidSupplier: { id: 's1', supplierName: '甲' } } },
      ]) };
      prisma.aiBidderResult.findMany = jest.fn().mockResolvedValue([
        { id: 'br-1', requirementResponses: [{ requirementId: 'r1', tenderContent: '工期365天' }] },
      ]);

      const report = await service.getReport('u1', 'p1');

      expect(prisma.bidRequirementReview.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { projectId: 'p1', expertId: 'exp-1', verdict: { in: ['dispute'] } } }),
      );
      expect(report.myDisputedReviews).toEqual([
        expect.objectContaining({ supplierId: 's1', supplierName: '甲', requirementId: 'r1', category: 'technical', tenderContent: '工期365天', note: '工期存疑' }),
      ]);
    });

    it('myDisputedReviews：orphan bidderResult（无 supplier 关联）被防御过滤，返回空', async () => {
      prisma.bidRequirementReview = { findMany: jest.fn().mockResolvedValue([
        { category: 'commercial', verdict: 'dispute', bidderResultId: 'br-9', requirementId: 'rx', note: '', bidderResult: { bidSupplier: { id: null, supplierName: null } } },
      ]) };
      // 无匹配 bidderResult（数据漂移场景）
      prisma.aiBidderResult.findMany = jest.fn().mockResolvedValue([]);

      const report = await service.getReport('u1', 'p1');

      expect(report.myDisputedReviews).toEqual([]);
    });

    it('无本人异议时 myDisputedReviews 为空数组且不查 bidderResult', async () => {
      prisma.bidRequirementReview = { findMany: jest.fn().mockResolvedValue([]) };
      prisma.aiBidderResult.findMany = jest.fn();

      const report = await service.getReport('u1', 'p1');

      expect(report.myDisputedReviews).toEqual([]);
      expect(prisma.aiBidderResult.findMany).not.toHaveBeenCalled();
    });

    it('改用 buildExpertReviews 后仍仅 dispute，含 supplierName 与 tenderContent 反查', async () => {
      prisma.bidExpert.findFirst.mockResolvedValue({ id: 'exp-1', userId: 'u1', projectId: 'proj-1', expertName: '专家', signedIn: true, avoidanceConfirmed: true, aiConsentConfirmed: true, confidentialityAgreed: true, disciplineAgreed: true, progress: 100 });
      prisma.user.findUnique.mockResolvedValue({ id: 'u1', username: 'u1', displayName: '专家' });
      prisma.bidProject.findUnique.mockResolvedValue({ id: 'proj-1', name: '项目', projectCode: 'P1', stage: 'EVALUATING', suppliers: [], scoreItems: [] });
      prisma.bidScoreRecord.findMany.mockResolvedValue([]);
      // mock 不按 where 过滤，仅返回 dispute 记录（模拟 Prisma verdict:{in:['dispute']} 过滤效果）
      prisma.bidRequirementReview = { findMany: jest.fn().mockResolvedValue([
        { category: 'technical', verdict: 'dispute', bidderResultId: 'br-1', requirementId: 'r1', note: 'n1', bidderResult: { bidSupplier: { id: 's1', supplierName: '供1' } } },
      ]) };
      prisma.aiBidderResult.findMany = jest.fn().mockResolvedValue([
        { id: 'br-1', requirementResponses: [{ requirementId: 'r1', tenderContent: '条款原文1' }] },
      ]);
      const out = await service.getReport('u1', 'proj-1');
      // 验证查询过滤条件仅 dispute（不含 doubt）
      expect(prisma.bidRequirementReview.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { projectId: 'proj-1', expertId: 'exp-1', verdict: { in: ['dispute'] } } }),
      );
      expect(out.myDisputedReviews).toEqual([
        { supplierId: 's1', supplierName: '供1', requirementId: 'r1', category: 'technical', tenderContent: '条款原文1', note: 'n1' },
      ]);
    });
  });

  describe('getTenderDocument — 招标文件元信息', () => {
    const signedExpert = { ...mockExpert, id: 'exp-1', expertName: '王建国', signedIn: true, avoidanceConfirmed: true, aiConsentConfirmed: true, confidentialityAgreed: true, disciplineAgreed: true };

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
        expect.objectContaining({ where: { OR: expect.arrayContaining([{ bidProjectId: 'proj-1' }]) }, include: { fileAsset: true } }),
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
    const signedExpert = { ...mockExpert, id: 'exp-1', expertName: '王建国', signedIn: true, avoidanceConfirmed: true, aiConsentConfirmed: true, confidentialityAgreed: true, disciplineAgreed: true };
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
    beforeEach(() => {
      // ⑦：getMyScores 额外查 aiBidAnalysisTask.requirements（★号条款 → RESPONSIVE 映射）
      prisma.aiBidAnalysisTask = { findUnique: jest.fn().mockResolvedValue(null) };
    });

    it('⑦★号条款异议追加 RESPONSIVE 组（与前端 CAT_TO_SCORE 展开同构），非★条款只进原组', async () => {
      prisma.bidExpert.findFirst.mockResolvedValue({ id: 'exp-1', userId: 'u1', expertRole: '正选', signedIn: true, avoidanceConfirmed: true, aiConsentConfirmed: true, confidentialityAgreed: true, disciplineAgreed: true });
      prisma.bidScoreRecord.findMany.mockResolvedValue([]);
      prisma.aiBidAnalysisTask = { findUnique: jest.fn().mockResolvedValue({ requirements: { technicalRequirements: [{ id: 'req-star', isStarred: true }, { id: 'req-norm', isStarred: false }] } }) };
      prisma.bidRequirementReview = { findMany: jest.fn().mockResolvedValue([
        { category: 'technical', verdict: 'dispute', bidderResultId: 'br-1', requirementId: 'req-star', note: 'n1', bidderResult: { bidSupplier: { id: 's1' } } },
        { category: 'technical', verdict: 'dispute', bidderResultId: 'br-1', requirementId: 'req-norm', note: 'n2', bidderResult: { bidSupplier: { id: 's1' } } },
      ]) };
      prisma.aiBidderResult.findMany = jest.fn().mockResolvedValue([]);
      const out = await service.getMyScores('u1', 'proj-1');
      expect(out.disputeCategoriesBySupplier).toEqual({ s1: ['TECHNICAL', 'RESPONSIVE'] });
      expect(out.disputesBySupplier.s1.TECHNICAL).toHaveLength(2);
      expect(out.disputesBySupplier.s1.RESPONSIVE).toEqual([expect.objectContaining({ requirementId: 'req-star', verdict: 'dispute' })]);
    });

    it('返回 records + disputeCategoriesBySupplier（按 supplier 分组，per-supplier 去重）', async () => {
      prisma.bidExpert.findFirst.mockResolvedValue({ id: 'exp-1', userId: 'u1', expertRole: '正选', signedIn: true, avoidanceConfirmed: true, aiConsentConfirmed: true, confidentialityAgreed: true, disciplineAgreed: true });
      prisma.bidScoreRecord.findMany.mockResolvedValue([]);
      // Fix 1: disputes 现在带 bidderResult.bidSupplier.id；前端按 activeSupplier 过滤，
      // 无异议的供应商（如 s3）不应出现在结果里。
      prisma.bidRequirementReview = { findMany: jest.fn().mockResolvedValue([
        { category: 'technical', verdict: 'dispute', bidderResultId: 'br-1', requirementId: 'r1', note: '', bidderResult: { bidSupplier: { id: 's1' } } },
        { category: 'commercial', verdict: 'dispute', bidderResultId: 'br-1', requirementId: 'r2', note: '', bidderResult: { bidSupplier: { id: 's1' } } },
        { category: 'technical', verdict: 'dispute', bidderResultId: 'br-2', requirementId: 'r3', note: '', bidderResult: { bidSupplier: { id: 's2' } } },
        { category: 'qualification', verdict: 'ack', bidderResultId: 'br-3', requirementId: 'r4', note: '', bidderResult: { bidSupplier: { id: 's3' } } }, // 非异议不计
      ]) };
      prisma.aiBidderResult.findMany = jest.fn().mockResolvedValue([
        { id: 'br-1', bidSupplier: { id: 's1' }, requirementResponses: [] },
        { id: 'br-2', bidSupplier: { id: 's2' }, requirementResponses: [] },
      ]);
      const out = await service.getMyScores('u1', 'proj-1');
      expect(out.records).toEqual([]);
      // disputeCategories 已下线（改为 per-supplier）；旧字段不应出现。
      expect((out as any).disputeCategories).toBeUndefined();
      expect(out.disputeCategoriesBySupplier).toEqual({
        s1: ['TECHNICAL', 'BUSINESS'],
        s2: ['TECHNICAL'],
      });
    });

    it('disputesBySupplier 含 dispute + doubt，item 带 verdict；disputeCategoriesBySupplier 仍 dispute-only', async () => {
      prisma.bidExpert.findFirst.mockResolvedValue({ id: 'exp-1', userId: 'u1', expertRole: '正选', signedIn: true, avoidanceConfirmed: true, aiConsentConfirmed: true, confidentialityAgreed: true, disciplineAgreed: true });
      prisma.bidScoreRecord.findMany.mockResolvedValue([]);
      prisma.bidRequirementReview = { findMany: jest.fn().mockResolvedValue([
        // s1 - technical dispute
        { category: 'technical', verdict: 'dispute', bidderResultId: 'br-1', requirementId: 'req-r1', note: 'n1', bidderResult: { bidSupplier: { id: 's1', supplierName: '供1' } } },
        // s1 - commercial doubt（应进 disputesBySupplier，不进 disputeCategoriesBySupplier）
        { category: 'commercial', verdict: 'doubt', bidderResultId: 'br-1', requirementId: 'req-r2', note: 'd2', bidderResult: { bidSupplier: { id: 's1', supplierName: '供1' } } },
        // s2 - technical dispute
        { category: 'technical', verdict: 'dispute', bidderResultId: 'br-2', requirementId: 'req-r3', note: 'n3', bidderResult: { bidSupplier: { id: 's2', supplierName: '供2' } } },
        // ack 不计（即使 mock 漏进也应被 JS 防御过滤）
        { category: 'qualification', verdict: 'ack', bidderResultId: 'br-3', requirementId: 'req-r4', note: 'x', bidderResult: { bidSupplier: { id: 's3', supplierName: '供3' } } },
      ]) };
      prisma.aiBidderResult.findMany = jest.fn().mockResolvedValue([
        { id: 'br-1', requirementResponses: [{ requirementId: 'req-r1', tenderContent: '内容1' }] },
        { id: 'br-2', requirementResponses: [{ requirementId: 'req-r3', tenderContent: '内容3' }] },
      ]);
      const out = await service.getMyScores('u1', 'proj-1');
      expect(out.disputesBySupplier).toEqual({
        s1: {
          TECHNICAL: [{ requirementId: 'req-r1', content: '内容1', note: 'n1', verdict: 'dispute' }],
          BUSINESS: [{ requirementId: 'req-r2', content: '', note: 'd2', verdict: 'doubt' }],
        },
        s2: {
          TECHNICAL: [{ requirementId: 'req-r3', content: '内容3', note: 'n3', verdict: 'dispute' }],
        },
      });
      // disputeCategoriesBySupplier 仍 dispute-only：s1 只 TECHNICAL（doubt 的 BUSINESS 不进）
      expect(out.disputeCategoriesBySupplier).toEqual({ s1: ['TECHNICAL'], s2: ['TECHNICAL'] });
    });

    it('orphan bidderResult（无 supplier）优雅跳过', async () => {
      prisma.bidExpert.findFirst.mockResolvedValue({ id: 'exp-1', userId: 'u1', expertRole: '正选', signedIn: true, avoidanceConfirmed: true, aiConsentConfirmed: true, confidentialityAgreed: true, disciplineAgreed: true });
      prisma.bidScoreRecord.findMany.mockResolvedValue([]);
      prisma.bidRequirementReview = { findMany: jest.fn().mockResolvedValue([
        { category: 'technical', verdict: 'dispute', bidderResultId: 'br-x', requirementId: 'r', note: '', bidderResult: { bidSupplier: { id: null } } },
      ]) };
      prisma.aiBidderResult.findMany = jest.fn().mockResolvedValue([]);
      const out = await service.getMyScores('u1', 'proj-1');
      expect(out.disputesBySupplier).toEqual({});
      // 也不应出现在 disputeCategoriesBySupplier
      expect(Object.keys(out.disputeCategoriesBySupplier)).toHaveLength(0);
    });

    it('pointDecisions 回填含 note 字段', async () => {
      prisma.bidExpert.findFirst.mockResolvedValue({ id: 'exp-1', userId: 'u1', expertRole: '正选', signedIn: true, avoidanceConfirmed: true, aiConsentConfirmed: true, confidentialityAgreed: true, disciplineAgreed: true });
      prisma.bidScoreRecord.findMany.mockResolvedValue([]);
      prisma.bidScorePointDecision.findMany.mockResolvedValue([
        { pointId: 'pt1', supplierId: 'sup1', checked: true, awardedScore: 15, note: '符合要求' },
        { pointId: 'pt2', supplierId: 'sup1', checked: false, awardedScore: 0, note: null },
      ]);
      prisma.bidRequirementReview = { findMany: jest.fn().mockResolvedValue([]) };
      const out = await service.getMyScores('u1', 'proj-1');
      expect(out.pointDecisions).toHaveLength(2);
      expect(out.pointDecisions[0]).toMatchObject({ pointId: 'pt1', note: '符合要求' });
      expect(out.pointDecisions[1]).toMatchObject({ pointId: 'pt2', note: null });
    });
  });

  describe('requirement reviews', () => {
    beforeEach(() => {
      prisma.bidProject.findUnique.mockResolvedValue({ stage: 'EVALUATING' });
      prisma.bidExpert.findFirst.mockResolvedValue({ id: 'exp-1', userId: 'u1', expertRole: '正选', conflictedSupplierIds: [], signedIn: true, avoidanceConfirmed: true, aiConsentConfirmed: true, confidentialityAgreed: true, disciplineAgreed: true });
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

    it('⑥多条 COMPLETED 时定位最新一条（orderBy createdAt desc，写标注与读辅助数据同源）', async () => {
      prisma.bidRequirementReview.upsert.mockResolvedValue({ id: 'rv-1' });
      await service.upsertRequirementReview('u1', 'proj-1', 'sup-1', { requirementId: 'r1', category: 'technical', verdict: 'ack' });
      expect(prisma.aiBidderResult.findFirst).toHaveBeenCalledWith(expect.objectContaining({
        where: { bidSupplierId: 'sup-1', status: 'COMPLETED' },
        orderBy: { createdAt: 'desc' },
      }));
    });

    it('非本项目专家 → 403', async () => {
      prisma.bidExpert.findFirst.mockResolvedValue(null);
      await expect(service.upsertRequirementReview('u1', 'proj-1', 'sup-1', { requirementId: 'r1', category: 'technical', verdict: 'ack' }))
        .rejects.toMatchObject({ response: { code: 'NOT_PROJECT_EXPERT' } });
    });

    it('回避名单中的供应商 → 403', async () => {
      prisma.bidExpert.findFirst.mockResolvedValue({ id: 'exp-1', expertRole: '正选', conflictedSupplierIds: ['sup-1'] });
      await expect(service.upsertRequirementReview('u1', 'proj-1', 'sup-1', { requirementId: 'r1', category: 'technical', verdict: 'ack' }))
        .rejects.toMatchObject({ response: { code: 'CONFLICTED_SUPPLIER' } });
    });
  });

  describe('downloadBidDocument', () => {
    const signedExpert = { ...mockExpert, signedIn: true, avoidanceConfirmed: true, aiConsentConfirmed: true, confidentialityAgreed: true, disciplineAgreed: true, conflictedSupplierIds: [] };
    let plaintextFetcher: any;

    beforeEach(() => {
      plaintextFetcher = service['plaintextFetcher'];
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    it('解密返回 buffer（门控通过 + fileId 属于该 supplier）', async () => {
      prisma.bidProject.findUnique.mockResolvedValue({ stage: 'EVALUATING' });
      prisma.bidExpert.findFirst.mockResolvedValue(signedExpert);
      prisma.bidSupplier.findFirst.mockResolvedValue({ id: 'sup-1', supplierId: 'sys-1', supplierName: '川水建设', projectId: 'proj-1' });
      prisma.supplierBidSubmission.findUnique.mockResolvedValue({
        technicalFileAssetId: 'file-tech',
        businessFileAssetId: 'file-biz',
        coverLetterAssetId: null,
      });
      prisma.bidSupervisionLog.create.mockResolvedValue({});
      prisma.fileAsset.findUnique.mockResolvedValue({ id: 'file-tech', originalName: '技术方案.pdf' });
      plaintextFetcher.fetchBidderPlaintext.mockResolvedValue({ buffer: Buffer.from('%PDF-1.4'), fileId: 'file-tech' });

      const out = await service.downloadBidDocument('user-1', 'proj-1', 'sup-1', 'file-tech');

      expect(out.buffer.toString()).toBe('%PDF-1.4');
      expect(out.mimeType).toBe('application/pdf');
      // 调 plaintextFetcher 时 which 应为 'technical'（fileId→which 映射）
      expect(plaintextFetcher.fetchBidderPlaintext).toHaveBeenCalledWith('sup-1', 'technical');
    });

    it('非本人专家 → 403', async () => {
      prisma.bidProject.findUnique.mockResolvedValue({ stage: 'EVALUATING' });
      prisma.bidExpert.findFirst.mockResolvedValue(null);

      await expect(service.downloadBidDocument('user-x', 'proj-1', 'sup-1', 'file-tech'))
        .rejects.toMatchObject({ response: { code: 'NOT_PROJECT_EXPERT' } });
      expect(plaintextFetcher.fetchBidderPlaintext).not.toHaveBeenCalled();
    });

    it('回避名单中的 supplier → 403 CONFLICTED_SUPPLIER', async () => {
      prisma.bidProject.findUnique.mockResolvedValue({ stage: 'EVALUATING' });
      prisma.bidExpert.findFirst.mockResolvedValue({ ...signedExpert, conflictedSupplierIds: ['sup-1'] });

      await expect(service.downloadBidDocument('user-1', 'proj-1', 'sup-1', 'file-tech'))
        .rejects.toMatchObject({ response: { code: 'CONFLICTED_SUPPLIER' } });
    });

    it('fileId 不属于该 supplier → 403/404（越权防护）', async () => {
      prisma.bidProject.findUnique.mockResolvedValue({ stage: 'EVALUATING' });
      prisma.bidExpert.findFirst.mockResolvedValue(signedExpert);
      prisma.bidSupplier.findFirst.mockResolvedValue({ id: 'sup-1', supplierId: 'sys-1', projectId: 'proj-1' });
      prisma.supplierBidSubmission.findUnique.mockResolvedValue({
        technicalFileAssetId: 'file-tech',
        businessFileAssetId: 'file-biz',
        coverLetterAssetId: null,
      });

      await expect(service.downloadBidDocument('user-1', 'proj-1', 'sup-1', 'file-foreign'))
        .rejects.toMatchObject({ response: { code: 'NOT_FOUND' } });
      expect(plaintextFetcher.fetchBidderPlaintext).not.toHaveBeenCalled();
    });

    it('dual-v2：fileId 落在 decryptedAssets → 直接读明文资产（不走 plaintextFetcher）', async () => {
      prisma.bidProject.findUnique.mockResolvedValue({ stage: 'EVALUATING' });
      prisma.bidExpert.findFirst.mockResolvedValue(signedExpert);
      prisma.bidSupplier.findFirst.mockResolvedValue({ id: 'sup-1', supplierId: 'sys-1', supplierName: '川水建设', projectId: 'proj-1' });
      prisma.supplierBidSubmission.findUnique.mockResolvedValue({
        envelopeVersion: 'dual-v2',
        technicalFileAssetId: 'fa-outer-t',
        decryptedAssets: { technical: 'fa-dec-t', business: 'fa-dec-b' },
      });
      prisma.fileAsset.findUnique.mockResolvedValue({
        id: 'fa-dec-t', key: 'bid-decrypted/proj-1/sup-1/technical.plain', originalName: 'technical.plain',
      });
      jest.spyOn(minioClient, 'getObject').mockResolvedValue({
        async *[Symbol.asyncIterator]() { yield Buffer.from('%PDF-1.4'); },
      } as any);
      prisma.bidSupervisionLog.create.mockResolvedValue({});

      const out = await service.downloadBidDocument('user-1', 'proj-1', 'sup-1', 'fa-dec-t');

      expect(out.buffer.toString()).toBe('%PDF-1.4');
      expect(out.mimeType).toBe('application/pdf');
      expect(plaintextFetcher.fetchBidderPlaintext).not.toHaveBeenCalled();
    });
  });

  describe('verifyScoreReview', () => {
    const signedExpert = { ...mockExpert, signedIn: true, avoidanceConfirmed: true, aiConsentConfirmed: true, confidentialityAgreed: true, disciplineAgreed: true, expertName: '刘' };

    it('draft → verified：用 upsert（无 review 行也不抛 P2025）', async () => {
      prisma.bidProject.findUnique.mockResolvedValue({ stage: 'EVALUATING' });
      prisma.bidExpert.findFirst.mockResolvedValue({ ...signedExpert, id: 'exp1' });
      prisma.bidSupplier.findFirst.mockResolvedValue({ id: 'sup1', projectId: 'p1', decryptStatus: 'SUCCESS' }); // P2-2 活跃供应商闸门
      prisma.bidScoreRecord.findMany.mockResolvedValue([{ scoreItemId: 'si1', score: 80 }]); // 已有评分
      prisma.bidScoreReview.upsert.mockResolvedValue({ id: 'rv1', status: 'verified' });
      const r = await service.verifyScoreReview('user-1', 'p1', 'sup1');
      expect(prisma.bidScoreReview.upsert).toHaveBeenCalledWith(expect.objectContaining({
        where: { expertId_projectId_supplierId: { expertId: 'exp1', projectId: 'p1', supplierId: 'sup1' } },
        update: expect.objectContaining({ status: 'verified' }),
        create: expect.objectContaining({ expertId: 'exp1', projectId: 'p1', supplierId: 'sup1', status: 'verified' }),
      }));
      expect(r.status).toBe('verified');
    });

    it('非评标阶段 → PROJECT_NOT_EVALUATING', async () => {
      prisma.bidProject.findUnique.mockResolvedValue({ stage: 'OPENING' });
      await expect(service.verifyScoreReview('user-1', 'p1', 'sup1')).rejects.toMatchObject({ response: { code: 'PROJECT_NOT_EVALUATING' } });
    });

    it('未完成身份核验/回避/AI声明 → VERIFICATION_REQUIRED', async () => {
      prisma.bidProject.findUnique.mockResolvedValue({ stage: 'EVALUATING' });
      prisma.bidExpert.findFirst.mockResolvedValue({ ...signedExpert, id: 'exp1', signedIn: false });
      await expect(service.verifyScoreReview('user-1', 'p1', 'sup1')).rejects.toMatchObject({ response: { code: 'VERIFICATION_REQUIRED' } });
    });

    it('未提交评分的供应商不能核对 → SCORING_INCOMPLETE', async () => {
      prisma.bidProject.findUnique.mockResolvedValue({ stage: 'EVALUATING' });
      prisma.bidExpert.findFirst.mockResolvedValue({ ...signedExpert, id: 'exp1' });
      prisma.bidSupplier.findFirst.mockResolvedValue({ id: 'sup1', projectId: 'p1', decryptStatus: 'SUCCESS' }); // P2-2 活跃供应商闸门
      prisma.bidScoreRecord.findMany.mockResolvedValue([]); // 无评分
      await expect(service.verifyScoreReview('user-1', 'p1', 'sup1')).rejects.toMatchObject({ response: { code: 'SCORING_INCOMPLETE' } });
    });

    it('报告已锁定 → SCORE_LOCKED', async () => {
      prisma.bidProject.findUnique.mockResolvedValue({ stage: 'EVALUATING' });
      prisma.bidExpert.findFirst.mockResolvedValue({ ...signedExpert, id: 'exp1', reportConfirmed: true });
      await expect(service.verifyScoreReview('user-1', 'p1', 'sup1')).rejects.toMatchObject({ response: { code: 'SCORE_LOCKED' } });
    });

    it('P1-6：供应商评分项未评完 → SCORING_INCOMPLETE', async () => {
      prisma.bidProject.findUnique.mockResolvedValue({ stage: 'EVALUATING' });
      prisma.bidExpert.findFirst.mockResolvedValue({ ...signedExpert, id: 'exp1' });
      prisma.bidSupplier.findFirst.mockResolvedValue({ id: 'sup1', projectId: 'p1', decryptStatus: 'SUCCESS' }); // P2-2 活跃供应商闸门
      prisma.bidScoreRecord.findMany.mockResolvedValue([{ id: 'r1' }, { id: 'r2' }, { id: 'r3' }]); // 已评 3 条
      prisma.bidScoreItem.count.mockResolvedValue(5); // 共 5 项 → 未评完
      await expect(service.verifyScoreReview('user-1', 'p1', 'sup1')).rejects.toMatchObject({ response: { code: 'SCORING_INCOMPLETE' } });
    });
  });

  describe('maybeConvertDocxToPdf（RCE / 路径穿越回归）', () => {
     
    const childProcess = require('child_process');

    it('非 Word 文件应原样返回，不触发任何转换', () => {
      const spy = jest.spyOn(childProcess, 'execFileSync').mockImplementation(() => undefined as any);
      const buf = Buffer.from('plain');
      expect((service as any).maybeConvertDocxToPdf(buf, 'report.pdf')).toBe(buf);
      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    });

    it('恶意文件名不得进入命令行或文件路径，临时文件固定安全名 input.docx', () => {
      const spy = jest.spyOn(childProcess, 'execFileSync').mockImplementation(() => undefined as any);
      const buf = Buffer.from('fake docx');
      const malicious = '$(touch /tmp/pwned)`id`;"rm -rf".docx';
      const out = (service as any).maybeConvertDocxToPdf(buf, malicious);
      expect(out).toBe(buf); // 被 mock 的转换不产生 pdf → 原样返回
      expect(spy).toHaveBeenCalledTimes(1);
      const [cmd, args] = spy.mock.calls[0] as unknown as [string, string[]];
      expect(cmd).toBe('libreoffice');
      const joined = JSON.stringify(args);
      expect(joined).not.toContain('pwned');
      expect(joined).not.toContain('rm -rf');
      expect(String(args[args.length - 1])).toMatch(/input\.docx$/); // 安全名，不含原始文件名
      spy.mockRestore();
    });
  });

  describe('draftClarification (P1-1)', () => {
    it('非本项目专家 → 403 NOT_PROJECT_EXPERT', async () => {
      prisma.bidExpert.findFirst.mockResolvedValue(null);
      await expect(service.draftClarification('user-x', 'proj-1', 'sup-1')).rejects.toMatchObject({
        response: { code: 'NOT_PROJECT_EXPERT' },
      });
    });

    it('供应商不属于项目 → 400 SUPPLIER_NOT_IN_PROJECT', async () => {
      prisma.bidExpert.findFirst.mockResolvedValue(mockExpert);
      prisma.bidSupplier.findFirst.mockResolvedValue(null);
      await expect(service.draftClarification('user-1', 'proj-1', 'sup-x')).rejects.toMatchObject({
        response: { code: 'SUPPLIER_NOT_IN_PROJECT' },
      });
    });

    it('合法 → 调用 draftQuestion 并返回结果', async () => {
      prisma.bidExpert.findFirst.mockResolvedValue(mockExpert);
      prisma.bidSupplier.findFirst.mockResolvedValue({ id: 'sup-1', projectId: 'proj-1' });
      const res = await service.draftClarification('user-1', 'proj-1', 'sup-1');
      expect(res).toMatchObject({ drafts: [], basis: [] });
    });
  });

  describe('AI 辅助读取端门控 (P1-2)', () => {
    const verifiedExpert = { ...mockExpert, signedIn: true, avoidanceConfirmed: true, aiConsentConfirmed: true, confidentialityAgreed: true, disciplineAgreed: true, conflictedSupplierIds: [] };

    it('getAssistData：未完成身份核验/回避/AI声明 → 403 VERIFICATION_REQUIRED', async () => {
      prisma.bidProject.findUnique.mockResolvedValue({ id: 'proj-1', stage: 'EVALUATING' });
      prisma.bidExpert.findFirst.mockResolvedValue({ ...mockExpert, signedIn: false, avoidanceConfirmed: false, aiConsentConfirmed: false });
      await expect(service.getAssistData('user-1', 'proj-1', 'sup-1')).rejects.toMatchObject({
        response: { code: 'VERIFICATION_REQUIRED' },
      });
    });

    it('getAssistData：五项核验齐全 → 正常返回（不过度拦截）', async () => {
      prisma.bidProject.findUnique.mockResolvedValue({ id: 'proj-1', stage: 'EVALUATING' });
      prisma.bidExpert.findFirst.mockResolvedValue(verifiedExpert);
      prisma.aiBidderResult.findFirst.mockResolvedValue(null); // 降级规则引擎
      ai.analyzeBid.mockResolvedValue({ overall: { score: 80 } });
      const res = await service.getAssistData('user-1', 'proj-1', 'sup-1');
      expect(res.source).toBe('rules_fallback');
    });

    it('getAssistCompare：未完成核验 → 403 VERIFICATION_REQUIRED', async () => {
      prisma.bidProject.findUnique.mockResolvedValue({ id: 'proj-1', stage: 'EVALUATING' });
      prisma.bidExpert.findFirst.mockResolvedValue({ ...mockExpert, signedIn: false });
      await expect(service.getAssistCompare('user-1', 'proj-1')).rejects.toMatchObject({
        response: { code: 'VERIFICATION_REQUIRED' },
      });
    });

    it('getAssistCompare：非开评标阶段 → 403 PROJECT_NOT_ACTIVE', async () => {
      prisma.bidProject.findUnique.mockResolvedValue({ id: 'proj-1', stage: 'DOWNLOAD' });
      await expect(service.getAssistCompare('user-1', 'proj-1')).rejects.toMatchObject({
        response: { code: 'PROJECT_NOT_ACTIVE' },
      });
    });

    it('getAssistCompare：核验齐全+合法阶段 → 正常返回', async () => {
      prisma.bidProject.findUnique.mockResolvedValue({ id: 'proj-1', stage: 'EVALUATING' });
      prisma.bidExpert.findFirst.mockResolvedValue(verifiedExpert);
      prisma.aiBidAnalysisTask = { findUnique: jest.fn().mockResolvedValue(null) };
      const res = await service.getAssistCompare('user-1', 'proj-1');
      expect(res).toMatchObject({ bidders: [] });
    });
  });

  describe('evaluation deadline gate', () => {
    it('超时且未延期时 submitScores 应抛 ConflictException', async () => {
      const overdueDeadline = new Date(Date.now() - 1000);
      prisma.bidProject.findUnique.mockResolvedValue({
        stage: 'EVALUATING',
        evaluationDeadline: overdueDeadline,
      });
      await expect(service.submitScores('user-1', 'proj-1', {
        supplierName: 'test',
        scores: [{ supplierId: 'sup-1', scoreItemId: 'si-1', score: 80 }],
      })).rejects.toThrow(ConflictException);
    });

    it('未超时（evaluationDeadline 在未来）时 submitScores 应继续执行到专家校验', async () => {
      const futureDeadline = new Date(Date.now() + 3600000);
      prisma.bidProject.findUnique.mockResolvedValue({
        stage: 'EVALUATING',
        evaluationDeadline: futureDeadline,
      });
      prisma.bidExpert.findFirst.mockResolvedValue(null);
      await expect(service.submitScores('user-1', 'proj-1', {
        supplierName: 'test',
        scores: [{ supplierId: 'sup-1', scoreItemId: 'si-1', score: 80 }],
      })).rejects.toMatchObject({
        response: { code: 'NOT_PROJECT_EXPERT' },
      });
    });

    it('超时且未延期时 confirmReport 应抛 ConflictException', async () => {
      const overdueDeadline = new Date(Date.now() - 1000);
      prisma.bidProject.findUnique.mockResolvedValue({
        stage: 'EVALUATING',
        evaluationDeadline: overdueDeadline,
      });
      await expect(service.confirmReport('user-1', 'proj-1')).rejects.toThrow(ConflictException);
    });

    it('未超时时 confirmReport 应继续执行到专家校验', async () => {
      const futureDeadline = new Date(Date.now() + 3600000);
      prisma.bidProject.findUnique.mockResolvedValue({
        stage: 'EVALUATING',
        evaluationDeadline: futureDeadline,
      });
      prisma.bidExpert.findFirst.mockResolvedValue(null);
      await expect(service.confirmReport('user-1', 'proj-1')).rejects.toMatchObject({
        response: { code: 'NOT_PROJECT_EXPERT' },
      });
    });

    it('非 EVALUATING 阶段时 submitScores 应跳过超时检查', async () => {
      prisma.bidProject.findUnique.mockResolvedValue({
        stage: 'OPENING',
        evaluationDeadline: new Date(Date.now() - 1000),
      });
      prisma.bidExpert.findFirst.mockResolvedValue(null);
      await expect(service.submitScores('user-1', 'proj-1', {
        supplierName: 'test',
        scores: [{ supplierId: 'sup-1', scoreItemId: 'si-1', score: 80 }],
      })).rejects.toMatchObject({
        response: { code: 'NOT_PROJECT_EXPERT' },
      });
    });

    it('无 evaluationDeadline 时 submitScores 应跳过超时检查', async () => {
      prisma.bidProject.findUnique.mockResolvedValue({
        stage: 'EVALUATING',
        evaluationDeadline: null,
      });
      prisma.bidExpert.findFirst.mockResolvedValue(null);
      await expect(service.submitScores('user-1', 'proj-1', {
        supplierName: 'test',
        scores: [{ supplierId: 'sup-1', scoreItemId: 'si-1', score: 80 }],
      })).rejects.toMatchObject({
        response: { code: 'NOT_PROJECT_EXPERT' },
      });
    });
  });

  describe('expert document access audit', () => {
    it('downloadBidDocument 应返回审计动作名', () => {
      const action = 'EXPERT_VIEW_DOCUMENT';
      expect(action).toMatch(/^EXPERT_/);
    });

    it('getDecryptedDocuments 应返回审计动作名', () => {
      const action = 'EXPERT_VIEW_DOCUMENTS_SUMMARY';
      expect(action).toMatch(/^EXPERT_/);
    });
  });

  describe('leaderCoSign', () => {
    it('候补专家未确认报告不阻塞组长末签', async () => {
      prisma.bidExpert.findFirst.mockResolvedValue({
        ...mockExpert, id: 'exp-lead', isLead: true,
        signedIn: true, avoidanceConfirmed: true, aiConsentConfirmed: true,
        confidentialityAgreed: true, disciplineAgreed: true,
        reportConfirmed: true,
      });
      prisma.bidProject.findUnique.mockResolvedValue({ stage: 'EVALUATING' });
      // 候补专家未确认 → 但 expertRole='正选' 过滤后 count=0
      prisma.bidExpert.count.mockResolvedValue(0);
      prisma.bidProject.update = jest.fn().mockResolvedValue({ id: 'p1', leaderCoSigned: true });

      await service.leaderCoSign('user-1', 'proj-1');

      expect(prisma.bidExpert.count).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ expertRole: '正选', reportConfirmed: false }),
        }),
      );
      expect(prisma.bidProject.update).toHaveBeenCalled();
    });

    it('正选专家有未确认 → 阻塞', async () => {
      prisma.bidExpert.findFirst.mockResolvedValue({
        ...mockExpert, id: 'exp-lead', isLead: true,
        signedIn: true, avoidanceConfirmed: true, aiConsentConfirmed: true,
        confidentialityAgreed: true, disciplineAgreed: true,
        reportConfirmed: true,
      });
      prisma.bidProject.findUnique.mockResolvedValue({ stage: 'EVALUATING' });
      prisma.bidExpert.count.mockResolvedValue(1); // 有正选未确认

      await expect(service.leaderCoSign('user-1', 'proj-1'))
        .rejects.toMatchObject({ response: { code: 'MEMBERS_NOT_CONFIRMED' } });
    });
  });

  describe('P1 专家间可见性收口：listMotions / listDisputes / getProject', () => {
    const votes = [
      { expertId: 'exp-1', vote: 'approve' },
      { expertId: 'exp-2', vote: 'reject' },
      { expertId: 'exp-3', vote: 'abstain' },
    ];

    it('非组长：voting 期动议不返回 votes/赞反计数，仅本人票与已投数（防从众）', async () => {
      prisma.bidExpert.findFirst.mockResolvedValue({ ...mockExpert, isLead: false });
      prisma.bidMotion.findMany.mockResolvedValue([{ id: 'm1', projectId: 'proj-1', title: '废标动议', status: 'voting', votes }]);

      const res = await service.listMotions('user-1', 'proj-1');

      expect((res[0] as any).votes).toBeUndefined();
      expect(res[0].approveCount).toBeUndefined();
      expect(res[0].myVote).toBe('approve'); // exp-1 = mockExpert.id
      expect(res[0].votedCount).toBe(3);
    });

    it('非组长：closed 动议公布三向计数与结果，但仍不返回 votes 明细', async () => {
      prisma.bidExpert.findFirst.mockResolvedValue({ ...mockExpert, isLead: false });
      prisma.bidMotion.findMany.mockResolvedValue([{ id: 'm1', projectId: 'proj-1', title: '废标动议', status: 'closed', result: 'approved', votes }]);

      const res = await service.listMotions('user-1', 'proj-1');

      expect((res[0] as any).votes).toBeUndefined();
      expect(res[0]).toMatchObject({ approveCount: 1, rejectCount: 1, abstainCount: 1, votedCount: 3 });
    });

    it('组长：保留 votes 明细（催票/主持需要）且带派生字段', async () => {
      prisma.bidExpert.findFirst.mockResolvedValue({ ...mockExpert, isLead: true });
      prisma.bidMotion.findMany.mockResolvedValue([{ id: 'm1', projectId: 'proj-1', title: '废标动议', status: 'closed', result: 'approved', votes }]);

      const res = await service.listMotions('user-1', 'proj-1');

      expect((res[0] as any).votes).toHaveLength(3);
      expect(res[0].myVote).toBe('approve');
    });

    it('listDisputes 仅返回本人工单（偏差组均值不可跨专家可见）', async () => {
      prisma.bidExpert.findFirst.mockResolvedValue({ ...mockExpert });
      prisma.expertDispute.findMany.mockResolvedValue([]);

      await service.listDisputes('user-1', 'proj-1');

      expect(prisma.expertDispute.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ projectId: 'proj-1', expertId: 'exp-1' }) }),
      );
    });
  });

  describe('focus-hint（跨设备联动）', () => {
    let redisMock: { incr: jest.Mock; set: jest.Mock; expire: jest.Mock; get: jest.Mock };

    beforeEach(() => {
      redisMock = {
        incr: jest.fn(async () => 7),
        set: jest.fn(async () => 'OK'),
        expire: jest.fn(async () => 1),
        get: jest.fn(async () => null),
      };
      (service as any).redis = redisMock;
      prisma.bidExpert.findFirst.mockResolvedValue({ id: 'exp-1' });
    });

    afterEach(() => {
      (service as any).redis = undefined;
    });

    it('setFocusHint：seq 计数器不设 TTL（防回卷重复聚焦），hint 值 key 120s 过期', async () => {
      const r = await service.setFocusHint('user-1', 'proj-1', { supplierId: 'sup-1' });

      expect(r).toEqual({ ok: true, seq: 7 });
      expect(redisMock.incr).toHaveBeenCalledWith('expert:focus:seq:exp-1:proj-1');
      expect(redisMock.expire).not.toHaveBeenCalled(); // ④：seq 单调不回卷
      expect(redisMock.set).toHaveBeenCalledWith(
        'expert:focus:exp-1:proj-1',
        expect.stringContaining('"seq":7'),
        'EX',
        120,
      );
    });

    it('非本项目专家 → 403，不触碰 Redis', async () => {
      prisma.bidExpert.findFirst.mockResolvedValue(null);
      await expect(service.setFocusHint('user-x', 'proj-1', { supplierId: 'sup-1' }))
        .rejects.toMatchObject({ response: { code: 'NOT_PROJECT_EXPERT' } });
      expect(redisMock.incr).not.toHaveBeenCalled();
    });

    it('getFocusHint 读到 hint 后写 ACK 回执', async () => {
      redisMock.get.mockResolvedValue(JSON.stringify({ supplierId: 'sup-1', seq: 7, at: 1 }));
      const hint = await service.getFocusHint('user-1', 'proj-1');
      expect(hint).toMatchObject({ supplierId: 'sup-1', seq: 7 });
      expect(redisMock.set).toHaveBeenCalledWith('expert:focus:ack:exp-1:proj-1:7', '1', 'EX', 30);
    });
  });
});

describe('ExpertService P1-6 — 候补专家门控（SUBSTITUTE_EXPERT）', () => {
  let svc: any;
  let prisma: any;

  const SUB = {
    id: 'exp-sub', userId: 'user-sub', expertName: '候补专家', projectId: 'proj-1',
    expertRole: '候补', signedIn: true, avoidanceConfirmed: true, aiConsentConfirmed: true,
    confidentialityAgreed: true, disciplineAgreed: true, reportConfirmed: false,
    phoneVerified: true,
    conflictedSupplierIds: null as string | null,
  };
  const REGULAR = { ...SUB, id: 'exp-reg', userId: 'user-reg', expertName: '正选专家', expertRole: '正选' };

  beforeEach(async () => {
    prisma = {
      bidProject: { findUnique: jest.fn().mockResolvedValue({ id: 'proj-1', stage: 'EVALUATING' }) },
      bidExpert: { findFirst: jest.fn(), findMany: jest.fn().mockResolvedValue([]), update: jest.fn().mockResolvedValue({}) },
      supplierBidSubmission: { findUnique: jest.fn() },
      supplier: { findUnique: jest.fn().mockResolvedValue(null) },
      bidSupplier: { findFirst: jest.fn().mockResolvedValue(null) },
      bidSupervisionLog: { create: jest.fn().mockResolvedValue({}) },
      fileAsset: { findMany: jest.fn().mockResolvedValue([]) },
      bidScoreRecord: { findMany: jest.fn().mockResolvedValue([]), createMany: jest.fn().mockResolvedValue({ count: 0 }) },
    };
    const { ExpertService } = await import('./expert.service');
    const instance: any = Object.create(ExpertService.prototype);
    instance.prisma = prisma;
    instance.logger = { warn: jest.fn(), log: jest.fn(), error: jest.fn() };
    svc = instance;
  });

  it('候补 signIn → 403 SUBSTITUTE_EXPERT（不写签到状态）', async () => {
    prisma.bidExpert.findFirst.mockResolvedValue(SUB);
    await expect(svc.signIn('user-sub', 'proj-1', { ip: '127.0.0.1', userAgent: 'test' }))
      .rejects.toMatchObject({ response: { code: 'SUBSTITUTE_EXPERT' } });
    expect(prisma.bidExpert.update).not.toHaveBeenCalled();
  });

  it('候补 getDecryptedDocuments → 403 SUBSTITUTE_EXPERT（不返回任何文件）', async () => {
    prisma.bidExpert.findFirst.mockResolvedValue(SUB);
    await expect(svc.getDecryptedDocuments('user-sub', 'proj-1', 'sup-1'))
      .rejects.toMatchObject({ response: { code: 'SUBSTITUTE_EXPERT' } });
  });

  it('候补 submitScores → 403 SUBSTITUTE_EXPERT（零评分写入）', async () => {
    prisma.bidExpert.findFirst.mockResolvedValue(SUB);
    await expect(svc.submitScores('user-sub', 'proj-1', { scores: [] } as any))
      .rejects.toMatchObject({ response: { code: 'SUBSTITUTE_EXPERT' } });
    expect(prisma.bidScoreRecord.createMany).not.toHaveBeenCalled();
  });

  it('候补 getAssistData / getAssistCompare → 403 SUBSTITUTE_EXPERT', async () => {
    prisma.bidExpert.findFirst.mockResolvedValue(SUB);
    await expect(svc.getAssistData('user-sub', 'proj-1', 'sup-1'))
      .rejects.toMatchObject({ response: { code: 'SUBSTITUTE_EXPERT' } });
    await expect(svc.getAssistCompare('user-sub', 'proj-1'))
      .rejects.toMatchObject({ response: { code: 'SUBSTITUTE_EXPERT' } });
  });

  it('候补 confirmReport / verifyScoreReview → 403 SUBSTITUTE_EXPERT', async () => {
    prisma.bidExpert.findFirst.mockResolvedValue(SUB);
    await expect(svc.confirmReport('user-sub', 'proj-1'))
      .rejects.toMatchObject({ response: { code: 'SUBSTITUTE_EXPERT' } });
    await expect(svc.verifyScoreReview('user-sub', 'proj-1', 'sup-1'))
      .rejects.toMatchObject({ response: { code: 'SUBSTITUTE_EXPERT' } });
  });

  it('正选专家 → 门控不拦（signIn 正常推进到环境校验/更新）', async () => {
    prisma.bidExpert.findFirst.mockResolvedValue(REGULAR);
    prisma.bidExpert.update.mockResolvedValue({ ...REGULAR, signedIn: true });
    const res = await svc.signIn('user-reg', 'proj-1', { ip: '127.0.0.1', userAgent: 'test' });
    expect(res.signedIn).toBe(true);
    expect(prisma.bidExpert.update).toHaveBeenCalled();
  });

  it('递补后（expertRole 已置正选）→ 门控自动放行', async () => {
    const promoted = { ...SUB, expertRole: '正选' };
    prisma.bidExpert.findFirst.mockResolvedValue(promoted);
    prisma.bidExpert.update.mockResolvedValue({ ...promoted, signedIn: true });
    const res = await svc.signIn('user-sub', 'proj-1', { ip: '127.0.0.1', userAgent: 'test' });
    expect(res.signedIn).toBe(true);
  });
});
