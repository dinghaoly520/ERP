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

const { decryptBuffer } = require('../../bid/bid-submission.crypto');
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

  describe('wrappedKey 路径（envelope encryption）', () => {
    it('sealedKey 为 base64 格式时走 unwrapKey → decryptBuffer', async () => {
      const wrappedKey = 'aGVsbG8gd29ybGQgdGhpcw=='; // "hello world this" in base64
      setupMocks(wrappedKey);

      await service.fetchBidderPlaintext('bs-1', 'technical');

      expect(isWrappedKey).toHaveBeenCalledWith(wrappedKey);
      expect(unwrapKey).toHaveBeenCalled();
      expect(decryptBuffer).toHaveBeenCalled();
    });
  });

  describe('legacy hex 路径（旧格式 DEK）', () => {
    it('sealedKey 为 hex:hex:hex 格式时直接用原值解密', async () => {
      const legacyKey = 'a1b2c3d4e5f6:010203040506:ffeeddccbbaa';
      setupMocks(legacyKey);

      await service.fetchBidderPlaintext('bs-1', 'technical');

      expect(isWrappedKey).toHaveBeenCalledWith(legacyKey);
      expect(unwrapKey).not.toHaveBeenCalled();
    });
  });

  describe('sealedKey 为空（存量明文）', () => {
    it('sealedKey 为 null 时跳过解密，直接返回明文', async () => {
      setupMocks(null);

      const buf = await service.fetchBidderPlaintext('bs-1', 'technical');

      // sealedKey 为 null 时，代码不会进入解密分支，isWrappedKey 不会被调用
      expect(unwrapKey).not.toHaveBeenCalled();
      expect(decryptBuffer).not.toHaveBeenCalled();
      expect(buf).toBeDefined();
    });
  });
});
