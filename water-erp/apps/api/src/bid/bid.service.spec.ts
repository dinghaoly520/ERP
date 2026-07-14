import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, BadRequestException } from '@nestjs/common';
import { BidService } from './bid.service';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationService } from '../notification/notification.service';
import { ClarificationAiService } from './clarification-ai.service';
import { BidGateway } from './bid.gateway';
import { assertBidStageTransition } from './bid-state';

// Mock decrypt utilities and MinIO client for decryptSupplier tests
jest.mock('./bid-submission.crypto', () => ({
  decryptBuffer: jest.fn().mockReturnValue(Buffer.from('decrypted')),
  streamToBuffer: jest.fn().mockResolvedValue(Buffer.from('test')),
  verifyIntegrity: jest.fn().mockReturnValue(true),
  classifyDecryptOutcome: jest.requireActual('./bid-submission.crypto').classifyDecryptOutcome,
}));

jest.mock('../upload/minio.client', () => ({
  minioClient: { getObject: jest.fn().mockResolvedValue({}) },
  MINIO_BUCKET: 'test-bucket',
}));

/* ── 纯函数测试：bid-state 状态机 ── */

describe('assertBidStageTransition (bid-state)', () => {
  it('允许合法流转 DOWNLOAD → SUBMIT', () => {
    expect(() => assertBidStageTransition('DOWNLOAD', 'SUBMIT')).not.toThrow();
  });

  it('允许合法流转 SUBMIT → OPENING', () => {
    expect(() => assertBidStageTransition('SUBMIT', 'OPENING')).not.toThrow();
  });

  it('允许合法流转 OPENING → EVALUATING', () => {
    expect(() => assertBidStageTransition('OPENING', 'EVALUATING')).not.toThrow();
  });

  it('允许合法流转 EVALUATING → ARCHIVED', () => {
    expect(() => assertBidStageTransition('EVALUATING', 'ARCHIVED')).not.toThrow();
  });

  it('同阶段幂等不报错', () => {
    expect(() => assertBidStageTransition('DOWNLOAD', 'DOWNLOAD')).not.toThrow();
    expect(() => assertBidStageTransition('ARCHIVED', 'ARCHIVED')).not.toThrow();
  });

  it('跳级抛 ConflictException', () => {
    expect(() => assertBidStageTransition('DOWNLOAD', 'ARCHIVED')).toThrow(ConflictException);
  });

  it('回退抛 ConflictException', () => {
    expect(() => assertBidStageTransition('ARCHIVED', 'DOWNLOAD')).toThrow(ConflictException);
  });

  it('ARCHIVED 后不能转到任何阶段', () => {
    expect(() => assertBidStageTransition('ARCHIVED', 'EVALUATING')).toThrow(ConflictException);
    expect(() => assertBidStageTransition('ARCHIVED', 'OPENING')).toThrow(ConflictException);
  });

  it('异常消息包含流转方向', () => {
    try {
      assertBidStageTransition('DOWNLOAD', 'ARCHIVED');
      fail('应抛出 ConflictException');
    } catch (e) {
      expect(e.message).toContain('DOWNLOAD');
      expect(e.message).toContain('ARCHIVED');
    }
  });
});

/* ── 集成测试：BidService 使用状态机 ── */

describe('BidService — stage transitions', () => {
  let service: BidService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      bidProject: {
        findUnique: jest.fn(),
        update: jest.fn(),
        create: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
        groupBy: jest.fn(),
      },
      bidSupervisionLog: { findMany: jest.fn(), create: jest.fn() },
      bidExpert: { groupBy: jest.fn(), findFirst: jest.fn(), findMany: jest.fn(), count: jest.fn(), update: jest.fn() },
      bidScoreItem: { findFirst: jest.fn(), create: jest.fn(), delete: jest.fn(), count: jest.fn(), findMany: jest.fn().mockResolvedValue([]) },
      bidScoreRecord: { upsert: jest.fn(), findMany: jest.fn().mockResolvedValue([]), count: jest.fn().mockResolvedValue(0) },
      aiBidAnalysisTask: { upsert: jest.fn().mockResolvedValue({ id: 'ai-1' }) },
      aiBidderResult: { createMany: jest.fn().mockResolvedValue({ count: 0 }) },
      supplier: { count: jest.fn() },
      announcement: { count: jest.fn(), findFirst: jest.fn() },
      bidSupplier: { findMany: jest.fn(), update: jest.fn(), create: jest.fn(), findFirst: jest.fn(), findUnique: jest.fn(), count: jest.fn() },
      bidOpeningRecord: { create: jest.fn(), findFirst: jest.fn(), update: jest.fn(), findUnique: jest.fn(), findMany: jest.fn() },
      bidEvaluationResult: { deleteMany: jest.fn(), createMany: jest.fn(), findMany: jest.fn(), count: jest.fn() },
      bidArchiveItem: { findMany: jest.fn(), updateMany: jest.fn(), update: jest.fn(), findFirst: jest.fn(), create: jest.fn(), groupBy: jest.fn() },
      supplierBidSubmission: { findUnique: jest.fn() },
      bidOpeningSession: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
      fileAsset: { findUnique: jest.fn() },
      notification: { create: jest.fn(), createMany: jest.fn() },
      user: { findMany: jest.fn() },
      auditLog: { create: jest.fn() },
      // Support both callback-based and batch-based $transaction patterns
      $transaction: jest.fn(async (callbackOrOps: any) => {
        if (typeof callbackOrOps === 'function') {
          // Callback-based: pass a tx client (which is the prisma mock itself)
          return callbackOrOps(prisma);
        }
        // Batch-based: execute all ops sequentially
        return Promise.all(callbackOrOps);
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BidService,
        { provide: PrismaService, useValue: prisma },
        { provide: NotificationService, useValue: { sendToRole: jest.fn() } },
        { provide: ClarificationAiService, useValue: { draftQuestion: jest.fn().mockResolvedValue({ drafts: [], basis: [] }), summarizeReply: jest.fn().mockResolvedValue(null) } },
      ],
    }).compile();

    service = module.get<BidService>(BidService);
  });

  describe('assertBidStageTransition', () => {
    it('allows DOWNLOAD → SUBMIT', () => {
      expect(() => assertBidStageTransition('DOWNLOAD', 'SUBMIT')).not.toThrow();
    });

    it('allows SUBMIT → OPENING', () => {
      expect(() => assertBidStageTransition('SUBMIT', 'OPENING')).not.toThrow();
    });

    it('rejects DOWNLOAD → ARCHIVED (skip stages) with ConflictException', () => {
      expect(() => assertBidStageTransition('DOWNLOAD', 'ARCHIVED')).toThrow(ConflictException);
    });

    it('rejects ARCHIVED → DOWNLOAD (backward) with ConflictException', () => {
      expect(() => assertBidStageTransition('ARCHIVED', 'DOWNLOAD')).toThrow(ConflictException);
    });

    it('allows same-stage (idempotent)', () => {
      expect(() => assertBidStageTransition('SUBMIT', 'SUBMIT')).not.toThrow();
    });
  });

  describe('updateProject — stage 不再可经 PATCH 流转（防状态机旁路）', () => {
    it('不向 prisma.update 转发 stage 字段', async () => {
      prisma.bidProject.update.mockResolvedValue({ id: 'p1', stage: 'DOWNLOAD' });
      await service.updateProject('p1', { name: '新名' } as any);
      expect(prisma.bidProject.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'p1' } }),
      );
      const data = prisma.bidProject.update.mock.calls[0][0].data;
      expect(data).not.toHaveProperty('stage');
    });
  });

  describe('openSubmission', () => {
    it('transitions DOWNLOAD → SUBMIT and writes supervision log', async () => {
      prisma.bidProject.findUnique.mockResolvedValue({ stage: 'DOWNLOAD', name: '测试项目', projectCode: 'BID-1' });
      prisma.announcement.findFirst.mockResolvedValue({ id: 'a1' });
      prisma.bidProject.update.mockResolvedValue({ id: 'p1', stage: 'SUBMIT' });
      prisma.bidSupervisionLog.create.mockResolvedValue({});

      const result = await service.openSubmission('p1');
      expect(result.stage).toBe('SUBMIT');
      expect(prisma.bidSupervisionLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ action: '开放投递 (DOWNLOAD→SUBMIT)' }),
        }),
      );
    });
  });

  describe('BidService.openSubmission — 公告前置 (G3)', () => {
    beforeEach(() => {
      prisma.bidProject.findUnique.mockResolvedValue({ id: 'p1', stage: 'DOWNLOAD', name: '项目', projectCode: 'BID-1' });
    });

    it('无关联已发布招标公示时拒绝', async () => {
      prisma.announcement.findFirst.mockResolvedValue(null);
      await expect(service.openSubmission('p1', 'u1')).rejects.toMatchObject({
        response: { code: 'BID_NOTICE_REQUIRED' },
      });
    });

    it('存在已发布招标公示时放行', async () => {
      prisma.announcement.findFirst.mockResolvedValue({ id: 'a1' });
      prisma.bidProject.update.mockResolvedValue({ stage: 'SUBMIT' });
      prisma.bidSupervisionLog.create.mockResolvedValue({});
      prisma.auditLog.create.mockResolvedValue({});
      await expect(service.openSubmission('p1', 'u1')).resolves.toBeDefined();
    });
  });

  describe('startOpening', () => {
    const sessionDto = {
      host: '主持人A', supervisor: '监督人A',
      decryptWindowStart: '2026-06-16T10:00:00.000Z',
      decryptWindowEnd: '2026-06-16T10:30:00.000Z',
    };

    beforeEach(() => {
      prisma.$transaction = jest.fn(async (callback: any) => callback(prisma));
    });

    it('rejects if stage is DOWNLOAD (not SUBMIT)', async () => {
      prisma.bidProject.findUnique.mockResolvedValue({ stage: 'DOWNLOAD', name: '测试项目' });
      await expect(service.startOpening('p1')).rejects.toThrow(ConflictException);
    });

    it('rejects SUBMIT→OPENING without session data', async () => {
      prisma.bidProject.findUnique.mockResolvedValue({ stage: 'SUBMIT', name: '测试项目' });
      await expect(service.startOpening('p1')).rejects.toThrow(BadRequestException);
      await expect(service.startOpening('p1')).rejects.toMatchObject({
        response: { code: 'OPENING_SESSION_REQUIRED' },
      });
    });

    it('creates session on SUBMIT→OPENING with valid data', async () => {
      prisma.bidProject.findUnique.mockResolvedValue({ stage: 'SUBMIT', name: '测试项目' });
      prisma.bidOpeningSession.findUnique.mockResolvedValue(null);
      prisma.bidOpeningSession.create.mockResolvedValue({ id: 'sess-1' });
      prisma.bidProject.update.mockResolvedValue({ id: 'p1', stage: 'OPENING' });
      prisma.bidSupervisionLog.create.mockResolvedValue({});

      const result = await service.startOpening('p1', sessionDto);

      expect(result.stage).toBe('OPENING');
      expect(prisma.bidOpeningSession.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ host: '主持人A', supervisor: '监督人A' }),
        }),
      );
    });

    it('updates existing session on OPENING→OPENING re-open', async () => {
      prisma.bidProject.findUnique.mockResolvedValue({ stage: 'OPENING', name: '测试项目' });
      prisma.bidOpeningSession.findUnique.mockResolvedValue({ id: 'sess-1', host: '旧主持人' });
      prisma.bidOpeningSession.update.mockResolvedValue({ id: 'sess-1', host: '主持人B' });
      prisma.bidProject.update.mockResolvedValue({ id: 'p1', stage: 'OPENING' });
      prisma.bidSupervisionLog.create.mockResolvedValue({});

      await service.startOpening('p1', { ...sessionDto, host: '主持人B' });

      expect(prisma.bidOpeningSession.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { projectId: 'p1' },
          data: expect.objectContaining({ host: '主持人B' }),
        }),
      );
    });

    it('allows OPENING→OPENING idempotent without session data', async () => {
      prisma.bidProject.findUnique.mockResolvedValue({ stage: 'OPENING', name: '测试项目' });
      prisma.bidProject.update.mockResolvedValue({ id: 'p1', stage: 'OPENING' });
      prisma.bidSupervisionLog.create.mockResolvedValue({});

      const result = await service.startOpening('p1');
      expect(result.stage).toBe('OPENING');
    });

    it('rejects when decryptWindowEnd <= decryptWindowStart', async () => {
      prisma.bidProject.findUnique.mockResolvedValue({ stage: 'SUBMIT', name: '测试项目' });
      await expect(service.startOpening('p1', {
        ...sessionDto,
        decryptWindowEnd: '2026-06-16T09:00:00.000Z', // 早于 start
      })).rejects.toMatchObject({
        response: { code: 'INVALID_DECRYPT_WINDOW' },
      });
    });
  });

  describe('decryptSupplier', () => {
    beforeEach(() => {
      prisma.$transaction = jest.fn(async (callback: any) => callback(prisma));
      prisma.bidSupplier.findFirst.mockResolvedValue({
        id: 'bs-1', projectId: 'p1', supplierName: '测试供应商', supplierId: 's1', decryptStatus: 'PENDING',
      });
      prisma.bidSupplier.update.mockResolvedValue({ id: 'bs-1', decryptStatus: 'SUCCESS', confirmStatus: 'PENDING' });
      prisma.bidSupplier.findUnique.mockResolvedValue({ id: 'bs-1', decryptStatus: 'SUCCESS', confirmStatus: 'PENDING' });
      // Mock submission with file asset for decrypt loop
      prisma.supplierBidSubmission.findUnique = jest.fn().mockResolvedValue({
        technicalFileAssetId: 'fa1', businessFileAssetId: null, coverLetterAssetId: null,
        technicalSealedKey: null, businessSealedKey: null, coverLetterSealedKey: null,
      });
      prisma.fileAsset.findUnique = jest.fn().mockResolvedValue({
        id: 'fa1', key: 'uploads/test.pdf', sha256: 'abc123',
      });
      prisma.bidOpeningRecord.create.mockResolvedValue({});
      prisma.bidSupervisionLog.create.mockResolvedValue({});
      // Default: session exists with open window (大多数测试解密成功需此前提)
      prisma.bidOpeningSession.findUnique = jest.fn().mockResolvedValue({
        decryptWindowStart: new Date(Date.now() - 3600_000),
        decryptWindowEnd: new Date(Date.now() + 3600_000),
      });
      // Default: project is in OPENING stage (decryptSupplier 阶段门控)
      prisma.bidProject.findUnique.mockResolvedValue({ stage: 'OPENING' });
    });

    it('succeeds deterministically by default', async () => {
      const result = await service.decryptSupplier('p1', 'bs-1', {} as any);

      expect(result).toBeDefined();
      expect(prisma.bidSupplier.update).toHaveBeenCalledWith({
        where: { id: 'bs-1' },
        data: { decryptStatus: 'SUCCESS' },
      });
      expect(prisma.bidSupplier.update).not.toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ decryptStatus: 'DANGER' }) }),
      );
    });

    it('simulates danger only when explicitly requested', async () => {
      await service.decryptSupplier('p1', 'bs-1', { simulateDanger: true } as any);

      expect(prisma.bidSupplier.update).toHaveBeenCalledWith({
        where: { id: 'bs-1' },
        data: expect.objectContaining({ decryptStatus: 'DANGER' }),
      });
    });

    it('creates a pending opening record and leaves BidSupplier confirmStatus PENDING', async () => {
      await service.decryptSupplier('p1', 'bs-1', {
        amount: '100', period: '30天', qualityTarget: '合格', bondStatus: '已缴纳',
      } as any);

      expect(prisma.bidOpeningRecord.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ bidSupplierId: 'bs-1', confirmStatus: '待供应商确认' }),
        }),
      );
      expect(prisma.bidSupplier.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ confirmStatus: 'PENDING' }) }),
      );
      expect(prisma.bidSupplier.update).not.toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ confirmStatus: 'CONFIRMED' }) }),
      );
    });

    it('rejects decrypt when window is not yet open', async () => {
      prisma.bidOpeningSession.findUnique = jest.fn().mockResolvedValue({
        decryptWindowStart: new Date(Date.now() + 3600_000),  // 1 hour from now
        decryptWindowEnd: new Date(Date.now() + 7200_000),
      });
      await expect(service.decryptSupplier('p1', 'bs-1'))
        .rejects.toMatchObject({ response: { code: 'DECRYPT_WINDOW_NOT_OPEN' } });
    });

    it('rejects decrypt when window has closed', async () => {
      prisma.bidOpeningSession.findUnique = jest.fn().mockResolvedValue({
        decryptWindowStart: new Date(Date.now() - 7200_000),
        decryptWindowEnd: new Date(Date.now() - 3600_000),    // 1 hour ago
      });
      await expect(service.decryptSupplier('p1', 'bs-1'))
        .rejects.toMatchObject({ response: { code: 'DECRYPT_WINDOW_CLOSED' } });
    });

    it('allows decrypt when window is open', async () => {
      prisma.bidOpeningSession.findUnique = jest.fn().mockResolvedValue({
        decryptWindowStart: new Date(Date.now() - 3600_000),
        decryptWindowEnd: new Date(Date.now() + 3600_000),
      });
      const result = await service.decryptSupplier('p1', 'bs-1', {} as any);
      expect(result).toBeDefined();
      expect(prisma.bidSupplier.update).toHaveBeenCalledWith({
        where: { id: 'bs-1' },
        data: { decryptStatus: 'SUCCESS' },
      });
    });

    it('rejects decrypt when no session exists (开标未启动)', async () => {
      prisma.bidOpeningSession.findUnique = jest.fn().mockResolvedValue(null);
      await expect(service.decryptSupplier('p1', 'bs-1', {} as any))
        .rejects.toMatchObject({ response: { code: 'OPENING_NOT_STARTED' } });
    });
  });

  describe('resolveOpeningDispute', () => {
    it('updates record handle result and BidSupplier status on confirm', async () => {
      prisma.bidProject.findUnique.mockResolvedValue({ stage: 'OPENING' });
      prisma.bidOpeningRecord.findFirst.mockResolvedValue({
        id: 'r1', projectId: 'p1', supplierName: '测试供应商', bidSupplierId: 'bs-1',
      });
      prisma.bidOpeningRecord.update.mockResolvedValue({});
      prisma.bidOpeningRecord.findUnique.mockResolvedValue({ id: 'r1', confirmStatus: '异议已处理-确认' });
      prisma.bidSupplier.update.mockResolvedValue({});
      prisma.bidSupervisionLog.create.mockResolvedValue({});

      await service.resolveOpeningDispute('p1', 'r1', { result: '经核实无误', confirm: true });

      expect(prisma.bidOpeningRecord.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'r1' }, data: expect.objectContaining({ handleResult: '经核实无误', confirmStatus: '异议已处理-确认' }) }),
      );
      expect(prisma.bidSupplier.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ confirmStatus: 'CONFIRMED' }) }),
      );
    });

    it('sets BidSupplier EXCEPTION when dispute is not confirmed', async () => {
      prisma.bidProject.findUnique.mockResolvedValue({ stage: 'OPENING' });
      prisma.bidOpeningRecord.findFirst.mockResolvedValue({
        id: 'r1', projectId: 'p1', supplierName: '测试供应商', bidSupplierId: 'bs-1',
      });
      prisma.bidOpeningRecord.update.mockResolvedValue({});
      prisma.bidOpeningRecord.findUnique.mockResolvedValue({ id: 'r1' });
      prisma.bidSupplier.update.mockResolvedValue({});
      prisma.bidSupervisionLog.create.mockResolvedValue({});

      await service.resolveOpeningDispute('p1', 'r1', { result: '异议成立', confirm: false });

      expect(prisma.bidSupplier.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ confirmStatus: 'EXCEPTION' }) }),
      );
    });

    it('rejects when record not found', async () => {
      prisma.bidOpeningRecord.findFirst.mockResolvedValue(null);
      await expect(service.resolveOpeningDispute('p1', 'r1', { result: 'x', confirm: true }))
        .rejects.toThrow(BadRequestException);
    });
  });

  describe('generateEvaluationResults', () => {
    it('rejects until all experts confirm reports', async () => {
      prisma.bidProject.findUnique.mockResolvedValue({
        id: 'p1', stage: 'EVALUATING', name: '测试项目',
        experts: [{ id: 'e1', reportConfirmed: false }, { id: 'e2', reportConfirmed: true }],
        suppliers: [],
      });

      await expect(service.generateEvaluationResults('p1'))
        .rejects.toMatchObject({ response: { code: 'EXPERT_REPORTS_NOT_CONFIRMED' } });
    });

    it('rejects when project is not EVALUATING', async () => {
      prisma.bidProject.findUnique.mockResolvedValue({ id: 'p1', stage: 'OPENING', name: 'x', experts: [], suppliers: [] });
      await expect(service.generateEvaluationResults('p1'))
        .rejects.toMatchObject({ response: { code: 'PROJECT_NOT_EVALUATING' } });
    });

    it('ranks suppliers by average score and recommends the top supplier', async () => {
      prisma.bidProject.findUnique.mockResolvedValue({
        id: 'p1', stage: 'EVALUATING', name: '测试项目',
        experts: [{ id: 'e1', reportConfirmed: true }, { id: 'e2', reportConfirmed: true }],
        suppliers: [
          { id: 's1', supplierName: '甲', decryptStatus: 'SUCCESS', submitStatus: '已提交', confirmStatus: 'CONFIRMED' },
          { id: 's2', supplierName: '乙', decryptStatus: 'SUCCESS', submitStatus: '已提交', confirmStatus: 'CONFIRMED' },
          { id: 's3', supplierName: '丙', decryptStatus: 'SUCCESS', submitStatus: '已撤回', confirmStatus: 'CONFIRMED' },
        ],
      });
      prisma.bidScoreRecord.findMany.mockImplementation((args: any) =>
        Promise.resolve(args.where.supplierId === 's1' ? [{ score: 90 }, { score: 80 }] : [{ score: 70 }, { score: 60 }]),
      );
      prisma.bidEvaluationResult.deleteMany.mockResolvedValue({ count: 0 });
      prisma.bidEvaluationResult.createMany.mockResolvedValue({ count: 2 });
      prisma.bidEvaluationResult.findMany.mockResolvedValue([
        { supplierName: '甲', rank: 1, recommended: true, averageScore: 85 },
        { supplierName: '乙', rank: 2, recommended: false, averageScore: 65 },
      ]);
      prisma.bidSupervisionLog.create.mockResolvedValue({});

      const results = await service.generateEvaluationResults('p1');

      expect(prisma.bidEvaluationResult.createMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.arrayContaining([
            expect.objectContaining({ supplierId: 's1', rank: 1, recommended: true }),
            // G2: 去极值后 active 供应商≤3 时全部进入候选人名单，s2 (rank 2) 亦被推荐
            expect.objectContaining({ supplierId: 's2', rank: 2, recommended: true }),
          ]),
        }),
      );
      // 撤回供应商 s3 不参与结果
      const created = prisma.bidEvaluationResult.createMany.mock.calls[0][0].data as any[];
      expect(created.find((r: any) => r.supplierId === 's3')).toBeUndefined();
      expect(results[0].supplierName).toBe('甲');
    });
  });

  describe('BidService.generateEvaluationResults — 去极值与候选人 (G2)', () => {
    const buildProject = (overrides = {}) => ({
      id: 'p1', stage: 'EVALUATING', name: '项目',
      experts: [
        { id: 'e1', reportConfirmed: true },
        { id: 'e2', reportConfirmed: true },
        { id: 'e3', reportConfirmed: true },
        { id: 'e4', reportConfirmed: true },
        { id: 'e5', reportConfirmed: true },
      ],
      suppliers: [
        { id: 's1', supplierName: '甲', decryptStatus: 'SUCCESS', submitStatus: '已提交', confirmStatus: 'CONFIRMED' },
      ],
      ...overrides,
    });

    beforeEach(() => {
      prisma.bidProject.findUnique.mockResolvedValue(buildProject());
      prisma.bidEvaluationResult.deleteMany.mockResolvedValue({ count: 0 });
      prisma.bidEvaluationResult.createMany.mockResolvedValue({ count: 1 });
      prisma.bidEvaluationResult.findMany.mockResolvedValue([]);
      prisma.bidSupervisionLog.create.mockResolvedValue({});
      prisma.auditLog.create.mockResolvedValue({});
    });

    it('专家组=5 时去掉一个最高一个最低后求平均', async () => {
      // 5 位专家对 s1 的总评分：10,20,30,40,100 → 去掉 100 与 10 → 20+30+40=90 / 3 = 30
      const scores = [
        { expertId: 'e1', supplierId: 's1', score: 10 },
        { expertId: 'e2', supplierId: 's1', score: 20 },
        { expertId: 'e3', supplierId: 's1', score: 30 },
        { expertId: 'e4', supplierId: 's1', score: 40 },
        { expertId: 'e5', supplierId: 's1', score: 100 },
      ];
      prisma.bidScoreRecord.findMany.mockResolvedValue(scores);

      const result = await service.generateEvaluationResults('p1', 'u1');

      expect(prisma.bidEvaluationResult.createMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.arrayContaining([
            expect.objectContaining({ averageScore: 30 }),
          ]),
        }),
      );
      expect(result).toBeDefined();
    });

    it('专家组<5 时不去极值，直接求平均', async () => {
      prisma.bidProject.findUnique.mockResolvedValue(buildProject({
        experts: [
          { id: 'e1', reportConfirmed: true },
          { id: 'e2', reportConfirmed: true },
          { id: 'e3', reportConfirmed: true },
        ],
      }));
      const scores = [
        { expertId: 'e1', supplierId: 's1', score: 10 },
        { expertId: 'e2', supplierId: 's1', score: 20 },
        { expertId: 'e3', supplierId: 's1', score: 30 },
      ];
      prisma.bidScoreRecord.findMany.mockResolvedValue(scores);

      await service.generateEvaluationResults('p1', 'u1');

      // (10+20+30)/3 = 20
      expect(prisma.bidEvaluationResult.createMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.arrayContaining([
            expect.objectContaining({ averageScore: 20 }),
          ]),
        }),
      );
    });

    it('前 3 名均标记 recommended（候选人）', async () => {
      prisma.bidProject.findUnique.mockResolvedValue(buildProject({
        suppliers: [
          { id: 's1', supplierName: '甲', decryptStatus: 'SUCCESS', submitStatus: '已提交', confirmStatus: 'CONFIRMED' },
          { id: 's2', supplierName: '乙', decryptStatus: 'SUCCESS', submitStatus: '已提交', confirmStatus: 'CONFIRMED' },
          { id: 's3', supplierName: '丙', decryptStatus: 'SUCCESS', submitStatus: '已提交', confirmStatus: 'CONFIRMED' },
          { id: 's4', supplierName: '丁', decryptStatus: 'SUCCESS', submitStatus: '已提交', confirmStatus: 'CONFIRMED' },
        ],
      }));
      prisma.bidScoreRecord.findMany.mockResolvedValue([
        { expertId: 'e1', supplierId: 's1', score: 90 },
        { expertId: 'e2', supplierId: 's2', score: 80 },
        { expertId: 'e3', supplierId: 's3', score: 70 },
        { expertId: 'e4', supplierId: 's4', score: 60 },
      ]);

      await service.generateEvaluationResults('p1', 'u1');

      const call = prisma.bidEvaluationResult.createMany.mock.calls[0][0];
      const data = call.data as any[];
      const recommendedRanks = data.filter((d: any) => d.recommended).map((d: any) => d.rank).sort();
      expect(recommendedRanks).toEqual([1, 2, 3]);
    });

    it('generateEvaluationResults：通过性过半不通过 → 废标，排末位且不推荐', async () => {
      prisma.bidScoreItem.findMany.mockResolvedValue([
        { id: 'si_qual', category: 'QUALIFICATION' },
      ]);
      // 3 专家，2 票不通过 1 票通过 → 过半废标
      prisma.bidProject.findUnique.mockResolvedValue({
        id: 'p1', name: '项目', stage: 'EVALUATING', bondRequired: false,
        experts: [{ id: 'e1', reportConfirmed: true }, { id: 'e2', reportConfirmed: true }, { id: 'e3', reportConfirmed: true }],
        suppliers: [{ id: 's1', supplierName: '甲', decryptStatus: 'SUCCESS', submitStatus: 'ok', confirmStatus: 'CONFIRMED' }],
      });
      prisma.bidScoreRecord.findMany.mockResolvedValue([
        // 通过性项：2 不通过 + 1 通过
        { supplierId: 's1', expertId: 'e1', score: 0, passed: false, scoreItemId: 'si_qual' },
        { supplierId: 's1', expertId: 'e2', score: 0, passed: false, scoreItemId: 'si_qual' },
        { supplierId: 's1', expertId: 'e3', score: 0, passed: true, scoreItemId: 'si_qual' },
        // 数值项每人 10 分
        { supplierId: 's1', expertId: 'e1', score: 10 },
        { supplierId: 's1', expertId: 'e2', score: 10 },
        { supplierId: 's1', expertId: 'e3', score: 10 },
      ]);
      prisma.bidEvaluationResult.deleteMany.mockResolvedValue({});
      prisma.bidEvaluationResult.createMany.mockResolvedValue({});
      prisma.bidSupervisionLog.create.mockResolvedValue({});
      prisma.bidEvaluationResult.findMany.mockResolvedValue([
        { supplierId: 's1', supplierName: '甲', totalScore: 30, averageScore: 10, rank: 1, recommended: false, disqualified: true },
      ]);

      await service.generateEvaluationResults('p1');

      const created = (prisma.bidEvaluationResult.createMany.mock.calls[0][0] as any).data[0];
      expect(created.disqualified).toBe(true);
      expect(created.recommended).toBe(false);
    });

    it('generateEvaluationResults：不通过不过半 → 不废标', async () => {
      prisma.bidScoreItem.findMany.mockResolvedValue([
        { id: 'si_resp', category: 'RESPONSIVE' },
      ]);
      prisma.bidProject.findUnique.mockResolvedValue({
        id: 'p1', name: '项目', stage: 'EVALUATING', bondRequired: false,
        experts: [{ id: 'e1', reportConfirmed: true }, { id: 'e2', reportConfirmed: true }, { id: 'e3', reportConfirmed: true }],
        suppliers: [{ id: 's1', supplierName: '甲', decryptStatus: 'SUCCESS', submitStatus: 'ok', confirmStatus: 'CONFIRMED' }],
      });
      // 1 不通过 2 通过 → 不过半
      prisma.bidScoreRecord.findMany.mockResolvedValue([
        { supplierId: 's1', expertId: 'e1', score: 0, passed: false, scoreItemId: 'si_resp' },
        { supplierId: 's1', expertId: 'e2', score: 0, passed: true, scoreItemId: 'si_resp' },
        { supplierId: 's1', expertId: 'e3', score: 0, passed: true, scoreItemId: 'si_resp' },
        { supplierId: 's1', expertId: 'e1', score: 20 },
        { supplierId: 's1', expertId: 'e2', score: 20 },
        { supplierId: 's1', expertId: 'e3', score: 20 },
      ]);
      prisma.bidEvaluationResult.deleteMany.mockResolvedValue({});
      prisma.bidEvaluationResult.createMany.mockResolvedValue({});
      prisma.bidSupervisionLog.create.mockResolvedValue({});
      prisma.bidEvaluationResult.findMany.mockResolvedValue([]);

      await service.generateEvaluationResults('p1');

      const created = (prisma.bidEvaluationResult.createMany.mock.calls[0][0] as any).data[0];
      expect(created.disqualified).toBe(false);
    });
  });

  describe('archiveAll', () => {
    it('auto-creates standard archive items when none exist', async () => {
      prisma.bidProject.findUnique.mockResolvedValue({ stage: 'EVALUATING', name: '测试项目' });
      // ensureArchiveItems: findMany returns empty → create each missing
      prisma.bidArchiveItem.findMany
        .mockResolvedValueOnce([]) // first call inside ensureArchiveItems (tx)
        .mockResolvedValueOnce([{ id: 'a1', status: 'PENDING_CONFIRM' }]); // second call inside tx for non-archived items
      prisma.bidArchiveItem.create.mockResolvedValue({});
      prisma.bidArchiveItem.update.mockResolvedValue({ hashDigest: 'sha256:abc' });
      prisma.bidProject.update.mockResolvedValue({ id: 'p1', stage: 'ARCHIVED' });
      prisma.bidSupervisionLog.create.mockResolvedValue({});
      prisma.bidSupplier.findMany.mockResolvedValue([]); // G5: 无可评供应商
      prisma.bidEvaluationResult.count.mockResolvedValue(0);
      // $transaction callback-based mock already in beforeEach

      const result = await service.archiveAll('p1');

      expect(prisma.bidArchiveItem.create).toHaveBeenCalled();
      expect(prisma.bidArchiveItem.create.mock.calls.length).toBeGreaterThanOrEqual(7);
    });

    it('uses transaction for atomic archive + stage update + supervision log', async () => {
      prisma.bidProject.findUnique
        .mockResolvedValueOnce({ id: 'p1', projectCode: 'BID-TEST', stage: 'EVALUATING', name: '测试项目' })
        // Final findUnique returns archived project
        .mockResolvedValueOnce({ id: 'p1', stage: 'ARCHIVED', archiveItems: [] });
      // ensureArchiveItems: items already exist
      prisma.bidArchiveItem.findMany
        .mockResolvedValueOnce([]) // ensureArchiveItems findMany
        .mockResolvedValueOnce([{ id: 'a1', status: 'PENDING_CONFIRM' }]); // non-archived items query
      prisma.bidArchiveItem.findFirst.mockResolvedValue({ id: 'a1', projectId: 'p1' });
      prisma.bidSupplier.findMany.mockResolvedValue([]); // G5: 无可评供应商
      prisma.bidEvaluationResult.count.mockResolvedValue(0);
      prisma.bidArchiveItem.update.mockResolvedValue({ hashDigest: 'sha256:abc' });
      prisma.bidProject.update.mockResolvedValue({ id: 'p1', stage: 'ARCHIVED' });
      prisma.bidSupervisionLog.create.mockResolvedValue({});

      const result = await service.archiveAll('p1');

      // Verify the key atomic operations happened
      expect(prisma.bidArchiveItem.update).toHaveBeenCalled();
      expect(prisma.bidProject.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'p1' }, data: { stage: 'ARCHIVED' } }),
      );
      expect(prisma.bidSupervisionLog.create).toHaveBeenCalled();
    });

    it('rejects if not in EVALUATING', async () => {
      prisma.bidProject.findUnique.mockResolvedValue({ stage: 'OPENING', name: '测试项目' });

      await expect(service.archiveAll('p1')).rejects.toThrow(ConflictException);
    });

    it('blocks archive when confirmable suppliers exist but no evaluation results (防跳过评标)', async () => {
      prisma.bidProject.findUnique.mockResolvedValue({ id: 'p1', stage: 'EVALUATING', name: '测试项目' });
      // R1: confirmableCount 现在由 findMany.length 推导，故 mock 两元素数组替代 count(2)
      prisma.bidSupplier.findMany.mockResolvedValue([
        { id: 'bs1', supplierName: '甲' },
        { id: 'bs2', supplierName: '乙' },
      ]);
      prisma.bidEvaluationResult.count.mockResolvedValue(0); // 但未生成评标结果

      await expect(service.archiveAll('p1')).rejects.toThrow(ConflictException);
      // 不应进入归档流程
      expect(prisma.bidProject.update).not.toHaveBeenCalled();
    });

    it('allows archive when results already generated', async () => {
      prisma.bidProject.findUnique
        .mockResolvedValueOnce({ id: 'p1', projectCode: 'BID-TEST', stage: 'EVALUATING', name: '测试项目' })
        .mockResolvedValueOnce({ id: 'p1', stage: 'ARCHIVED', archiveItems: [] });
      prisma.bidEvaluationResult.count.mockResolvedValue(2); // 已生成结果
      // G5: 可评供应商均有对应开标记录
      prisma.bidSupplier.findMany.mockResolvedValue([
        { id: 'bs1', supplierName: '甲' },
        { id: 'bs2', supplierName: '乙' },
      ]);
      prisma.bidOpeningRecord.findMany.mockResolvedValue([
        { bidSupplierId: 'bs1' },
        { bidSupplierId: 'bs2' },
      ]);
      prisma.bidArchiveItem.findMany
        .mockResolvedValueOnce([]) // ensureArchiveItems
        .mockResolvedValueOnce([{ id: 'a1', status: 'PENDING_CONFIRM' }]); // non-archived
      prisma.bidArchiveItem.update.mockResolvedValue({ hashDigest: 'sha256:abc' });
      prisma.bidProject.update.mockResolvedValue({ id: 'p1', stage: 'ARCHIVED' });
      prisma.bidSupervisionLog.create.mockResolvedValue({});

      await expect(service.archiveAll('p1')).resolves.toBeDefined();
    });
  });

  describe('BidService.archiveAll — 开标记录补录校验 (G5)', () => {
    beforeEach(() => {
      prisma.bidProject.findUnique.mockResolvedValue({ id: 'p1', projectCode: 'BID-1', stage: 'EVALUATING', name: '项目' });
      prisma.bidEvaluationResult.count.mockResolvedValue(1); // 已有结果，绕过既有 EVALUATION_RESULTS_REQUIRED
    });

    it('SUCCESS+CONFIRMED 供应商缺开标记录时拒绝', async () => {
      prisma.bidSupplier.findMany.mockResolvedValue([
        { id: 'bs1', supplierName: '甲', decryptStatus: 'SUCCESS', confirmStatus: 'CONFIRMED', submitStatus: '已提交' },
      ]);
      prisma.bidOpeningRecord.findMany.mockResolvedValue([]); // 无开标记录
      await expect(service.archiveAll('p1', 'u1')).rejects.toMatchObject({
        response: { code: 'OPENING_RECORDS_MISSING' },
      });
    });
  });

  describe('getArchiveSummary', () => {
    it('单次聚合返回归档率（项目查询 + 归档 groupBy 各 1 次，无 N+1）', async () => {
      prisma.bidProject.findMany.mockResolvedValue([
        { id: 'p1', projectCode: 'BID-001', name: '项目一', createdAt: new Date('2026-01-01'), _count: { archiveItems: 5 } },
        { id: 'p2', projectCode: 'BID-002', name: '项目二', createdAt: new Date('2026-02-01'), _count: { archiveItems: 4 } },
      ]);
      prisma.bidArchiveItem.groupBy.mockResolvedValue([
        { projectId: 'p1', _count: { projectId: 5 }, _max: { archivedAt: new Date('2026-03-01') } },
        { projectId: 'p2', _count: { projectId: 3 }, _max: { archivedAt: new Date('2026-03-02') } },
      ]);

      const result = await service.getArchiveSummary();

      expect(result).toEqual([
        { id: 'p1', projectCode: 'BID-001', name: '项目一', totalItems: 5, archivedItems: 5, completionRate: 100, lastArchivedAt: new Date('2026-03-01'), createdAt: new Date('2026-01-01') },
        { id: 'p2', projectCode: 'BID-002', name: '项目二', totalItems: 4, archivedItems: 3, completionRate: 75, lastArchivedAt: new Date('2026-03-02'), createdAt: new Date('2026-02-01') },
      ]);
      expect(prisma.bidProject.findMany).toHaveBeenCalledTimes(1);
      expect(prisma.bidArchiveItem.groupBy).toHaveBeenCalledTimes(1);
    });

    it('无归档项目时返回空数组且不查询归档项', async () => {
      prisma.bidProject.findMany.mockResolvedValue([]);
      const result = await service.getArchiveSummary();
      expect(result).toEqual([]);
      expect(prisma.bidArchiveItem.groupBy).not.toHaveBeenCalled();
    });

    it('归档项缺失时归档率记 0', async () => {
      prisma.bidProject.findMany.mockResolvedValue([
        { id: 'p1', projectCode: 'BID-001', name: '项目一', createdAt: new Date('2026-01-01'), _count: { archiveItems: 3 } },
      ]);
      prisma.bidArchiveItem.groupBy.mockResolvedValue([]); // 该项目无 ARCHIVED 项

      const result = await service.getArchiveSummary();
      expect(result[0]).toMatchObject({ totalItems: 3, archivedItems: 0, completionRate: 0, lastArchivedAt: null });
    });
  });

  describe('submitScore', () => {
    it('validates expert belongs to project', async () => {
      prisma.bidProject.findUnique.mockResolvedValue({ stage: 'EVALUATING' });
      prisma.bidExpert.findFirst.mockResolvedValue(null); // expert not in project

      await expect(service.submitScore('p1', {
        expertId: 'exp-999', scoreItemId: 'si-1', supplierId: 'sup-1', score: 10,
      })).rejects.toThrow(BadRequestException);
    });

    it('validates scoreItem belongs to project', async () => {
      prisma.bidProject.findUnique.mockResolvedValue({ stage: 'EVALUATING' });
      prisma.bidExpert.findFirst.mockResolvedValue({ id: 'exp-1' });
      prisma.bidScoreItem.findFirst.mockResolvedValue(null); // scoreItem not in project

      await expect(service.submitScore('p1', {
        expertId: 'exp-1', scoreItemId: 'si-999', supplierId: 'sup-1', score: 10,
      })).rejects.toThrow(BadRequestException);
    });

    it('upserts score record on valid input', async () => {
      prisma.bidProject.findUnique.mockResolvedValue({ stage: 'EVALUATING' });
      prisma.bidExpert.findFirst.mockResolvedValue({ id: 'exp-1' });
      prisma.bidScoreItem.findFirst.mockResolvedValue({ id: 'si-1' });
      prisma.bidSupplier.findFirst.mockResolvedValue({ id: 'sup-1' });
      prisma.bidScoreRecord.upsert.mockResolvedValue({ id: 'sr-1', score: 10 });

      const result = await service.submitScore('p1', {
        expertId: 'exp-1', scoreItemId: 'si-1', supplierId: 'sup-1', score: 10, reason: 'good',
      });

      expect(prisma.bidScoreRecord.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { expertId_scoreItemId_supplierId: { expertId: 'exp-1', scoreItemId: 'si-1', supplierId: 'sup-1' } },
          update: { score: 10, reason: 'good' },
          create: expect.objectContaining({ expertId: 'exp-1', scoreItemId: 'si-1', supplierId: 'sup-1', score: 10, reason: 'good' }),
        }),
      );
    });
  });

  describe('startEvaluation', () => {
    it('transitions OPENING → EVALUATING and writes supervision log', async () => {
      prisma.bidProject.findUnique.mockResolvedValue({ stage: 'OPENING', name: '测试项目' });
      prisma.bidProject.update.mockResolvedValue({ id: 'p1', stage: 'EVALUATING' });
      prisma.bidSupervisionLog.create.mockResolvedValue({});
      prisma.bidSupplier.findMany.mockResolvedValue([]);

      const result = await service.startEvaluation('p1');
      expect(result.stage).toBe('EVALUATING');
      expect(prisma.bidSupervisionLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ action: '启动评标 (OPENING→EVALUATING)' }),
        }),
      );
    });
  });

  describe('BidService.startEvaluation — 前置校验 (G4/G9)', () => {
    beforeEach(() => {
      prisma.bidProject.findUnique.mockResolvedValue({ stage: 'OPENING', name: '测试项目' });
      prisma.bidExpert.count.mockResolvedValue(3);
      prisma.bidSupplier.findMany.mockResolvedValue([]);
    });

    it('G4: 无解密成功的有效供应商时拒绝', async () => {
      prisma.bidSupplier.count.mockResolvedValue(0);
      prisma.bidScoreItem.count.mockResolvedValue(5);
      await expect(service.startEvaluation('p1', 'u1')).rejects.toMatchObject({
        response: { code: 'NO_EVALUABLE_SUPPLIERS' },
      });
    });

    it('G9: 未编制评分标准时拒绝', async () => {
      prisma.bidSupplier.count.mockResolvedValue(2);
      prisma.bidScoreItem.count.mockResolvedValue(0);
      await expect(service.startEvaluation('p1', 'u1')).rejects.toMatchObject({
        response: { code: 'NO_SCORE_ITEMS' },
      });
    });

    it('专家/供应商/评分项齐备时不抛前置异常', async () => {
      prisma.bidSupplier.count.mockResolvedValue(2);
      prisma.bidScoreItem.count.mockResolvedValue(5);
      prisma.bidProject.update.mockResolvedValue({ stage: 'EVALUATING' });
      prisma.bidSupervisionLog.create.mockResolvedValue({});
      prisma.auditLog.create.mockResolvedValue({});
      await expect(service.startEvaluation('p1', 'u1')).resolves.toMatchObject({ stage: 'EVALUATING' });
    });
  });

  describe('decryptSupplier', () => {
    it('writes supervision log on successful decrypt', async () => {
      // Setup this.prisma mocks (used outside tx callback for submission lookup)
      prisma.supplierBidSubmission = {
        findUnique: jest.fn().mockResolvedValue({
          technicalFileAssetId: 'fa1', businessFileAssetId: null, coverLetterAssetId: null,
          technicalSealedKey: null, businessSealedKey: null, coverLetterSealedKey: null,
        }),
      };
      prisma.fileAsset = {
        findUnique: jest.fn().mockResolvedValue({ id: 'fa1', key: 'uploads/test.pdf', sha256: 'abc123' }),
      };

      const logCreate = jest.fn().mockResolvedValue({});
      prisma.$transaction = jest.fn(async (fn: any) => {
        const tx = {
          bidProject: { findUnique: jest.fn().mockResolvedValue({ stage: 'OPENING' }) },
          bidSupplier: {
            findFirst: jest.fn().mockResolvedValue({ id: 'bs-1', supplierName: '供应商A', supplierId: 's1', decryptStatus: 'PENDING' }),
            update: jest.fn().mockResolvedValue({ id: 'bs-1', decryptStatus: 'SUCCESS', confirmStatus: 'PENDING' }),
            findUnique: jest.fn().mockResolvedValue({ id: 'bs-1', decryptStatus: 'SUCCESS', confirmStatus: 'PENDING' }),
          },
          bidOpeningRecord: { create: jest.fn().mockResolvedValue({}) },
          bidSupervisionLog: { create: logCreate },
          bidOpeningSession: { findUnique: jest.fn().mockResolvedValue({ decryptWindowStart: new Date(Date.now() - 3600_000), decryptWindowEnd: new Date(Date.now() + 3600_000) }) },
          supplierBidSubmission: { findUnique: jest.fn().mockResolvedValue(null) },
          fileAsset: { findUnique: jest.fn() },
          auditLog: { create: jest.fn().mockResolvedValue({}) },
        };
        return fn(tx);
      });

      const result = await service.decryptSupplier('p1', 'bs-1');

      // No file references → DANGER with 高风险 (correct behavior after Phase 1 fix)
      expect(logCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ action: '标书解密', riskFlag: '高风险' }),
        }),
      );
      expect(result).toBeDefined();
    });
  });

  // 注：原 submitBid（管理员代投）已移除——真实投标统一走供应商门户
  // /api/supplier-portal/bid-submissions/:projectId/submit（见 supplier-portal.service.spec.ts）。
});

/* ── 集成测试：decryptSupplier 真实校验（无文件引用 → SUCCESS，保持开标流程不空指针）── */

describe('BidService — decryptSupplier 真实校验', () => {
  it('无投标文件引用时仍返回 SUCCESS（保持开标流程）', async () => {
    const tx: any = {
      bidProject: { findUnique: jest.fn(async () => ({ stage: 'OPENING' })) },
      bidSupplier: {
        findFirst: jest.fn(async () => ({ id: 'bs1', projectId: 'p1', supplierName: 'S1' })),
        update: jest.fn(async ({ data }: any) => ({
          id: 'bs1', supplierName: 'S1',
          decryptStatus: data.decryptStatus ?? 'SUCCESS',
          confirmStatus: 'PENDING',
        })),
        findUnique: jest.fn(async () => ({ id: 'bs1', supplierName: 'S1', decryptStatus: 'SUCCESS' })),
      },
      bidOpeningRecord: { create: jest.fn() },
      bidSupervisionLog: { create: jest.fn() },
      bidOpeningSession: { findUnique: jest.fn(async () => ({ decryptWindowStart: new Date(Date.now() - 3600_000), decryptWindowEnd: new Date(Date.now() + 3600_000) })) },
      supplierBidSubmission: { findUnique: jest.fn(async () => null) },
      fileAsset: { findUnique: jest.fn() },
      auditLog: { create: jest.fn(async () => ({})) },
    };
    const prisma: any = { $transaction: jest.fn(async (cb: any) => cb(tx)) };
    const module = await Test.createTestingModule({
      providers: [
        { provide: PrismaService, useValue: prisma },
        { provide: NotificationService, useValue: { create: jest.fn() } },
        { provide: BidGateway, useValue: { notifyDecryptStatus: jest.fn(), notifyStageChange: jest.fn(), notifyAnomaly: jest.fn(), notifySupervisionLog: jest.fn(), notifySubmissionOpened: jest.fn(), notifyOpeningStarted: jest.fn(), notifyEvaluationStarted: jest.fn(), broadcastAggregatePresence: jest.fn() } },
        BidService,
      ],
    }).compile();
    const service = module.get(BidService);

    const res = await service.decryptSupplier('p1', 'bs1');
    expect(res).not.toBeNull();
    expect(res!.decryptStatus).toBe('SUCCESS');
    expect(tx.bidSupplier.update).toHaveBeenCalled();
    expect(tx.bidSupervisionLog.create).toHaveBeenCalled();
  });
});

/* ── 评分标准编制：阶段门控 + 模板幂等 ── */

describe('BidService — score items (评分标准)', () => {
  let service: BidService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      bidProject: { findUnique: jest.fn() },
      bidScoreItem: { findMany: jest.fn(), findFirst: jest.fn(), create: jest.fn(), update: jest.fn(), delete: jest.fn(), createMany: jest.fn() },
      bidSupervisionLog: { create: jest.fn() },
      $transaction: jest.fn(async (cb: any) => cb(prisma)),
    };
    const module = await Test.createTestingModule({
      providers: [
        { provide: PrismaService, useValue: prisma },
        { provide: NotificationService, useValue: { create: jest.fn() } },
        BidService,
      ],
    }).compile();
    service = module.get(BidService);
  });

  it('listScoreItems 直接返回 findMany 结果', async () => {
    prisma.bidScoreItem.findMany.mockResolvedValue([{ id: 'i1', category: 'TECHNICAL', name: '技术', maxScore: 50 }]);
    const res = await service.listScoreItems('p1');
    expect(res).toHaveLength(1);
    expect(prisma.bidScoreItem.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { projectId: 'p1' } }));
  });

  it('createScoreItem 在 SUBMIT 阶段放行并写监督日志', async () => {
    prisma.bidProject.findUnique.mockResolvedValue({ stage: 'SUBMIT', name: '项目A' });
    prisma.bidScoreItem.create.mockResolvedValue({ id: 'i1', name: '技术评分' });

    const res = await service.createScoreItem('p1', { category: 'TECHNICAL' as any, name: '技术评分', maxScore: 50 });
    expect(res.id).toBe('i1');
    expect(prisma.bidScoreItem.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ projectId: 'p1', category: 'TECHNICAL', name: '技术评分', maxScore: 50 }),
    }));
    expect(prisma.bidSupervisionLog.create).toHaveBeenCalled();
  });

  it('createScoreItem 在 OPENING 阶段仍可编辑（评标前最后窗口）', async () => {
    prisma.bidProject.findUnique.mockResolvedValue({ stage: 'OPENING', name: '项目A' });
    prisma.bidScoreItem.create.mockResolvedValue({ id: 'i1' });
    await expect(service.createScoreItem('p1', { category: 'PRICE' as any, name: '价格', maxScore: 30 })).resolves.toBeDefined();
  });

  it('createScoreItem 在 EVALUATING 阶段锁定抛 ConflictException', async () => {
    prisma.bidProject.findUnique.mockResolvedValue({ stage: 'EVALUATING', name: '项目A' });
    await expect(service.createScoreItem('p1', { category: 'PRICE' as any, name: '价格', maxScore: 30 }))
      .rejects.toThrow(ConflictException);
    expect(prisma.bidScoreItem.create).not.toHaveBeenCalled();
  });

  it('createScoreItem 在 ARCHIVED 阶段锁定抛 ConflictException', async () => {
    prisma.bidProject.findUnique.mockResolvedValue({ stage: 'ARCHIVED', name: '项目A' });
    await expect(service.createScoreItem('p1', { category: 'PRICE' as any, name: '价格', maxScore: 30 }))
      .rejects.toThrow(ConflictException);
  });

  it('createScoreItem 项目不存在抛 BadRequestException', async () => {
    prisma.bidProject.findUnique.mockResolvedValue(null);
    await expect(service.createScoreItem('p1', { category: 'PRICE' as any, name: '价格', maxScore: 30 }))
      .rejects.toThrow(BadRequestException);
  });

  it('updateScoreItem 校验评分项归属本项目', async () => {
    prisma.bidProject.findUnique.mockResolvedValue({ stage: 'SUBMIT' });
    prisma.bidScoreItem.findFirst.mockResolvedValue(null); // 不属于本项目
    await expect(service.updateScoreItem('p1', 'iX', { name: '改名' })).rejects.toThrow(BadRequestException);
  });

  it('deleteScoreItem 仅在编辑窗口内放行', async () => {
    prisma.bidProject.findUnique.mockResolvedValue({ stage: 'EVALUATING', name: '项目A' });
    await expect(service.deleteScoreItem('p1', 'i1')).rejects.toThrow(ConflictException);
  });

  it('applyScoreItemTemplate 幂等：仅补齐缺失项', async () => {
    prisma.bidProject.findUnique.mockResolvedValue({ stage: 'SUBMIT', name: '项目A' });
    // 已存在「资格性审查」一项
    prisma.bidScoreItem.findMany
      .mockResolvedValueOnce([{ name: '资格性审查' }])              // 去重查询
      .mockResolvedValue([{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }, { id: 'e' }]); // 模板应用后回读

    await service.applyScoreItemTemplate('p1');
    // 5 项模板中已有 1 项，应仅创建 4 项
    expect(prisma.bidScoreItem.createMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.arrayContaining([expect.objectContaining({ name: '技术评分', maxScore: 50 })]),
    }));
    expect((prisma.bidScoreItem.createMany.mock.calls[0][0] as any).data).toHaveLength(4);
    expect(prisma.bidSupervisionLog.create).toHaveBeenCalled();
  });

  it('applyScoreItemTemplate 全部已存在时不重复创建', async () => {
    prisma.bidProject.findUnique.mockResolvedValue({ stage: 'SUBMIT', name: '项目A' });
    prisma.bidScoreItem.findMany.mockResolvedValue([
      { name: '资格性审查' }, { name: '符合性审查' }, { name: '商务评分' }, { name: '技术评分' }, { name: '价格评分' },
    ]);
    await service.applyScoreItemTemplate('p1');
    expect(prisma.bidScoreItem.createMany).not.toHaveBeenCalled();
  });

  it('applyScoreItemTemplate 在 EVALUATING 阶段锁定', async () => {
    prisma.bidProject.findUnique.mockResolvedValue({ stage: 'EVALUATING', name: '项目A' });
    await expect(service.applyScoreItemTemplate('p1')).rejects.toThrow(ConflictException);
  });
});

/* ── 唱标信息录入（修复开标闭环断链）── */

describe('BidService — enterOpeningRecord (唱标录入)', () => {
  let service: BidService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      bidProject: { findUnique: jest.fn() },
      bidSupplier: { findFirst: jest.fn() },
      bidOpeningRecord: { findFirst: jest.fn(), create: jest.fn(), update: jest.fn() },
      bidSupervisionLog: { create: jest.fn() },
      $transaction: jest.fn(async (cb: any) => cb(prisma)),
    };
    const module = await Test.createTestingModule({
      providers: [
        { provide: PrismaService, useValue: prisma },
        { provide: NotificationService, useValue: { create: jest.fn() } },
        BidService,
      ],
    }).compile();
    service = module.get(BidService);
  });

  const dto = { bidSupplierId: 'bs1', amount: '980000', period: '180天', qualityTarget: '合格', bondStatus: '已缴纳' };

  it('OPENING 阶段 + 已解密成功 → 新建开标记录（待供应商确认）并写日志', async () => {
    prisma.bidProject.findUnique.mockResolvedValue({ stage: 'OPENING', name: '项目A' });
    prisma.bidSupplier.findFirst.mockResolvedValue({ id: 'bs1', supplierName: '甲公司', decryptStatus: 'SUCCESS' });
    prisma.bidOpeningRecord.findFirst.mockResolvedValue(null);
    prisma.bidOpeningRecord.create.mockResolvedValue({ id: 'r1', confirmStatus: '待供应商确认' });

    const res = await service.enterOpeningRecord('p1', dto as any);
    expect(res.confirmStatus).toBe('待供应商确认');
    expect(prisma.bidOpeningRecord.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ projectId: 'p1', bidSupplierId: 'bs1', amount: '980000', confirmStatus: '待供应商确认' }),
    }));
    expect(prisma.bidSupervisionLog.create).toHaveBeenCalled();
  });

  it('已存在记录时按 bidSupplierId 幂等更新', async () => {
    prisma.bidProject.findUnique.mockResolvedValue({ stage: 'OPENING', name: '项目A' });
    prisma.bidSupplier.findFirst.mockResolvedValue({ id: 'bs1', supplierName: '甲公司', decryptStatus: 'SUCCESS' });
    prisma.bidOpeningRecord.findFirst.mockResolvedValue({ id: 'r1' });
    prisma.bidOpeningRecord.update.mockResolvedValue({ id: 'r1', amount: '980000' });

    await service.enterOpeningRecord('p1', dto as any);
    expect(prisma.bidOpeningRecord.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'r1' } }));
    expect(prisma.bidOpeningRecord.create).not.toHaveBeenCalled();
  });

  it('非 OPENING 阶段拒绝', async () => {
    prisma.bidProject.findUnique.mockResolvedValue({ stage: 'SUBMIT', name: '项目A' });
    await expect(service.enterOpeningRecord('p1', dto as any)).rejects.toThrow(BadRequestException);
  });

  it('未解密成功拒绝录入唱标信息', async () => {
    prisma.bidProject.findUnique.mockResolvedValue({ stage: 'OPENING', name: '项目A' });
    prisma.bidSupplier.findFirst.mockResolvedValue({ id: 'bs1', supplierName: '甲公司', decryptStatus: 'PENDING' });
    await expect(service.enterOpeningRecord('p1', dto as any)).rejects.toThrow(BadRequestException);
  });

  it('投标记录不存在拒绝', async () => {
    prisma.bidProject.findUnique.mockResolvedValue({ stage: 'OPENING', name: '项目A' });
    prisma.bidSupplier.findFirst.mockResolvedValue(null);
    await expect(service.enterOpeningRecord('p1', dto as any)).rejects.toThrow(BadRequestException);
  });
});

/* ── 催办（nudge）：站内信 + Email 多通道，按门控过滤参与者 ── */

describe('BidService — nudge (催办)', () => {
  let service: BidService;
  let prisma: any;
  let notifyCreate: jest.Mock;

  beforeEach(async () => {
    notifyCreate = jest.fn().mockImplementation(({ userId }: any) =>
      Promise.resolve({ id: `n-${userId}`, userId }),
    );
    prisma = {
      bidProject: { findUnique: jest.fn() },
      bidSupplier: { findMany: jest.fn() },
      supplierBidSubmission: { findMany: jest.fn() },
      bidExpert: { findMany: jest.fn() },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
    };
    const module = await Test.createTestingModule({
      providers: [
        { provide: PrismaService, useValue: prisma },
        { provide: NotificationService, useValue: { create: notifyCreate } },
        BidService,
      ],
    }).compile();
    service = module.get(BidService);
  });

  describe('nudgeSuppliers', () => {
    beforeEach(() => {
      prisma.bidProject.findUnique.mockResolvedValue({ id: 'p1', projectCode: 'BID-001', name: '水库项目' });
      prisma.bidSupplier.findMany.mockResolvedValue([
        { supplierId: 's1', submitStatus: '已提交', supplier: { userId: 'u-sup-a' } },
        { supplierId: 's2', submitStatus: '待提交', supplier: { userId: 'u-sup-b' } },
        { supplierId: 's3', submitStatus: '待提交', supplier: { userId: 'u-sup-c' } },
      ]);
      // s1 已提交；s2/s3 未提交
      prisma.supplierBidSubmission.findMany.mockResolvedValue([
        { supplierId: 's1', status: 'submitted' },
      ]);
    });

    it('onlyUnsubmitted=true 时仅催未提交者（2/3），返回 reached=2', async () => {
      const res = await service.nudgeSuppliers('p1', true, 'actor-1');
      expect(res.reached).toBe(2);
      expect(notifyCreate).toHaveBeenCalledTimes(2);
      const notified = notifyCreate.mock.calls.map((c: any[]) => c[0].userId);
      expect(notified.sort()).toEqual(['u-sup-b', 'u-sup-c']);
    });

    it('onlyUnsubmitted=false 时催全部（3/3）', async () => {
      const res = await service.nudgeSuppliers('p1', false, 'actor-1');
      expect(res.reached).toBe(3);
      expect(notifyCreate).toHaveBeenCalledTimes(3);
    });

    it('跳过无关联供应商的 roster 项（supplierId=null）', async () => {
      prisma.bidSupplier.findMany.mockResolvedValue([
        { supplierId: null, submitStatus: '待提交', supplier: null },
        { supplierId: 's2', submitStatus: '待提交', supplier: { userId: 'u-sup-b' } },
      ]);
      const res = await service.nudgeSuppliers('p1', true, 'actor-1');
      expect(res.reached).toBe(1);
    });

    it('对去重后的 userId 各发一条（同一 userId 多 roster 不重复）', async () => {
      prisma.bidSupplier.findMany.mockResolvedValue([
        { supplierId: 'sX', submitStatus: '待提交', supplier: { userId: 'u-dup' } },
        { supplierId: 'sY', submitStatus: '待提交', supplier: { userId: 'u-dup' } },
      ]);
      const res = await service.nudgeSuppliers('p1', true, 'actor-1');
      expect(res.reached).toBe(1);
      expect(notifyCreate).toHaveBeenCalledTimes(1);
    });

    it('写一条 BID_NUDGE_SUPPLIERS 审计日志（含 reached）', async () => {
      await service.nudgeSuppliers('p1', true, 'actor-1');
      expect(prisma.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({
          userId: 'actor-1',
          action: 'BID_NUDGE_SUPPLIERS',
          resourceType: 'BID-001',
          details: expect.objectContaining({ reached: 2 }),
        }),
      }));
    });

    it('项目不存在抛 BadRequestException', async () => {
      prisma.bidProject.findUnique.mockResolvedValue(null);
      await expect(service.nudgeSuppliers('p1', true, 'actor-1')).rejects.toThrow(BadRequestException);
    });
  });

  describe('nudgeExperts', () => {
    beforeEach(() => {
      prisma.bidProject.findUnique.mockResolvedValue({ id: 'p1', projectCode: 'BID-001', name: '水库项目' });
      prisma.bidExpert.findMany.mockResolvedValue([
        { userId: 'u-exp-a', signedIn: true, progress: 100 },
        { userId: 'u-exp-b', signedIn: false, progress: 50 },
        { userId: 'u-exp-c', signedIn: true, progress: 80 },
      ]);
    });

    it("reason='signin' 仅催未签到者（u-exp-b），reached=1", async () => {
      const res = await service.nudgeExperts('p1', 'signin', 'actor-1');
      expect(res.reached).toBe(1);
      const notified = notifyCreate.mock.calls.map((c: any[]) => c[0].userId);
      expect(notified).toEqual(['u-exp-b']);
    });

    it("reason='score' 仅催 progress<100 者（u-exp-b, u-exp-c），reached=2", async () => {
      const res = await service.nudgeExperts('p1', 'score', 'actor-1');
      expect(res.reached).toBe(2);
      const notified = notifyCreate.mock.calls.map((c: any[]) => c[0].userId).sort();
      expect(notified).toEqual(['u-exp-b', 'u-exp-c']);
    });

    it('写一条 BID_NUDGE_EXPERTS 审计日志（含 reason 与 reached）', async () => {
      await service.nudgeExperts('p1', 'signin', 'actor-1');
      expect(prisma.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({
          userId: 'actor-1',
          action: 'BID_NUDGE_EXPERTS',
          resourceType: 'BID-001',
          details: expect.objectContaining({ reached: 1, reason: 'signin' }),
        }),
      }));
    });

    it('项目不存在抛 BadRequestException', async () => {
      prisma.bidProject.findUnique.mockResolvedValue(null);
      await expect(service.nudgeExperts('p1', 'signin', 'actor-1')).rejects.toThrow(BadRequestException);
    });
  });
});

/* ── 邀请供应商（inviteSuppliers）：填充 BidSupplier 名册 ── */

describe('BidService — inviteSuppliers (邀请供应商)', () => {
  let service: BidService;
  let prisma: any;
  let notifyCreate: jest.Mock;

  beforeEach(async () => {
    notifyCreate = jest.fn().mockImplementation(({ userId }: any) => Promise.resolve({ id: `n-${userId}`, userId }));
    prisma = {
      bidProject: { findUnique: jest.fn() },
      supplier: { findMany: jest.fn() },
      bidSupplier: { findMany: jest.fn(), createMany: jest.fn().mockResolvedValue({ count: 0 }) },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
    };
    // 默认：项目在 DOWNLOAD，两个 APPROVED 供应商，名册为空
    prisma.bidProject.findUnique.mockResolvedValue({ id: 'p1', projectCode: 'BID-001', name: '水库项目', stage: 'DOWNLOAD' });
    prisma.supplier.findMany.mockResolvedValue([
      { id: 's1', name: '甲公司', userId: 'u-a' },
      { id: 's2', name: '乙公司', userId: 'u-b' },
    ]);
    prisma.bidSupplier.findMany.mockResolvedValue([]);

    const module = await Test.createTestingModule({
      providers: [
        { provide: PrismaService, useValue: prisma },
        { provide: NotificationService, useValue: { create: notifyCreate } },
        BidService,
      ],
    }).compile();
    service = module.get(BidService);
  });

  it('为每个已入库且未在名册的供应商建 BidSupplier，返回 added=2', async () => {
    const res = await service.inviteSuppliers('p1', ['s1', 's2'], 'actor-1');
    expect(res.added).toBe(2);
    expect(res.skipped).toBe(0);
    expect(prisma.bidSupplier.createMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.arrayContaining([
        expect.objectContaining({ projectId: 'p1', supplierId: 's1', supplierName: '甲公司' }),
        expect.objectContaining({ projectId: 'p1', supplierId: 's2', supplierName: '乙公司' }),
      ]),
    }));
  });

  it('已在名册的供应商跳过（计入 skipped，幂等）', async () => {
    prisma.bidSupplier.findMany.mockResolvedValue([{ supplierId: 's1' }]); // s1 已邀请
    const res = await service.inviteSuppliers('p1', ['s1', 's2'], 'actor-1');
    expect(res.added).toBe(1);
    expect(res.skipped).toBe(1);
    const created = prisma.bidSupplier.createMany.mock.calls[0][0].data as any[];
    expect(created.find((r: any) => r.supplierId === 's1')).toBeUndefined();
    expect(created.find((r: any) => r.supplierId === 's2')).toBeDefined();
  });

  it('非 APPROVED 的 supplierId 计入 skipped（不建名册）', async () => {
    // supplier.findMany 只返回 s1（s3 未入库/未审批）
    prisma.supplier.findMany.mockResolvedValue([{ id: 's1', name: '甲公司', userId: 'u-a' }]);
    const res = await service.inviteSuppliers('p1', ['s1', 's3'], 'actor-1');
    expect(res.added).toBe(1);
    expect(res.skipped).toBe(1);
  });

  it('对入参去重（同 id 传两次不重复建）', async () => {
    const res = await service.inviteSuppliers('p1', ['s1', 's1', 's2'], 'actor-1');
    expect(res.added).toBe(2);
  });

  it('给每位被邀供应商发邀请通知（type=BID_INVITED）', async () => {
    await service.inviteSuppliers('p1', ['s1', 's2'], 'actor-1');
    expect(notifyCreate).toHaveBeenCalledTimes(2);
    expect(notifyCreate.mock.calls.map((c: any[]) => c[0].userId).sort()).toEqual(['u-a', 'u-b']);
    expect(notifyCreate.mock.calls[0][0].type).toBe('BID_INVITED');
  });

  it('写一条 BID_INVITE_SUPPLIERS 审计日志（含 added/skipped）', async () => {
    await service.inviteSuppliers('p1', ['s1', 's2'], 'actor-1');
    expect(prisma.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        userId: 'actor-1', action: 'BID_INVITE_SUPPLIERS', resourceType: 'BID-001',
        details: expect.objectContaining({ added: 2, skipped: 0 }),
      }),
    }));
  });

  it('空 supplierIds 直接返回 0/0，不查不写', async () => {
    const res = await service.inviteSuppliers('p1', [], 'actor-1');
    expect(res).toEqual({ added: 0, skipped: 0 });
    expect(prisma.supplier.findMany).not.toHaveBeenCalled();
    expect(prisma.bidSupplier.createMany).not.toHaveBeenCalled();
  });

  it('项目不存在抛 BadRequestException', async () => {
    prisma.bidProject.findUnique.mockResolvedValue(null);
    await expect(service.inviteSuppliers('p1', ['s1'], 'actor-1')).rejects.toThrow(BadRequestException);
  });

  it('非 DOWNLOAD/SUBMIT 阶段抛 ConflictException（名册已锁）', async () => {
    prisma.bidProject.findUnique.mockResolvedValue({ id: 'p1', projectCode: 'BID-001', name: '水库项目', stage: 'OPENING' });
    await expect(service.inviteSuppliers('p1', ['s1'], 'actor-1')).rejects.toThrow(ConflictException);
  });
});

/* ── G1：归档后自动生成中标公示草稿 ── */
describe('BidService.archiveAll — 中标公示自动生成 (G1)', () => {
  let service: BidService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      bidProject: {
        findUnique: jest.fn(),
        update: jest.fn(),
        create: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
        groupBy: jest.fn(),
      },
      bidSupervisionLog: { findMany: jest.fn(), create: jest.fn() },
      bidExpert: { groupBy: jest.fn(), findFirst: jest.fn(), findMany: jest.fn(), count: jest.fn(), update: jest.fn() },
      bidScoreItem: { findFirst: jest.fn(), create: jest.fn(), delete: jest.fn(), count: jest.fn(), findMany: jest.fn().mockResolvedValue([]) },
      bidScoreRecord: { upsert: jest.fn(), findMany: jest.fn() },
      supplier: { count: jest.fn() },
      announcement: { count: jest.fn(), findFirst: jest.fn(), create: jest.fn() },
      bidSupplier: { findMany: jest.fn(), update: jest.fn(), create: jest.fn(), findFirst: jest.fn(), findUnique: jest.fn(), count: jest.fn() },
      bidOpeningRecord: { create: jest.fn(), findFirst: jest.fn(), update: jest.fn(), findUnique: jest.fn(), findMany: jest.fn() },
      bidEvaluationResult: { deleteMany: jest.fn(), createMany: jest.fn(), findMany: jest.fn(), count: jest.fn() },
      bidArchiveItem: { findMany: jest.fn(), updateMany: jest.fn(), update: jest.fn(), findFirst: jest.fn(), create: jest.fn(), groupBy: jest.fn() },
      supplierBidSubmission: { findUnique: jest.fn() },
      bidOpeningSession: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
      fileAsset: { findUnique: jest.fn() },
      notification: { create: jest.fn(), createMany: jest.fn() },
      user: { findMany: jest.fn() },
      auditLog: { create: jest.fn() },
      $transaction: jest.fn(async (callbackOrOps: any) => {
        if (typeof callbackOrOps === 'function') return callbackOrOps(prisma);
        return Promise.all(callbackOrOps);
      }),
    };

    // archiveAll 入口查询 / ensureWinnerNotice 内部查询共用 findUnique
    prisma.bidProject.findUnique.mockImplementation(({ where }: any) => {
      if (where?.id === 'p1') {
        return Promise.resolve({
          id: 'p1',
          projectCode: 'BID-1',
          stage: 'EVALUATING',
          name: '项目',
          evaluationResults: [
            { rank: 1, supplierName: '甲', totalScore: 90, averageScore: 30, recommended: true },
          ],
        });
      }
      return Promise.resolve(null);
    });
    prisma.bidEvaluationResult.count.mockResolvedValue(1);
    prisma.bidSupplier.findMany.mockResolvedValue([]); // 绕过 G5 OPENING_RECORDS_MISSING
    prisma.bidArchiveItem.findMany.mockResolvedValue([{ id: 'ai1', name: 'x', status: 'PENDING_CONFIRM' }]);
    prisma.bidArchiveItem.update.mockResolvedValue({});
    prisma.bidProject.update.mockResolvedValue({ stage: 'ARCHIVED' });
    prisma.bidSupervisionLog.create.mockResolvedValue({});
    prisma.auditLog.create.mockResolvedValue({});
    prisma.announcement.findFirst.mockResolvedValue(null); // 不存在
    prisma.announcement.create.mockResolvedValue({ id: 'wn1' });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BidService,
        { provide: PrismaService, useValue: prisma },
        { provide: NotificationService, useValue: { sendToRole: jest.fn() } },
      ],
    }).compile();
    service = module.get<BidService>(BidService);
  });

  it('归档后自动创建 WIN_NOTICE 草稿', async () => {
    await service.archiveAll('p1', 'u1');
    expect(prisma.announcement.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: 'WIN_NOTICE',
          status: 'DRAFT',
          relatedProjectCode: 'BID-1',
        }),
      }),
    );
  });

  it('已存在 WIN_NOTICE 时不重复创建（幂等）', async () => {
    prisma.announcement.findFirst.mockResolvedValue({ id: 'wn1' });
    await service.archiveAll('p1', 'u1');
    expect(prisma.announcement.create).not.toHaveBeenCalled();
  });

  it('中标公示创建失败时不阻塞归档', async () => {
    prisma.announcement.create.mockRejectedValue(new Error('DB down'));
    await expect(service.archiveAll('p1', 'u1')).resolves.toBeDefined();
  });
});


describe('BidService — createProject 字段写入', () => {
  let service: BidService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      bidProject: {
        create: jest.fn().mockResolvedValue({ id: 'p1', name: 'X', projectCode: 'BID-1' }),
      },
      notificationService: { sendToRole: jest.fn().mockResolvedValue(undefined) },
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BidService,
        { provide: PrismaService, useValue: prisma },
        { provide: NotificationService, useValue: { sendToRole: jest.fn() } },
        { provide: BidGateway, useValue: {} },
      ],
    }).compile();
    service = module.get(BidService);
  });

  it('createProject 写入 qualityRequirement / bondRequired / bondAmount', async () => {
    await service.createProject({
      name: '测试项目', procurementMethod: '公开招标',
      openTime: '2026-07-01T00:00:00.000Z', deadline: '2026-07-10T00:00:00.000Z',
      qualityRequirement: '合格', bondRequired: true, bondAmount: 200000,
    } as any);

    expect(prisma.bidProject.create).toHaveBeenCalledTimes(1);
    const arg = prisma.bidProject.create.mock.calls[0][0].data;
    expect(arg.qualityRequirement).toBe('合格');
    expect(arg.bondRequired).toBe(true);
    expect(Number(arg.bondAmount)).toBe(200000);
  });
});

describe('BidService — getOpeningRecordDraft', () => {
  let service: BidService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      bidProject: { findUnique: jest.fn() },
      bidSupplier: { findFirst: jest.fn() },
      supplierBidSubmission: { findUnique: jest.fn() },
      bidOpeningRecord: { findFirst: jest.fn() },
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BidService,
        { provide: PrismaService, useValue: prisma },
        { provide: NotificationService, useValue: { sendToRole: jest.fn() } },
        { provide: BidGateway, useValue: {} },
      ],
    }).compile();
    service = module.get(BidService);
  });

  it('OPENING 阶段且解密成功 → 返回预填数据', async () => {
    prisma.bidProject.findUnique.mockResolvedValue({ id: 'p1', stage: 'OPENING', qualityRequirement: '合格', bondRequired: true });
    prisma.bidSupplier.findFirst.mockResolvedValue({ id: 's1', supplierId: 'su1', decryptStatus: 'SUCCESS', supplierName: '甲' });
    prisma.supplierBidSubmission.findUnique.mockResolvedValue({ bidPrice: '980000', deliveryPeriod: '180天', bidBondAssetId: 'fa-1' });
    prisma.bidOpeningRecord.findFirst.mockResolvedValue({ bondStatus: '已缴纳' });

    const draft = await service.getOpeningRecordDraft('p1', 's1');
    expect(draft).toEqual({
      canView: true,
      amount: '980000',
      period: '180天',
      qualityTarget: '合格',
      bondStatus: '已缴纳',
      bidBondAssetId: 'fa-1',
    });
  });

  it('非 OPENING 阶段 → canView=false 且不抛异常', async () => {
    prisma.bidProject.findUnique.mockResolvedValue({ id: 'p1', stage: 'SUBMIT', qualityRequirement: null, bondRequired: false });
    const draft = await service.getOpeningRecordDraft('p1', 's1');
    expect(draft.canView).toBe(false);
    expect(draft.amount).toBeNull();
  });

  it('未解密成功 → canView=false', async () => {
    prisma.bidProject.findUnique.mockResolvedValue({ id: 'p1', stage: 'OPENING', qualityRequirement: null, bondRequired: false });
    prisma.bidSupplier.findFirst.mockResolvedValue({ id: 's1', decryptStatus: 'PENDING', supplierName: '甲' });
    const draft = await service.getOpeningRecordDraft('p1', 's1');
    expect(draft.canView).toBe(false);
  });
});

describe('BidService — generateEvaluationResults 保证金软标记', () => {
  let service: BidService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      bidProject: { findUnique: jest.fn() },
      bidScoreRecord: { findMany: jest.fn().mockResolvedValue([]) },
      bidScoreItem: { findMany: jest.fn().mockResolvedValue([]) },
      bidEvaluationResult: { deleteMany: jest.fn(), createMany: jest.fn(), findMany: jest.fn().mockResolvedValue([]) },
      bidOpeningRecord: { findMany: jest.fn().mockResolvedValue([]) },
      auditLog: { create: jest.fn() },
      $transaction: jest.fn(async (cb: any) => cb({
        bidEvaluationResult: { deleteMany: jest.fn(), createMany: jest.fn() },
        bidSupervisionLog: { create: jest.fn() },
      })),
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BidService,
        { provide: PrismaService, useValue: prisma },
        { provide: NotificationService, useValue: { sendToRole: jest.fn() } },
        { provide: BidGateway, useValue: { notifySupervisionLog: jest.fn() } },
      ],
    }).compile();
    service = module.get(BidService);
  });

  it('bondRequired 且某供应商保证金未达标 → 写高风险监督日志，但仍纳入排名', async () => {
    prisma.bidProject.findUnique.mockResolvedValue({
      id: 'p1', name: 'X', stage: 'EVALUATING', bondRequired: true,
      experts: [{ reportConfirmed: true }],
      suppliers: [{ id: 's1', supplierName: '甲', decryptStatus: 'SUCCESS', submitStatus: '已提交', confirmStatus: 'CONFIRMED' }],
    });
    prisma.bidOpeningRecord.findMany.mockResolvedValue([{ bidSupplierId: 's1', bondStatus: '未缴纳' }]);
    const txLogCreate = jest.fn();
    prisma.$transaction.mockImplementation(async (cb: any) => cb({
      bidEvaluationResult: { deleteMany: jest.fn(), createMany: jest.fn() },
      bidSupervisionLog: { create: txLogCreate },
    }));

    await service.generateEvaluationResults('p1', 'actor1');

    const flagged = txLogCreate.mock.calls.find(
      (c: any[]) => c[0].data.riskFlag === '高风险' && String(c[0].data.action).includes('保证金'),
    );
    expect(flagged).toBeTruthy();
  });

  it('bondRequired=false → 不写保证金监督日志', async () => {
    prisma.bidProject.findUnique.mockResolvedValue({
      id: 'p1', name: 'X', stage: 'EVALUATING', bondRequired: false,
      experts: [{ reportConfirmed: true }],
      suppliers: [{ id: 's1', supplierName: '甲', decryptStatus: 'SUCCESS', submitStatus: '已提交', confirmStatus: 'CONFIRMED' }],
    });
    const txLogCreate = jest.fn();
    prisma.$transaction.mockImplementation(async (cb: any) => cb({
      bidEvaluationResult: { deleteMany: jest.fn(), createMany: jest.fn() },
      bidSupervisionLog: { create: txLogCreate },
    }));

    await service.generateEvaluationResults('p1', 'actor1');

    const flagged = txLogCreate.mock.calls.find((c: any[]) => String(c[0].data.action).includes('保证金'));
    expect(flagged).toBeUndefined();
  });
});
