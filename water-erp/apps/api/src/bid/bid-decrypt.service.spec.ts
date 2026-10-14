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
    // Task10（dual-v3）：预筛放宽为 dual-v2|dual-v3 双轨
    expect(prisma.supplierBidSubmission.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        envelopeVersion: { in: ['dual-v2', 'dual-v3'] },
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
