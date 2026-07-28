import { Test, TestingModule } from '@nestjs/testing';
import { SupplierPortalService } from './supplier-portal.service';
import { PrismaService } from '../prisma/prisma.service';
import { BidDocumentService } from '../announcement/bid-document.service';
import { SignatureService } from '../common/crypto/signature.service';
import { BidBackupService } from '../bid-backup/bid-backup.service';

jest.mock('../announcement/bid-document.crypto', () => ({
  encryptBuffer: jest.fn().mockReturnValue({
    ciphertext: Buffer.from('encrypted'),
    decryptKey: 'key:iv:auth',
  }),
  streamToBuffer: jest.fn().mockResolvedValue(Buffer.from('plaintext')),
  decryptBuffer: jest.fn(),
}));

jest.mock('../common/crypto/envelope-crypto', () => ({
  wrapKey: jest.fn((dek: string, _kmsSecret: string) => `wrapped:${dek}`),
  unwrapKey: jest.fn(),
  isWrappedKey: jest.fn(),
}));

jest.mock('../upload/minio.client', () => ({
  minioClient: {
    getObject: jest.fn().mockResolvedValue({}),
    putObject: jest.fn().mockResolvedValue({}),
    removeObject: jest.fn().mockResolvedValue({}),
  },
  MINIO_BUCKET: 'test-bucket',
}));

import { encryptBuffer, streamToBuffer } from '../announcement/bid-document.crypto';
import { minioClient } from '../upload/minio.client';
import { openField, sealField } from '../common/crypto/field-crypto';

// 提交路径 pickBidSubmissionFields 会调 sealField(plain, process.env.KMS_SECRET!)。
// KMS_SECRET 在 jest 同进程可能被其他 spec(expert.service.spec 的招标文件解密测试)污染，
// 此处显式自洽设置，确保密封路径稳定可复现。
const TEST_KMS = 'test-kms-secret-from-supplier-portal-spec';
const ORIG_KMS = process.env.KMS_SECRET;
beforeAll(() => { process.env.KMS_SECRET = TEST_KMS; });
afterAll(() => { if (ORIG_KMS !== undefined) process.env.KMS_SECRET = ORIG_KMS; else delete process.env.KMS_SECRET; });

describe('SupplierPortalService', () => {
  let service: SupplierPortalService;
  let prisma: any;

  const mockSupplier = {
    id: 'supplier-1',
    userId: 'user-1',
    name: '四川川水建设工程有限公司',
    creditCode: '91510000MA62K5XX0X',
    enterpriseType: '国有企业',
    legalPerson: '张明',
    registeredAddress: '成都市高新区天府大道北段1700号',
    businessScope: '水利水电工程施工',
    status: 'APPROVED',
    classificationId: 'cls-1',
    contacts: [{ name: '张经理', phone: '13800138001', isPrimary: true }],
    qualifications: [
      { type: '营业执照', name: '企业法人营业执照', validTo: new Date('2030-12-31'), status: '有效' },
      { type: '资质证书', name: '水利水电一级', validTo: new Date('2028-06-30'), status: '有效' },
    ],
  };

  beforeEach(async () => {
    prisma = {
      $transaction: jest.fn(async (cb: any) => cb(prisma)),
      supplier: { findUnique: jest.fn() },
      bidProject: { findUnique: jest.fn(), findMany: jest.fn(), count: jest.fn(), groupBy: jest.fn() },
      supplierEvaluation: { count: jest.fn() },
      supplierBidSubmission: {
        count: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
        create: jest.fn(),
      },
      bidSupplier: {
        findFirst: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
        create: jest.fn(),
      },
      bidOpeningRecord: { findFirst: jest.fn(), findMany: jest.fn(), updateMany: jest.fn() },
      fileAsset: { findMany: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
      bidSupervisionLog: { create: jest.fn() },
      supplierChangeRecord: { count: jest.fn() },
      supplierQualification: { count: jest.fn() },
      notification: { count: jest.fn() },
      user: { findUnique: jest.fn() },
      announcement: { findFirst: jest.fn() },
      bidDocument: { findUnique: jest.fn(), findMany: jest.fn().mockResolvedValue([]) },
    };
    // G3 兜底默认放行（投递时校验已发布招标公告）；个别用例可覆盖为 null 验证拦截
    prisma.announcement.findFirst.mockResolvedValue({ id: 'notice-1' });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SupplierPortalService,
        { provide: PrismaService, useValue: prisma },
        { provide: BidDocumentService, useValue: { getForSupplier: jest.fn() } },
        { provide: SignatureService, useValue: { verify: jest.fn().mockReturnValue(true), isValidPublicKey: jest.fn().mockReturnValue(true) } },
        { provide: BidBackupService, useValue: { stageBackup: jest.fn().mockResolvedValue(null), persistBackup: jest.fn(), isEnabled: jest.fn().mockReturnValue(true) } },
      ],
    }).compile();

    service = module.get<SupplierPortalService>(SupplierPortalService);
  });

  describe('getDashboardStats', () => {
    it('应返回供应商仪表盘统计（包含完整度评分）', async () => {
      prisma.supplier.findUnique.mockResolvedValue(mockSupplier);
      prisma.supplierEvaluation.count.mockResolvedValue(3);
      prisma.supplierBidSubmission.count.mockResolvedValue(2);
      prisma.supplierChangeRecord.count.mockResolvedValue(1);
      prisma.notification.count.mockResolvedValue(5);
      prisma.supplierQualification.count.mockResolvedValue(2);

      const result = await service.getDashboardStats('user-1');

      expect(result).toBeDefined();
      expect(result!.supplierStatus).toBe('APPROVED');
      expect(result!.evaluationCount).toBe(3);
      expect(result!.submissionCount).toBe(2);
      expect(result!.qualificationCount).toBe(2);
      expect(result!.pendingChanges).toBe(1);
      expect(result!.unreadNotifications).toBe(5);
      expect(result!.profileCompleteness).toBeDefined();
      expect(result!.profileCompleteness.score).toBeGreaterThanOrEqual(0);
      expect(result!.profileCompleteness.score).toBeLessThanOrEqual(100);
    });

    it('无供应商记录时应返回 null', async () => {
      prisma.supplier.findUnique.mockResolvedValue(null);

      const result = await service.getDashboardStats('nonexistent');

      expect(result).toBeNull();
    });

    it('资质齐全的供应商应有较高完整度', async () => {
      const fullSupplier = {
        ...mockSupplier,
        contacts: [
          { name: '张经理', phone: '13800138001', isPrimary: true },
          { name: '王芳', phone: '13800138002', isPrimary: false },
        ],
        qualifications: [
          { type: '营业执照', name: '企业法人营业执照', validTo: new Date('2030-12-31'), status: '有效' },
          { type: '资质证书', name: '水利水电一级', validTo: new Date('2028-06-30'), status: '有效' },
          { type: '安全生产许可证', name: '安全生产许可证', validTo: new Date('2027-03-14'), status: '有效' },
        ],
      };
      prisma.supplier.findUnique.mockResolvedValue(fullSupplier);
      prisma.supplierEvaluation.count.mockResolvedValue(0);
      prisma.supplierBidSubmission.count.mockResolvedValue(0);
      prisma.supplierChangeRecord.count.mockResolvedValue(0);
      prisma.notification.count.mockResolvedValue(0);

      const result = await service.getDashboardStats('user-1');

      expect(result!.profileCompleteness.score).toBeGreaterThanOrEqual(80);
    });

    it('缺少基本信息的供应商应有较低完整度并包含缺失项', async () => {
      const minimal = {
        id: 'supplier-2',
        userId: 'user-2',
        name: null,
        creditCode: null,
        enterpriseType: null,
        legalPerson: null,
        registeredAddress: null,
        businessScope: null,
        status: 'PENDING',
        classificationId: null,
        contacts: [],
        qualifications: [],
      };

      prisma.supplier.findUnique.mockResolvedValue(minimal);
      prisma.supplierEvaluation.count.mockResolvedValue(0);
      prisma.supplierBidSubmission.count.mockResolvedValue(0);
      prisma.supplierChangeRecord.count.mockResolvedValue(0);
      prisma.notification.count.mockResolvedValue(0);

      const result = await service.getDashboardStats('user-2');

      expect(result!.profileCompleteness.score).toBeLessThan(30);
      expect(result!.profileCompleteness.missing.length).toBeGreaterThan(5);
    });
  });

  describe('submitBid', () => {
    it('rejects submission when project is not in SUBMIT stage', async () => {
      prisma.supplier.findUnique.mockResolvedValue({ id: 'supplier-1', name: '测试供应商', status: 'APPROVED' });
      prisma.bidProject.findUnique.mockResolvedValue({
        id: 'project-1', stage: 'OPENING',
        deadline: new Date(Date.now() + 3600_000),
      });
      await expect(service.submitBid('supplier-1', 'project-1', { bidPrice: '100' }))
        .rejects.toMatchObject({ response: { code: 'PROJECT_NOT_SUBMITTING' } });
    });

    it('rejects submission after deadline', async () => {
      prisma.supplier.findUnique.mockResolvedValue({ id: 'supplier-1', name: '测试供应商', status: 'APPROVED' });
      prisma.bidProject.findUnique.mockResolvedValue({
        id: 'project-1', stage: 'SUBMIT',
        deadline: new Date(Date.now() - 3600_000),
      });
      await expect(service.submitBid('supplier-1', 'project-1', { bidPrice: '100' }))
        .rejects.toMatchObject({ response: { code: 'DEADLINE_PASSED' } });
    });

    it('rejects non-APPROVED supplier', async () => {
      prisma.supplier.findUnique.mockResolvedValue({ id: 'supplier-2', name: '待审供应商', status: 'PENDING' });
      prisma.bidProject.findUnique.mockResolvedValue({
        id: 'project-1', stage: 'SUBMIT',
        deadline: new Date(Date.now() + 3600_000),
      });
      await expect(service.submitBid('supplier-2', 'project-1', { bidPrice: '100' }))
        .rejects.toMatchObject({ response: { code: 'NOT_APPROVED' } });
    });

    it('syncs BidSupplier when an existing draft is submitted', async () => {
      prisma.supplierBidSubmission.findUnique.mockResolvedValue({
        id: 'sub-1', supplierId: 'supplier-1', projectId: 'project-1', status: 'draft',
      });
      prisma.supplier.findUnique.mockResolvedValue({ id: 'supplier-1', name: '测试供应商', status: 'APPROVED' });
      prisma.bidProject.findUnique.mockResolvedValue({
        id: 'project-1', stage: 'SUBMIT',
        deadline: new Date(Date.now() + 3600_000),
      });
      prisma.supplierBidSubmission.update.mockResolvedValue({
        id: 'sub-1', supplierId: 'supplier-1', projectId: 'project-1', status: 'submitted',
      });
      prisma.bidSupplier.findFirst.mockResolvedValue(null);
      prisma.bidSupplier.create.mockResolvedValue({ id: 'bs-1', supplierId: 'supplier-1' });

      const result = await service.submitBid('supplier-1', 'project-1', { bidPrice: '100' });

      expect(result.status).toBe('submitted');
      expect(prisma.bidSupplier.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            projectId: 'project-1',
            supplierId: 'supplier-1',
            supplierName: '测试供应商',
            submitStatus: '已提交',
          }),
        }),
      );
    });

    it('放宽门控：DOWNLOAD 阶段 + 已发公告 + 未截止 → 允许投递（棘轮化）', async () => {
      prisma.supplierBidSubmission.findUnique.mockResolvedValue(null);
      prisma.supplier.findUnique.mockResolvedValue({ id: 'supplier-1', name: '测试供应商', status: 'APPROVED' });
      prisma.bidProject.findUnique.mockResolvedValue({
        id: 'project-1', projectCode: 'BID-X', stage: 'DOWNLOAD',
        deadline: new Date(Date.now() + 3600_000),
      });
      prisma.announcement.findFirst.mockResolvedValue({ id: 'notice-1' });
      prisma.supplierBidSubmission.create.mockResolvedValue({ id: 'sub-2', status: 'submitted' });
      prisma.bidSupplier.findFirst.mockResolvedValue(null);
      prisma.bidSupplier.create.mockResolvedValue({ id: 'bs-2' });

      await expect(service.submitBid('supplier-1', 'project-1', { bidPrice: '100' })).resolves.toBeDefined();
    });

    it('放宽门控：DOWNLOAD 阶段但无公告 → 400 BID_NOTICE_REQUIRED（G3 兜底）', async () => {
      prisma.supplier.findUnique.mockResolvedValue({ id: 'supplier-1', name: '测试供应商', status: 'APPROVED' });
      prisma.bidProject.findUnique.mockResolvedValue({
        id: 'project-1', projectCode: 'BID-X', stage: 'DOWNLOAD',
        deadline: new Date(Date.now() + 3600_000),
      });
      prisma.announcement.findFirst.mockResolvedValue(null);

      await expect(service.submitBid('supplier-1', 'project-1', { bidPrice: '100' }))
        .rejects.toMatchObject({ response: { code: 'BID_NOTICE_REQUIRED' } });
    });

    it('放宽门控：OPENING 阶段 → 400 PROJECT_NOT_SUBMITTING', async () => {
      prisma.supplier.findUnique.mockResolvedValue({ id: 'supplier-1', name: '测试供应商', status: 'APPROVED' });
      prisma.bidProject.findUnique.mockResolvedValue({
        id: 'project-1', projectCode: 'BID-X', stage: 'OPENING',
        deadline: new Date(Date.now() + 3600_000),
      });

      await expect(service.submitBid('supplier-1', 'project-1', { bidPrice: '100' }))
        .rejects.toMatchObject({ response: { code: 'PROJECT_NOT_SUBMITTING' } });
    });

  });

  describe('submitBid file asset ownership', () => {
    beforeEach(() => {
      prisma.supplierBidSubmission.findUnique.mockResolvedValue(null);
      prisma.supplier.findUnique.mockResolvedValue({ id: 'supplier-1', name: '测试供应商', status: 'APPROVED', userId: 'user-1' });
      prisma.bidProject.findUnique.mockResolvedValue({
        id: 'project-1', stage: 'SUBMIT',
        deadline: new Date(Date.now() + 3600_000),
      });
      prisma.supplierBidSubmission.create.mockResolvedValue({ id: 'sub-1', status: 'submitted' });
      prisma.bidSupplier.findFirst.mockResolvedValue(null);
      prisma.bidSupplier.create.mockResolvedValue({ id: 'bs-1' });
    });

    it('rejects file assets uploaded by another user', async () => {
      prisma.fileAsset.findMany.mockResolvedValue([
        { id: 'fa-1', uploaderId: 'user-OTHER', category: 'bid_document' },
      ]);

      await expect(service.submitBid('supplier-1', 'project-1', { technicalFileAssetId: 'fa-1' }))
        .rejects.toMatchObject({ response: { code: 'FILE_NOT_OWNED' } });
    });

    it('rejects file assets that are not bid_document category', async () => {
      prisma.fileAsset.findMany.mockResolvedValue([
        { id: 'fa-2', uploaderId: 'user-1', category: 'qualification' },
      ]);

      await expect(service.submitBid('supplier-1', 'project-1', { technicalFileAssetId: 'fa-2' }))
        .rejects.toMatchObject({ response: { code: 'INVALID_BID_FILE' } });
    });

    it('rejects when a referenced asset does not exist', async () => {
      prisma.fileAsset.findMany.mockResolvedValue([]);

      await expect(service.submitBid('supplier-1', 'project-1', { technicalFileAssetId: 'fa-missing' }))
        .rejects.toMatchObject({ response: { code: 'FILE_NOT_FOUND' } });
    });

    it('allows submission with valid owned bid_document assets', async () => {
      prisma.fileAsset.findMany.mockResolvedValue([
        { id: 'fa-1', uploaderId: 'user-1', category: 'bid_document' },
        { id: 'fa-2', uploaderId: 'user-1', category: 'bid_document' },
      ]);

      const result = await service.submitBid('supplier-1', 'project-1', {
        technicalFileAssetId: 'fa-1', businessFileAssetId: 'fa-2',
      });

      expect(result.status).toBe('submitted');
      expect(prisma.supplierBidSubmission.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            technicalFileAssetId: 'fa-1',
            businessFileAssetId: 'fa-2',
          }),
        }),
      );
    });
  });

  describe('submitBid encryption', () => {
    const mockAsset = { id: 'fa-1', key: 'uploads/2026-01-01/file.pdf', mimeType: 'application/pdf', size: 1000, sha256: 'hash', category: 'bid_document', uploaderId: 'user-1' };

    beforeEach(() => {
      prisma.supplierBidSubmission.findUnique.mockResolvedValue(null);
      prisma.supplier.findUnique.mockResolvedValue({ id: 'supplier-1', name: '测试供应商', status: 'APPROVED', userId: 'user-1' });
      prisma.bidProject.findUnique.mockResolvedValue({
        id: 'project-1', stage: 'SUBMIT',
        deadline: new Date(Date.now() + 3600_000),
      });
      prisma.fileAsset.findMany.mockResolvedValue([mockAsset]);
      prisma.fileAsset.findUnique.mockResolvedValue(mockAsset);
      prisma.fileAsset.update.mockResolvedValue(mockAsset);
      prisma.supplierBidSubmission.create.mockResolvedValue({ id: 'sub-1', status: 'submitted' });
      prisma.bidSupplier.findFirst.mockResolvedValue(null);
      prisma.bidSupplier.create.mockResolvedValue({ id: 'bs-1' });
      jest.clearAllMocks();
    });

    it('encrypts bid files on submit and stores sealedKeys', async () => {
      const result = await service.submitBid('supplier-1', 'project-1', { technicalFileAssetId: 'fa-1' });

      expect(encryptBuffer).toHaveBeenCalled();
      expect(minioClient.getObject).toHaveBeenCalledWith('test-bucket', mockAsset.key);
      // Writes ciphertext to NEW sealed path (does not overwrite original)
      expect(minioClient.putObject).toHaveBeenCalledWith(
        'test-bucket', expect.stringContaining('sealed/project-1/supplier-1/'),
        expect.any(Buffer), expect.any(Number),
        expect.objectContaining({ 'Content-Type': 'application/octet-stream' }),
      );
      expect(prisma.fileAsset.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'fa-1' },
          data: { encrypted: true, sealedPath: expect.stringContaining('sealed/') },
        }),
      );
      expect(prisma.supplierBidSubmission.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            technicalSealedKey: expect.any(String),
          }),
        }),
      );
    });

    it('cleans up sealed files on encryption failure', async () => {
      // MinIO failure on the 2nd file
      (minioClient.putObject as jest.Mock)
        .mockResolvedValueOnce({})  // first file: success
        .mockRejectedValueOnce(new Error('minio write error')); // second: fail

      prisma.fileAsset.findMany.mockResolvedValue([
        { ...mockAsset },
        { ...mockAsset, id: 'fa-2' },
      ]);
      const mockAsset2 = { ...mockAsset, id: 'fa-2' };
      prisma.fileAsset.findUnique.mockResolvedValueOnce({ ...mockAsset }).mockResolvedValueOnce(mockAsset2);

      await expect(service.submitBid('supplier-1', 'project-1', {
        technicalFileAssetId: 'fa-1', businessFileAssetId: 'fa-2',
      })).rejects.toThrow('minio write error');

      // Should clean up the sealed file that was already written (fa-1)
      expect(minioClient.removeObject).toHaveBeenCalledWith(
        'test-bucket', expect.stringContaining('sealed/project-1/supplier-1/'),
      );
    });

    it('密封 bidPrice 入库（v1: 前缀 + openField 可还原明文）', async () => {
      // 提交含 bidPrice 的标书：bidPrice 入库后应以 'v1:' 密封前缀存储，
      // 明文不可直接出现在 create/update data 中。
      const plain = '980000';
      await service.submitBid('supplier-1', 'project-1', {
        technicalFileAssetId: 'fa-1',
        bidPrice: plain,
      });

      expect(prisma.supplierBidSubmission.create).toHaveBeenCalledTimes(1);
      const call = (prisma.supplierBidSubmission.create as jest.Mock).mock.calls[0][0];
      const storedBidPrice = call.data.bidPrice;
      expect(storedBidPrice).toMatch(/^v1:/);
      expect(storedBidPrice).not.toBe(plain);
      // 真实拆封验证 round-trip
      expect(openField(storedBidPrice, TEST_KMS)).toBe(plain);
      // 防回归：明文不应出现在 deliveryPeriod 或其他字段
      expect(JSON.stringify(call.data)).not.toContain(`"bidPrice":"${plain}"`);
    });

    it('saveBidDraft 同样密封 bidPrice（v1: 前缀）', async () => {
      prisma.supplierBidSubmission.findUnique.mockResolvedValue(null);
      prisma.supplierBidSubmission.create.mockResolvedValue({ id: 'sub-draft', status: 'draft' });

      await service.saveBidDraft('supplier-1', 'project-1', { bidPrice: '12345' });

      const call = (prisma.supplierBidSubmission.create as jest.Mock).mock.calls[0][0];
      expect(call.data.bidPrice).toMatch(/^v1:/);
      expect(openField(call.data.bidPrice, TEST_KMS)).toBe('12345');
    });

    it('密封 bidPrice 不可被缺 KMS_SECRET 的环境拆封', async () => {
      // 防回归：如果 KMS_SECRET 缺失，sealField 应当抛错（密封路径强依赖 KMS）。
      const orig = process.env.KMS_SECRET;
      delete process.env.KMS_SECRET;
      try {
        await expect(service.submitBid('supplier-1', 'project-1', {
          technicalFileAssetId: 'fa-1',
          bidPrice: '999',
        })).rejects.toThrow(/KMS_SECRET is not configured/);
      } finally {
        process.env.KMS_SECRET = orig;
      }
    });
  });

  describe('opening confirmation', () => {
    const decryptedSupplier = {
      id: 'bs-1', supplierId: 'supplier-1', projectId: 'project-1',
      supplierName: '测试供应商', decryptStatus: 'SUCCESS',
    };

    it('confirmOpening marks record and BidSupplier as confirmed', async () => {
      prisma.bidProject.findUnique.mockResolvedValue({ stage: 'OPENING' });
      prisma.bidSupplier.findFirst.mockResolvedValue(decryptedSupplier);
      prisma.bidOpeningRecord.findFirst.mockResolvedValue({ id: 'r-1', confirmStatus: '待供应商确认' });
      prisma.bidOpeningRecord.updateMany.mockResolvedValue({ count: 1 });
      prisma.bidSupplier.update.mockResolvedValue(decryptedSupplier);
      prisma.bidSupervisionLog.create.mockResolvedValue({});
      prisma.$transaction = jest.fn(async (cb: any) => cb(prisma));

      const result = await service.confirmOpening('supplier-1', 'project-1');

      expect(result.success).toBe(true);
      expect(prisma.bidOpeningRecord.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ confirmStatus: '供应商已确认' }) }),
      );
      expect(prisma.bidSupplier.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ confirmStatus: 'CONFIRMED' }) }),
      );
    });

    it('confirmOpening rejects when supplier not decrypted', async () => {
      prisma.bidProject.findUnique.mockResolvedValue({ stage: 'OPENING' });
      prisma.bidSupplier.findFirst.mockResolvedValue({ ...decryptedSupplier, decryptStatus: 'PENDING' });

      await expect(service.confirmOpening('supplier-1', 'project-1'))
        .rejects.toMatchObject({ response: { code: 'NOT_DECRYPTED' } });
    });

    it('disputeOpening marks record disputed with reason and BidSupplier DISPUTED', async () => {
      prisma.bidProject.findUnique.mockResolvedValue({ stage: 'OPENING' });
      prisma.bidSupplier.findFirst.mockResolvedValue(decryptedSupplier);
      prisma.bidOpeningRecord.findFirst.mockResolvedValue({ id: 'r-1', confirmStatus: '待供应商确认' });
      prisma.bidOpeningRecord.updateMany.mockResolvedValue({ count: 1 });
      prisma.bidSupplier.update.mockResolvedValue(decryptedSupplier);
      prisma.bidSupervisionLog.create.mockResolvedValue({});
      prisma.$transaction = jest.fn(async (cb: any) => cb(prisma));

      const result = await service.disputeOpening('supplier-1', 'project-1', '报价与提交不一致');

      expect(result.success).toBe(true);
      expect(prisma.bidOpeningRecord.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ confirmStatus: '供应商提出异议', objectionReason: '报价与提交不一致' }) }),
      );
      expect(prisma.bidSupplier.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ confirmStatus: 'DISPUTED' }) }),
      );
    });

    it('disputeOpening requires a reason', async () => {
      await expect(service.disputeOpening('supplier-1', 'project-1', ''))
        .rejects.toMatchObject({ response: { code: 'MISSING_REASON' } });
    });

    // Wave 5-1：「待确认」为旧值（种子/历史数据），与「待供应商确认」同为可操作态
    it('confirmOpening 兼容旧值「待确认」态记录 → 正常确认', async () => {
      prisma.bidProject.findUnique.mockResolvedValue({ stage: 'OPENING' });
      prisma.bidSupplier.findFirst.mockResolvedValue(decryptedSupplier);
      prisma.bidOpeningRecord.findFirst.mockResolvedValue({ id: 'r-1', confirmStatus: '待确认' });
      prisma.bidOpeningRecord.updateMany.mockResolvedValue({ count: 1 });
      prisma.bidSupplier.update.mockResolvedValue(decryptedSupplier);
      prisma.bidSupervisionLog.create.mockResolvedValue({});
      prisma.$transaction = jest.fn(async (cb: any) => cb(prisma));

      await expect(service.confirmOpening('supplier-1', 'project-1')).resolves.toMatchObject({ success: true });
    });

    // Wave 5-1：API 状态门（与 host 侧 R7/I1 对称；UI 已门控，此为直调防线）
    it.each([
      ['异议已处理-退回'], // EXCEPTION 供应商被主持人退回后的记录态——confirm 不得翻回 CONFIRMED 让其逃脱
      ['供应商已确认'],
      ['供应商提出异议'],
      ['异议已处理-确认'],
    ])('confirmOpening 状态门：%s 态记录确认 → 400 RECORD_NOT_CONFIRMABLE', async (confirmStatus) => {
      prisma.bidProject.findUnique.mockResolvedValue({ stage: 'OPENING' });
      prisma.bidSupplier.findFirst.mockResolvedValue(decryptedSupplier);
      prisma.bidOpeningRecord.findFirst.mockResolvedValue({ id: 'r-1', confirmStatus });

      await expect(service.confirmOpening('supplier-1', 'project-1'))
        .rejects.toMatchObject({ response: { code: 'RECORD_NOT_CONFIRMABLE' } });
      expect(prisma.bidOpeningRecord.updateMany).not.toHaveBeenCalled();
      expect(prisma.bidSupplier.update).not.toHaveBeenCalled();
    });

    it('confirmOpening 状态门：开标记录不存在 → 400 RECORD_NOT_CONFIRMABLE', async () => {
      prisma.bidProject.findUnique.mockResolvedValue({ stage: 'OPENING' });
      prisma.bidSupplier.findFirst.mockResolvedValue(decryptedSupplier);
      prisma.bidOpeningRecord.findFirst.mockResolvedValue(null);

      await expect(service.confirmOpening('supplier-1', 'project-1'))
        .rejects.toMatchObject({ response: { code: 'RECORD_NOT_CONFIRMABLE' } });
      expect(prisma.bidSupplier.update).not.toHaveBeenCalled();
    });

    it.each([
      ['异议已处理-退回'], // R7 闭环：退回后不可再异议（走线下/书面渠道）
      ['供应商已确认'],
      ['异议已处理-确认'],
    ])('disputeOpening 状态门：%s 态记录异议 → 400 RECORD_NOT_DISPUTABLE', async (confirmStatus) => {
      prisma.bidProject.findUnique.mockResolvedValue({ stage: 'OPENING' });
      prisma.bidSupplier.findFirst.mockResolvedValue(decryptedSupplier);
      prisma.bidOpeningRecord.findFirst.mockResolvedValue({ id: 'r-1', confirmStatus });

      await expect(service.disputeOpening('supplier-1', 'project-1', '报价有误'))
        .rejects.toMatchObject({ response: { code: 'RECORD_NOT_DISPUTABLE' } });
      expect(prisma.bidOpeningRecord.updateMany).not.toHaveBeenCalled();
      expect(prisma.bidSupplier.update).not.toHaveBeenCalled();
    });
  });

  describe('saveBidDraft', () => {
    it('rejects draft save for non-APPROVED suppliers', async () => {
      prisma.supplier.findUnique.mockResolvedValue({ id: 'supplier-2', name: '待审供应商', status: 'PENDING' });
      prisma.bidProject.findUnique.mockResolvedValue({
        id: 'project-1', stage: 'SUBMIT', deadline: new Date(Date.now() + 3600_000),
      });

      await expect(service.saveBidDraft('supplier-2', 'project-1', { bidPrice: '100' }))
        .rejects.toMatchObject({ response: { code: 'NOT_APPROVED' } });
    });

    it('rejects draft save after project leaves draftable stages', async () => {
      prisma.supplier.findUnique.mockResolvedValue({ id: 'supplier-1', name: '测试供应商', status: 'APPROVED' });
      prisma.bidProject.findUnique.mockResolvedValue({
        id: 'project-1', stage: 'OPENING', deadline: new Date(Date.now() + 3600_000),
      });

      await expect(service.saveBidDraft('supplier-1', 'project-1', { bidPrice: '100' }))
        .rejects.toMatchObject({ response: { code: 'PROJECT_NOT_DRAFTABLE' } });
    });
  });

  describe('withdrawSubmission', () => {
    it('syncs linked BidSupplier status when a submitted bid is withdrawn in SUBMIT stage', async () => {
      prisma.supplierBidSubmission.findUnique.mockResolvedValue({
        id: 'sub-1', supplierId: 'supplier-1', projectId: 'project-1', status: 'submitted',
      });
      prisma.bidProject.findUnique.mockResolvedValue({ id: 'project-1', stage: 'SUBMIT', name: '测试项目' });
      prisma.supplierBidSubmission.update.mockResolvedValue({
        id: 'sub-1', supplierId: 'supplier-1', projectId: 'project-1', status: 'withdrawn',
      });
      prisma.bidSupplier.updateMany.mockResolvedValue({ count: 1 });
      prisma.bidSupervisionLog.create.mockResolvedValue({});
      prisma.$transaction = jest.fn(async (callback: any) => callback(prisma));

      const result = await service.withdrawSubmission('supplier-1', 'sub-1');

      expect(result.status).toBe('withdrawn');
      expect(prisma.bidSupplier.updateMany).toHaveBeenCalledWith({
        where: { projectId: 'project-1', supplierId: 'supplier-1' },
        data: { submitStatus: '已撤回', encryptStatus: '已撤回' },
      });
      expect(prisma.bidSupervisionLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ action: '撤回投标', projectId: 'project-1' }),
        }),
      );
    });

    it('rejects withdrawal once project is OPENING or later', async () => {
      prisma.supplierBidSubmission.findUnique.mockResolvedValue({
        id: 'sub-1', supplierId: 'supplier-1', projectId: 'project-1', status: 'submitted',
      });
      prisma.bidProject.findUnique.mockResolvedValue({ id: 'project-1', stage: 'OPENING', name: '测试项目' });

      await expect(service.withdrawSubmission('supplier-1', 'sub-1'))
        .rejects.toMatchObject({ response: { code: 'PROJECT_ALREADY_OPENING' } });
    });
  });

  describe('listBidProjects', () => {
    it('返回招标项目列表，仅公开字段 + 投标方数量', async () => {
      prisma.bidProject.count.mockResolvedValue(1);
      prisma.bidProject.findMany.mockResolvedValue([{ id: 'p1', name: '项目一', stage: 'SUBMIT' }]);
      prisma.bidProject.groupBy.mockResolvedValue([]);

      const result = await service.listBidProjects();

      expect(result.items).toHaveLength(1);
      expect(result.total).toBe(1);
      expect(result.page).toBe(1);
      const select = prisma.bidProject.findMany.mock.calls[0][0].select;
      expect(select._count).toEqual({ select: { suppliers: true } });
      // 不得拉取其他投标方身份或评审内部数据
      for (const f of ['suppliers', 'openingRecords', 'openingSession', 'experts', 'scoreItems', 'supervisionLogs', 'archiveItems']) {
        expect(select[f]).toBeUndefined();
      }
    });
  });

  describe('getBidProject', () => {
    it('返回项目详情含澄清答疑，但不暴露投标方/开标记录/专家评分', async () => {
      prisma.bidProject.findUnique.mockResolvedValue({ id: 'p1', name: '项目一', clarifications: [] });

      const result = await service.getBidProject('p1');

      expect(result).not.toBeNull();
      expect(result!.id).toBe('p1');
      const select = prisma.bidProject.findUnique.mock.calls[0][0].select;
      expect(select.clarifications).toBeDefined();
      expect(select._count).toEqual({ select: { suppliers: true } });
      for (const f of ['suppliers', 'openingRecords', 'openingSession', 'experts', 'scoreItems', 'supervisionLogs', 'archiveItems']) {
        expect(select[f]).toBeUndefined();
      }
    });
  });
});
