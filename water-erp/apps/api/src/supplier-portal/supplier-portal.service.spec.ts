import { Test, TestingModule } from '@nestjs/testing';
import { SupplierPortalService } from './supplier-portal.service';
import { PrismaService } from '../prisma/prisma.service';
import { BidDocumentService } from '../announcement/bid-document.service';
import { SignatureService } from '../common/crypto/signature.service';
import { BidBackupService } from '../bid-backup/bid-backup.service';
import { LlmService } from '../local-ai/llm.service';

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
  let signature: { verify: jest.Mock; isValidPublicKey: jest.Mock };

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
      supplier: { findUnique: jest.fn(), update: jest.fn() },
      supplierCert: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
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
      bidOpeningSession: { findUnique: jest.fn(), update: jest.fn() },
      fileAsset: { findMany: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
      bidSupervisionLog: { create: jest.fn() },
      supplierChangeRecord: { count: jest.fn() },
      supplierQualification: { count: jest.fn() },
      notification: { count: jest.fn() },
      user: { findUnique: jest.fn() },
      announcement: { findFirst: jest.fn() },
      // PMI 桥接（resolveDisplayCode/listBidProjects 经 projectManagementItemId/projectCode 关联）
      projectManagementItem: { findMany: jest.fn().mockResolvedValue([]), findUnique: jest.fn().mockResolvedValue(null) },
      bidDocument: { findUnique: jest.fn(), findMany: jest.fn().mockResolvedValue([]) },
    };
    // G3 兜底默认放行（投递时校验已发布招标公告）；个别用例可覆盖为 null 验证拦截
    prisma.announcement.findFirst.mockResolvedValue({ id: 'notice-1' });

    // SignatureService mock（bindCert 公钥格式校验走 isValidPublicKey；默认 true，个别用例覆写 false）
    signature = { verify: jest.fn().mockReturnValue(true), isValidPublicKey: jest.fn().mockReturnValue(true) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SupplierPortalService,
        { provide: PrismaService, useValue: prisma },
        { provide: BidDocumentService, useValue: { getForSupplier: jest.fn() } },
        { provide: SignatureService, useValue: signature },
        { provide: BidBackupService, useValue: { stageBackup: jest.fn().mockResolvedValue(null), persistBackup: jest.fn(), isEnabled: jest.fn().mockReturnValue(true) } },
        // SupplierPortalService 构造器 @Inject('REDIS_CLIENT')（口径同 verification.service.spec.ts）
        { provide: 'REDIS_CLIENT', useValue: { get: jest.fn(), set: jest.fn(), del: jest.fn(), incr: jest.fn(), expire: jest.fn(), ttl: jest.fn() } },
        // 构造器第 6 参（BidGateway 为 @Optional，无需提供；本 spec 不触达 LLM）
        { provide: LlmService, useValue: {} },
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

    it('提交时落库质量承诺（qualityCommitment）', async () => {
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

      await service.submitBid('supplier-1', 'project-1', { bidPrice: '100', qualityCommitment: '满足招标文件要求，一次验收合格' } as any);

      expect(prisma.supplierBidSubmission.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ qualityCommitment: '满足招标文件要求，一次验收合格' }) }),
      );
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
      prisma.bidOpeningSession.findUnique = jest.fn().mockResolvedValue(null);
      prisma.bidOpeningSession.update = jest.fn().mockResolvedValue({});
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

  describe('getMyOpeningRecord（投递原值回显）', () => {
    it('返回唱标记录 + 本人投递原值（报价解封 + mismatch 标志）', async () => {
      prisma.bidSupplier.findFirst.mockResolvedValue({ id: 'bs-1' });
      prisma.bidOpeningRecord.findFirst.mockResolvedValue({
        id: 'r-1', amount: '980000', period: '120 日历天', qualityTarget: '合格', confirmStatus: '待供应商确认',
      });
      prisma.supplierBidSubmission.findUnique.mockResolvedValue({
        bidPrice: sealField('950000', process.env.KMS_SECRET!), deliveryPeriod: '120 日历天', qualityCommitment: '合格',
      });

      const result = await service.getMyOpeningRecord('supplier-1', 'project-1');

      expect(result).toMatchObject({ id: 'r-1', amount: '980000', confirmStatus: '待供应商确认' });
      expect(result!.submitted).toMatchObject({
        bidPrice: '950000', deliveryPeriod: '120 日历天', qualityCommitment: '合格',
        priceMismatch: true, periodMismatch: false,
      });
      // 双方均为元时归一值即原值（供前端显示「N 元」，与唱标总表单位统一）
      expect(result!.submitted!.bidPriceInYuan).toBe(950000);
    });

    it('投递价为万元时归一为元（151.2 万 → 1512000，与唱标总表单位统一）', async () => {
      prisma.bidSupplier.findFirst.mockResolvedValue({ id: 'bs-1' });
      prisma.bidOpeningRecord.findFirst.mockResolvedValue({
        id: 'r-1', amount: '1488000', period: '120 日历天', qualityTarget: '合格', confirmStatus: '待供应商确认',
      });
      prisma.supplierBidSubmission.findUnique.mockResolvedValue({
        bidPrice: sealField('151.2', process.env.KMS_SECRET!), deliveryPeriod: '120 日历天', qualityCommitment: '合格',
      });

      const result = await service.getMyOpeningRecord('supplier-1', 'project-1');

      expect(result!.submitted).toMatchObject({ bidPrice: '151.2', bidPriceInYuan: 1512000, priceMismatch: true });
    });

    it('未唱标时仍返回本人投递原值（不暴露他人数据）', async () => {
      prisma.bidSupplier.findFirst.mockResolvedValue({ id: 'bs-1' });
      prisma.bidOpeningRecord.findFirst.mockResolvedValue(null);
      prisma.supplierBidSubmission.findUnique.mockResolvedValue({
        bidPrice: null, deliveryPeriod: '90 日历天', qualityCommitment: null,
      });

      const result = await service.getMyOpeningRecord('supplier-1', 'project-1');

      expect(result).toBeTruthy();
      expect(result!.submitted).toMatchObject({
        bidPrice: null, deliveryPeriod: '90 日历天', priceMismatch: false, periodMismatch: false,
      });
      // 未唱标无锚点：归一值为 null（前端回落原值 + 投递表单单位）
      expect(result!.submitted!.bidPriceInYuan).toBeNull();
    });

    it('非本项目投标人 → null（与现状一致）', async () => {
      prisma.bidSupplier.findFirst.mockResolvedValue(null);
      await expect(service.getMyOpeningRecord('supplier-1', 'project-1')).resolves.toBeNull();
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
      prisma.bidProject.findUnique.mockResolvedValue({ id: 'project-1', stage: 'SUBMIT', name: '测试项目', deadline: new Date(Date.now() + 3600_000) });
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
      prisma.bidProject.findUnique.mockResolvedValue({ id: 'project-1', stage: 'OPENING', name: '测试项目', deadline: new Date(Date.now() + 3600_000) });

      await expect(service.withdrawSubmission('supplier-1', 'sub-1'))
        .rejects.toMatchObject({ response: { code: 'PROJECT_ALREADY_OPENING' } });
    });

    it('P1-2：投标截止后（stage 仍 SUBMIT）禁止撤回——DEADLINE_PASSED', async () => {
      prisma.supplierBidSubmission.findUnique.mockResolvedValue({
        id: 'sub-1', supplierId: 'supplier-1', projectId: 'project-1', status: 'submitted',
      });
      prisma.bidProject.findUnique.mockResolvedValue({ id: 'project-1', stage: 'SUBMIT', name: '测试项目', deadline: new Date(Date.now() - 60_000) });

      await expect(service.withdrawSubmission('supplier-1', 'sub-1'))
        .rejects.toMatchObject({ response: { code: 'DEADLINE_PASSED' } });
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

  describe('本人报价回显解封（P2）', () => {
    it('getMySubmissions 返回明文 bidPrice（v1: 密封经 openField 解封）', async () => {
      prisma.supplier.findUnique.mockResolvedValue(mockSupplier);
      prisma.supplierBidSubmission.findMany = jest.fn().mockResolvedValue([
        { id: 'sub-1', supplierId: 'supplier-1', projectId: 'p1', status: 'submitted', bidPrice: sealField('45', TEST_KMS), project: {} },
      ]);
      prisma.bidSupplier.findMany = jest.fn().mockResolvedValue([]);

      const rows = await service.getMySubmissions('supplier-1');
      expect(rows[0].bidPrice).toBe('45');
    });

    it('getSubmission 回读草稿同样解封', async () => {
      prisma.supplierBidSubmission.findUnique.mockResolvedValue({
        id: 'sub-1', supplierId: 'supplier-1', projectId: 'p1', status: 'draft', bidPrice: sealField('39.8', TEST_KMS),
      });
      const sub = await service.getSubmission('supplier-1', 'p1');
      expect((sub as any).bidPrice).toBe('39.8');
    });
  });

  describe('投递准入「受邀即准入」+ 门户可见性（P0-2）', () => {
    const futureProject = { id: 'p1', projectCode: 'BID-1', stage: 'SUBMIT', deadline: new Date(Date.now() + 3600_000), projectManagementItemId: 'pmi-1' };

    it('无公告但存在 ACCEPTED 邀请回执（projectId=PMI id）→ 放行投递', async () => {
      prisma.supplier.findUnique.mockResolvedValue(mockSupplier);
      prisma.bidProject.findUnique.mockResolvedValue(futureProject);
      prisma.announcement.findFirst.mockResolvedValue(null);
      prisma.invitationRsvp = { findFirst: jest.fn().mockResolvedValue({ id: 'rsvp-1' }) };
      prisma.bidSupplier.findFirst.mockResolvedValue(null);

      const r = await (service as any).assertCanSubmitBid('supplier-1', 'p1');
      expect(r.project.id).toBe('p1');
      expect(prisma.invitationRsvp.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { supplierId: 'supplier-1', projectId: 'pmi-1', status: 'ACCEPTED' } }),
      );
    });

    it('无公告且已在候选名单（BidSupplier 行）→ 放行投递', async () => {
      prisma.supplier.findUnique.mockResolvedValue(mockSupplier);
      prisma.bidProject.findUnique.mockResolvedValue(futureProject);
      prisma.announcement.findFirst.mockResolvedValue(null);
      prisma.invitationRsvp = { findFirst: jest.fn().mockResolvedValue(null) };
      prisma.bidSupplier.findFirst.mockResolvedValue({ id: 'bs-1' });

      await expect((service as any).assertCanSubmitBid('supplier-1', 'p1')).resolves.toBeTruthy();
    });

    it('无公告、无回执、无候选行 → 仍拦截 BID_NOTICE_REQUIRED', async () => {
      prisma.supplier.findUnique.mockResolvedValue(mockSupplier);
      prisma.bidProject.findUnique.mockResolvedValue(futureProject);
      prisma.announcement.findFirst.mockResolvedValue(null);
      prisma.invitationRsvp = { findFirst: jest.fn().mockResolvedValue(null) };
      prisma.bidSupplier.findFirst.mockResolvedValue(null);

      await expect((service as any).assertCanSubmitBid('supplier-1', 'p1')).rejects.toMatchObject({
        response: { code: 'BID_NOTICE_REQUIRED' },
      });
    });

    it('listBidProjects：公开可见性含已发布公告解析的项目 + 阶段限定 DOWNLOAD/SUBMIT', async () => {
      const future = new Date(Date.now() + 3600_000);
      prisma.bidSupplier.findMany = jest.fn().mockResolvedValue([{ projectId: 'bp-inv' }]); // 受邀分支
      prisma.bidDocument.findMany.mockImplementation(async ({ where }: any) => {
        // openIds 查询（accessScope OPEN）与后续富化查询按 where 形状区分
        if (where?.accessScope === 'OPEN') return [{ bidProjectId: 'bp-doc' }];
        return [];
      });
      prisma.announcement.findMany = jest.fn().mockResolvedValue([{ relatedProjectCode: 'BID-ANN' }]);
      // 公告业务编号 → PMI 桥接（resolveDisplayCode/listBidProjects 均经此关联回 BidProject）
      prisma.projectManagementItem.findMany.mockImplementation(async ({ where }: any) => {
        if (where?.projectCode?.in) return [{ id: 'pmi-ann' }];
        return [];
      });
      const finalQueries: any[] = [];
      prisma.bidProject.findMany.mockImplementation(async ({ where }: any) => {
        finalQueries.push(where);
        // 受邀项目明细查询（top-level id.in）→ 返回非直接采购项目，放行受邀分支
        if (where?.id?.in) return [{ id: 'bp-inv', procurementMethod: '谈判采购', projectManagementItemId: null, projectCode: 'BID-INV' }];
        // 公告编号→项目桥接（OR[0].projectCode.in）→ 解析出 bp-ann
        if (where?.OR?.[0]?.projectCode?.in) return [{ id: 'bp-ann' }];
        // 主列表查询（OR 分支为 id.in）
        if (where?.OR) return [{ id: 'bp-inv', projectCode: 'X', name: 'N', stage: 'SUBMIT', deadline: future, openTime: future, createdAt: new Date() }];
        return [];                                                       // allProjectIds 计数查询
      });
      prisma.bidProject.count.mockResolvedValue(1);

      await service.listBidProjects(1, 20, {}, 'supplier-1');

      // 受邀项目查询：先按 id 取受邀项目（区分直接采购须公告发布）
      const invitedQuery = finalQueries.find(w => w?.id?.in?.includes('bp-inv'));
      expect(invitedQuery).toBeDefined();
      // 公告桥接：先按业务编号查 PMI，再 OR(内部编号, projectManagementItemId) 查 BidProject
      const bridgeQuery = finalQueries.find(w => w?.OR?.some((b: any) => b?.projectManagementItemId?.in?.includes('pmi-ann')));
      expect(bridgeQuery).toBeDefined();
      // 最终可见性 OR 分支：公开（bp-doc+bp-ann）与受邀（bp-inv）均限定 DOWNLOAD/SUBMIT
      const listWhere = finalQueries.find(w => w?.OR?.some((b: any) => b?.stage));
      expect(listWhere).toBeDefined();
      const orBranches = listWhere!.OR as any[];
      const openBranch = orBranches.find(b => b.id?.in?.includes('bp-ann'));
      expect(openBranch).toBeDefined();
      expect(openBranch!.id.in).toEqual(expect.arrayContaining(['bp-doc', 'bp-ann']));
      expect(openBranch!.deadline.gt).toBeInstanceOf(Date);
      expect(openBranch!.stage).toEqual({ in: ['DOWNLOAD', 'SUBMIT'] });
      // 受邀分支：同样限定投递阶段（OPENING+ 靠投标进展/开标大厅，不再混入可投标列表）
      const invitedBranch = orBranches.find(b => b.id?.in?.includes('bp-inv'));
      expect(invitedBranch).toBeDefined();
      expect(invitedBranch!.stage).toEqual({ in: ['DOWNLOAD', 'SUBMIT'] });
    });
  });

  describe('listOpeningRecords（大厅公开视图）', () => {
    const mockRecords = [
      { id: 'r-1', bidSupplierId: 'bs-1', supplierName: '四川川水建设工程有限公司', amount: '4200000', period: '120 日历天', qualityTarget: '合格', bondStatus: '已缴纳', decryptResult: '解密成功', confirmStatus: '待供应商确认', confirmedAt: null, objectionReason: null, handleResult: null, handledBy: null, createdAt: new Date('2026-08-17T09:00:00Z') },
      { id: 'r-2', bidSupplierId: 'bs-2', supplierName: '成都华建地质工程科技有限公司', amount: '3980000', period: '110 日历天', qualityTarget: '优良', bondStatus: '保函有效', decryptResult: '解密成功', confirmStatus: '供应商已确认', confirmedAt: new Date('2026-08-17T09:05:00Z'), objectionReason: '异议已处理', handleResult: '维持原记录', handledBy: 'user-host', createdAt: new Date('2026-08-17T09:02:00Z') },
    ];

    it('OPENING 阶段返回全部记录（createdAt 升序）且剥离异议过程字段', async () => {
      prisma.bidSupplier.findFirst.mockResolvedValue({ id: 'bs-1' });
      prisma.bidProject.findUnique.mockResolvedValue({ stage: 'OPENING' });
      prisma.bidOpeningRecord.findMany.mockResolvedValue(mockRecords);

      const result = await service.listOpeningRecords('supplier-1', 'project-1');

      expect(prisma.bidOpeningRecord.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { projectId: 'project-1' }, orderBy: { createdAt: 'asc' } }),
      );
      expect(result).toHaveLength(2);
      expect(result[0]).toMatchObject({ supplierName: '四川川水建设工程有限公司', amount: '4200000' });
      expect(result[1].confirmStatus).toBe('供应商已确认');
      // 脱敏口径：select 白名单不含异议裁决过程字段——jest mock 不过滤字段（返回原对象），
      // 故以 select 断言契约（Prisma 运行时按 select 下发，不含即不返回）。
      const select = prisma.bidOpeningRecord.findMany.mock.calls[0][0].select;
      for (const f of ['objectionReason', 'handleResult', 'handledBy', 'handledAt']) {
        expect(select[f]).toBeUndefined();
      }
      expect(select.confirmStatus).toBe(true);
    });

    it('EVALUATING/ARCHIVED 阶段同样可见（唱标信息开标后属公开信息）', async () => {
      prisma.bidSupplier.findFirst.mockResolvedValue({ id: 'bs-1' });
      prisma.bidProject.findUnique.mockResolvedValue({ stage: 'ARCHIVED' });
      prisma.bidOpeningRecord.findMany.mockResolvedValue(mockRecords);

      await expect(service.listOpeningRecords('supplier-1', 'project-1')).resolves.toHaveLength(2);
    });

    it('开标前（SUBMIT）→ 400 OPENING_NOT_STARTED', async () => {
      prisma.bidSupplier.findFirst.mockResolvedValue({ id: 'bs-1' });
      prisma.bidProject.findUnique.mockResolvedValue({ stage: 'SUBMIT' });

      await expect(service.listOpeningRecords('supplier-1', 'project-1'))
        .rejects.toMatchObject({ response: { code: 'OPENING_NOT_STARTED' } });
      expect(prisma.bidOpeningRecord.findMany).not.toHaveBeenCalled();
    });

    it('非本项目投标人 → 403 NOT_PROJECT_MEMBER', async () => {
      prisma.bidSupplier.findFirst.mockResolvedValue(null);

      await expect(service.listOpeningRecords('supplier-1', 'project-1'))
        .rejects.toMatchObject({ response: { code: 'NOT_PROJECT_MEMBER' } });
      expect(prisma.bidOpeningRecord.findMany).not.toHaveBeenCalled();
    });

    it('项目不存在 → 400 NOT_FOUND', async () => {
      prisma.bidSupplier.findFirst.mockResolvedValue({ id: 'bs-1' });
      prisma.bidProject.findUnique.mockResolvedValue(null);

      await expect(service.listOpeningRecords('supplier-1', 'project-1'))
        .rejects.toMatchObject({ response: { code: 'NOT_FOUND' } });
    });
  });

  describe('bindCert / revokeCert（CA 证书绑定，双信封 v2）', () => {
    // SM2 公钥：04 + 128 hex（130 位）
    const VALID_PUBKEY = `04${'ab'.repeat(64)}`;
    const BIND_INPUT = {
      certSn: 'SN-001',
      certDn: 'CN=四川水发建设有限公司,O=测试CA中心',
      publicKey: VALID_PUBKEY,
    };

    it('绑定成功：DN 与企业名一致 → 创建 ACTIVE 证书 + 回填 sm2PublicKey + 旧 ACTIVE 证书转 REVOKED（一证一 ACTIVE）', async () => {
      prisma.supplier.findUnique.mockResolvedValue({ id: 'supplier-1', name: '四川水发建设有限公司' });
      prisma.supplierCert.findUnique.mockResolvedValue(null);
      prisma.supplierCert.updateMany.mockResolvedValue({ count: 1 });
      prisma.supplierCert.create.mockResolvedValue({ id: 'cert-1', supplierId: 'supplier-1', certSn: 'SN-001', bindingStatus: 'ACTIVE' });
      prisma.supplier.update.mockResolvedValue({});

      const result = await service.bindCert('supplier-1', BIND_INPUT);

      // 创建新证（bindingStatus 默认 ACTIVE）
      expect(prisma.supplierCert.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            supplierId: 'supplier-1',
            certSn: 'SN-001',
            certDn: 'CN=四川水发建设有限公司,O=测试CA中心',
            publicKey: VALID_PUBKEY,
            alg: 'SM2',
          }),
        }),
      );
      // 同供应商旧 ACTIVE 证书先 REVOKED（换证/挂失语义：一证一 ACTIVE）
      expect(prisma.supplierCert.updateMany).toHaveBeenCalledWith({
        where: { supplierId: 'supplier-1', bindingStatus: 'ACTIVE' },
        data: expect.objectContaining({ bindingStatus: 'REVOKED', revokedAt: expect.any(Date) }),
      });
      // 存量列回填：激活 SM2 验签
      expect(prisma.supplier.update).toHaveBeenCalledWith({
        where: { id: 'supplier-1' },
        data: { sm2PublicKey: VALID_PUBKEY },
      });
      expect(result.cert).toMatchObject({ id: 'cert-1', bindingStatus: 'ACTIVE' });
    });

    it('DN 不匹配：CN 为别家公司 → 400 DN_MISMATCH，不落库', async () => {
      prisma.supplier.findUnique.mockResolvedValue({ id: 'supplier-1', name: '四川水发建设有限公司' });
      prisma.supplierCert.findUnique.mockResolvedValue(null);

      await expect(service.bindCert('supplier-1', { ...BIND_INPUT, certDn: 'CN=别家公司,O=测试' }))
        .rejects.toMatchObject({ response: { code: 'DN_MISMATCH' } });
      expect(prisma.supplierCert.create).not.toHaveBeenCalled();
      expect(prisma.supplier.update).not.toHaveBeenCalled();
    });

    it('公钥格式非法（05 开头）→ 400 INVALID_PUBLIC_KEY（复用 SignatureService.isValidPublicKey）', async () => {
      prisma.supplier.findUnique.mockResolvedValue({ id: 'supplier-1', name: '四川水发建设有限公司' });
      signature.isValidPublicKey.mockReturnValueOnce(false);

      await expect(service.bindCert('supplier-1', { ...BIND_INPUT, publicKey: `05${'ab'.repeat(64)}` }))
        .rejects.toMatchObject({ response: { code: 'INVALID_PUBLIC_KEY' } });
      // 格式判定委托给注入的 SignatureService（与验签同一口径，无正则复制）
      expect(signature.isValidPublicKey).toHaveBeenCalledWith(`05${'ab'.repeat(64)}`);
      expect(prisma.supplierCert.create).not.toHaveBeenCalled();
    });

    it('certSn 已被 ACTIVE 绑定（任何供应商）→ 409 CERT_SN_EXISTS', async () => {
      prisma.supplier.findUnique.mockResolvedValue({ id: 'supplier-1', name: '四川水发建设有限公司' });
      prisma.supplierCert.findUnique.mockResolvedValue({ id: 'cert-other', supplierId: 'supplier-OTHER', certSn: 'SN-001', bindingStatus: 'ACTIVE' });

      await expect(service.bindCert('supplier-1', BIND_INPUT))
        .rejects.toMatchObject({ response: { code: 'CERT_SN_EXISTS' } });
      expect(prisma.supplierCert.create).not.toHaveBeenCalled();
      expect(prisma.supplier.update).not.toHaveBeenCalled();
    });

    it('certSn 被其他供应商 REVOKED 持有 → 409 CERT_SN_EXISTS（certSn 全局唯一，不转移所有权）', async () => {
      prisma.supplier.findUnique.mockResolvedValue({ id: 'supplier-1', name: '四川水发建设有限公司' });
      prisma.supplierCert.findUnique.mockResolvedValue({ id: 'cert-other', supplierId: 'supplier-OTHER', certSn: 'SN-001', bindingStatus: 'REVOKED' });

      await expect(service.bindCert('supplier-1', BIND_INPUT))
        .rejects.toMatchObject({ response: { code: 'CERT_SN_EXISTS' } });
      expect(prisma.supplierCert.create).not.toHaveBeenCalled();
    });

    it('并发竞态：findUnique 检查双双通过后 create 撞 certSn 唯一约束（P2002）→ 409 CERT_SN_EXISTS 而非裸 500', async () => {
      prisma.supplier.findUnique.mockResolvedValue({ id: 'supplier-1', name: '四川水发建设有限公司' });
      // 竞态窗口：检查时另一并发请求尚未落库 → findUnique(null)，create 时才撞唯一约束
      prisma.supplierCert.findUnique.mockResolvedValue(null);
      const p2002: any = new Error('Unique constraint failed on the fields: (`certSn`)');
      p2002.code = 'P2002';
      prisma.supplierCert.create.mockRejectedValue(p2002);

      await expect(service.bindCert('supplier-1', BIND_INPUT))
        .rejects.toMatchObject({ response: { code: 'CERT_SN_EXISTS' } });
    });

    it('同名撤销证重绑：本供应商 REVOKED 证原行复用（update 置回 ACTIVE），不新建', async () => {
      prisma.supplier.findUnique.mockResolvedValue({ id: 'supplier-1', name: '四川水发建设有限公司' });
      prisma.supplierCert.findUnique.mockResolvedValue({ id: 'cert-old', supplierId: 'supplier-1', certSn: 'SN-001', bindingStatus: 'REVOKED' });
      prisma.supplierCert.updateMany.mockResolvedValue({ count: 0 });
      prisma.supplierCert.update.mockResolvedValue({ id: 'cert-old', supplierId: 'supplier-1', certSn: 'SN-001', bindingStatus: 'ACTIVE' });
      prisma.supplier.update.mockResolvedValue({});

      const result = await service.bindCert('supplier-1', { ...BIND_INPUT, certDn: 'CN=四川水发建设有限公司,O=测试' });

      expect(prisma.supplierCert.create).not.toHaveBeenCalled();
      expect(prisma.supplierCert.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'cert-old' },
          data: expect.objectContaining({ bindingStatus: 'ACTIVE', revokedAt: null, publicKey: VALID_PUBKEY }),
        }),
      );
      expect(prisma.supplier.update).toHaveBeenCalledWith({
        where: { id: 'supplier-1' },
        data: { sm2PublicKey: VALID_PUBKEY },
      });
      expect(result.cert).toMatchObject({ id: 'cert-old', bindingStatus: 'ACTIVE' });
    });

    it('撤销：置 REVOKED+revokedAt，并按 envelope.certSn 统计未开标依赖提交数', async () => {
      prisma.supplierCert.findUnique.mockResolvedValue({
        id: 'cert-1', supplierId: 'supplier-1', certSn: 'SN-001', bindingStatus: 'ACTIVE',
      });
      prisma.supplierCert.update.mockResolvedValue({
        id: 'cert-1', supplierId: 'supplier-1', certSn: 'SN-001', bindingStatus: 'REVOKED', revokedAt: new Date(),
      });
      prisma.supplierBidSubmission.count.mockResolvedValue(2);

      const result = await service.revokeCert('supplier-1', 'cert-1');

      expect(prisma.supplierCert.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'cert-1' },
          data: expect.objectContaining({ bindingStatus: 'REVOKED', revokedAt: expect.any(Date) }),
        }),
      );
      // Prisma Json path 过滤：envelope->>'certSn' = certSn
      expect(prisma.supplierBidSubmission.count).toHaveBeenCalledWith({
        where: { envelope: { path: ['certSn'], equals: 'SN-001' } },
      });
      expect(result.pendingSubmissions).toBe(2);
      expect(result).toMatchObject({ id: 'cert-1', bindingStatus: 'REVOKED' });
    });

    it('撤销他人证书 → 403 FORBIDDEN', async () => {
      prisma.supplierCert.findUnique.mockResolvedValue({
        id: 'cert-other', supplierId: 'supplier-OTHER', certSn: 'SN-X', bindingStatus: 'ACTIVE',
      });

      await expect(service.revokeCert('supplier-1', 'cert-other'))
        .rejects.toMatchObject({ response: { code: 'FORBIDDEN' } });
      expect(prisma.supplierCert.update).not.toHaveBeenCalled();
    });
  });
});
