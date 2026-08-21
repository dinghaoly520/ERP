import { Test, TestingModule } from '@nestjs/testing';
import { AnnouncementService } from './announcement.service';
import { AnnouncementAiService } from './announcement-ai.service';
import { PrismaService } from '../prisma/prisma.service';
import { sealField } from '../common/crypto/field-crypto';
import { minioClient } from '../upload/minio.client';

// 解密门控断言依赖 KMS_SECRET（openField 拆封密封 bidPrice）。
const ANN_SPEC_KMS = 'test-kms-secret-from-announcement-spec';
const ANN_SPEC_ORIG_KMS = process.env.KMS_SECRET;
beforeAll(() => { process.env.KMS_SECRET = ANN_SPEC_KMS; });
afterAll(() => { if (ANN_SPEC_ORIG_KMS !== undefined) process.env.KMS_SECRET = ANN_SPEC_ORIG_KMS; else delete process.env.KMS_SECRET; });

describe('AnnouncementService — P0-4 删除闸门（进行中项目禁删公告）', () => {
  let service: AnnouncementService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      announcement: { findUnique: jest.fn(), delete: jest.fn() },
      bidProject: { findUnique: jest.fn(), update: jest.fn() },
      bidDocument: { updateMany: jest.fn() },
      bidOpeningSession: { deleteMany: jest.fn() },
      bidOpeningRecord: { deleteMany: jest.fn() },
      bidScoreRecord: { deleteMany: jest.fn() },
      bidEvaluationResult: { deleteMany: jest.fn() },
      bidInvalidBid: { deleteMany: jest.fn() },
      $transaction: jest.fn(async (cb: any) => cb(prisma)),
    };
    // 监听 MinIO 清理调用（若被触发将断言零调用；mock 掉真实实现避免误连 MinIO）
    jest.spyOn(minioClient, 'removeObject').mockResolvedValue(undefined);
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AnnouncementService,
        { provide: PrismaService, useValue: prisma },
        { provide: AnnouncementAiService, useValue: {} },
      ],
    }).compile();
    service = module.get(AnnouncementService);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  const inFlightStages = ['SUBMIT', 'OPENING', 'EVALUATING'] as const;
  for (const stage of inFlightStages) {
    it(`${stage} 项目删公告 → 409 BID_IN_PROGRESS 且零销毁副作用`, async () => {
      prisma.announcement.findUnique.mockResolvedValue({ id: 'a1', relatedProjectCode: 'X', type: 'BID_NOTICE', status: 'PUBLISHED' });
      prisma.bidProject.findUnique.mockResolvedValue({ id: 'p1', projectCode: 'X', stage, riskNote: '' });

      await expect(service.remove('a1')).rejects.toMatchObject({ response: { code: 'BID_IN_PROGRESS' } });
      // 零副作用：五个 deleteMany / removeObject / announcement.delete 均未调
      for (const key of ['bidOpeningSession', 'bidOpeningRecord', 'bidScoreRecord', 'bidEvaluationResult', 'bidInvalidBid']) {
        expect(prisma[key].deleteMany).not.toHaveBeenCalled();
      }
      expect(minioClient.removeObject).not.toHaveBeenCalled();
      expect(prisma.announcement.delete).not.toHaveBeenCalled();
    });
  }

  it('DOWNLOAD 项目删公告 → 可删且仅解关联（终审裁定，不级联）', async () => {
    // 终审裁定（2026-08-21）：DOWNLOAD 不再走级联复位路径——仅追加风险备注 + 解绑标书，公告照常删除。
    prisma.announcement.findUnique.mockResolvedValue({ type: 'BID_NOTICE', relatedProjectCode: 'C1', status: 'PUBLISHED' });
    prisma.bidProject.findUnique.mockResolvedValue({ id: 'p1', projectCode: 'C1', stage: 'DOWNLOAD', riskNote: '' });
    prisma.bidProject.update.mockResolvedValue({});
    prisma.bidDocument.updateMany.mockResolvedValue({});
    prisma.announcement.delete.mockResolvedValue({});

    await expect(service.remove('ann1')).resolves.toMatchObject({ deleted: true });

    expect(prisma.bidProject.update).toHaveBeenCalled();
    expect(prisma.bidOpeningSession.deleteMany).not.toHaveBeenCalled();
    expect(prisma.announcement.delete).toHaveBeenCalled();
  });

  it('ARCHIVED 项目删公告 → 可删且不级联（回归）', async () => {
    prisma.announcement.findUnique.mockResolvedValue({ type: 'BID_NOTICE', relatedProjectCode: 'C1', status: 'PUBLISHED' });
    prisma.bidProject.findUnique.mockResolvedValue({ id: 'p1', projectCode: 'C1', stage: 'ARCHIVED', riskNote: '' });
    prisma.bidProject.update.mockResolvedValue({});
    prisma.bidDocument.updateMany.mockResolvedValue({});
    prisma.announcement.delete.mockResolvedValue({});

    await expect(service.remove('ann1')).resolves.toMatchObject({ deleted: true });

    expect(prisma.announcement.delete).toHaveBeenCalled();
    for (const key of ['bidOpeningSession', 'bidOpeningRecord', 'bidScoreRecord', 'bidEvaluationResult', 'bidInvalidBid']) {
      expect(prisma[key].deleteMany).not.toHaveBeenCalled();
    }
  });

  it('ABORTED（流标）项目删公告 → 可删且仅解关联、stage 不变（终审裁定）', async () => {
    // 终审裁定（2026-08-21）：ABORTED 视为 ARCHIVED 同类终态——仅解关联，不级联、不重置。
    prisma.announcement.findUnique.mockResolvedValue({ type: 'BID_NOTICE', relatedProjectCode: 'C1', status: 'PUBLISHED' });
    prisma.bidProject.findUnique.mockResolvedValue({ id: 'p1', projectCode: 'C1', stage: 'ABORTED', riskNote: '' });
    prisma.bidProject.update.mockResolvedValue({});
    prisma.bidDocument.updateMany.mockResolvedValue({});
    prisma.announcement.delete.mockResolvedValue({});

    await expect(service.remove('ann1')).resolves.toMatchObject({ deleted: true });

    expect(prisma.announcement.delete).toHaveBeenCalled();
    // 零级联销毁：五个 deleteMany 与 MinIO 清理均不触发
    for (const key of ['bidOpeningSession', 'bidOpeningRecord', 'bidScoreRecord', 'bidEvaluationResult', 'bidInvalidBid']) {
      expect(prisma[key].deleteMany).not.toHaveBeenCalled();
    }
    expect(minioClient.removeObject).not.toHaveBeenCalled();
    // stage 不重置（data 不含 stage 字段）、风险备注照常追加、标书解关联照常执行
    expect(prisma.bidProject.update.mock.calls[0][0].data).not.toHaveProperty('stage');
    expect(prisma.bidProject.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { projectCode: 'C1' },
        data: expect.objectContaining({ riskNote: '（来源公告已删除）' }),
      }),
    );
    expect(prisma.bidDocument.updateMany).toHaveBeenCalledWith({ where: { announcementId: 'ann1' }, data: { bidProjectId: null } });
  });

  it('无关联项目删公告 → 可删', async () => {
    prisma.announcement.findUnique.mockResolvedValue({ id: 'a1', relatedProjectCode: null, type: 'BID_NOTICE', status: 'PUBLISHED' });
    prisma.announcement.delete.mockResolvedValue({});

    await expect(service.remove('a1')).resolves.toMatchObject({ deleted: true });

    expect(prisma.bidProject.findUnique).not.toHaveBeenCalled();
    expect(prisma.announcement.delete).toHaveBeenCalled();
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
      { companyId: undefined, companyName: undefined }, // 公司归属跟随公告（2026-08-20）
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
