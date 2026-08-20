import { Test, TestingModule } from '@nestjs/testing';
import { SupplierPortalService } from './supplier-portal.service';
import { PrismaService } from '../prisma/prisma.service';
import { BidDocumentService } from '../announcement/bid-document.service';
import { SignatureService } from '../common/crypto/signature.service';
import { DualEnvelopeService } from '../common/crypto/dual-envelope.service';
import { BidBackupService } from '../bid-backup/bid-backup.service';
import { LlmService } from '../local-ai/llm.service';
import {
  canonicalEnvelopeHash,
  canonicalJson,
  computeFieldsCommit,
  randomHex,
  sha256Hex,
  signEnvelopeMsg,
  sm2EncryptHex,
  sm4Encrypt,
  wrapDekJson,
} from '@water-erp/ukey';
import type { DualEnvelope, EnvelopeFileEntry, SealedFields } from '@water-erp/ukey';

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

// 双信封 v2 fixture：真实 SM2 密钥对（非被测代码自证循环），口径同 dual-envelope.service.spec.ts
const ukeySm2 = require('sm-crypto').sm2;

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
  let bidBackup: { stageBackup: jest.Mock; persistBackup: jest.Mock; isEnabled: jest.Mock };

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
      supplierCert: { findUnique: jest.fn(), findFirst: jest.fn(), create: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
      adminEncryptionCert: { findFirst: jest.fn() },
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
    // BidBackup mock 提升为共享变量——dual-v2 用例需断言 stageBackup/persistBackup 入参
    bidBackup = { stageBackup: jest.fn().mockResolvedValue(null), persistBackup: jest.fn(), isEnabled: jest.fn().mockReturnValue(true) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SupplierPortalService,
        { provide: PrismaService, useValue: prisma },
        { provide: BidDocumentService, useValue: { getForSupplier: jest.fn() } },
        { provide: SignatureService, useValue: signature },
        // 真 DualEnvelopeService（内部依赖上面 mock 的 SignatureService）——验签走真实 ukey SM2 链路
        { provide: DualEnvelopeService, useClass: DualEnvelopeService },
        { provide: BidBackupService, useValue: bidBackup },
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

  describe('getActiveAdminCert（管理方公钥公开端点，双信封 v2 投递端取用）', () => {
    it('存在 active 证书 → 返回 adminCertId/publicKey/certDn 三字段（adminCertId = 证书行 id）', async () => {
      prisma.adminEncryptionCert.findFirst.mockResolvedValue({
        id: 'admin-cert-1',
        publicKey: `04${'cd'.repeat(64)}`,
        certDn: 'CN=蜀水云采平台管理方,O=四川水发集团',
        active: true,
        createdAt: new Date('2026-08-20T00:00:00Z'),
      });

      const result = await service.getActiveAdminCert();

      expect(prisma.adminEncryptionCert.findFirst).toHaveBeenCalledWith({ where: { active: true } });
      expect(result).toEqual({
        adminCertId: 'admin-cert-1',
        publicKey: `04${'cd'.repeat(64)}`,
        certDn: 'CN=蜀水云采平台管理方,O=四川水发集团',
      });
    });

    it('无 active 证书 → 409 ADMIN_CERT_MISSING（bootstrap 后不应发生，兜底）', async () => {
      prisma.adminEncryptionCert.findFirst.mockResolvedValue(null);

      await expect(service.getActiveAdminCert())
        .rejects.toMatchObject({ response: { code: 'ADMIN_CERT_MISSING' } });
    });
  });

  // ═══ 双信封 v2 新轨（Task 9）：envelope.version='dual-v2' 且 BID_DUAL_ENVELOPE !== 'false' ═══
  // fixture 全部用 @water-erp/ukey 生产函数构造（真实 SM2/SM4 密封件 + 真签名），非自证循环。
  describe('submitBid 双信封 v2（dual-v2 新轨）', () => {
    const adminKp = ukeySm2.generateKeyPairHex();
    const supplierKp = ukeySm2.generateKeyPairHex();
    const wrongKp = ukeySm2.generateKeyPairHex();
    const DUAL_CERT_SN = 'MOCK-CERT-DUAL-0001';
    const FIELDS: SealedFields = { price: '980000.00', deliveryPeriod: '540', qualityCommitment: '合格' };
    const NONCE = 'n-dual-test-0001';
    const ORIG_FLAG = process.env.BID_DUAL_ENVELOPE;

    // 每角色独立明文/哈希/资产，支撑 bond 与多角色用例
    const DUAL_ROLE_TEXT: Record<string, string> = {
      technical: '技术标投标文件（dual-v2 测试）—智慧水发·蜀水云采',
      business: '商务标投标文件（dual-v2 测试）',
      coverLetter: '投标函（dual-v2 测试）',
      bond: '投标保证金缴纳凭证（dual-v2 测试）',
    };
    const DUAL_ROLE_SHA: Record<string, string> = {};
    let DUAL_TECH_SHA = ''; // = DUAL_ROLE_SHA.technical，既有用例沿用
    const dualAsset = (id = 'fa-dual-1', role = 'technical') => ({
      id, key: `uploads/2026-08-20/dual/couter-${role}.bin`, originalName: `${role}.pdf`,
      mimeType: 'application/pdf', size: 2048, sha256: DUAL_ROLE_SHA[role], category: 'bid_document',
      uploaderId: 'user-1', clientEncrypted: true, encrypted: false, sealedPath: null,
    });

    /** 生产侧语义构造合法信封（同 dual-envelope.service.spec 的 buildDualLayerSample/buildEnvelope）：
     *  C_outer 由客户端加密上传（asset.key 即密文），envelope 携带两把密封件 + 供应商层字段密封件。
     *  roles 指定参检角色（默认 technical），每角色独立 DEK 与真实 SM2 密封件。 */
    async function buildDualSubmission(overrides?: {
      envelope?: Partial<DualEnvelope>;
      roles?: Array<'technical' | 'business' | 'coverLetter' | 'bond'>;
      files?: Partial<Record<keyof DualEnvelope['files'], EnvelopeFileEntry>>;
    }): Promise<{ envelope: DualEnvelope; signature: string }> {
      const dekF = { keyHex: randomHex(16), ivHex: randomHex(16) };
      const mkEntry = () => {
        const dekS = { keyHex: randomHex(16), ivHex: randomHex(16) };
        const dekA = { keyHex: randomHex(16), ivHex: randomHex(16) };
        return {
          kself: sm2EncryptHex(supplierKp.publicKey, Buffer.from(wrapDekJson(dekS), 'utf8').toString('hex')),
          kadmin: sm2EncryptHex(adminKp.publicKey, Buffer.from(wrapDekJson(dekA), 'utf8').toString('hex')),
        };
      };
      const files: DualEnvelope['files'] = {};
      for (const role of overrides?.roles ?? ['technical']) {
        files[role] = { sha256: DUAL_ROLE_SHA[role], ...mkEntry() };
      }
      const envelope: DualEnvelope = {
        version: 'dual-v2',
        certSn: DUAL_CERT_SN,
        adminCertId: 'cert-admin-1',
        files,
        sealedFields: {
          cipher: sm4Encrypt(dekF.keyHex, dekF.ivHex, Buffer.from(canonicalJson({ fields: FIELDS, nonce: NONCE }), 'utf8').toString('hex')),
          kself: sm2EncryptHex(supplierKp.publicKey, Buffer.from(wrapDekJson(dekF), 'utf8').toString('hex')),
          fieldsSha256: await sha256Hex(canonicalJson(FIELDS)),
        },
        fieldsCommit: await computeFieldsCommit(FIELDS, NONCE),
        ...overrides?.envelope,
        ...(overrides?.files ? { files: overrides.files as DualEnvelope['files'] } : {}),
      };
      const signature = signEnvelopeMsg(await canonicalEnvelopeHash(envelope), supplierKp.privateKey);
      return { envelope, signature };
    }

    beforeAll(async () => {
      for (const [role, text] of Object.entries(DUAL_ROLE_TEXT)) {
        DUAL_ROLE_SHA[role] = await sha256Hex(Buffer.from(text, 'utf8'));
      }
      DUAL_TECH_SHA = DUAL_ROLE_SHA.technical;
    });
    afterAll(() => {
      if (ORIG_FLAG === undefined) delete process.env.BID_DUAL_ENVELOPE;
      else process.env.BID_DUAL_ENVELOPE = ORIG_FLAG;
    });
    // ⑥ 会置 BID_DUAL_ENVELOPE='false'——按用例还原，防 flag 泄漏到同 describe 后续用例（⑥b/⑦/⑧/⑨）
    afterEach(() => {
      if (ORIG_FLAG === undefined) delete process.env.BID_DUAL_ENVELOPE;
      else process.env.BID_DUAL_ENVELOPE = ORIG_FLAG;
    });

    beforeEach(() => {
      jest.clearAllMocks();
      prisma.supplierBidSubmission.findUnique.mockResolvedValue(null);
      prisma.supplier.findUnique.mockResolvedValue({ id: 'supplier-1', name: '测试供应商', status: 'APPROVED', userId: 'user-1' });
      prisma.bidProject.findUnique.mockResolvedValue({
        id: 'project-1', projectCode: 'BID-X', stage: 'SUBMIT',
        deadline: new Date(Date.now() + 3600_000), bondRequired: false,
      });
      prisma.announcement.findFirst.mockResolvedValue({ id: 'notice-1' });
      prisma.fileAsset.findMany.mockResolvedValue([dualAsset()]);
      prisma.fileAsset.findUnique.mockResolvedValue(dualAsset());
      prisma.fileAsset.update.mockResolvedValue(dualAsset());
      prisma.adminEncryptionCert.findFirst.mockResolvedValue({ id: 'cert-admin-1', publicKey: adminKp.publicKey, active: true });
      prisma.supplierCert.findFirst.mockResolvedValue({
        id: 'sc-1', supplierId: 'supplier-1', certSn: DUAL_CERT_SN,
        publicKey: supplierKp.publicKey, bindingStatus: 'ACTIVE',
      });
      prisma.supplierBidSubmission.create.mockResolvedValue({ id: 'sub-dual-1', status: 'submitted' });
      prisma.bidSupplier.findFirst.mockResolvedValue(null);
      prisma.bidSupplier.create.mockResolvedValue({ id: 'bs-dual-1' });
    });

    it('① 合法新轨提交：envelope 落库 / bidPrice null / fileHash=canonicalHash / backup v2 / 双层信封已验签', async () => {
      // stageBackup 返回 StagedBackup，使 persistBackup（cryptoVersion 断言点）被走到
      bidBackup.stageBackup.mockImplementation(async (input: any) => ({
        fileAssetId: input.fileAssetId, fileRole: input.fileRole,
        backupKey: `sealed-backup/project-1/supplier-1/${input.fileRole}/couter.bin`,
        sealedPath: input.sealedPath, wrappedDek: input.wrappedDek,
        ciphertextSha256: 'ab'.repeat(32), plaintextSha256: input.plaintextSha256, size: input.ciphertext.length,
      }));
      const { envelope, signature } = await buildDualSubmission();

      const result = await service.submitBid('supplier-1', 'project-1', {
        technicalFileAssetId: 'fa-dual-1', bidPrice: '980000', envelope, signature,
      } as any);

      expect(result.status).toBe('submitted');
      // 落库：envelope/envelopeVersion/fileHash/signature/signedAt + bidPrice 列 null（报价只在 sealedFields）
      const call = prisma.supplierBidSubmission.create.mock.calls[0][0];
      expect(call.data.envelope).toMatchObject({ version: 'dual-v2', certSn: DUAL_CERT_SN, adminCertId: 'cert-admin-1' });
      expect(call.data.envelopeVersion).toBe('dual-v2');
      expect(call.data.bidPrice).toBeNull();
      expect(call.data.fileHash).toBe(await canonicalEnvelopeHash(envelope));
      expect(call.data.signature).toBe(signature);
      expect(call.data.signedAt).toEqual(expect.any(Date));
      // sealedKey 列 = 双 DEK JSON（kself+kadmin+adminCertId 合账，单独一把不可读明文）
      const entry = envelope.files.technical!;
      expect(JSON.parse(call.data.technicalSealedKey)).toEqual({
        kself: entry.kself, kadmin: entry.kadmin, adminCertId: 'cert-admin-1',
      });
      // C_outer 已在 MinIO（asset.key），fileAsset 封存标记指向原路径，不再二次加密
      expect(encryptBuffer).not.toHaveBeenCalled();
      expect(prisma.fileAsset.update).toHaveBeenCalledWith({
        where: { id: 'fa-dual-1' },
        data: { encrypted: true, sealedPath: dualAsset().key },
      });
      // backup v2：sealedPath=asset.key、wrappedDek=JSON{kself,kadmin,adminCertId}、cryptoVersion=dual-envelope-v2
      expect(bidBackup.stageBackup).toHaveBeenCalledTimes(1);
      const sb = bidBackup.stageBackup.mock.calls[0][0];
      expect(sb.sealedPath).toBe(dualAsset().key);
      expect(sb.plaintextSha256).toBe(DUAL_TECH_SHA);
      expect(JSON.parse(sb.wrappedDek)).toEqual({ kself: entry.kself, kadmin: entry.kadmin, adminCertId: 'cert-admin-1' });
      expect(bidBackup.persistBackup).toHaveBeenCalledWith(
        expect.anything(), expect.anything(),
        expect.objectContaining({ cryptoVersion: 'dual-envelope-v2', backupSource: 'submission' }),
      );
      // BidSupplier 状态文案
      expect(prisma.bidSupplier.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ encryptStatus: '双层信封已验签' }) }),
      );
    });

    it('② asset 非 clientEncrypted → 400 BID_FILE_NOT_ENCRYPTED（拒收未按双层信封加密的文件）', async () => {
      prisma.fileAsset.findMany.mockResolvedValue([{ ...dualAsset(), clientEncrypted: false }]);
      prisma.fileAsset.findUnique.mockResolvedValue({ ...dualAsset(), clientEncrypted: false });
      const { envelope, signature } = await buildDualSubmission();

      await expect(service.submitBid('supplier-1', 'project-1', {
        technicalFileAssetId: 'fa-dual-1', envelope, signature,
      } as any)).rejects.toMatchObject({ response: { code: 'BID_FILE_NOT_ENCRYPTED' } });
      expect(prisma.supplierBidSubmission.create).not.toHaveBeenCalled();
    });

    it('③ envelope.adminCertId 与 active 管理方证书不符 → 400 ADMIN_CERT_CHANGED', async () => {
      const { envelope, signature } = await buildDualSubmission({ envelope: { adminCertId: 'cert-admin-OLD' } });

      await expect(service.submitBid('supplier-1', 'project-1', {
        technicalFileAssetId: 'fa-dual-1', envelope, signature,
      } as any)).rejects.toMatchObject({ response: { code: 'ADMIN_CERT_CHANGED' } });
      expect(prisma.supplierBidSubmission.create).not.toHaveBeenCalled();
    });

    it('③b 无 active 管理方证书 → 400 ADMIN_CERT_CHANGED', async () => {
      prisma.adminEncryptionCert.findFirst.mockResolvedValue(null);
      const { envelope, signature } = await buildDualSubmission();

      await expect(service.submitBid('supplier-1', 'project-1', {
        technicalFileAssetId: 'fa-dual-1', envelope, signature,
      } as any)).rejects.toMatchObject({ response: { code: 'ADMIN_CERT_CHANGED' } });
    });

    it('③c 信封条目 sha256 与 asset 明文哈希不符 → 400 ENVELOPE_INCOMPLETE（防调包/漏封）', async () => {
      const tampered: EnvelopeFileEntry = { sha256: 'ff'.repeat(32), kself: 'aa', kadmin: 'bb' };
      const { envelope, signature } = await buildDualSubmission({ files: { technical: tampered } });

      await expect(service.submitBid('supplier-1', 'project-1', {
        technicalFileAssetId: 'fa-dual-1', envelope, signature,
      } as any)).rejects.toMatchObject({ response: { code: 'ENVELOPE_INCOMPLETE' } });
    });

    it('③d 已投递角色在信封中缺条目 → 400 ENVELOPE_INCOMPLETE', async () => {
      const { envelope, signature } = await buildDualSubmission({ files: {} });

      await expect(service.submitBid('supplier-1', 'project-1', {
        technicalFileAssetId: 'fa-dual-1', envelope, signature,
      } as any)).rejects.toMatchObject({ response: { code: 'ENVELOPE_INCOMPLETE' } });
    });

    it('④ 验签失败（SupplierCert 公钥与签名密钥不匹配）→ 400 SM2_SIGNATURE_INVALID', async () => {
      prisma.supplierCert.findFirst.mockResolvedValue({
        id: 'sc-1', supplierId: 'supplier-1', certSn: DUAL_CERT_SN,
        publicKey: wrongKp.publicKey, bindingStatus: 'ACTIVE',
      });
      const { envelope, signature } = await buildDualSubmission();

      await expect(service.submitBid('supplier-1', 'project-1', {
        technicalFileAssetId: 'fa-dual-1', envelope, signature,
      } as any)).rejects.toMatchObject({ response: { code: 'SM2_SIGNATURE_INVALID' } });
      expect(prisma.supplierBidSubmission.create).not.toHaveBeenCalled();
    });

    it('④b 收紧口径：certSn 未命中本供应商 ACTIVE SupplierCert → 400，不回退 supplier.sm2PublicKey 列', async () => {
      // 供应商行带着「能验过的」sm2PublicKey——若实现回退该列，验签将通过；此处必须仍拒收。
      prisma.supplier.findUnique.mockResolvedValue({
        id: 'supplier-1', name: '测试供应商', status: 'APPROVED', userId: 'user-1',
        sm2PublicKey: supplierKp.publicKey,
      });
      prisma.supplierCert.findFirst.mockResolvedValue(null);
      const { envelope, signature } = await buildDualSubmission();

      await expect(service.submitBid('supplier-1', 'project-1', {
        technicalFileAssetId: 'fa-dual-1', envelope, signature,
      } as any)).rejects.toMatchObject({
        response: { code: 'SM2_SIGNATURE_INVALID', error: expect.stringContaining('未找到有效绑定证书') },
      });
      // 查询口径钉死：certSn + supplierId + bindingStatus ACTIVE 三条件
      expect(prisma.supplierCert.findFirst).toHaveBeenCalledWith({
        where: { supplierId: 'supplier-1', certSn: DUAL_CERT_SN, bindingStatus: 'ACTIVE' },
      });
    });

    it('⑤ 旧轨回归（flag 默认开、不传 envelope）：clientDeks E2EE 分支照旧', async () => {
      await service.submitBid('supplier-1', 'project-1', {
        technicalFileAssetId: 'fa-dual-1', bidPrice: '100',
        clientDeks: { 'fa-dual-1': 'aabbccdd:11223344:55667788' },
      } as any);

      const call = prisma.supplierBidSubmission.create.mock.calls[0][0];
      expect(call.data.envelope).toBeUndefined();
      expect(call.data.envelopeVersion).toBeUndefined();
      expect(call.data.technicalSealedKey).toBe('wrapped:aabbccdd:11223344:55667788'); // KMS wrapKey 旧口径
      expect(call.data.bidPrice).toMatch(/^v1:/); // 旧轨照旧密封报价
      expect(call.data.signedAt).toBeUndefined();
      expect(prisma.bidSupplier.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ encryptStatus: '密文已校验' }) }),
      );
      // 新轨触点全未进
      expect(prisma.supplierCert.findFirst).not.toHaveBeenCalled();
      expect(prisma.adminEncryptionCert.findFirst).not.toHaveBeenCalled();
    });

    it('⑥ flag 关（BID_DUAL_ENVELOPE=false）且 envelope 传入 → 仍走旧轨 + envelope 剥离不落库（防伪造信封）', async () => {
      process.env.BID_DUAL_ENVELOPE = 'false';
      const plainAsset = { ...dualAsset(), clientEncrypted: false };
      prisma.fileAsset.findMany.mockResolvedValue([plainAsset]);
      prisma.fileAsset.findUnique.mockResolvedValue(plainAsset);
      const { envelope, signature } = await buildDualSubmission();

      await service.submitBid('supplier-1', 'project-1', {
        technicalFileAssetId: 'fa-dual-1', envelope, signature,
      } as any);

      expect(encryptBuffer).toHaveBeenCalled(); // 旧轨服务端加密照旧
      const call = prisma.supplierBidSubmission.create.mock.calls[0][0];
      expect(call.data.signedAt).toBeUndefined();
      expect(call.data.technicalSealedKey).toBe('wrapped:key:iv:auth'); // encryptBuffer mock 的 decryptKey 经 wrapKey
      // flag-off 窗口零验签零哈希锚定 → envelope/envelopeVersion 不得落库
      //（管理方公钥公开、格式可伪造良好；若存为 dual-v2，flag 回开后下游按版本分派会误信）
      expect(call.data.envelope).toBeUndefined();
      expect(call.data.envelopeVersion).toBeUndefined();
      expect(prisma.bidSupplier.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ encryptStatus: '密文已校验' }) }),
      );
      // 新轨验签/证书触点全未进（flag 双向可退）
      expect(prisma.supplierCert.findFirst).not.toHaveBeenCalled();
      expect(prisma.adminEncryptionCert.findFirst).not.toHaveBeenCalled();
    });

    it('⑥b flag 开但 envelope.version 非 dual-v2 → 旧轨 + envelope 同样剥离不落库', async () => {
      const plainAsset = { ...dualAsset(), clientEncrypted: false };
      prisma.fileAsset.findMany.mockResolvedValue([plainAsset]);
      prisma.fileAsset.findUnique.mockResolvedValue(plainAsset);
      const { envelope, signature } = await buildDualSubmission();
      const junkVersion = { ...envelope, version: 'junk-v1' } as any;

      await service.submitBid('supplier-1', 'project-1', {
        technicalFileAssetId: 'fa-dual-1', envelope: junkVersion, signature,
      } as any);

      expect(encryptBuffer).toHaveBeenCalled();
      const call = prisma.supplierBidSubmission.create.mock.calls[0][0];
      expect(call.data.envelope).toBeUndefined();
      expect(call.data.envelopeVersion).toBeUndefined();
    });

    it('⑦a bond 双轨：bondRequired=true + bond 密封齐备（clientEncrypted + 信封条目）→ 通过且 bond 角色入备份/封存', async () => {
      prisma.bidProject.findUnique.mockResolvedValue({
        id: 'project-1', projectCode: 'BID-X', stage: 'SUBMIT',
        deadline: new Date(Date.now() + 3600_000), bondRequired: true,
      });
      const tech = dualAsset('fa-dual-1', 'technical');
      const bond = dualAsset('fa-bond-1', 'bond');
      const assets = [tech, bond];
      prisma.fileAsset.findMany.mockResolvedValue(assets);
      prisma.fileAsset.findUnique.mockImplementation(async ({ where }: any) => assets.find(a => a.id === where.id));
      bidBackup.stageBackup.mockImplementation(async (input: any) => ({
        fileAssetId: input.fileAssetId, fileRole: input.fileRole,
        backupKey: `sealed-backup/project-1/supplier-1/${input.fileRole}/couter.bin`,
        sealedPath: input.sealedPath, wrappedDek: input.wrappedDek,
        ciphertextSha256: 'ab'.repeat(32), plaintextSha256: input.plaintextSha256, size: input.ciphertext.length,
      }));
      const { envelope, signature } = await buildDualSubmission({ roles: ['technical', 'bond'] });

      await service.submitBid('supplier-1', 'project-1', {
        technicalFileAssetId: 'fa-dual-1', bidBondAssetId: 'fa-bond-1', envelope, signature,
      } as any);

      // bond 凭证与三标书角色同入备份（cryptoVersion=dual-envelope-v2）与 fileAsset 封存标记
      expect(bidBackup.stageBackup).toHaveBeenCalledTimes(2);
      expect(bidBackup.stageBackup).toHaveBeenCalledWith(expect.objectContaining({
        fileRole: 'bond', fileAssetId: 'fa-bond-1', sealedPath: bond.key, plaintextSha256: DUAL_ROLE_SHA.bond,
      }));
      expect(bidBackup.persistBackup).toHaveBeenCalledWith(
        expect.anything(), expect.anything(),
        expect.objectContaining({ cryptoVersion: 'dual-envelope-v2' }),
      );
      expect(prisma.fileAsset.update).toHaveBeenCalledWith({
        where: { id: 'fa-bond-1' },
        data: { encrypted: true, sealedPath: bond.key },
      });
      expect(prisma.supplierBidSubmission.create).toHaveBeenCalledTimes(1);
    });

    it('⑦b bond 双轨：bondRequired=true 但 bond 凭证未按双层信封加密 → 400 BID_FILE_NOT_ENCRYPTED', async () => {
      prisma.bidProject.findUnique.mockResolvedValue({
        id: 'project-1', projectCode: 'BID-X', stage: 'SUBMIT',
        deadline: new Date(Date.now() + 3600_000), bondRequired: true,
      });
      const tech = dualAsset('fa-dual-1', 'technical');
      const plainBond = { ...dualAsset('fa-bond-1', 'bond'), clientEncrypted: false };
      const assets = [tech, plainBond];
      prisma.fileAsset.findMany.mockResolvedValue(assets);
      prisma.fileAsset.findUnique.mockImplementation(async ({ where }: any) => assets.find(a => a.id === where.id));
      const { envelope, signature } = await buildDualSubmission({ roles: ['technical', 'bond'] });

      await expect(service.submitBid('supplier-1', 'project-1', {
        technicalFileAssetId: 'fa-dual-1', bidBondAssetId: 'fa-bond-1', envelope, signature,
      } as any)).rejects.toMatchObject({
        response: { code: 'BID_FILE_NOT_ENCRYPTED', error: expect.stringContaining('bond') },
      });
      expect(prisma.supplierBidSubmission.create).not.toHaveBeenCalled();
    });

    it('⑧ 多角色：technical+business 双密封齐备 → 通过且两角色备份/封存齐全', async () => {
      const tech = dualAsset('fa-dual-1', 'technical');
      const biz = dualAsset('fa-biz-1', 'business');
      const assets = [tech, biz];
      prisma.fileAsset.findMany.mockResolvedValue(assets);
      prisma.fileAsset.findUnique.mockImplementation(async ({ where }: any) => assets.find(a => a.id === where.id));
      bidBackup.stageBackup.mockImplementation(async (input: any) => ({
        fileAssetId: input.fileAssetId, fileRole: input.fileRole,
        backupKey: `sealed-backup/project-1/supplier-1/${input.fileRole}/couter.bin`,
        sealedPath: input.sealedPath, wrappedDek: input.wrappedDek,
        ciphertextSha256: 'ab'.repeat(32), plaintextSha256: input.plaintextSha256, size: input.ciphertext.length,
      }));
      const { envelope, signature } = await buildDualSubmission({ roles: ['technical', 'business'] });

      await service.submitBid('supplier-1', 'project-1', {
        technicalFileAssetId: 'fa-dual-1', businessFileAssetId: 'fa-biz-1', envelope, signature,
      } as any);

      expect(bidBackup.stageBackup).toHaveBeenCalledTimes(2);
      expect(bidBackup.stageBackup).toHaveBeenCalledWith(expect.objectContaining({
        fileRole: 'technical', fileAssetId: 'fa-dual-1', sealedPath: tech.key,
      }));
      expect(bidBackup.stageBackup).toHaveBeenCalledWith(expect.objectContaining({
        fileRole: 'business', fileAssetId: 'fa-biz-1', sealedPath: biz.key,
      }));
      const call = prisma.supplierBidSubmission.create.mock.calls[0][0];
      expect(JSON.parse(call.data.technicalSealedKey).adminCertId).toBe('cert-admin-1');
      expect(JSON.parse(call.data.businessSealedKey).adminCertId).toBe('cert-admin-1');
      expect(call.data.coverLetterSealedKey).toBeNull(); // 未投递角色不落密封件
    });

    it('⑨ saveBidDraft 携带 envelope → 草稿不落信封（验签是 submit 新轨专属，草稿一律剥离）', async () => {
      const { envelope, signature } = await buildDualSubmission();

      await service.saveBidDraft('supplier-1', 'project-1', {
        technicalFileAssetId: 'fa-dual-1', envelope, signature,
      } as any);

      const call = prisma.supplierBidSubmission.create.mock.calls[0][0];
      expect(call.data.envelope).toBeUndefined();
      expect(call.data.envelopeVersion).toBeUndefined();
    });
  });

  describe('reupload-dual（新轨补传·供应商端双层重封）', () => {
    const adminKp = ukeySm2.generateKeyPairHex();
    const supplierKp = ukeySm2.generateKeyPairHex();
    const REUP_CERT_SN = 'MOCK-CERT-REUP-0001';
    const FIELDS: SealedFields = { price: '980000.00', deliveryPeriod: '540', qualityCommitment: '合格' };
    const ROLE_TEXT = {
      technical: '技术标投标文件（reupload-dual 测试）——密文异常后由供应商端双层重封',
      business: '商务标投标文件（reupload-dual 测试）',
    };
    const ROLE_SHA: Record<'technical' | 'business', string> = { technical: '', business: '' };
    let ORIGINAL: DualEnvelope; // 投递时信封锚点：fieldsCommit/fieldsSha256 与 builder 确定性一致
    // file 字段收的是新 C_outer 密文（客户端重新双层加密产物，非明文）
    const C_OUTER = Buffer.from('couter-new-ciphertext-sealed-by-supplier-ukey');
    const dualAssetRow = (id = 'fa-reup-1', role: 'technical' | 'business' = 'technical') => ({
      id, key: `uploads/2026-08-20/dual/couter-${role}.bin`, originalName: `${role}.pdf`,
      mimeType: 'application/pdf', size: 2048, sha256: ROLE_SHA[role], category: 'bid_document',
      uploaderId: 'user-1', clientEncrypted: true, encrypted: true,
      sealedPath: `uploads/2026-08-20/dual/couter-${role}.bin`,
    });

    /**
     * 构造合法重签信封。fieldsCommit/fieldsSha256 可显式覆盖（改价攻击：签名按篡改后信封计算=有效签名，
     * 用以证明「仅靠验签拦不住、须对投递锚点逐字比对」）；technical:null 丢弃技术标条目；
     * withBusiness 追加合法商务标条目（多角色保全用例）。
     */
    async function buildReuploadEnvelope(opts?: {
      technical?: EnvelopeFileEntry | null;
      withBusiness?: boolean;
      business?: EnvelopeFileEntry | null;
      fieldsCommit?: string;
      fieldsSha256?: string;
    }) {
      const mkEntry = (sha: string) => ({
        sha256: sha,
        kself: sm2EncryptHex(supplierKp.publicKey, Buffer.from(wrapDekJson({ keyHex: randomHex(16), ivHex: randomHex(16) }), 'utf8').toString('hex')),
        kadmin: sm2EncryptHex(adminKp.publicKey, Buffer.from(wrapDekJson({ keyHex: randomHex(16), ivHex: randomHex(16) }), 'utf8').toString('hex')),
      });
      const files: DualEnvelope['files'] = {};
      if (opts?.technical !== null) files.technical = opts?.technical ?? mkEntry(ROLE_SHA.technical);
      if (opts?.business) files.business = opts.business;
      else if (opts?.business !== null && opts?.withBusiness) files.business = mkEntry(ROLE_SHA.business);
      const dekF = { keyHex: randomHex(16), ivHex: randomHex(16) };
      const nonce = 'n-reup-dual-0001';
      const envelope: DualEnvelope = {
        version: 'dual-v2', certSn: REUP_CERT_SN, adminCertId: 'cert-admin-1', files,
        sealedFields: {
          cipher: sm4Encrypt(dekF.keyHex, dekF.ivHex, Buffer.from(canonicalJson({ fields: FIELDS, nonce }), 'utf8').toString('hex')),
          kself: sm2EncryptHex(supplierKp.publicKey, Buffer.from(wrapDekJson(dekF), 'utf8').toString('hex')),
          fieldsSha256: opts?.fieldsSha256 ?? await sha256Hex(canonicalJson(FIELDS)),
        },
        fieldsCommit: opts?.fieldsCommit ?? await computeFieldsCommit(FIELDS, nonce),
      };
      const signature = signEnvelopeMsg(await canonicalEnvelopeHash(envelope), supplierKp.privateKey);
      return { envelope, signature };
    }

    beforeAll(async () => {
      ROLE_SHA.technical = await sha256Hex(Buffer.from(ROLE_TEXT.technical, 'utf8'));
      ROLE_SHA.business = await sha256Hex(Buffer.from(ROLE_TEXT.business, 'utf8'));
      ORIGINAL = (await buildReuploadEnvelope()).envelope;
    });

    beforeEach(() => {
      jest.clearAllMocks();
      prisma.bidProject.findUnique.mockResolvedValue({ id: 'project-1', stage: 'OPENING', bondRequired: false });
      prisma.supplier.findUnique.mockResolvedValue({ id: 'supplier-1', name: '测试供应商', status: 'APPROVED', userId: 'user-1' });
      prisma.supplierBidSubmission.findUnique.mockResolvedValue({
        id: 'sub-reup-1', supplierId: 'supplier-1', projectId: 'project-1', status: 'submitted',
        envelopeVersion: 'dual-v2', envelope: ORIGINAL,
        technicalFileAssetId: 'fa-reup-1', businessFileAssetId: null, coverLetterAssetId: null,
      });
      prisma.fileAsset.findUnique.mockResolvedValue(dualAssetRow());
      prisma.fileAsset.update.mockResolvedValue(dualAssetRow());
      prisma.adminEncryptionCert.findFirst.mockResolvedValue({ id: 'cert-admin-1', publicKey: adminKp.publicKey, active: true });
      prisma.supplierCert.findFirst.mockResolvedValue({
        id: 'sc-1', supplierId: 'supplier-1', certSn: REUP_CERT_SN,
        publicKey: supplierKp.publicKey, bindingStatus: 'ACTIVE',
      });
      prisma.bidSupplier.findFirst.mockResolvedValue({
        id: 'bs-reup-1', projectId: 'project-1', supplierId: 'supplier-1',
        supplierName: '测试供应商', decryptStatus: 'DANGER', decryptError: '解密异常',
      });
      prisma.bidSupplier.update.mockResolvedValue({ id: 'bs-reup-1' });
      prisma.supplierBidSubmission.update.mockResolvedValue({ id: 'sub-reup-1' });
      prisma.bidSupervisionLog.create.mockResolvedValue({});
    });

    it('SHA-256 闸门：新信封明文哈希 ≠ 原始 FileAsset.sha256 → 400 FILE_HASH_MISMATCH + 监督日志「新轨补传拦截」，零恢复写入', async () => {
      const { envelope, signature } = await buildReuploadEnvelope({ technical: { sha256: 'ff'.repeat(32), kself: 'aa', kadmin: 'bb' } });

      await expect(service.reuploadDualEnvelope('supplier-1', 'project-1', {
        role: 'technical', envelopeJson: JSON.stringify(envelope), signature, ciphertext: C_OUTER,
      })).rejects.toMatchObject({ response: { code: 'FILE_HASH_MISMATCH' } });

      expect(prisma.bidSupervisionLog.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ projectId: 'project-1', action: '新轨补传拦截', riskFlag: '高风险' }),
      }));
      expect(minioClient.putObject).not.toHaveBeenCalled();
      expect(prisma.fileAsset.update).not.toHaveBeenCalled();
      expect(prisma.supplierBidSubmission.update).not.toHaveBeenCalled();
      expect(prisma.bidSupplier.update).not.toHaveBeenCalled();
    });

    it('成功恢复：新 C_outer 落 MinIO dual-reupload/… + FileAsset.sealedPath 指新密文（sha256 锚点不动）+ submission 换 envelope/signature/fileHash + bidSupplier 重置 PENDING + 监督日志', async () => {
      const { envelope, signature } = await buildReuploadEnvelope();

      const result = await service.reuploadDualEnvelope('supplier-1', 'project-1', {
        role: 'technical', envelopeJson: JSON.stringify(envelope), signature, ciphertext: C_OUTER,
      });

      expect(result).toEqual({ recovered: true, message: '已恢复，请等待开标解密' });
      // 新 C_outer 密文落 MinIO（不覆盖原密文，独立 dual-reupload 前缀）
      expect(minioClient.putObject).toHaveBeenCalledTimes(1);
      const [bucket, objectName, body] = (minioClient.putObject as jest.Mock).mock.calls[0];
      expect(bucket).toBe('test-bucket');
      expect(objectName).toMatch(/^dual-reupload\/project-1\/supplier-1\/technical-\d+\.enc$/);
      expect(body).toEqual(C_OUTER);
      // FileAsset：sealedPath 指新密文；sha256 明文锚点与 clientEncrypted 不动（密文仍是客户端双层产物）
      expect(prisma.fileAsset.update).toHaveBeenCalledWith({
        where: { id: 'fa-reup-1' },
        data: { sealedPath: objectName, encrypted: true },
      });
      // submission：envelope/signature/fileHash=canonicalEnvelopeHash(新信封)/signedAt
      expect(prisma.supplierBidSubmission.update).toHaveBeenCalledWith({
        where: { supplierId_projectId: { supplierId: 'supplier-1', projectId: 'project-1' } },
        data: expect.objectContaining({
          envelope: expect.objectContaining({ version: 'dual-v2', certSn: REUP_CERT_SN, adminCertId: 'cert-admin-1' }),
          signature,
          fileHash: await canonicalEnvelopeHash(envelope),
          signedAt: expect.any(Date),
        }),
      });
      // bidSupplier：解密态重置 PENDING、decryptError 清空（等待 Task 12/13 管线重解）
      expect(prisma.bidSupplier.update).toHaveBeenCalledWith({
        where: { id: 'bs-reup-1' },
        data: { decryptStatus: 'PENDING', decryptError: null },
      });
      expect(prisma.bidSupervisionLog.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ projectId: 'project-1', action: '新轨补传（供应商端双层重封）', riskFlag: '高风险' }),
      }));
    });

    it('验签失败（签名私钥与证书公钥不匹配）→ 400 SM2_SIGNATURE_INVALID，零写入', async () => {
      const { envelope } = await buildReuploadEnvelope();
      const badSignature = signEnvelopeMsg(await canonicalEnvelopeHash(envelope), ukeySm2.generateKeyPairHex().privateKey);

      await expect(service.reuploadDualEnvelope('supplier-1', 'project-1', {
        role: 'technical', envelopeJson: JSON.stringify(envelope), signature: badSignature, ciphertext: C_OUTER,
      })).rejects.toMatchObject({ response: { code: 'SM2_SIGNATURE_INVALID' } });

      expect(minioClient.putObject).not.toHaveBeenCalled();
      expect(prisma.supplierBidSubmission.update).not.toHaveBeenCalled();
      expect(prisma.bidSupplier.update).not.toHaveBeenCalled();
    });

    it('非 OPENING 阶段（EVALUATING）→ 403 STAGE_NOT_OPENING，零查询零写入', async () => {
      prisma.bidProject.findUnique.mockResolvedValue({ id: 'project-1', stage: 'EVALUATING' });
      const { envelope, signature } = await buildReuploadEnvelope();

      await expect(service.reuploadDualEnvelope('supplier-1', 'project-1', {
        role: 'technical', envelopeJson: JSON.stringify(envelope), signature, ciphertext: C_OUTER,
      })).rejects.toMatchObject({ response: { code: 'STAGE_NOT_OPENING' } });

      expect(prisma.supplierBidSubmission.findUnique).not.toHaveBeenCalled();
      expect(minioClient.putObject).not.toHaveBeenCalled();
    });

    it('Critical（spec v6 §5.6）：新信封 fieldsCommit/fieldsSha256 与投递锚点不一致（即使重签有效）→ 400 FIELDS_COMMIT_CHANGED + 监督日志含「疑似借补传改价」，零写入', async () => {
      // 改价攻击：供应商换 FIELDS 重算 fieldsCommit 并用自己证书重签——签名链完全合法，只有锚点比对能拦。
      const commitAttack = await buildReuploadEnvelope({ fieldsCommit: 'ab'.repeat(32) });
      await expect(service.reuploadDualEnvelope('supplier-1', 'project-1', {
        role: 'technical', envelopeJson: JSON.stringify(commitAttack.envelope), signature: commitAttack.signature, ciphertext: C_OUTER,
      })).rejects.toMatchObject({ response: { code: 'FIELDS_COMMIT_CHANGED' } });
      expect(prisma.bidSupervisionLog.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({
          projectId: 'project-1', action: '新轨补传拦截',
          result: expect.stringContaining('疑似借补传改价'), riskFlag: '高风险',
        }),
      }));

      // fieldsSha256 变体（fieldsCommit 不动）：同一收口
      const shaAttack = await buildReuploadEnvelope({ fieldsSha256: 'cd'.repeat(32) });
      await expect(service.reuploadDualEnvelope('supplier-1', 'project-1', {
        role: 'technical', envelopeJson: JSON.stringify(shaAttack.envelope), signature: shaAttack.signature, ciphertext: C_OUTER,
      })).rejects.toMatchObject({ response: { code: 'FIELDS_COMMIT_CHANGED' } });

      expect(minioClient.putObject).not.toHaveBeenCalled();
      expect(prisma.supplierBidSubmission.update).not.toHaveBeenCalled();
      expect(prisma.bidSupplier.update).not.toHaveBeenCalled();
    });

    it('多角色保全：补 technical 时 business 条目整体保留（防客户端 JSON 整体替换丢角色）；business 条目缺失 → 400 ENVELOPE_INCOMPLETE', async () => {
      // submission 挂双角色资产；FileAsset 按 id 分派
      prisma.fileAsset.findUnique.mockImplementation(async ({ where }: any) =>
        where.id === 'fa-reup-1' ? dualAssetRow() : where.id === 'fa-reup-2' ? dualAssetRow('fa-reup-2', 'business') : null);
      prisma.supplierBidSubmission.findUnique.mockResolvedValue({
        id: 'sub-reup-1', supplierId: 'supplier-1', projectId: 'project-1', status: 'submitted',
        envelopeVersion: 'dual-v2', envelope: ORIGINAL,
        technicalFileAssetId: 'fa-reup-1', businessFileAssetId: 'fa-reup-2', coverLetterAssetId: null,
      });

      const { envelope, signature } = await buildReuploadEnvelope({ withBusiness: true });
      await service.reuploadDualEnvelope('supplier-1', 'project-1', {
        role: 'technical', envelopeJson: JSON.stringify(envelope), signature, ciphertext: C_OUTER,
      });
      // 落库信封两个角色条目都完整保留（与提交信封逐字一致）
      const data = prisma.supplierBidSubmission.update.mock.calls[0][0].data;
      expect(data.envelope.files.technical).toEqual(envelope.files.technical);
      expect(data.envelope.files.business).toEqual(envelope.files.business);

      // 新信封丢掉 business 条目（整体替换场景）→ 拒收，防静默丢失商务标密封件
      const dropped = await buildReuploadEnvelope();
      await expect(service.reuploadDualEnvelope('supplier-1', 'project-1', {
        role: 'technical', envelopeJson: JSON.stringify(dropped.envelope), signature: dropped.signature, ciphertext: C_OUTER,
      })).rejects.toMatchObject({ response: { code: 'ENVELOPE_INCOMPLETE' } });
    });

    it('signature 缺失 → 入口显式 400 SM2_SIGNATURE_INVALID（error 文案「缺少签名或签名验证失败」），不走空串冒充验签失败', async () => {
      const { envelope } = await buildReuploadEnvelope();

      await expect(service.reuploadDualEnvelope('supplier-1', 'project-1', {
        role: 'technical', envelopeJson: JSON.stringify(envelope), ciphertext: C_OUTER,
      })).rejects.toMatchObject({
        response: { code: 'SM2_SIGNATURE_INVALID', error: '缺少签名或签名验证失败' },
      });

      expect(prisma.supplierCert.findFirst).not.toHaveBeenCalled();
      expect(minioClient.putObject).not.toHaveBeenCalled();
    });
  });

});
