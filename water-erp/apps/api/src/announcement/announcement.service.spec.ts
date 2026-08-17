import { Test, TestingModule } from '@nestjs/testing';
import { AnnouncementService } from './announcement.service';
import { AnnouncementAiService } from './announcement-ai.service';
import { PrismaService } from '../prisma/prisma.service';
import { sealField } from '../common/crypto/field-crypto';

// 解密门控断言依赖 KMS_SECRET（openField 拆封密封 bidPrice）。
const ANN_SPEC_KMS = 'test-kms-secret-from-announcement-spec';
const ANN_SPEC_ORIG_KMS = process.env.KMS_SECRET;
beforeAll(() => { process.env.KMS_SECRET = ANN_SPEC_KMS; });
afterAll(() => { if (ANN_SPEC_ORIG_KMS !== undefined) process.env.KMS_SECRET = ANN_SPEC_ORIG_KMS; else delete process.env.KMS_SECRET; });

describe('AnnouncementService — remove 级联清理 (H3)', () => {
  let service: AnnouncementService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      announcement: { findUnique: jest.fn(), delete: jest.fn() },
      bidProject: { findUnique: jest.fn(), update: jest.fn() },
      bidSupervisionLog: { create: jest.fn() },
      bidDocument: { updateMany: jest.fn() },
      bidOpeningSession: { deleteMany: jest.fn() },
      bidOpeningRecord: { deleteMany: jest.fn() },
      bidScoreRecord: { deleteMany: jest.fn() },
      bidEvaluationResult: { deleteMany: jest.fn() },
      bidInvalidBid: { deleteMany: jest.fn() },
      bidSupplier: { updateMany: jest.fn() },
      bidExpert: { updateMany: jest.fn() },
      // remove 级联：收集密封文件路径供 MinIO 孤儿清理
      supplierBidSubmission: { findMany: jest.fn().mockResolvedValue([]) },
      fileAsset: { findMany: jest.fn().mockResolvedValue([]), deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
      $transaction: jest.fn(async (cb: any) => cb(prisma)),
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AnnouncementService,
        { provide: PrismaService, useValue: prisma },
        { provide: AnnouncementAiService, useValue: {} },
      ],
    }).compile();
    service = module.get(AnnouncementService);
  });

  it('项目原处 EVALUATING 时重置 stage 并级联清理下游产物', async () => {
    prisma.announcement.findUnique.mockResolvedValue({ type: 'BID_NOTICE', relatedProjectCode: 'C1', status: 'PUBLISHED' });
    prisma.bidProject.findUnique.mockResolvedValue({ id: 'p1', projectCode: 'C1', stage: 'EVALUATING', riskNote: '' });
    prisma.bidProject.update.mockResolvedValue({});
    prisma.bidSupervisionLog.create.mockResolvedValue({});
    prisma.bidDocument.updateMany.mockResolvedValue({});
    prisma.announcement.delete.mockResolvedValue({});

    await service.remove('ann1');

    expect(prisma.bidOpeningSession.deleteMany).toHaveBeenCalledWith({ where: { projectId: 'p1' } });
    expect(prisma.bidOpeningRecord.deleteMany).toHaveBeenCalledWith({ where: { projectId: 'p1' } });
    expect(prisma.bidScoreRecord.deleteMany).toHaveBeenCalledWith({ where: { supplier: { projectId: 'p1' } } });
    expect(prisma.bidEvaluationResult.deleteMany).toHaveBeenCalledWith({ where: { projectId: 'p1' } });
    expect(prisma.bidInvalidBid.deleteMany).toHaveBeenCalledWith({ where: { projectId: 'p1' } });
    expect(prisma.bidSupplier.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { projectId: 'p1' }, data: expect.objectContaining({ decryptStatus: 'PENDING', confirmStatus: 'PENDING' }) }),
    );
    expect(prisma.bidExpert.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ reportConfirmed: false }) }),
    );
  });

  it('项目原处 DOWNLOAD（无需重置）时不做级联清理', async () => {
    prisma.announcement.findUnique.mockResolvedValue({ type: 'BID_NOTICE', relatedProjectCode: 'C1', status: 'PUBLISHED' });
    prisma.bidProject.findUnique.mockResolvedValue({ id: 'p1', projectCode: 'C1', stage: 'DOWNLOAD', riskNote: '' });
    prisma.bidProject.update.mockResolvedValue({});
    prisma.bidDocument.updateMany.mockResolvedValue({});
    prisma.announcement.delete.mockResolvedValue({});

    await service.remove('ann1');

    expect(prisma.bidOpeningSession.deleteMany).not.toHaveBeenCalled();
    expect(prisma.bidSupplier.updateMany).not.toHaveBeenCalled();
  });
});

describe('AnnouncementService — getParticipants 报价解密门控', () => {
  let service: AnnouncementService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      announcement: { findUnique: jest.fn() },
      bidProject: { findUnique: jest.fn() },
      bidSupplier: { findMany: jest.fn() },
      supplierBidSubmission: { findMany: jest.fn() },
      bidDocument: { findUnique: jest.fn().mockResolvedValue(null) },
      $transaction: jest.fn(async (cb: any) => cb(prisma)),
      bidDocumentAccess: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AnnouncementService,
        { provide: PrismaService, useValue: prisma },
        { provide: AnnouncementAiService, useValue: {} },
      ],
    }).compile();
    service = module.get(AnnouncementService);
  });

  it('未解密供应商 → 行不含 bidPrice（封存报价泄密修复：该字段已整体移出本端点）', async () => {
    // 现行口径：getParticipants 的 SupplierRow 不含 bidPrice——无论阶段/解密态一律不暴露报价。
    prisma.announcement.findUnique.mockResolvedValue({ type: 'BID_NOTICE', relatedProjectCode: 'C1' });
    prisma.bidProject.findUnique.mockResolvedValue({ id: 'p1', projectCode: 'C1', stage: 'OPENING', deadline: new Date() });
    prisma.bidSupplier.findMany.mockResolvedValue([
      { supplierId: 'su1', supplierName: '甲公司', decryptStatus: 'PENDING', submitStatus: '已提交', supplier: { classification: { name: 'A' } } },
    ]);
    const sealed = sealField('980000', ANN_SPEC_KMS);
    prisma.supplierBidSubmission.findMany.mockResolvedValue([
      { supplierId: 'su1', status: 'submitted', submittedAt: new Date(), bidPrice: sealed },
    ]);

    const result = await service.getParticipants('ann1');
    expect(result.suppliers[0]).not.toHaveProperty('bidPrice');
    expect(result.suppliers[0].submitted).toBe(true);
    expect(result.suppliers[0].submittedAt).not.toBeNull();
  });

  it('已解密（SUCCESS）供应商 → 行同样不含 bidPrice', async () => {
    prisma.announcement.findUnique.mockResolvedValue({ type: 'BID_NOTICE', relatedProjectCode: 'C1' });
    prisma.bidProject.findUnique.mockResolvedValue({ id: 'p1', projectCode: 'C1', stage: 'OPENING', deadline: new Date() });
    prisma.bidSupplier.findMany.mockResolvedValue([
      { supplierId: 'su1', supplierName: '甲公司', decryptStatus: 'SUCCESS', submitStatus: '已提交', supplier: { classification: { name: 'A' } } },
    ]);
    const sealed = sealField('1234567', ANN_SPEC_KMS);
    prisma.supplierBidSubmission.findMany.mockResolvedValue([
      { supplierId: 'su1', status: 'submitted', submittedAt: new Date(), bidPrice: sealed },
    ]);

    const result = await service.getParticipants('ann1');
    expect(result.suppliers[0]).not.toHaveProperty('bidPrice');
  });

  it('旧明文 bidPrice（无 v1: 前缀）也不应经 legacy 路径回归暴露', async () => {
    prisma.announcement.findUnique.mockResolvedValue({ type: 'BID_NOTICE', relatedProjectCode: 'C1' });
    prisma.bidProject.findUnique.mockResolvedValue({ id: 'p1', projectCode: 'C1', stage: 'EVALUATING', deadline: new Date() });
    prisma.bidSupplier.findMany.mockResolvedValue([
      { supplierId: 'su1', supplierName: '甲公司', decryptStatus: 'SUCCESS', submitStatus: '已提交', supplier: { classification: { name: 'A' } } },
    ]);
    prisma.supplierBidSubmission.findMany.mockResolvedValue([
      { supplierId: 'su1', status: 'submitted', submittedAt: new Date(), bidPrice: '770000' }, // legacy 明文
    ]);

    const result = await service.getParticipants('ann1');
    expect(result.suppliers[0]).not.toHaveProperty('bidPrice');
  });
});

describe('AnnouncementService — syncBidProject 公告直建补 PMI (N16-A)', () => {
  const makeSvc = async (bidService: any, projectManagementService: any, prismaOverrides: Record<string, any> = {}) => {
    const prisma: any = {
      bidProject: { findUnique: jest.fn().mockResolvedValue(null), update: jest.fn().mockResolvedValue({}) },
      announcement: { update: jest.fn().mockResolvedValue({}) },
      bidDocument: { findUnique: jest.fn().mockResolvedValue(null) },
      $transaction: jest.fn(async (cb: any) => cb(prisma)),
      ...prismaOverrides,
    };
    const { AnnouncementService: Svc } = await import('./announcement.service');
    const service: any = new (Svc as any)(prisma, {}, bidService, projectManagementService);
    return { service, prisma };
  };

  const ann = {
    id: 'ann1', title: '公告直建项目X', publishDate: new Date('2026-08-17T08:00:00Z'),
    authorId: 'author-1', relatedProjectCode: null,
    metadata: { method: '竞价采购', budget: 900000, openTime: '2026-08-20T10:00:00', deadline: '2026-08-25T17:00:00' },
  };

  it('无既有项目 → 建 BidProject 同时补建 PMI 并回填关联', async () => {
    const createFromAnnouncement = jest.fn().mockResolvedValue({ id: 'p1', projectCode: 'BID-1787000001', riskNote: '（来自公告自动创建）' });
    const createItemFromAnnouncement = jest.fn().mockResolvedValue({ id: 'pm-1', projectCode: 'JJ-2026081701' });
    const { service, prisma } = await makeSvc({ createFromAnnouncement }, { createItemFromAnnouncement });

    await service.syncBidProject('ann1', { ...ann });

    expect(createItemFromAnnouncement).toHaveBeenCalledTimes(1);
    expect(createItemFromAnnouncement).toHaveBeenCalledWith(
      prisma,
      expect.objectContaining({ title: '公告直建项目X', procurementMethod: '竞价采购', budget: 900000, authorId: 'author-1' }),
    );
    expect(prisma.bidProject.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'p1' },
        data: expect.objectContaining({ projectManagementItemId: 'pm-1' }),
      }),
    );
    expect(prisma.announcement.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { relatedProjectCode: 'BID-1787000001' } }),
    );
  });

  it('已有既有项目（幂等分支）→ 不再补建 PMI', async () => {
    const createItemFromAnnouncement = jest.fn();
    const { service } = await makeSvc({}, { createItemFromAnnouncement }, {
      bidProject: { findUnique: jest.fn().mockResolvedValue({ id: 'p-existing', projectCode: 'BID-1' }), update: jest.fn() },
    });

    await service.syncBidProject('ann1', { ...ann, relatedProjectCode: 'BID-1' });

    expect(createItemFromAnnouncement).not.toHaveBeenCalled();
  });
});
