// apps/api/src/ai-bid-analysis/services/plaintext-fetcher.service.spec.ts
// C12 (7.2): 解密双格式测试 — wrappedKey + legacy hex 路径
import { Test, TestingModule } from '@nestjs/testing';
import { PlaintextFetcherService } from './plaintext-fetcher.service';
import { PrismaService } from '../../prisma/prisma.service';

// mock 依赖模块，避免真实 MinIO / Prisma 连接
jest.mock('../../upload/minio.client', () => ({
  minioClient: { getObject: jest.fn() },
  MINIO_BUCKET: 'test-bucket',
}));
jest.mock('../../bid/bid-submission.crypto', () => ({
  decryptBuffer: jest.fn((buf: Buffer) => buf),
  streamToBuffer: jest.fn(async () => Buffer.from('plaintext')),
  verifyIntegrity: jest.fn(() => true),
}));
jest.mock('../../common/crypto/envelope-crypto', () => ({
  unwrapKey: jest.fn((blob: string) => `mock-hex:${blob}:mockiv:mocktag`),
  isWrappedKey: jest.fn((value: string | null | undefined) => {
    if (!value) return false;
    // base64-like (has A-Za-z + / =) → wrapped; hex-only → legacy
    return /^[A-Za-z0-9+/=]+$/.test(value) && !/^[0-9a-f:]+$/.test(value);
  }),
}));

const { decryptBuffer, streamToBuffer } = require('../../bid/bid-submission.crypto');
const { unwrapKey, isWrappedKey } = require('../../common/crypto/envelope-crypto');

describe('PlaintextFetcherService — 解密双格式测试 (C12)', () => {
  let service: PlaintextFetcherService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      bidSupplier: { findUnique: jest.fn() },
      supplierBidSubmission: { findUnique: jest.fn() },
      fileAsset: { findUnique: jest.fn() },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PlaintextFetcherService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get(PlaintextFetcherService);
    jest.clearAllMocks();
  });

  const setupMocks = (sealedKey: string | null) => {
    prisma.bidSupplier.findUnique.mockResolvedValue({
      supplierId: 'supplier-1',
      projectId: 'project-1',
    });
    prisma.supplierBidSubmission.findUnique.mockResolvedValue({
      technicalFileAssetId: 'asset-1',
      technicalSealedKey: sealedKey,
      businessFileAssetId: 'asset-2',
      businessSealedKey: sealedKey,
      coverLetterAssetId: 'asset-3',
      coverLetterSealedKey: sealedKey,
    });
    prisma.fileAsset.findUnique.mockResolvedValue({
      id: 'asset-1',
      key: 'uploads/file.pdf',
      sha256: 'abc123',
      sealedPath: null,
    });
  };

  // Task 4: 返回 { buffer, fileId } 形状验证
  describe('返回 { buffer, fileId }（Task 4）', () => {
    it('fetchBidderPlaintext 返回 { buffer, fileId }', async () => {
      setupMocks(null); // assetId 由 setupMocks 写入 submission.technicalFileAssetId='asset-1'

      const out = await service.fetchBidderPlaintext('bs-1', 'technical');

      expect(out).not.toBeNull();
      expect(out!.fileId).toBe('asset-1');
      expect(Buffer.isBuffer(out!.buffer)).toBe(true);
    });
  });

  describe('wrappedKey 路径（envelope encryption）', () => {
    it('sealedKey 为 base64 格式时走 unwrapKey → decryptBuffer', async () => {
      const wrappedKey = 'aGVsbG8gd29ybGQgdGhpcw=='; // "hello world this" in base64
      setupMocks(wrappedKey);

      const out = await service.fetchBidderPlaintext('bs-1', 'technical');

      expect(isWrappedKey).toHaveBeenCalledWith(wrappedKey);
      expect(unwrapKey).toHaveBeenCalled();
      expect(decryptBuffer).toHaveBeenCalled();
      expect(Buffer.isBuffer(out!.buffer)).toBe(true);
      expect(out!.fileId).toBe('asset-1');
    });
  });

  describe('legacy hex 路径（旧格式 DEK）', () => {
    it('sealedKey 为 hex:hex:hex 格式时直接用原值解密', async () => {
      const legacyKey = 'a1b2c3d4e5f6:010203040506:ffeeddccbbaa';
      setupMocks(legacyKey);

      const out = await service.fetchBidderPlaintext('bs-1', 'technical');

      expect(isWrappedKey).toHaveBeenCalledWith(legacyKey);
      expect(unwrapKey).not.toHaveBeenCalled();
      expect(out!.fileId).toBe('asset-1');
    });
  });

  describe('sealedKey 为空（存量明文）', () => {
    it('sealedKey 为 null 时跳过解密，直接返回明文', async () => {
      setupMocks(null);

      const out = await service.fetchBidderPlaintext('bs-1', 'technical');

      // sealedKey 为 null 时，代码不会进入解密分支，isWrappedKey 不会被调用
      expect(unwrapKey).not.toHaveBeenCalled();
      expect(decryptBuffer).not.toHaveBeenCalled();
      expect(out).not.toBeNull();
      expect(Buffer.isBuffer(out!.buffer)).toBe(true);
      expect(out!.fileId).toBe('asset-1');
    });
  });

  describe('双信封新轨（dual-v2/v3）：decryptedAssets 明文直读', () => {
    const setupDual = (envelopeVersion: 'dual-v2' | 'dual-v3') => {
      prisma.bidSupplier.findUnique.mockResolvedValue({
        supplierId: 'supplier-1',
        projectId: 'project-1',
      });
      prisma.supplierBidSubmission.findUnique.mockResolvedValue({
        envelopeVersion,
        technicalFileAssetId: null, businessFileAssetId: null, coverLetterAssetId: null,
        technicalSealedKey: 'a1b2c3d4e5f6:010203040506:ffeeddccbbaa', // 新轨应忽略旧轨 sealedKey（防误走 AES/KMS 通道）
        decryptedAssets: { technical: 'fa-dec-t' },
      });
      prisma.fileAsset.findUnique.mockResolvedValue({
        id: 'fa-dec-t',
        key: 'bid-decrypted/project-1/bs-1/technical.plain',
        sha256: 'abc123',
        sealedPath: null,
      });
    };

    // dual-v3 旧轨三列为 null——漏判新轨版本会 throw「缺少 technical 文件引用」（2026-10-19 专家标书获取事故同根）
    it.each(['dual-v2', 'dual-v3'])('%s：assetId 取 decryptedAssets[which]，sealedKey 置空不走 KMS/AES', async (v) => {
      setupDual(v as 'dual-v2' | 'dual-v3');

      const out = await service.fetchBidderPlaintext('bs-1', 'technical');

      expect(out!.fileId).toBe('fa-dec-t');
      expect(prisma.fileAsset.findUnique).toHaveBeenCalledWith({ where: { id: 'fa-dec-t' } });
      expect(unwrapKey).not.toHaveBeenCalled();
      expect(decryptBuffer).not.toHaveBeenCalled();
    });
  });

  describe('fetchTenderPlaintext — 谈判采购配置轨（2026-10-20：谈判项目无 BID_NOTICE 公告，采购文件经 Redis negotiation-config 交付，公告轨 miss 回退）', () => {
    let redis: { get: jest.Mock };
    const fs = require('fs');
    const { minioClient } = require('../../upload/minio.client');

    const negoCfg = {
      projectId: 'project-1',
      refFileKeys: ['pm/tender-file.docx'],
      attachFileIds: ['fa-invite-1'],
    };

    beforeEach(() => {
      prisma.bidProject = { findUnique: jest.fn().mockResolvedValue({ projectCode: 'SWHI-TP-1' }) };
      prisma.announcement = { findFirst: jest.fn().mockResolvedValue(null) }; // 公告轨 miss
      prisma.attachment = { findMany: jest.fn().mockResolvedValue([]) };
      prisma.fileAsset.findMany = jest.fn().mockResolvedValue([]);
      prisma.bidDocument = { findFirst: jest.fn(), findUnique: jest.fn() };
      redis = { get: jest.fn().mockResolvedValue(JSON.stringify(negoCfg)) };
      (service as any).redis = redis;
    });

    afterEach(() => {
      (service as any).redis = undefined;
      jest.restoreAllMocks();
    });

    it('公告轨 miss + 谈判配置在 → Attachment 主轨本地磁盘读取，返回 { buffer, fileName }', async () => {
      prisma.attachment.findMany.mockResolvedValue([
        { id: 'att-1', fileName: '谈判采购文件.docx', objectKey: 'pm/tender-file.docx' },
      ]);
      const buf = Buffer.from('negotiation tender docx');
      jest.spyOn(fs.promises, 'readFile').mockResolvedValue(buf);

      const out = await service.fetchTenderPlaintext('project-1');

      expect(out).toEqual({ buffer: buf, fileName: '谈判采购文件.docx' });
      expect(fs.promises.readFile).toHaveBeenCalledWith(
        expect.stringContaining('uploads/pm/tender-file.docx'),
      );
    });

    it('Attachment 轨空 → 回退 FileAsset 兼容轨（attachFileIds），sealedPath/sealedKey 资产解封后返回', async () => {
      prisma.fileAsset.findMany.mockImplementation(async (args: any) => {
        const where = args?.where ?? {};
        // 兼容轨查询形状：ids 非空时 OR[{id in},{key in}]，否则 {key in}
        if (where.OR || where.id) {
          return [{
            id: 'fa-invite-1', originalName: '采购邀请书.docx',
            key: 'general/invitation/x.docx', sealedPath: 'sealed/invitation/x.enc',
            sealedKey: 'aGVsbG8gd29ybGQgdGhpcw==', clientEncrypted: false, sha256: 'abc123',
          }];
        }
        return [];
      });
      // negotiation FileAsset 不走 BidDocument.decryptKey 解密轨——sealedKey 资产走资产自持密钥解封
      (streamToBuffer as jest.Mock).mockResolvedValueOnce(Buffer.from('sealed ciphertext'));

      const out = await service.fetchTenderPlaintext('project-1');

      expect(out!.fileName).toBe('采购邀请书.docx');
      expect(minioClient.getObject).toHaveBeenCalledWith('test-bucket', 'sealed/invitation/x.enc');
      expect(decryptBuffer).toHaveBeenCalled(); // 资产密封解封（与 /upload streamFile 同口径）
    });

    it('无谈判配置且公告轨 miss → null（空态行为不变）', async () => {
      redis.get.mockResolvedValue(null);

      const out = await service.fetchTenderPlaintext('project-1');

      expect(out).toBeNull();
    });
  });

  describe('fetchTenderPlaintext — 公告轨编号并集（2026-10-20：公告存 PMI 业务编号，仅按 BidProject 内部编号查恒空 → tenderText=0、条款提取空链，实录 DMGY-XB-2026100901）', () => {
    let redis: { get: jest.Mock };

    beforeEach(() => {
      prisma.bidProject = { findUnique: jest.fn().mockResolvedValue({ projectCode: 'XB-1', projectManagementItemId: 'pmi-1' }) };
      prisma.projectManagementItem = { findUnique: jest.fn().mockResolvedValue({ projectCode: 'DMGY-XB-1' }) };
      prisma.announcement = { findFirst: jest.fn().mockResolvedValue({ id: 'ann-1' }) };
      prisma.bidDocument = { findFirst: jest.fn().mockResolvedValue(null), findUnique: jest.fn().mockResolvedValue({ id: 'bd-1', fileAssetId: 'asset-1', decryptKey: null }) };
      prisma.fileAsset.findUnique.mockResolvedValue({
        id: 'asset-1', key: 'bid-doc/x.pdf', originalName: '询比采购文件.pdf', sha256: 'abc123', sealedPath: null,
      });
      redis = { get: jest.fn() };
      (service as any).redis = redis;
    });

    afterEach(() => {
      (service as any).redis = undefined;
    });

    it('公告按双编号并集命中（relatedProjectCode in [XB-1, DMGY-XB-1]）→ BidDocument(announcementId) → 返回文件', async () => {
      const out = await service.fetchTenderPlaintext('project-1');

      expect(out!.fileName).toBe('询比采购文件.pdf');
      expect(prisma.announcement.findFirst).toHaveBeenCalledWith(expect.objectContaining({
        where: expect.objectContaining({ relatedProjectCode: { in: ['XB-1', 'DMGY-XB-1'] } }),
      }));
      expect(prisma.bidDocument.findUnique).toHaveBeenCalledWith({ where: { announcementId: 'ann-1' } });
    });

    it('bidProjectId 直连优先：PUBLISHED 公告名下最新一份命中即不查公告链（重发公告旧版不得被无序捞走）', async () => {
      prisma.bidDocument.findFirst.mockResolvedValue({ id: 'bd-9', fileAssetId: 'asset-1', decryptKey: null });

      const out = await service.fetchTenderPlaintext('project-1');

      expect(out!.fileName).toBe('询比采购文件.pdf');
      expect(prisma.announcement.findFirst).not.toHaveBeenCalled();
      expect(prisma.bidDocument.findFirst).toHaveBeenCalledWith(expect.objectContaining({
        where: expect.objectContaining({ bidProjectId: 'project-1', announcement: { status: 'PUBLISHED' } }),
        orderBy: { createdAt: 'desc' },
      }));
    });

    it('公告轨命中 → 优先公告轨，不读谈判配置（redis.get 不触发）', async () => {
      const out = await service.fetchTenderPlaintext('project-1');

      expect(out!.fileName).toBe('询比采购文件.pdf');
      expect(redis.get).not.toHaveBeenCalled();
    });
  });
});
