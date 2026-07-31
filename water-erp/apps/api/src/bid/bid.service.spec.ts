import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, BadRequestException } from '@nestjs/common';
import { BidService } from './bid.service';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationService } from '../notification/notification.service';
import { ClarificationAiService } from './clarification-ai.service';
import { BidGateway } from './bid.gateway';
import { ScoreStandardValidator } from './score-standard-validator.service';
import { PriceFormulaService } from './price-formula.service';
import { StorageService } from '../storage/storage.service';
import { assertBidStageTransition } from './bid-state';
import { sealField, openField } from '../common/crypto/field-crypto';

// bid.service 多处暴露点（getWorkspace/getOpeningRecordDraft）用 openField 拆封 bidPrice。
// KMS_SECRET 在 jest 同进程可能被其他 spec 污染，此处显式自洽设置。
const BID_SPEC_KMS = 'test-kms-secret-from-bid-service-spec';
const BID_SPEC_ORIG_KMS = process.env.KMS_SECRET;
beforeAll(() => { process.env.KMS_SECRET = BID_SPEC_KMS; });
afterAll(() => { if (BID_SPEC_ORIG_KMS !== undefined) process.env.KMS_SECRET = BID_SPEC_ORIG_KMS; else delete process.env.KMS_SECRET; });

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

  it('允许向前跳步（棘轮：DOWNLOAD → OPENING / ARCHIVED 合法）', () => {
    expect(() => assertBidStageTransition('DOWNLOAD', 'OPENING')).not.toThrow();
    expect(() => assertBidStageTransition('DOWNLOAD', 'ARCHIVED')).not.toThrow();
    expect(() => assertBidStageTransition('SUBMIT', 'EVALUATING')).not.toThrow();
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
      assertBidStageTransition('EVALUATING', 'SUBMIT');
      fail('应抛出 ConflictException');
    } catch (e) {
      expect(e.message).toContain('EVALUATING');
      expect(e.message).toContain('SUBMIT');
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
      bidScorePoint: { findMany: jest.fn().mockResolvedValue([]), findFirst: jest.fn() },
      bidScorePointDecision: { upsert: jest.fn().mockResolvedValue({}) },
      bidScoreReview: { upsert: jest.fn().mockResolvedValue({}), findMany: jest.fn().mockResolvedValue([]), update: jest.fn() },
      aiBidAnalysisTask: { upsert: jest.fn().mockResolvedValue({ id: 'ai-1' }) },
      aiBidderResult: { createMany: jest.fn().mockResolvedValue({ count: 0 }) },
      supplier: { count: jest.fn() },
      announcement: { count: jest.fn(), findFirst: jest.fn() },
      bidSupplier: { findMany: jest.fn().mockResolvedValue([]), update: jest.fn(), create: jest.fn(), findFirst: jest.fn(), findUnique: jest.fn(), count: jest.fn() },
      bidOpeningRecord: { create: jest.fn(), findFirst: jest.fn(), update: jest.fn(), updateMany: jest.fn().mockResolvedValue({ count: 1 }), findUnique: jest.fn(), findMany: jest.fn() },
      bidEvaluationResult: { deleteMany: jest.fn(), createMany: jest.fn(), findMany: jest.fn(), count: jest.fn() },
      bidArchiveItem: { findMany: jest.fn(), updateMany: jest.fn(), update: jest.fn(), findFirst: jest.fn(), create: jest.fn(), groupBy: jest.fn() },
      supplierBidSubmission: { findUnique: jest.fn() },
      bidOpeningSession: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
      fileAsset: { findUnique: jest.fn() },
      notification: { create: jest.fn(), createMany: jest.fn() },
      user: { findMany: jest.fn() },
      auditLog: { create: jest.fn() },
      bidInvalidBid: { findMany: jest.fn().mockResolvedValue([]), findUnique: jest.fn(), findFirst: jest.fn(), update: jest.fn() },
      projectManagementStage: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
      projectManagementItem: { findUnique: jest.fn().mockResolvedValue(null), update: jest.fn() },
      $queryRaw: jest.fn().mockResolvedValue([]),
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
        { provide: ScoreStandardValidator, useValue: { assertPassFailMaxScore: jest.fn(), assertPointsSumWithinMax: jest.fn().mockResolvedValue(undefined), assertScoreStandardComplete: jest.fn().mockResolvedValue(undefined) } },
        { provide: PriceFormulaService, useValue: { calculate: jest.fn().mockReturnValue(new Map()), getOverCeilingSuppliers: jest.fn().mockReturnValue([]) } },
        BidService,
        { provide: StorageService, useValue: { upload: jest.fn() } },
        { provide: PrismaService, useValue: prisma },
        { provide: NotificationService, useValue: { sendToRole: jest.fn() } },
        { provide: ClarificationAiService, useValue: { draftQuestion: jest.fn().mockResolvedValue({ drafts: [], basis: [] }), summarizeReply: jest.fn().mockResolvedValue(null) } },
        { provide: ScoreStandardValidator, useValue: { assertPassFailMaxScore: jest.fn(), assertPointsSumWithinMax: jest.fn().mockResolvedValue(undefined), assertScoreStandardComplete: jest.fn().mockResolvedValue(undefined) } },
        { provide: PriceFormulaService, useValue: { calculate: jest.fn().mockReturnValue(new Map()), getOverCeilingSuppliers: jest.fn().mockReturnValue([]) } },
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

    it('allows DOWNLOAD → ARCHIVED (forward skip under ratchet)', () => {
      expect(() => assertBidStageTransition('DOWNLOAD', 'ARCHIVED')).not.toThrow();
    });

    it('rejects ARCHIVED → DOWNLOAD (backward) with ConflictException', () => {
      expect(() => assertBidStageTransition('ARCHIVED', 'DOWNLOAD')).toThrow(ConflictException);
    });

    it('allows same-stage (idempotent)', () => {
      expect(() => assertBidStageTransition('SUBMIT', 'SUBMIT')).not.toThrow();
    });
  });

  describe('C1 — 流转端点事务内复查阶段（防并发复活/回退）', () => {
    it('startEvaluation：事务内复查发现已 ARCHIVED 时抛 409，绝不写 EVALUATING', async () => {
      prisma.bidProject.findUnique
        .mockResolvedValueOnce({ stage: 'OPENING', name: 'P' })   // pre-tx 读到 OPENING
        .mockResolvedValueOnce({ stage: 'ARCHIVED', name: 'P' }); // 锁后复查：并发对手已归档
      prisma.bidExpert.count = jest.fn().mockResolvedValue(3);
      prisma.bidSupplier.count = jest.fn().mockResolvedValue(3);
      prisma.bidProject.update.mockResolvedValue({ id: 'p1', stage: 'EVALUATING' });

      await expect(service.startEvaluation('p1', 'u1')).rejects.toThrow(ConflictException);
      expect(prisma.bidProject.update).not.toHaveBeenCalled();
    });

    it('openSubmission：事务内复查发现已 ARCHIVED 时抛 409，绝不写 SUBMIT', async () => {
      prisma.bidProject.findUnique
        .mockResolvedValueOnce({ stage: 'DOWNLOAD', name: 'P', projectCode: 'BID-1' })
        .mockResolvedValueOnce({ stage: 'ARCHIVED', name: 'P', projectCode: 'BID-1' });
      prisma.announcement.findFirst.mockResolvedValue({ id: 'a1' });
      prisma.bidProject.update.mockResolvedValue({ id: 'p1', stage: 'SUBMIT' });

      await expect(service.openSubmission('p1', 'u1')).rejects.toThrow(ConflictException);
      expect(prisma.bidProject.update).not.toHaveBeenCalled();
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

    it('rejects if stage is past OPENING (backward)', async () => {
      prisma.bidProject.findUnique.mockResolvedValue({ stage: 'EVALUATING', name: '测试项目' });
      await expect(service.startOpening('p1')).rejects.toThrow(ConflictException);
    });

    it('裸调不带会话字段仅推阶段、不建会话（SUBMIT→OPENING，:3005 确定开标路径）', async () => {
      prisma.bidProject.findUnique.mockResolvedValue({ stage: 'SUBMIT', name: '测试项目', deadline: new Date(Date.now() - 3600_000) });
      prisma.bidProject.update.mockResolvedValue({ id: 'p1', stage: 'OPENING' });
      prisma.bidSupervisionLog.create.mockResolvedValue({});

      const result = await service.startOpening('p1');

      expect(result.stage).toBe('OPENING');
      expect(prisma.bidOpeningSession.create).not.toHaveBeenCalled();
      expect(prisma.bidOpeningSession.update).not.toHaveBeenCalled();
    });

    it('OPENING 同阶段调用带完整四字段 → 组建会话（幂等 upsert）', async () => {
      prisma.bidProject.findUnique.mockResolvedValue({ stage: 'OPENING', name: '测试项目' });
      prisma.bidOpeningSession.findUnique.mockResolvedValue(null);
      prisma.bidOpeningSession.create.mockResolvedValue({ id: 'sess-2' });
      prisma.bidProject.update.mockResolvedValue({ id: 'p1', stage: 'OPENING' });
      prisma.bidSupervisionLog.create.mockResolvedValue({});

      const result = await service.startOpening('p1', sessionDto);

      expect(result.stage).toBe('OPENING');
      expect(prisma.bidOpeningSession.create).toHaveBeenCalled();
    });

    it('会话字段只给部分 → 400 INCOMPLETE_SESSION_FIELDS', async () => {
      prisma.bidProject.findUnique.mockResolvedValue({ stage: 'OPENING', name: '测试项目' });
      await expect(service.startOpening('p1', { host: '主持张三' } as any)).rejects.toMatchObject({
        response: { code: 'INCOMPLETE_SESSION_FIELDS' },
      });
    });

    it('只给监督人（缺必填项）→ 400 INCOMPLETE_SESSION_FIELDS', async () => {
      prisma.bidProject.findUnique.mockResolvedValue({ stage: 'OPENING', name: '测试项目' });
      await expect(service.startOpening('p1', { supervisor: '监督人A' } as any)).rejects.toMatchObject({
        response: { code: 'INCOMPLETE_SESSION_FIELDS' },
      });
    });

    it('省略监督人（选填）→ 仍组建会话，supervisor 落 null', async () => {
      prisma.bidProject.findUnique.mockResolvedValue({ stage: 'OPENING', name: '测试项目' });
      prisma.bidOpeningSession.findUnique.mockResolvedValue(null);
      prisma.bidOpeningSession.create.mockResolvedValue({ id: 'sess-3' });
      prisma.bidProject.update.mockResolvedValue({ id: 'p1', stage: 'OPENING' });
      prisma.bidSupervisionLog.create.mockResolvedValue({});

      const { supervisor: _omit, ...dtoNoSupervisor } = sessionDto;
      const result = await service.startOpening('p1', dtoNoSupervisor);

      expect(result.stage).toBe('OPENING');
      expect(prisma.bidOpeningSession.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ host: '主持人A', supervisor: null }),
        }),
      );
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

    it('H1: 部分文件缺失（首份完整、次份资产缺失）判 DANGER，不误判 SUCCESS', async () => {
      prisma.supplierBidSubmission.findUnique = jest.fn().mockResolvedValue({
        technicalFileAssetId: 'fa1', businessFileAssetId: 'fa2', coverLetterAssetId: null,
        technicalSealedKey: null, businessSealedKey: null, coverLetterSealedKey: null,
      });
      prisma.fileAsset.findUnique = jest.fn()
        .mockResolvedValueOnce({ id: 'fa1', key: 'uploads/tech.pdf', sha256: 'abc' }) // 首份存在
        .mockResolvedValueOnce(null);                                                  // 次份资产缺失
      // verifyIntegrity 全局 mock 返回 true → 首份完整性通过（制造"部分成功"假象）

      await service.decryptSupplier('p1', 'bs-1', {} as any);

      expect(prisma.bidSupplier.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ decryptStatus: 'DANGER' }) }),
      );
    });
  });

  describe('resolveOpeningDispute', () => {
    it('updates record handle result and BidSupplier status on confirm', async () => {
      prisma.bidProject.findUnique.mockResolvedValue({ stage: 'OPENING' });
      prisma.bidOpeningRecord.findFirst.mockResolvedValue({
        id: 'r1', projectId: 'p1', supplierName: '测试供应商', bidSupplierId: 'bs-1',
        confirmStatus: '供应商提出异议',
      });
      prisma.bidOpeningRecord.updateMany.mockResolvedValue({ count: 1 });
      prisma.bidOpeningRecord.findUnique.mockResolvedValue({ id: 'r1', confirmStatus: '异议已处理-确认' });
      prisma.bidSupplier.update.mockResolvedValue({});
      prisma.bidSupervisionLog.create.mockResolvedValue({});

      await service.resolveOpeningDispute('p1', 'r1', { result: '经核实无误', confirm: true });

      // M4：事务内条件更新——where 带异议态条件（并发防线，仅异议待处理行命中）
      expect(prisma.bidOpeningRecord.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'r1', confirmStatus: '供应商提出异议' },
          data: expect.objectContaining({ handleResult: '经核实无误', confirmStatus: '异议已处理-确认' }),
        }),
      );
      expect(prisma.bidSupplier.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ confirmStatus: 'CONFIRMED' }) }),
      );
    });

    it('sets BidSupplier EXCEPTION when dispute is not confirmed', async () => {
      prisma.bidProject.findUnique.mockResolvedValue({ stage: 'OPENING' });
      prisma.bidOpeningRecord.findFirst.mockResolvedValue({
        id: 'r1', projectId: 'p1', supplierName: '测试供应商', bidSupplierId: 'bs-1',
        confirmStatus: '供应商提出异议',
      });
      prisma.bidOpeningRecord.updateMany.mockResolvedValue({ count: 1 });
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

    it.each([
      ['从未异议（待确认态）', '待确认'],
      ['从未异议（唱标录入态）', '待供应商确认'],
      ['已确认', '供应商已确认'],
      ['已处理过（防反复覆盖）', '异议已处理-确认'],
      ['已处理过（退回态）', '异议已处理-退回'],
    ])('R7 状态机：%s的记录 resolve → 400 DISPUTE_NOT_PENDING，不落库', async (_label, confirmStatus) => {
      prisma.bidProject.findUnique.mockResolvedValue({ stage: 'OPENING' });
      prisma.bidOpeningRecord.findFirst.mockResolvedValue({
        id: 'r1', projectId: 'p1', supplierName: '测试供应商', bidSupplierId: 'bs-1', confirmStatus,
      });
      await expect(service.resolveOpeningDispute('p1', 'r1', { result: 'x', confirm: true }))
        .rejects.toMatchObject({ response: { code: 'DISPUTE_NOT_PENDING' } });
      expect(prisma.$transaction).not.toHaveBeenCalled(); // 事务前拦截：记录/供应商态/监督日志均不动
      expect(prisma.bidOpeningRecord.update).not.toHaveBeenCalled();
      expect(prisma.bidSupplier.update).not.toHaveBeenCalled();
    });

    it('R7 状态机：仅「供应商提出异议」态可处理（异议→处理放行）', async () => {
      prisma.bidProject.findUnique.mockResolvedValue({ stage: 'OPENING' });
      prisma.bidOpeningRecord.findFirst.mockResolvedValue({
        id: 'r1', projectId: 'p1', supplierName: '测试供应商', bidSupplierId: 'bs-1',
        confirmStatus: '供应商提出异议',
      });
      prisma.bidOpeningRecord.updateMany.mockResolvedValue({ count: 1 });
      prisma.bidOpeningRecord.findUnique.mockResolvedValue({ id: 'r1', confirmStatus: '异议已处理-确认' });
      prisma.bidSupplier.update.mockResolvedValue({});
      prisma.bidSupplier.findUnique.mockResolvedValue({ supplierId: 'sup-1' });
      prisma.bidSupervisionLog.create.mockResolvedValue({});
      await expect(service.resolveOpeningDispute('p1', 'r1', { result: '复核无误', confirm: true })).resolves.toBeDefined();
      expect(prisma.$transaction).toHaveBeenCalled();
    });

    it('M4：事务内条件更新抢占失败（updateMany count=0，并发双处理）→ 400 DISPUTE_NOT_PENDING，供应商态/监督日志不动', async () => {
      prisma.bidProject.findUnique.mockResolvedValue({ stage: 'OPENING' });
      prisma.bidOpeningRecord.findFirst.mockResolvedValue({
        id: 'r1', projectId: 'p1', supplierName: '测试供应商', bidSupplierId: 'bs-1',
        confirmStatus: '供应商提出异议',
      });
      prisma.bidOpeningRecord.updateMany.mockResolvedValue({ count: 0 }); // 另一请求已在事务内抢占成功

      await expect(service.resolveOpeningDispute('p1', 'r1', { result: 'x', confirm: true }))
        .rejects.toMatchObject({ response: { code: 'DISPUTE_NOT_PENDING' } });
      expect(prisma.$transaction).toHaveBeenCalled(); // 走到了事务内并发防线（非门外快速失败）
      expect(prisma.bidSupplier.update).not.toHaveBeenCalled();
      expect(prisma.bidSupervisionLog.create).not.toHaveBeenCalled();
    });

    it('M5：resolve 监督日志记态迁移（供应商提出异议 → 异议已处理-确认：处理结果）', async () => {
      prisma.bidProject.findUnique.mockResolvedValue({ stage: 'OPENING' });
      prisma.bidOpeningRecord.findFirst.mockResolvedValue({
        id: 'r1', projectId: 'p1', supplierName: '测试供应商', bidSupplierId: 'bs-1',
        confirmStatus: '供应商提出异议',
      });
      prisma.bidOpeningRecord.updateMany.mockResolvedValue({ count: 1 });
      prisma.bidOpeningRecord.findUnique.mockResolvedValue({ id: 'r1', confirmStatus: '异议已处理-确认' });
      prisma.bidSupplier.update.mockResolvedValue({});
      prisma.bidSupplier.findUnique.mockResolvedValue({ supplierId: 'sup-1' });
      prisma.bidSupervisionLog.create.mockResolvedValue({});

      await service.resolveOpeningDispute('p1', 'r1', { result: '复核无误', confirm: true });
      expect(prisma.bidSupervisionLog.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({
          action: '处理开标异议',
          result: '供应商提出异议 → 异议已处理-确认：复核无误',
        }),
      }));
    });

    it('H6: 处理异议态记录时写入 handledBy 与 AuditLog', async () => {
      prisma.bidProject.findUnique.mockResolvedValue({ stage: 'OPENING' });
      prisma.bidOpeningRecord.findFirst.mockResolvedValue({
        id: 'r1', projectId: 'p1', supplierName: '测试供应商', bidSupplierId: 'bs-1',
        confirmStatus: '供应商提出异议',
      });
      prisma.bidOpeningRecord.updateMany.mockResolvedValue({ count: 1 });
      prisma.bidOpeningRecord.findUnique.mockResolvedValue({ id: 'r1' });
      prisma.bidSupplier.update.mockResolvedValue({});
      prisma.bidSupplier.findUnique.mockResolvedValue({ supplierId: 'sp1' });
      prisma.bidSupervisionLog.create.mockResolvedValue({});
      prisma.auditLog.create.mockResolvedValue({});

      await service.resolveOpeningDispute('p1', 'r1', { result: '受理', confirm: true }, 'u1');

      expect(prisma.bidOpeningRecord.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ handledBy: 'u1' }) }),
      );
      expect(prisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ userId: 'u1', action: 'BID_DISPUTE_RESOLVE' }) }),
      );
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

    it('rejects when leader has not co-signed', async () => {
      prisma.bidProject.findUnique.mockResolvedValue({
        id: 'p1', stage: 'EVALUATING', name: '测试项目',
        experts: [{ id: 'e1', reportConfirmed: true }, { id: 'e2', reportConfirmed: true }],
        suppliers: [],
      });
      await expect(service.generateEvaluationResults('p1'))
        .rejects.toMatchObject({ response: { code: 'LEADER_NOT_COSIGNED' } });
    });

    it('rejects when project is not EVALUATING', async () => {
      prisma.bidProject.findUnique.mockResolvedValue({ id: 'p1', stage: 'OPENING', name: 'x', experts: [], suppliers: [] });
      await expect(service.generateEvaluationResults('p1'))
        .rejects.toMatchObject({ response: { code: 'PROJECT_NOT_EVALUATING' } });
    });

    it('ranks suppliers by average score and recommends the top supplier', async () => {
      prisma.bidProject.findUnique.mockResolvedValue({
        id: 'p1', stage: 'EVALUATING', name: '测试项目', leaderCoSigned: true,
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
      id: 'p1', stage: 'EVALUATING', name: '项目', leaderCoSigned: true,
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
        id: 'p1', name: '项目', stage: 'EVALUATING', bondRequired: false, leaderCoSigned: true,
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

    it('H2: 已撤销的废标（BidInvalidBid.status=revoked）不计入失败票，供应商不判废', async () => {
      prisma.bidScoreItem.findMany.mockResolvedValue([
        { id: 'si_qual', category: 'QUALIFICATION' },
      ]);
      prisma.bidProject.findUnique.mockResolvedValue({
        id: 'p1', name: '项目', stage: 'EVALUATING', bondRequired: false, leaderCoSigned: true,
        experts: [{ id: 'e1', reportConfirmed: true }, { id: 'e2', reportConfirmed: true }, { id: 'e3', reportConfirmed: true }],
        suppliers: [{ id: 's1', supplierName: '甲', decryptStatus: 'SUCCESS', submitStatus: 'ok', confirmStatus: 'CONFIRMED' }],
      });
      // 通过性项原本 2 不通过 + 1 通过 → 过半判废；但该 (s1,si_qual) 废标已被管理员撤销
      prisma.bidScoreRecord.findMany.mockResolvedValue([
        { supplierId: 's1', expertId: 'e1', score: 0, passed: false, scoreItemId: 'si_qual' },
        { supplierId: 's1', expertId: 'e2', score: 0, passed: false, scoreItemId: 'si_qual' },
        { supplierId: 's1', expertId: 'e3', score: 0, passed: true, scoreItemId: 'si_qual' },
        { supplierId: 's1', expertId: 'e1', score: 10 },
        { supplierId: 's1', expertId: 'e2', score: 10 },
        { supplierId: 's1', expertId: 'e3', score: 10 },
      ]);
      prisma.bidInvalidBid.findMany.mockResolvedValue([{ supplierId: 's1', scoreItemId: 'si_qual' }]); // 已撤销
      prisma.bidEvaluationResult.deleteMany.mockResolvedValue({});
      prisma.bidEvaluationResult.createMany.mockResolvedValue({});
      prisma.bidSupervisionLog.create.mockResolvedValue({});
      prisma.bidEvaluationResult.findMany.mockResolvedValue([
        { supplierId: 's1', supplierName: '甲', totalScore: 30, averageScore: 10, rank: 1, recommended: true, disqualified: false },
      ]);

      await service.generateEvaluationResults('p1');

      const created = (prisma.bidEvaluationResult.createMany.mock.calls[0][0] as any).data[0];
      expect(created.disqualified).toBe(false); // 撤销生效：不再判废
      expect(created.recommended).toBe(true);
    });

    it('generateEvaluationResults：不通过不过半 → 不废标', async () => {
      prisma.bidScoreItem.findMany.mockResolvedValue([
        { id: 'si_resp', category: 'RESPONSIVE' },
      ]);
      prisma.bidProject.findUnique.mockResolvedValue({
        id: 'p1', name: '项目', stage: 'EVALUATING', bondRequired: false, leaderCoSigned: true,
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

    it('已归档项目幂等返回（ARCHIVED 终态，不重复归档）', async () => {
      prisma.bidProject.findUnique.mockResolvedValue({ id: 'p1', projectCode: 'BID-X', stage: 'ARCHIVED', name: '测试项目' });

      const result = await service.archiveAll('p1');

      expect(result).toBeDefined();
      expect(prisma.bidProject.update).not.toHaveBeenCalled();
    });

    it('scope 分支：full 触发 EVALUATION_RESULTS_REQUIRED；opening 跳过该守卫（开标归档路径）', async () => {
      prisma.bidProject.findUnique.mockResolvedValue({ id: 'p1', projectCode: 'BID-X', stage: 'EVALUATING', name: '测试项目' });
      prisma.bidSupplier.findMany.mockResolvedValue([{ id: 'bs1', supplierName: '甲' }]);
      prisma.bidEvaluationResult.count.mockResolvedValue(0);

      // full（默认）→ 存在已确认供应商但无评标结果，守卫拦截
      await expect(service.archiveAll('p1'))
        .rejects.toMatchObject({ response: { code: 'EVALUATION_RESULTS_REQUIRED' } });

      // opening → 阶段下限通过（EVALUATING ≥ OPENING）、跳过评标守卫，但必须先完成移交
      prisma.bidOpeningSession.findUnique.mockResolvedValue({ handoverAssetId: null });
      await expect(service.archiveAll('p1', undefined, 'opening'))
        .rejects.toMatchObject({ response: { code: 'OPENING_HANDOVER_REQUIRED' } });
    });

    it('F3 阶段下限：DOWNLOAD + scope=opening → 409 ARCHIVE_NOT_OPENED', async () => {
      prisma.bidProject.findUnique.mockResolvedValue({ id: 'p1', projectCode: 'BID-X', stage: 'DOWNLOAD', name: '测试项目' });

      await expect(service.archiveAll('p1', undefined, 'opening'))
        .rejects.toMatchObject({ response: { code: 'ARCHIVE_NOT_OPENED' } });
      expect(prisma.bidProject.update).not.toHaveBeenCalled();
    });

    it('F3 阶段下限：SUBMIT + scope=full → 409 ARCHIVE_NOT_EVALUATING', async () => {
      prisma.bidProject.findUnique.mockResolvedValue({ id: 'p1', projectCode: 'BID-X', stage: 'SUBMIT', name: '测试项目' });

      await expect(service.archiveAll('p1', undefined, 'full'))
        .rejects.toMatchObject({ response: { code: 'ARCHIVE_NOT_EVALUATING' } });
      expect(prisma.bidProject.update).not.toHaveBeenCalled();
    });

    it('F3 阶段下限：OPENING + scope=opening → 放行进入归档流程', async () => {
      prisma.bidProject.findUnique.mockResolvedValue({ id: 'p1', projectCode: 'BID-X', stage: 'OPENING', name: '测试项目', projectManagementItemId: 'pm1', round: 1 });
      prisma.bidSupplier.findMany.mockResolvedValue([]);
      prisma.bidEvaluationResult.count.mockResolvedValue(0);
      prisma.bidOpeningSession.findUnique.mockResolvedValue({ handoverAssetId: 'asset-1' });
      prisma.bidArchiveItem.findMany
        .mockResolvedValueOnce([]) // ensureArchiveItems
        .mockResolvedValueOnce([{ id: 'a1', status: 'PENDING_CONFIRM' }]); // non-archived
      prisma.bidArchiveItem.create.mockResolvedValue({});
      prisma.bidArchiveItem.update.mockResolvedValue({ hashDigest: 'sha256:abc' });
      prisma.bidProject.update.mockResolvedValue({ id: 'p1', stage: 'ARCHIVED' });
      prisma.bidSupervisionLog.create.mockResolvedValue({});

      await expect(service.archiveAll('p1', undefined, 'opening')).resolves.toBeDefined();
      expect(prisma.bidProject.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'p1' }, data: { stage: 'ARCHIVED' } }),
      );
      // F5：开标归档（流标/废标）不推进 PM「开标评标」阶段
      expect(prisma.projectManagementStage.updateMany).not.toHaveBeenCalled();
    });

    it('F5 阶段联动：scope=full 归档推进 PM「开标评标」→ COMPLETED', async () => {
      prisma.bidProject.findUnique.mockResolvedValue({ id: 'p1', projectCode: 'BID-X', stage: 'EVALUATING', name: '测试项目', projectManagementItemId: 'pm1', round: 1 });
      prisma.bidSupplier.findMany.mockResolvedValue([]);
      prisma.bidEvaluationResult.count.mockResolvedValue(1); // 已有评标结果
      prisma.bidArchiveItem.findMany
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ id: 'a1', status: 'PENDING_CONFIRM' }]);
      prisma.bidArchiveItem.create.mockResolvedValue({});
      prisma.bidArchiveItem.update.mockResolvedValue({ hashDigest: 'sha256:abc' });
      prisma.bidProject.update.mockResolvedValue({ id: 'p1', stage: 'ARCHIVED' });
      prisma.bidSupervisionLog.create.mockResolvedValue({});

      await expect(service.archiveAll('p1')).resolves.toBeDefined();
      expect(prisma.projectManagementStage.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ projectManagementItemId: 'pm1', stageKey: 'BID_EVALUATION', round: 1 }),
        }),
      );
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
        .mockResolvedValueOnce({ id: 'p1', projectCode: 'BID-TEST', stage: 'EVALUATING', name: '测试项目' }) // C1: 事务内行锁后复查读到同阶段
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
      prisma.bidSupplier.findFirst.mockResolvedValue({ id: 'sup-1', decryptStatus: 'SUCCESS', submitStatus: 'submitted' });
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

    it('代评：有 points 走 decision 汇总，与专家端口径一致', async () => {
      prisma.bidProject.findUnique.mockResolvedValue({ stage: 'EVALUATING' });
      prisma.bidExpert.findFirst.mockResolvedValue({ id: 'exp-1', expertName: '刘' });
      prisma.bidScoreItem.findFirst.mockResolvedValue({ id: 'si-1', maxScore: 30, category: 'TECHNICAL', name: '技术' });
      prisma.bidSupplier.findFirst.mockResolvedValue({ id: 'sup-1', decryptStatus: 'SUCCESS', submitStatus: 'submitted' });
      prisma.bidScorePoint.findMany.mockResolvedValue([{ id: 'pt1', scoreItemId: 'si-1', objective: true, fullScore: 15 }]);
      prisma.bidScorePointDecision.upsert.mockResolvedValue({});
      prisma.bidScoreRecord.upsert.mockResolvedValue({ id: 'sr-1' });
      prisma.bidScoreRecord.findMany.mockResolvedValue([{ score: 15 }]);
      prisma.bidScoreRecord.count.mockResolvedValue(1);
      prisma.bidScoreItem.findMany.mockResolvedValue([{ id: 'si-1' }]);
      prisma.bidSupplier.count.mockResolvedValue(1);

      await service.submitScore('p1', {
        expertId: 'exp-1', scoreItemId: 'si-1', supplierId: 'sup-1', score: 0, reason: '',
        pointDecisions: [{ pointId: 'pt1', checked: true, awardedScore: 15 }],
      } as any);

      expect(prisma.bidScorePointDecision.upsert).toHaveBeenCalledTimes(1);
      expect(prisma.bidScoreRecord.upsert).toHaveBeenCalledWith(expect.objectContaining({
        update: expect.objectContaining({ score: 15 }),
      }));
    });

    it('P1-5：专家已确认报告 → 代评被锁 SCORE_LOCKED', async () => {
      prisma.bidProject.findUnique.mockResolvedValue({ stage: 'EVALUATING' });
      prisma.bidExpert.findFirst.mockResolvedValue({ id: 'exp-1', reportConfirmed: true });
      await expect(service.submitScore('p1', {
        expertId: 'exp-1', scoreItemId: 'si-1', supplierId: 'sup-1', score: 10,
      })).rejects.toMatchObject({ response: { code: 'SCORE_LOCKED' } });
    });

    it('P1-4：代评写 BidScoreReview(status=draft)，专家核对不再 P2025', async () => {
      prisma.bidProject.findUnique.mockResolvedValue({ stage: 'EVALUATING' });
      prisma.bidExpert.findFirst.mockResolvedValue({ id: 'exp-1', expertName: '刘' });
      prisma.bidScoreItem.findFirst.mockResolvedValue({ id: 'si-1', maxScore: 30, category: 'TECHNICAL', name: '技术' });
      prisma.bidSupplier.findFirst.mockResolvedValue({ id: 'sup-1', decryptStatus: 'SUCCESS', submitStatus: 'submitted' });
      prisma.bidScoreRecord.upsert.mockResolvedValue({ id: 'sr-1' });
      prisma.auditLog.create.mockResolvedValue({});

      await service.submitScore('p1', {
        expertId: 'exp-1', scoreItemId: 'si-1', supplierId: 'sup-1', score: 10, reason: 'ok',
      }, 'actor-1');

      expect(prisma.bidScoreReview.upsert).toHaveBeenCalledWith(expect.objectContaining({
        where: { expertId_projectId_supplierId: { expertId: 'exp-1', projectId: 'p1', supplierId: 'sup-1' } },
        update: { status: 'draft', verifiedAt: null },
        create: { expertId: 'exp-1', projectId: 'p1', supplierId: 'sup-1', status: 'draft' },
      }));
    });

    it('P1-5：审计记 finalScore（checklist 下 ≠ dto.score）', async () => {
      prisma.bidProject.findUnique.mockResolvedValue({ stage: 'EVALUATING' });
      prisma.bidExpert.findFirst.mockResolvedValue({ id: 'exp-1', expertName: '刘' });
      prisma.bidScoreItem.findFirst.mockResolvedValue({ id: 'si-1', maxScore: 30, category: 'TECHNICAL', name: '技术' });
      prisma.bidSupplier.findFirst.mockResolvedValue({ id: 'sup-1', decryptStatus: 'SUCCESS', submitStatus: 'submitted' });
      prisma.bidScorePoint.findMany.mockResolvedValue([{ id: 'pt1', scoreItemId: 'si-1', objective: true, fullScore: 15 }]);
      prisma.bidScorePointDecision.upsert.mockResolvedValue({});
      prisma.bidScoreRecord.upsert.mockResolvedValue({ id: 'sr-1' });
      prisma.auditLog.create.mockResolvedValue({});

      await service.submitScore('p1', {
        expertId: 'exp-1', scoreItemId: 'si-1', supplierId: 'sup-1', score: 0, reason: '',
        pointDecisions: [{ pointId: 'pt1', checked: true, awardedScore: 15 }],
      } as any, 'actor-1');

      expect(prisma.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ details: expect.objectContaining({ score: 15 }) }),
      }));
    });

    it('P1-5：写操作事务化（$transaction 被调用）', async () => {
      prisma.bidProject.findUnique.mockResolvedValue({ stage: 'EVALUATING' });
      prisma.bidExpert.findFirst.mockResolvedValue({ id: 'exp-1', expertName: '刘' });
      prisma.bidScoreItem.findFirst.mockResolvedValue({ id: 'si-1', maxScore: 30, category: 'TECHNICAL', name: '技术' });
      prisma.bidSupplier.findFirst.mockResolvedValue({ id: 'sup-1', decryptStatus: 'SUCCESS', submitStatus: 'submitted' });
      prisma.bidScoreRecord.upsert.mockResolvedValue({ id: 'sr-1' });

      await service.submitScore('p1', {
        expertId: 'exp-1', scoreItemId: 'si-1', supplierId: 'sup-1', score: 10,
      });

      expect(prisma.$transaction).toHaveBeenCalled();
    });

    it('P1-9：代评未解密成功/已撤回的供应商 → SUPPLIER_NOT_DECRYPTED', async () => {
      prisma.bidProject.findUnique.mockResolvedValue({ stage: 'EVALUATING' });
      prisma.bidExpert.findFirst.mockResolvedValue({ id: 'exp-1' });
      prisma.bidScoreItem.findFirst.mockResolvedValue({ id: 'si-1', maxScore: 30 });
      prisma.bidSupplier.findFirst.mockResolvedValue({ id: 'sup-1', decryptStatus: 'PENDING', submitStatus: 'submitted' });
      await expect(service.submitScore('p1', {
        expertId: 'exp-1', scoreItemId: 'si-1', supplierId: 'sup-1', score: 10,
      })).rejects.toMatchObject({ response: { code: 'SUPPLIER_NOT_DECRYPTED' } });
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
      prisma.bidSupplier.count.mockResolvedValue(3);
      const validator = service['scoreStandardValidator'] as any;
      validator.assertScoreStandardComplete.mockRejectedValueOnce({ response: { code: 'MAX_SCORE_SUM_NOT_100', statusCode: 409 } });
      await expect(service.startEvaluation('p1', 'u1')).rejects.toMatchObject({
        response: { code: 'MAX_SCORE_SUM_NOT_100' },
      });
    });

    it('专家/供应商/评分项齐备时不抛前置异常', async () => {
      prisma.bidSupplier.count.mockResolvedValue(3);
      prisma.bidScoreItem.count.mockResolvedValue(5);
      prisma.bidProject.update.mockResolvedValue({ stage: 'EVALUATING' });
      prisma.bidSupervisionLog.create.mockResolvedValue({});
      prisma.auditLog.create.mockResolvedValue({});
      await expect(service.startEvaluation('p1', 'u1')).resolves.toMatchObject({ stage: 'EVALUATING' });
    });
  });

  describe('P3 — startEvaluation ≥3 家法定门槛', () => {
    beforeEach(() => {
      prisma.bidProject.findUnique.mockResolvedValue({ stage: 'OPENING', name: '测试项目' });
      prisma.bidExpert.count.mockResolvedValue(3);
      prisma.bidSupplier.findMany.mockResolvedValue([]);
    });

    it('有效投标 1 家时拒绝并提示流标', async () => {
      prisma.bidSupplier.count.mockResolvedValue(1);
      await expect(service.startEvaluation('p1', 'u1')).rejects.toMatchObject({
        response: { code: 'INSUFFICIENT_BIDDERS', count: 1 },
      });
    });

    it('有效投标 2 家时拒绝并提示流标', async () => {
      prisma.bidSupplier.count.mockResolvedValue(2);
      await expect(service.startEvaluation('p1', 'u1')).rejects.toMatchObject({
        response: { code: 'INSUFFICIENT_BIDDERS', count: 2 },
      });
    });

    it('有效投标 0 家仍报 NO_EVALUABLE_SUPPLIERS（先于 ≥3 检查）', async () => {
      prisma.bidSupplier.count.mockResolvedValue(0);
      await expect(service.startEvaluation('p1', 'u1')).rejects.toMatchObject({
        response: { code: 'NO_EVALUABLE_SUPPLIERS' },
      });
    });
  });

  describe('H4 — startEvaluation 开标完成度守卫', () => {
    it('存在未解密（PENDING）供应商时抛 OPENING_NOT_DONE，不写 EVALUATING', async () => {
      prisma.bidProject.findUnique.mockResolvedValue({ stage: 'OPENING', name: 'P' });
      prisma.bidExpert.count.mockResolvedValue(3);
      prisma.bidSupplier.count.mockResolvedValue(3);
      prisma.bidSupplier.findMany.mockResolvedValue([
        { supplierName: 'A', decryptStatus: 'SUCCESS', confirmStatus: 'CONFIRMED' },
        { supplierName: 'B', decryptStatus: 'PENDING', confirmStatus: 'PENDING' },
        { supplierName: 'C', decryptStatus: 'SUCCESS', confirmStatus: 'CONFIRMED' },
      ]);
      prisma.bidProject.update.mockResolvedValue({ id: 'p1', stage: 'EVALUATING' });

      await expect(service.startEvaluation('p1', 'u1')).rejects.toMatchObject({ response: { code: 'OPENING_NOT_DONE' } });
      expect(prisma.bidProject.update).not.toHaveBeenCalled();
    });

    it('所有供应商到终局态（SUCCESS+CONFIRMED / DANGER）时放行', async () => {
      prisma.bidProject.findUnique.mockResolvedValue({ stage: 'OPENING', name: 'P' });
      prisma.bidExpert.count.mockResolvedValue(3);
      prisma.bidSupplier.count.mockResolvedValue(3);
      prisma.bidSupplier.findMany.mockResolvedValue([
        { supplierName: 'A', decryptStatus: 'SUCCESS', confirmStatus: 'CONFIRMED' },
        { supplierName: 'B', decryptStatus: 'DANGER', confirmStatus: 'PENDING' },
        { supplierName: 'C', decryptStatus: 'SUCCESS', confirmStatus: 'CONFIRMED' },
      ]);
      prisma.bidProject.update.mockResolvedValue({ id: 'p1', stage: 'EVALUATING' });
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
        { provide: ScoreStandardValidator, useValue: { assertPassFailMaxScore: jest.fn(), assertPointsSumWithinMax: jest.fn().mockResolvedValue(undefined), assertScoreStandardComplete: jest.fn().mockResolvedValue(undefined) } },
        { provide: PriceFormulaService, useValue: { calculate: jest.fn().mockReturnValue(new Map()), getOverCeilingSuppliers: jest.fn().mockReturnValue([]) } },
        BidService,
        { provide: StorageService, useValue: { upload: jest.fn() } },
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
      bidScorePoint: { findMany: jest.fn(), findFirst: jest.fn(), create: jest.fn(), update: jest.fn(), delete: jest.fn() },
      bidSupervisionLog: { create: jest.fn() },
      scoreTemplate: { findMany: jest.fn(), create: jest.fn(), findUnique: jest.fn(), delete: jest.fn().mockResolvedValue({}) },
      $queryRaw: jest.fn().mockResolvedValue([]),
      $transaction: jest.fn(async (cb: any) => cb(prisma)),
    };
    const module = await Test.createTestingModule({
      providers: [
        { provide: PrismaService, useValue: prisma },
        { provide: NotificationService, useValue: { create: jest.fn() } },
        { provide: ScoreStandardValidator, useValue: { assertPassFailMaxScore: jest.fn(), assertPointsSumWithinMax: jest.fn().mockResolvedValue(undefined), assertScoreStandardComplete: jest.fn().mockResolvedValue(undefined) } },
        { provide: PriceFormulaService, useValue: { calculate: jest.fn().mockReturnValue(new Map()), getOverCeilingSuppliers: jest.fn().mockReturnValue([]) } },
        BidService,
        { provide: StorageService, useValue: { upload: jest.fn() } },
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

    const res = await service.createScoreItem('p1', { category: 'TECHNICAL' as any, name: '技术评分', maxScore: 50 }, { userId: 'u1', role: 'bid_host' });
    expect(res.id).toBe('i1');
    expect(prisma.bidScoreItem.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ projectId: 'p1', category: 'TECHNICAL', name: '技术评分', maxScore: 50 }),
    }));
    expect(prisma.bidSupervisionLog.create).toHaveBeenCalled();
  });

  it('createScoreItem 在 OPENING 阶段仍可编辑（评标前最后窗口）', async () => {
    prisma.bidProject.findUnique.mockResolvedValue({ stage: 'OPENING', name: '项目A' });
    prisma.bidScoreItem.create.mockResolvedValue({ id: 'i1' });
    await expect(service.createScoreItem('p1', { category: 'PRICE' as any, name: '价格', maxScore: 30 }, { userId: 'u1', role: 'bid_host' })).resolves.toBeDefined();
  });

  it('createScoreItem 在 EVALUATING 阶段锁定抛 ConflictException', async () => {
    prisma.bidProject.findUnique.mockResolvedValue({ stage: 'EVALUATING', name: '项目A' });
    await expect(service.createScoreItem('p1', { category: 'PRICE' as any, name: '价格', maxScore: 30 }, { userId: 'u1', role: 'bid_host' }))
      .rejects.toThrow(ConflictException);
    expect(prisma.bidScoreItem.create).not.toHaveBeenCalled();
  });

  it('createScoreItem 在 ARCHIVED 阶段锁定抛 ConflictException', async () => {
    prisma.bidProject.findUnique.mockResolvedValue({ stage: 'ARCHIVED', name: '项目A' });
    await expect(service.createScoreItem('p1', { category: 'PRICE' as any, name: '价格', maxScore: 30 }, { userId: 'u1', role: 'bid_host' }))
      .rejects.toThrow(ConflictException);
  });

  it('createScoreItem 项目不存在抛 BadRequestException', async () => {
    prisma.bidProject.findUnique.mockResolvedValue(null);
    await expect(service.createScoreItem('p1', { category: 'PRICE' as any, name: '价格', maxScore: 30 }, { userId: 'u1', role: 'bid_host' }))
      .rejects.toThrow(BadRequestException);
  });

  it('updateScoreItem 校验评分项归属本项目', async () => {
    prisma.bidProject.findUnique.mockResolvedValue({ stage: 'SUBMIT', name: '项目A' });
    prisma.bidScoreItem.findFirst.mockResolvedValue(null); // 不属于本项目
    await expect(service.updateScoreItem('p1', 'iX', { name: '改名' }, { userId: 'u1', role: 'bid_host' })).rejects.toThrow(BadRequestException);
  });

  it('P1-17：事务内复查——并发进入 EVALUATING 后改标准 → SCORE_ITEMS_LOCKED', async () => {
    // 事务外读：OPENING（可编辑）；事务内 FOR UPDATE 重读：EVALUATING（已被并发流转锁定）
    prisma.bidProject.findUnique
      .mockResolvedValueOnce({ stage: 'OPENING', name: 'P', scoreStandardPublishedAt: null })
      .mockResolvedValueOnce({ stage: 'EVALUATING', name: 'P', scoreStandardPublishedAt: null });
    prisma.bidScoreItem.findFirst.mockResolvedValue({ id: 'i1', projectId: 'p1', category: 'TECHNICAL', maxScore: 50, name: '技术' });
    await expect(service.updateScoreItem('p1', 'i1', { maxScore: 40 }, { userId: 'u1', role: 'bid_host' }))
      .rejects.toMatchObject({ response: { code: 'SCORE_ITEMS_LOCKED' } });
  });

  it('deleteScoreItem 仅在编辑窗口内放行', async () => {
    prisma.bidProject.findUnique.mockResolvedValue({ stage: 'EVALUATING', name: '项目A' });
    await expect(service.deleteScoreItem('p1', 'i1', { userId: 'u1', role: 'bid_host' })).rejects.toThrow(ConflictException);
  });

  it('applyScoreItemTemplate 幂等：仅补齐缺失项', async () => {
    prisma.bidProject.findUnique.mockResolvedValue({ stage: 'SUBMIT', name: '项目A' });
    // 已存在「资格性审查」一项
    prisma.bidScoreItem.findMany
      .mockResolvedValueOnce([{ name: '资格性审查' }])              // 去重查询
      .mockResolvedValue([{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }, { id: 'e' }]); // 模板应用后回读

    await service.applyScoreItemTemplate('p1', { userId: 'u1', role: 'bid_host' });
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
    await service.applyScoreItemTemplate('p1', { userId: 'u1', role: 'bid_host' });
    expect(prisma.bidScoreItem.createMany).not.toHaveBeenCalled();
  });

  it('applyScoreItemTemplate 在 EVALUATING 阶段锁定', async () => {
    prisma.bidProject.findUnique.mockResolvedValue({ stage: 'EVALUATING', name: '项目A' });
    await expect(service.applyScoreItemTemplate('p1', { userId: 'u1', role: 'bid_host' })).rejects.toThrow(ConflictException);
  });

  it('listScoreTemplates select 含 createdById（前端区分我的/公共）', async () => {
    prisma.scoreTemplate.findMany.mockResolvedValue([
      { id: 't1', name: '水务通用', createdById: 'u1', createdByName: '张三', createdAt: new Date() },
      { id: 't2', name: '公共模板', createdById: null, createdByName: null, createdAt: new Date() },
    ]);
    const res = await service.listScoreTemplates('u1');
    expect(prisma.scoreTemplate.findMany).toHaveBeenCalledWith(expect.objectContaining({
      select: expect.objectContaining({ id: true, name: true, createdById: true, createdByName: true, createdAt: true }),
    }));
    expect(res).toHaveLength(2);
    expect(res[0].createdById).toBe('u1');
    expect(res[1].createdById).toBeNull();
  });

  it('saveScoreTemplate 写入 createdById + createdByName', async () => {
    prisma.bidScoreItem.findMany.mockResolvedValue([{ category: 'TECHNICAL', name: '技术', maxScore: 50, points: [] }]);
    prisma.scoreTemplate.create.mockResolvedValue({ id: 't9' });
    await service.saveScoreTemplate('p1', '我的模板', 'u1', '陈源远');
    expect(prisma.scoreTemplate.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ name: '我的模板', createdById: 'u1', createdByName: '陈源远' }),
    }));
  });

  it('P2：公共模板（createdById=null）非管理员删除 → FORBIDDEN', async () => {
    prisma.scoreTemplate.findUnique.mockResolvedValue({ id: 't1', createdById: null });
    await expect(service.deleteScoreTemplate('t1', 'u1', 'procurement_staff')).rejects.toMatchObject({ response: { code: 'FORBIDDEN' } });
    expect(prisma.scoreTemplate.delete).not.toHaveBeenCalled();
  });

  it('P2：公共模板管理员可删除', async () => {
    prisma.scoreTemplate.findUnique.mockResolvedValue({ id: 't1', createdById: null });
    await expect(service.deleteScoreTemplate('t1', 'u1', 'admin')).resolves.toMatchObject({ deleted: true });
    expect(prisma.scoreTemplate.delete).toHaveBeenCalled();
  });

  it('P2：私有模板他人删除 → FORBIDDEN', async () => {
    prisma.scoreTemplate.findUnique.mockResolvedValue({ id: 't1', createdById: 'owner' });
    await expect(service.deleteScoreTemplate('t1', 'intruder', 'procurement_staff')).rejects.toMatchObject({ response: { code: 'FORBIDDEN' } });
  });

  it('P2：私有模板创建者可删除', async () => {
    prisma.scoreTemplate.findUnique.mockResolvedValue({ id: 't1', createdById: 'owner' });
    await expect(service.deleteScoreTemplate('t1', 'owner', 'procurement_staff')).resolves.toMatchObject({ deleted: true });
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
      $queryRaw: jest.fn().mockResolvedValue([]),
      $transaction: jest.fn(async (cb: any) => cb(prisma)),
    };
    const module = await Test.createTestingModule({
      providers: [
        { provide: PrismaService, useValue: prisma },
        { provide: NotificationService, useValue: { create: jest.fn() } },
        { provide: ScoreStandardValidator, useValue: { assertPassFailMaxScore: jest.fn(), assertPointsSumWithinMax: jest.fn().mockResolvedValue(undefined), assertScoreStandardComplete: jest.fn().mockResolvedValue(undefined) } },
        { provide: PriceFormulaService, useValue: { calculate: jest.fn().mockReturnValue(new Map()), getOverCeilingSuppliers: jest.fn().mockReturnValue([]) } },
        BidService,
        { provide: StorageService, useValue: { upload: jest.fn() } },
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

  it.each([
    ['供应商已确认'],
    ['供应商提出异议'],
    ['异议已处理-确认'],
    ['异议已处理-退回'],
  ])('I1 状态门：%s 态记录重录唱标 → 409 RECORD_LOCKED（防异议态被覆写后撞 R7 成楔子）', async (confirmStatus) => {
    prisma.bidProject.findUnique.mockResolvedValue({ stage: 'OPENING', name: '项目A' });
    prisma.bidSupplier.findFirst.mockResolvedValue({ id: 'bs1', supplierName: '甲公司', decryptStatus: 'SUCCESS' });
    prisma.bidOpeningRecord.findFirst.mockResolvedValue({ id: 'r1', confirmStatus });

    // Wave 5-2：409 文案须指向"异议处理结果闭环"（resolve 两结局均终态，旧文案"先处理异议再操作"
    // 误导主持人以为 resolve 后可重录，实际重录永久锁定）
    await expect(service.enterOpeningRecord('p1', dto as any))
      .rejects.toMatchObject({
        response: {
          code: 'RECORD_LOCKED',
          error: expect.stringContaining('请通过异议处理结果（维持/退回）完成闭环'),
        },
      });
    expect(prisma.bidOpeningRecord.update).not.toHaveBeenCalled();
    expect(prisma.bidOpeningRecord.create).not.toHaveBeenCalled();
  });

  it.each([['待供应商确认'], ['待确认']])('I1 状态门：%s 态仍可重录（正常唱标补录路径不挡）', async (confirmStatus) => {
    prisma.bidProject.findUnique.mockResolvedValue({ stage: 'OPENING', name: '项目A' });
    prisma.bidSupplier.findFirst.mockResolvedValue({ id: 'bs1', supplierName: '甲公司', decryptStatus: 'SUCCESS' });
    prisma.bidOpeningRecord.findFirst.mockResolvedValue({ id: 'r1', confirmStatus });
    prisma.bidOpeningRecord.update.mockResolvedValue({ id: 'r1', confirmStatus: '待供应商确认' });

    await expect(service.enterOpeningRecord('p1', dto as any)).resolves.toBeDefined();
    expect(prisma.bidOpeningRecord.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'r1' } }));
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

  it('H11: 供应商已确认（confirmStatus=CONFIRMED）时禁止覆盖唱标信息', async () => {
    prisma.bidProject.findUnique.mockResolvedValue({ stage: 'OPENING', name: '项目A' });
    prisma.bidSupplier.findFirst.mockResolvedValue({ id: 'bs1', supplierName: '甲公司', decryptStatus: 'SUCCESS', confirmStatus: 'CONFIRMED' });
    await expect(service.enterOpeningRecord('p1', dto as any)).rejects.toThrow(ConflictException);
    expect(prisma.bidOpeningRecord.update).not.toHaveBeenCalled();
    expect(prisma.bidOpeningRecord.create).not.toHaveBeenCalled();
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
        { provide: ScoreStandardValidator, useValue: { assertPassFailMaxScore: jest.fn(), assertPointsSumWithinMax: jest.fn().mockResolvedValue(undefined), assertScoreStandardComplete: jest.fn().mockResolvedValue(undefined) } },
        { provide: PriceFormulaService, useValue: { calculate: jest.fn().mockReturnValue(new Map()), getOverCeilingSuppliers: jest.fn().mockReturnValue([]) } },
        BidService,
        { provide: StorageService, useValue: { upload: jest.fn() } },
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
        { provide: ScoreStandardValidator, useValue: { assertPassFailMaxScore: jest.fn(), assertPointsSumWithinMax: jest.fn().mockResolvedValue(undefined), assertScoreStandardComplete: jest.fn().mockResolvedValue(undefined) } },
        { provide: PriceFormulaService, useValue: { calculate: jest.fn().mockReturnValue(new Map()), getOverCeilingSuppliers: jest.fn().mockReturnValue([]) } },
        BidService,
        { provide: StorageService, useValue: { upload: jest.fn() } },
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
      bidSupplier: { findMany: jest.fn().mockResolvedValue([]), update: jest.fn(), create: jest.fn(), findFirst: jest.fn(), findUnique: jest.fn(), count: jest.fn() },
      bidOpeningRecord: { create: jest.fn(), findFirst: jest.fn(), update: jest.fn(), findUnique: jest.fn(), findMany: jest.fn() },
      bidEvaluationResult: { deleteMany: jest.fn(), createMany: jest.fn(), findMany: jest.fn(), count: jest.fn() },
      bidArchiveItem: { findMany: jest.fn(), updateMany: jest.fn(), update: jest.fn(), findFirst: jest.fn(), create: jest.fn(), groupBy: jest.fn() },
      supplierBidSubmission: { findUnique: jest.fn() },
      bidOpeningSession: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
      fileAsset: { findUnique: jest.fn() },
      notification: { create: jest.fn(), createMany: jest.fn() },
      user: { findMany: jest.fn() },
      auditLog: { create: jest.fn() },
      $queryRaw: jest.fn().mockResolvedValue([]),
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
        { provide: ScoreStandardValidator, useValue: { assertPassFailMaxScore: jest.fn(), assertPointsSumWithinMax: jest.fn().mockResolvedValue(undefined), assertScoreStandardComplete: jest.fn().mockResolvedValue(undefined) } },
        { provide: PriceFormulaService, useValue: { calculate: jest.fn().mockReturnValue(new Map()), getOverCeilingSuppliers: jest.fn().mockReturnValue([]) } },
        BidService,
        { provide: StorageService, useValue: { upload: jest.fn() } },
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
        { provide: ScoreStandardValidator, useValue: { assertPassFailMaxScore: jest.fn(), assertPointsSumWithinMax: jest.fn().mockResolvedValue(undefined), assertScoreStandardComplete: jest.fn().mockResolvedValue(undefined) } },
        { provide: PriceFormulaService, useValue: { calculate: jest.fn().mockReturnValue(new Map()), getOverCeilingSuppliers: jest.fn().mockReturnValue([]) } },
        BidService,
        { provide: StorageService, useValue: { upload: jest.fn() } },
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
        { provide: ScoreStandardValidator, useValue: { assertPassFailMaxScore: jest.fn(), assertPointsSumWithinMax: jest.fn().mockResolvedValue(undefined), assertScoreStandardComplete: jest.fn().mockResolvedValue(undefined) } },
        { provide: PriceFormulaService, useValue: { calculate: jest.fn().mockReturnValue(new Map()), getOverCeilingSuppliers: jest.fn().mockReturnValue([]) } },
        BidService,
        { provide: StorageService, useValue: { upload: jest.fn() } },
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

  it('密封 bidPrice（v1: 前缀）在 OPENING+SUCCESS 时被 openField 拆封为明文', async () => {
    // 入库后 bidPrice 是密封态；主持人查询唱标草稿时应当拿到明文。
    const sealedPrice = sealField('980000', BID_SPEC_KMS);
    expect(sealedPrice).toMatch(/^v1:/);

    prisma.bidProject.findUnique.mockResolvedValue({ id: 'p1', stage: 'OPENING', qualityRequirement: '合格', bondRequired: false });
    prisma.bidSupplier.findFirst.mockResolvedValue({ id: 's1', supplierId: 'su1', decryptStatus: 'SUCCESS', supplierName: '甲' });
    prisma.supplierBidSubmission.findUnique.mockResolvedValue({ bidPrice: sealedPrice, deliveryPeriod: '180天', bidBondAssetId: null });
    prisma.bidOpeningRecord.findFirst.mockResolvedValue({ bondStatus: '已缴纳' });

    const draft = await service.getOpeningRecordDraft('p1', 's1');
    expect(draft.canView).toBe(true);
    expect(draft.amount).toBe('980000'); // 拆封后明文
    expect(draft.period).toBe('180天');
  });

  it('旧明文 bidPrice（无 v1: 前缀）经 openField legacy 兼容原样返回', async () => {
    // 防回归：已存在的旧明文行不应因引入密封而被破坏。
    prisma.bidProject.findUnique.mockResolvedValue({ id: 'p1', stage: 'OPENING', qualityRequirement: '合格', bondRequired: false });
    prisma.bidSupplier.findFirst.mockResolvedValue({ id: 's1', supplierId: 'su1', decryptStatus: 'SUCCESS', supplierName: '甲' });
    prisma.supplierBidSubmission.findUnique.mockResolvedValue({ bidPrice: '770000', deliveryPeriod: '90天', bidBondAssetId: null });
    prisma.bidOpeningRecord.findFirst.mockResolvedValue(null);

    const draft = await service.getOpeningRecordDraft('p1', 's1');
    expect(draft.amount).toBe('770000');
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
      bidInvalidBid: { findMany: jest.fn().mockResolvedValue([]) },
      $transaction: jest.fn(async (cb: any) => cb({
        bidEvaluationResult: { deleteMany: jest.fn(), createMany: jest.fn() },
        bidSupervisionLog: { create: jest.fn() },
        bidSupplier: { update: jest.fn() },
      })),
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        { provide: ScoreStandardValidator, useValue: { assertPassFailMaxScore: jest.fn(), assertPointsSumWithinMax: jest.fn().mockResolvedValue(undefined), assertScoreStandardComplete: jest.fn().mockResolvedValue(undefined) } },
        { provide: PriceFormulaService, useValue: { calculate: jest.fn().mockReturnValue(new Map()), getOverCeilingSuppliers: jest.fn().mockReturnValue([]) } },
        BidService,
        { provide: StorageService, useValue: { upload: jest.fn() } },
        { provide: PrismaService, useValue: prisma },
        { provide: NotificationService, useValue: { sendToRole: jest.fn() } },
        { provide: BidGateway, useValue: { notifySupervisionLog: jest.fn() } },
      ],
    }).compile();
    service = module.get(BidService);
  });

  it('bondRequired 且某供应商保证金未达标 → 写高风险监督日志，但仍纳入排名', async () => {
    prisma.bidProject.findUnique.mockResolvedValue({
      id: 'p1', name: 'X', stage: 'EVALUATING', bondRequired: true, leaderCoSigned: true,
      experts: [{ reportConfirmed: true }],
      suppliers: [{ id: 's1', supplierName: '甲', decryptStatus: 'SUCCESS', submitStatus: '已提交', confirmStatus: 'CONFIRMED' }],
    });
    prisma.bidOpeningRecord.findMany.mockResolvedValue([{ bidSupplierId: 's1', bondStatus: '未缴纳' }]);
    const txLogCreate = jest.fn();
    prisma.$transaction.mockImplementation(async (cb: any) => cb({
      bidEvaluationResult: { deleteMany: jest.fn(), createMany: jest.fn() },
      bidSupervisionLog: { create: txLogCreate },
      bidSupplier: { update: jest.fn() },
    }));

    await service.generateEvaluationResults('p1', 'actor1');

    const flagged = txLogCreate.mock.calls.find(
      (c: any[]) => c[0].data.riskFlag === '高风险' && String(c[0].data.action).includes('保证金'),
    );
    expect(flagged).toBeTruthy();
  });

  it('bondRequired=false → 不写保证金监督日志', async () => {
    prisma.bidProject.findUnique.mockResolvedValue({
      id: 'p1', name: 'X', stage: 'EVALUATING', bondRequired: false, leaderCoSigned: true,
      experts: [{ reportConfirmed: true }],
      suppliers: [{ id: 's1', supplierName: '甲', decryptStatus: 'SUCCESS', submitStatus: '已提交', confirmStatus: 'CONFIRMED' }],
    });
    const txLogCreate = jest.fn();
    prisma.$transaction.mockImplementation(async (cb: any) => cb({
      bidEvaluationResult: { deleteMany: jest.fn(), createMany: jest.fn() },
      bidSupervisionLog: { create: txLogCreate },
      bidSupplier: { update: jest.fn() },
    }));

    await service.generateEvaluationResults('p1', 'actor1');

    const flagged = txLogCreate.mock.calls.find((c: any[]) => String(c[0].data.action).includes('保证金'));
    expect(flagged).toBeUndefined();
  });
});

/* ── 得分点管理（ScorePoint CRUD）── */

describe('BidService — 得分点管理 (ScorePoint CRUD)', () => {
  let service: BidService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      bidProject: { findUnique: jest.fn() },
      bidScoreItem: { findMany: jest.fn(), findFirst: jest.fn(), create: jest.fn(), update: jest.fn(), delete: jest.fn(), createMany: jest.fn() },
      bidScorePoint: { findMany: jest.fn(), findFirst: jest.fn(), create: jest.fn(), update: jest.fn(), delete: jest.fn(), createMany: jest.fn() },
      bidSupervisionLog: { create: jest.fn() },
      $queryRaw: jest.fn().mockResolvedValue([]),
      $transaction: jest.fn(async (cb: any) => cb(prisma)),
    };
    const module = await Test.createTestingModule({
      providers: [
        { provide: PrismaService, useValue: prisma },
        { provide: NotificationService, useValue: { create: jest.fn() } },
        { provide: ScoreStandardValidator, useValue: { assertPassFailMaxScore: jest.fn(), assertPointsSumWithinMax: jest.fn().mockResolvedValue(undefined), assertScoreStandardComplete: jest.fn().mockResolvedValue(undefined) } },
        { provide: PriceFormulaService, useValue: { calculate: jest.fn().mockReturnValue(new Map()), getOverCeilingSuppliers: jest.fn().mockReturnValue([]) } },
        BidService,
        { provide: StorageService, useValue: { upload: jest.fn() } },
      ],
    }).compile();
    service = module.get(BidService);
    jest.clearAllMocks();
    // item 归属项目 + SUBMIT 阶段（可编辑）
    prisma.bidScoreItem.findFirst.mockResolvedValue({ id: 'i1', projectId: 'p1', project: { stage: 'SUBMIT' } });
    prisma.bidProject.findUnique.mockResolvedValue({ id: 'p1', stage: 'SUBMIT', name: '项目' });
  });

  it('listScorePoints 按 seq 排序返回', async () => {
    prisma.bidScorePoint.findMany.mockResolvedValue([{ id: 'pt1' }, { id: 'pt2' }]);
    const r = await service.listScorePoints('p1', 'i1');
    expect(r).toEqual([{ id: 'pt1' }, { id: 'pt2' }]);
    expect(prisma.bidScorePoint.findMany).toHaveBeenCalledWith({
      where: { scoreItemId: 'i1', scoreItem: { projectId: 'p1' } },
      orderBy: [{ seq: 'asc' }, { createdAt: 'asc' }],
    });
  });

  it('createScorePoint 写入字段，objective 默认 true', async () => {
    prisma.bidScorePoint.create.mockResolvedValue({ id: 'pt1' });
    await service.createScorePoint('p1', 'i1', { name: '施工组织', fullScore: 10 });
    expect(prisma.bidScorePoint.create).toHaveBeenCalledWith({
      data: { scoreItemId: 'i1', name: '施工组织', fullScore: 10, seq: 0, evidenceHint: null, objective: true },
    });
  });

  it('createScorePoint 在 EVALUATING 阶段锁定抛 ConflictException', async () => {
    prisma.bidScoreItem.findFirst.mockResolvedValue({ id: 'i1', projectId: 'p1', project: { stage: 'EVALUATING' } });
    await expect(service.createScorePoint('p1', 'i1', { name: 'x', fullScore: 1 })).rejects.toThrow();
    expect(prisma.bidScorePoint.create).not.toHaveBeenCalled();
  });

  it('createScorePoint 评分项不归属项目抛 BadRequestException', async () => {
    prisma.bidScoreItem.findFirst.mockResolvedValue(null);
    await expect(service.createScorePoint('p1', 'iX', { name: 'x', fullScore: 1 })).rejects.toThrow();
  });

  it('updateScorePoint 部分透传', async () => {
    prisma.bidScorePoint.findFirst.mockResolvedValue({ id: 'pt1', scoreItemId: 'i1' });
    prisma.bidScorePoint.update.mockResolvedValue({ id: 'pt1' });
    await service.updateScorePoint('p1', 'i1', 'pt1', { fullScore: 8, objective: false });
    expect(prisma.bidScorePoint.update).toHaveBeenCalledWith({
      where: { id: 'pt1' },
      data: { fullScore: 8, objective: false },
    });
  });

  it('updateScorePoint 得分点不存在抛 BadRequestException', async () => {
    prisma.bidScorePoint.findFirst.mockResolvedValue(null);
    await expect(service.updateScorePoint('p1', 'i1', 'ptX', { fullScore: 8 })).rejects.toThrow();
  });

  it('deleteScorePoint 调用 prisma.delete', async () => {
    prisma.bidScorePoint.findFirst.mockResolvedValue({ id: 'pt1', scoreItemId: 'i1' });
    prisma.bidScorePoint.delete.mockResolvedValue({ id: 'pt1' });
    await service.deleteScorePoint('p1', 'i1', 'pt1');
    expect(prisma.bidScorePoint.delete).toHaveBeenCalledWith({ where: { id: 'pt1' } });
  });

  it('deleteScorePoint 得分点不属于该评分项抛 BadRequestException', async () => {
    prisma.bidScorePoint.findFirst.mockResolvedValue(null);
    await expect(service.deleteScorePoint('p1', 'i1', 'ptX')).rejects.toThrow();
    expect(prisma.bidScorePoint.delete).not.toHaveBeenCalled();
  });

  it('batchCreateScorePoints 批量创建并校验阶段锁', async () => {
    // SUBMIT 阶段放行
    prisma.bidScoreItem.findFirst.mockResolvedValue({ id: 'i1', projectId: 'p1', project: { stage: 'SUBMIT' } });
    prisma.bidScorePoint.createMany.mockResolvedValue({ count: 2 });
    const r = await service.batchCreateScorePoints('p1', 'i1', {
      points: [
        { name: '点A', fullScore: 5 },
        { name: '点B', fullScore: 3, objective: false },
      ],
    });
    expect(r).toEqual({ count: 2 });
    expect(prisma.bidScorePoint.createMany).toHaveBeenCalledWith({
      data: [
        { scoreItemId: 'i1', name: '点A', fullScore: 5, evidenceHint: null, evidenceSection: null, confidence: null, objective: true },
        { scoreItemId: 'i1', name: '点B', fullScore: 3, evidenceHint: null, evidenceSection: null, confidence: null, objective: false },
      ],
    });
  });

  it('batchCreateScorePoints EVALUATING 阶段锁定抛错', async () => {
    prisma.bidScoreItem.findFirst.mockResolvedValue({ id: 'i1', projectId: 'p1', project: { stage: 'EVALUATING' } });
    await expect(service.batchCreateScorePoints('p1', 'i1', { points: [{ name: 'x', fullScore: 1 }] })).rejects.toThrow();
    expect(prisma.bidScorePoint.createMany).not.toHaveBeenCalled();
  });

  it('listScoreItems include points', async () => {
    prisma.bidScoreItem.findMany.mockResolvedValue([{ id: 'i1', points: [] }]);
    await service.listScoreItems('p1');
    expect(prisma.bidScoreItem.findMany).toHaveBeenCalledWith({
      where: { projectId: 'p1' },
      orderBy: [{ category: 'asc' }, { createdAt: 'asc' }],
      include: { points: { orderBy: [{ seq: 'asc' }, { createdAt: 'asc' }] } },
    });
  });
});

/* ── 废标复核撤销（revokeInvalidBid）── */

describe('BidService — revokeInvalidBid (废标复核撤销)', () => {
  let service: BidService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      bidExpert: { findFirst: jest.fn() },
      bidInvalidBid: { findUnique: jest.fn(), findFirst: jest.fn(), update: jest.fn() },
      bidSupplier: { update: jest.fn() },
      bidSupervisionLog: { create: jest.fn() },
      $queryRaw: jest.fn().mockResolvedValue([]),
      $transaction: jest.fn(async (cb: any) => cb(prisma)),
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        { provide: ScoreStandardValidator, useValue: { assertPassFailMaxScore: jest.fn(), assertPointsSumWithinMax: jest.fn().mockResolvedValue(undefined), assertScoreStandardComplete: jest.fn().mockResolvedValue(undefined) } },
        { provide: PriceFormulaService, useValue: { calculate: jest.fn().mockReturnValue(new Map()), getOverCeilingSuppliers: jest.fn().mockReturnValue([]) } },
        BidService,
        { provide: StorageService, useValue: { upload: jest.fn() } },
        { provide: PrismaService, useValue: prisma },
        { provide: NotificationService, useValue: { sendToRole: jest.fn() } },
        { provide: BidGateway, useValue: { notifyBidValidity: jest.fn() } },
      ],
    }).compile();
    service = module.get(BidService);
  });

  it('invalid → revoked + bidValidity=valid + WS', async () => {
    prisma.bidInvalidBid.findUnique.mockResolvedValue({ id: 'ib1', projectId: 'p1', supplierId: 'sup1', status: 'invalid', failCount: 2, totalCount: 5 });
    prisma.bidInvalidBid.findFirst.mockResolvedValue(null); // 撤销后无剩余 invalid 记录
    prisma.bidInvalidBid.update.mockResolvedValue({ id: 'ib1', status: 'revoked' });
    prisma.bidExpert.findFirst.mockResolvedValue(null); // 未锁定
    await service.revokeInvalidBid('p1', 'sup1', 'si1', 'admin1');
    expect(prisma.bidInvalidBid.update).toHaveBeenCalledWith(expect.objectContaining({
      data: { status: 'revoked', revokedAt: expect.any(Date), revokedBy: 'admin1' },
    }));
    expect(prisma.bidSupplier.update).toHaveBeenCalledWith(expect.objectContaining({
      data: { bidValidity: 'valid' },
    }));
    expect(prisma.bidSupervisionLog.create).toHaveBeenCalled();
  });

  it('reportConfirmed 后 → 不可撤销（LOCKED）', async () => {
    // 任一专家 reportConfirmed=true → 拒绝
    prisma.bidExpert.findFirst.mockResolvedValue({ id: 'exp1', reportConfirmed: true });
    await expect(service.revokeInvalidBid('p1', 'sup1', 'si1', 'admin1'))
      .rejects.toMatchObject({ response: { code: 'LOCKED' } });
    expect(prisma.bidInvalidBid.update).not.toHaveBeenCalled();
  });
});
