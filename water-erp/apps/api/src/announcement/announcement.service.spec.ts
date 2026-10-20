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
    svc.syncBidProject = jest.fn().mockRejectedValue(new Error('截标须为开标前 10 分钟'));
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

describe('AnnouncementService — 对接专项 T4 发布赋码闸（自愈版，2026-10-20 缺码事故）', () => {
  const mk = async (
    proj: { id?: string; gbProcureCode: string | null; projectManagementItemId?: string | null } | null,
    gbCode?: any,
  ) => {
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
    const service: any = new (Svc as any)(prisma, { summarize: jest.fn().mockResolvedValue('摘要') }, { syncFromAnnouncement: jest.fn().mockResolvedValue({}), ensureTenderAnalysis: jest.fn() }, undefined, undefined, undefined, gbCode);
    return { service, prisma };
  };

  it('update 转入 PUBLISHED 且关联项目缺码 → 自愈补码放行（缺码不再硬拦发布）', async () => {
    const gbCode = { backfillProcureCodeFor: jest.fn().mockResolvedValue({ gbProcureCode: '511510000261020004001', gbSectionCode: '511510000261020004001001' }) };
    const { service, prisma } = await mk({ id: 'bp-1', gbProcureCode: null, projectManagementItemId: 'pmi-1' }, gbCode);
    await service.update('a1', { status: 'PUBLISHED' } as any);
    expect(gbCode.backfillProcureCodeFor).toHaveBeenCalledWith({ id: 'bp-1', gbProcureCode: null, projectManagementItemId: 'pmi-1' });
    expect(prisma.announcement.update).toHaveBeenCalled(); // 发布未被拦截
  });

  it('自愈分配失败 → 400 GB_CODE_REQUIRED（文案指向补码脚本）', async () => {
    const gbCode = { backfillProcureCodeFor: jest.fn().mockRejectedValue(new Error('db down')) };
    const { service, prisma } = await mk({ id: 'bp-1', gbProcureCode: null }, gbCode);
    await expect(service.update('a1', { status: 'PUBLISHED' } as any))
      .rejects.toMatchObject({ response: { code: 'GB_CODE_REQUIRED' } });
    expect(prisma.announcement.update).not.toHaveBeenCalled();
  });

  it('缺码且 gbCode 未注入（防御兜底）→ 400 GB_CODE_REQUIRED', async () => {
    const { service } = await mk({ id: 'bp-1', gbProcureCode: null });
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

describe('AnnouncementService — 回收站体系（隐藏/下架/恢复，2026-09-26）', () => {
  let service: AnnouncementService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      announcement: { findUnique: jest.fn(), update: jest.fn(), count: jest.fn(), findMany: jest.fn() },
      announcementHistory: { create: jest.fn().mockResolvedValue({}) },
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

  const op = { operatorId: 'u1', operatorName: '张三' };

  it('hide：任意状态 → HIDDEN，metadata.recycle 记录原状态且保留其余键，历史记 HIDE', async () => {
    prisma.announcement.findUnique.mockResolvedValue({ id: 'a1', title: 't', type: 'POLICY', status: 'DRAFT', metadata: { foo: 1 } });
    prisma.announcement.update.mockResolvedValue({ id: 'a1', title: 't', type: 'POLICY', status: 'HIDDEN' });
    await expect(service.hide('a1', op)).resolves.toMatchObject({ status: 'HIDDEN' });
    const arg = prisma.announcement.update.mock.calls[0][0];
    expect(arg.data.status).toBe('HIDDEN');
    expect(arg.data.metadata).toMatchObject({ foo: 1, recycle: { from: 'DRAFT', action: 'HIDDEN' } });
    expect(prisma.announcementHistory.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ action: 'HIDE', announcementId: 'a1' }),
    }));
  });

  it('hide：已在回收站 → 409 ALREADY_IN_RECYCLE，零写入', async () => {
    prisma.announcement.findUnique.mockResolvedValue({ id: 'a1', title: 't', type: 'POLICY', status: 'HIDDEN', metadata: {} });
    await expect(service.hide('a1', op)).rejects.toMatchObject({ response: { code: 'ALREADY_IN_RECYCLE' } });
    expect(prisma.announcement.update).not.toHaveBeenCalled();
  });

  it('offline：已发布 → OFFLINE，recycle.from=PUBLISHED，历史记 OFFLINE', async () => {
    prisma.announcement.findUnique.mockResolvedValue({ id: 'a1', title: 't', type: 'BID_NOTICE', status: 'PUBLISHED', metadata: null });
    prisma.announcement.update.mockResolvedValue({ id: 'a1', title: 't', type: 'BID_NOTICE', status: 'OFFLINE' });
    await expect(service.offline('a1', op)).resolves.toMatchObject({ status: 'OFFLINE' });
    const arg = prisma.announcement.update.mock.calls[0][0];
    expect(arg.data.metadata.recycle).toMatchObject({ from: 'PUBLISHED', action: 'OFFLINE' });
    expect(prisma.announcementHistory.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ action: 'OFFLINE' }),
    }));
  });

  it('offline：任意状态可下架（v2 拍板）——草稿 → OFFLINE，from=DRAFT', async () => {
    prisma.announcement.findUnique.mockResolvedValue({ id: 'a1', title: 't', type: 'POLICY', status: 'DRAFT', metadata: null });
    prisma.announcement.update.mockResolvedValue({ id: 'a1', title: 't', type: 'POLICY', status: 'OFFLINE' });
    await expect(service.offline('a1', op)).resolves.toMatchObject({ status: 'OFFLINE' });
    expect(prisma.announcement.update.mock.calls[0][0].data.metadata.recycle).toMatchObject({ from: 'DRAFT', action: 'OFFLINE' });
  });

  it('restore（隐藏）：按 metadata.recycle.from 恢复并清除 recycle 键，历史记 RESTORE', async () => {
    prisma.announcement.findUnique.mockResolvedValue({ id: 'a1', title: 't', type: 'POLICY', status: 'HIDDEN', metadata: { recycle: { from: 'PUBLISHED', action: 'HIDDEN', at: 'x' }, foo: 2 } });
    prisma.announcement.update.mockResolvedValue({ id: 'a1', title: 't', type: 'POLICY', status: 'PUBLISHED' });
    await expect(service.restore('a1', op)).resolves.toMatchObject({ status: 'PUBLISHED' });
    const arg = prisma.announcement.update.mock.calls[0][0];
    expect(arg.data.status).toBe('PUBLISHED');
    expect(arg.data.metadata).toEqual({ foo: 2 });
    expect(prisma.announcementHistory.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ action: 'RESTORE' }),
    }));
  });

  it('restore：OFFLINE（已下架）→ 409 OFFLINE_NOT_RESTORABLE（下架为终态，v2 拍板）', async () => {
    prisma.announcement.findUnique.mockResolvedValue({ id: 'a1', title: 't', type: 'POLICY', status: 'OFFLINE', metadata: { recycle: { from: 'PUBLISHED', action: 'OFFLINE', at: 'x' } } });
    await expect(service.restore('a1', op)).rejects.toMatchObject({ response: { code: 'OFFLINE_NOT_RESTORABLE' } });
    expect(prisma.announcement.update).not.toHaveBeenCalled();
  });

  it('publicList：已下线（公示期满/ARCHIVED）出标题壳——剥正文/摘要 + titleOnly 标记；无公示期永不过期', async () => {
    const past = new Date(Date.now() - 86400000).toISOString();
    const future = new Date(Date.now() + 86400000).toISOString();
    prisma.announcement.count.mockResolvedValue(4);
    prisma.announcement.findMany.mockResolvedValue([
      { id: 'p1', title: '在公示期', type: 'BID_NOTICE', status: 'PUBLISHED', content: '<p>正文</p>', publicityEnd: future, metadata: {} },
      { id: 'p2', title: '公示期满', type: 'BID_NOTICE', status: 'PUBLISHED', content: '<p>正文</p>', publicityEnd: past, metadata: {}, summary: 's', aiSummary: 'a' },
      { id: 'p3', title: '政策无公示期', type: 'POLICY', status: 'PUBLISHED', content: '<p>正文</p>', metadata: {} },
      { id: 'p4', title: '存量归档', type: 'BID_NOTICE', status: 'ARCHIVED', content: '<p>正文</p>', metadata: {}, summary: 's' },
    ]);
    const res = await service.publicList({});
    expect(prisma.announcement.findMany.mock.calls[0][0].where.status).toEqual({ in: ['PUBLISHED', 'ARCHIVED'] });
    const by: any = Object.fromEntries(res.items.map((i: any) => [i.id, i]));
    expect(by.p1.titleOnly).toBeUndefined();
    expect(by.p1.content).toContain('正文');
    expect(by.p2.titleOnly).toBe(true);
    expect(by.p2.content).toBe('');
    expect(by.p2.summary).toBeNull();
    expect(by.p3.titleOnly).toBeUndefined();
    expect(by.p3.content).toContain('正文');
    expect(by.p4.titleOnly).toBe(true);
    // 2026-10-20：标题壳带归因——门户据此渲染「公示期已过」/「已下线」差异化提示
    expect(by.p2.offlinedReason).toBe('PUBLICITY_ENDED');
    expect(by.p4.offlinedReason).toBe('OFFLINED');
    expect(by.p1.offlinedReason).toBeUndefined();
  });

  it('getPublic：公示期满/ARCHIVED → 200 标题壳（offlinedReason 归因，不计浏览）；公示期内正常出全文', async () => {
    // 2026-10-20 用户裁定：点进去渲染「公示期已过/已下线」提示页——不再是 400 拒绝（直链也有标题元信息）
    prisma.announcement.findUnique.mockResolvedValue({ id: 'g1', title: 't', type: 'BID_NOTICE', status: 'PUBLISHED', content: 'c', publicityEnd: new Date(Date.now() - 86400000), dataClass: null, metadata: {} });
    await expect(service.getPublic('g1')).resolves.toMatchObject({ id: 'g1', titleOnly: true, offlinedReason: 'PUBLICITY_ENDED', content: '' });
    prisma.announcement.findUnique.mockResolvedValue({ id: 'g2', title: 't', type: 'BID_NOTICE', status: 'ARCHIVED', content: 'c', dataClass: null, metadata: {} });
    await expect(service.getPublic('g2')).resolves.toMatchObject({ id: 'g2', titleOnly: true, offlinedReason: 'OFFLINED' });
    expect(prisma.announcement.update).not.toHaveBeenCalled();
    prisma.announcement.findUnique.mockResolvedValue({ id: 'g3', title: 't', type: 'BID_NOTICE', status: 'PUBLISHED', content: 'c', publicityEnd: new Date(Date.now() + 86400000), dataClass: null, metadata: {} });
    prisma.announcement.update.mockResolvedValue({});
    await expect(service.getPublic('g3')).resolves.toMatchObject({ id: 'g3', content: '<p>c</p>' });
  });

  it('restore：from 缺失/非法 → 兜底 DRAFT', async () => {
    prisma.announcement.findUnique.mockResolvedValue({ id: 'a1', title: 't', type: 'POLICY', status: 'HIDDEN', metadata: null });
    prisma.announcement.update.mockResolvedValue({ id: 'a1', title: 't', type: 'POLICY', status: 'DRAFT' });
    await expect(service.restore('a1', op)).resolves.toMatchObject({ status: 'DRAFT' });
  });

  it('restore：不在回收站 → 409 NOT_IN_RECYCLE', async () => {
    prisma.announcement.findUnique.mockResolvedValue({ id: 'a1', title: 't', type: 'POLICY', status: 'PUBLISHED', metadata: null });
    await expect(service.restore('a1', op)).rejects.toMatchObject({ response: { code: 'NOT_IN_RECYCLE' } });
  });

  it('list：无 status 默认排除回收态；HIDDEN,OFFLINE 逗号查询只出回收站；单值不受影响', async () => {
    prisma.announcement.count.mockResolvedValue(0);
    prisma.announcement.findMany.mockResolvedValue([]);
    await service.list({});
    // 2026-10-16：默认「全部」排除草稿（草稿收纳进 KPI 弹窗），回收态照旧排除
    expect(prisma.announcement.findMany.mock.calls[0][0].where.status).toEqual({ notIn: ['HIDDEN', 'OFFLINE', 'DRAFT'] });
    await service.list({ status: 'HIDDEN,OFFLINE' });
    expect(prisma.announcement.findMany.mock.calls[1][0].where.status).toEqual({ in: ['HIDDEN', 'OFFLINE'] });
    await service.list({ status: 'PUBLISHED' });
    expect(prisma.announcement.findMany.mock.calls[2][0].where.status).toBe('PUBLISHED');
    // 显式 status=DRAFT 仍可查（KPI 弹窗草稿列表数据源）
    await service.list({ status: 'DRAFT' });
    expect(prisma.announcement.findMany.mock.calls[3][0].where.status).toBe('DRAFT');
  });
});

describe('AnnouncementService — 正式盖章版引用校验（OFFICIAL_TENDER_MISMATCH，2026-09-27）', () => {
  const mk = async (prismaOverrides: Record<string, any> = {}) => {
    const prisma: any = {
      projectManagementItem: {
        findUnique: jest.fn().mockResolvedValue({ id: 'pmi-1', currentRound: 1 }),
      },
      projectManagementStage: {
        findFirst: jest.fn().mockResolvedValue({ officialTenderAttachmentId: 'att-official' }),
      },
      attachment: {
        findUnique: jest.fn().mockResolvedValue({ objectKey: 'obj/official.docx' }),
      },
      ...prismaOverrides,
    };
    const { AnnouncementService } = await import('./announcement.service');
    const svc: any = Object.create(AnnouncementService.prototype);
    svc.prisma = prisma;
    return { svc, prisma };
  };

  it('objectKey 与 03 指针一致 → 放行', async () => {
    const { svc } = await mk();
    await expect(
      svc.assertOfficialTenderReference({ selectedTenderObjectKey: 'obj/official.docx' }, 'SWHI-JJ-1'),
    ).resolves.toBeUndefined();
  });

  it('objectKey 与指针不一致（绕过 04 向导直发）→ 400 OFFICIAL_TENDER_MISMATCH', async () => {
    const { svc } = await mk();
    await expect(
      svc.assertOfficialTenderReference({ selectedTenderObjectKey: 'obj/任意其他文件.docx' }, 'SWHI-JJ-1'),
    ).rejects.toMatchObject({ response: { code: 'OFFICIAL_TENDER_MISMATCH' } });
  });

  it('指针为空但 metadata 带引用 → 400（未标记不得引用——与 04 向导「无指针不引用」口径互斥）', async () => {
    const { svc } = await mk({
      projectManagementStage: { findFirst: jest.fn().mockResolvedValue({ officialTenderAttachmentId: null }) },
    });
    await expect(
      svc.assertOfficialTenderReference({ selectedTenderObjectKey: 'obj/official.docx' }, 'SWHI-JJ-1'),
    ).rejects.toMatchObject({ response: { code: 'OFFICIAL_TENDER_MISMATCH' } });
  });

  it('无 selectedTenderObjectKey → 跳过校验（不引用不校验，PMI 不查）', async () => {
    const { svc, prisma } = await mk();
    await expect(svc.assertOfficialTenderReference({}, 'SWHI-JJ-1')).resolves.toBeUndefined();
    expect(prisma.projectManagementItem.findUnique).not.toHaveBeenCalled();
  });

  it('relatedProjectCode 缺失（无项目关联）→ 跳过校验', async () => {
    const { svc, prisma } = await mk();
    await expect(svc.assertOfficialTenderReference({ selectedTenderObjectKey: 'obj/official.docx' }, null)).resolves.toBeUndefined();
    expect(prisma.projectManagementItem.findUnique).not.toHaveBeenCalled();
  });

  it('projectCode 定位不到 PMI（手工公告/历史编号）→ 跳过校验', async () => {
    const { svc } = await mk({
      projectManagementItem: { findUnique: jest.fn().mockResolvedValue(null) },
    });
    await expect(svc.assertOfficialTenderReference({ selectedTenderObjectKey: 'obj/official.docx' }, 'OLD-1')).resolves.toBeUndefined();
  });

  it('指针查找 round 感知：currentRound=2 → findFirst 带 round:2（多轮不误读 round-1 行）', async () => {
    const { svc, prisma } = await mk({
      projectManagementItem: { findUnique: jest.fn().mockResolvedValue({ id: 'pmi-1', currentRound: 2 }) },
    });
    await svc.assertOfficialTenderReference({ selectedTenderObjectKey: 'obj/official.docx' }, 'SWHI-JJ-1');
    expect(prisma.projectManagementStage.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ stageKey: 'TENDER_DOCUMENT', round: 2 }) }),
    );
  });

  it('create 前置校验：BID_NOTICE 即时发布 + 引用不一致 → 400 且不建行（无孤儿公告）', async () => {
    const { svc, prisma } = await mk({
      bidProject: { findUnique: jest.fn().mockResolvedValue({ gbProcureCode: 'GB-1' }) },
    });
    prisma.announcement = { create: jest.fn() };
    svc.announcementAi = { summarize: jest.fn().mockResolvedValue('摘要'), looksLikePromptLeak: jest.fn().mockReturnValue(false) };
    await expect(
      svc.create({
        title: 'T', type: 'BID_NOTICE', status: 'PUBLISHED', content: 'c',
        relatedProjectCode: 'SWHI-JJ-1',
        metadata: { selectedTenderObjectKey: 'obj/wrong.docx' },
      } as any, 'u1'),
    ).rejects.toMatchObject({ response: { code: 'OFFICIAL_TENDER_MISMATCH' } });
    expect(prisma.announcement.create).not.toHaveBeenCalled();
  });
});

describe('AnnouncementService — supplierList 供应商视角（公开 ∪ 定向命中，2026-09-29 spec）', () => {
  let service: AnnouncementService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      announcement: { count: jest.fn(), findMany: jest.fn() },
      // 公司隔离（2026-10-20）：默认归属 co-mine（APPROVED）
      supplierCompanyLink: { findMany: jest.fn().mockResolvedValue([{ companyId: 'co-mine' }]) },
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

  it('定向公告命中本供应商 → 出现且 visibility=RESTRICTED、剥 bidDocument、total 透传', async () => {
    prisma.announcement.count.mockResolvedValue(1);
    prisma.announcement.findMany.mockResolvedValue([{
      id: 'a1', status: 'PUBLISHED', publicityEnd: null,
      metadata: { visibility: 'RESTRICTED', restrictedSupplierIds: ['S1'] },
      content: '<p>正文</p>', bidDocument: { id: 'bd' },
    }]);

    const res = await service.supplierList({}, 'S1');

    expect(res.total).toBe(1);
    expect(res.items).toHaveLength(1);
    expect(res.items[0].visibility).toBe('RESTRICTED');
    expect(res.items[0].bidDocument).toBeUndefined();
    expect(res.items[0].content).toContain('<p>');
  });

  it('公开公告（无 visibility 键的存量行）→ 照常出现且 visibility=PUBLIC', async () => {
    prisma.announcement.count.mockResolvedValue(1);
    prisma.announcement.findMany.mockResolvedValue([{
      id: 'a2', status: 'PUBLISHED', publicityEnd: null,
      metadata: { category: 'failed_bid' }, content: 'x', bidDocument: null,
    }]);

    const res = await service.supplierList({}, 'S1');

    expect(res.items[0].visibility).toBe('PUBLIC');
  });

  it('公示期满的定向公告 → 仅标题壳（content 置空 + titleOnly=true）', async () => {
    prisma.announcement.count.mockResolvedValue(1);
    prisma.announcement.findMany.mockResolvedValue([{
      id: 'a3', status: 'PUBLISHED', publicityEnd: new Date(Date.now() - 86400000),
      metadata: { visibility: 'RESTRICTED', restrictedSupplierIds: ['S1'] },
      content: '<p>正文</p>', bidDocument: null,
    }]);

    const res = await service.supplierList({}, 'S1');

    expect(res.items[0].titleOnly).toBe(true);
    expect(res.items[0].content).toBe('');
  });

  it('公司隔离（2026-10-20）：主查询 AND 注入 归属公司∪平台级∪定向白名单豁免；无 APPROVED 归属仅剩平台级', async () => {
    prisma.supplierCompanyLink.findMany.mockResolvedValue([{ companyId: 'co-mine' }]);
    prisma.announcement.findMany.mockImplementation((args: any) => {
      if (args?.select?.id) return [
        // 跨公司定向公告但白名单点名本人 → 公司闸豁免（显式点名 > 公司归属）
        { id: 'r9', metadata: { visibility: 'RESTRICTED', restrictedSupplierIds: ['S1'] } },
        { id: 'r8', metadata: { visibility: 'RESTRICTED', restrictedSupplierIds: ['OTHER'] } },
      ];
      return [];
    });
    prisma.announcement.count.mockResolvedValue(0);

    await service.supplierList({}, 'S1');
    const mainWhere = prisma.announcement.findMany.mock.calls[1][0].where;
    const companyOr = (mainWhere.AND as any[]).find((c: any) => Array.isArray(c.OR))?.OR;
    expect(companyOr).toEqual([
      { companyId: { in: ['co-mine'] } },
      { companyId: null },
      { id: { in: ['r9'] } },
    ]);
    // 非本人的定向仍走 notIn 排除
    expect(mainWhere.id).toEqual({ notIn: ['r8'] });

    // 无 APPROVED 归属（注册必填公司但 PENDING 未批）→ 公司集为空，仅平台级 + 白名单命中
    prisma.supplierCompanyLink.findMany.mockResolvedValue([]);
    await service.supplierList({}, 'S1');
    const mainWhere2 = prisma.announcement.findMany.mock.calls[3][0].where;
    const companyOr2 = (mainWhere2.AND as any[]).find((c: any) => Array.isArray(c.OR))?.OR;
    expect(companyOr2).toEqual([
      { companyId: { in: [] } },
      { companyId: null },
      { id: { in: ['r9'] } },
    ]);
  });

  it('查询闸：预取 RESTRICTED 集合判归属，主查询 notIn 排除不属于本人的定向；公开级 dataClass 口径保留', async () => {
    // 预取返回两条定向：r1 给别家（应排除）、r2 含 S9（应保留）
    prisma.announcement.findMany.mockImplementation((args: any) => {
      // 第一次调用 = 预取定向集合（select 仅 id/metadata）；第二次 = 主查询
      if (args?.select?.id) return [
        { id: 'r1', metadata: { visibility: 'RESTRICTED', restrictedSupplierIds: ['OTHER'] } },
        { id: 'r2', metadata: { visibility: 'RESTRICTED', restrictedSupplierIds: ['S9', 'X'] } },
      ];
      return [];
    });
    prisma.announcement.count.mockResolvedValue(0);

    await service.supplierList({ search: '钻机' }, 'S9');

    const preWhere = prisma.announcement.findMany.mock.calls[0][0].where;
    expect(JSON.stringify(preWhere)).toContain('RESTRICTED');
    expect(preWhere.status).toEqual({ in: ['PUBLISHED', 'ARCHIVED'] });

    const mainWhere = prisma.announcement.findMany.mock.calls[1][0].where;
    expect(mainWhere.id).toEqual({ notIn: ['r1'] });          // 只排除不属于自己的
    expect(mainWhere.status).toEqual({ in: ['PUBLISHED', 'ARCHIVED'] });
    expect(JSON.stringify(mainWhere)).toContain('dataClass'); // publicVisibilityOnly 同口径
  });
});

describe('AnnouncementService — search 字段覆盖 relatedProjectCode（2026-10-14 项目编号可搜）', () => {
  let service: AnnouncementService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      announcement: { count: jest.fn(), findMany: jest.fn(), groupBy: jest.fn() },
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

  it('list({search}) → where.OR 含 relatedProjectCode contains（insensitive）', async () => {
    prisma.announcement.count.mockResolvedValue(0);
    prisma.announcement.findMany.mockResolvedValue([]);

    await service.list({ search: 'SWZB-2026' });

    const where = prisma.announcement.findMany.mock.calls[0][0].where;
    expect(where.OR).toEqual([
      { title: { contains: 'SWZB-2026', mode: 'insensitive' } },
      { content: { contains: 'SWZB-2026', mode: 'insensitive' } },
      { relatedProjectCode: { contains: 'SWZB-2026', mode: 'insensitive' } },
    ]);
  });

  it('companyCounts({search}) → 同口径（公司分组计数不漏项目编号命中）', async () => {
    prisma.announcement.groupBy.mockResolvedValue([]);

    await service.companyCounts({ search: 'SWZB-2026' });

    const where = prisma.announcement.groupBy.mock.calls[0][0].where;
    expect(where.OR).toContainEqual({ relatedProjectCode: { contains: 'SWZB-2026', mode: 'insensitive' } });
  });

  it('publicList({search}) → 透传同口径（:3002/:3004 公开端项目编号可搜）', async () => {
    prisma.announcement.count.mockResolvedValue(0);
    prisma.announcement.findMany.mockResolvedValue([]);

    await service.publicList({ search: 'SWZB-2026' });

    const where = prisma.announcement.findMany.mock.calls[0][0].where;
    expect(where.OR).toContainEqual({ relatedProjectCode: { contains: 'SWZB-2026', mode: 'insensitive' } });
  });
});

describe('AnnouncementService — 直接采购公告发布不提前回填中标单位（2026-10-16）', () => {
  it('发布联动 → 拟定供应商入 BidSupplier 参与名单，PMI.awardedSupplier 不被写入（中标单位应开标评标后才获取）', async () => {
    const bidService = { syncFromAnnouncement: jest.fn() };
    const prisma: any = {
      projectManagementItem: {
        findUnique: jest.fn().mockResolvedValue({ id: 'pmi-1', projectCode: 'ZJ-2026001' }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      bidProject: { findFirst: jest.fn().mockResolvedValue({ id: 'bp-1', projectCode: 'ZJ-BP1', projectManagementItemId: 'pmi-1' }) },
      bidDocument: { findUnique: jest.fn().mockResolvedValue(null) },
      supplier: { findFirst: jest.fn().mockResolvedValue(null) },
      bidSupplier: { upsert: jest.fn().mockResolvedValue({}) },
    };
    const { AnnouncementService: Svc } = await import('./announcement.service');
    const service: any = new (Svc as any)(prisma, {}, bidService, {});

    await service.syncBidProject('ann1', {
      id: 'ann1', title: '直接采购公告', publishDate: new Date(),
      relatedProjectCode: 'ZJ-2026001',
      metadata: { method: '直接采购', supplierName: '重庆蜀通岩土工程有限公司' },
    });

    // 参与名单保留：拟定供应商在「供应商参与」区块可见，且是邀请自动化的载体
    expect(prisma.bidSupplier.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { projectId_supplierName: { projectId: 'bp-1', supplierName: '重庆蜀通岩土工程有限公司' } },
      }),
    );
    // 中标单位不得在发布公告时点被回填——评标结果回写（bidService）/定标审批表/中标通知书才是合法时点
    expect(prisma.projectManagementItem.updateMany).not.toHaveBeenCalled();
  });
});

describe('AnnouncementService — 发布向导中标公告（WIN_BID_NOTICE）公示期与中标候选人链接（2026-10-19）', () => {
  const generatedAt = new Date('2026-09-28T08:00:00.000Z');
  const publishDate = new Date('2026-10-19T02:00:00.000Z');

  /** create/update 共用的候选人链路 mock：PMI 业务编号 → BidProject → 评标结果 */
  const makePrisma = () => ({
    projectManagementItem: {
      findUnique: jest.fn().mockImplementation((args: any) =>
        args.where?.projectCode === 'ZJ-2026001'
          ? Promise.resolve({ id: 'pmi-1' })
          : Promise.resolve(null),
      ),
    },
    bidProject: {
      findUnique: jest.fn().mockResolvedValue(null),
      findFirst: jest.fn().mockResolvedValue({ id: 'bp-1' }),
    },
    bidEvaluationResult: {
      findMany: jest.fn().mockResolvedValue([
        { rank: 1, supplierName: '四川水发建设有限公司', bidPrice: 1539500, totalScore: 92.5, recommended: true, generatedAt },
        { rank: 2, supplierName: '中科院成都信息技术股份有限公司', bidPrice: 1560000, totalScore: 88.1, recommended: true, generatedAt },
        { rank: 3, supplierName: '四川省通信产业服务有限公司', bidPrice: 1580000, totalScore: 85.3, recommended: false, generatedAt },
      ]),
    },
    announcement: {
      create: jest.fn(),
      update: jest.fn(),
      findUnique: jest.fn().mockResolvedValue({ metadata: { publicityPeriod: '3天' } }),
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
      groupBy: jest.fn().mockResolvedValue([]),
    },
  });

  const makeSvc = (prisma: any) => {
    const announcementAi: any = { summarize: jest.fn(), looksLikePromptLeak: jest.fn().mockReturnValue(false) };
    const service: any = new (AnnouncementService as any)(prisma, announcementAi, undefined, undefined, undefined, undefined);
    return service;
  };

  it('create 直接发布 → 不持久化 publicityEnd（读时推导），metadata 落 winCandidates（winner=rank1 推荐）', async () => {
    const prisma: any = makePrisma();
    prisma.announcement.create.mockResolvedValue({
      id: 'ann-wb-1', type: 'WIN_BID_NOTICE', status: 'PUBLISHED',
      publishDate, publicityEnd: null, relatedProjectCode: 'ZJ-2026001',
      metadata: { publicityPeriod: '3天' },
    });
    const service = makeSvc(prisma);

    const result = await service.create({
      title: '中标公告：智慧水务平台建设', content: '公告正文',
      type: 'WIN_BID_NOTICE', status: 'PUBLISHED',
      relatedProjectCode: 'ZJ-2026001', aiSummary: '测试摘要',
    });

    // 公示期不落库：持久化会让公开端 isOfflined 在 3 天后把结果公告打成标题壳——推导职责在
    // BidService.getPublicityStatus（publishDate+3d，存量行同步自愈）
    expect(result.publicityEnd).toBeNull();
    expect(prisma.announcement.update).toHaveBeenCalledTimes(1); // 仅候选人链接一次
    // 中标候选人链接：rank1 推荐为确认中标人，候选全量随公告留档（保留既有 metadata 键）
    const linkage = prisma.announcement.update.mock.calls[0];
    expect(linkage[0].data.publicityEnd).toBeUndefined();
    expect(linkage[0].data.metadata.publicityPeriod).toBe('3天');
    expect(linkage[0].data.metadata.winCandidates.winner).toMatchObject({ rank: 1, supplierName: '四川水发建设有限公司' });
    expect(linkage[0].data.metadata.winCandidates.candidates).toHaveLength(3);
    expect(linkage[0].data.metadata.winCandidates.candidates[0]).toMatchObject({ supplierName: '四川水发建设有限公司', recommended: true });
  });

  it('update 草稿转发布 → 同样不持久化公示期、候选人照常链接（定时发布路径）', async () => {
    const prisma: any = makePrisma();
    prisma.announcement.findUnique.mockResolvedValue({
      id: 'ann-wb-2', title: '中标公告：智慧水务平台建设', content: '公告正文',
      type: 'WIN_BID_NOTICE', status: 'DRAFT', publishDate,
      publicityEnd: null, relatedProjectCode: 'ZJ-2026001',
      metadata: { scheduledPublishDate: '2026-10-19T02:00:00.000Z' }, authorId: 'u1',
    });
    prisma.announcement.update.mockImplementation(async (args: any) => ({
      id: 'ann-wb-2', type: 'WIN_BID_NOTICE', publishDate, publicityEnd: null,
      relatedProjectCode: 'ZJ-2026001', status: 'PUBLISHED', title: '中标公告：智慧水务平台建设',
      metadata: { scheduledPublishDate: '2026-10-19T02:00:00.000Z' },
      ...args.data,
    }));
    const service = makeSvc(prisma);

    await service.update('ann-wb-2', { status: 'PUBLISHED', publishDate: publishDate.toISOString() });

    const publicityWrite = prisma.announcement.update.mock.calls.find(
      (c: any[]) => c[0]?.data?.publicityEnd !== undefined,
    );
    expect(publicityWrite).toBeUndefined(); // 中标公告不写 publicityEnd
    const linkage = prisma.announcement.update.mock.calls.find(
      (c: any[]) => c[0]?.data?.metadata?.winCandidates,
    );
    expect(linkage[0].data.metadata.winCandidates.winner).toMatchObject({ supplierName: '四川水发建设有限公司' });
  });

  it('无关联项目编号 → 零后续写入（登记制公告不报错、不做候选人链接）', async () => {
    const prisma: any = makePrisma();
    prisma.announcement.create.mockResolvedValue({
      id: 'ann-wb-3', type: 'WIN_BID_NOTICE', status: 'PUBLISHED',
      publishDate, publicityEnd: null, relatedProjectCode: null, metadata: null,
    });
    const service = makeSvc(prisma);

    await service.create({
      title: '中标公告（无项目关联）', content: '正文',
      type: 'WIN_BID_NOTICE', status: 'PUBLISHED', aiSummary: '测试摘要',
    });

    expect(prisma.projectManagementItem.findUnique).not.toHaveBeenCalled();
    expect(prisma.announcement.update).not.toHaveBeenCalled();
  });
});
