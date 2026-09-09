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

describe('AnnouncementService — A-87 发布钩子（招标要点提取前移）', () => {
  const ann = {
    id: 'ann1', title: 'T', publishDate: new Date(), authorId: 'u1', relatedProjectCode: null,
    metadata: { method: '公开招标', openTime: '2026-09-10T10:00:00', deadline: '2026-09-15T17:00:00' },
  };

  const makeSvc = async (bidService: any, prismaOverrides: Record<string, any> = {}) => {
    const prisma: any = {
      bidProject: { findUnique: jest.fn().mockResolvedValue(null), update: jest.fn().mockResolvedValue({}) },
      announcement: { update: jest.fn().mockResolvedValue({}) },
      bidDocument: { findUnique: jest.fn().mockResolvedValue(null) },
      $transaction: jest.fn(async (cb: any) => cb(prisma)),
      ...prismaOverrides,
    };
    const { AnnouncementService: Svc } = await import('./announcement.service');
    // projectManagementService 传 undefined——PMI 补建分支跳过，聚焦发布钩子本身
    const service: any = new (Svc as any)(prisma, {}, bidService, undefined);
    return { service, prisma };
  };

  it('直建新项目成功 → 触发 ensureTenderAnalysis(新项目 id)', async () => {
    const ensureTenderAnalysis = jest.fn().mockResolvedValue(true);
    const { service } = await makeSvc({
      createFromAnnouncement: jest.fn().mockResolvedValue({ id: 'p-new', projectCode: 'BID-1' }),
      ensureTenderAnalysis,
    });
    await service.syncBidProject('ann1', { ...ann });
    expect(ensureTenderAnalysis).toHaveBeenCalledTimes(1);
    expect(ensureTenderAnalysis).toHaveBeenCalledWith('p-new');
  });

  it('关联既有项目 → 触发 ensureTenderAnalysis(既有项目 id)', async () => {
    const ensureTenderAnalysis = jest.fn().mockResolvedValue(true);
    const { service } = await makeSvc(
      { syncFromAnnouncement: jest.fn().mockResolvedValue({}), ensureTenderAnalysis },
      {
        // P1 编码空间次序：先按 PMI 编码查（此处 BID-1 非 PMI → null 回退 BidProject 直查）
        projectManagementItem: { findUnique: jest.fn().mockResolvedValue(null) },
        bidProject: { findUnique: jest.fn().mockResolvedValue({ id: 'p-existing', projectCode: 'BID-1' }), findFirst: jest.fn().mockResolvedValue(null), update: jest.fn() },
      },
    );
    await service.syncBidProject('ann1', { ...ann, relatedProjectCode: 'BID-1' });
    expect(ensureTenderAnalysis).toHaveBeenCalledWith('p-existing');
  });

  it('提取入队失败 → 仅告警不阻塞发布（syncBidProject 正常返回，无未处理拒绝）', async () => {
    const ensureTenderAnalysis = jest.fn().mockRejectedValue(new Error('Redis down'));
    const { service } = await makeSvc({
      createFromAnnouncement: jest.fn().mockResolvedValue({ id: 'p2', projectCode: 'BID-2' }),
      ensureTenderAnalysis,
    });
    await expect(service.syncBidProject('ann1', { ...ann })).resolves.toBeUndefined();
    await new Promise(r => setImmediate(r)); // flush 微任务：rejection 须已被 .catch 吞掉
  });

  it('流标公告（metadata.category=failed_bid，读原始 metadata）→ 不触发提取', async () => {
    const ensureTenderAnalysis = jest.fn();
    const { service } = await makeSvc(
      { syncFromAnnouncement: jest.fn().mockResolvedValue({}), abortBidProject: jest.fn().mockResolvedValue({}), ensureTenderAnalysis },
      {
        projectManagementItem: { findUnique: jest.fn().mockResolvedValue(null) },
        bidProject: { findUnique: jest.fn().mockResolvedValue({ id: 'p-abort', projectCode: 'BID-3' }), findFirst: jest.fn().mockResolvedValue(null), update: jest.fn() },
      },
    );
    await service.syncBidProject('ann1', {
      ...ann, relatedProjectCode: 'BID-3',
      metadata: { ...ann.metadata, category: 'failed_bid' },
    });
    await new Promise(r => setImmediate(r));
    expect(ensureTenderAnalysis).not.toHaveBeenCalled();
  });
});

describe('AnnouncementService — E2 category 白名单（failed_bid 死分支复活）', () => {
  const ann = {
    id: 'ann1', title: 'T', publishDate: new Date(), authorId: 'u1', relatedProjectCode: 'BID-E2',
    metadata: { method: '公开招标', openTime: '2026-09-10T10:00:00', deadline: '2026-09-15T17:00:00' },
  };

  const makeSvc = async (bidService: any, prismaOverrides: Record<string, any> = {}) => {
    const prisma: any = {
      bidProject: { findUnique: jest.fn().mockResolvedValue({ id: 'p-e2', projectCode: 'BID-E2' }), update: jest.fn() },
      announcement: { update: jest.fn().mockResolvedValue({}) },
      bidDocument: { findUnique: jest.fn().mockResolvedValue(null) },
      // P1 编码空间次序（2026-09-07）：syncBidProject 先按 PMI 编码 findUnique——缺此 mock 即 TypeError
      projectManagementItem: { findUnique: jest.fn().mockResolvedValue(null) },
      $transaction: jest.fn(async (cb: any) => cb(prisma)),
      ...prismaOverrides,
    };
    const { AnnouncementService: Svc } = await import('./announcement.service');
    const service: any = new (Svc as any)(prisma, {}, bidService, undefined);
    return { service, prisma };
  };

  it('流标公告（category=failed_bid）→ :650 分支经 meta.category 可达：关联项目置 ABORTED', async () => {
    const abortBidProject = jest.fn().mockResolvedValue({});
    const { service } = await makeSvc({
      syncFromAnnouncement: jest.fn().mockResolvedValue({}),
      abortBidProject,
      ensureTenderAnalysis: jest.fn(),
    });
    await service.syncBidProject('ann1', {
      ...ann, metadata: { ...ann.metadata, category: 'failed_bid' },
    });
    // 白名单化前 validateMetadata 剥落 category，meta.category 恒 undefined（死分支）——此断言红即复现
    expect(abortBidProject).toHaveBeenCalledWith('p-e2');
  });

  it('非法枚举值（category=hacker）→ validateMetadata 剥落，不走流标分支', async () => {
    // validateMetadata 为 private static，经构造器直接断言剥落语义
    const { AnnouncementService: Svc } = await import('./announcement.service');
    const meta = (Svc as any).validateMetadata({ ...ann.metadata, category: 'hacker' });
    expect(meta.category).toBeUndefined();
    expect(meta.method).toBe('公开招标'); // 其余白名单键不受影响

    const abortBidProject = jest.fn().mockResolvedValue({});
    const { service } = await makeSvc({
      syncFromAnnouncement: jest.fn().mockResolvedValue({}),
      abortBidProject,
      ensureTenderAnalysis: jest.fn(),
    });
    await service.syncBidProject('ann1', {
      ...ann, metadata: { ...ann.metadata, category: 'hacker' },
    });
    await new Promise(r => setImmediate(r));
    expect(abortBidProject).not.toHaveBeenCalled();
  });
});


describe('backlog A — 公告直建失败 projectSyncWarning（发布不阻塞）', () => {
  let svc: any;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      announcement: { create: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
    };
    const { AnnouncementService } = await import('./announcement.service');
    svc = Object.create(AnnouncementService.prototype);
    svc.prisma = prisma;
    svc.logger = { warn: jest.fn(), log: jest.fn(), error: jest.fn() };
    svc.announcementAi = { summarize: jest.fn().mockResolvedValue('AI 摘要') };
    svc.notificationService = undefined;
    // syncBidProject 抛错——模拟 24h 校验失败等联动错误
    svc.syncBidProject = jest.fn().mockRejectedValue(new Error('截标须为开标前 24 小时'));
  });

  it('联动失败 → 公告仍创建成功，响应带 projectSyncWarning', async () => {
    const created = {
      id: 'a1', title: 'T', type: 'BID_NOTICE', status: 'PUBLISHED', content: 'c',
      publishDate: new Date(), metadata: { method: '公开招标', openTime: '2099-01-01T00:00:00Z', deadline: '2098-12-30T00:00:00Z' },
      relatedProjectCode: null, authorId: 'u1', companyId: null, companyName: null,
    };
    prisma.announcement.create.mockResolvedValue(created);
    // create 对 BID_NOTICE 发布返回 this.get(result.id)——findUnique 回同一对象（携带 warning）
    prisma.announcement.findUnique.mockImplementation(async () => prisma.announcement.create.mock.results[0]?.value ?? created);
    const res = await svc.create({ title: 'T', type: 'BID_NOTICE', status: 'PUBLISHED', content: 'c',
      metadata: { method: '公开招标', openTime: '2099-01-01T00:00:00Z', deadline: '2098-12-30T00:00:00Z' } } as any, 'u1');
    expect(res.id).toBe('a1'); // 公告创建未被阻塞
    expect((res as any).projectSyncWarning).toBeTruthy();
    expect((res as any).projectSyncWarning).toContain('联动创建招标项目失败');
    expect(svc.syncBidProject).toHaveBeenCalled();
  });
});

describe('AnnouncementService — 对接专项 T4 发布赋码强制闸（GB_CODE_REQUIRED）', () => {
  const mk = async (proj: { gbProcureCode: string | null } | null) => {
    const prisma: any = {
      bidProject: { findUnique: jest.fn().mockResolvedValue(proj) },
      announcement: {
        findUnique: jest.fn().mockResolvedValue({ id: 'a1', status: 'DRAFT', type: 'BID_NOTICE', relatedProjectCode: 'BID-1', metadata: {} }),
        update: jest.fn().mockResolvedValue({ id: 'a1', status: 'PUBLISHED' }),
        create: jest.fn().mockResolvedValue({ id: 'a2', status: 'PUBLISHED' }),
      },
      bidDocument: { findUnique: jest.fn().mockResolvedValue(null) },
      $transaction: jest.fn(async (cb: any) => cb(prisma)),
    };
    const { AnnouncementService: Svc } = await import('./announcement.service');
    const service: any = new (Svc as any)(prisma, { summarize: jest.fn().mockResolvedValue('摘要') }, { syncFromAnnouncement: jest.fn().mockResolvedValue({}), ensureTenderAnalysis: jest.fn() }, undefined);
    return { service, prisma };
  };

  it('update 转入 PUBLISHED 且关联项目缺码 → 400 GB_CODE_REQUIRED', async () => {
    const { service } = await mk({ gbProcureCode: null });
    await expect(service.update('a1', { status: 'PUBLISHED' } as any))
      .rejects.toMatchObject({ response: { code: 'GB_CODE_REQUIRED' } });
  });

  it('update 转入 PUBLISHED 且关联项目有码 → 放行（update 执行）', async () => {
    const { service, prisma } = await mk({ gbProcureCode: '511510000260909001001' });
    await service.update('a1', { status: 'PUBLISHED' } as any);
    expect(prisma.announcement.update).toHaveBeenCalled();
  });

  it('create 即 PUBLISHED 但无关联项目（POLICY 等）→ 不拦（findUnique 不被调）', async () => {
    const { service, prisma } = await mk({ gbProcureCode: null });
    await service.create({ title: '政策', content: 'x', type: 'POLICY' as any, status: 'PUBLISHED' } as any, 'u1');
    expect(prisma.bidProject.findUnique).not.toHaveBeenCalled();
  });
});

describe('W2 依法必招标示录入口（P1-4，2026-09-09）— guard 读 metadata.legalMandatory', () => {
  const mkSvc = async () => {
    const prisma: any = {
      announcement: {
        create: jest.fn().mockResolvedValue({ id: 'a1', title: 'T', type: 'BID_NOTICE', status: 'PUBLISHED', publishDate: new Date(), metadata: {}, relatedProjectCode: null, authorId: 'u1' }),
        findUnique: jest.fn(),
        // 对方会话 919d5391：BID_NOTICE 直接发布也派生 publicityEnd（create 内二次 update）
        update: jest.fn().mockImplementation(async (_args: any) => ({ id: 'a1', publicityEnd: new Date(Date.now() + 3 * 86400000) })),
      },
      bidProject: { findUnique: jest.fn() },
      // 非必招项目偏离留痕路径（deviated → supervisionLog）需要
      bidSupervisionLog: { create: jest.fn().mockResolvedValue({}) },
    };
    const { AnnouncementService: Svc } = await import('./announcement.service');
    const svc: any = Object.create(Svc.prototype);
    svc.prisma = prisma;
    svc.logger = { warn: jest.fn(), log: jest.fn(), error: jest.fn() };
    svc.announcementAi = { summarize: jest.fn().mockResolvedValue('摘要') };
    svc.notificationService = undefined;
    svc.syncBidProject = jest.fn().mockResolvedValue({});
    // create 尾部 this.get(result.id) 需要 findUnique 回已建公告（create 首个 resolved 值）
    prisma.announcement.findUnique.mockImplementation(async () => prisma.announcement.create.mock.results[0]?.value);
    return { svc, prisma };
  };
  // 售标（发布）→ 开标仅 15 日：B-004 依法必招应拦；openTime 距今足够远（2099）供对照组
  const baseDto = (openTime: string, metadata: Record<string, unknown>) => ({
    title: 'T', content: 'c', type: 'BID_NOTICE', status: 'PUBLISHED',
    publishDate: new Date().toISOString(),
    metadata: { method: '公开招标', openTime, deadline: openTime, ...metadata },
  } as any);

  it('直建发布（无关联项目）+ metadata.legalMandatory=true + 售标→开标<20日 → 400 BID_TIMING_20D', async () => {
    const { svc } = await mkSvc();
    const openTime = new Date(Date.now() + 15 * 24 * 3600 * 1000).toISOString();
    await expect(svc.create(baseDto(openTime, { legalMandatory: true }), 'u1'))
      .rejects.toMatchObject({ response: { code: 'BID_TIMING_20D' } });
  });

  it('直建发布无 legalMandatory（集团非必招惯例）→ 放行（回归：24h 惯例不受影响）', async () => {
    const { svc, prisma } = await mkSvc();
    const openTime = new Date(Date.now() + 15 * 24 * 3600 * 1000).toISOString();
    await svc.create(baseDto(openTime, {}), 'u1');
    expect(prisma.announcement.create).toHaveBeenCalled();
  });

  it('validateMetadata 白名单保留 legalMandatory 布尔（不再剥落）', async () => {
    const { AnnouncementService: Svc } = await import('./announcement.service');
    const validated = (Svc as any).validateMetadata({ legalMandatory: true, method: '公开招标' });
    expect(validated.legalMandatory).toBe(true);
  });

  it('关联项目列优先：existing.legalMandatory=true（metadata 无标志）→ 仍拦 BID_TIMING_20D', async () => {
    const { svc, prisma } = await mkSvc();
    prisma.bidProject.findUnique.mockResolvedValue({ legalMandatory: true, gbProcureCode: '511510000260909001001', openTime: new Date(Date.now() + 15 * 24 * 3600 * 1000), downloadDeadline: null, deadline: new Date(Date.now() + 14 * 24 * 3600 * 1000) });
    const openTime = new Date(Date.now() + 15 * 24 * 3600 * 1000).toISOString();
    await expect(svc.create({ ...baseDto(openTime, {}), relatedProjectCode: 'TP-1' }, 'u1'))
      .rejects.toMatchObject({ response: { code: 'BID_TIMING_20D' } });
  });

  it('关联项目列优先：existing.legalMandatory=false + metadata.legalMandatory=true → 以列为准放行', async () => {
    const { svc, prisma } = await mkSvc();
    prisma.bidProject.findUnique.mockResolvedValue({ legalMandatory: false, gbProcureCode: '511510000260909001001', openTime: new Date(Date.now() + 15 * 24 * 3600 * 1000), downloadDeadline: null, deadline: new Date(Date.now() + 14 * 24 * 3600 * 1000) });
    const openTime = new Date(Date.now() + 15 * 24 * 3600 * 1000).toISOString();
    await svc.create({ ...baseDto(openTime, { legalMandatory: true }), relatedProjectCode: 'TP-1' }, 'u1');
    expect(prisma.announcement.create).toHaveBeenCalled();
  });
});
