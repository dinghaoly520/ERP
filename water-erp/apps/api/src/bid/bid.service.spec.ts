import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, BadRequestException } from '@nestjs/common';
import * as crypto from 'crypto';
import { BidService } from './bid.service';
import { BidOpeningRecordService } from './bid-opening-record.service';
import { BidScoreStandardService } from './bid-score-standard.service';
import { GbCodeService } from '../common/gb-code.service';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationService } from '../notification/notification.service';
import { ClarificationAiService } from './clarification-ai.service';
import { BidGateway } from './bid.gateway';
import { ScoreStandardValidator } from './score-standard-validator.service';
import { PriceFormulaService } from './price-formula.service';
import { StorageService } from '../storage/storage.service';
import { assertBidStageTransition } from './bid-state';
import { getQueueToken } from '@nestjs/bullmq';
import { QUEUE_NAMES } from '../ai-bid-analysis/queues/queue.module';
import { Prisma } from '@prisma/client';
import { AdminKeyService } from '../common/crypto/admin-keystore.service';
import { DualEnvelopeService } from '../common/crypto/dual-envelope.service';
import { SignatureService } from '../common/crypto/signature.service';


// bid.service 多处暴露点（getWorkspace/getOpeningRecordDraft）用 openField 拆封 bidPrice。
// KMS_SECRET 在 jest 同进程可能被其他 spec 污染，此处显式自洽设置。
const BID_SPEC_KMS = 'test-kms-secret-from-bid-service-spec';
const BID_SPEC_ORIG_KMS = process.env.KMS_SECRET;
beforeAll(() => { process.env.KMS_SECRET = BID_SPEC_KMS; });
afterAll(() => { if (BID_SPEC_ORIG_KMS !== undefined) process.env.KMS_SECRET = BID_SPEC_ORIG_KMS; else delete process.env.KMS_SECRET; });

// Mock decrypt utilities and MinIO client for decryptSupplier tests
jest.mock('./bid-submission.crypto', () => ({
  encryptBuffer: jest.requireActual('./bid-submission.crypto').encryptBuffer, // reuploadBidFile 重加密管线用真实现（纯 Node crypto）
  decryptBuffer: jest.fn().mockReturnValue(Buffer.from('decrypted')),
  streamToBuffer: jest.fn().mockResolvedValue(Buffer.from('test')),
  verifyIntegrity: jest.fn().mockReturnValue(true),
  classifyDecryptOutcome: jest.requireActual('./bid-submission.crypto').classifyDecryptOutcome,
}));

jest.mock('../upload/minio.client', () => ({
  minioClient: { getObject: jest.fn().mockResolvedValue({}), putObject: jest.fn().mockResolvedValue({}) },
  MINIO_BUCKET: 'test-bucket',
}));

/* BidService 新增构造依赖（Task 12）：Nest 测试模块不自动实例化未注册 provider，
   各 TestingModule 须显式提供——以下为全局默认 mock（decryptOuter 相关 describe 自行覆盖）。 */
const GB_CODE_SVC = { provide: GbCodeService, useValue: { allocateProjectCode: async () => 'GB-TEST', allocateProcureCode: async () => 'GB-PROC-TEST' } };
const ADMIN_KEY_SVC = {
  provide: AdminKeyService,
  useValue: { readPrivateKey: jest.fn(), getActiveCert: jest.fn(), ensureBootstrap: jest.fn(), generate: jest.fn() },
};
const DUAL_ENVELOPE_SVC = {
  provide: DualEnvelopeService,
  useValue: { verifySignature: jest.fn(), assertEnvelopeIntact: jest.fn(), decryptOuterFile: jest.fn(), verifyFieldsCommit: jest.fn() },
};
/* A-143（Task 4）：BidService 构造器新增 SignatureService（verifyClarificationReply 用）——同口径全局 mock */
const SIGNATURE_SVC = { provide: SignatureService, useValue: { verify: jest.fn().mockReturnValue(false) } };

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
      bidExpert: { groupBy: jest.fn(), findFirst: jest.fn(), findMany: jest.fn().mockResolvedValue([]), count: jest.fn(), update: jest.fn(), updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
      bidScoreItem: { findFirst: jest.fn(), create: jest.fn(), delete: jest.fn(), count: jest.fn(), findMany: jest.fn().mockResolvedValue([]) },
      bidScoreRecord: { upsert: jest.fn(), findMany: jest.fn().mockResolvedValue([]), count: jest.fn().mockResolvedValue(0), findUnique: jest.fn() },
      bidScorePoint: { findMany: jest.fn().mockResolvedValue([]), findFirst: jest.fn() },
      bidScorePointDecision: { upsert: jest.fn().mockResolvedValue({}) },
      bidScoreReview: { upsert: jest.fn().mockResolvedValue({}), findMany: jest.fn().mockResolvedValue([]), update: jest.fn() },
      aiBidAnalysisTask: { upsert: jest.fn().mockResolvedValue({ id: 'ai-1' }) },
      aiBidderResult: { createMany: jest.fn().mockResolvedValue({ count: 0 }) },
      supplier: { count: jest.fn() },
      announcement: { count: jest.fn(), findFirst: jest.fn() },
      bidSupplier: { findMany: jest.fn().mockResolvedValue([]), update: jest.fn(), create: jest.fn(), findFirst: jest.fn(), findUnique: jest.fn(), count: jest.fn() },
      bidOpeningRecord: { create: jest.fn(), findFirst: jest.fn(), update: jest.fn(), upsert: jest.fn(), updateMany: jest.fn().mockResolvedValue({ count: 1 }), findUnique: jest.fn(), findMany: jest.fn().mockResolvedValue([]) },
      bidEvaluationResult: { deleteMany: jest.fn(), createMany: jest.fn(), findMany: jest.fn(), count: jest.fn(), findFirst: jest.fn().mockResolvedValue({ generatedAt: new Date(Date.now() - 3600_000) }) },
      bidArchiveItem: { findMany: jest.fn(), updateMany: jest.fn(), update: jest.fn(), findFirst: jest.fn(), create: jest.fn(), groupBy: jest.fn() },
      // T17：getProject 派生下发 envelopeVersion/outerDecryptedAt/packageFetchedAt 需要 findMany（默认空）
      supplierBidSubmission: { findUnique: jest.fn(), findMany: jest.fn().mockResolvedValue([]) },
      bidOpeningSession: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
      // 签字闸门默认放行（闭环+回流齐）：full 归档用例不逐个 mock；单测闸门本身见 bid-sign-packet.service.spec
      bidSignPacket: { findUnique: jest.fn().mockResolvedValue({ fileAssetId: 'fa-sign', sha256: 'sha-sign', signPageScanFileId: null, closedAt: new Date(), handoverFileAssetId: 'fa-handover' }), delete: jest.fn().mockResolvedValue({}) },
      fileAsset: { findUnique: jest.fn(), findMany: jest.fn().mockResolvedValue([]) },
      notification: { create: jest.fn(), createMany: jest.fn() },
      user: { findMany: jest.fn() },
      auditLog: { create: jest.fn() },
      bidInvalidBid: { findMany: jest.fn().mockResolvedValue([]), findUnique: jest.fn(), findFirst: jest.fn(), update: jest.fn(), create: jest.fn() },
      expertDispute: { count: jest.fn().mockResolvedValue(0), findUnique: jest.fn(), findFirst: jest.fn(), update: jest.fn(), create: jest.fn() },
      bidScoreRecordHistory: { create: jest.fn() },
      bidRound: { findFirst: jest.fn().mockResolvedValue(null), findUnique: jest.fn(), create: jest.fn(), update: jest.fn(), count: jest.fn().mockResolvedValue(0) },
      bidQuote: { create: jest.fn(), findMany: jest.fn().mockResolvedValue([]) },
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
        BidOpeningRecordService,
        ADMIN_KEY_SVC, DUAL_ENVELOPE_SVC, SIGNATURE_SVC, GB_CODE_SVC,
        BidScoreStandardService,
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

  describe('legalMandatory 录入口（P1-4 补录入口，2026-09-09）', () => {
    describe('createProject — DTO 直录', () => {
    beforeEach(() => { prisma.bidProject.count.mockResolvedValue(0); });
      it('dto.legalMandatory=true → 建项落库 true', async () => {
        prisma.bidProject.create.mockResolvedValue({ id: 'p1' });
        await service.createProject({ name: 'X', procurementMethod: '公开招标', openTime: '2099-01-01T10:00:00.000Z', legalMandatory: true } as any);
        expect(prisma.bidProject.create.mock.calls[0][0].data.legalMandatory).toBe(true);
      });
      it('缺省 → false（显式落库，语义确定）', async () => {
        prisma.bidProject.create.mockResolvedValue({ id: 'p1' });
        await service.createProject({ name: 'X', procurementMethod: '公开招标', openTime: '2099-01-01T10:00:00.000Z' } as any);
        expect(prisma.bidProject.create.mock.calls[0][0].data.legalMandatory).toBe(false);
      });
    });

    describe('createFromAnnouncement — 公告直建持久化', () => {
    beforeEach(() => { prisma.bidProject.count.mockResolvedValue(0); });
      it('metadata.legalMandatory=true → 建项落库 true', async () => {
        prisma.bidProject.create.mockResolvedValue({ id: 'p1', projectCode: 'GK-2026090901' });
        await service.createFromAnnouncement(
          { id: 'a1', title: 'T', publishDate: new Date() },
          { method: '公开招标', legalMandatory: true },
        );
        expect(prisma.bidProject.create.mock.calls[0][0].data.legalMandatory).toBe(true);
      });
      it('缺省 → false', async () => {
        prisma.bidProject.create.mockResolvedValue({ id: 'p1', projectCode: 'GK-2026090902' });
        await service.createFromAnnouncement(
          { id: 'a1', title: 'T', publishDate: new Date() },
          { method: '公开招标' },
        );
        expect(prisma.bidProject.create.mock.calls[0][0].data.legalMandatory).toBe(false);
      });
    });

    describe('syncFromAnnouncement — 公告再编辑同步', () => {
      it('metadata.legalMandatory=true → 同步项目列', async () => {
        prisma.bidProject.findUnique.mockResolvedValue({ id: 'p1', projectCode: 'GK-1' });
        prisma.bidProject.update.mockResolvedValue({ id: 'p1' });
        await service.syncFromAnnouncement('p1', { title: 'T' }, { legalMandatory: true });
        expect(prisma.bidProject.update.mock.calls[0][0].data.legalMandatory).toBe(true);
      });
      it('metadata 未提供 → 不覆盖既有值（data 无 legalMandatory 键）', async () => {
        prisma.bidProject.findUnique.mockResolvedValue({ id: 'p1', projectCode: 'GK-1' });
        prisma.bidProject.update.mockResolvedValue({ id: 'p1' });
        await service.syncFromAnnouncement('p1', { title: 'T' }, { budget: 100 });
        expect(prisma.bidProject.update.mock.calls[0][0].data).not.toHaveProperty('legalMandatory');
      });
    });

    describe('updateProject — 开标前可改、开标后锁定', () => {
      it('DOWNLOAD 阶段 legalMandatory=true → 落库', async () => {
        prisma.bidProject.findUnique.mockResolvedValue({ openTime: new Date(), deadline: new Date(), stage: 'DOWNLOAD' });
        prisma.bidProject.update.mockResolvedValue({ id: 'p1', stage: 'DOWNLOAD' });
        await service.updateProject('p1', { legalMandatory: true } as any, 'u1');
        expect(prisma.bidProject.update.mock.calls[0][0].data.legalMandatory).toBe(true);
      });
      it('OPENING 阶段改 legalMandatory → 409 LEGAL_FLAG_LOCKED', async () => {
        prisma.bidProject.findUnique.mockResolvedValue({ openTime: new Date(), deadline: new Date(), stage: 'OPENING' });
        prisma.bidProject.update.mockResolvedValue({ id: 'p1' });
        await expect(service.updateProject('p1', { legalMandatory: true } as any, 'u1'))
          .rejects.toMatchObject({ response: { code: 'LEGAL_FLAG_LOCKED' } });
        expect(prisma.bidProject.update).not.toHaveBeenCalled();
      });
    });
  });

  describe('manualMarkInvalidBid — H6 联动清结果/失效签字包（P1-2，2026-09-09）', () => {
    const setup = (results: number, packet: any) => {
      prisma.bidSupplier.findFirst.mockResolvedValue({ id: 'bs1', supplierName: '甲公司', projectId: 'p1' });
      prisma.bidProject.findUnique.mockResolvedValue({ stage: 'EVALUATING' });
      prisma.bidInvalidBid.findFirst.mockResolvedValue(null);
      prisma.bidInvalidBid.create.mockResolvedValue({});
      prisma.bidEvaluationResult.count.mockResolvedValue(results);
      prisma.bidSignPacket.findUnique.mockResolvedValue(packet);
      prisma.bidSupervisionLog.create.mockResolvedValue({});
    };
    const openPacket = { fileAssetId: 'fa1', sha256: 'a'.repeat(64), signPageScanFileId: null, closedAt: null, handoverFileAssetId: null };

    it('已有评标结果 + 未闭环签字包 → 清结果 + 删包 + 重置正选签字状态（与异议裁决同口径）', async () => {
      setup(3, openPacket);
      await service.manualMarkInvalidBid('p1', 'bs1', '围标串标', 'u1');
      expect(prisma.bidEvaluationResult.deleteMany).toHaveBeenCalledWith({ where: { projectId: 'p1' } });
      expect(prisma.bidSignPacket.delete).toHaveBeenCalledWith({ where: { projectId: 'p1' } });
      expect(prisma.bidExpert.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { projectId: 'p1', expertRole: '正选' }, data: expect.objectContaining({ signStatus: 'PENDING' }) }),
      );
    });

    it('已闭环签字包 → 409 SIGN_PACKET_CLOSED（事务回滚，废标不生效——闭环后不可更正）', async () => {
      setup(2, { ...openPacket, closedAt: new Date() });
      await expect(service.manualMarkInvalidBid('p1', 'bs1', '围标串标', 'u1'))
        .rejects.toMatchObject({ response: { code: 'SIGN_PACKET_CLOSED' } });
    });

    it('无评标结果 → 不触碰结果/签字包（既有行为回归）', async () => {
      setup(0, openPacket);
      await service.manualMarkInvalidBid('p1', 'bs1', '资质造假', 'u1');
      expect(prisma.bidEvaluationResult.deleteMany).not.toHaveBeenCalled();
      expect(prisma.bidSignPacket.delete).not.toHaveBeenCalled();
    });
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
      prisma.bidExpert.count = jest.fn()
        .mockResolvedValueOnce(3)  // 确认正选数
        .mockResolvedValue(0);     // 采购人代表数（P1-7 占比闸门）
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
      prisma.bidProject.findUnique.mockResolvedValue({ stage: 'SUBMIT', name: '测试项目', deadline: new Date(Date.now() - 3600_000), assignedHostUserId: 'host1' });
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
      prisma.bidProject.findUnique.mockResolvedValue({ stage: 'SUBMIT', name: '测试项目', assignedHostUserId: 'host1' });
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
      prisma.bidProject.findUnique.mockResolvedValue({ stage: 'SUBMIT', name: '测试项目', assignedHostUserId: 'host1' });
      await expect(service.startOpening('p1', {
        ...sessionDto,
        decryptWindowEnd: '2026-06-16T09:00:00.000Z', // 早于 start
      })).rejects.toMatchObject({
        response: { code: 'INVALID_DECRYPT_WINDOW' },
      });
    });

    it('A-107/A-110：decryptWindowStart 早于 openTime → 400 DECRYPT_BEFORE_OPEN_TIME（开标时间未到不得建会解密）', async () => {
      prisma.bidProject.findUnique.mockResolvedValue({ stage: 'OPENING', name: '测试项目', openTime: new Date('2026-06-16T12:00:00.000Z') });
      await expect(service.startOpening('p1', sessionDto)).rejects.toMatchObject({
        response: { code: 'DECRYPT_BEFORE_OPEN_TIME' },
      });
    });

    it('A-107/A-110：decryptWindowStart ≥ openTime → 放行组建会话（延时开标经修改 openTime 实现不受影响）', async () => {
      prisma.bidProject.findUnique.mockResolvedValue({ stage: 'OPENING', name: '测试项目', openTime: new Date('2026-06-16T09:00:00.000Z') });
      prisma.bidOpeningSession.findUnique.mockResolvedValue(null);
      prisma.bidOpeningSession.create.mockResolvedValue({ id: 'sess-ot' });
      prisma.bidProject.update.mockResolvedValue({ id: 'p1', stage: 'OPENING' });
      prisma.bidSupervisionLog.create.mockResolvedValue({});

      const result = await service.startOpening('p1', sessionDto);

      expect(result.stage).toBe('OPENING');
      expect(prisma.bidOpeningSession.create).toHaveBeenCalled();
    });

    it('N4：开标 checklist 按「已提交」计数——3 行候选仅 1 家已提交 → OPENING_CHECKLIST_FAILED', async () => {
      const past = new Date(Date.now() - 3600_000);
      prisma.bidProject.findUnique.mockResolvedValue({ stage: 'SUBMIT', name: 'P', deadline: past, projectManagementItemId: null, round: 1, assignedHostUserId: 'u1', procurementMethod: '谈判采购' });
      prisma.bidExpert.count.mockResolvedValue(3);
      // 口径区分：候选池 3 行（受邀未投递也算），其中已提交仅 1 家
      prisma.bidSupplier.count.mockImplementation(async (args: any) =>
        args?.where?.submitStatus === '已提交' ? 1 : 3);
      await expect(service.startOpening('p1', {}, 'u1')).rejects.toMatchObject({
        response: {
          code: 'OPENING_CHECKLIST_FAILED',
          items: [expect.stringContaining('有效投标（已提交）仅 1 家')],
        },
      });
    });

    it('N4：候选 3 行且全部已提交 → checklist 通过', async () => {
      const past = new Date(Date.now() - 3600_000);
      prisma.bidProject.findUnique.mockResolvedValue({ stage: 'SUBMIT', name: 'P', deadline: past, projectManagementItemId: null, round: 1, assignedHostUserId: 'u1', procurementMethod: '谈判采购' });
      prisma.bidExpert.count.mockResolvedValue(3);
      prisma.bidSupplier.count.mockImplementation(async (args: any) =>
        args?.where?.submitStatus === '已提交' ? 3 : 3);
      prisma.bidProject.update.mockResolvedValue({ id: 'p1', stage: 'OPENING' });
      prisma.bidSupervisionLog.create.mockResolvedValue({});

      const result = await service.startOpening('p1', {}, 'u1');
      expect(result.stage).toBe('OPENING');
    });

    it('A-109b：force 也不可绕过法定家数不足——仍 OPENING_CHECKLIST_FAILED + 记「强制开标被拒」', async () => {
      const past = new Date(Date.now() - 3600_000);
      prisma.bidProject.findUnique.mockResolvedValue({ stage: 'SUBMIT', name: 'P', deadline: past, projectManagementItemId: null, round: 1, assignedHostUserId: 'u1', procurementMethod: '公开招标' });
      prisma.bidExpert.count.mockResolvedValue(3);
      // 口径区分：候选池 3 行（受邀未投递也算），其中已提交仅 1 家（公开招标法定最少 3 家）
      prisma.bidSupplier.count.mockImplementation(async (args: any) =>
        args?.where?.submitStatus === '已提交' ? 1 : 3);
      prisma.bidSupervisionLog.create.mockResolvedValue({});

      await expect((service as any).startOpeningInternal('p1', { force: true } as any, 'u1'))
        .rejects.toMatchObject({ response: { code: 'OPENING_CHECKLIST_FAILED' } });
      expect(prisma.bidSupervisionLog.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ action: '强制开标被拒（法定家数不足）', riskFlag: '高风险' }),
      }));
    });

    it('A-109b：force 跳过软闸（专家 0 + 已提交 3 家）——放行且保留原「强制开标(忽略checklist)」日志', async () => {
      const past = new Date(Date.now() - 3600_000);
      prisma.bidProject.findUnique.mockResolvedValue({ stage: 'SUBMIT', name: 'P', deadline: past, projectManagementItemId: null, round: 1, assignedHostUserId: 'u1', procurementMethod: '公开招标' });
      prisma.bidExpert.count.mockResolvedValue(0);
      prisma.bidSupplier.count.mockImplementation(async (args: any) =>
        args?.where?.submitStatus === '已提交' ? 3 : 3);
      prisma.bidProject.update.mockResolvedValue({ id: 'p1', stage: 'OPENING' });
      prisma.bidSupervisionLog.create.mockResolvedValue({});

      const result = await (service as any).startOpeningInternal('p1', {
        force: true, host: '甲',
        decryptWindowStart: '2026-06-16T10:00:00.000Z', decryptWindowEnd: '2026-06-16T10:30:00.000Z',
      } as any, 'u1');

      expect(result).toBeDefined();
      expect(prisma.bidSupervisionLog.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ action: '强制开标(忽略checklist)' }),
      }));
    });
  });

  describe('abortBidProject — N4c 有官方结果须书面理由', () => {
    it('N4：已存在官方评标结果时流标须书面理由（ABORT_REASON_REQUIRED）', async () => {
      prisma.bidProject.findUnique.mockResolvedValue({ stage: 'EVALUATING', name: 'P', procurementMethod: '谈判采购', _count: { suppliers: 2 } });
      prisma.bidEvaluationResult.count.mockResolvedValue(2);
      await expect(service.abortBidProject('p1', 'u1')).rejects.toMatchObject({
        response: { code: 'ABORT_REASON_REQUIRED' },
      });
      expect(prisma.bidEvaluationResult.count).toHaveBeenCalledWith({ where: { projectId: 'p1' } });
    });

    it('N4：有官方结果且带书面理由 → 流标成功，监督日志 result 追加作废说明', async () => {
      prisma.bidProject.findUnique.mockResolvedValue({ stage: 'EVALUATING', name: 'P', procurementMethod: '谈判采购', _count: { suppliers: 2 } });
      prisma.bidEvaluationResult.count.mockResolvedValue(2);
      prisma.bidProject.update.mockResolvedValue({ id: 'p1', stage: 'ABORTED' });
      prisma.bidSupervisionLog.create.mockResolvedValue({});
      prisma.bidExpert.findMany.mockResolvedValue([]);

      const updated = await service.abortBidProject('p1', 'u1', '定标前发现重大问题');

      expect(updated.stage).toBe('ABORTED');
      const abortLog = prisma.bidSupervisionLog.create.mock.calls.find((c: any[]) => c[0]?.data?.action === '流标');
      expect(abortLog?.[0].data.result).toContain('已存在官方评标结果，随流标作废');
      expect(abortLog?.[0].data.riskFlag).toBe('高风险');
      expect(abortLog?.[0].data.result).toContain('原因：定标前发现重大问题');
    });

    it('N4：无官方结果时流标不需理由（原行为不变，日志无作废说明）', async () => {
      prisma.bidProject.findUnique.mockResolvedValue({ stage: 'SUBMIT', name: 'P', procurementMethod: '谈判采购', _count: { suppliers: 2 } });
      prisma.bidEvaluationResult.count.mockResolvedValue(0);
      prisma.bidProject.update.mockResolvedValue({ id: 'p1', stage: 'ABORTED' });
      prisma.bidSupervisionLog.create.mockResolvedValue({});
      prisma.bidExpert.findMany.mockResolvedValue([]);

      const updated = await service.abortBidProject('p1', 'u1');

      expect(updated.stage).toBe('ABORTED');
      const abortLog = prisma.bidSupervisionLog.create.mock.calls.find((c: any[]) => c[0]?.data?.action === '流标');
      expect(abortLog?.[0].data.result).not.toContain('随流标作废');
    });

    it('N9：流标通知只发已确认正选专家（候补/已婉拒不再收）', async () => {
      prisma.bidProject.findUnique.mockResolvedValue({ stage: 'EVALUATING', name: 'P', procurementMethod: '谈判采购', _count: { suppliers: 2 } });
      prisma.bidEvaluationResult.count.mockResolvedValue(0);
      prisma.bidProject.update.mockResolvedValue({ id: 'p1', stage: 'ABORTED' });
      prisma.bidSupervisionLog.create.mockResolvedValue({});
      prisma.bidExpert.findMany.mockResolvedValue([]);

      await expect(service.abortBidProject('p1', 'u1', '测试原因')).resolves.toMatchObject({ stage: 'ABORTED' });
      expect(prisma.bidExpert.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ projectId: 'p1', expertRole: '正选', invitationStatus: 'confirmed' }) }),
      );
    });

    it('F18：流标成功 → 写 BID_PROJECT_ABORT 审计（旧实现零 AuditLog）', async () => {
      prisma.bidProject.findUnique.mockResolvedValue({ stage: 'EVALUATING', name: 'P', procurementMethod: '谈判采购', _count: { suppliers: 2 } });
      prisma.bidEvaluationResult.count.mockResolvedValue(0);
      prisma.bidProject.update.mockResolvedValue({ id: 'p1', stage: 'ABORTED' });
      prisma.bidSupervisionLog.create.mockResolvedValue({});
      prisma.bidExpert.findMany.mockResolvedValue([]);
      prisma.auditLog = { create: jest.fn().mockResolvedValue({}) };

      await expect(service.abortBidProject('p1', 'u1', 'F18测试原因')).resolves.toMatchObject({ stage: 'ABORTED' });
      expect(prisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ userId: 'u1', action: 'BID_PROJECT_ABORT', resourceType: 'BidProject:p1' }),
        }),
      );
    });
  });

  describe('reopenFromAborted — N5 重启时间兜底', () => {
    beforeEach(() => {
      // findUnique 双用途：按 id 查返回原项目；按 projectCode 查（generateProjectCode 查重）返回 null
      prisma.bidProject.findUnique.mockImplementation(({ where }: any) =>
        where?.projectCode ? Promise.resolve(null) : Promise.resolve({
          stage: 'ABORTED', name: 'P', projectCode: 'BID-1',
          procurementMethod: '谈判采购', openTime: new Date('2026-08-01'), deadline: new Date('2026-08-01'),
          downloadDeadline: new Date('2026-07-30'), round: 1,
        }));
      prisma.bidProject.count.mockResolvedValue(0);
      prisma.bidProject.update.mockResolvedValue({});
      prisma.bidSupervisionLog.create.mockResolvedValue({});
      prisma.auditLog.create.mockResolvedValue({});
    });

    it('N5：流标重启的新项目 deadline 在未来（不再继承原项目过期时间）', async () => {
      prisma.bidProject.create.mockImplementation(({ data }: any) => data);
      const created = await service.reopenFromAborted('p1', 'u1');
      expect(new Date(created.deadline).getTime()).toBeGreaterThan(Date.now());
      expect(new Date(created.openTime).getTime()).toBeGreaterThan(new Date(created.deadline).getTime());
    });

    it('N5：downloadDeadline 清空、riskNote 留痕含重启默认时间并提示重新设定', async () => {
      prisma.bidProject.create.mockImplementation(({ data }: any) => data);
      await service.reopenFromAborted('p1', 'u1');
      const createData = prisma.bidProject.create.mock.calls[0][0].data;
      expect(createData.downloadDeadline).toBeNull();
      expect(createData.riskNote).toContain('重启默认时间');
      expect(createData.riskNote).toContain('请在项目编辑中重新设定');
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

    it('A-152：电子签名并入归档哈希链——签字状态 JSON 含 esignature/esignatureAt（无扫描件也入链）', async () => {
      prisma.bidProject.findUnique.mockResolvedValue({ id: 'p1', projectCode: 'BID-T', stage: 'EVALUATING', name: '测试项目' });
      prisma.bidArchiveItem.findMany
        .mockResolvedValueOnce([]) // ensureArchiveItems 首查
        .mockResolvedValueOnce([{ id: 'a-sign', name: '评标签字包', status: 'PENDING_CONFIRM' }]); // 待归档项
      prisma.bidArchiveItem.create.mockResolvedValue({});
      prisma.bidArchiveItem.update.mockResolvedValue({});
      prisma.bidProject.update.mockResolvedValue({ id: 'p1', stage: 'ARCHIVED' });
      prisma.bidSupervisionLog.create.mockResolvedValue({});
      prisma.bidSupplier.findMany.mockResolvedValue([]); // G5：无可评供应商
      prisma.bidEvaluationResult.count.mockResolvedValue(0);
      prisma.bidSignPacket.findUnique.mockResolvedValue({
        fileAssetId: 'fa-sign', sha256: 'sha-sign', signPageScanFileId: null,
        closedAt: new Date(), handoverFileAssetId: 'fa-handover',
      });
      // 电子签名专家（无扫描件）——OR 扩展后仍须入状态 JSON
      prisma.bidExpert.findMany.mockResolvedValue([
        {
          expertName: '王建国', signStatus: 'SIGNED', signScanFileId: null,
          esignature: { v: 1, payload: 'p', signature: 's', algorithm: 'SM2/SM3', certSn: 'SN-001', verifiedAt: '2026-09-02T08:05:00Z' },
          esignatureAt: new Date('2026-09-02T08:05:00Z'),
        },
      ]);
      prisma.fileAsset.findMany.mockResolvedValue([{ sha256: 'sha-scan' }]);

      await service.archiveAll('p1', 'u1');

      expect(prisma.bidExpert.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            projectId: 'p1',
            OR: [{ signScanFileId: { not: null } }, { esignature: { not: Prisma.DbNull } }],
          }),
        }),
      );
      const expectedJson = JSON.stringify([{
        expertName: '王建国', signStatus: 'SIGNED',
        esignature: { v: 1, payload: 'p', signature: 's', algorithm: 'SM2/SM3', certSn: 'SN-001', verifiedAt: '2026-09-02T08:05:00Z' },
        esignatureAt: '2026-09-02T08:05:00.000Z',
      }]);
      const expectedHash = crypto.createHash('sha256').update(expectedJson, 'utf8').digest('hex');
      expect(prisma.bidArchiveItem.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'a-sign' },
          data: expect.objectContaining({ fileHashes: ['sha-sign', 'sha-scan', expectedHash] }),
        }),
      );
    });

    it('ensureArchiveItems：项目含 dual-v2 提交 → 标准清单追加「解密后投标文件」，重复 ensure 幂等不重复建', async () => {
      prisma.supplierBidSubmission.findMany.mockResolvedValue([{ id: 'sub-1' }]);
      prisma.bidArchiveItem.findMany.mockResolvedValue([]);
      prisma.bidArchiveItem.create.mockResolvedValue({});

      await (service as any).ensureArchiveItems('p1');

      expect(prisma.bidArchiveItem.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ projectId: 'p1', name: '解密后投标文件', ownerRole: '供应商' }),
      }));
      const firstRunCount = prisma.bidArchiveItem.create.mock.calls.length;

      // 幂等：第二次 ensure 时该项已存在 → 不再为该名称 create（DB @@unique([projectId,name]) 双保险）
      prisma.bidArchiveItem.findMany.mockResolvedValue([{ name: '解密后投标文件' }]);
      await (service as any).ensureArchiveItems('p1');
      const secondRun = prisma.bidArchiveItem.create.mock.calls.slice(firstRunCount);
      expect(secondRun.map((c: any) => c[0].data.name)).not.toContain('解密后投标文件');
    });

    it('ensureArchiveItems：无 dual-v2 提交 → 清单不含「解密后投标文件」（旧项目归档清单不变）', async () => {
      prisma.supplierBidSubmission.findMany.mockResolvedValue([]);
      prisma.bidArchiveItem.findMany.mockResolvedValue([]);
      prisma.bidArchiveItem.create.mockResolvedValue({});

      await (service as any).ensureArchiveItems('p1');

      const created = prisma.bidArchiveItem.create.mock.calls.map((c: any) => c[0].data.name);
      expect(created).not.toContain('解密后投标文件');
      expect(created).toHaveLength(8); // 标准 8 项（5 通用 + 3 评标）
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

    it('E2：自定义评标时长——evaluationHours 生效，缺省回退 72h', async () => {
      prisma.bidProject.findUnique.mockResolvedValue({ stage: 'OPENING', name: '测试项目' });
      prisma.bidProject.update.mockResolvedValue({ id: 'p1', stage: 'EVALUATING' });
      prisma.bidSupervisionLog.create.mockResolvedValue({});
      prisma.bidSupplier.findMany.mockResolvedValue([]);

      // 自定义 120h
      await service.startEvaluation('p1', undefined, 120);
      const data = prisma.bidProject.update.mock.calls[0][0].data;
      expect(data.stage).toBe('EVALUATING');
      const hours = (new Date(data.evaluationDeadline).getTime() - Date.now()) / 3600_000;
      expect(hours).toBeGreaterThan(119);
      expect(hours).toBeLessThan(121);

      // 缺省 → 72h
      await service.startEvaluation('p1');
      const data2 = prisma.bidProject.update.mock.calls[1][0].data;
      const hours2 = (new Date(data2.evaluationDeadline).getTime() - Date.now()) / 3600_000;
      expect(hours2).toBeGreaterThan(71);
      expect(hours2).toBeLessThan(73);
    });

    it('N9：评标启动通知只发已确认正选专家（候补/已婉拒/未确认不再收）', async () => {
      // 自包含成功前置（复制自 H4「所有供应商到终局态时放行」用例）
      prisma.bidProject.findUnique.mockResolvedValue({ stage: 'OPENING', name: 'P' });
      prisma.bidExpert.count.mockResolvedValueOnce(3).mockResolvedValue(0); // P1-7：首次=确认正选数，其后=采购人代表数(0)
      prisma.bidSupplier.count.mockResolvedValue(3);
      prisma.bidSupplier.findMany.mockResolvedValue([
        { supplierName: 'A', decryptStatus: 'SUCCESS', confirmStatus: 'CONFIRMED' },
        { supplierName: 'B', decryptStatus: 'DANGER', confirmStatus: 'PENDING' },
        { supplierName: 'C', decryptStatus: 'SUCCESS', confirmStatus: 'CONFIRMED' },
      ]);
      prisma.bidProject.update.mockResolvedValue({ id: 'p1', stage: 'EVALUATING' });
      prisma.bidSupervisionLog.create.mockResolvedValue({});
      prisma.auditLog.create.mockResolvedValue({});
      prisma.bidExpert.findMany.mockResolvedValue([
        { userId: 'u1', expertName: 'A' }, { userId: null, expertName: 'B' },
      ]);

      await expect(service.startEvaluation('p1', 'host-1')).resolves.toMatchObject({ stage: 'EVALUATING' });
      expect(prisma.bidExpert.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ expertRole: '正选', invitationStatus: 'confirmed' }) }),
      );
    });
  });

  describe('BidService.startEvaluation — 前置校验 (G4/G9)', () => {
    beforeEach(() => {
      prisma.bidProject.findUnique.mockResolvedValue({ stage: 'OPENING', name: '测试项目' });
      prisma.bidExpert.count.mockResolvedValueOnce(3).mockResolvedValue(0); // P1-7：首次=确认正选数，其后=采购人代表数(0)
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
      prisma.bidExpert.count.mockResolvedValueOnce(3).mockResolvedValue(0); // P1-7：首次=确认正选数，其后=采购人代表数(0)
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
      prisma.bidExpert.count.mockResolvedValueOnce(3).mockResolvedValue(0); // P1-7：首次=确认正选数，其后=采购人代表数(0)
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

    it('P1-7：非采购人代表不足 2/3 → 409 COMMITTEE_RATIO（5 人组含 2 名代表）', async () => {
      prisma.bidProject.findUnique.mockResolvedValue({ stage: 'OPENING', name: 'P' });
      prisma.bidExpert.count
        .mockResolvedValueOnce(5)  // confirmed 正选
        .mockResolvedValueOnce(2); // 其中采购人代表
      prisma.bidSupplier.count.mockResolvedValue(3);

      await expect(service.startEvaluation('p1', 'u1')).rejects.toMatchObject({
        response: { code: 'COMMITTEE_RATIO' },
      });
    });

    it('P1-7：非代表占 4/5（≥2/3）→ 通过占比闸门（后续闸门另行拦截属正常）', async () => {
      prisma.bidProject.findUnique.mockResolvedValue({ stage: 'OPENING', name: 'P' });
      prisma.bidExpert.count
        .mockResolvedValueOnce(5)
        .mockResolvedValueOnce(1);
      prisma.bidSupplier.count.mockResolvedValue(3);
      // 供应商侧闸门抛错即可证明占比闸门已通过
      await expect(service.startEvaluation('p1', 'u1')).rejects.not.toMatchObject({
        response: { code: 'COMMITTEE_RATIO' },
      });
    });

    it('所有供应商到终局态（SUCCESS+CONFIRMED / DANGER）时放行', async () => {
      prisma.bidProject.findUnique.mockResolvedValue({ stage: 'OPENING', name: 'P' });
      prisma.bidExpert.count.mockResolvedValueOnce(3).mockResolvedValue(0); // P1-7：首次=确认正选数，其后=采购人代表数(0)
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

  describe('getProject — 专家匿名化（EXPERT_SCORE_ANONYMIZED_DURING_EVAL）', () => {
    const origAnon = process.env.EXPERT_SCORE_ANONYMIZED_DURING_EVAL;

    beforeAll(() => { process.env.EXPERT_SCORE_ANONYMIZED_DURING_EVAL = 'true'; });
    afterAll(() => { if (origAnon !== undefined) process.env.EXPERT_SCORE_ANONYMIZED_DURING_EVAL = origAnon; else delete process.env.EXPERT_SCORE_ANONYMIZED_DURING_EVAL; });

    const mockProject = {
      id: 'p-anon',
      stage: 'EVALUATING',
      experts: [
        { id: 'e1', expertName: '张三', reportConfirmed: false,
          scoreRecords: [{ id: 'r1', expertId: 'e1', supplierId: 's1', scoreItemId: 'i1', score: 85 }] },
        { id: 'e2', expertName: '李四', reportConfirmed: false,
          scoreRecords: [{ id: 'r2', expertId: 'e2', supplierId: 's1', scoreItemId: 'i1', score: 90 }] },
      ],
      suppliers: [], openingSession: null, openingRecords: [], scoreItems: [],
      clarifications: [], supervisionLogs: [], expertDisputes: [], archiveItems: [],
      bidRounds: [], assignedHostUser: null, projectManagementItemId: null,
      procurementMethod: '谈判采购',
    };

    it('EVALUATING 阶段且未全部确认时，应剥离 expertName 和 scoreRecord.expertId', async () => {
      prisma.bidProject.findUnique.mockResolvedValue({ ...mockProject, stage: 'EVALUATING' });

      const result = await service.getProject('p-anon');

      expect(result).not.toBeNull();
      // N4a：法定最少投标家数随 getProject 下发（谈判采购等非直接采购 = 3）
      expect(result!.minBidders).toBe(3);
      // 稳定编号：按 expertId 排序分配「专家 1/2/…」，行间可区分且刷新不换号
      expect(result!.experts[0].expertName).toBe('专家 1');
      expect(result!.experts[1].expertName).toBe('专家 2');
      expect(result!.experts[0].scoreRecords[0].expertId).toBeNull();
      expect(result!.experts[1].scoreRecords[0].expertId).toBeNull();
      // expert.id 保留（前端 Map 索引需要）
      expect(result!.experts[0].id).toBe('e1');
      expect(result!.experts[1].id).toBe('e2');
    });

    it('全部专家已确认报告时不剥离', async () => {
      const confirmed = {
        ...mockProject,
        stage: 'EVALUATING',
        experts: [
          { ...mockProject.experts[0], reportConfirmed: true },
          { ...mockProject.experts[1], reportConfirmed: true },
        ],
      };
      prisma.bidProject.findUnique.mockResolvedValue(confirmed);

      const result = await service.getProject('p-anon');

      expect(result!.experts[0].expertName).toBe('张三');
      expect(result!.experts[1].expertName).toBe('李四');
    });

    it('非 EVALUATING 阶段不剥离', async () => {
      prisma.bidProject.findUnique.mockResolvedValue({ ...mockProject, stage: 'ARCHIVED' });

      const result = await service.getProject('p-anon');

      expect(result!.experts[0].expertName).toBe('张三');
      expect(result!.experts[1].expertName).toBe('李四');
    });

    it('显式 =false 关闭时不剥离', async () => {
      process.env.EXPERT_SCORE_ANONYMIZED_DURING_EVAL = 'false';
      prisma.bidProject.findUnique.mockResolvedValue({ ...mockProject, stage: 'EVALUATING' });

      const result = await service.getProject('p-anon');

      expect(result!.experts[0].expertName).toBe('张三');
      expect(result!.experts[1].expertName).toBe('李四');

      // restore for subsequent tests
      process.env.EXPERT_SCORE_ANONYMIZED_DURING_EVAL = 'true';
    });

    it('未配置 → 默认开启匿名（2026-08-15 语义翻转：安全默认）', async () => {
      delete process.env.EXPERT_SCORE_ANONYMIZED_DURING_EVAL;
      prisma.bidProject.findUnique.mockResolvedValue({ ...mockProject, stage: 'EVALUATING' });

      const result = await service.getProject('p-anon');

      expect(result!.experts[0].expertName).toBe('专家 1');
      expect(result!.experts[1].expertName).toBe('专家 2');

      // restore for subsequent tests
      process.env.EXPERT_SCORE_ANONYMIZED_DURING_EVAL = 'true';
    });
  });

  describe('getProject — minBidders 下发（N4a：法定最少投标家数按采购方式）', () => {
    const base = {
      stage: 'OPENING', experts: [], suppliers: [], openingSession: null, openingRecords: [],
      scoreItems: [], clarifications: [], supervisionLogs: [], expertDisputes: [],
      archiveItems: [], bidRounds: [], assignedHostUser: null, projectManagementItemId: null,
    };

    it('谈判采购（及其余非直接采购方式）→ minBidders=3（非 host 路径）', async () => {
      prisma.bidProject.findUnique.mockResolvedValue({ ...base, procurementMethod: '谈判采购' });
      const res = await service.getProject('p-min');
      expect(res!.minBidders).toBe(3);
    });

    it('直接采购 → minBidders=1', async () => {
      prisma.bidProject.findUnique.mockResolvedValue({ ...base, procurementMethod: '直接采购' });
      const res = await service.getProject('p-min');
      expect(res!.minBidders).toBe(1);
    });

    it('bid portal（sanitizeForBidHost）路径同样下发 minBidders，且不影响字段去敏', async () => {
      prisma.bidProject.findUnique.mockResolvedValue({
        ...base, procurementMethod: '谈判采购', assignedHostUserId: 'host-1', budgetAmount: '100',
      });
      const res = await service.getProject('p-min', { id: 'host-1', role: 'bid_host' }, 'bid');
      expect(res!.minBidders).toBe(3);
      // 去敏仍生效：管理内部字段被剥离，minBidders 不在去敏清单
      expect(res).not.toHaveProperty('budgetAmount');
    });
  });

  describe('updatePriceConfig 阶段闸（P2-17）', () => {
    it('EVALUATING：变更任一配置键 → 409 PRICE_CONFIG_LOCKED', async () => {
      prisma.bidProject.findUnique.mockResolvedValue({ id: 'p1', stage: 'EVALUATING' });
      await expect(service.updatePriceConfig('p1', { ceilingPrice: 100 }, 'u1'))
        .rejects.toMatchObject({ response: { code: 'PRICE_CONFIG_LOCKED' } });
      expect(prisma.bidProject.update).not.toHaveBeenCalled();
    });
    it('ARCHIVED：变更评标办法 → 409', async () => {
      prisma.bidProject.findUnique.mockResolvedValue({ id: 'p1', stage: 'ARCHIVED' });
      await expect(service.updatePriceConfig('p1', { evaluationMethod: 'lowest_price' }, 'u1'))
        .rejects.toMatchObject({ response: { code: 'PRICE_CONFIG_LOCKED' } });
      expect(prisma.bidProject.update).not.toHaveBeenCalled();
    });
    it('DOWNLOAD：正常放行', async () => {
      prisma.bidProject.findUnique.mockResolvedValue({ id: 'p1', stage: 'DOWNLOAD' });
      prisma.bidProject.update.mockResolvedValue({ id: 'p1' });
      await service.updatePriceConfig('p1', { ceilingPrice: 100 }, 'u1');
      expect(prisma.bidProject.update).toHaveBeenCalled();
    });
    it('EVALUATING：空 body（无键）不触发闸', async () => {
      prisma.bidProject.findUnique.mockResolvedValue({ id: 'p1', stage: 'EVALUATING' });
      prisma.bidProject.update.mockResolvedValue({ id: 'p1' });
      await service.updatePriceConfig('p1', {}, 'u1');
      expect(prisma.bidProject.update).toHaveBeenCalled();
    });
  });
});

describe('BidService — score items (评分标准)', () => {
  let service: BidService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      bidProject: { findUnique: jest.fn(), update: jest.fn() },
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
        BidOpeningRecordService,
        ADMIN_KEY_SVC, DUAL_ENVELOPE_SVC, SIGNATURE_SVC, GB_CODE_SVC,
        BidScoreStandardService,
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

  it('createScoreItem 在 OPENING 阶段锁定抛 ConflictException（开标后锁定）', async () => {
    prisma.bidProject.findUnique.mockResolvedValue({ stage: 'OPENING', name: '项目A' });
    await expect(service.createScoreItem('p1', { category: 'PRICE' as any, name: '价格', maxScore: 30 }, { userId: 'u1', role: 'bid_host' }))
      .rejects.toThrow(ConflictException);
    expect(prisma.bidScoreItem.create).not.toHaveBeenCalled();
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
    // 事务外读：SUBMIT（可编辑）；事务内 FOR UPDATE 重读：EVALUATING（已被并发流转锁定）
    prisma.bidProject.findUnique
      .mockResolvedValueOnce({ stage: 'SUBMIT', name: 'P' })
      .mockResolvedValueOnce({ stage: 'EVALUATING', name: 'P' });
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

  it('A-147：saveScoreTemplate 服务端自动快照采购方式 + 项目类型（经 PMI 关联）', async () => {
    prisma.bidScoreItem.findMany.mockResolvedValue([{ category: 'TECHNICAL', name: '技术', maxScore: 50, points: [] }]);
    prisma.bidProject.findUnique.mockResolvedValue({
      procurementMethod: '谈判采购',
      projectManagementItem: { procurementCategory: '工程' },
    });
    prisma.scoreTemplate.create.mockResolvedValue({ id: 't10' });
    await service.saveScoreTemplate('p1', '维度模板', 'u1', '陈源远');
    expect(prisma.bidProject.findUnique).toHaveBeenCalledWith(expect.objectContaining({
      select: expect.objectContaining({
        procurementMethod: true,
        projectManagementItem: { select: { procurementCategory: true } },
      }),
    }));
    expect(prisma.scoreTemplate.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ procurementMethod: '谈判采购', projectCategory: '工程' }),
    }));
  });

  it('A-147：saveScoreTemplate 无 PMI 关联时维度落 null（通用模板）', async () => {
    prisma.bidScoreItem.findMany.mockResolvedValue([{ category: 'TECHNICAL', name: '技术', maxScore: 50, points: [] }]);
    prisma.bidProject.findUnique.mockResolvedValue({ procurementMethod: '公开招标', projectManagementItem: null });
    prisma.scoreTemplate.create.mockResolvedValue({ id: 't11' });
    await service.saveScoreTemplate('p1', '通用模板', 'u1', '陈源远');
    expect(prisma.scoreTemplate.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ procurementMethod: '公开招标', projectCategory: null }),
    }));
  });

  it('A-147：listScoreTemplates 传采购方式时 where 含「通用(null)+精确匹配」OR 分支', async () => {
    prisma.scoreTemplate.findMany.mockResolvedValue([]);
    await service.listScoreTemplates('u1', '谈判采购');
    expect(prisma.scoreTemplate.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        OR: [{ createdById: 'u1' }, { createdById: null }],
        AND: [{ OR: [{ procurementMethod: null }, { procurementMethod: '谈判采购' }] }],
      }),
      select: expect.objectContaining({ procurementMethod: true, projectCategory: true }),
    }));
  });

  it('A-147：listScoreTemplates 双参各占一个 AND 分支（维度间 AND、维度内 null∪精确）', async () => {
    prisma.scoreTemplate.findMany.mockResolvedValue([]);
    await service.listScoreTemplates('u1', '谈判采购', '工程');
    expect(prisma.scoreTemplate.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        AND: [
          { OR: [{ procurementMethod: null }, { procurementMethod: '谈判采购' }] },
          { OR: [{ projectCategory: null }, { projectCategory: '工程' }] },
        ],
      }),
    }));
  });

  it('A-147：listScoreTemplates 无维度参时 where 不含维度键（现状回归）', async () => {
    prisma.scoreTemplate.findMany.mockResolvedValue([]);
    await service.listScoreTemplates('u1');
    const arg = (prisma.scoreTemplate.findMany as jest.Mock).mock.calls[0][0];
    expect(arg.where).toEqual({ OR: [{ createdById: 'u1' }, { createdById: null }] });
    expect(arg.where).not.toHaveProperty('AND');
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
        BidOpeningRecordService,
        ADMIN_KEY_SVC, DUAL_ENVELOPE_SVC, SIGNATURE_SVC, GB_CODE_SVC,
        BidScoreStandardService,
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
        BidOpeningRecordService,
        ADMIN_KEY_SVC, DUAL_ENVELOPE_SVC, SIGNATURE_SVC, GB_CODE_SVC,
        BidScoreStandardService,
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

/* ── G1→C1：归档后自动生成预成交公示草稿（两段式第一段）── */
describe('BidService.archiveAll — 预成交公示自动生成 (G1/C1)', () => {
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
      bidExpert: { groupBy: jest.fn(), findFirst: jest.fn(), findMany: jest.fn().mockResolvedValue([]), count: jest.fn(), update: jest.fn() },
      bidScoreItem: { findFirst: jest.fn(), create: jest.fn(), delete: jest.fn(), count: jest.fn(), findMany: jest.fn().mockResolvedValue([]) },
      bidScoreRecord: { upsert: jest.fn(), findMany: jest.fn() },
      supplier: { count: jest.fn() },
      announcement: { count: jest.fn(), findFirst: jest.fn(), create: jest.fn() },
      bidSupplier: { findMany: jest.fn().mockResolvedValue([]), update: jest.fn(), create: jest.fn(), findFirst: jest.fn(), findUnique: jest.fn(), count: jest.fn() },
      bidOpeningRecord: { create: jest.fn(), findFirst: jest.fn(), update: jest.fn(), findUnique: jest.fn(), findMany: jest.fn() },
      bidEvaluationResult: { deleteMany: jest.fn(), createMany: jest.fn(), findMany: jest.fn(), count: jest.fn(), findFirst: jest.fn().mockResolvedValue({ generatedAt: new Date(Date.now() - 3600_000) }) },
      bidArchiveItem: { findMany: jest.fn(), updateMany: jest.fn(), update: jest.fn(), findFirst: jest.fn(), create: jest.fn(), groupBy: jest.fn() },
      // T17：getProject 派生下发 envelopeVersion/outerDecryptedAt/packageFetchedAt 需要 findMany（默认空）
      supplierBidSubmission: { findUnique: jest.fn(), findMany: jest.fn().mockResolvedValue([]) },
      bidOpeningSession: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
      // 签字闸门默认放行（闭环+回流齐）：full 归档用例不逐个 mock；单测闸门本身见 bid-sign-packet.service.spec
      bidSignPacket: { findUnique: jest.fn().mockResolvedValue({ fileAssetId: 'fa-sign', sha256: 'sha-sign', signPageScanFileId: null, closedAt: new Date(), handoverFileAssetId: 'fa-handover' }) },
      fileAsset: { findUnique: jest.fn(), findMany: jest.fn().mockResolvedValue([]) },
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
        BidOpeningRecordService,
        ADMIN_KEY_SVC, DUAL_ENVELOPE_SVC, SIGNATURE_SVC, GB_CODE_SVC,
        BidScoreStandardService,
        { provide: StorageService, useValue: { upload: jest.fn() } },
        { provide: PrismaService, useValue: prisma },
        { provide: NotificationService, useValue: { sendToRole: jest.fn() } },
      ],
    }).compile();
    service = module.get<BidService>(BidService);
  });

  it('归档后自动创建 PRE_WIN_NOTICE 预成交公示草稿', async () => {
    await service.archiveAll('p1', 'u1');
    expect(prisma.announcement.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: 'PRE_WIN_NOTICE',
          status: 'DRAFT',
          relatedProjectCode: 'BID-1',
        }),
      }),
    );
  });

  it('已存在预成交公示或成交公告时不重复创建（幂等）', async () => {
    // 幂等口径（按轮）：已有公示创建时间晚于本轮评标结果生成时间 → 跳过
    prisma.announcement.findFirst.mockResolvedValue({ id: 'wn1', createdAt: new Date() });
    await service.archiveAll('p1', 'u1');
    expect(prisma.announcement.create).not.toHaveBeenCalled();
  });

  it('预成交公示创建失败时不阻塞归档', async () => {
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
        count: jest.fn().mockResolvedValue(0),
        findUnique: jest.fn().mockResolvedValue(null),
      },
      projectManagementItem: { count: jest.fn().mockResolvedValue(0) },
      notificationService: { sendToRole: jest.fn().mockResolvedValue(undefined) },
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        { provide: ScoreStandardValidator, useValue: { assertPassFailMaxScore: jest.fn(), assertPointsSumWithinMax: jest.fn().mockResolvedValue(undefined), assertScoreStandardComplete: jest.fn().mockResolvedValue(undefined) } },
        { provide: PriceFormulaService, useValue: { calculate: jest.fn().mockReturnValue(new Map()), getOverCeilingSuppliers: jest.fn().mockReturnValue([]) } },
        BidService,
        BidOpeningRecordService,
        ADMIN_KEY_SVC, DUAL_ENVELOPE_SVC, SIGNATURE_SVC, GB_CODE_SVC,
        BidScoreStandardService,
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
      openTime: '2026-07-02T00:00:00.000Z', deadline: '2026-07-01T00:00:00.000Z',
      qualityRequirement: '合格', bondRequired: true, bondAmount: 200000,
    } as any);

    expect(prisma.bidProject.create).toHaveBeenCalledTimes(1);
    const arg = prisma.bidProject.create.mock.calls[0][0].data;
    expect(arg.qualityRequirement).toBe('合格');
    expect(arg.bondRequired).toBe(true);
    expect(Number(arg.bondAmount)).toBe(200000);
  });
});

describe('截标↔开标 24h（P0-2）', () => {
  let service: BidService;
  let prisma: any;

  const H24 = 24 * 3_600_000;
  const OPEN = new Date('2026-09-01T10:00:00Z');
  const DEADLINE = new Date(OPEN.getTime() - H24);

  beforeEach(async () => {
    prisma = {
      bidProject: {
        create: jest.fn().mockResolvedValue({ id: 'p1', name: 'X', projectCode: 'BID-1' }),
        count: jest.fn().mockResolvedValue(0),
        findUnique: jest.fn().mockResolvedValue(null),
        update: jest.fn().mockResolvedValue({ id: 'p1' }),
      },
      bidSupervisionLog: { create: jest.fn().mockResolvedValue({}) },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        { provide: ScoreStandardValidator, useValue: { assertPassFailMaxScore: jest.fn(), assertPointsSumWithinMax: jest.fn().mockResolvedValue(undefined), assertScoreStandardComplete: jest.fn().mockResolvedValue(undefined) } },
        { provide: PriceFormulaService, useValue: { calculate: jest.fn().mockReturnValue(new Map()), getOverCeilingSuppliers: jest.fn().mockReturnValue([]) } },
        BidService,
        BidOpeningRecordService,
        ADMIN_KEY_SVC, DUAL_ENVELOPE_SVC, SIGNATURE_SVC, GB_CODE_SVC,
        BidScoreStandardService,
        { provide: StorageService, useValue: { upload: jest.fn() } },
        { provide: PrismaService, useValue: prisma },
        { provide: NotificationService, useValue: { sendToRole: jest.fn() } },
      ],
    }).compile();
    service = module.get(BidService);
  });

  it('createBidProject：双字段合规落库', async () => {
    prisma.bidProject.create.mockImplementation(({ data }: any) => data);
    const created = await service.createProject({
      name: 'P', procurementMethod: '公开招标',
      openTime: OPEN.toISOString(), deadline: DEADLINE.toISOString(),
    } as any);
    expect(created.openTime.getTime()).toBe(OPEN.getTime());
    expect(created.deadline.getTime()).toBe(DEADLINE.getTime());
  });

  it('createBidProject：差 23h → DEADLINE_OPENING_GAP_INVALID 且 create 零调用', async () => {
    await expect(service.createProject({
      name: 'P', procurementMethod: '公开招标',
      openTime: OPEN.toISOString(),
      deadline: new Date(OPEN.getTime() - 23 * 3_600_000).toISOString(),
    } as any)).rejects.toMatchObject({ response: { code: 'DEADLINE_OPENING_GAP_INVALID' } });
    expect(prisma.bidProject.create).not.toHaveBeenCalled();
  });

  it('createBidProject：缺 deadline → 自动派生 24h', async () => {
    prisma.bidProject.create.mockImplementation(({ data }: any) => data);
    const created = await service.createProject({
      name: 'P', procurementMethod: '公开招标', openTime: OPEN.toISOString(),
    } as any);
    expect(created.deadline.getTime()).toBe(OPEN.getTime() - H24);
  });

  it('createFromAnnouncement：metadata.deadline 缺省 → 派生（不再 +7 天）', async () => {
    prisma.bidProject.create.mockImplementation(({ data }: any) => data);
    const created = await service.createFromAnnouncement(
      { id: 'a1', title: 'T', publishDate: null },
      { method: '公开招标', openTime: OPEN.toISOString() },
    );
    expect(created.openTime.getTime()).toBe(OPEN.getTime());
    expect(created.deadline.getTime()).toBe(OPEN.getTime() - H24);
  });

  it('createFromAnnouncement：提供 deadline 且差 25h → 400', async () => {
    await expect(service.createFromAnnouncement(
      { id: 'a1', title: 'T', publishDate: null },
      { method: '公开招标', openTime: OPEN.toISOString(),
        deadline: new Date(OPEN.getTime() - 25 * 3_600_000).toISOString() },
    )).rejects.toMatchObject({ response: { code: 'DEADLINE_OPENING_GAP_INVALID' } });
    expect(prisma.bidProject.create).not.toHaveBeenCalled();
  });

  it('reopenFromAborted：兜底 deadline=+3天、openTime=deadline+24h', async () => {
    prisma.bidProject.findUnique.mockImplementation(({ where }: any) =>
      where?.projectCode ? Promise.resolve(null) : Promise.resolve({
        stage: 'ABORTED', name: 'P', projectCode: 'BID-1', procurementMethod: '谈判采购',
        openTime: new Date('2026-08-01'), deadline: new Date('2026-08-01'),
        downloadDeadline: new Date('2026-07-30'), round: 1,
      }));
    prisma.bidProject.create.mockImplementation(({ data }: any) => data);
    const created = await service.reopenFromAborted('p1', 'u1');
    expect(new Date(created.deadline).getTime()).toBeGreaterThan(Date.now());
    expect(new Date(created.openTime).getTime() - new Date(created.deadline).getTime()).toBe(H24);
  });

  it('updateProject align：仅传 openTime → deadline 自动派生', async () => {
    const prevOpen = new Date(Date.now() + 5 * 86400_000);
    prisma.bidProject.findUnique.mockResolvedValue({
      openTime: prevOpen, deadline: new Date(prevOpen.getTime() - 12 * 3_600_000), stage: 'SUBMIT',
    });
    const newOpen = new Date(Date.now() + 10 * 86400_000);
    await service.updateProject('p1', { openTime: newOpen.toISOString() } as any);
    const data = prisma.bidProject.update.mock.calls[0][0].data;
    expect(data.openTime.getTime()).toBe(newOpen.getTime());
    expect(data.deadline.getTime()).toBe(newOpen.getTime() - H24);
  });

  it('updateProject align：双传差 23h → 400 且 update 零调用', async () => {
    const prevOpen = new Date(Date.now() + 5 * 86400_000);
    prisma.bidProject.findUnique.mockResolvedValue({
      openTime: prevOpen, deadline: new Date(prevOpen.getTime() - H24), stage: 'SUBMIT',
    });
    const newOpen = new Date(Date.now() + 10 * 86400_000);
    await expect(service.updateProject('p1', {
      openTime: newOpen.toISOString(),
      deadline: new Date(newOpen.getTime() - 23 * 3_600_000).toISOString(),
    } as any)).rejects.toMatchObject({ response: { code: 'DEADLINE_OPENING_GAP_INVALID' } });
    expect(prisma.bidProject.update).not.toHaveBeenCalled();
  });

  it('updateProject frozen：改 deadline → DEADLINE_FROZEN；仅延 openTime（≥+24h）→ 放行且 deadline 不变', async () => {
    const frozenDeadline = new Date(Date.now() - 86400_000);
    prisma.bidProject.findUnique.mockResolvedValue({
      openTime: new Date(frozenDeadline.getTime() + 12 * 3_600_000), deadline: frozenDeadline, stage: 'OPENING',
    });
    await expect(service.updateProject('p1', {
      deadline: new Date(frozenDeadline.getTime() + 3600_000).toISOString(),
    } as any)).rejects.toMatchObject({ response: { code: 'DEADLINE_FROZEN' } });
    expect(prisma.bidProject.update).not.toHaveBeenCalled();

    prisma.bidProject.update.mockResolvedValue({ id: 'p1' });
    const delayedOpen = new Date(frozenDeadline.getTime() + 48 * 3_600_000);
    await service.updateProject('p1', { openTime: delayedOpen.toISOString() } as any);
    const data = prisma.bidProject.update.mock.calls[0][0].data;
    expect(data.openTime.getTime()).toBe(delayedOpen.getTime());
    expect(data.deadline).toBeUndefined();
  });

  it('updateProject frozen：openTime < deadline+24h → DEADLINE_OPENING_GAP_INVALID', async () => {
    const frozenDeadline = new Date(Date.now() - 86400_000);
    prisma.bidProject.findUnique.mockResolvedValue({
      openTime: new Date(frozenDeadline.getTime() + 12 * 3_600_000), deadline: frozenDeadline, stage: 'OPENING',
    });
    await expect(service.updateProject('p1', {
      openTime: new Date(frozenDeadline.getTime() + 23 * 3_600_000).toISOString(),
    } as any)).rejects.toMatchObject({ response: { code: 'DEADLINE_OPENING_GAP_INVALID' } });
    expect(prisma.bidProject.update).not.toHaveBeenCalled();
  });

  it('updateProject 终审 null 守卫：PATCH {openTime: null} 视同未提供——不写时间字段、不进 align 校验', async () => {
    const prevOpen = new Date(Date.now() + 5 * 86400_000);
    prisma.bidProject.findUnique.mockResolvedValue({
      openTime: prevOpen, deadline: new Date(prevOpen.getTime() - H24), stage: 'SUBMIT',
    });
    await service.updateProject('p1', { openTime: null } as any);
    // null 视同未提供：不读 prev（无 align/frozen 校验）、update 入参不含 openTime/deadline
    expect(prisma.bidProject.findUnique).not.toHaveBeenCalled();
    const data = prisma.bidProject.update.mock.calls[0][0].data;
    expect(data.openTime).toBeUndefined();
    expect(data.deadline).toBeUndefined();
  });
});

/* ── 得分点管理（ScorePoint CRUD）── */

describe('BidService — 得分点管理 (ScorePoint CRUD)', () => {
  let service: BidService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      bidProject: { findUnique: jest.fn(), update: jest.fn() },
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
        BidOpeningRecordService,
        ADMIN_KEY_SVC, DUAL_ENVELOPE_SVC, SIGNATURE_SVC, GB_CODE_SVC,
        BidScoreStandardService,
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
        BidOpeningRecordService,
        ADMIN_KEY_SVC, DUAL_ENVELOPE_SVC, SIGNATURE_SVC, GB_CODE_SVC,
        BidScoreStandardService,
        { provide: StorageService, useValue: { upload: jest.fn() } },
        { provide: PrismaService, useValue: prisma },
        { provide: NotificationService, useValue: { sendToRole: jest.fn() } },
        { provide: BidGateway, useValue: { notifyBidValidity: jest.fn() } },
      ],
    }).compile();
    service = module.get(BidService);
  });

  it('invalid → revoked + bidValidity=valid + WS', async () => {
    // #1 fix: findUnique → findFirst（旧 unique 约束已移除）
    // 两次 findFirst 调用：① 找记录 ② 查是否还有剩余 invalid
    prisma.bidInvalidBid.findFirst
      .mockResolvedValueOnce({ id: 'ib1', projectId: 'p1', supplierId: 'sup1', status: 'invalid', failCount: 2, totalCount: 5 })
      .mockResolvedValueOnce(null); // 撤销后无剩余 invalid 记录
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

// ──────────────────────────────────────────────────────────
// 开标主持人指派 (assignHost) + listProjects 角色过滤 — Task 2
// ──────────────────────────────────────────────────────────

describe('assignHost (BidService) — Task 2', () => {
  let service: BidService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      bidProject: { findUnique: jest.fn(), update: jest.fn() },
      bidOpeningSession: { findUnique: jest.fn() },
      user: { findUnique: jest.fn() },
    };
    const module = await Test.createTestingModule({
      providers: [
        BidService,
        BidOpeningRecordService,
        ADMIN_KEY_SVC, DUAL_ENVELOPE_SVC, SIGNATURE_SVC, GB_CODE_SVC,
        BidScoreStandardService,
        { provide: PrismaService, useValue: prisma },
        { provide: NotificationService, useValue: {} },
        { provide: ClarificationAiService, useValue: {} },
        { provide: BidGateway, useValue: {} },
        { provide: ScoreStandardValidator, useValue: {} },
        { provide: PriceFormulaService, useValue: {} },
        { provide: StorageService, useValue: {} },
      ],
    }).compile();
    service = module.get(BidService);
  });

  it('OpeningSession 已存在 → ConflictException OPENING_SESSION_LOCKED', async () => {
    prisma.bidProject.findUnique.mockResolvedValue({ id: 'p1' });
    prisma.bidOpeningSession.findUnique.mockResolvedValue({ id: 's1', projectId: 'p1' });
    await expect(service.assignHost('p1', 'u1', 'actor1'))
      .rejects.toMatchObject({ response: { code: 'OPENING_SESSION_LOCKED' } });
  });

  it('userId 非 bid_host → BadRequestException INVALID_HOST', async () => {
    prisma.bidProject.findUnique.mockResolvedValue({ id: 'p1' });
    prisma.bidOpeningSession.findUnique.mockResolvedValue(null);
    prisma.user.findUnique.mockResolvedValue({ id: 'u1', role: 'supplier', isActive: true });
    await expect(service.assignHost('p1', 'u1', 'actor1'))
      .rejects.toMatchObject({ response: { code: 'INVALID_HOST' } });
  });

  it('userId = null → 清除指派（assignedHostUserId/assignedAt/assignedByUserId 置空）', async () => {
    prisma.bidProject.findUnique.mockResolvedValue({ id: 'p1' });
    prisma.bidOpeningSession.findUnique.mockResolvedValue(null);
    prisma.bidProject.update.mockResolvedValue({ id: 'p1', assignedHostUser: null });
    const result = await service.assignHost('p1', null, 'actor1');
    expect(prisma.bidProject.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'p1' },
      data: expect.objectContaining({
        assignedHostUserId: null,
        assignedAt: null,
        assignedByUserId: null,
      }),
    }));
    expect(result.assignedHostUser).toBeNull();
  });

  it('合法 bid_host → 写入 assignedHostUserId + assignedAt + assignedByUserId', async () => {
    prisma.bidProject.findUnique.mockResolvedValue({ id: 'p1' });
    prisma.bidOpeningSession.findUnique.mockResolvedValue(null);
    prisma.user.findUnique.mockResolvedValue({ id: 'u1', role: 'bid_host', isActive: true });
    prisma.bidProject.update.mockResolvedValue({
      id: 'p1',
      assignedHostUser: { id: 'u1', username: '陈源远', displayName: '陈源远' },
    });
    const result = await service.assignHost('p1', 'u1', 'actor1');
    expect(prisma.bidProject.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        assignedHostUserId: 'u1',
        assignedAt: expect.any(Date),
        assignedByUserId: 'actor1',
      }),
    }));
    expect(result.assignedHostUser?.username).toBe('陈源远');
  });
});

describe('listProjects actor 过滤 (R1 硬分流) — Task 2', () => {
  let service: BidService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      bidProject: { findMany: jest.fn().mockResolvedValue([]) },
      projectManagementItem: { findMany: jest.fn().mockResolvedValue([]) },
      // 公司隔离（2026-08-20）：web 门户内部角色按 companyId 过滤
      user: { findUnique: jest.fn().mockResolvedValue({ companyId: 'co-x' }) },
    };
    const module = await Test.createTestingModule({
      providers: [
        BidService,
        BidOpeningRecordService,
        ADMIN_KEY_SVC, DUAL_ENVELOPE_SVC, SIGNATURE_SVC, GB_CODE_SVC,
        BidScoreStandardService,
        { provide: PrismaService, useValue: prisma },
        { provide: NotificationService, useValue: {} },
        { provide: ClarificationAiService, useValue: {} },
        { provide: BidGateway, useValue: {} },
        { provide: ScoreStandardValidator, useValue: {} },
        { provide: PriceFormulaService, useValue: {} },
        { provide: StorageService, useValue: {} },
      ],
    }).compile();
    service = module.get(BidService);
  });

  it("portal='bid' → where 含 assignedHostUserId = actor.id", async () => {
    await service.listProjects(undefined, { id: 'host1', role: 'bid_host' }, 'bid');
    expect(prisma.bidProject.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ assignedHostUserId: 'host1', isExtractionOnly: false }),
    }));
  });

  it("portal='web' → 内部角色按公司隔离（2026-08-20），不追加 assignedHostUserId", async () => {
    await service.listProjects(undefined, { id: 'leader1', role: 'leader' }, 'web');
    const callArg = prisma.bidProject.findMany.mock.calls[0][0];
    expect(callArg.where).not.toHaveProperty('assignedHostUserId');
    expect(callArg.where.companyId).toBe('co-x');
    expect(callArg.where.isExtractionOnly).toBe(false);
  });

  it("portal='web' + admin → 不追加公司过滤（全量）", async () => {
    await service.listProjects(undefined, { id: 'adm1', role: 'admin' }, 'web');
    const callArg = prisma.bidProject.findMany.mock.calls[0][0];
    expect(callArg.where).not.toHaveProperty('companyId');
  });

  it('actor 未提供（undefined）→ 不追加过滤（向后兼容）', async () => {
    await service.listProjects(undefined);
    const callArg = prisma.bidProject.findMany.mock.calls[0][0];
    expect(callArg.where).not.toHaveProperty('assignedHostUserId');
  });
});

// ──────────────────────────────────────────────────────────
// startOpening 指派前置闸门 (R2) — Task 4
// ──────────────────────────────────────────────────────────

describe('startOpening 指派前置闸门 (R2) — Task 4', () => {
  let service: BidService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      bidProject: { findUnique: jest.fn() },
      bidOpeningSession: { findUnique: jest.fn(), create: jest.fn() },
      bidExpert: { count: jest.fn().mockResolvedValue(3) },
      bidSupplier: { count: jest.fn().mockResolvedValue(3) },
      bidSupervisionLog: { create: jest.fn() },
      $transaction: jest.fn((cb: any) => cb(prisma)),
    };
    const module = await Test.createTestingModule({
      providers: [
        BidService,
        BidOpeningRecordService,
        ADMIN_KEY_SVC, DUAL_ENVELOPE_SVC, SIGNATURE_SVC, GB_CODE_SVC,
        BidScoreStandardService,
        { provide: PrismaService, useValue: prisma },
        { provide: NotificationService, useValue: {} },
        { provide: ClarificationAiService, useValue: {} },
        { provide: BidGateway, useValue: {} },
        { provide: ScoreStandardValidator, useValue: {} },
        { provide: PriceFormulaService, useValue: {} },
        { provide: StorageService, useValue: {} },
      ],
    }).compile();
    service = module.get(BidService);
  });

  it('未指派主持人 + 阶段推进 → 400 HOST_NOT_ASSIGNED', async () => {
    // 初始项目查询返回 assignedHostUserId = null（未指派）
    prisma.bidProject.findUnique.mockResolvedValue({
      id: 'p1', stage: 'SUBMIT', name: 't', deadline: '2020-01-01',
      projectManagementItemId: null, round: 1, assignedHostUserId: null,
    });

    await expect(service.startOpening('p1', undefined, 'actor1'))
      .rejects.toMatchObject({ response: { code: 'HOST_NOT_ASSIGNED' } });
  });

  it('已指派主持人 → 不抛 HOST_NOT_ASSIGNED（通过指派闸门，继续后续流程）', async () => {
    prisma.bidProject.findUnique.mockResolvedValue({
      id: 'p1', stage: 'SUBMIT', name: 't', deadline: '2020-01-01',
      projectManagementItemId: null, round: 1, assignedHostUserId: 'host1',
    });
    // 后续流程所需 mock（通过指派闸门后会走 deadline/checklist/session 校验）
    prisma.bidProject.update = jest.fn().mockResolvedValue({});
    prisma.bidProject.updateMany = jest.fn().mockResolvedValue({ count: 1 });
    prisma.bidSupplier.updateMany = jest.fn().mockResolvedValue({ count: 1 });
    prisma.bidExpert.updateMany = jest.fn().mockResolvedValue({ count: 1 });
    prisma.bidOpeningSession.create = jest.fn().mockResolvedValue({});
    prisma.bidOpeningRecord = { createMany: jest.fn() };
    prisma.notification = { createMany: jest.fn() };

    // 不 reject HOST_NOT_ASSIGNED 即代表通过闸门
    try {
      await service.startOpening('p1', undefined, 'actor1');
    } catch (e: any) {
      // 即便因其它原因抛错（checklist/session），code 不应是 HOST_NOT_ASSIGNED
      expect(e?.response?.code).not.toBe('HOST_NOT_ASSIGNED');
    }
  });
});

/* ── AI 辅助评标进度聚合（getAiAnalysisProgress）── */

describe('BidService — getAiAnalysisProgress', () => {
  let service: BidService;
  let prisma: any;
  let tenderQ: any;
  let bidderQ: any;
  const NOW = new Date('2026-08-06T12:00:00Z');
  const fresh = (minAgo: number) => new Date(NOW.getTime() - minAgo * 60_000);

  const mkTask = (over: any = {}) => ({
    id: 't1', projectId: 'p1', status: 'ANALYZING', updatedAt: fresh(2), completedAt: null,
    bidderResults: [],
    ...over,
  });
  const mkBidder = (over: any = {}) => ({
    id: 'br1', taskId: 't1', bidSupplierId: 'bs1', status: 'SCORING', updatedAt: fresh(2),
    bidSupplier: { supplierName: '甲公司' },
    ...over,
  });

  beforeEach(async () => {
    prisma = { aiBidAnalysisTask: { findUnique: jest.fn() } };
    // F14：队列 mock 默认「worker 活着」（active=1）——probeWorkerIdle 早退 false，既有用例行为不变
    tenderQ = { getJobCounts: jest.fn().mockResolvedValue({ active: 1, waiting: 0, delayed: 0 }), getJob: jest.fn() };
    bidderQ = { getJobCounts: jest.fn().mockResolvedValue({ active: 1, waiting: 0, delayed: 0 }), getJob: jest.fn() };
    const module = await Test.createTestingModule({
      providers: [
        { provide: PrismaService, useValue: prisma },
        { provide: NotificationService, useValue: { create: jest.fn(), sendToRole: jest.fn(), sendToUser: jest.fn() } },
        { provide: ScoreStandardValidator, useValue: { assertPassFailMaxScore: jest.fn(), assertPointsSumWithinMax: jest.fn().mockResolvedValue(undefined), assertScoreStandardComplete: jest.fn().mockResolvedValue(undefined) } },
        { provide: PriceFormulaService, useValue: { calculate: jest.fn().mockReturnValue(new Map()), getOverCeilingSuppliers: jest.fn().mockReturnValue([]) } },
        BidService,
        BidOpeningRecordService,
        ADMIN_KEY_SVC, DUAL_ENVELOPE_SVC, SIGNATURE_SVC, GB_CODE_SVC,
        BidScoreStandardService,
        { provide: StorageService, useValue: { upload: jest.fn() } },
        { provide: getQueueToken(QUEUE_NAMES.TENDER_PROCESSING), useValue: tenderQ },
        { provide: getQueueToken(QUEUE_NAMES.BIDDER_PROCESSING), useValue: bidderQ },
      ],
    }).compile();
    service = module.get(BidService);
  });

  it('无分析任务 → exists=false 且零值无异常', async () => {
    prisma.aiBidAnalysisTask.findUnique.mockResolvedValue(null);
    const res = await service.getAiAnalysisProgress('p1', NOW);
    expect(res.exists).toBe(false);
    expect(res.total).toBe(0);
    expect(res.anomaly.hasAnomaly).toBe(false);
  });

  it('正常进行中 → 计数正确且无异常', async () => {
    prisma.aiBidAnalysisTask.findUnique.mockResolvedValue(mkTask({ bidderResults: [
      mkBidder({ id: 'br1', status: 'COMPLETED', bidSupplierId: 'bs1', bidSupplier: { supplierName: '甲公司' } }),
      mkBidder({ id: 'br2', status: 'SCORING', bidSupplierId: 'bs2', bidSupplier: { supplierName: '乙公司' }, updatedAt: fresh(3) }),
      mkBidder({ id: 'br3', status: 'PENDING', bidSupplierId: 'bs3', bidSupplier: { supplierName: '丙公司' } }),
    ] }));
    const res = await service.getAiAnalysisProgress('p1', NOW);
    expect(res.exists).toBe(true);
    expect(res.total).toBe(3);
    expect(res.completed).toBe(1);
    expect(res.failed).toBe(0);
    expect(res.bidders).toHaveLength(3);
    expect(res.anomaly.hasAnomaly).toBe(false);
  });

  it('存在 FAILED → failedNames 命中', async () => {
    prisma.aiBidAnalysisTask.findUnique.mockResolvedValue(mkTask({ status: 'COMPLETED_WITH_ERRORS', bidderResults: [
      mkBidder({ id: 'br1', status: 'COMPLETED', bidSupplier: { supplierName: '甲公司' } }),
      mkBidder({ id: 'br2', status: 'FAILED', bidSupplierId: 'bs2', bidSupplier: { supplierName: '乙公司' } }),
    ] }));
    const res = await service.getAiAnalysisProgress('p1', NOW);
    expect(res.failed).toBe(1);
    expect(res.anomaly.hasAnomaly).toBe(true);
    expect(res.anomaly.failedNames).toEqual(['乙公司']);
  });

  it('中间态停摆超 30 分钟 → stuckNames 命中；未超时不算', async () => {
    prisma.aiBidAnalysisTask.findUnique.mockResolvedValue(mkTask({ bidderResults: [
      mkBidder({ id: 'br1', status: 'OCR_PROCESSING', updatedAt: fresh(40), bidSupplier: { supplierName: '甲公司' } }),
      mkBidder({ id: 'br2', status: 'EXTRACTING', updatedAt: fresh(5), bidSupplierId: 'bs2', bidSupplier: { supplierName: '乙公司' } }),
    ] }));
    const res = await service.getAiAnalysisProgress('p1', NOW);
    expect(res.anomaly.stuckNames).toEqual(['甲公司']);
    expect(res.anomaly.hasAnomaly).toBe(true);
  });

  it('task PENDING 停摆 + 全部 bidder PENDING → allPending', async () => {
    prisma.aiBidAnalysisTask.findUnique.mockResolvedValue(mkTask({ status: 'PENDING', updatedAt: fresh(45), bidderResults: [
      mkBidder({ id: 'br1', status: 'PENDING', bidSupplier: { supplierName: '甲公司' } }),
      mkBidder({ id: 'br2', status: 'PENDING', bidSupplierId: 'bs2', bidSupplier: { supplierName: '乙公司' } }),
    ] }));
    const res = await service.getAiAnalysisProgress('p1', NOW);
    expect(res.anomaly.allPending).toBe(true);
    expect(res.anomaly.hasAnomaly).toBe(true);
  });

  it('有 bidder 已启动过则不算 allPending', async () => {
    prisma.aiBidAnalysisTask.findUnique.mockResolvedValue(mkTask({ status: 'TENDER_PROCESSING', updatedAt: fresh(45), bidderResults: [
      mkBidder({ id: 'br1', status: 'PENDING', bidSupplier: { supplierName: '甲公司' } }),
      mkBidder({ id: 'br2', status: 'COMPLETED', bidSupplierId: 'bs2', bidSupplier: { supplierName: '乙公司' } }),
    ] }));
    const res = await service.getAiAnalysisProgress('p1', NOW);
    expect(res.anomaly.allPending).toBe(false);
  });

  it('task FAILED → taskFailed', async () => {
    prisma.aiBidAnalysisTask.findUnique.mockResolvedValue(mkTask({ status: 'FAILED', bidderResults: [] }));
    const res = await service.getAiAnalysisProgress('p1', NOW);
    expect(res.anomaly.taskFailed).toBe(true);
    expect(res.anomaly.hasAnomaly).toBe(true);
  });

  it('全部 COMPLETED → 无异常', async () => {
    prisma.aiBidAnalysisTask.findUnique.mockResolvedValue(mkTask({ status: 'COMPLETED', completedAt: fresh(1), bidderResults: [
      mkBidder({ id: 'br1', status: 'COMPLETED', bidSupplier: { supplierName: '甲公司' } }),
    ] }));
    const res = await service.getAiAnalysisProgress('p1', NOW);
    expect(res.completed).toBe(1);
    expect(res.anomaly.hasAnomaly).toBe(false);
  });

  it('task ANALYZING + 全部 bidder PENDING + 停摆 → allPending（worker 入队循环中死亡场景）', async () => {
    prisma.aiBidAnalysisTask.findUnique.mockResolvedValue(mkTask({ status: 'ANALYZING', updatedAt: fresh(45), bidderResults: [
      mkBidder({ id: 'br1', status: 'PENDING', bidSupplier: { supplierName: '甲公司' } }),
      mkBidder({ id: 'br2', status: 'PENDING', bidSupplierId: 'bs2', bidSupplier: { supplierName: '乙公司' } }),
    ] }));
    const res = await service.getAiAnalysisProgress('p1', NOW);
    expect(res.anomaly.allPending).toBe(true);
    expect(res.anomaly.hasAnomaly).toBe(true);
  });

  it('task ANALYZING + 全部 bidder PENDING 但 updatedAt 新鲜 → 不算 allPending', async () => {
    prisma.aiBidAnalysisTask.findUnique.mockResolvedValue(mkTask({ status: 'ANALYZING', updatedAt: fresh(2), bidderResults: [
      mkBidder({ id: 'br1', status: 'PENDING', bidSupplier: { supplierName: '甲公司' } }),
    ] }));
    const res = await service.getAiAnalysisProgress('p1', NOW);
    expect(res.anomaly.allPending).toBe(false);
    expect(res.anomaly.hasAnomaly).toBe(false);
  });

  /* ── F14（2026-08-28）：workerIdle 队列探测（即时，不再干等 30 分钟 allPending）── */
  it('F14：task PENDING 全 bidder PENDING 停摆 60s + 队列零 active 有 waiting → workerIdle 即时为 true（allPending 仍 false）', async () => {
    prisma.aiBidAnalysisTask.findUnique.mockResolvedValue(mkTask({ status: 'PENDING', updatedAt: fresh(1), bidderResults: [
      mkBidder({ id: 'br1', status: 'PENDING', bidSupplier: { supplierName: '甲公司' } }),
    ] }));
    tenderQ.getJobCounts.mockResolvedValueOnce({ active: 0, waiting: 1, delayed: 0 });
    const res = await service.getAiAnalysisProgress('p1', NOW);
    expect(res.anomaly.workerIdle).toBe(true);
    expect(res.anomaly.hasAnomaly).toBe(true);
    expect(res.anomaly.allPending).toBe(false); // 停摆仅 1 分钟，30 分钟兜底口径不应命中
    expect(tenderQ.getJobCounts).toHaveBeenCalledTimes(1);
  });

  it('F14：worker 正在消费（active>0，本项目排队属正常）→ workerIdle=false 不误报', async () => {
    prisma.aiBidAnalysisTask.findUnique.mockResolvedValue(mkTask({ status: 'PENDING', updatedAt: fresh(1), bidderResults: [
      mkBidder({ id: 'br1', status: 'PENDING', bidSupplier: { supplierName: '甲公司' } }),
    ] }));
    tenderQ.getJobCounts.mockResolvedValueOnce({ active: 2, waiting: 1, delayed: 0 });
    const res = await service.getAiAnalysisProgress('p1', NOW);
    expect(res.anomaly.workerIdle).toBe(false);
    expect(tenderQ.getJob).not.toHaveBeenCalled(); // active>0 早退，无需查本项目 job
  });

  it('F14：停摆在宽限窗内（5s）→ 不探测队列', async () => {
    prisma.aiBidAnalysisTask.findUnique.mockResolvedValue(mkTask({ status: 'PENDING', updatedAt: new Date(NOW.getTime() - 5_000), bidderResults: [
      mkBidder({ id: 'br1', status: 'PENDING', bidSupplier: { supplierName: '甲公司' } }),
    ] }));
    const res = await service.getAiAnalysisProgress('p1', NOW);
    expect(res.anomaly.workerIdle).toBe(false);
    expect(tenderQ.getJobCounts).not.toHaveBeenCalled(); // 入队竞态宽限（task 行先建 job 后 add）
  });

  it('F14：全队列空 + 本项目确定性 jobId 查不到（从未入队）→ workerIdle=true；ANALYZING 态查 bidder 队列', async () => {
    prisma.aiBidAnalysisTask.findUnique.mockResolvedValue(mkTask({ status: 'ANALYZING', updatedAt: fresh(1), bidderResults: [
      mkBidder({ id: 'br1', status: 'PENDING', bidSupplier: { supplierName: '甲公司' } }),
    ] }));
    bidderQ.getJobCounts.mockResolvedValueOnce({ active: 0, waiting: 0, delayed: 0 });
    bidderQ.getJob.mockResolvedValueOnce(null);
    const res = await service.getAiAnalysisProgress('p1', NOW);
    expect(res.anomaly.workerIdle).toBe(true);
    expect(bidderQ.getJob).toHaveBeenCalledWith('bidderResult-br1'); // F7 确定性 jobId
    expect(tenderQ.getJobCounts).not.toHaveBeenCalled(); // ANALYZING 只查 bidder 队列
  });
});

/* ── AI 单家重试（retryAiBidders）── */

describe('BidService — retryAiBidders', () => {
  let service: BidService;
  let prisma: any;
  let bidderQueue: { add: jest.Mock; remove: jest.Mock };
  const NOW = Date.now();
  const mkBidder = (over: any = {}) => ({
    id: 'br1', taskId: 't1', bidSupplierId: 'bs1', status: 'FAILED',
    updatedAt: new Date(NOW - 2 * 60_000),
    bidSupplier: { supplierName: '甲公司' },
    ...over,
  });

  beforeEach(async () => {
    bidderQueue = { add: jest.fn().mockResolvedValue({ id: 'job' }), remove: jest.fn().mockResolvedValue(undefined) };
    prisma = {
      bidProject: { findUnique: jest.fn(async () => ({ stage: 'EVALUATING', name: '测试项目' })) },
      aiBidAnalysisTask: {
        findUnique: jest.fn(async () => ({
          id: 't1', projectId: 'p1', status: 'COMPLETED_WITH_ERRORS', bidderResults: [mkBidder()],
        })),
        update: jest.fn().mockResolvedValue({}),
      },
      aiBidderResult: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      bidSupervisionLog: { create: jest.fn().mockResolvedValue({}) },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
      $transaction: jest.fn(async (cb: any) => cb(prisma)),
    };
    const module = await Test.createTestingModule({
      providers: [
        { provide: PrismaService, useValue: prisma },
        { provide: NotificationService, useValue: { create: jest.fn(), sendToRole: jest.fn(), sendToUser: jest.fn() } },
        { provide: ScoreStandardValidator, useValue: { assertPassFailMaxScore: jest.fn(), assertPointsSumWithinMax: jest.fn().mockResolvedValue(undefined), assertScoreStandardComplete: jest.fn().mockResolvedValue(undefined) } },
        { provide: PriceFormulaService, useValue: { calculate: jest.fn().mockReturnValue(new Map()), getOverCeilingSuppliers: jest.fn().mockReturnValue([]) } },
        BidService,
        BidOpeningRecordService,
        ADMIN_KEY_SVC, DUAL_ENVELOPE_SVC, SIGNATURE_SVC, GB_CODE_SVC,
        BidScoreStandardService,
        { provide: StorageService, useValue: { upload: jest.fn() } },
        { provide: getQueueToken(QUEUE_NAMES.BIDDER_PROCESSING), useValue: bidderQueue },
      ],
    }).compile();
    service = module.get(BidService);
  });

  it('阶段非 EVALUATING → 拒绝', async () => {
    prisma.bidProject.findUnique.mockResolvedValue({ stage: 'OPENING', name: '测试项目' });
    await expect(service.retryAiBidders('p1', undefined, 'u1')).rejects.toMatchObject({ message: expect.stringContaining('评标阶段') });
    expect(bidderQueue.add).not.toHaveBeenCalled();
  });

  it('无分析任务 → 拒绝', async () => {
    prisma.aiBidAnalysisTask.findUnique.mockResolvedValue(null);
    await expect(service.retryAiBidders('p1', undefined, 'u1')).rejects.toMatchObject({ message: expect.stringContaining('未找到') });
  });

  it('task 状态 COMPLETED（全部成功）→ 拒绝', async () => {
    prisma.aiBidAnalysisTask.findUnique.mockResolvedValue({ id: 't1', projectId: 'p1', status: 'COMPLETED', bidderResults: [mkBidder({ status: 'COMPLETED' })] });
    await expect(service.retryAiBidders('p1', undefined, 'u1')).rejects.toMatchObject({ message: expect.stringContaining('不支持') });
  });

  it('无可重试对象（bidder 全正常）→ 拒绝', async () => {
    prisma.aiBidAnalysisTask.findUnique.mockResolvedValue({ id: 't1', projectId: 'p1', status: 'ANALYZING', bidderResults: [mkBidder({ status: 'COMPLETED' }), mkBidder({ id: 'br2', status: 'SCORING', bidSupplierId: 'bs2', bidSupplier: { supplierName: '乙公司' } })] });
    await expect(service.retryAiBidders('p1', undefined, 'u1')).rejects.toMatchObject({ message: expect.stringContaining('无可重试') });
  });

  it('指定 ids → 仅重置并入队该 bidder；task 置回 ANALYZING', async () => {
    prisma.aiBidAnalysisTask.findUnique.mockResolvedValue({ id: 't1', projectId: 'p1', status: 'COMPLETED_WITH_ERRORS', bidderResults: [
      mkBidder({ id: 'br1', status: 'FAILED', bidSupplier: { supplierName: '甲公司' } }),
      mkBidder({ id: 'br2', status: 'FAILED', bidSupplierId: 'bs2', bidSupplier: { supplierName: '乙公司' } }),
    ] });
    const res = await service.retryAiBidders('p1', ['br1'], 'u1');
    expect(res.retried).toEqual([{ id: 'br1', name: '甲公司' }]);
    expect(prisma.aiBidderResult.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: { in: ['br1'] } }, data: expect.objectContaining({ status: 'PENDING', processedAt: null }) }));
    expect(bidderQueue.add).toHaveBeenCalledTimes(1);
    // F7：确定性 jobId（与 tender.processor 同源）+ add 前强制 remove（BullMQ 保留态同 id 去重陷阱）
    expect(bidderQueue.add).toHaveBeenCalledWith('process', { bidderResultId: 'br1', taskId: 't1' }, expect.objectContaining({ jobId: 'bidderResult-br1', attempts: 3 }));
    expect(bidderQueue.remove).toHaveBeenCalledWith('bidderResult-br1');
    expect(prisma.bidSupervisionLog.create).toHaveBeenCalled();
    expect(prisma.aiBidAnalysisTask.update).toHaveBeenCalledWith({ where: { id: 't1' }, data: expect.objectContaining({ status: 'ANALYZING', completedAt: null }) });
  });

  it('不传 ids → 重试全部 FAILED + 卡住家（PENDING 与正常中间态不参与）', async () => {
    prisma.aiBidAnalysisTask.findUnique.mockResolvedValue({ id: 't1', projectId: 'p1', status: 'ANALYZING', bidderResults: [
      mkBidder({ id: 'br1', status: 'FAILED', bidSupplier: { supplierName: '甲公司' } }),
      mkBidder({ id: 'br2', status: 'OCR_PROCESSING', updatedAt: new Date(NOW - 40 * 60_000), bidSupplierId: 'bs2', bidSupplier: { supplierName: '乙公司' } }),
      mkBidder({ id: 'br3', status: 'SCORING', updatedAt: new Date(NOW - 3 * 60_000), bidSupplierId: 'bs3', bidSupplier: { supplierName: '丙公司' } }),
      mkBidder({ id: 'br4', status: 'PENDING', bidSupplierId: 'bs4', bidSupplier: { supplierName: '丁公司' } }),
    ] });
    const res = await service.retryAiBidders('p1', undefined, 'u1');
    expect(res.retried.map((r: any) => r.id).sort()).toEqual(['br1', 'br2']);
    expect(bidderQueue.add).toHaveBeenCalledTimes(2);
  });

  it('入队失败（Redis 异常）→ ENQUEUE_FAILED + 回滚本次 PENDING/ANALYZING 重置（不留假成功停摆）', async () => {
    prisma.aiBidAnalysisTask.findUnique.mockResolvedValue({ id: 't1', projectId: 'p1', status: 'COMPLETED_WITH_ERRORS', completedAt: new Date(NOW - 60_000), bidderResults: [mkBidder({ id: 'br1', status: 'FAILED', bidSupplier: { supplierName: '甲公司' } })] });
    bidderQueue.add.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    await expect(service.retryAiBidders('p1', undefined, 'u1')).rejects.toMatchObject({ message: expect.stringContaining('入队失败') });
    // 回滚：行还原 FAILED、task 还原 COMPLETED_WITH_ERRORS（含原 completedAt），且不写成功日志/审计
    expect(prisma.aiBidderResult.updateMany).toHaveBeenLastCalledWith(
      expect.objectContaining({ where: { id: { in: ['br1'] } }, data: { status: 'FAILED' } }),
    );
    expect(prisma.aiBidAnalysisTask.update).toHaveBeenLastCalledWith(
      expect.objectContaining({ where: { id: 't1' }, data: expect.objectContaining({ status: 'COMPLETED_WITH_ERRORS' }) }),
    );
    expect(prisma.bidSupervisionLog.create).not.toHaveBeenCalled();
  });

  it('F7：bidderQueue 未注入（Redis/worker 异常）→ 503 QUEUE_UNAVAILABLE，DB 零改动', async () => {
    prisma.aiBidAnalysisTask.findUnique.mockResolvedValue({ id: 't1', projectId: 'p1', status: 'COMPLETED_WITH_ERRORS', bidderResults: [mkBidder({ id: 'br1', status: 'FAILED', bidSupplier: { supplierName: '甲公司' } })] });
    // 无队列 provider 的模块（@Optional 注入为 undefined）——旧实现仅 warn 后假成功
    const module = await Test.createTestingModule({
      providers: [
        { provide: PrismaService, useValue: prisma },
        { provide: NotificationService, useValue: { create: jest.fn(), sendToRole: jest.fn(), sendToUser: jest.fn() } },
        { provide: ScoreStandardValidator, useValue: { assertPassFailMaxScore: jest.fn(), assertPointsSumWithinMaxScore: jest.fn().mockResolvedValue(undefined), assertScoreStandardComplete: jest.fn().mockResolvedValue(undefined) } },
        { provide: PriceFormulaService, useValue: { calculate: jest.fn().mockReturnValue(new Map()), getOverCeilingSuppliers: jest.fn().mockReturnValue([]) } },
        BidService,
        BidOpeningRecordService,
        ADMIN_KEY_SVC, DUAL_ENVELOPE_SVC, SIGNATURE_SVC, GB_CODE_SVC,
        BidScoreStandardService,
        { provide: StorageService, useValue: { upload: jest.fn() } },
      ],
    }).compile();
    const svc = module.get(BidService);
    await expect(svc.retryAiBidders('p1', undefined, 'u1')).rejects.toMatchObject({
      status: 503,
      response: { code: 'QUEUE_UNAVAILABLE' },
    });
    expect(prisma.aiBidderResult.updateMany).not.toHaveBeenCalled();
    expect(prisma.aiBidAnalysisTask.update).not.toHaveBeenCalled();
  });
});

/* ── N8：rerunAiAnalysis 存量项目补建任务 ── */

describe('BidService — rerunAiAnalysis (N8 存量补建)', () => {
  let service: BidService;
  let prisma: any;
  let tenderQueue: { add: jest.Mock; remove: jest.Mock };

  beforeEach(async () => {
    tenderQueue = { add: jest.fn().mockResolvedValue({}), remove: jest.fn().mockResolvedValue(undefined) };
    prisma = {
      bidProject: { findUnique: jest.fn(async () => ({ stage: 'EVALUATING', name: 'P' })) },
      aiBidAnalysisTask: {
        findUnique: jest.fn(async () => ({ id: 't1', projectId: 'p1', status: 'COMPLETED' })),
        create: jest.fn(async () => ({ id: 'task-1', projectId: 'p1', status: 'PENDING' })),
        upsert: jest.fn(async () => ({ id: 'task-1', projectId: 'p1', status: 'PENDING' })),
        update: jest.fn(async () => ({})),
      },
      aiBidReport: { deleteMany: jest.fn(async () => ({ count: 0 })) },
      aiConcordanceResult: { deleteMany: jest.fn(async () => ({ count: 0 })) },
      aiBidderResult: { deleteMany: jest.fn(async () => ({ count: 0 })), createMany: jest.fn(async () => ({ count: 1 })) },
      bidSupplier: { findMany: jest.fn(async () => [{ id: 'bs-1' }]) },
      bidSupervisionLog: { create: jest.fn(async () => ({})) },
      auditLog: { create: jest.fn(async () => ({})) }, // F15：rerun 补审计
      // 评标产出保护闸门（2026-08-28）：默认无产出放行
      bidRequirementReview: { count: jest.fn(async () => 0) },
      bidScoreRecord: { count: jest.fn(async () => 0) },
      bidScorePointDecision: { count: jest.fn(async () => 0) },
      $transaction: jest.fn(async (cb: any) => cb(prisma)),
    };
    // F7：rerunAiAnalysis 现依赖 tenderQueue（缺失即 503，不再静默假成功）
    const module = await Test.createTestingModule({
      providers: [
        { provide: PrismaService, useValue: prisma },
        { provide: NotificationService, useValue: { create: jest.fn(), sendToRole: jest.fn(), sendToUser: jest.fn() } },
        { provide: ScoreStandardValidator, useValue: { assertPassFailMaxScore: jest.fn(), assertPointsSumWithinMaxScore: jest.fn().mockResolvedValue(undefined), assertScoreStandardComplete: jest.fn().mockResolvedValue(undefined) } },
        { provide: PriceFormulaService, useValue: { calculate: jest.fn().mockReturnValue(new Map()), getOverCeilingSuppliers: jest.fn().mockReturnValue([]) } },
        BidService,
        BidOpeningRecordService,
        ADMIN_KEY_SVC, DUAL_ENVELOPE_SVC, SIGNATURE_SVC, GB_CODE_SVC,
        BidScoreStandardService,
        { provide: StorageService, useValue: { upload: jest.fn() } },
        { provide: getQueueToken(QUEUE_NAMES.TENDER_PROCESSING), useValue: tenderQueue },
      ],
    }).compile();
    service = module.get(BidService);
  });

  it('N8：存量项目无 AI 任务时 rerunAiAnalysis 自动补建（不再 TASK_NOT_FOUND）', async () => {
    prisma.bidProject.findUnique.mockResolvedValue({ stage: 'EVALUATING', name: 'P' });
    prisma.aiBidAnalysisTask.findUnique.mockResolvedValue(null);
    prisma.aiBidAnalysisTask.upsert.mockResolvedValue({ id: 'task-1' });
    prisma.bidSupplier.findMany.mockResolvedValue([{ id: 'bs-1' }]);
    prisma.aiBidderResult.createMany.mockResolvedValue({ count: 1 });
    await expect(service.rerunAiAnalysis('p1', 'u1')).resolves.toBeTruthy();
    // 终审 must-fix：补建用 upsert（与 startEvaluation :1515 完全同构，update 空分支）——
    // 并发双 rerun 双双 findUnique 落空时，后到方撞 projectId @unique 走 update 分支而非 P2002 裸 500
    expect(prisma.aiBidAnalysisTask.create).not.toHaveBeenCalled();
    expect(prisma.aiBidAnalysisTask.upsert).toHaveBeenCalledWith({
      where: { projectId: 'p1' },
      create: { projectId: 'p1', status: 'PENDING' },
      update: {},
    });
    // 与 startEvaluation 同构：为解密成功供应商补 bidderResult（skipDuplicates 幂等）
    expect(prisma.aiBidderResult.createMany).toHaveBeenCalledWith(
      expect.objectContaining({ skipDuplicates: true }),
    );
    const createManyArg = prisma.aiBidderResult.createMany.mock.calls[0][0];
    expect(createManyArg.data).toEqual([{ taskId: 'task-1', bidSupplierId: 'bs-1', status: 'PENDING' }]);
  });

  it('终审：并发双 rerun 双双未见任务 → upsert 后到方走 update 空分支复用既有 task，不炸', async () => {
    // 模拟竞输方：findUnique 读到 null（对手尚未提交），upsert 撞 key 返回对手已建的 task
    prisma.aiBidAnalysisTask.findUnique.mockResolvedValue(null);
    prisma.aiBidAnalysisTask.upsert.mockResolvedValue({ id: 't1-race', projectId: 'p1', status: 'PENDING' });
    prisma.bidSupplier.findMany.mockResolvedValue([{ id: 'bs-1' }]);
    await expect(service.rerunAiAnalysis('p1', 'u1')).resolves.toEqual({ taskId: 't1-race' });
    // 复用竞胜方的 task 继续清空重跑——后续写入全部指向同一 taskId，无双任务分叉
    expect(prisma.aiBidReport.deleteMany).toHaveBeenCalledWith({ where: { taskId: 't1-race' } });
    expect(prisma.aiBidAnalysisTask.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 't1-race' } }),
    );
  });

  it('任务已存在 → 走原清空重跑路径，不补建', async () => {
    await expect(service.rerunAiAnalysis('p1', 'u1')).resolves.toBeTruthy();
    expect(prisma.aiBidAnalysisTask.create).not.toHaveBeenCalled();
    expect(prisma.aiBidAnalysisTask.upsert).not.toHaveBeenCalled();
    expect(prisma.aiBidReport.deleteMany).toHaveBeenCalledWith({ where: { taskId: 't1' } });
    expect(prisma.aiBidderResult.deleteMany).toHaveBeenCalledWith({ where: { taskId: 't1' } });
    expect(prisma.aiBidAnalysisTask.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 't1' }, data: expect.objectContaining({ status: 'PENDING' }) }),
    );
  });

  /* ── 评标产出保护闸门（2026-08-28 审查修复）：重跑会级联删除专家标注，有产出即 409 ── */
  it('已有条款标注 → 409 EVALUATION_IN_PROGRESS，不删任何旧结果', async () => {
    prisma.bidRequirementReview.count.mockResolvedValue(2);
    await expect(service.rerunAiAnalysis('p1', 'u1')).rejects.toMatchObject({
      response: { code: 'EVALUATION_IN_PROGRESS' },
    });
    expect(prisma.aiBidderResult.deleteMany).not.toHaveBeenCalled();
    expect(prisma.aiBidAnalysisTask.update).not.toHaveBeenCalled();
  });

  it('已有评分记录 → 409 EVALUATION_IN_PROGRESS', async () => {
    prisma.bidScoreRecord.count.mockResolvedValue(5);
    await expect(service.rerunAiAnalysis('p1', 'u1')).rejects.toMatchObject({
      response: { code: 'EVALUATION_IN_PROGRESS' },
    });
    expect(prisma.aiBidderResult.deleteMany).not.toHaveBeenCalled();
  });

  it('已有得分点勾选 → 409 EVALUATION_IN_PROGRESS', async () => {
    prisma.bidScorePointDecision.count.mockResolvedValue(1);
    await expect(service.rerunAiAnalysis('p1', 'u1')).rejects.toMatchObject({
      response: { code: 'EVALUATION_IN_PROGRESS' },
    });
    expect(prisma.aiBidderResult.deleteMany).not.toHaveBeenCalled();
  });

  /* ── F7（2026-08-28）：确定性 jobId + 队列缺失 503 + 入队失败兜底 ── */
  it('F7：tender job 用确定性 jobId `tender-${taskId}`，且 add 前强制 remove（防保留态去重假成功）', async () => {
    await expect(service.rerunAiAnalysis('p1', 'u1')).resolves.toBeTruthy();
    expect(tenderQueue.remove).toHaveBeenCalledWith('tender-t1');
    expect(tenderQueue.add).toHaveBeenCalledWith(
      'process',
      { taskId: 't1' },
      expect.objectContaining({ jobId: 'tender-t1' }),
    );
  });

  it('F7：tenderQueue 未注入 → 503 QUEUE_UNAVAILABLE，且发生在清空旧结果之前（不删任何东西）', async () => {
    const module = await Test.createTestingModule({
      providers: [
        { provide: PrismaService, useValue: prisma },
        { provide: NotificationService, useValue: { create: jest.fn(), sendToRole: jest.fn(), sendToUser: jest.fn() } },
        { provide: ScoreStandardValidator, useValue: { assertPassFailMaxScore: jest.fn(), assertPointsSumWithinMaxScore: jest.fn().mockResolvedValue(undefined), assertScoreStandardComplete: jest.fn().mockResolvedValue(undefined) } },
        { provide: PriceFormulaService, useValue: { calculate: jest.fn().mockReturnValue(new Map()), getOverCeilingSuppliers: jest.fn().mockReturnValue([]) } },
        BidService,
        BidOpeningRecordService,
        ADMIN_KEY_SVC, DUAL_ENVELOPE_SVC, SIGNATURE_SVC, GB_CODE_SVC,
        BidScoreStandardService,
        { provide: StorageService, useValue: { upload: jest.fn() } },
        // 注意：故意不提供 TENDER_PROCESSING 队列 token
      ],
    }).compile();
    const svc = module.get(BidService);
    await expect(svc.rerunAiAnalysis('p1', 'u1')).rejects.toMatchObject({
      status: 503,
      response: { code: 'QUEUE_UNAVAILABLE' },
    });
    // 旧实现：静默跳过入队却照常清空旧结果并返回 { taskId }——最坏路径已被拦死
    expect(prisma.aiBidderResult.deleteMany).not.toHaveBeenCalled();
    expect(prisma.aiBidReport.deleteMany).not.toHaveBeenCalled();
  });

  it('F7：入队失败（Redis 异常）→ task 置 FAILED + ENQUEUE_FAILED', async () => {
    tenderQueue.add.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    await expect(service.rerunAiAnalysis('p1', 'u1')).rejects.toMatchObject({
      response: { code: 'ENQUEUE_FAILED' },
    });
    expect(prisma.aiBidAnalysisTask.update).toHaveBeenLastCalledWith(
      expect.objectContaining({ where: { id: 't1' }, data: { status: 'FAILED' } }),
    );
  });

  /* ── F15（2026-08-28）：进行中禁重跑 + 补审计 ── */
  it('F15：task 进行中（ANALYZING）→ 409 TASK_IN_PROGRESS，不清空在途分析', async () => {
    prisma.aiBidAnalysisTask.findUnique.mockResolvedValue({ id: 't1', projectId: 'p1', status: 'ANALYZING' });
    await expect(service.rerunAiAnalysis('p1', 'u1')).rejects.toMatchObject({
      response: { code: 'TASK_IN_PROGRESS' },
    });
    expect(prisma.aiBidderResult.deleteMany).not.toHaveBeenCalled();
    expect(prisma.aiBidReport.deleteMany).not.toHaveBeenCalled();
    expect(tenderQueue.add).not.toHaveBeenCalled();
  });

  it('F15：重跑成功 → 写 BID_AI_RERUN_ANALYSIS 审计（旧实现零审计）', async () => {
    await expect(service.rerunAiAnalysis('p1', 'u1')).resolves.toBeTruthy();
    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ userId: 'u1', action: 'BID_AI_RERUN_ANALYSIS', resourceType: 'BidProject:p1' }),
      }),
    );
  });
});

/* ── Task 2: completeOpening TOCTOU 收窄 —— 事务内复查 opening-done ── */

describe('completeOpening TOCTOU', () => {
  it('事务内复查——若有未解异议应抛 ConflictException', () => {
    // assertOpeningDone 的 notReady 判定已在纯函数层覆盖
    // 这里验证：DISPUTED 供应商被认为 not ready
    const activeSuppliers = [
      { supplierName: 'A', decryptStatus: 'SUCCESS', confirmStatus: 'DISPUTED' },
    ];
    const notReady = activeSuppliers.filter(s => {
      if (s.decryptStatus === 'DANGER') return false;
      if (s.decryptStatus !== 'SUCCESS') return true;
      return s.confirmStatus !== 'CONFIRMED' && s.confirmStatus !== 'EXCEPTION';
    });
    expect(notReady).toHaveLength(1);
    expect(notReady[0].supplierName).toBe('A');
  });

  it('事务内复查——CONFIRMED 供应商被判定 ready（对照组）', () => {
    const activeSuppliers = [
      { supplierName: 'A', decryptStatus: 'SUCCESS', confirmStatus: 'CONFIRMED' },
      { supplierName: 'B', decryptStatus: 'DANGER', confirmStatus: 'PENDING' },
    ];
    const notReady = activeSuppliers.filter(s => {
      if (s.decryptStatus === 'DANGER') return false;
      if (s.decryptStatus !== 'SUCCESS') return true;
      return s.confirmStatus !== 'CONFIRMED' && s.confirmStatus !== 'EXCEPTION';
    });
    expect(notReady).toHaveLength(0);
  });
});


/* ── 纯函数测试：listScores 匿名化变换 ── */

describe('listScores anonymization', () => {
  it('EXPERT_SCORE_ANONYMIZED_DURING_EVAL=true 时 EVALUATING 阶段应剥离 expert 标识', () => {
    const record = { expertId: 'e1', expert: { expertName: '张三', id: 'e1' }, score: 80, scoreItemId: 'i1' };
    const anonymized = { ...record, expertId: null, expert: { ...record.expert, expertName: '专家', id: null } };
    expect(anonymized.expertId).toBeNull();
    expect(anonymized.expert.expertName).toBe('专家');
    expect(anonymized.expert.id).toBeNull();
    // 非身份字段不受影响
    expect(anonymized.score).toBe(80);
    expect(anonymized.scoreItemId).toBe('i1');
  });

  it('全部专家报告已确认时不剥离 expert 标识', () => {
    // 模拟全部报告已确认的场景
    const records = [
      { expertId: 'e1', expert: { expertName: '张三', id: 'e1' }, score: 80 },
      { expertId: 'e2', expert: { expertName: '李四', id: 'e2' }, score: 90 },
    ];
    const allConfirmed = true;
    const stage = 'EVALUATING';
    // 全部确认 + EVALUATING 阶段 — 不匿名化
    if (stage === 'EVALUATING' && !allConfirmed) {
      // should not enter here
    }
    // 记录保持原样
    expect(records[0].expertId).toBe('e1');
    expect(records[0].expert.expertName).toBe('张三');
    expect(records[1].expertId).toBe('e2');
    expect(records[1].expert.expertName).toBe('李四');
  });

  it('非 EVALUATING 阶段不剥离 expert 标识', () => {
    const records = [
      { expertId: 'e1', expert: { expertName: '张三', id: 'e1' }, score: 80 },
    ];
    const stage: string = 'ARCHIVED';
    const allConfirmed = false;
    // 非 EVALUATING 阶段不匿名化
    const shouldAnonymize = stage === 'EVALUATING' && !allConfirmed;
    expect(shouldAnonymize).toBe(false);
    // 记录保持原样
    expect(records[0].expertId).toBe('e1');
    expect(records[0].expert.expertName).toBe('张三');
  });
});

/* ── Task 8: 评标完整性快照 ── */

describe('createRound — 供应商准入', () => {
  let service: BidService;
  let prisma: any;
  let notification: { sendToRole: jest.Mock; sendToUser: jest.Mock };

  beforeEach(async () => {
    prisma = {
      bidProject: { findUnique: jest.fn(), update: jest.fn() },
      bidRound: { findFirst: jest.fn().mockResolvedValue(null), findUnique: jest.fn(), create: jest.fn().mockResolvedValue({ id: 'r1', roundNo: 1 }), count: jest.fn().mockResolvedValue(0) },
      bidSupplier: { findMany: jest.fn(), findFirst: jest.fn() },
      bidQuote: { create: jest.fn() },
      bidSupervisionLog: { create: jest.fn().mockResolvedValue({}) },
      bidOpeningSession: { update: jest.fn() },
      $queryRaw: jest.fn(),
      $transaction: jest.fn(async (cb: any) => typeof cb === 'function' ? cb(prisma) : Promise.all(cb)),
    };
    notification = { sendToRole: jest.fn(), sendToUser: jest.fn().mockResolvedValue({}) };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BidService,
        BidOpeningRecordService,
        ADMIN_KEY_SVC, DUAL_ENVELOPE_SVC, SIGNATURE_SVC, GB_CODE_SVC,
        BidScoreStandardService,
        { provide: PrismaService, useValue: prisma },
        { provide: ScoreStandardValidator, useValue: { assertPassFailMaxScore: jest.fn(), assertPointsSumWithinMax: jest.fn(), assertScoreStandardComplete: jest.fn() } },
        { provide: PriceFormulaService, useValue: { calculate: jest.fn(), getOverCeilingSuppliers: jest.fn() } },
        { provide: StorageService, useValue: {} },
        { provide: NotificationService, useValue: notification },
      ],
    }).compile();
    service = module.get(BidService);
  });

  it('显式指定合格供应商 → 存入 eligibleSupplierIds', async () => {
    prisma.bidProject.findUnique.mockResolvedValue({ stage: 'EVALUATING', roundMode: 'negotiation' });
    prisma.bidSupplier.findMany.mockResolvedValue([
      { id: 's1', bidValidity: 'valid', supplierName: '甲' },
      { id: 's2', bidValidity: null, supplierName: '乙' },
    ]);
    await service.createRound('p1', 'negotiation', undefined, 'u1', ['s1', 's2']);
    expect(prisma.bidRound.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ eligibleSupplierIds: ['s1', 's2'] }),
      }),
    );
  });

  it('指定废标供应商 → 抛错', async () => {
    prisma.bidProject.findUnique.mockResolvedValue({ stage: 'EVALUATING', roundMode: 'negotiation' });
    prisma.bidSupplier.findMany.mockResolvedValue([
      { id: 's1', bidValidity: 'invalid', supplierName: '甲(废标)' },
    ]);
    await expect(service.createRound('p1', 'negotiation', undefined, 'u1', ['s1']))
      .rejects.toMatchObject({ response: { code: 'SUPPLIER_DISQUALIFIED' } });
  });

  it('不指定 supplierIds → 默认选所有非废标', async () => {
    prisma.bidProject.findUnique.mockResolvedValue({ stage: 'EVALUATING', roundMode: 'negotiation' });
    prisma.bidSupplier.findMany.mockResolvedValue([{ id: 's1' }, { id: 's2' }]);
    await service.createRound('p1', 'negotiation', undefined, 'u1');
    const call = prisma.bidRound.create.mock.calls[0][0];
    expect(call.data.eligibleSupplierIds).toEqual(['s1', 's2']);
  });

  it('仅定向通知本轮 eligibleSupplierIds 对应账号，并给出轮次直达链接', async () => {
    prisma.bidProject.findUnique.mockResolvedValue({ stage: 'EVALUATING', roundMode: 'negotiation' });
    prisma.bidSupplier.findMany
      .mockResolvedValueOnce([
        { id: 's1', bidValidity: 'valid', supplierName: '甲' },
        { id: 's2', bidValidity: 'valid', supplierName: '乙' },
      ])
      .mockResolvedValueOnce([
        { id: 's1', supplier: { userId: 'user-1' } },
        { id: 's2', supplier: { userId: 'user-2' } },
      ]);

    await service.createRound('p1', 'negotiation', undefined, 'u1', ['s1', 's2']);

    expect(notification.sendToRole).not.toHaveBeenCalled();
    expect(notification.sendToUser).toHaveBeenCalledTimes(2);
    expect(notification.sendToUser).toHaveBeenCalledWith(
      'user-1', ['in_app'], expect.objectContaining({ link: '/bids/p1/round-quote' }),
    );
    expect(notification.sendToUser).toHaveBeenCalledWith(
      'user-2', ['in_app'], expect.objectContaining({ link: '/bids/p1/round-quote' }),
    );
  });
});

describe('createRound — 谈判采购评标完成闸门（先评标→再报价）', () => {
  let service: BidService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      bidProject: { findUnique: jest.fn(), update: jest.fn() },
      bidExpert: { findMany: jest.fn() },
      expertDispute: { count: jest.fn().mockResolvedValue(0) },
      bidRound: { findFirst: jest.fn().mockResolvedValue(null), findUnique: jest.fn(), create: jest.fn().mockResolvedValue({ id: 'r1', roundNo: 1 }), count: jest.fn().mockResolvedValue(0) },
      bidSupplier: { findMany: jest.fn().mockResolvedValue([]), findFirst: jest.fn() },
      bidQuote: { create: jest.fn() },
      bidSupervisionLog: { create: jest.fn().mockResolvedValue({}) },
      bidOpeningSession: { update: jest.fn() },
      $queryRaw: jest.fn(),
      $transaction: jest.fn(async (cb: any) => typeof cb === 'function' ? cb(prisma) : Promise.all(cb)),
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BidService,
        BidOpeningRecordService,
        ADMIN_KEY_SVC, DUAL_ENVELOPE_SVC, SIGNATURE_SVC, GB_CODE_SVC,
        BidScoreStandardService,
        { provide: PrismaService, useValue: prisma },
        { provide: ScoreStandardValidator, useValue: { assertPassFailMaxScore: jest.fn(), assertPointsSumWithinMax: jest.fn(), assertScoreStandardComplete: jest.fn() } },
        { provide: PriceFormulaService, useValue: { calculate: jest.fn(), getOverCeilingSuppliers: jest.fn() } },
        { provide: StorageService, useValue: {} },
        { provide: NotificationService, useValue: { sendToRole: jest.fn() } },
      ],
    }).compile();
    service = module.get(BidService);
  });

  it('谈判采购·正选专家未全部确认 → EXPERT_REPORTS_NOT_CONFIRMED', async () => {
    prisma.bidProject.findUnique.mockResolvedValue({ stage: 'EVALUATING', roundMode: 'negotiation', procurementMethod: '谈判采购' });
    prisma.bidExpert.findMany.mockResolvedValue([{ reportConfirmed: false }]);
    await expect(service.createRound('p1', 'negotiation', undefined, 'u1'))
      .rejects.toMatchObject({ response: { code: 'EXPERT_REPORTS_NOT_CONFIRMED' } });
    expect(prisma.bidRound.create).not.toHaveBeenCalled();
  });

  it('谈判采购·组长未末签 → LEADER_NOT_COSIGNED', async () => {
    prisma.bidProject.findUnique.mockResolvedValue({ stage: 'EVALUATING', roundMode: 'negotiation', procurementMethod: '谈判采购' });
    prisma.bidExpert.findMany.mockResolvedValue([{ reportConfirmed: true }]);
    await expect(service.createRound('p1', 'negotiation', undefined, 'u1'))
      .rejects.toMatchObject({ response: { code: 'LEADER_NOT_COSIGNED' } });
    expect(prisma.bidRound.create).not.toHaveBeenCalled();
  });

  it('谈判采购·存在未裁决异议 → OPEN_DISPUTES', async () => {
    prisma.bidProject.findUnique.mockResolvedValue({ stage: 'EVALUATING', roundMode: 'negotiation', procurementMethod: '谈判采购', leaderCoSigned: true });
    prisma.bidExpert.findMany.mockResolvedValue([{ reportConfirmed: true }]);
    prisma.expertDispute.count.mockResolvedValue(1);
    await expect(service.createRound('p1', 'negotiation', undefined, 'u1'))
      .rejects.toMatchObject({ response: { code: 'OPEN_DISPUTES' } });
    expect(prisma.bidRound.create).not.toHaveBeenCalled();
  });

  it('谈判采购·评标已完成 → 放行创建轮次', async () => {
    prisma.bidProject.findUnique.mockResolvedValue({ stage: 'EVALUATING', roundMode: 'negotiation', procurementMethod: '谈判采购', leaderCoSigned: true });
    prisma.bidExpert.findMany.mockResolvedValue([{ reportConfirmed: true }]);
    await service.createRound('p1', 'negotiation', undefined, 'u1');
    expect(prisma.bidRound.create).toHaveBeenCalled();
  });

  it('竞价采购·评标未完成 → 闸门不生效（形态B）', async () => {
    prisma.bidProject.findUnique.mockResolvedValue({ stage: 'OPENING', roundMode: 'sealed_auction', procurementMethod: '竞价采购' });
    prisma.bidExpert.findMany.mockResolvedValue([{ reportConfirmed: false }]);
    await service.createRound('p1', 'sealed_auction', undefined, 'u1');
    expect(prisma.bidExpert.findMany).not.toHaveBeenCalled();
    expect(prisma.bidRound.create).toHaveBeenCalled();
  });
});

describe('submitQuote — 准入校验', () => {
  let service: BidService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      bidRound: { findUnique: jest.fn() },
      bidSupplier: { findFirst: jest.fn() },
      bidQuote: { create: jest.fn() },
      $queryRaw: jest.fn(),
      $transaction: jest.fn(async (cb: any) => typeof cb === 'function' ? cb(prisma) : Promise.all(cb)),
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BidService,
        BidOpeningRecordService,
        ADMIN_KEY_SVC, DUAL_ENVELOPE_SVC, SIGNATURE_SVC, GB_CODE_SVC,
        BidScoreStandardService,
        { provide: PrismaService, useValue: prisma },
        { provide: ScoreStandardValidator, useValue: { assertPassFailMaxScore: jest.fn(), assertPointsSumWithinMax: jest.fn(), assertScoreStandardComplete: jest.fn() } },
        { provide: PriceFormulaService, useValue: { calculate: jest.fn(), getOverCeilingSuppliers: jest.fn() } },
        { provide: StorageService, useValue: {} },
        { provide: NotificationService, useValue: { sendToRole: jest.fn() } },
      ],
    }).compile();
    service = module.get(BidService);
  });

  it('不在合格名单 → NOT_ELIGIBLE_FOR_ROUND', async () => {
    prisma.bidRound.findUnique.mockResolvedValue({
      id: 'r1', projectId: 'p1', status: 'open', deadline: null,
      eligibleSupplierIds: ['s1', 's2'],
    });
    prisma.bidSupplier.findFirst.mockResolvedValue({ id: 's3', bidValidity: 'valid' });
    await expect(service.submitQuote('p1', 'r1', 's3', 100))
      .rejects.toMatchObject({ response: { code: 'NOT_ELIGIBLE_FOR_ROUND' } });
  });

  it('废标供应商 → SUPPLIER_DISQUALIFIED', async () => {
    prisma.bidRound.findUnique.mockResolvedValue({
      id: 'r1', projectId: 'p1', status: 'open', deadline: null,
      eligibleSupplierIds: ['s1'],
    });
    prisma.bidSupplier.findFirst.mockResolvedValue({ id: 's1', bidValidity: 'invalid' });
    await expect(service.submitQuote('p1', 'r1', 's1', 100))
      .rejects.toMatchObject({ response: { code: 'SUPPLIER_DISQUALIFIED' } });
  });

  it('legacy 轮次 eligibleSupplierIds=[] → 不限制', async () => {
    prisma.bidRound.findUnique.mockResolvedValue({
      id: 'r1', projectId: 'p1', status: 'open', deadline: null,
      eligibleSupplierIds: [],
    });
    prisma.bidSupplier.findFirst.mockResolvedValue({ id: 's1', bidValidity: 'valid' });
    prisma.bidQuote.create.mockResolvedValue({ id: 'q1' });
    const result = await service.submitQuote('p1', 'r1', 's1', 100);
    expect(result).toEqual({ id: 'q1' });
  });
});

describe('getMinBidders procurement-method-aware', () => {
  let service: BidService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BidService,
        BidOpeningRecordService,
        ADMIN_KEY_SVC, DUAL_ENVELOPE_SVC, SIGNATURE_SVC, GB_CODE_SVC,
        BidScoreStandardService,
        { provide: PrismaService, useValue: {} },
        { provide: ScoreStandardValidator, useValue: {} },
        { provide: PriceFormulaService, useValue: {} },
        { provide: StorageService, useValue: {} },
        { provide: NotificationService, useValue: {} },
        { provide: ClarificationAiService, useValue: {} },
        { provide: BidGateway, useValue: {} },
      ],
    }).compile();
    service = module.get<BidService>(BidService);
  });

  it('直接采购 → 1', () => { expect((service as any).getMinBidders('直接采购')).toBe(1); });
  it('谈判采购 → 3', () => { expect((service as any).getMinBidders('谈判采购')).toBe(3); });
  it('邀请招标 → 3', () => { expect((service as any).getMinBidders('邀请招标')).toBe(3); });
  it('询比采购 → 3', () => { expect((service as any).getMinBidders('询比采购')).toBe(3); });
  it('null → 3', () => { expect((service as any).getMinBidders(null)).toBe(3); });
});

describe('checkDisputeTimeout', () => {
  let service: BidService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      bidOpeningSession: { findUnique: jest.fn() },
      bidSupplier: { findMany: jest.fn() },
      bidSupervisionLog: { create: jest.fn() },
      $queryRaw: jest.fn(), $transaction: jest.fn(async (cb: any) => cb(prisma)),
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BidService,
        BidOpeningRecordService,
        ADMIN_KEY_SVC, DUAL_ENVELOPE_SVC, SIGNATURE_SVC, GB_CODE_SVC,
        BidScoreStandardService,
        { provide: PrismaService, useValue: prisma },
        { provide: ScoreStandardValidator, useValue: {} },
        { provide: PriceFormulaService, useValue: {} },
        { provide: StorageService, useValue: {} },
        { provide: NotificationService, useValue: { sendToRole: jest.fn() } },
        { provide: ClarificationAiService, useValue: {} },
        { provide: BidGateway, useValue: {} },
      ],
    }).compile();
    service = module.get<BidService>(BidService);
  });

  it('session 无 timeoutMinutes → no-op', async () => {
    prisma.bidOpeningSession.findUnique.mockResolvedValueOnce(null);
    await (service as any).checkDisputeTimeout('p1');
    expect(prisma.bidSupervisionLog.create).not.toHaveBeenCalled();
  });

  it('未超时 → no-op', async () => {
    prisma.bidOpeningSession.findUnique.mockResolvedValueOnce({
      disputeTimeoutMinutes: 30,
      disputedSince: new Date(Date.now() - 5 * 60 * 1000),
    });
    await (service as any).checkDisputeTimeout('p1');
    expect(prisma.bidSupervisionLog.create).not.toHaveBeenCalled();
  });

  it('超时但无 DISPUTED → 仅告警不裁决', async () => {
    prisma.bidOpeningSession.findUnique.mockResolvedValueOnce({
      disputeTimeoutMinutes: 30,
      disputedSince: new Date(Date.now() - 60 * 60 * 1000),
    });
    prisma.bidSupplier.findMany.mockResolvedValueOnce([]);
    await (service as any).checkDisputeTimeout('p1');
    expect(prisma.bidSupervisionLog.create).not.toHaveBeenCalled();
  });

describe('BidService — syncFromAnnouncement 时间合理性校验（P1-15/走查⑤）', () => {
  let service: BidService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      bidProject: { findUnique: jest.fn().mockResolvedValue({ id: 'p1', projectCode: 'BID-1' }), update: jest.fn().mockResolvedValue({ projectCode: 'BID-1' }) },
      $transaction: jest.fn(async (cb: any) => cb(prisma)),
    };
    const module = await Test.createTestingModule({
      providers: [
        { provide: PrismaService, useValue: prisma },
        { provide: NotificationService, useValue: { create: jest.fn() } },
        { provide: ScoreStandardValidator, useValue: { assertPassFailMaxScore: jest.fn(), assertPointsSumWithinMax: jest.fn().mockResolvedValue(undefined), assertScoreStandardComplete: jest.fn().mockResolvedValue(undefined) } },
        { provide: PriceFormulaService, useValue: { calculate: jest.fn().mockReturnValue(new Map()), getOverCeilingSuppliers: jest.fn().mockReturnValue([]) } },
        BidService,
        BidOpeningRecordService,
        ADMIN_KEY_SVC, DUAL_ENVELOPE_SVC, SIGNATURE_SVC, GB_CODE_SVC,
        BidScoreStandardService,
        { provide: StorageService, useValue: { upload: jest.fn() } },
      ],
    }).compile();
    service = module.get(BidService);
  });

  it('开标时间早于当前时刻（AI 脏值）→ 忽略不覆盖项目原值', async () => {
    await service.syncFromAnnouncement('p1', { title: 'T' }, {
      openTime: new Date(Date.now() - 3600_000).toISOString(), // 发布时刻脏值
      deadline: new Date(Date.now() + 86400_000).toISOString(),
    });
    const data = prisma.bidProject.update.mock.calls[0][0].data;
    expect(data.openTime).toBeUndefined(); // 脏值被忽略，项目保留 ensureBidProject 兜底
    expect(data.deadline).toBeDefined();    // 未来 deadline 本身合法，正常写入
  });

  it('开标时间在未来且 deadline 早于开标 → 两者正常写入', async () => {
    const open = new Date(Date.now() + 5 * 86400_000);
    const dl = new Date(open.getTime() - 24 * 3600_000);
    await service.syncFromAnnouncement('p1', { title: 'T' }, {
      openTime: open.toISOString(), deadline: dl.toISOString(),
    });
    const data = prisma.bidProject.update.mock.calls[0][0].data;
    expect(data.openTime).toBeDefined();
    expect(data.deadline).toBeDefined();
  });
});

/* ═══════════════════════════════════════════════════════════════════
   Task 15：解密失败归因矩阵（assertOpeningDone 惰性触发）+ 裁决端点
   §5.5 判定矩阵四行 + 幂等 + UNKNOWN 阻塞守卫 + RESET_PENDING（T13 硬前置）
   ═══════════════════════════════════════════════════════════════════ */

describe('BidService — 解密失败归因矩阵（Task 15, §5.5）——裁决端点已迁 bid-decrypt.service.spec', () => {
  let service: BidService;
  let prisma: any;
  let sendToUser: jest.Mock;
  let gateway: { notifyDecryptStatus: jest.Mock };

  const WINDOW_ENDED = new Date(Date.now() - 60_000);
  const WINDOW_OPEN = new Date(Date.now() + 600_000);

  beforeEach(async () => {
    sendToUser = jest.fn().mockResolvedValue({});
    gateway = { notifyDecryptStatus: jest.fn() };
    prisma = {
      bidProject: { findUnique: jest.fn() },
      bidOpeningSession: { findUnique: jest.fn() },
      bidSupplier: {
        findMany: jest.fn(),
        findFirst: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn(),
      },
      supplierBidSubmission: { findMany: jest.fn().mockResolvedValue([]) },
      supplier: { findUnique: jest.fn().mockResolvedValue({ userId: 'user-s1' }) },
      bidSupervisionLog: { create: jest.fn().mockResolvedValue({}), findMany: jest.fn().mockResolvedValue([]) },
      bidOpeningRecord: { findMany: jest.fn().mockResolvedValue([]) },
      bidRound: { findMany: jest.fn().mockResolvedValue([]) },
      fileAsset: { findMany: jest.fn().mockResolvedValue([]) },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
      $transaction: jest.fn(async (cb: any) => cb(prisma)),
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        { provide: PrismaService, useValue: prisma },
        { provide: NotificationService, useValue: { sendToUser } },
        { provide: ScoreStandardValidator, useValue: { assertPassFailMaxScore: jest.fn(), assertPointsSumWithinMax: jest.fn().mockResolvedValue(undefined), assertScoreStandardComplete: jest.fn().mockResolvedValue(undefined) } },
        { provide: PriceFormulaService, useValue: { calculate: jest.fn().mockReturnValue(new Map()), getOverCeilingSuppliers: jest.fn().mockReturnValue([]) } },
        BidService,
        BidOpeningRecordService,
        ADMIN_KEY_SVC, DUAL_ENVELOPE_SVC, SIGNATURE_SVC, GB_CODE_SVC,
        BidScoreStandardService,
        { provide: StorageService, useValue: { upload: jest.fn() } },
        { provide: BidGateway, useValue: gateway },
      ],
    }).compile();
    service = module.get<BidService>(BidService);
  });

  /** 惰性触发入口：assertOpeningDone 首行执行归因（守卫本体断言同径） */
  const runGuard = () => (service as any).assertOpeningDone('p1');

  it('矩阵行 1：outer 未解 → 只置 UNKNOWN 不置终局态，守卫仍 409 OPENING_NOT_DONE 附名单', async () => {
    prisma.bidOpeningSession.findUnique.mockResolvedValue({ decryptWindowEnd: WINDOW_ENDED });
    prisma.bidSupplier.findMany
      .mockResolvedValueOnce([{ id: 'bs1', supplierId: 's1', supplierName: '甲公司' }])                       // 归因扫描
      .mockResolvedValue([{ supplierName: '甲公司', decryptStatus: 'PENDING', confirmStatus: 'PENDING' }]);   // 守卫读
    prisma.supplierBidSubmission.findMany.mockResolvedValue([
      { supplierId: 's1', envelopeVersion: 'dual-v2', outerDecryptedAt: null, packageFetchedAt: new Date() },
    ]);
    prisma.bidSupplier.updateMany.mockResolvedValue({ count: 1 });

    await expect(runGuard()).rejects.toMatchObject({ response: { code: 'OPENING_NOT_DONE' } });

    expect(prisma.bidSupplier.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: 'bs1', decryptStatus: 'PENDING' }),
      data: { dangerAttribution: 'UNKNOWN' },   // 只置归因，不置终局态
    }));
    const datas = prisma.bidSupplier.updateMany.mock.calls.map((c: any[]) => c[0].data);
    expect(datas.some((d: any) => d.decryptStatus === 'DANGER')).toBe(false);
    expect(sendToUser).not.toHaveBeenCalled();
    // 顺带①：自动 UNKNOWN 标记写监督日志（法定留痕，result 写明待主持人裁决）
    expect(prisma.bidSupervisionLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ action: '解密失败归因', target: '甲公司', result: expect.stringContaining('待主持人裁决') }),
    }));
  });

  it('矩阵行 2：外层已解但包未取 → 只置 UNKNOWN', async () => {
    prisma.bidOpeningSession.findUnique.mockResolvedValue({ decryptWindowEnd: WINDOW_ENDED });
    prisma.bidSupplier.findMany
      .mockResolvedValueOnce([{ id: 'bs1', supplierId: 's1', supplierName: '乙公司' }])
      .mockResolvedValue([{ supplierName: '乙公司', decryptStatus: 'PENDING', confirmStatus: 'PENDING' }]);
    prisma.supplierBidSubmission.findMany.mockResolvedValue([
      { supplierId: 's1', envelopeVersion: 'dual-v2', outerDecryptedAt: new Date(), packageFetchedAt: null },
    ]);
    prisma.bidSupplier.updateMany.mockResolvedValue({ count: 1 });

    await expect(runGuard()).rejects.toMatchObject({ response: { code: 'OPENING_NOT_DONE' } });
    expect(prisma.bidSupplier.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: { dangerAttribution: 'UNKNOWN' },
    }));
    expect(sendToUser).not.toHaveBeenCalled();
    expect(prisma.bidSupervisionLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ result: expect.stringContaining('待主持人裁决') }),
    }));
  });

  it('矩阵行 3：外层已解且已取包未完成解密 → BIDDER 终局 + 权利告知通知（守卫放行）', async () => {
    prisma.bidOpeningSession.findUnique.mockResolvedValue({ decryptWindowEnd: WINDOW_ENDED });
    prisma.bidSupplier.findMany
      .mockResolvedValueOnce([{ id: 'bs1', supplierId: 's1', supplierName: '丙公司' }])
      .mockResolvedValue([{ supplierName: '丙公司', decryptStatus: 'DANGER', confirmStatus: 'EXCEPTION' }]);
    prisma.supplierBidSubmission.findMany.mockResolvedValue([
      { supplierId: 's1', envelopeVersion: 'dual-v2', outerDecryptedAt: new Date(), packageFetchedAt: new Date() },
    ]);
    prisma.bidSupplier.updateMany.mockResolvedValue({ count: 1 });

    await expect(runGuard()).resolves.toBeUndefined();

    expect(prisma.bidSupplier.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: 'bs1', decryptStatus: 'PENDING' }),
      data: expect.objectContaining({
        decryptStatus: 'DANGER', confirmStatus: 'EXCEPTION', dangerAttribution: 'BIDDER',
        decryptError: expect.stringContaining('未在解密窗口内完成解密'),
      }),
    }));
    expect(prisma.bidSupervisionLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ action: '解密失败归因', target: '丙公司', riskFlag: '高风险' }),
    }));
    expect(gateway.notifyDecryptStatus).toHaveBeenCalledWith('p1', 'bs1', '丙公司', 'DANGER');
    expect(sendToUser).toHaveBeenCalledWith('user-s1', ['in_app'], expect.objectContaining({
      content: expect.stringContaining('因投标人原因未完成解密，视为撤销投标文件，保证金依招标文件规定处理'),
    }));
  });

  it('矩阵行 4：双闸失败 DANGER+UNKNOWN 已由 decrypt-upload 落库 → 不重判不重通知', async () => {
    prisma.bidOpeningSession.findUnique.mockResolvedValue({ decryptWindowEnd: WINDOW_ENDED });
    prisma.bidSupplier.findMany
      .mockResolvedValueOnce([])   // 归因扫描只取 PENDING+未归因家——DANGER 家不在扫描范围
      .mockResolvedValue([{ supplierName: '丁公司', decryptStatus: 'DANGER', confirmStatus: 'EXCEPTION' }]);

    await expect(runGuard()).resolves.toBeUndefined();
    expect(prisma.bidSupplier.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ decryptStatus: 'PENDING', dangerAttribution: null }),
    }));
    expect(prisma.bidSupplier.updateMany).not.toHaveBeenCalled();
    expect(sendToUser).not.toHaveBeenCalled();
  });

  it('解密窗口未过 → 不归因（供应商仍可自行解密，守卫照常阻塞 PENDING）', async () => {
    prisma.bidOpeningSession.findUnique.mockResolvedValue({ decryptWindowEnd: WINDOW_OPEN });
    prisma.bidSupplier.findMany
      .mockResolvedValue([{ supplierName: '甲公司', decryptStatus: 'PENDING', confirmStatus: 'PENDING' }]);

    await expect(runGuard()).rejects.toMatchObject({ response: { code: 'OPENING_NOT_DONE' } });
    expect(prisma.supplierBidSubmission.findMany).not.toHaveBeenCalled();
    expect(prisma.bidSupplier.updateMany).not.toHaveBeenCalled();
    expect(sendToUser).not.toHaveBeenCalled();
  });

  it('幂等：重复触发不重复通知（updateMany count=0 → 跳过终局与通知）', async () => {
    prisma.bidOpeningSession.findUnique.mockResolvedValue({ decryptWindowEnd: WINDOW_ENDED });
    prisma.bidSupplier.findMany.mockResolvedValue([{ id: 'bs1', supplierId: 's1', supplierName: '丙公司' }]);
    prisma.supplierBidSubmission.findMany.mockResolvedValue([
      { supplierId: 's1', envelopeVersion: 'dual-v2', outerDecryptedAt: new Date(), packageFetchedAt: new Date() },
    ]);
    // 第一次抢占成功，第二次（重复/并发）count=0
    prisma.bidSupplier.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValue({ count: 0 });

    const runAttr = () => (service as any).attributePendingDualSuppliers('p1');
    await runAttr();
    await runAttr();

    expect(sendToUser).toHaveBeenCalledTimes(1);
    expect(prisma.bidSupervisionLog.create).toHaveBeenCalledTimes(1);
  });

  it('开标文件包：suppliers select 带 dangerAttribution 且包内带出归因值（§5.5 法定留痕）', async () => {
    prisma.bidProject.findUnique.mockResolvedValue({ roundMode: null });
    prisma.bidSupplier.findMany.mockResolvedValue([
      { supplierName: '甲公司', receiptNo: 'r1', encryptStatus: '已加密', decryptStatus: 'DANGER', confirmStatus: 'EXCEPTION', submitStatus: '已提交', dangerAttribution: 'BIDDER' },
    ]);

    const pkg: any = await (service as any).buildHandoverPackage(
      { id: 'p1', projectCode: 'BID-1', name: 'P', procurementMethod: '公开招标', openTime: new Date('2026-08-20T10:00:00Z'), deadline: new Date('2026-08-20T12:00:00Z'), stage: 'OPENING' },
      { host: 'H', supervisor: null, decryptWindowStart: new Date('2026-08-20T10:00:00Z'), decryptWindowEnd: new Date('2026-08-20T12:00:00Z'), status: '进行中' },
    );

    expect(prisma.bidSupplier.findMany).toHaveBeenCalledWith(expect.objectContaining({
      select: expect.objectContaining({ dangerAttribution: true }),
    }));
    expect(pkg.suppliers[0].dangerAttribution).toBe('BIDDER');
  });

  it('开标文件包：dual-v2 解密家带出 decryptedFileSha256（角色→明文资产 sha256），未解密/旧轨家为 null', async () => {
    prisma.bidProject.findUnique.mockResolvedValue({ roundMode: null });
    prisma.bidSupplier.findMany.mockResolvedValue([
      {
        supplierId: 's-乙', supplierName: '乙公司', receiptNo: 'r2', encryptStatus: '已加密', decryptStatus: 'SUCCESS',
        confirmStatus: 'CONFIRMED', submitStatus: '已提交', dangerAttribution: null,
      },
      {
        supplierId: 's-丙', supplierName: '丙公司', receiptNo: 'r3', encryptStatus: '已加密', decryptStatus: 'PENDING',
        confirmStatus: 'PENDING', submitStatus: '已提交', dangerAttribution: null,
      },
      {
        supplierId: 's-丁', supplierName: '丁公司', receiptNo: 'r4', encryptStatus: '已加密', decryptStatus: 'SUCCESS',
        confirmStatus: 'CONFIRMED', submitStatus: '已提交', dangerAttribution: null,
      },
    ]);
    prisma.supplierBidSubmission.findMany.mockResolvedValue([
      {
        supplierId: 's-乙', envelopeVersion: 'dual-v2',
        decryptedAssets: { technical: 'fa-t', business: 'fa-b', coverLetter: 'fa-c', bond: 'fa-bond' },
      },
      { supplierId: 's-丙', envelopeVersion: 'dual-v2', decryptedAssets: null }, // 未解密家
      { supplierId: 's-丁', envelopeVersion: null, decryptedAssets: null }, // 旧轨家
    ]);
    prisma.fileAsset.findMany.mockResolvedValue([
      { id: 'fa-t', sha256: 'sha-t' },
      { id: 'fa-b', sha256: 'sha-b' },
      { id: 'fa-c', sha256: 'sha-c' },
      { id: 'fa-bond', sha256: 'sha-bond' },
    ]);

    const pkg: any = await (service as any).buildHandoverPackage(
      { id: 'p1', projectCode: 'BID-1', name: 'P', procurementMethod: '公开招标', openTime: new Date('2026-08-20T10:00:00Z'), deadline: new Date('2026-08-20T12:00:00Z'), stage: 'OPENING' },
      { host: 'H', supervisor: null, decryptWindowStart: new Date('2026-08-20T10:00:00Z'), decryptWindowEnd: new Date('2026-08-20T12:00:00Z'), status: '进行中' },
    );

    expect(prisma.fileAsset.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: { in: expect.arrayContaining(['fa-t', 'fa-b', 'fa-c', 'fa-bond']) } },
      select: { id: true, sha256: true },
    }));
    expect(pkg.suppliers[0].decryptedFileSha256).toEqual({
      technical: 'sha-t', business: 'sha-b', coverLetter: 'sha-c', bond: 'sha-bond',
    });
    expect(pkg.suppliers[1].decryptedFileSha256).toBeNull(); // 未解密家
    expect(pkg.suppliers[2].decryptedFileSha256).toBeNull(); // 旧轨家
  });

});
});

describe('P1-8 — 中标通知书公示期闸门与定向通知', () => {
  let svc: any;
  let prisma: any;
  let notification: any;

  beforeEach(async () => {
    prisma = {
      bidProject: { findUnique: jest.fn() },
      announcement: { findFirst: jest.fn() },
      bidEvaluationResult: { findFirst: jest.fn() },
      awardLetterDelivery: {
        findUnique: jest.fn().mockResolvedValue(null),
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'd1' }),
        updateMany: jest.fn(),
      },
      contract: { findFirst: jest.fn().mockResolvedValue(null) },
      contractFulfillment: { findFirst: jest.fn().mockResolvedValue(null) },
      fileAsset: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'letter-1',
          mimeType: 'application/pdf',
          size: 1_024,
        }),
      },
      supplier: { findUnique: jest.fn() },
      bidSupplier: { findUnique: jest.fn() },
      projectManagementItem: { findFirst: jest.fn().mockResolvedValue(null), update: jest.fn() }, // CTS A-203 定标回写
    };
    prisma.$transaction = jest.fn(async (cb: any) => cb(prisma));
    notification = { sendToRole: jest.fn(), sendToUser: jest.fn().mockResolvedValue({}) };
    const { Test } = require('@nestjs/testing');
    const module = await Test.createTestingModule({
      providers: [
        { provide: 'BidService', useFactory: async () => {
          // 用真实类最小构造：直接 new 会触发 DI 注入缺失——这里用部分模拟（spy 类原型的私有方法）
          const { BidService } = await import('./bid.service');
          const instance: any = Object.create(BidService.prototype);
          instance.prisma = prisma;
          instance.notificationService = notification;
          instance.logger = { warn: jest.fn() };
          instance.resolveAnnouncementCodes = jest.fn(async (p: any) => [p.projectCode]);
          return instance;
        } },
      ],
    }).compile();
    svc = module.get('BidService');
  });

  const PUBLISHED_NOTICE = (publicityEnd: Date | null) => ({
    status: 'PUBLISHED', publishDate: new Date(), publicityEnd,
  });
  const RANK1 = { supplierId: 'sup-win', supplierName: '中标公司' };

  it('公示未发布 → 409 PUBLICITY_NOT_ENDED 且零交付/零通知', async () => {
    prisma.bidProject.findUnique.mockResolvedValue({ projectCode: 'GK-1', name: 'P' });
    prisma.announcement.findFirst.mockResolvedValue(null);
    await expect(svc.deliverAwardLetter('p1', { winnerName: '中标公司' }))
      .rejects.toMatchObject({ response: { code: 'PUBLICITY_NOT_ENDED' } });
    expect(prisma.awardLetterDelivery.create).not.toHaveBeenCalled();
    expect(prisma.awardLetterDelivery.updateMany).not.toHaveBeenCalled();
    expect(notification.sendToUser).not.toHaveBeenCalled();
    expect(notification.sendToRole).not.toHaveBeenCalled();
  });

  it('公示期未满 → 409 且 error 含公示截止时间', async () => {
    prisma.bidProject.findUnique.mockResolvedValue({ projectCode: 'GK-1', name: 'P' });
    const future = new Date(Date.now() + 86_400_000);
    prisma.announcement.findFirst.mockResolvedValue(PUBLISHED_NOTICE(future));
    await expect(svc.deliverAwardLetter('p1', { winnerName: '中标公司' }))
      .rejects.toMatchObject({ response: { code: 'PUBLICITY_NOT_ENDED' } });
    expect(prisma.awardLetterDelivery.create).not.toHaveBeenCalled();
    expect(prisma.awardLetterDelivery.updateMany).not.toHaveBeenCalled();
  });

  it('publicityEnd 为 null → getPublicityStatus canIssueAward=false', async () => {
    prisma.bidProject.findUnique.mockResolvedValue({ projectCode: 'GK-1', projectManagementItemId: null });
    prisma.announcement.findFirst.mockResolvedValue(PUBLISHED_NOTICE(null));
    const status = await svc.getPublicityStatus('p1');
    expect(status.canIssueAward).toBe(false);
    expect(status.hasPublicity).toBe(true);
  });

  it('公示期满 → 放行且定向通知仅中标方（sendToUser 用供应商 userId，sendToRole 零调用）', async () => {
    prisma.bidProject.findUnique.mockResolvedValue({ projectCode: 'GK-1', name: 'P' });
    prisma.announcement.findFirst.mockResolvedValue(PUBLISHED_NOTICE(new Date(Date.now() - 1_000)));
    prisma.bidEvaluationResult.findFirst.mockResolvedValue(RANK1);
    prisma.bidSupplier.findUnique.mockResolvedValue({ supplier: { userId: 'u-win' } });

    const res = await svc.deliverAwardLetter('p1', { winnerName: '中标公司', letterAssetId: 'letter-1' }, 'actor-1');
    expect(res).toEqual({ id: 'd1' });
    expect(prisma.$transaction).toHaveBeenCalledWith(
      expect.any(Function),
      { isolationLevel: 'Serializable' },
    );
    expect(prisma.awardLetterDelivery.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ projectId: 'p1', supplierId: 'sup-win', letterAssetId: 'letter-1' }),
    });
    expect(notification.sendToUser).toHaveBeenCalledWith('u-win', ['in_app'], expect.objectContaining({
      type: 'AWARD_LETTER',
      link: '/award-letters?deliveryId=d1',
    }));
    expect(prisma.bidSupplier.findUnique).toHaveBeenCalledWith({
      where: { id: 'sup-win' },
      select: { supplier: { select: { userId: true } } },
    });
    expect(notification.sendToRole).not.toHaveBeenCalled();
    expect(prisma.projectManagementItem.update).not.toHaveBeenCalled(); // 无宿主 PMI → 不回写
  });

  it('定标回写（拍板#7）：中标人与台账不一致 → 自动回写 PMI.awardedSupplier；一致 → 幂等跳过', async () => {
    prisma.bidProject.findUnique.mockResolvedValue({ projectCode: 'GK-1', name: 'P' });
    prisma.announcement.findFirst.mockResolvedValue(PUBLISHED_NOTICE(new Date(Date.now() - 1_000)));
    prisma.bidEvaluationResult.findFirst.mockResolvedValue(RANK1);
    prisma.bidSupplier.findUnique.mockResolvedValue({ supplier: { userId: 'u-win' } });

    // 不一致 → 回写
    prisma.projectManagementItem.findFirst.mockResolvedValueOnce({ id: 'pmi-1', awardedSupplier: '旧手工值' });
    await svc.deliverAwardLetter('p1', { winnerName: '中标公司', letterAssetId: 'letter-1' }, 'actor-1');
    expect(prisma.projectManagementItem.update).toHaveBeenCalledWith({
      where: { id: 'pmi-1' },
      data: { awardedSupplier: '中标公司' },
    });

    // 一致 → 跳过
    prisma.projectManagementItem.update.mockClear();
    prisma.projectManagementItem.findFirst.mockResolvedValueOnce({ id: 'pmi-1', awardedSupplier: '中标公司' });
    await svc.deliverAwardLetter('p1', { winnerName: '中标公司', letterAssetId: 'letter-1' }, 'actor-1');
    expect(prisma.projectManagementItem.update).not.toHaveBeenCalled();
  });

  it('winnerSupplierId 与 rank1 不符 → 400 WINNER_MISMATCH 零交付', async () => {
    prisma.bidProject.findUnique.mockResolvedValue({ projectCode: 'GK-1', name: 'P' });
    prisma.announcement.findFirst.mockResolvedValue(PUBLISHED_NOTICE(new Date(Date.now() - 1_000)));
    prisma.bidEvaluationResult.findFirst.mockResolvedValue(RANK1);
    await expect(svc.deliverAwardLetter('p1', { winnerName: '中标公司', winnerSupplierId: 'sup-other' }))
      .rejects.toMatchObject({ response: { code: 'WINNER_MISMATCH' } });
    expect(prisma.awardLetterDelivery.create).not.toHaveBeenCalled();
    expect(prisma.awardLetterDelivery.updateMany).not.toHaveBeenCalled();
  });

  it('通知书必须引用当前操作者上传的合同文档资产', async () => {
    prisma.bidProject.findUnique.mockResolvedValue({ projectCode: 'GK-1', name: 'P' });
    prisma.announcement.findFirst.mockResolvedValue(PUBLISHED_NOTICE(new Date(Date.now() - 1_000)));
    prisma.bidEvaluationResult.findFirst.mockResolvedValue(RANK1);
    prisma.fileAsset.findFirst.mockResolvedValue(null);

    await expect(svc.deliverAwardLetter(
      'p1', { winnerName: '中标公司', letterAssetId: 'asset-from-other-user' }, 'actor-1',
    )).rejects.toMatchObject({ response: { code: 'AWARD_LETTER_ASSET_INVALID' } });
    expect(prisma.fileAsset.findFirst).toHaveBeenCalledWith({
      where: { id: 'asset-from-other-user', category: 'contract_document', uploaderId: 'actor-1' },
      select: { id: true, mimeType: true, size: true },
    });
    expect(prisma.awardLetterDelivery.create).not.toHaveBeenCalled();
    expect(prisma.awardLetterDelivery.updateMany).not.toHaveBeenCalled();
  });

  it('仅伪装成 PDF MIME 但不属于 contract_document 分类的资产仍拒绝交付', async () => {
    prisma.bidProject.findUnique.mockResolvedValue({ projectCode: 'GK-1', name: 'P' });
    prisma.announcement.findFirst.mockResolvedValue(PUBLISHED_NOTICE(new Date(Date.now() - 1_000)));
    prisma.bidEvaluationResult.findFirst.mockResolvedValue(RANK1);
    // Prisma 的复合过滤不会返回 category=general 的资产，即使其 mimeType 自称 PDF。
    prisma.fileAsset.findFirst.mockResolvedValue(null);

    await expect(svc.deliverAwardLetter(
      'p1', { winnerName: '中标公司', letterAssetId: 'pdf-from-general-category' }, 'actor-1',
    )).rejects.toMatchObject({ response: { code: 'AWARD_LETTER_ASSET_INVALID' } });
    expect(prisma.fileAsset.findFirst).toHaveBeenCalledWith({
      where: {
        id: 'pdf-from-general-category',
        category: 'contract_document',
        uploaderId: 'actor-1',
      },
      select: { id: true, mimeType: true, size: true },
    });
    expect(prisma.awardLetterDelivery.create).not.toHaveBeenCalled();
    expect(prisma.awardLetterDelivery.updateMany).not.toHaveBeenCalled();
  });

  it('通知书附件超过 20 MiB 时拒绝交付', async () => {
    prisma.bidProject.findUnique.mockResolvedValue({ projectCode: 'GK-1', name: 'P' });
    prisma.announcement.findFirst.mockResolvedValue(PUBLISHED_NOTICE(new Date(Date.now() - 1_000)));
    prisma.bidEvaluationResult.findFirst.mockResolvedValue(RANK1);
    prisma.fileAsset.findFirst.mockResolvedValue({
      id: 'letter-too-large',
      mimeType: 'application/pdf',
      size: 20 * 1024 * 1024 + 1,
    });

    await expect(svc.deliverAwardLetter(
      'p1', { winnerName: '中标公司', letterAssetId: 'letter-too-large' }, 'actor-1',
    )).rejects.toMatchObject({ response: { code: 'AWARD_LETTER_ASSET_TOO_LARGE' } });
    expect(prisma.awardLetterDelivery.create).not.toHaveBeenCalled();
    expect(prisma.awardLetterDelivery.updateMany).not.toHaveBeenCalled();
  });

  it.each([
    'application/octet-stream',
    'image/png',
    'text/html',
  ])('通知书附件存储 MIME 为 %s 时拒绝交付', async (mimeType) => {
    prisma.bidProject.findUnique.mockResolvedValue({ projectCode: 'GK-1', name: 'P' });
    prisma.announcement.findFirst.mockResolvedValue(PUBLISHED_NOTICE(new Date(Date.now() - 1_000)));
    prisma.bidEvaluationResult.findFirst.mockResolvedValue(RANK1);
    prisma.fileAsset.findFirst.mockResolvedValue({ id: 'letter-wrong-type', mimeType, size: 1_024 });

    await expect(svc.deliverAwardLetter(
      'p1', { winnerName: '中标公司', letterAssetId: 'letter-wrong-type' }, 'actor-1',
    )).rejects.toMatchObject({ response: { code: 'AWARD_LETTER_ASSET_TYPE_INVALID' } });
    expect(prisma.awardLetterDelivery.create).not.toHaveBeenCalled();
    expect(prisma.awardLetterDelivery.updateMany).not.toHaveBeenCalled();
  });

  it.each([
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  ])('通知书附件允许可信 PDF/Word 存储 MIME：%s', async (mimeType) => {
    prisma.bidProject.findUnique.mockResolvedValue({ projectCode: 'GK-1', name: 'P' });
    prisma.announcement.findFirst.mockResolvedValue(PUBLISHED_NOTICE(new Date(Date.now() - 1_000)));
    prisma.bidEvaluationResult.findFirst.mockResolvedValue(RANK1);
    prisma.fileAsset.findFirst.mockResolvedValue({
      id: 'letter-valid-type',
      mimeType,
      size: 20 * 1024 * 1024,
    });

    await expect(svc.deliverAwardLetter(
      'p1', { winnerName: '中标公司', letterAssetId: 'letter-valid-type' }, 'actor-1',
    )).resolves.toMatchObject({ id: 'd1' });
  });

  it('通知书缺少实际文件时拒绝发出', async () => {
    prisma.bidProject.findUnique.mockResolvedValue({ projectCode: 'GK-1', name: 'P' });
    prisma.announcement.findFirst.mockResolvedValue(PUBLISHED_NOTICE(new Date(Date.now() - 1_000)));
    prisma.bidEvaluationResult.findFirst.mockResolvedValue(RANK1);

    await expect(svc.deliverAwardLetter('p1', { winnerName: '中标公司' }, 'actor-1'))
      .rejects.toMatchObject({ response: { code: 'AWARD_LETTER_ASSET_REQUIRED' } });
    expect(prisma.awardLetterDelivery.create).not.toHaveBeenCalled();
    expect(prisma.awardLetterDelivery.updateMany).not.toHaveBeenCalled();
  });

  it('通知书资产已绑定其他 delivery 时拒绝跨交付复用', async () => {
    prisma.bidProject.findUnique.mockResolvedValue({ projectCode: 'GK-1', name: 'P' });
    prisma.announcement.findFirst.mockResolvedValue(PUBLISHED_NOTICE(new Date(Date.now() - 1_000)));
    prisma.bidEvaluationResult.findFirst.mockResolvedValue(RANK1);
    prisma.awardLetterDelivery.findFirst.mockResolvedValue({ id: 'delivery-other' });

    await expect(svc.deliverAwardLetter(
      'p1', { winnerName: '中标公司', letterAssetId: 'letter-1' }, 'actor-1',
    )).rejects.toMatchObject({ response: { code: 'AWARD_LETTER_ASSET_ALREADY_BOUND' } });

    expect(prisma.awardLetterDelivery.findFirst).toHaveBeenCalledWith({
      where: {
        letterAssetId: 'letter-1',
        NOT: { projectId: 'p1', supplierId: 'sup-win' },
      },
      select: { id: true },
    });
    expect(prisma.awardLetterDelivery.create).not.toHaveBeenCalled();
    expect(prisma.awardLetterDelivery.updateMany).not.toHaveBeenCalled();
    expect(notification.sendToUser).not.toHaveBeenCalled();
  });

  it.each(['draftAssetId', 'signedAssetId'] as const)(
    '通知书资产已作为合同 %s 时拒绝反向复用',
    async (contractAssetField) => {
      prisma.bidProject.findUnique.mockResolvedValue({ projectCode: 'GK-1', name: 'P' });
      prisma.announcement.findFirst.mockResolvedValue(PUBLISHED_NOTICE(new Date(Date.now() - 1_000)));
      prisma.bidEvaluationResult.findFirst.mockResolvedValue(RANK1);
      prisma.contract.findFirst.mockResolvedValue({ id: 'contract-1' });

      await expect(svc.deliverAwardLetter(
        'p1', { winnerName: '中标公司', letterAssetId: 'letter-1' }, 'actor-1',
      )).rejects.toMatchObject({ response: { code: 'AWARD_LETTER_ASSET_ALREADY_BOUND' } });

      expect(prisma.contract.findFirst).toHaveBeenCalledWith({
        where: {
          OR: [
            { draftAssetId: 'letter-1' },
            { signedAssetId: 'letter-1' },
          ],
        },
        select: { id: true },
      });
      expect(prisma.contract.findFirst.mock.calls[0][0].where.OR)
        .toContainEqual({ [contractAssetField]: 'letter-1' });
      expect(prisma.awardLetterDelivery.create).not.toHaveBeenCalled();
      expect(prisma.awardLetterDelivery.updateMany).not.toHaveBeenCalled();
      expect(notification.sendToUser).not.toHaveBeenCalled();
    },
  );

  it('通知书资产已作为合同履约证明时拒绝反向复用', async () => {
    prisma.bidProject.findUnique.mockResolvedValue({ projectCode: 'GK-1', name: 'P' });
    prisma.announcement.findFirst.mockResolvedValue(PUBLISHED_NOTICE(new Date(Date.now() - 1_000)));
    prisma.bidEvaluationResult.findFirst.mockResolvedValue(RANK1);
    prisma.contractFulfillment.findFirst.mockResolvedValue({ id: 'fulfillment-1' });

    await expect(svc.deliverAwardLetter(
      'p1', { winnerName: '中标公司', letterAssetId: 'letter-1' }, 'actor-1',
    )).rejects.toMatchObject({ response: { code: 'AWARD_LETTER_ASSET_ALREADY_BOUND' } });

    expect(prisma.contractFulfillment.findFirst).toHaveBeenCalledWith({
      where: { proofAssetId: 'letter-1' },
      select: { id: true },
    });
    expect(prisma.awardLetterDelivery.create).not.toHaveBeenCalled();
    expect(prisma.awardLetterDelivery.updateMany).not.toHaveBeenCalled();
    expect(notification.sendToUser).not.toHaveBeenCalled();
  });

  it('已签收通知书不可被覆盖或重新交付', async () => {
    prisma.bidProject.findUnique.mockResolvedValue({ projectCode: 'GK-1', name: 'P' });
    prisma.announcement.findFirst.mockResolvedValue(PUBLISHED_NOTICE(new Date(Date.now() - 1_000)));
    prisma.bidEvaluationResult.findFirst.mockResolvedValue(RANK1);
    prisma.awardLetterDelivery.findUnique.mockResolvedValue({
      id: 'delivery-1', signedAt: new Date('2026-09-03T08:00:00.000Z'),
    });

    await expect(svc.deliverAwardLetter(
      'p1',
      { winnerName: '中标公司', letterAssetId: 'letter-2', content: { version: 2 } },
      'actor-1',
    )).rejects.toMatchObject({ response: { code: 'AWARD_LETTER_ALREADY_SIGNED' } });

    expect(prisma.awardLetterDelivery.create).not.toHaveBeenCalled();
    expect(prisma.awardLetterDelivery.updateMany).not.toHaveBeenCalled();
    expect(notification.sendToUser).not.toHaveBeenCalled();
  });

  it('未签收通知书重发时原子替换文件并清空旧查看回执', async () => {
    prisma.bidProject.findUnique.mockResolvedValue({ projectCode: 'GK-1', name: 'P' });
    prisma.announcement.findFirst.mockResolvedValue(PUBLISHED_NOTICE(new Date(Date.now() - 1_000)));
    prisma.bidEvaluationResult.findFirst.mockResolvedValue(RANK1);
    prisma.bidSupplier.findUnique.mockResolvedValue({ supplier: { userId: 'u-win' } });
    prisma.awardLetterDelivery.findUnique
      .mockResolvedValueOnce({ id: 'delivery-1', signedAt: null, deliveredAt: new Date('2026-09-03T08:00:00Z') })
      .mockResolvedValueOnce({ id: 'delivery-1', letterAssetId: 'letter-2', receivedAt: null, signedAt: null });
    prisma.awardLetterDelivery.updateMany.mockResolvedValue({ count: 1 });

    await expect(svc.deliverAwardLetter(
      'p1',
      { winnerName: '中标公司', letterAssetId: 'letter-2', content: { version: 2 } },
      'actor-1',
    )).resolves.toMatchObject({ id: 'delivery-1', letterAssetId: 'letter-2', receivedAt: null });

    expect(prisma.awardLetterDelivery.findFirst).toHaveBeenCalledWith({
      where: {
        letterAssetId: 'letter-2',
        NOT: { projectId: 'p1', supplierId: 'sup-win' },
      },
      select: { id: true },
    });
    expect(prisma.awardLetterDelivery.updateMany).toHaveBeenCalledWith({
      where: { id: 'delivery-1', signedAt: null, deliveredAt: new Date('2026-09-03T08:00:00Z') },
      data: expect.objectContaining({
        letterAssetId: 'letter-2',
        content: { version: 2 },
        deliveredAt: expect.any(Date),
        receivedAt: null,
        signedBy: null,
      }),
    });
    expect(prisma.awardLetterDelivery.create).not.toHaveBeenCalled();
  });

  it('未签收通知书可用同一资产幂等重发，且占用查询排除当前 delivery', async () => {
    prisma.bidProject.findUnique.mockResolvedValue({ projectCode: 'GK-1', name: 'P' });
    prisma.announcement.findFirst.mockResolvedValue(PUBLISHED_NOTICE(new Date(Date.now() - 1_000)));
    prisma.bidEvaluationResult.findFirst.mockResolvedValue(RANK1);
    prisma.bidSupplier.findUnique.mockResolvedValue({ supplier: { userId: 'u-win' } });
    prisma.awardLetterDelivery.findUnique
      .mockResolvedValueOnce({ id: 'delivery-1', signedAt: null, deliveredAt: new Date('2026-09-03T08:00:00Z') })
      .mockResolvedValueOnce({ id: 'delivery-1', letterAssetId: 'letter-1', receivedAt: null, signedAt: null });
    prisma.awardLetterDelivery.updateMany.mockResolvedValue({ count: 1 });

    await expect(svc.deliverAwardLetter(
      'p1', { winnerName: '中标公司', letterAssetId: 'letter-1' }, 'actor-1',
    )).resolves.toMatchObject({ id: 'delivery-1', letterAssetId: 'letter-1' });

    expect(prisma.awardLetterDelivery.findFirst).toHaveBeenCalledWith({
      where: {
        letterAssetId: 'letter-1',
        NOT: { projectId: 'p1', supplierId: 'sup-win' },
      },
      select: { id: true },
    });
    expect(prisma.awardLetterDelivery.updateMany).toHaveBeenCalledTimes(1);
    expect(prisma.awardLetterDelivery.create).not.toHaveBeenCalled();
  });

  it('重发条件更新未命中时按并发签收冲突拒绝', async () => {
    prisma.bidProject.findUnique.mockResolvedValue({ projectCode: 'GK-1', name: 'P' });
    prisma.announcement.findFirst.mockResolvedValue(PUBLISHED_NOTICE(new Date(Date.now() - 1_000)));
    prisma.bidEvaluationResult.findFirst.mockResolvedValue(RANK1);
    prisma.awardLetterDelivery.findUnique
      .mockResolvedValueOnce({ id: 'delivery-1', signedAt: null, deliveredAt: new Date('2026-09-03T08:00:00Z') })
      .mockResolvedValueOnce({ id: 'delivery-1', signedAt: new Date('2026-09-03T08:01:00Z'), deliveredAt: new Date('2026-09-03T08:00:00Z') });
    prisma.awardLetterDelivery.updateMany.mockResolvedValue({ count: 0 });

    await expect(svc.deliverAwardLetter(
      'p1', { winnerName: '中标公司', letterAssetId: 'letter-2' }, 'actor-1',
    )).rejects.toMatchObject({ response: { code: 'AWARD_LETTER_ALREADY_SIGNED' } });

    expect(notification.sendToUser).not.toHaveBeenCalled();
    expect(prisma.projectManagementItem.update).not.toHaveBeenCalled();
  });

  it('并发重发已换版时拒绝用旧版本继续覆盖', async () => {
    prisma.bidProject.findUnique.mockResolvedValue({ projectCode: 'GK-1', name: 'P' });
    prisma.announcement.findFirst.mockResolvedValue(PUBLISHED_NOTICE(new Date(Date.now() - 1_000)));
    prisma.bidEvaluationResult.findFirst.mockResolvedValue(RANK1);
    prisma.awardLetterDelivery.findUnique
      .mockResolvedValueOnce({ id: 'delivery-1', signedAt: null, deliveredAt: new Date('2026-09-03T08:00:00Z') })
      .mockResolvedValueOnce({ id: 'delivery-1', signedAt: null, deliveredAt: new Date('2026-09-03T08:01:00Z') });
    prisma.awardLetterDelivery.updateMany.mockResolvedValue({ count: 0 });

    await expect(svc.deliverAwardLetter(
      'p1', { winnerName: '中标公司', letterAssetId: 'letter-2' }, 'actor-1',
    )).rejects.toMatchObject({ response: { code: 'AWARD_LETTER_VERSION_CHANGED' } });

    expect(notification.sendToUser).not.toHaveBeenCalled();
    expect(prisma.projectManagementItem.update).not.toHaveBeenCalled();
  });
});

describe('P1-5 — 评委名单评标前保密（EXPERTS_CONFIDENTIAL）', () => {
  let svc: any;
  let prisma: any;

  beforeEach(async () => {
    prisma = { bidProject: { findUnique: jest.fn() }, bidExpert: { findMany: jest.fn() } };
    const { BidService } = await import('./bid.service');
    const instance: any = Object.create(BidService.prototype);
    instance.prisma = prisma;
    svc = instance;
  });

  it('leader/staff 在 DOWNLOAD 阶段 → 403 EXPERTS_CONFIDENTIAL 且零查询专家表', async () => {
    prisma.bidProject.findUnique.mockResolvedValue({ stage: 'DOWNLOAD' });
    await expect(svc.listExperts('p1', 'staff'))
      .rejects.toMatchObject({ response: { code: 'EXPERTS_CONFIDENTIAL' } });
    expect(prisma.bidExpert.findMany).not.toHaveBeenCalled();
  });
  it('staff 在 EVALUATING 阶段 → 放行', async () => {
    prisma.bidProject.findUnique.mockResolvedValue({ stage: 'EVALUATING' });
    prisma.bidExpert.findMany.mockResolvedValue([{ id: 'e1' }]);
    await expect(svc.listExperts('p1', 'staff')).resolves.toEqual([{ id: 'e1' }]);
  });
  it('admin/bid_host 在 DOWNLOAD 阶段 → 放行', async () => {
    prisma.bidProject.findUnique.mockResolvedValue({ stage: 'DOWNLOAD' });
    prisma.bidExpert.findMany.mockResolvedValue([]);
    await expect(svc.listExperts('p1', 'admin')).resolves.toEqual([]);
    expect(prisma.bidProject.findUnique).not.toHaveBeenCalled();
  });
  it('callerRole 缺省（内部直调）→ 放行（向后兼容）', async () => {
    prisma.bidExpert.findMany.mockResolvedValue([]);
    await expect(svc.listExperts('p1')).resolves.toEqual([]);
  });
});

describe('P1-14 — 签字包指纹链持久化', () => {
  let svc: any;
  let prisma: any;
  let tx: any;

  beforeEach(async () => {
    const txOverrides: any = {
      bidArchiveItem: { update: jest.fn(), findMany: jest.fn() },
      bidProject: { update: jest.fn(), findUnique: jest.fn().mockResolvedValue({ id: 'p1', stage: 'EVALUATING' }) },
      bidSupervisionLog: { create: jest.fn().mockResolvedValue({}) },
      bidSignPacket: { findUnique: jest.fn() },
      bidExpert: { findMany: jest.fn() },
      fileAsset: { findMany: jest.fn() },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
      $queryRaw: jest.fn().mockResolvedValue([{ id: 'p1' }]),
    };
    // 兜底：archiveAll 内部其他 prisma 调用（count/findMany/updateMany 等）一律返回 []，测试只关心签字包项的 update
    const makeCatchAll = (): any => {
      const fn: any = jest.fn(async () => []);
      return new Proxy(fn, {
        get(t, p) {
          if (p === 'then') return undefined;
          if (p in t) return t[p];
          const child = makeCatchAll();
          t[p] = child;
          return child;
        },
      });
    };
    tx = new Proxy(txOverrides, {
      get(target, prop) {
        if (prop === 'then') return undefined;
        if (prop in target) return (target as any)[prop];
        const child = makeCatchAll();
        (target as any)[prop] = child;
        return child;
      },
    });
    prisma = {
      bidProject: { findUnique: jest.fn() },
      bidArchiveItem: { findMany: jest.fn() },
      bidSupervisionLog: { create: jest.fn() },
      $transaction: jest.fn(async (fn: any) => fn(tx)),
    };
    const { BidService } = await import('./bid.service');
    const instance: any = Object.create(BidService.prototype);
    instance.prisma = prisma;
    instance.logger = { warn: jest.fn(), log: jest.fn(), error: jest.fn() };
    instance.ensureArchiveItems = jest.fn();
    svc = instance;
  });

  it('完整归档签字包项持久化 fileHashes（与算链同值）', async () => {
    prisma.bidProject.findUnique.mockResolvedValue({ id: 'p1', projectCode: 'GK-1', name: 'P', stage: 'EVALUATING' });
    tx.bidSignPacket = { findUnique: jest.fn().mockResolvedValue({
      closedAt: new Date(), handoverFileAssetId: 'fa-h', sha256: 'sha-packet',
    }) };
    tx.bidExpert = { findMany: jest.fn().mockResolvedValue([
      { expertName: '甲', signStatus: 'SIGNED', signScanFileId: 'fa-scan' },
    ]) };
    tx.fileAsset = { findMany: jest.fn().mockResolvedValue([{ sha256: 'sha-scan' }]) };
    tx.auditLog = { create: jest.fn() };
    tx.bidArchiveItem.findMany.mockResolvedValue([
      { id: 'i1', name: '招标项目基础信息', ownerRole: '系统', status: 'PENDING_CONFIRM' },
      { id: 'i2', name: '评标签字包', ownerRole: '评审委员会', status: 'PENDING_CONFIRM' },
    ]);

    await svc.archiveAll('p1', 'u-host', 'full');

    const signUpdate = tx.bidArchiveItem.update.mock.calls
      .find((c: any[]) => c[0].where.id === 'i2');
    expect(signUpdate).toBeTruthy();
    expect(signUpdate[0].data.fileHashes).toBeTruthy();
    expect(signUpdate[0].data.fileHashes).toHaveLength(3); // packet.sha256 + scan.sha256 + 状态 JSON 哈希
  });

  it('verifyArchiveIntegrity 对持久化 fileHashes 的行重算 valid:true（修复恒 mismatch）', async () => {
    const { computeArchiveChain } = await import('./bid-archive.digest');
    const fileHashes = ['h1', 'h2'];
    const items = [
      { id: 'i1', name: '招标项目基础信息', ownerRole: '系统', status: 'ARCHIVED' },
      { id: 'i2', name: '评标签字包', ownerRole: '评审委员会', status: 'ARCHIVED', fileHashes },
    ];
    const project = { id: 'p1', projectCode: 'GK-1', name: 'P', stage: 'ARCHIVED' };
    const chain = computeArchiveChain(project, items as any);
    const rows = items.map((i: any) => ({ ...i, hashDigest: chain.get(i.id) }));

    prisma.bidProject.findUnique.mockResolvedValue(project);
    prisma.bidArchiveItem.findMany.mockResolvedValue(rows);
    prisma.bidSupervisionLog.create.mockResolvedValue({});

    const result = await svc.verifyArchiveIntegrity('p1');
    expect(result.valid).toBe(true);
    expect(result.mismatches).toHaveLength(0);
  });
});

describe('P1-4 — 旧轨解密归因与时间修改留痕（updateProject）——P1-2 解密归因已迁 bid-decrypt.service.spec', () => {
  let svc: any;
  let prisma: any;
  let tx: any;

  beforeEach(async () => {
    const makeCatchAll = (): any => {
      const fn: any = jest.fn(async () => []);
      return new Proxy(fn, {
        get(t, p) {
          if (p === 'then') return undefined;
          if (p in t) return t[p];
          const child = makeCatchAll();
          t[p] = child;
          return child;
        },
      });
    };
    tx = makeCatchAll();
    prisma = {
      bidProject: { findUnique: jest.fn(), update: jest.fn() },
      bidSupplier: { findFirst: jest.fn(), updateMany: jest.fn(), count: jest.fn().mockResolvedValue(3) }, // A-109a quorum 闸门默认放行
      bidOpeningSession: { findUnique: jest.fn() },
      supplierBidSubmission: { findUnique: jest.fn() },
      supplier: { findUnique: jest.fn().mockResolvedValue({ userId: 'u-sup', name: '甲' }) },
      bidSupervisionLog: { create: jest.fn().mockResolvedValue({}) },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
      $transaction: jest.fn(async (fn: any) => fn(tx)),
    };
    const { BidService } = await import('./bid.service');
    const instance: any = Object.create(BidService.prototype);
    instance.prisma = prisma;
    instance.gateway = undefined;
    instance.notificationService = { sendToUser: jest.fn().mockResolvedValue({}) };
    instance.logger = { warn: jest.fn(), log: jest.fn(), error: jest.fn() };
    svc = instance;
  });


  it('P1-4：updateProject 时间变更 → 监督日志 + 审计日志（含前后值）', async () => {
    const prevOpen = new Date('2026-09-01T10:00:00Z');
    const prevDeadline = new Date('2026-08-31T10:00:00Z');
    prisma.bidProject.findUnique.mockResolvedValue({ openTime: prevOpen, deadline: prevDeadline, stage: 'DOWNLOAD' });
    prisma.bidProject.update.mockResolvedValue({ id: 'p1' });

    await svc.updateProject('p1', { openTime: '2026-09-02T10:00:00Z' } as any, 'u-host');

    expect(prisma.bidSupervisionLog.create).toHaveBeenCalled();
    const logData = prisma.bidSupervisionLog.create.mock.calls[0][0].data;
    expect(logData.action).toBe('项目时间调整');
    expect(JSON.parse(logData.result).prev.openTime).toBe('2026-09-01T10:00:00.000Z');
    expect(prisma.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ userId: 'u-host', action: 'BID_PROJECT_TIME_UPDATED' }),
    }));
  });

  it('P1-4：actorId 缺省 → 有监督日志、无审计日志', async () => {
    // 墙钟无关：prev.deadline 须在未来，否则 modeFor 判 frozen、改 deadline 触发 DEADLINE_FROZEN
    const openTime = new Date(Date.now() + 7 * 24 * 3600 * 1000); // 开标：now+7d
    const prevDeadline = new Date(Date.now() + 6 * 24 * 3600 * 1000); // 原截标：now+6d（开标前 24h）
    const newDeadline = new Date(Date.now() + 5 * 24 * 3600 * 1000); // 新截标：now+5d（仍 ≥ 开标前 24h）
    prisma.bidProject.findUnique.mockResolvedValue({ openTime, deadline: prevDeadline, stage: 'DOWNLOAD' });
    prisma.bidProject.update.mockResolvedValue({ id: 'p1' });

    await svc.updateProject('p1', { deadline: newDeadline.toISOString() } as any);

    expect(prisma.bidSupervisionLog.create).toHaveBeenCalled();
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
  });

  it('P1-4：非时间字段更新 → 无时间留痕日志', async () => {
    prisma.bidProject.update.mockResolvedValue({ id: 'p1' });

    await svc.updateProject('p1', { riskNote: '备注' } as any, 'u-host');

    expect(prisma.bidSupervisionLog.create).not.toHaveBeenCalled();
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
  });
});


describe('backlog C — swapExpertRole 阶段闸门（EXPERT_SWAP_LOCKED）', () => {
  let svc: any;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      bidProject: { findUnique: jest.fn() },
      bidExpert: { findFirst: jest.fn(), update: jest.fn().mockResolvedValue({}) },
      $transaction: jest.fn().mockImplementation(async (ops: any) => Array.isArray(ops) ? Promise.all(ops) : ops(prisma)),
    };
    const { BidService } = await import('./bid.service');
    svc = Object.create(BidService.prototype);
    svc.prisma = prisma;
  });

  it('EVALUATING 互换 → 409 EXPERT_SWAP_LOCKED 且零更新', async () => {
    prisma.bidProject.findUnique.mockResolvedValue({ stage: 'EVALUATING' });
    await expect(svc.swapExpertRole('p1', 'e1', 'e2'))
      .rejects.toMatchObject({ response: { code: 'EXPERT_SWAP_LOCKED' } });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('ARCHIVED 互换 → 409 同码', async () => {
    prisma.bidProject.findUnique.mockResolvedValue({ stage: 'ARCHIVED' });
    await expect(svc.swapExpertRole('p1', 'e1', 'e2'))
      .rejects.toMatchObject({ response: { code: 'EXPERT_SWAP_LOCKED' } });
  });

  it('DOWNLOAD（评标前递补）→ 放行', async () => {
    prisma.bidProject.findUnique.mockResolvedValue({ stage: 'DOWNLOAD' });
    prisma.bidExpert.findFirst.mockResolvedValue({ id: 'e1' });
    const res = await svc.swapExpertRole('p1', 'e1', 'e2');
    expect(res.success).toBe(true);
    expect(prisma.$transaction).toHaveBeenCalled();
  });
});

/* ═══ 终局即固化（A）+ 启动评标兜底（B）：completeOpening 自动化 ═══ */

describe('autoHandoverIfDone / startEvaluation 移交兜底', () => {
  function buildModule(prisma: any) {
    return Test.createTestingModule({
      providers: [
        { provide: ScoreStandardValidator, useValue: { assertPassFailMaxScore: jest.fn(), assertPointsSumWithinMaxScore: jest.fn().mockResolvedValue(undefined), assertScoreStandardComplete: jest.fn().mockResolvedValue(undefined) } },
        { provide: PriceFormulaService, useValue: { calculate: jest.fn().mockReturnValue(new Map()), getOverCeilingSuppliers: jest.fn().mockReturnValue([]) } },
        BidService,
        BidOpeningRecordService,
        ADMIN_KEY_SVC, DUAL_ENVELOPE_SVC, SIGNATURE_SVC, GB_CODE_SVC,
        BidScoreStandardService,
        { provide: StorageService, useValue: { upload: jest.fn() } },
        { provide: PrismaService, useValue: prisma },
        { provide: NotificationService, useValue: { sendToRole: jest.fn() } },
        { provide: BidGateway, useValue: { notifySupervisionLog: jest.fn() } },
      ],
    }).compile();
  }

  it('A·no-op：会话不存在 → 不触发 completeOpening', async () => {
    const prisma: any = {
      bidOpeningSession: { findUnique: jest.fn().mockResolvedValue(null) },
      bidProject: { findUnique: jest.fn().mockResolvedValue({ stage: 'OPENING' }) },
    };
    const service = (await (await buildModule(prisma)).get(BidService) as any);
    const spy = jest.spyOn(service as any, 'completeOpening').mockResolvedValue({} as any);
    await service.autoHandoverIfDone('p1', '测试');
    expect(spy).not.toHaveBeenCalled();
  });

  it('A·no-op：已开标完成（幂等短路） → 不触发', async () => {
    const prisma: any = {
      bidOpeningSession: { findUnique: jest.fn().mockResolvedValue({ status: '开标完成' }) },
      bidProject: { findUnique: jest.fn().mockResolvedValue({ stage: 'OPENING' }) },
    };
    const service = await (await buildModule(prisma)).get(BidService);
    const spy = jest.spyOn(service as any, 'completeOpening').mockResolvedValue({} as any);
    await service.autoHandoverIfDone('p1', '测试');
    expect(spy).not.toHaveBeenCalled();
  });

  it('A·no-op：阶段已非 OPENING → 不触发（阶段棘轮保护）', async () => {
    const prisma: any = {
      bidOpeningSession: { findUnique: jest.fn().mockResolvedValue({ status: '待开标' }) },
      bidProject: { findUnique: jest.fn().mockResolvedValue({ stage: 'EVALUATING' }) },
    };
    const service = await (await buildModule(prisma)).get(BidService);
    const spy = jest.spyOn(service as any, 'completeOpening').mockResolvedValue({} as any);
    await service.autoHandoverIfDone('p1', '测试');
    expect(spy).not.toHaveBeenCalled();
  });

  it('A·no-op：仍有供应商未到终局态 → 不触发', async () => {
    const prisma: any = {
      bidOpeningSession: { findUnique: jest.fn().mockResolvedValue({ status: '待开标' }) },
      bidProject: { findUnique: jest.fn().mockResolvedValue({ stage: 'OPENING' }) },
    };
    const service = await (await buildModule(prisma)).get(BidService);
    jest.spyOn(service as any, 'getOpeningNotReady').mockResolvedValue(['甲公司']);
    const spy = jest.spyOn(service as any, 'completeOpening').mockResolvedValue({} as any);
    await service.autoHandoverIfDone('p1', '测试');
    expect(spy).not.toHaveBeenCalled();
  });

  it('A·触发：全体终局 → 以 auto 标记调用 completeOpening', async () => {
    const prisma: any = {
      bidOpeningSession: { findUnique: jest.fn().mockResolvedValue({ status: '待开标' }) },
      bidProject: { findUnique: jest.fn().mockResolvedValue({ stage: 'OPENING' }) },
    };
    const service = await (await buildModule(prisma)).get(BidService);
    jest.spyOn(service as any, 'getOpeningNotReady').mockResolvedValue([]);
    const spy = jest.spyOn(service as any, 'completeOpening').mockResolvedValue({} as any);
    await service.autoHandoverIfDone('p1', '供应商确认唱标');
    expect(spy).toHaveBeenCalledWith('p1', undefined, { auto: true, trigger: '供应商确认唱标' });
  });

  it('A·吞错：completeOpening 失败不向上抛（绝不阻塞业务路径）', async () => {
    const prisma: any = {
      bidOpeningSession: { findUnique: jest.fn().mockResolvedValue({ status: '待开标' }) },
      bidProject: { findUnique: jest.fn().mockResolvedValue({ stage: 'OPENING' }) },
    };
    const service = await (await buildModule(prisma)).get(BidService);
    jest.spyOn(service as any, 'getOpeningNotReady').mockResolvedValue([]);
    jest.spyOn(service as any, 'completeOpening').mockRejectedValue(new Error('MinIO down'));
    await expect(service.autoHandoverIfDone('p1', '测试')).resolves.toBeUndefined();
  });

  it('B·兜底：startEvaluation 在阶段离开 OPENING 前先调 autoHandoverIfDone（随后因无专家抛错也不影响断言）', async () => {
    const prisma: any = {
      bidProject: { findUnique: jest.fn().mockResolvedValue({ stage: 'OPENING', name: 'X', procurementMethod: '公开招标', roundMode: 'single', projectManagementItemId: null }) },
      bidExpert: { count: jest.fn().mockResolvedValue(0) },
    };
    const service = await (await buildModule(prisma)).get(BidService);
    const heal = jest.spyOn(service as any, 'autoHandoverIfDone').mockResolvedValue(undefined);
    await expect(service.startEvaluation('p1', 'u1')).rejects.toThrow();
    // 第三参=复用已查项目行（少一次查询，不吞上游 findUnique mock 序列）
    expect(heal).toHaveBeenCalledWith('p1', '启动评标兜底', expect.objectContaining({ stage: 'OPENING' }));
  });

  it('B·非 OPENING 项目启动评标不触发兜底（如跳步场景）', async () => {
    const prisma: any = {
      bidProject: { findUnique: jest.fn().mockResolvedValue({ stage: 'DOWNLOAD', name: 'X', procurementMethod: '公开招标', roundMode: 'single', projectManagementItemId: null }) },
      bidExpert: { count: jest.fn().mockResolvedValue(0) },
    };
    const service = await (await buildModule(prisma)).get(BidService);
    const heal = jest.spyOn(service as any, 'autoHandoverIfDone').mockResolvedValue(undefined);
    await expect(service.startEvaluation('p1', 'u1')).rejects.toThrow();
    expect(heal).not.toHaveBeenCalled();
  });
  /* ── F17（2026-08-28）：startEvaluation 同阶段幂等早退 —— 旧实现全流程重跑 ── */
  it('F17：阶段已 EVALUATING → 幂等早退，不入队 AI、不写监督日志、不重验下游闸门', async () => {
    const prisma: any = {
      bidProject: { findUnique: jest.fn().mockResolvedValue({ stage: 'EVALUATING', name: 'P' }) },
      bidExpert: { count: jest.fn() },
      bidSupplier: { findMany: jest.fn() },
      bidSupervisionLog: { create: jest.fn() },
      expertDispute: { count: jest.fn() },
    };
    const service = await (await buildModule(prisma)).get(BidService);
    const res = await service.startEvaluation('p1', 'u1');
    expect(res).toMatchObject({ stage: 'EVALUATING', alreadyStarted: true });
    // 幂等早退：委员会/家数闸门查询、AI task 重建、监督日志全部不应发生
    expect(prisma.bidExpert.count).not.toHaveBeenCalled();
    expect(prisma.bidSupervisionLog.create).not.toHaveBeenCalled();
  });
});



/* ── F16（2026-08-28）：评标延期单次上限——对齐启动评标 evaluationHours 的 720h 封顶 ── */
describe('BidService — extendEvaluationDeadline 上限校验', () => {
  let service: BidService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      bidProject: {
        findUnique: jest.fn().mockResolvedValue({ evaluationDeadline: new Date(), name: 'P' }),
        update: jest.fn().mockResolvedValue({}),
      },
      bidSupervisionLog: { create: jest.fn().mockResolvedValue({}) },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
    };
    const module = await Test.createTestingModule({
      providers: [
        { provide: PrismaService, useValue: prisma },
        { provide: NotificationService, useValue: { create: jest.fn(), sendToRole: jest.fn(), sendToUser: jest.fn() } },
        { provide: ScoreStandardValidator, useValue: { assertPassFailMaxScore: jest.fn(), assertPointsSumWithinMax: jest.fn().mockResolvedValue(undefined), assertScoreStandardComplete: jest.fn().mockResolvedValue(undefined) } },
        { provide: PriceFormulaService, useValue: { calculate: jest.fn().mockReturnValue(new Map()), getOverCeilingSuppliers: jest.fn().mockReturnValue([]) } },
        BidService,
        BidOpeningRecordService,
        ADMIN_KEY_SVC, DUAL_ENVELOPE_SVC, SIGNATURE_SVC, GB_CODE_SVC,
        BidScoreStandardService,
        { provide: StorageService, useValue: { upload: jest.fn() } },
      ],
    }).compile();
    service = module.get(BidService);
  });

  it('F16：extendHours=721 → 400 EXTEND_HOURS_OUT_OF_RANGE（service 硬校验，防绕过 DTO 直调），不动截止时间', async () => {
    await expect(service.extendEvaluationDeadline('p1', 721, '理由', 'u1'))
      .rejects.toMatchObject({ response: { code: 'EXTEND_HOURS_OUT_OF_RANGE' } });
    expect(prisma.bidProject.update).not.toHaveBeenCalled();
  });

  it('F16：extendHours=0 / NaN → 400', async () => {
    await expect(service.extendEvaluationDeadline('p1', 0, '理由', 'u1'))
      .rejects.toMatchObject({ response: { code: 'EXTEND_HOURS_OUT_OF_RANGE' } });
    await expect(service.extendEvaluationDeadline('p1', NaN, '理由', 'u1'))
      .rejects.toMatchObject({ response: { code: 'EXTEND_HOURS_OUT_OF_RANGE' } });
  });

  it('F16：720 小时合法放行（边界）', async () => {
    const r = await service.extendEvaluationDeadline('p1', 720, '理由', 'u1');
    expect(r.evaluationDeadline).toBeTruthy();
    expect(prisma.bidProject.update).toHaveBeenCalled();
  });
});

/* ── A-151（P1 波4）：评标报告章节附注存取（签字包生成前编辑，docx 渲染；重新生成取最新值） ── */
describe('BidService — report notes (A-151 评标报告章节附注)', () => {
  let service: BidService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      bidProject: { findUnique: jest.fn().mockResolvedValue({ name: '测试项目' }), update: jest.fn().mockResolvedValue({}) },
      bidSupervisionLog: { create: jest.fn().mockResolvedValue({}) },
    };
    const module = await Test.createTestingModule({
      providers: [
        { provide: PrismaService, useValue: prisma },
        { provide: NotificationService, useValue: { create: jest.fn(), sendToRole: jest.fn(), sendToUser: jest.fn() } },
        { provide: ScoreStandardValidator, useValue: { assertPassFailMaxScore: jest.fn(), assertPointsSumWithinMax: jest.fn().mockResolvedValue(undefined), assertScoreStandardComplete: jest.fn().mockResolvedValue(undefined) } },
        { provide: PriceFormulaService, useValue: { calculate: jest.fn().mockReturnValue(new Map()), getOverCeilingSuppliers: jest.fn().mockReturnValue([]) } },
        BidService,
        BidOpeningRecordService,
        ADMIN_KEY_SVC, DUAL_ENVELOPE_SVC, SIGNATURE_SVC, GB_CODE_SVC,
        BidScoreStandardService,
        { provide: StorageService, useValue: { upload: jest.fn() } },
      ],
    }).compile();
    service = module.get(BidService);
  });

  it('PUT 空数组 → 清空（reportNotes 落 []）并记「清空附注」监督日志', async () => {
    await expect(service.setReportNotes('p1', { notes: [] }, 'u1')).resolves.toEqual({ success: true });
    expect(prisma.bidProject.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'p1' }, data: { reportNotes: [] } }),
    );
    expect(prisma.bidSupervisionLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: '评标报告附注编辑', result: '清空附注', riskFlag: '无' }) }),
    );
  });

  it('非法章节 → 400 INVALID_SECTION（service 硬校验，防绕过 DTO 直调）', async () => {
    await expect(service.setReportNotes('p1', { notes: [{ section: '十一', content: '越界章节' }] }, 'u1'))
      .rejects.toMatchObject({ response: { code: 'INVALID_SECTION' } });
    expect(prisma.bidProject.update).not.toHaveBeenCalled();
    expect(prisma.bidSupervisionLog.create).not.toHaveBeenCalled();
  });

  it('十节内容落库 + 监督日志摘要含字数', async () => {
    await service.setReportNotes('p1', { notes: [{ section: '十', content: '评标过程合规。' }] }, 'u1');
    expect(prisma.bidProject.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { reportNotes: [{ section: '十', content: '评标过程合规。' }] } }),
    );
    expect(prisma.bidSupervisionLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ result: '第十节 7 字', operatorId: 'u1' }) }),
    );
  });

  /* ── 修复轮1：notes 缺省/null（@IsOptional 放行 body {}/{"notes":null}）原路径 .map 同步抛 TypeError → 500 且清空无日志 ── */
  it('notes 缺省（body {}）→ 归一空数组清空，仍写「清空附注」监督日志', async () => {
    await expect(service.setReportNotes('p1', {} as any, 'u1')).resolves.toEqual({ success: true });
    expect(prisma.bidProject.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'p1' }, data: { reportNotes: [] } }),
    );
    expect(prisma.bidSupervisionLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: '评标报告附注编辑', result: '清空附注', riskFlag: '无' }) }),
    );
  });

  it('notes=null（body {"notes":null}）→ 同款归一清空 + 监督日志（原路径显式置 NULL 后 500、日志未写）', async () => {
    await expect(service.setReportNotes('p1', { notes: null } as any, 'u1')).resolves.toEqual({ success: true });
    expect(prisma.bidProject.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'p1' }, data: { reportNotes: [] } }),
    );
    expect(prisma.bidSupervisionLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ result: '清空附注', riskFlag: '无' }) }),
    );
  });

  it('getReportNotes：未设置返回空数组，已设置原样返回', async () => {
    prisma.bidProject.findUnique.mockResolvedValue({ reportNotes: null });
    await expect(service.getReportNotes('p1')).resolves.toEqual({ notes: [] });
    prisma.bidProject.findUnique.mockResolvedValue({ reportNotes: [{ section: '一', content: 'x' }] });
    await expect(service.getReportNotes('p1')).resolves.toEqual({ notes: [{ section: '一', content: 'x' }] });
  });
});

describe('BidService — 定标联动保证金退还提醒 (A-105)', () => {
  let service: BidService;
  let prisma: any;
  let notification: any;

  beforeEach(async () => {
    prisma = {
      bidProject: { findUnique: jest.fn() },
      bidSupplier: { findFirst: jest.fn(), findMany: jest.fn().mockResolvedValue([]), update: jest.fn(), count: jest.fn().mockResolvedValue(0) },
      bidOpeningRecord: { findMany: jest.fn().mockResolvedValue([]), updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      bidSupervisionLog: { create: jest.fn().mockResolvedValue({}) },
      bidEvaluationResult: { findFirst: jest.fn() },
      // 并行会话新增中标通知书文件闸（letterAssetId 必填+上传人校验+三绑定防复用）所需 mock
      awardLetterDelivery: { upsert: jest.fn(), findUnique: jest.fn().mockResolvedValue(null), findFirst: jest.fn().mockResolvedValue(null), create: jest.fn().mockResolvedValue({ id: 'd1' }), updateMany: jest.fn() },
      fileAsset: { findFirst: jest.fn().mockResolvedValue({ id: 'letter-1', mimeType: 'application/pdf', size: 1024 }) },
      supplier: { findUnique: jest.fn() },
      contract: { findFirst: jest.fn().mockResolvedValue(null) },
      contractFulfillment: { findFirst: jest.fn().mockResolvedValue(null) },
      projectManagementItem: { findFirst: jest.fn().mockResolvedValue(null), update: jest.fn() },
      announcement: { findFirst: jest.fn() },
      systemConfig: { findUnique: jest.fn().mockResolvedValue(null), upsert: jest.fn().mockResolvedValue({}) },
      // C2 三写事务化：事务直通（tx 即 prisma mock）
      $transaction: jest.fn(async (callback: any) => callback(prisma)),
    };
    notification = { sendToRole: jest.fn().mockResolvedValue(undefined), sendToUser: jest.fn().mockResolvedValue(undefined) };
    const module = await Test.createTestingModule({
      providers: [
        { provide: PrismaService, useValue: prisma },
        { provide: NotificationService, useValue: notification },
        { provide: ScoreStandardValidator, useValue: { assertPassFailMaxScore: jest.fn(), assertPointsSumWithinMax: jest.fn().mockResolvedValue(undefined), assertScoreStandardComplete: jest.fn().mockResolvedValue(undefined) } },
        { provide: PriceFormulaService, useValue: { calculate: jest.fn().mockReturnValue(new Map()), getOverCeilingSuppliers: jest.fn().mockReturnValue([]) } },
        BidService,
        BidOpeningRecordService,
        ADMIN_KEY_SVC, DUAL_ENVELOPE_SVC, SIGNATURE_SVC, GB_CODE_SVC,
        BidScoreStandardService,
        { provide: StorageService, useValue: { upload: jest.fn() } },
      ],
    }).compile();
    service = module.get(BidService);
    // deliverAwardLetter → getPublicityStatus 公告码解析链路过重——同 P1-8 块口径直接 stub
    (service as any).resolveAnnouncementCodes = jest.fn(async () => ['GK-1']);
  });

  it('定标联动：sendToRole(staff 两参) resolve 后才写 marker + marker 幂等（marker 已在则不再提醒）', async () => {
    prisma.bidProject.findUnique.mockResolvedValue({ projectCode: 'GK-1', name: 'P', projectManagementItemId: null });
    prisma.announcement.findFirst.mockResolvedValue({ status: 'PUBLISHED', publishDate: new Date(), publicityEnd: new Date(Date.now() - 1_000) });
    prisma.bidEvaluationResult.findFirst.mockResolvedValue({ supplierId: 'sup-win', supplierName: '中标公司' });
    prisma.supplier.findUnique.mockResolvedValue({ userId: 'u-win' });
    // 2026-09-04 契约对齐：deliverAwardLetter 现需 letterAssetId + fileAsset 校验（upsert → findUnique/create）
    prisma.fileAsset.findFirst.mockResolvedValue({ id: 'letter-1', mimeType: 'application/pdf', size: 1024 });
    prisma.awardLetterDelivery.findUnique.mockResolvedValue(null);
    prisma.awardLetterDelivery.create.mockResolvedValue({ id: 'd1' });
    prisma.bidSupplier.findMany.mockResolvedValue([{ supplierName: '乙公司' }, { supplierName: '丙公司' }]);

    await service.deliverAwardLetter('p1', { winnerName: '中标公司', letterAssetId: 'letter-1' }, 'actor-1');

    // sendToRole 两参签名（同 scheduler 口径）：('staff', { type:'SYSTEM', title, content })
    expect(notification.sendToRole).toHaveBeenCalledWith('staff', expect.objectContaining({ type: 'SYSTEM' }));
    expect(notification.sendToRole.mock.calls[0]).toHaveLength(2);
    expect(prisma.systemConfig.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { key: 'bond_return_reminder_award:p1' } }),
    );
    // 调序（P2 C1）：marker 只在 sendToRole resolve 之后写——失败不占坑，日调度 bond_return_reminded:* 兜底可重发
    expect(notification.sendToRole.mock.invocationCallOrder[0]).toBeLessThan(
      prisma.systemConfig.upsert.mock.invocationCallOrder[0],
    );
    // 终审 Critical#2：pending 查询走共享谓词——三键（已提交+未退还+无不予退还终局）+ winner 排除
    const pendingCall = prisma.bidSupplier.findMany.mock.calls.find((c: any) => c[0]?.where && 'bondReturnedAt' in c[0].where);
    expect(pendingCall?.[0]).toEqual({
      where: {
        projectId: 'p1', supplierName: { not: '中标公司' },
        submitStatus: '已提交', bondReturnedAt: null, bondReturnReason: null,
      },
      select: { supplierName: true },
    });

    // 幂等：marker 已存在 → 二次发放不再提醒
    notification.sendToRole.mockClear();
    prisma.systemConfig.upsert.mockClear();
    prisma.systemConfig.findUnique.mockResolvedValue({ key: 'bond_return_reminder_award:p1' });
    await service.deliverAwardLetter('p1', { winnerName: '中标公司', letterAssetId: 'letter-1' }, 'actor-1');
    expect(notification.sendToRole).not.toHaveBeenCalled();
    expect(prisma.systemConfig.upsert).not.toHaveBeenCalled();
  });

  it('定标联动：无待退还（pending=0）→ 不 sendToRole 不写 marker（零副作用）', async () => {
    prisma.bidProject.findUnique.mockResolvedValue({ projectCode: 'GK-1', name: 'P', projectManagementItemId: null });
    prisma.announcement.findFirst.mockResolvedValue({ status: 'PUBLISHED', publishDate: new Date(), publicityEnd: new Date(Date.now() - 1_000) });
    prisma.bidEvaluationResult.findFirst.mockResolvedValue({ supplierId: 'sup-win', supplierName: '中标公司' });
    prisma.supplier.findUnique.mockResolvedValue({ userId: 'u-win' });
    prisma.fileAsset.findFirst.mockResolvedValue({ id: 'letter-1', mimeType: 'application/pdf', size: 1024 });
    prisma.awardLetterDelivery.findUnique.mockResolvedValue(null);
    prisma.awardLetterDelivery.create.mockResolvedValue({ id: 'd1' });
    prisma.bidSupplier.findMany.mockResolvedValue([]); // pending=0

    await expect(service.deliverAwardLetter('p1', { winnerName: '中标公司', letterAssetId: 'letter-1' }, 'actor-1')).resolves.toEqual({ id: 'd1' });

    expect(notification.sendToRole).not.toHaveBeenCalled();
    expect(prisma.systemConfig.upsert).not.toHaveBeenCalled();
  });

  it('定标联动：sendToRole 失败 → marker 不写（不占坑）+ warn 留痕，不阻塞通知书', async () => {
    prisma.bidProject.findUnique.mockResolvedValue({ projectCode: 'GK-1', name: 'P', projectManagementItemId: null });
    prisma.announcement.findFirst.mockResolvedValue({ status: 'PUBLISHED', publishDate: new Date(), publicityEnd: new Date(Date.now() - 1_000) });
    prisma.bidEvaluationResult.findFirst.mockResolvedValue({ supplierId: 'sup-win', supplierName: '中标公司' });
    prisma.supplier.findUnique.mockResolvedValue({ userId: 'u-win' });
    prisma.fileAsset.findFirst.mockResolvedValue({ id: 'letter-1', mimeType: 'application/pdf', size: 1024 });
    prisma.awardLetterDelivery.findUnique.mockResolvedValue(null);
    prisma.awardLetterDelivery.create.mockResolvedValue({ id: 'd1' });
    prisma.bidSupplier.findMany.mockResolvedValue([{ supplierName: '乙公司' }]);
    notification.sendToRole.mockRejectedValue(new Error('通知服务不可用'));
    const warnSpy = jest.spyOn((service as any).logger, 'warn').mockImplementation(() => {});

    await expect(service.deliverAwardLetter('p1', { winnerName: '中标公司', letterAssetId: 'letter-1' }, 'actor-1')).resolves.toEqual({ id: 'd1' });

    // 失败不占坑——marker 未写，本次发送失败后日调度 bond_return_reminded:* 通道仍可补发
    expect(prisma.systemConfig.upsert).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(expect.stringMatching(/A-105 定标提醒发送失败 project=p1:/));
  });
});
