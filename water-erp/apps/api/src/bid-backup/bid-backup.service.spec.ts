import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service';
import { BidBackupService, StagedBackup } from './bid-backup.service';
import { minioClient } from '../upload/minio.client';
import * as crypto from 'crypto';

jest.mock('../upload/minio.client', () => ({
  minioClient: { putObject: jest.fn(), getObject: jest.fn(), removeObject: jest.fn() },
  MINIO_BUCKET: 'test-bucket',
}));

const sha = (b: Buffer) => crypto.createHash('sha256').update(b).digest('hex');

/** 构造一个 streamToBuffer 可消费的异步可迭代对象 */
function fakeStream(buf: Buffer): any {
  return { async *[Symbol.asyncIterator]() { yield buf; } };
}

describe('BidBackupService', () => {
  let service: BidBackupService;
  let prisma: any;

  beforeEach(async () => {
    jest.clearAllMocks();
    delete process.env.BID_BACKUP_ENABLED;
    prisma = {
      bidFileBackup: { upsert: jest.fn(), findUnique: jest.fn(), findMany: jest.fn(), update: jest.fn() },
      supplierBidSubmission: { findUnique: jest.fn(), findMany: jest.fn() },
      fileAsset: { findUnique: jest.fn() },
      bidSupplier: { findFirst: jest.fn() },
      auditLog: { create: jest.fn() },
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [BidBackupService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = module.get(BidBackupService);
  });

  describe('buildBackupKey / computeSha256', () => {
    it('buildBackupKey 生成独立前缀路径', () => {
      expect(service.buildBackupKey('p1', 's1', 'technical', 'sealed/p1/s1/bid.pdf.enc'))
        .toBe('sealed-backup/p1/s1/technical/bid.pdf.enc');
    });
    it('computeSha256 与 node crypto 一致', () => {
      const buf = Buffer.from('hello');
      expect(service.computeSha256(buf)).toBe(sha(buf));
    });
  });

  describe('stageBackup', () => {
    const input = {
      projectId: 'p1', supplierId: 's1', fileRole: 'technical' as const,
      fileAssetId: 'a1', sealedPath: 'sealed/p1/s1/bid.pdf.enc',
      ciphertext: Buffer.from('cipher-bytes'), wrappedDek: 'wrapped==', plaintextSha256: 'plainsha',
    };

    it('成功：putObject 后返回 StagedBackup，含正确 ciphertextSha256', async () => {
      (minioClient.putObject as jest.Mock).mockResolvedValue({});
      const staged = await service.stageBackup(input);
      expect(minioClient.putObject).toHaveBeenCalledWith(
        'test-bucket', 'sealed-backup/p1/s1/technical/bid.pdf.enc',
        input.ciphertext, input.ciphertext.length, { 'Content-Type': 'application/octet-stream' },
      );
      expect(staged).toMatchObject({
        fileRole: 'technical', backupKey: 'sealed-backup/p1/s1/technical/bid.pdf.enc',
        sealedPath: input.sealedPath, wrappedDek: 'wrapped==',
        ciphertextSha256: sha(input.ciphertext), size: input.ciphertext.length,
      });
    });

    it('putObject 失败：返回 null 且不抛（不阻断提交）', async () => {
      (minioClient.putObject as jest.Mock).mockRejectedValue(new Error('minio down'));
      await expect(service.stageBackup(input)).resolves.toBeNull();
    });

    it('功能关闭（BID_BACKUP_ENABLED=false）：返回 null 且不写 MinIO', async () => {
      process.env.BID_BACKUP_ENABLED = 'false';
      const module: TestingModule = await Test.createTestingModule({
        providers: [BidBackupService, { provide: PrismaService, useValue: prisma }],
      }).compile();
      const disabled = module.get(BidBackupService);
      expect(disabled.isEnabled()).toBe(false);
      await expect(disabled.stageBackup(input)).resolves.toBeNull();
      expect(minioClient.putObject).not.toHaveBeenCalled();
    });
  });

  describe('persistBackup', () => {
    it('以 [supplierId,projectId,fileRole] 幂等 upsert，create/update 含 wrappedDek 与哈希', async () => {
      prisma.bidFileBackup.upsert.mockResolvedValue({});
      const staged: StagedBackup = {
        fileAssetId: 'a1', fileRole: 'technical', backupKey: 'bk', sealedPath: 'sp',
        wrappedDek: 'wd', ciphertextSha256: 'csha', plaintextSha256: 'psha', size: 5,
      };
      await service.persistBackup(prisma, staged, {
        projectId: 'p1', supplierId: 's1', receiptNo: 'TB-1', submittedAt: new Date('2026-01-01'), backupSource: 'submission',
      });
      expect(prisma.bidFileBackup.upsert).toHaveBeenCalledWith({
        where: { supplierId_projectId_fileRole: { supplierId: 's1', projectId: 'p1', fileRole: 'technical' } },
        update: expect.objectContaining({ backupKey: 'bk', wrappedDek: 'wd', ciphertextSha256: 'csha', backupSource: 'submission', cryptoVersion: 'envelope-v1' }),
        create: expect.objectContaining({ projectId: 'p1', supplierId: 's1', fileRole: 'technical', backupKey: 'bk', wrappedDek: 'wd' }),
      });
    });
  });

  describe('reconcileMissing', () => {
    it('功能关闭：直接返回 0，不查询', async () => {
      process.env.BID_BACKUP_ENABLED = 'false';
      const module: TestingModule = await Test.createTestingModule({
        providers: [BidBackupService, { provide: PrismaService, useValue: prisma }],
      }).compile();
      const disabled = module.get(BidBackupService);
      await expect(disabled.reconcileMissing()).resolves.toBe(0);
      expect(prisma.supplierBidSubmission.findMany).not.toHaveBeenCalled();
    });

    it('缺失的从 sealedPath 读密文补齐（backupSource=reconcile）', async () => {
      const ciphertext = Buffer.from('sealed-cipher');
      prisma.supplierBidSubmission.findMany.mockResolvedValue([{
        id: 'sub1', supplierId: 's1', projectId: 'p1', submittedAt: new Date('2026-01-01'),
        technicalFileAssetId: 'a1', businessFileAssetId: null, coverLetterAssetId: null,
        technicalSealedKey: 'wd', businessSealedKey: null, coverLetterSealedKey: null,
      }]);
      prisma.bidFileBackup.findUnique.mockResolvedValue(null); // 无备份
      prisma.fileAsset.findUnique.mockResolvedValue({ id: 'a1', sealedPath: 'sealed/p1/s1/bid.enc', sha256: 'psha' });
      (minioClient.getObject as jest.Mock).mockResolvedValue(fakeStream(ciphertext));
      (minioClient.putObject as jest.Mock).mockResolvedValue({});
      prisma.bidSupplier.findFirst.mockResolvedValue({ receiptNo: 'TB-9' });
      prisma.bidFileBackup.upsert.mockResolvedValue({});

      const n = await service.reconcileMissing();
      expect(n).toBe(1);
      expect(minioClient.getObject).toHaveBeenCalledWith('test-bucket', 'sealed/p1/s1/bid.enc');
      expect(prisma.bidFileBackup.upsert).toHaveBeenCalledWith(expect.objectContaining({
        update: expect.objectContaining({ backupSource: 'reconcile', ciphertextSha256: sha(ciphertext), receiptNo: 'TB-9' }),
      }));
    });

    it('已存在备份 → 跳过不补', async () => {
      prisma.supplierBidSubmission.findMany.mockResolvedValue([{
        id: 'sub1', supplierId: 's1', projectId: 'p1', submittedAt: new Date(),
        technicalFileAssetId: 'a1', businessFileAssetId: null, coverLetterAssetId: null,
        technicalSealedKey: 'wd', businessSealedKey: null, coverLetterSealedKey: null,
      }]);
      prisma.bidFileBackup.findUnique.mockResolvedValue({ id: 'b1' }); // 已有
      await expect(service.reconcileMissing()).resolves.toBe(0);
      expect(minioClient.getObject).not.toHaveBeenCalled();
    });

    it('单条补备失败不中断整体', async () => {
      prisma.supplierBidSubmission.findMany.mockResolvedValue([{
        id: 'sub1', supplierId: 's1', projectId: 'p1', submittedAt: new Date(),
        technicalFileAssetId: 'a1', businessFileAssetId: null, coverLetterAssetId: null,
        technicalSealedKey: 'wd', businessSealedKey: null, coverLetterSealedKey: null,
      }]);
      prisma.bidFileBackup.findUnique.mockResolvedValue(null);
      prisma.fileAsset.findUnique.mockResolvedValue({ id: 'a1', sealedPath: 'sealed/x.enc', sha256: 'p' });
      (minioClient.getObject as jest.Mock).mockRejectedValue(new Error('read fail'));
      await expect(service.reconcileMissing()).resolves.toBe(0);
    });
  });
});
