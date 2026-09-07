import { Test, TestingModule } from '@nestjs/testing';
import * as crypto from 'crypto';
import { BidDecryptService } from './bid-decrypt.service';
import { BidService } from './bid.service';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationService } from '../notification/notification.service';
import { AdminKeyService } from '../common/crypto/admin-keystore.service';
import { DualEnvelopeService } from '../common/crypto/dual-envelope.service';
import { SignatureService } from '../common/crypto/signature.service';
import { minioClient, MINIO_BUCKET } from '../upload/minio.client';
import { streamToBuffer } from './bid-submission.crypto';
import { randomHex, sha256Hex, sm4Encrypt, wrapDekJson, sm2EncryptHex } from '@water-erp/ukey';
import type { DualEnvelope } from '@water-erp/ukey';
import { Prisma } from '@prisma/client';
import { wrapKey } from '../common/crypto/envelope-crypto';

const sm2 = require('sm-crypto').sm2;


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

/* BidDecryptService（F1d 双信封解密域）构造依赖 mock：prisma/notificationService 逐 describe 提供，
   adminKey/dualEnvelope 用全局默认桩，bidService 跨域回调以空桩替身。 */
const ADMIN_KEY_SVC = {
  provide: AdminKeyService,
  useValue: { readPrivateKey: jest.fn(), getActiveCert: jest.fn(), ensureBootstrap: jest.fn(), generate: jest.fn() },
};
const DUAL_ENVELOPE_SVC = {
  provide: DualEnvelopeService,
  useValue: { verifySignature: jest.fn(), assertEnvelopeIntact: jest.fn(), decryptOuterFile: jest.fn(), verifyFieldsCommit: jest.fn() },
};
const BID_SERVICE_STUB = { autoHandoverIfDone: jest.fn(), attributePendingDualSuppliers: jest.fn() };

/* ── F1d 迁移说明：本 spec 自 bid.service.spec.ts 迁出（纯移动；BidService→BidDecryptService 字样与
      provider 骨架按域替换）。归因矩阵/H4 守卫/P1-4 updateProject 等留守用例仍在 bid.service.spec.ts ── */

describe('BidDecryptService — 双信封解密域', () => {
  let service: BidDecryptService;
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
      bidInvalidBid: { findMany: jest.fn().mockResolvedValue([]), findUnique: jest.fn(), findFirst: jest.fn(), update: jest.fn() },
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
        BidDecryptService,
        ADMIN_KEY_SVC, DUAL_ENVELOPE_SVC,
        { provide: PrismaService, useValue: prisma },
        { provide: NotificationService, useValue: { sendToRole: jest.fn() } },
        { provide: BidService, useValue: BID_SERVICE_STUB },
      ],
    }).compile();

    service = module.get<BidDecryptService>(BidDecryptService);
  });

  describe('decryptAllSuppliers — N15 一键解密只取 PENDING', () => {
    it('N15：一键解密只取 PENDING（DANGER 不再必然计 failed）', async () => {
      prisma.bidProject.findUnique.mockResolvedValue({ stage: 'OPENING', name: 'P' });
      prisma.bidSupplier.findMany.mockResolvedValue([{ id: 'bs-1', supplierName: 'A' }]);
      prisma.bidSupplier.findFirst.mockResolvedValue({ id: 'bs-1', supplierId: 's1', decryptStatus: 'PENDING' });
      // 单供应商解密成功前置（复制自 decryptSupplier beforeEach，自包含）
      prisma.$transaction = jest.fn(async (callback: any) => callback(prisma));
      prisma.bidSupplier.updateMany = jest.fn().mockResolvedValue({ count: 1 });
      prisma.bidSupplier.update.mockResolvedValue({ id: 'bs-1', decryptStatus: 'SUCCESS', confirmStatus: 'PENDING' });
      prisma.bidSupplier.findUnique.mockResolvedValue({ id: 'bs-1', decryptStatus: 'SUCCESS', confirmStatus: 'PENDING' });
      prisma.supplierBidSubmission.findUnique = jest.fn().mockResolvedValue({
        technicalFileAssetId: 'fa1', businessFileAssetId: null, coverLetterAssetId: null,
        technicalSealedKey: null, businessSealedKey: null, coverLetterSealedKey: null,
      });
      prisma.fileAsset.findUnique = jest.fn().mockResolvedValue({ id: 'fa1', key: 'uploads/test.pdf', sha256: 'abc123' });
      prisma.bidOpeningRecord.upsert.mockResolvedValue({});
      prisma.bidSupervisionLog.create.mockResolvedValue({});
      prisma.bidOpeningSession.findUnique = jest.fn().mockResolvedValue({
        decryptWindowStart: new Date(Date.now() - 3600_000),
        decryptWindowEnd: new Date(Date.now() + 3600_000),
      });

      const res = await service.decryptAllSuppliers('p1', 'u1');
      expect(prisma.bidSupplier.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ decryptStatus: 'PENDING' }) }),
      );
      expect(res.total).toBe(1);
      expect(res.failed).toBe(0);
      expect(res.details[0].success).toBe(true);
    });

    it('Task 16：dual-v2 家 skip 不入解密循环（明细标 error，零抢占）', async () => {
      prisma.bidProject.findUnique.mockResolvedValue({ stage: 'OPENING', name: 'P' });
      prisma.bidSupplier.findMany.mockResolvedValue([
        { id: 'bs-1', supplierName: 'A', supplierId: 's1' },
      ]);
      prisma.supplierBidSubmission.findMany = jest.fn().mockResolvedValue([
        { supplierId: 's1', envelopeVersion: 'dual-v2' },
      ]);

      const res = await service.decryptAllSuppliers('p1', 'u1');

      expect(res.total).toBe(1);
      expect(res.failed).toBe(1);
      expect(res.details[0]).toMatchObject({
        supplierId: 'bs-1', supplierName: 'A', success: false, error: '新轨项目请走供应商解密',
      });
      // 未进入解密循环：不查单家、不抢占（无 RUNNING 楔）
      expect(prisma.bidSupplier.findFirst).not.toHaveBeenCalled();
      expect(prisma.bidSupplier.update).not.toHaveBeenCalled();
    });
  });

  describe('reuploadBidFile — 新轨分派（dual-v2 一律走供应商端补传）', () => {
    it('submission.envelopeVersion=dual-v2 → 400 USE_SUPPLIER_REUPLOAD（阶段门后、SHA 校验前拒收，零恢复动作）', async () => {
      prisma.bidProject.findUnique.mockResolvedValue({ stage: 'OPENING', name: 'P' });
      prisma.bidSupplier.findFirst.mockResolvedValue({ id: 'bs-1', projectId: 'p1', supplierId: 's1', supplierName: 'S' });
      prisma.supplierBidSubmission.findUnique.mockResolvedValue({
        id: 'sub-1', status: 'submitted', envelopeVersion: 'dual-v2', technicalFileAssetId: 'fa1',
      });

      await expect(service.reuploadBidFile('p1', 'bs-1', 'technical', { buffer: Buffer.from('new-couter') } as any, 'u1'))
        .rejects.toMatchObject({ response: { code: 'USE_SUPPLIER_REUPLOAD' } });

      // 拒收发生在 FileAsset 取回（SHA 闸门前置查询）之前——不触任何恢复写入
      expect(prisma.fileAsset.findUnique).not.toHaveBeenCalled();
      expect(prisma.bidSupplier.update).not.toHaveBeenCalled();
      expect(prisma.bidSupervisionLog.create).not.toHaveBeenCalled();
    });
  });

  describe('reuploadBidFile — 旧轨密文直传（重置专属用例）', () => {
    it('SHA-256 一致过闸 → 重加密落 MinIO，事务内 bidSupplier 重置 PENDING 并清空解密成功时间（A-111）', async () => {
      const ciphertext = Buffer.from('legacy-couter-original-bytes');
      const sha = crypto.createHash('sha256').update(ciphertext).digest('hex');
      prisma.bidProject.findUnique.mockResolvedValue({ stage: 'OPENING', name: 'P' });
      prisma.bidSupplier.findFirst.mockResolvedValue({ id: 'bs-1', projectId: 'p1', supplierId: 's1', supplierName: 'S' });
      prisma.supplierBidSubmission.findUnique.mockResolvedValue({
        technicalFileAssetId: 'fa1', businessFileAssetId: null, coverLetterAssetId: null,
      });
      prisma.supplierBidSubmission.update = jest.fn().mockResolvedValue({});
      prisma.fileAsset.findUnique.mockResolvedValue({ id: 'fa1', key: 'uploads/old.enc', sha256: sha, clientEncrypted: true });
      prisma.fileAsset.update = jest.fn();
      prisma.bidSupplier.update.mockResolvedValue({});
      prisma.bidSupervisionLog.create.mockResolvedValue({});
      prisma.auditLog.create.mockResolvedValue({});
      const autoDecrypt = jest.spyOn(service, 'decryptSupplier').mockResolvedValue({ id: 'bs-1', decryptStatus: 'SUCCESS' } as any);

      const res = await service.reuploadBidFile('p1', 'bs-1', 'technical', { buffer: ciphertext } as any, 'u1');

      expect(res).toMatchObject({ recovered: true, decrypted: true, decryptStatus: 'SUCCESS' });
      expect(minioClient.putObject).toHaveBeenCalled(); // 重加密密文落 MinIO
      // 补传后文件变为 server-encrypted：清除 E2EE 标记
      expect(prisma.fileAsset.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'fa1' }, data: expect.objectContaining({ encrypted: true, clientEncrypted: false }) }),
      );
      // 重置 data 形状（A-111：清空解密成功时间，供重新解密走全流程）
      expect(prisma.bidSupplier.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'bs-1' }, data: { decryptStatus: 'PENDING', decryptError: null, decryptedAt: null } }),
      );
      expect(autoDecrypt).toHaveBeenCalledWith('p1', 'bs-1', undefined, 'u1');
    });
  });

  describe('resealBidFiles — Task 16 旧轨收窄（删除服务端明文恢复，保留 E2EE 重包裹）', () => {
    it('dual-v2 → 400 USE_SUPPLIER_REUPLOAD（门控于恢复动作前，零副作用）', async () => {
      prisma.bidProject.findUnique.mockResolvedValue({ stage: 'OPENING', name: 'P' });
      prisma.bidSupplier.findFirst.mockResolvedValue({ id: 'bs-1', projectId: 'p1', supplierId: 's1', supplierName: 'S' });
      prisma.supplierBidSubmission.findUnique.mockResolvedValue({ id: 'sub-1', envelopeVersion: 'dual-v2', technicalFileAssetId: 'fa1' });

      await expect(service.resealBidFiles('p1', 'bs-1', 'u1')).rejects.toMatchObject({
        response: { code: 'USE_SUPPLIER_REUPLOAD' },
      });

      expect(prisma.fileAsset.findUnique).not.toHaveBeenCalled();
      expect(prisma.bidSupplier.update).not.toHaveBeenCalled();
      expect(prisma.bidSupervisionLog.create).not.toHaveBeenCalled();
    });

    it('E2EE（clientEncrypted）仍走密钥重包裹分支——不读 MinIO 明文、不重加密、不动 fileAsset', async () => {
      (minioClient.getObject as jest.Mock).mockClear();
      (minioClient.putObject as jest.Mock).mockClear();
      const wrapped = wrapKey('e2ee-dek-material', BID_SPEC_KMS);
      prisma.bidProject.findUnique.mockResolvedValue({ stage: 'OPENING', name: 'P' });
      prisma.bidSupplier.findFirst.mockResolvedValue({ id: 'bs-1', projectId: 'p1', supplierId: 's1', supplierName: 'S' });
      prisma.supplierBidSubmission.findUnique.mockResolvedValue({
        technicalFileAssetId: 'fa1', businessFileAssetId: null, coverLetterAssetId: null,
        technicalSealedKey: wrapped, businessSealedKey: null, coverLetterSealedKey: null,
      });
      prisma.supplierBidSubmission.update = jest.fn().mockResolvedValue({});
      prisma.fileAsset.findUnique.mockResolvedValue({ id: 'fa1', key: 'uploads/e2ee.enc', sha256: 'abc', clientEncrypted: true });
      prisma.fileAsset.update = jest.fn();
      prisma.bidSupplier.update.mockResolvedValue({});
      prisma.bidSupervisionLog.create.mockResolvedValue({});
      prisma.auditLog.create.mockResolvedValue({});
      const autoDecrypt = jest.spyOn(service, 'decryptSupplier').mockResolvedValue({ id: 'bs-1', decryptStatus: 'SUCCESS' } as any);

      const res = await service.resealBidFiles('p1', 'bs-1', 'u1');

      expect(res.recovered).toContain('技术标');
      expect(res.failed).toEqual([]);
      expect(res.decrypted).toBe(true);
      // 仅更新 sealedKey（重包裹），密文不动：不读 MinIO、不写新密文、不触碰 fileAsset
      expect(prisma.supplierBidSubmission.update).toHaveBeenCalled();
      expect(minioClient.getObject).not.toHaveBeenCalled();
      expect(minioClient.putObject).not.toHaveBeenCalled();
      expect(prisma.fileAsset.update).not.toHaveBeenCalled();
      // A-111：重置 PENDING 时清空解密成功时间（reuploadBidFile 管理员补传同款重置 data 形状，最近覆盖用例）
      expect(prisma.bidSupplier.update).toHaveBeenCalledWith({
        where: { id: 'bs-1' },
        data: { decryptStatus: 'PENDING', decryptError: null, decryptedAt: null },
      });
      expect(autoDecrypt).toHaveBeenCalled();
    });

    it('Task 16 fix：全角色 RESEAL_PLAINTEXT_RECOVERY_REMOVED → 分流不写 bidValidity、无「投标无效」叙事（非 E2EE 无 key 也可达此分支）', async () => {
      prisma.bidProject.findUnique.mockResolvedValue({ stage: 'OPENING', name: 'P' });
      prisma.bidSupplier.findFirst.mockResolvedValue({ id: 'bs-1', projectId: 'p1', supplierId: 's1', supplierName: 'S' });
      prisma.supplierBidSubmission.findUnique.mockResolvedValue({
        technicalFileAssetId: 'fa1', businessFileAssetId: 'fa2', coverLetterAssetId: null,
        technicalSealedKey: null, businessSealedKey: null, coverLetterSealedKey: null,
      });
      // 非 E2EE 资产（无 clientEncrypted），且不带 key —— key 校验已收窄进 E2EE 分支
      prisma.fileAsset.findUnique.mockResolvedValue({ id: 'fa1', sha256: 'abc' });
      prisma.bidSupplier.update.mockResolvedValue({});
      prisma.bidSupervisionLog.create.mockResolvedValue({});
      prisma.auditLog.create.mockResolvedValue({});

      const res = await service.resealBidFiles('p1', 'bs-1', 'u1');

      expect(res.recovered).toEqual([]);
      expect(res.failed.map(f => f.code)).toEqual(['RESEAL_PLAINTEXT_RECOVERY_REMOVED', 'RESEAL_PLAINTEXT_RECOVERY_REMOVED']);
      // 分流：只写 decryptError + 低风险日志引导补传；bidValidity（load-bearing 排除标记）不被写
      expect(prisma.bidSupplier.update).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ decryptError: expect.stringContaining('服务端明文恢复通道已下线') }),
      }));
      expect(prisma.bidSupplier.update).not.toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ bidValidity: expect.anything() }),
      }));
      expect(prisma.bidSupervisionLog.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ result: expect.stringContaining('明文恢复通道已退役，请走补传'), riskFlag: '低风险' }),
      }));
      expect(prisma.bidSupervisionLog.create).not.toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ action: '投标无效' }),
      }));
    });
  });

  describe('decryptSupplier', () => {
    beforeEach(() => {
      prisma.$transaction = jest.fn(async (callback: any) => callback(prisma));
      prisma.bidSupplier.findFirst.mockResolvedValue({
        id: 'bs-1', projectId: 'p1', supplierName: '测试供应商', supplierId: 's1', decryptStatus: 'PENDING',
      });
      // P1-3：三段式重构后解密经 updateMany 原子抢占（默认抢占成功）
      prisma.bidSupplier.updateMany = jest.fn().mockResolvedValue({ count: 1 });
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
      prisma.bidOpeningRecord.upsert.mockResolvedValue({});
      prisma.bidSupervisionLog.create.mockResolvedValue({});
      // Default: session exists with open window (大多数测试解密成功需此前提)
      prisma.bidOpeningSession.findUnique = jest.fn().mockResolvedValue({
        decryptWindowStart: new Date(Date.now() - 3600_000),
        decryptWindowEnd: new Date(Date.now() + 3600_000),
      });
      // Default: project is in OPENING stage (decryptSupplier 阶段门控)
      prisma.bidProject.findUnique.mockResolvedValue({ stage: 'OPENING' });
      // A-109a 签到 quorum 闸门默认放行（已签到且已递交 3 家 ≥ 法定 3）
      prisma.bidSupplier.count.mockResolvedValue(3);
    });

    it('succeeds deterministically by default', async () => {
      const result = await service.decryptSupplier('p1', 'bs-1', {} as any);

      expect(result).toBeDefined();
      expect(prisma.bidSupplier.update).toHaveBeenCalledWith({
        where: { id: 'bs-1' },
        data: { decryptStatus: 'SUCCESS', decryptedAt: expect.any(Date) }, // A-111：终局事务写解密成功时间
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

      expect(prisma.bidOpeningRecord.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { projectId_bidSupplierId: { projectId: 'p1', bidSupplierId: 'bs-1' } },
          create: expect.objectContaining({ projectId: 'p1', bidSupplierId: 'bs-1', confirmStatus: '待供应商确认' }),
        }),
      );
      expect(prisma.bidSupplier.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ confirmStatus: 'PENDING' }) }),
      );
      expect(prisma.bidSupplier.update).not.toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ confirmStatus: 'CONFIRMED' }) }),
      );
    });

    it('N1：并发抢占——PENDING claim count=0 且 RUNNING 未超时 → 409，不接管不终局写入', async () => {
      prisma.bidSupplier.updateMany = jest.fn()
        .mockResolvedValueOnce({ count: 0 })  // PENDING 抢占失败（首笔已抢）
        .mockResolvedValueOnce({ count: 0 }); // 接管条件更新也失败（updatedAt 新鲜）
      prisma.bidSupplier.findUnique.mockResolvedValue({
        id: 'bs-1', decryptStatus: 'RUNNING', updatedAt: new Date(), // 1 秒前，未超时
      });

      await expect(service.decryptSupplier('p1', 'bs-1')).rejects.toMatchObject({
        response: { code: 'DECRYPT_ALREADY_IN_FLIGHT' },
      });
      // 未发生终局写入（解密/日志均不动）
      expect(prisma.bidSupplier.update).not.toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ decryptStatus: 'SUCCESS' }) }),
      );
      expect(prisma.bidSupervisionLog.create).not.toHaveBeenCalled();
    });

    it('N1：RUNNING 停滞超过 60s（崩溃遗留）→ 接管成功进入解密', async () => {
      prisma.bidSupplier.updateMany = jest.fn()
        .mockResolvedValueOnce({ count: 0 })  // PENDING 抢占失败
        .mockResolvedValueOnce({ count: 1 }); // 接管成功
      // 简报中 Once(PENDING) 注明「方法首查（:1819）」——:1819 是 findFirst（非 findUnique），自包含重申在此；
      // claim 失败后的复查（首个 findUnique 调用）须为停滞 RUNNING：
      prisma.bidSupplier.findFirst.mockResolvedValue({
        id: 'bs-1', projectId: 'p1', supplierName: '测试供应商', supplierId: 's1', decryptStatus: 'PENDING',
      });
      prisma.bidSupplier.findUnique.mockResolvedValue({ id: 'bs-1', decryptStatus: 'RUNNING',
        updatedAt: new Date(Date.now() - 120_000), supplierId: 'sup-1' });      // claim 失败后的复查（停滞 120s > 60s）
      // 解密终局断言 SUCCESS：沿用既有用例的 submission/fileAsset 前置（复制自 beforeEach，自包含）——
      // H1 规则下 submission=null 会判 DANGER「供应商未提交投标文件」，与本用例 SUCCESS 断言冲突
      prisma.supplierBidSubmission.findUnique.mockResolvedValue({
        technicalFileAssetId: 'fa1', businessFileAssetId: null, coverLetterAssetId: null,
        technicalSealedKey: null, businessSealedKey: null, coverLetterSealedKey: null,
      });
      prisma.fileAsset.findUnique.mockResolvedValue({ id: 'fa1', key: 'uploads/test.pdf', sha256: 'abc123' });
      prisma.bidOpeningSession.findUnique.mockResolvedValue({ pausedAt: null, decryptWindowStart: new Date(Date.now() - 3600_000), decryptWindowEnd: new Date(Date.now() + 3600_000) });
      prisma.bidProject.findUnique.mockResolvedValue({ stage: 'OPENING' });
      prisma.$transaction.mockImplementation(async (fn: any) => fn(prisma));

      const res = await service.decryptSupplier('p1', 'bs-1');
      expect(prisma.bidSupplier.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ decryptStatus: 'SUCCESS' }) }),
      );
      expect(res).toBeTruthy();
    });

    it('N1：DANGER 态（已定性）→ 409 文案区分', async () => {
      prisma.bidSupplier.updateMany = jest.fn().mockResolvedValue({ count: 0 });
      prisma.bidSupplier.findUnique.mockResolvedValue({ id: 'bs-1', decryptStatus: 'DANGER', updatedAt: new Date() });
      await expect(service.decryptSupplier('p1', 'bs-1')).rejects.toMatchObject({
        response: { code: 'DECRYPT_ALREADY_IN_FLIGHT' },
      });
    });

    it('P1-3：解密即唱标重复提供字段时开标记录 upsert（并发不双建）', async () => {
      await service.decryptSupplier('p1', 'bs-1', { amount: '100', period: '30天', qualityTarget: '合格', bondStatus: '已缴纳' } as any);

      // N1b 后写入不再 findFirst-then-create/update，upsert update 分支承载「已存在→更新」语义
      expect(prisma.bidOpeningRecord.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { projectId_bidSupplierId: { projectId: 'p1', bidSupplierId: 'bs-1' } },
          update: expect.objectContaining({ amount: '100', confirmStatus: '待供应商确认' }),
        }),
      );
      expect(prisma.bidOpeningRecord.create).not.toHaveBeenCalled();
      expect(prisma.bidOpeningRecord.update).not.toHaveBeenCalled();
    });

    it('N1：开标记录写入走 upsert（projectId_bidSupplierId 复合唯一），不再 findFirst-then-create', async () => {
      // 自包含前置：复制自 beforeEach「解密即唱标」成功路径 setup（窗口/阶段/事务/抢占）
      prisma.$transaction = jest.fn(async (callback: any) => callback(prisma));
      prisma.bidSupplier.findFirst.mockResolvedValue({
        id: 'bs-1', projectId: 'p1', supplierName: '测试供应商', supplierId: 's1', decryptStatus: 'PENDING',
      });
      prisma.bidSupplier.updateMany = jest.fn().mockResolvedValue({ count: 1 });
      prisma.bidSupplier.update.mockResolvedValue({ id: 'bs-1', decryptStatus: 'SUCCESS', confirmStatus: 'PENDING' });
      prisma.bidSupplier.findUnique.mockResolvedValue({
        id: 'bs-1', decryptStatus: 'PENDING', supplierId: 'sup-1',
      });
      prisma.supplierBidSubmission.findUnique = jest.fn().mockResolvedValue({
        technicalFileAssetId: 'fa1', businessFileAssetId: null, coverLetterAssetId: null,
        technicalSealedKey: null, businessSealedKey: null, coverLetterSealedKey: null,
      });
      prisma.fileAsset.findUnique = jest.fn().mockResolvedValue({ id: 'fa1', key: 'uploads/test.pdf', sha256: 'abc123' });
      prisma.bidOpeningRecord.upsert.mockResolvedValue({});
      prisma.bidSupervisionLog.create.mockResolvedValue({});
      prisma.bidOpeningSession.findUnique = jest.fn().mockResolvedValue({
        decryptWindowStart: new Date(Date.now() - 3600_000),
        decryptWindowEnd: new Date(Date.now() + 3600_000),
      });
      prisma.bidProject.findUnique.mockResolvedValue({ stage: 'OPENING' });

      await service.decryptSupplier('p1', 'bs-1', {
        amount: '100', period: '30天', qualityTarget: '合格', bondStatus: '已缴纳',
      } as any);

      expect(prisma.bidOpeningRecord.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { projectId_bidSupplierId: { projectId: 'p1', bidSupplierId: 'bs-1' } },
        }),
      );
      expect(prisma.bidOpeningRecord.create).not.toHaveBeenCalled();
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
        data: { decryptStatus: 'SUCCESS', decryptedAt: expect.any(Date) }, // A-111：终局事务写解密成功时间
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

    it('Task 16：dual-v2 → 400 USE_SUPPLIER_DECRYPT（门控在阶段门后、抢占之前，不留 RUNNING 楔）', async () => {
      prisma.supplierBidSubmission.findUnique.mockResolvedValue({ envelopeVersion: 'dual-v2' });

      await expect(service.decryptSupplier('p1', 'bs-1')).rejects.toMatchObject({
        response: { code: 'USE_SUPPLIER_DECRYPT' },
      });
      // 抢占未发生（PENDING 未被改写为 RUNNING），否则需 60s 接管才可重试
      expect(prisma.bidSupplier.updateMany).not.toHaveBeenCalled();
      expect(prisma.bidSupplier.update).not.toHaveBeenCalled();
      expect(prisma.bidSupervisionLog.create).not.toHaveBeenCalled();
    });

    // ── P1-4 同构：解密即唱标路径同样校验工期一致性（第二入口）──
    it('P1-4 同构：解密路径工期与投递不一致且未确认 → 409 PERIOD_MISMATCH（不落库、不抢占 RUNNING）', async () => {
      // findUnique 补 supplierId 以命中 assertPeriodMatchesSubmitted（beforeEach 基座 mock 无 supplierId → 跳过校验）
      prisma.bidSupplier.findUnique.mockResolvedValue({ id: 'bs-1', decryptStatus: 'SUCCESS', confirmStatus: 'PENDING', supplierId: 's1' });
      prisma.supplierBidSubmission.findUnique = jest.fn().mockResolvedValue({
        technicalFileAssetId: 'fa1', businessFileAssetId: null, coverLetterAssetId: null,
        technicalSealedKey: null, businessSealedKey: null, coverLetterSealedKey: null,
        bidPrice: null, deliveryPeriod: '180天',
      });

      await expect(service.decryptSupplier('p1', 'bs-1', { amount: '980000', period: '90天', qualityTarget: '合格', bondStatus: '已缴纳' } as any))
        .rejects.toMatchObject({ response: { code: 'PERIOD_MISMATCH', expected: '180天', entered: '90天' } });
      expect(prisma.bidOpeningRecord.upsert).not.toHaveBeenCalled();
      // fix round 2：mismatch 断言前置于 phase-① 抢占——409 时供应商仍 PENDING，确认重试即时生效（不卡 RUNNING 60s）
      expect(prisma.bidSupplier.updateMany).not.toHaveBeenCalled();
    });

    it('P1-4 同构：解密路径工期不一致但 confirmSealedPeriod=true → 落库且监督日志注明差异', async () => {
      prisma.bidSupplier.findUnique.mockResolvedValue({ id: 'bs-1', decryptStatus: 'SUCCESS', confirmStatus: 'PENDING', supplierId: 's1' });
      prisma.supplierBidSubmission.findUnique = jest.fn().mockResolvedValue({
        technicalFileAssetId: 'fa1', businessFileAssetId: null, coverLetterAssetId: null,
        technicalSealedKey: null, businessSealedKey: null, coverLetterSealedKey: null,
        bidPrice: null, deliveryPeriod: '180天',
      });

      const res = await service.decryptSupplier('p1', 'bs-1', { amount: '980000', period: '90天', qualityTarget: '合格', bondStatus: '已缴纳', confirmSealedPeriod: true } as any);
      expect(res).toBeDefined();
      expect(prisma.bidOpeningRecord.upsert).toHaveBeenCalledWith(expect.objectContaining({
        create: expect.objectContaining({ period: '90天' }),
      }));
      expect(prisma.bidSupervisionLog.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ result: expect.stringContaining('180天') }),
      }));
    });

    it('A-109a：签到 quorum 不足（公开招标已签到 2/3）→ 400 INSUFFICIENT_CHECKIN，不抢占', async () => {
      prisma.bidProject.findUnique.mockResolvedValue({ stage: 'OPENING', name: '英雄项目', procurementMethod: '公开招标' });
      prisma.bidSupplier.count.mockResolvedValue(2);
      await expect(service.decryptSupplier('p1', 'bs-1', {} as any)).rejects.toMatchObject({
        response: { code: 'INSUFFICIENT_CHECKIN' },
      });
      // 门控置于 phase-① 抢占之前：不写 RUNNING 楔
      expect(prisma.bidSupplier.updateMany).not.toHaveBeenCalled();
      expect(prisma.bidSupplier.update).not.toHaveBeenCalled();
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

      // P1-3 三段式：①②段读 this.prisma、③段短事务读 tx——mock 直接把同一组模型挂到两者
      const logCreate = jest.fn().mockResolvedValue({});
      const shared = {
        bidProject: { findUnique: jest.fn().mockResolvedValue({ stage: 'OPENING' }) },
        bidSupplier: {
          findFirst: jest.fn().mockResolvedValue({ id: 'bs-1', supplierName: '供应商A', supplierId: 's1', decryptStatus: 'PENDING' }),
          update: jest.fn().mockResolvedValue({ id: 'bs-1', decryptStatus: 'SUCCESS', confirmStatus: 'PENDING' }),
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
          findUnique: jest.fn().mockResolvedValue({ id: 'bs-1', decryptStatus: 'SUCCESS', confirmStatus: 'PENDING' }),
          count: jest.fn(async () => 3), // A-109a 签到 quorum 闸门默认放行
        },
        bidOpeningRecord: { findFirst: jest.fn().mockResolvedValue(null), create: jest.fn().mockResolvedValue({}), update: jest.fn() },
        bidSupervisionLog: { create: logCreate },
        bidOpeningSession: { findUnique: jest.fn().mockResolvedValue({ decryptWindowStart: new Date(Date.now() - 3600_000), decryptWindowEnd: new Date(Date.now() + 3600_000) }) },
        supplierBidSubmission: { findUnique: jest.fn().mockResolvedValue(null) },
        fileAsset: { findUnique: jest.fn() },
        auditLog: { create: jest.fn().mockResolvedValue({}) },
      };
      Object.assign(prisma, shared);
      prisma.$transaction = jest.fn(async (fn: any) => fn(prisma));

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

describe('BidDecryptService — decryptSupplier 真实校验', () => {
  it('无投标文件引用时仍返回 SUCCESS（保持开标流程）', async () => {
    const tx: any = {
      bidProject: { findUnique: jest.fn(async () => ({ stage: 'OPENING' })) },
      bidSupplier: {
        findFirst: jest.fn(async () => ({ id: 'bs1', projectId: 'p1', supplierName: 'S1', decryptStatus: 'PENDING' })),
        updateMany: jest.fn(async () => ({ count: 1 })),
        update: jest.fn(async ({ data }: any) => ({
          id: 'bs1', supplierName: 'S1',
          decryptStatus: data.decryptStatus ?? 'SUCCESS',
          confirmStatus: 'PENDING',
        })),
        findUnique: jest.fn(async () => ({ id: 'bs1', supplierName: 'S1', decryptStatus: 'SUCCESS' })),
        count: jest.fn(async () => 3), // A-109a 签到 quorum 闸门默认放行
      },
      bidOpeningRecord: { create: jest.fn() },
      bidSupervisionLog: { create: jest.fn() },
      bidOpeningSession: { findUnique: jest.fn(async () => ({ decryptWindowStart: new Date(Date.now() - 3600_000), decryptWindowEnd: new Date(Date.now() + 3600_000) })) },
      supplierBidSubmission: { findUnique: jest.fn(async () => null) },
      fileAsset: { findUnique: jest.fn() },
      auditLog: { create: jest.fn(async () => ({})) },
    };
    // P1-3 三段式：把 tx 上的模型摊到 prisma（①②段经 this.prisma 读），$transaction 仍回传 tx
    const prisma: any = { ...tx, $transaction: jest.fn(async (cb: any) => cb(tx)) };
    const module = await Test.createTestingModule({
      providers: [
        { provide: PrismaService, useValue: prisma },
        { provide: NotificationService, useValue: { create: jest.fn() } },
        BidDecryptService,
        ADMIN_KEY_SVC, DUAL_ENVELOPE_SVC,
        { provide: BidService, useValue: BID_SERVICE_STUB },
      ],
    }).compile();
    const service = module.get(BidDecryptService);

    const res = await service.decryptSupplier('p1', 'bs1');
    expect(res).not.toBeNull();
    expect(res!.decryptStatus).toBe('SUCCESS');
    expect(tx.bidSupplier.update).toHaveBeenCalled();
    expect(tx.bidSupervisionLog.create).toHaveBeenCalled();
  });
});

/* ── 评分标准编制：阶段门控 + 模板幂等 ── */


describe('BidDecryptService — acceptSupplierDanger（解密窗口到期定性，P1-1）', () => {
  let service: BidDecryptService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      bidProject: { findUnique: jest.fn() },
      bidSupplier: { findFirst: jest.fn(), update: jest.fn().mockResolvedValue({}) },
      bidOpeningSession: { findUnique: jest.fn() },
      bidSupervisionLog: { create: jest.fn().mockResolvedValue({}) },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
      $transaction: jest.fn(async (cb: any) => cb(prisma)),
    };
    const module = await Test.createTestingModule({
      providers: [
        { provide: PrismaService, useValue: prisma },
        { provide: NotificationService, useValue: { create: jest.fn() } },
        BidDecryptService,
        ADMIN_KEY_SVC, DUAL_ENVELOPE_SVC,
        { provide: BidService, useValue: BID_SERVICE_STUB },
      ],
    }).compile();
    service = module.get(BidDecryptService);
  });

  it('窗口已过期 + PENDING 未解密 → 可定性为 DANGER/EXCEPTION（前缀「解密窗口已过期未解密」）', async () => {
    prisma.bidProject.findUnique.mockResolvedValue({ stage: 'OPENING', name: '项目A' });
    prisma.bidOpeningSession.findUnique.mockResolvedValue({ decryptWindowEnd: new Date(Date.now() - 60_000) });
    prisma.bidSupplier.findFirst.mockResolvedValue({ id: 'bs1', supplierName: '甲公司', decryptStatus: 'PENDING', decryptError: null });

    const r = await service.acceptSupplierDanger('p1', 'bs1', '现场确认放弃', 'op1');
    expect(r.accepted).toBe(true);
    expect(prisma.bidSupplier.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ decryptStatus: 'DANGER', confirmStatus: 'EXCEPTION' }),
    }));
    expect(prisma.bidSupervisionLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ result: expect.stringContaining('解密窗口已过期未解密') }),
    }));
  });

  it('窗口未过期 + PENDING → 仍 400 NOT_DANGER（正常窗口内不得提前定性）', async () => {
    prisma.bidProject.findUnique.mockResolvedValue({ stage: 'OPENING', name: '项目A' });
    prisma.bidOpeningSession.findUnique.mockResolvedValue({ decryptWindowEnd: new Date(Date.now() + 600_000) });
    prisma.bidSupplier.findFirst.mockResolvedValue({ id: 'bs1', supplierName: '甲公司', decryptStatus: 'PENDING', decryptError: null });

    await expect(service.acceptSupplierDanger('p1', 'bs1', 'r', 'op1'))
      .rejects.toMatchObject({ response: { code: 'NOT_DANGER' } });
  });

  it('DANGER 状态原行为不变（窗口无关可定性）', async () => {
    prisma.bidProject.findUnique.mockResolvedValue({ stage: 'OPENING', name: '项目A' });
    prisma.bidOpeningSession.findUnique.mockResolvedValue({ decryptWindowEnd: new Date(Date.now() + 600_000) });
    prisma.bidSupplier.findFirst.mockResolvedValue({ id: 'bs1', supplierName: '甲公司', decryptStatus: 'DANGER', decryptError: '校验失败' });

    const r = await service.acceptSupplierDanger('p1', 'bs1', '接受', 'op1');
    expect(r.accepted).toBe(true);
    expect(prisma.bidSupervisionLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ result: '接受' }),
    }));
  });
});


/* ═══ Task 15：解密失败归因裁决——自 bid.service.spec「归因矩阵 + 裁决」describe 拆出（矩阵/守卫用例留守） ═══ */
describe('BidDecryptService — 解密失败归因裁决（Task 15, §5.5）', () => {
  let service: BidDecryptService;
  let prisma: any;
  let sendToUser: jest.Mock;

  const WINDOW_ENDED = new Date(Date.now() - 60_000);
  const WINDOW_OPEN = new Date(Date.now() + 600_000);

  beforeEach(async () => {
    sendToUser = jest.fn().mockResolvedValue({});
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
        BidDecryptService,
        ADMIN_KEY_SVC, DUAL_ENVELOPE_SVC,
        { provide: PrismaService, useValue: prisma },
        { provide: NotificationService, useValue: { sendToUser } },
        { provide: BidService, useValue: BID_SERVICE_STUB },
      ],
    }).compile();
    service = module.get<BidDecryptService>(BidDecryptService);
  });

  describe('adjudicateDecryptFault 裁决端点', () => {
    beforeEach(() => {
      prisma.bidProject.findUnique.mockResolvedValue({ stage: 'OPENING', name: 'P' });
      prisma.bidOpeningSession.findUnique.mockResolvedValue({ decryptWindowEnd: WINDOW_ENDED });
      prisma.bidSupplier.findMany.mockResolvedValue([]); // 裁决内惰性归因：无新增待归因家
      prisma.supplierBidSubmission.findMany.mockResolvedValue([]);
    });

    it('UNKNOWN+PENDING → 裁决 BIDDER 落终局（DANGER+EXCEPTION+归因）+ 权利告知 + 监督/审计', async () => {
      prisma.bidSupplier.findFirst.mockResolvedValue({
        id: 'bs1', supplierId: 's1', supplierName: '甲公司',
        decryptStatus: 'PENDING', confirmStatus: 'PENDING', dangerAttribution: 'UNKNOWN',
      });

      const r = await service.adjudicateDecryptFault('p1', 'bs1', 'BIDDER', '主持人现场确认供应商弃标', 'op1');
      expect(r.adjudged).toBe(true);
      expect(r.attribution).toBe('BIDDER');
      expect(prisma.bidSupplier.update).toHaveBeenCalledWith(expect.objectContaining({
        where: { id: 'bs1' },
        data: expect.objectContaining({
          decryptStatus: 'DANGER', confirmStatus: 'EXCEPTION', dangerAttribution: 'BIDDER',
          decryptError: expect.stringContaining('主持人现场确认供应商弃标'),
        }),
      }));
      expect(prisma.bidSupervisionLog.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ action: '解密失败归因裁决', result: expect.stringContaining('主持人现场确认供应商弃标') }),
      }));
      expect(prisma.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ action: 'BID_DECRYPT_ADJUDGE' }),
      }));
      expect(sendToUser).toHaveBeenCalledWith('user-s1', ['in_app'], expect.objectContaining({
        content: expect.stringContaining('因投标人原因未完成解密，视为撤销投标文件，保证金依招标文件规定处理'),
      }));
    });

    it('UNKNOWN+DANGER（双闸失败）→ 裁决 PLATFORM 仅落归因，文案含「有权要求责任方赔偿直接损失」', async () => {
      prisma.bidSupplier.findFirst.mockResolvedValue({
        id: 'bs1', supplierId: 's1', supplierName: '丁公司',
        decryptStatus: 'DANGER', confirmStatus: 'EXCEPTION', dangerAttribution: 'UNKNOWN',
      });

      const r = await service.adjudicateDecryptFault('p1', 'bs1', 'PLATFORM', '平台存储故障', 'op1');
      expect(prisma.bidSupplier.update).toHaveBeenCalledWith(expect.objectContaining({
        where: { id: 'bs1' },
        data: { dangerAttribution: 'PLATFORM' },
      }));
      expect(sendToUser).toHaveBeenCalledWith('user-s1', ['in_app'], expect.objectContaining({
        content: expect.stringContaining('因平台原因未完成解密，视为撤回投标文件，你有权要求责任方赔偿直接损失'),
      }));
      expect(r.attribution).toBe('PLATFORM');
    });

    it('RESET_PENDING：窗口开时重置 DANGER 家为 PENDING + 清零归因/错误 + 站内信', async () => {
      prisma.bidOpeningSession.findUnique.mockResolvedValue({ decryptWindowEnd: WINDOW_OPEN });
      prisma.bidSupplier.findFirst.mockResolvedValue({
        id: 'bs1', supplierId: 's1', supplierName: '丁公司',
        decryptStatus: 'DANGER', confirmStatus: 'EXCEPTION', dangerAttribution: 'UNKNOWN', decryptError: '校验失败',
      });

      const r = await service.adjudicateDecryptFault('p1', 'bs1', 'RESET_PENDING', '供应商要求重试', 'op1');
      expect(prisma.bidSupplier.update).toHaveBeenCalledWith(expect.objectContaining({
        where: { id: 'bs1' },
        data: { decryptStatus: 'PENDING', decryptError: null, dangerAttribution: null, decryptedAt: null },
      }));
      expect(prisma.bidSupervisionLog.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ action: '重置解密机会', result: expect.stringContaining('供应商要求重试') }),
      }));
      expect(prisma.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ action: 'BID_DECRYPT_ADJUDGE' }),
      }));
      expect(sendToUser).toHaveBeenCalledWith('user-s1', ['in_app'], expect.objectContaining({
        content: expect.stringContaining('开标主持人已重置您的解密机会，请重新解密'),
      }));
      expect(r.attribution).toBe('RESET_PENDING');
    });

    it('RESET_PENDING：窗口已关 → 409 DECRYPT_WINDOW_CLOSED（需先延长窗口）', async () => {
      prisma.bidOpeningSession.findUnique.mockResolvedValue({ decryptWindowEnd: WINDOW_ENDED });
      prisma.bidSupplier.findFirst.mockResolvedValue({
        id: 'bs1', supplierId: 's1', supplierName: '丁公司',
        decryptStatus: 'DANGER', confirmStatus: 'EXCEPTION', dangerAttribution: 'UNKNOWN',
      });

      await expect(service.adjudicateDecryptFault('p1', 'bs1', 'RESET_PENDING', '重试', 'op1'))
        .rejects.toMatchObject({ response: { code: 'DECRYPT_WINDOW_CLOSED' } });
      expect(prisma.bidSupplier.update).not.toHaveBeenCalled();
      expect(sendToUser).not.toHaveBeenCalled();
    });

    it('BIDDER→PLATFORM 改判（纠错通道）：已归因 BIDDER 的 DANGER 家改判为撤回 + 改判日志 + 赔偿请求权通知', async () => {
      prisma.bidSupplier.findFirst.mockResolvedValue({
        id: 'bs1', supplierId: 's1', supplierName: '甲公司',
        decryptStatus: 'DANGER', confirmStatus: 'EXCEPTION', dangerAttribution: 'BIDDER',
      });

      const r = await service.adjudicateDecryptFault('p1', 'bs1', 'PLATFORM', '平台密钥分发故障复查', 'op1');
      expect(r.attribution).toBe('PLATFORM');
      expect(prisma.bidSupplier.update).toHaveBeenCalledWith(expect.objectContaining({
        where: { id: 'bs1' },
        data: {
          dangerAttribution: 'PLATFORM',
          // Task 15 顺带 Minor：改判时同步改写 decryptError，消除与归因字段矛盾的「投标人过错」残留文案
          decryptError: '归因改判（PLATFORM）：平台密钥分发故障复查',
        },
      }));
      expect(prisma.bidSupervisionLog.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({
          action: '解密失败归因裁决',
          result: expect.stringContaining('改判'),
        }),
      }));
      expect(prisma.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({
          action: 'BID_DECRYPT_ADJUDGE',
          details: expect.objectContaining({ rejudgedFrom: 'BIDDER' }),
        }),
      }));
      expect(sendToUser).toHaveBeenCalledWith('user-s1', ['in_app'], expect.objectContaining({
        content: expect.stringContaining('因平台原因未完成解密，视为撤回投标文件，你有权要求责任方赔偿直接损失'),
      }));
    });

    it('BIDDER→RESET_PENDING 拒绝 → 400 NOT_RESETTABLE（视为撤销不可逆）', async () => {
      prisma.bidOpeningSession.findUnique.mockResolvedValue({ decryptWindowEnd: WINDOW_OPEN });
      prisma.bidSupplier.findFirst.mockResolvedValue({
        id: 'bs1', supplierId: 's1', supplierName: '甲公司',
        decryptStatus: 'DANGER', confirmStatus: 'EXCEPTION', dangerAttribution: 'BIDDER',
      });

      await expect(service.adjudicateDecryptFault('p1', 'bs1', 'RESET_PENDING', '重试', 'op1'))
        .rejects.toMatchObject({ response: { code: 'NOT_RESETTABLE' } });
      expect(prisma.bidSupplier.update).not.toHaveBeenCalled();
      expect(sendToUser).not.toHaveBeenCalled();
    });

    it('RESET_PENDING：PENDING+UNKNOWN 家窗口开时重置成功 + 站内信', async () => {
      prisma.bidOpeningSession.findUnique.mockResolvedValue({ decryptWindowEnd: WINDOW_OPEN });
      prisma.bidSupplier.findFirst.mockResolvedValue({
        id: 'bs1', supplierId: 's1', supplierName: '戊公司',
        decryptStatus: 'PENDING', confirmStatus: 'PENDING', dangerAttribution: 'UNKNOWN',
      });

      const r = await service.adjudicateDecryptFault('p1', 'bs1', 'RESET_PENDING', '延长窗口后允许重试', 'op1');
      expect(prisma.bidSupplier.update).toHaveBeenCalledWith(expect.objectContaining({
        where: { id: 'bs1' },
        data: { decryptStatus: 'PENDING', decryptError: null, dangerAttribution: null, decryptedAt: null },
      }));
      expect(sendToUser).toHaveBeenCalledWith('user-s1', ['in_app'], expect.objectContaining({
        content: expect.stringContaining('开标主持人已重置您的解密机会，请重新解密'),
      }));
      expect(r.attribution).toBe('RESET_PENDING');
    });

    it('已归因 BIDDER 家同向重复裁决 → 400 NOT_UNKNOWN', async () => {
      prisma.bidSupplier.findFirst.mockResolvedValue({
        id: 'bs1', supplierId: 's1', supplierName: '甲公司',
        decryptStatus: 'DANGER', confirmStatus: 'EXCEPTION', dangerAttribution: 'BIDDER',
      });

      await expect(service.adjudicateDecryptFault('p1', 'bs1', 'BIDDER', '重复裁决', 'op1'))
        .rejects.toMatchObject({ response: { code: 'NOT_UNKNOWN' } });
      expect(sendToUser).not.toHaveBeenCalled();
    });

    it('reason 空白 → 400 REASON_REQUIRED', async () => {
      await expect(service.adjudicateDecryptFault('p1', 'bs1', 'BIDDER', '   ', 'op1'))
        .rejects.toMatchObject({ response: { code: 'REASON_REQUIRED' } });
    });
  });
});


/* ═══════════════════════════════════════════════════════════════════
   Task 12：decryptOuter —— 主持端解外层 + innerAssets 归属链
   真实双层加密样本（Task 8 spec buildDualLayerSample 同款生产语义）：
     M → C_inner = SM4(DEK_S, M) → C_outer = SM4(DEK_A, C_inner)
     kadmin = SM2_Enc(管理方加密证书公钥, DEK_A)
   解外层走真实 DualEnvelopeService.decryptOuterFile；唯一 mock：Prisma/MinIO/私钥读取。
   ═══════════════════════════════════════════════════════════════════ */

interface Dek { keyHex: string; ivHex: string }
interface DualLayerSample { cInner: Buffer; cOuter: Buffer; kself: string; kadmin: string }

/** 生产侧双层加密样本构造（加密 helper 全部复用 @water-erp/ukey 生产函数，非被测服务自身） */
function buildDualLayerSample(adminPub: string, supplierPub: string, plaintext: Buffer): DualLayerSample {
  const dekA: Dek = { keyHex: randomHex(16), ivHex: randomHex(16) };
  const dekS: Dek = { keyHex: randomHex(16), ivHex: randomHex(16) };
  const cInnerHex = sm4Encrypt(dekS.keyHex, dekS.ivHex, plaintext.toString('hex')); // C_inner = SM4(DEK_S, M)
  const cOuterHex = sm4Encrypt(dekA.keyHex, dekA.ivHex, cInnerHex); // C_outer = SM4(DEK_A, C_inner)
  return {
    cInner: Buffer.from(cInnerHex, 'hex'),
    cOuter: Buffer.from(cOuterHex, 'hex'),
    kself: sm2EncryptHex(supplierPub, Buffer.from(wrapDekJson(dekS), 'utf8').toString('hex')),
    kadmin: sm2EncryptHex(adminPub, Buffer.from(wrapDekJson(dekA), 'utf8').toString('hex')),
  };
}

describe('BidDecryptService — decryptOuter 主持端解外层 (dual-v2 · Task 12)', () => {
  // 固定夹具：真实 SM2 密钥对 + 双角色真实双层加密样本
  const adminKp = sm2.generateKeyPairHex();
  const supplierKp = sm2.generateKeyPairHex();
  const plainT = Buffer.from('引大济岷-技术标投标文件', 'utf8');
  const plainB = Buffer.from('引大济岷-商务标投标文件', 'utf8');
  const sampleT = buildDualLayerSample(adminKp.publicKey, supplierKp.publicKey, plainT);
  const sampleB = buildDualLayerSample(adminKp.publicKey, supplierKp.publicKey, plainB);
  const ADMIN_CERT_ID = 'cert-admin-1';

  let service: BidDecryptService;
  let prisma: any;
  let envelope: DualEnvelope;
  let adminKeyMock: { readPrivateKey: jest.Mock };

  beforeEach(async () => {
    envelope = {
      version: 'dual-v2',
      certSn: 'MOCK-CERT-8801',
      adminCertId: ADMIN_CERT_ID,
      files: {
        technical: { sha256: await sha256Hex(plainT), kself: sampleT.kself, kadmin: sampleT.kadmin },
        business: { sha256: await sha256Hex(plainB), kself: sampleB.kself, kadmin: sampleB.kadmin },
      },
      sealedFields: { cipher: '00', kself: '01', fieldsSha256: '02' },
      fieldsCommit: '03',
    };

    prisma = {
      bidProject: { findUnique: jest.fn().mockResolvedValue({ stage: 'OPENING', name: '引大济岷' }) },
      bidOpeningSession: {
        findUnique: jest.fn().mockResolvedValue({
          pausedAt: null,
          decryptWindowStart: new Date(Date.now() - 3600_000),
          decryptWindowEnd: new Date(Date.now() + 3600_000),
        }),
      },
      bidSupplier: {
        findFirst: jest.fn().mockResolvedValue({ id: 'bs-1', projectId: 'p1', supplierId: 's1', supplierName: '四川水发建设有限公司' }),
        count: jest.fn().mockResolvedValue(3), // A-109a 签到 quorum 闸门默认放行
      },
      supplierBidSubmission: {
        findMany: jest.fn(),
        findUnique: jest.fn().mockResolvedValue({
          id: 'sub-1', supplierId: 's1', projectId: 'p1',
          envelopeVersion: 'dual-v2', envelope,
          outerDecryptedAt: null,
          technicalFileAssetId: 'fa-t', businessFileAssetId: 'fa-b',
          coverLetterAssetId: null, bidBondAssetId: null,
        }),
        update: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }), // ① 原子抢占默认抢到
      },
      fileAsset: {
        // technical：T10 补传后 sealedPath 指新 C_outer（读密文口径 sealedPath || key）
        findUnique: jest.fn().mockImplementation(async ({ where }: any) => where.id === 'fa-t'
          ? { id: 'fa-t', key: 'uploads/technical.enc', sealedPath: 'dual-reupload/p1/s1/technical-1.enc', sha256: 'sha-t' }
          : { id: 'fa-b', key: 'uploads/business.enc', sealedPath: null, sha256: 'sha-b' }),
        create: jest.fn().mockResolvedValueOnce({ id: 'asset-t' }).mockResolvedValueOnce({ id: 'asset-b' }),
      },
      bidSupervisionLog: { create: jest.fn().mockResolvedValue({}) },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
      $transaction: jest.fn(async (cb: any) => cb(prisma)),
    };

    (minioClient.getObject as jest.Mock).mockReset().mockResolvedValue({});
    (minioClient.putObject as jest.Mock).mockReset().mockResolvedValue({});
    (streamToBuffer as jest.Mock).mockReset()
      .mockResolvedValueOnce(sampleT.cOuter)
      .mockResolvedValueOnce(sampleB.cOuter);

    adminKeyMock = {
      readPrivateKey: jest.fn().mockResolvedValue(adminKp.privateKey),
    };

    const module = await Test.createTestingModule({
      providers: [
        BidDecryptService,
        DualEnvelopeService, // 真实 decryptOuterFile（真实双层解密路径）
        SignatureService, // DualEnvelopeService 依赖（无构造依赖的真实实现）
        { provide: AdminKeyService, useValue: adminKeyMock },
        { provide: PrismaService, useValue: prisma },
        { provide: NotificationService, useValue: { sendToRole: jest.fn() } },
        { provide: BidService, useValue: BID_SERVICE_STUB },
      ],
    }).compile();
    service = module.get(BidDecryptService);
  });

  it('解密窗口未开启 → 400 DECRYPT_WINDOW_NOT_OPEN（门控同 decryptSupplier）', async () => {
    prisma.bidOpeningSession.findUnique.mockResolvedValue({
      pausedAt: null,
      decryptWindowStart: new Date(Date.now() + 3600_000),
      decryptWindowEnd: new Date(Date.now() + 7200_000),
    });

    await expect(service.decryptOuter('p1', 'bs-1', 'u1')).rejects.toMatchObject({
      response: { code: 'DECRYPT_WINDOW_NOT_OPEN' },
    });
    expect(minioClient.getObject).not.toHaveBeenCalled();
  });

  it('单家成功：innerAssets 全角色 + outerDecryptedAt + 监督日志 + C_inner 归属资产（clientEncrypted:false）', async () => {
    const result: any = await service.decryptOuter('p1', 'bs-1', 'u1');

    expect(result).toMatchObject({
      supplierId: 'bs-1', supplierName: '四川水发建设有限公司', success: true,
      roles: ['technical', 'business'],
    });
    expect(result.innerAssets).toEqual({ technical: 'asset-t', business: 'asset-b' });

    // 读密文口径：sealedPath 优先（technical 补传后），无 sealedPath 回退 key（business）
    expect(minioClient.getObject).toHaveBeenNthCalledWith(1, MINIO_BUCKET, 'dual-reupload/p1/s1/technical-1.enc');
    expect(minioClient.getObject).toHaveBeenNthCalledWith(2, MINIO_BUCKET, 'uploads/business.enc');
    // C_inner 逐角色写 MinIO（内容=真实 SM4(DEK_S, M) 密文）
    expect(minioClient.putObject).toHaveBeenNthCalledWith(
      1, MINIO_BUCKET, 'bid-inner/p1/bs-1/technical.inner', sampleT.cInner, sampleT.cInner.length,
      { 'Content-Type': 'application/octet-stream' },
    );
    expect(minioClient.putObject).toHaveBeenNthCalledWith(
      2, MINIO_BUCKET, 'bid-inner/p1/bs-1/business.inner', sampleB.cInner, sampleB.cInner.length,
      { 'Content-Type': 'application/octet-stream' },
    );

    expect(prisma.fileAsset.create).toHaveBeenNthCalledWith(1, {
      data: expect.objectContaining({
        key: 'bid-inner/p1/bs-1/technical.inner',
        category: 'bid_inner_ciphertext',
        clientEncrypted: false, // 服务端写入的中间密文（非客户端直传产物）——Task 12 契约钉死
        encrypted: true,
        uploaderId: 'u1',
        sha256: await sha256Hex(sampleT.cInner),
      }),
    });
    expect(prisma.fileAsset.create).toHaveBeenNthCalledWith(2, {
      data: expect.objectContaining({
        key: 'bid-inner/p1/bs-1/business.inner',
        sha256: await sha256Hex(sampleB.cInner),
      }),
    });

    // ① 原子抢占：outerDecryptedAt 由抢占写入；终局 update 只补 innerAssets
    expect(prisma.supplierBidSubmission.updateMany).toHaveBeenCalledWith({
      where: { supplierId: 's1', projectId: 'p1', outerDecryptedAt: null },
      data: { outerDecryptedAt: expect.any(Date) },
    });
    expect(prisma.supplierBidSubmission.update).toHaveBeenCalledWith({
      where: { supplierId_projectId: { supplierId: 's1', projectId: 'p1' } },
      data: { innerAssets: { technical: 'asset-t', business: 'asset-b' } },
    });
    expect(prisma.bidSupervisionLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ action: '管理方解外层', result: expect.stringContaining('2') }),
    });
    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ userId: 'u1', action: 'BID_DECRYPT_OUTER', resourceType: 'BidSupplier:bs-1' }),
    });
  });

  it('批量：预筛后逐家串行；已解外层者幂等 skipped、不重复写 MinIO', async () => {
    // 预筛命中 s1（TOCTOU：预筛时 outerDecryptedAt=null，处理时已被并发对手置位 → skipped）
    prisma.supplierBidSubmission.findMany.mockResolvedValue([{ supplierId: 's1' }]);
    prisma.bidSupplier.findFirst.mockImplementation(async () => ({ id: 'bs-1', supplierId: 's1', supplierName: 'S1' }));
    prisma.supplierBidSubmission.findUnique.mockResolvedValue({
      envelopeVersion: 'dual-v2', envelope, outerDecryptedAt: new Date('2026-08-20T10:00:00Z'),
    });

    const result: any = await service.decryptOuter('p1', undefined, 'u1');

    expect(result).toMatchObject({ total: 1, success: 0, skipped: 1, failed: 0 });
    expect(result.details[0]).toMatchObject({ supplierId: 'bs-1', skipped: true });
    expect(minioClient.getObject).not.toHaveBeenCalled();
    expect(minioClient.putObject).not.toHaveBeenCalled();
    expect(prisma.fileAsset.create).not.toHaveBeenCalled();
    expect(prisma.supplierBidSubmission.update).not.toHaveBeenCalled();
    expect(prisma.supplierBidSubmission.updateMany).not.toHaveBeenCalled(); // 快路径跳过，无抢占
  });

  it('并发双击：原子抢占第二笔 count=0 → skipped、不重复写 MinIO/FileAsset/日志', async () => {
    prisma.supplierBidSubmission.updateMany.mockResolvedValueOnce({ count: 0 });

    const result: any = await service.decryptOuter('p1', 'bs-1', 'u1');

    expect(result).toMatchObject({ supplierId: 'bs-1', skipped: true });
    expect(minioClient.getObject).not.toHaveBeenCalled();
    expect(minioClient.putObject).not.toHaveBeenCalled();
    expect(prisma.fileAsset.create).not.toHaveBeenCalled();
    expect(prisma.bidSupervisionLog.create).not.toHaveBeenCalled();
    expect(prisma.supplierBidSubmission.update).not.toHaveBeenCalled();
  });

  it('解外层失败 → 回滚抢占（outerDecryptedAt 复原 null，可直接重试无需供应商补传）', async () => {
    adminKeyMock.readPrivateKey.mockResolvedValue(sm2.generateKeyPairHex().privateKey); // 错私钥

    await expect(service.decryptOuter('p1', 'bs-1', 'u1')).rejects.toMatchObject({
      response: { code: 'OUTER_DECRYPT_FAILED' },
    });
    const calls = prisma.supplierBidSubmission.updateMany.mock.calls;
    expect(calls).toHaveLength(2);
    expect(calls[0][0]).toMatchObject({ data: { outerDecryptedAt: expect.any(Date) } }); // ① 抢占
    expect(calls[1][0]).toMatchObject({
      where: expect.objectContaining({ outerDecryptedAt: expect.any(Date) }), // 条件更新：只回滚自己这笔
      data: { outerDecryptedAt: null }, // 失败回滚
    });
  });

  it('批量预筛楔感知：陈旧楔家进入候选 → 经接管解密成功、明细含该家（success）', async () => {
    const staleAt = new Date(Date.now() - 120_000);
    prisma.supplierBidSubmission.findMany.mockResolvedValue([{ supplierId: 's1' }]); // 预筛命中楔家
    prisma.bidSupplier.findFirst.mockImplementation(async () => ({ id: 'bs-1', supplierId: 's1', supplierName: 'S1' }));
    prisma.supplierBidSubmission.findUnique.mockResolvedValue({
      id: 'sub-1', supplierId: 's1', projectId: 'p1',
      envelopeVersion: 'dual-v2', envelope,
      outerDecryptedAt: staleAt, innerAssets: null,
      technicalFileAssetId: 'fa-t', businessFileAssetId: 'fa-b',
      coverLetterAssetId: null, bidBondAssetId: null,
      updatedAt: new Date(Date.now() - 120_000),
    });
    prisma.supplierBidSubmission.updateMany
      .mockResolvedValueOnce({ count: 0 }) // ① 抢占：楔残留
      .mockResolvedValueOnce({ count: 1 }); // 接管重占成功

    const result: any = await service.decryptOuter('p1', undefined, 'u1');

    // 预筛 where 钉死楔感知 OR（outerDecryptedAt null 或 陈旧楔：innerAssets null + updatedAt 停摆 >60s）
    expect(prisma.supplierBidSubmission.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        envelopeVersion: 'dual-v2',
        OR: expect.arrayContaining([
          expect.objectContaining({ outerDecryptedAt: null }),
          expect.objectContaining({ innerAssets: { equals: Prisma.DbNull }, updatedAt: { lt: expect.any(Date) } }),
        ]),
      }),
    }));
    expect(result).toMatchObject({ total: 1, success: 1, skipped: 0, failed: 0 });
    expect(result.details[0]).toMatchObject({
      supplierId: 'bs-1', success: true, roles: ['technical', 'business'],
      innerAssets: { technical: 'asset-t', business: 'asset-b' },
    });
    expect(minioClient.putObject).toHaveBeenCalledTimes(2); // 接管后正常完成两角色解密
  });

  it('陈旧楔接管（60s）：outerDecryptedAt 残留 + innerAssets null + updatedAt 停摆 → 条件重占成功并完成解密', async () => {
    const staleAt = new Date(Date.now() - 120_000);
    prisma.supplierBidSubmission.findUnique.mockResolvedValue({
      id: 'sub-1', supplierId: 's1', projectId: 'p1',
      envelopeVersion: 'dual-v2', envelope,
      outerDecryptedAt: staleAt, innerAssets: null,
      technicalFileAssetId: 'fa-t', businessFileAssetId: 'fa-b',
      coverLetterAssetId: null, bidBondAssetId: null,
      updatedAt: new Date(Date.now() - 120_000),
    });
    prisma.supplierBidSubmission.updateMany
      .mockResolvedValueOnce({ count: 0 }) // ① 抢占：outerDecryptedAt 已有（楔残留）
      .mockResolvedValueOnce({ count: 1 }); // 接管重占成功

    const result: any = await service.decryptOuter('p1', 'bs-1', 'u1');

    expect(result).toMatchObject({ supplierId: 'bs-1', success: true, roles: ['technical', 'business'] });
    const updateManyCalls = prisma.supplierBidSubmission.updateMany.mock.calls;
    expect(updateManyCalls).toHaveLength(2);
    expect(updateManyCalls[0][0]).toMatchObject({ data: { outerDecryptedAt: expect.any(Date) } }); // ① 抢占失败
    expect(updateManyCalls[1][0]).toMatchObject({
      where: expect.objectContaining({
        outerDecryptedAt: staleAt, // 只重占这份陈旧标记
        updatedAt: { lt: expect.any(Date) },
      }),
      data: { outerDecryptedAt: expect.any(Date) }, // 重占写新 claimAt
    });
    expect(minioClient.putObject).toHaveBeenCalledTimes(2); // 接管后正常完成两角色解密
    expect(prisma.supplierBidSubmission.update).toHaveBeenCalledWith(expect.objectContaining({
      data: { innerAssets: { technical: 'asset-t', business: 'asset-b' } },
    }));
  });

  it('旧轨项目（envelopeVersion 非 dual-v2）→ 400 NOT_DUAL_TRACK', async () => {
    prisma.supplierBidSubmission.findUnique.mockResolvedValue({ envelopeVersion: null, outerDecryptedAt: null });

    await expect(service.decryptOuter('p1', 'bs-1', 'u1')).rejects.toMatchObject({
      response: { code: 'NOT_DUAL_TRACK' },
    });
    expect(minioClient.getObject).not.toHaveBeenCalled();
  });

  it('批量：某家外层解密失败（错私钥）→ 该家 failed、不阻塞其余家', async () => {
    prisma.supplierBidSubmission.findMany.mockResolvedValue([{ supplierId: 's1' }, { supplierId: 's2' }]);
    const bs: Record<string, any> = {
      'bs-1': { id: 'bs-1', supplierId: 's1', supplierName: 'S1' },
      'bs-2': { id: 'bs-2', supplierId: 's2', supplierName: 'S2' },
    };
    prisma.bidSupplier.findFirst.mockImplementation(async ({ where }: any) => (where.id ? bs[where.id] : bs[`bs-${where.supplierId === 's1' ? 1 : 2}`]));
    prisma.supplierBidSubmission.findUnique.mockImplementation(async ({ where }: any) => ({
      id: `sub-${where.supplierId_projectId.supplierId}`, supplierId: where.supplierId_projectId.supplierId, projectId: 'p1',
      envelopeVersion: 'dual-v2', envelope, outerDecryptedAt: null,
      technicalFileAssetId: 'fa-t', businessFileAssetId: 'fa-b',
      coverLetterAssetId: null, bidBondAssetId: null,
    }));
    // 第一次 readPrivateKey 返回正确私钥（s1 成功）；第二次返回错私钥（s2 解 K_admin 失败）
    adminKeyMock.readPrivateKey
      .mockResolvedValueOnce(adminKp.privateKey)
      .mockResolvedValueOnce(sm2.generateKeyPairHex().privateKey);
    (streamToBuffer as jest.Mock).mockReset()
      .mockResolvedValueOnce(sampleT.cOuter)  // s1 technical
      .mockResolvedValueOnce(sampleB.cOuter)  // s1 business
      .mockResolvedValueOnce(sampleT.cOuter); // s2 technical（随后解密失败，不再读）
    prisma.fileAsset.create.mockReset()
      .mockResolvedValueOnce({ id: 'asset-t' })
      .mockResolvedValueOnce({ id: 'asset-b' });

    const result: any = await service.decryptOuter('p1', undefined, 'u1');

    expect(result).toMatchObject({ total: 2, success: 1, failed: 1 });
    expect(result.details[0]).toMatchObject({
      supplierId: 'bs-1', success: true, innerAssets: { technical: 'asset-t', business: 'asset-b' },
    });
    expect(result.details[1]).toMatchObject({ supplierId: 'bs-2', success: false, code: 'OUTER_DECRYPT_FAILED' });
    expect(result.details[1].error).toContain('外层解密失败');
    expect(prisma.fileAsset.create).toHaveBeenCalledTimes(2); // 仅成功家落库
    expect(minioClient.putObject).toHaveBeenCalledTimes(2);   // s2 在写 MinIO 前即失败——无孤儿 C_inner
  });
});

/* ── P1-2：自 bid.service.spec「P1-2/P1-4 旧轨解密归因与时间修改留痕」describe 拆出（P1-4 留守） ── */
describe('P1-2 — 旧轨解密失败归因（decryptSupplier 落 dangerAttribution=PLATFORM）', () => {
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
    const { BidDecryptService } = await import('./bid-decrypt.service');
    const instance: any = Object.create(BidDecryptService.prototype);
    instance.prisma = prisma;
    instance.gateway = undefined;
    instance.notificationService = { sendToUser: jest.fn().mockResolvedValue({}) };
    instance.logger = { warn: jest.fn(), log: jest.fn(), error: jest.fn() };
    instance.notifySupplierDecryptFailure = jest.fn();
    instance.bidService = { autoHandoverIfDone: jest.fn() }; // F1d：decryptSupplier 终局跨域回调（void，空桩即可）
    svc = instance;
  });

  it('P1-2：旧轨解密失败落 dangerAttribution=PLATFORM（主持人代解密失败=平台侧）', async () => {
    prisma.bidSupplier.findFirst.mockResolvedValue({ id: 'bs1', supplierName: '甲', decryptStatus: 'PENDING' });
    prisma.bidProject.findUnique.mockResolvedValue({ stage: 'OPENING' });
    prisma.bidOpeningSession.findUnique.mockResolvedValue({
      decryptWindowStart: new Date(Date.now() - 60_000), decryptWindowEnd: new Date(Date.now() + 60_000), pausedAt: null,
    });
    prisma.bidSupplier.updateMany.mockResolvedValue({ count: 1 });
    prisma.supplierBidSubmission.findUnique.mockResolvedValue(null); // 无文件 → DANGER

    await svc.decryptSupplier('p1', 'bs1', undefined, 'u-host');

    const updateCalls = tx.bidSupplier.update.mock.calls;
    expect(updateCalls.length).toBeGreaterThan(0);
    expect(updateCalls[0][0].data).toEqual(expect.objectContaining({
      decryptStatus: 'DANGER', confirmStatus: 'EXCEPTION', dangerAttribution: 'PLATFORM',
    }));
  });
});
