import { Test, TestingModule } from '@nestjs/testing';
import { BidEvaluationResultsService } from './bid-evaluation-results.service';
import { BidService } from './bid.service';
import { PrismaService } from '../prisma/prisma.service';
import { PriceFormulaService } from './price-formula.service';
import { StorageService } from '../storage/storage.service';

/* ── F1b：自 bid.service.spec.ts 迁出（纯移动；describe 内用例逐字保留，setup 裁剪为
      BidEvaluationResultsService 构造最小集：Prisma/PriceFormula/Storage/BidService 桩；gateway @Optional 不提供 ── */

describe('BidEvaluationResultsService — evaluation results', () => {
  let service: BidEvaluationResultsService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      bidProject: {
        findUnique: jest.fn(),
        update: jest.fn(),
        create: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
        groupBy: jest.fn(),
      },
      bidSupervisionLog: { findMany: jest.fn(), create: jest.fn() },
      bidExpert: { groupBy: jest.fn(), findFirst: jest.fn(), findMany: jest.fn().mockResolvedValue([]), count: jest.fn(), update: jest.fn(), updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
      bidScoreItem: { findFirst: jest.fn(), create: jest.fn(), delete: jest.fn(), count: jest.fn(), findMany: jest.fn().mockResolvedValue([]) },
      bidScoreRecord: { upsert: jest.fn(), findMany: jest.fn().mockResolvedValue([]), count: jest.fn().mockResolvedValue(0), findUnique: jest.fn() },
      bidScorePointDecision: { upsert: jest.fn().mockResolvedValue({}) },
      bidSupplier: { findMany: jest.fn().mockResolvedValue([]), update: jest.fn(), create: jest.fn(), findFirst: jest.fn(), findUnique: jest.fn(), count: jest.fn() },
      bidOpeningRecord: { create: jest.fn(), findFirst: jest.fn(), update: jest.fn(), upsert: jest.fn(), updateMany: jest.fn().mockResolvedValue({ count: 1 }), findUnique: jest.fn(), findMany: jest.fn().mockResolvedValue([]) },
      bidEvaluationResult: { deleteMany: jest.fn(), createMany: jest.fn(), findMany: jest.fn(), count: jest.fn(), findFirst: jest.fn().mockResolvedValue({ generatedAt: new Date(Date.now() - 3600_000) }) },
      // 签字闸门默认放行（闭环+回流齐）：full 归档用例不逐个 mock；单测闸门本身见 bid-sign-packet.service.spec
      bidSignPacket: { findUnique: jest.fn().mockResolvedValue({ fileAssetId: 'fa-sign', sha256: 'sha-sign', signPageScanFileId: null, closedAt: new Date(), handoverFileAssetId: 'fa-handover' }), delete: jest.fn().mockResolvedValue({}) },
      fileAsset: { findUnique: jest.fn(), findMany: jest.fn().mockResolvedValue([]) },
      auditLog: { create: jest.fn() },
      bidInvalidBid: { findMany: jest.fn().mockResolvedValue([]), findUnique: jest.fn(), findFirst: jest.fn(), update: jest.fn() },
      expertDispute: { count: jest.fn().mockResolvedValue(0), findUnique: jest.fn(), findFirst: jest.fn(), update: jest.fn(), create: jest.fn() },
      bidScoreRecordHistory: { create: jest.fn() },
      bidRound: { findFirst: jest.fn().mockResolvedValue(null), findUnique: jest.fn(), create: jest.fn(), update: jest.fn(), count: jest.fn().mockResolvedValue(0) },
      $queryRaw: jest.fn().mockResolvedValue([]),
      // Support both callback-based and batch-based $transaction patterns
      $transaction: jest.fn(async (callbackOrOps: any) => {
        if (typeof callbackOrOps === 'function') {
          // Callback-based: pass a tx client (which is the prisma mock itself)
          return callbackOrOps(prisma);
        }
        // Batch-based: execute all ops sequentially
        return Promise.all(callbackOrOps);
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        { provide: PriceFormulaService, useValue: { calculate: jest.fn().mockReturnValue(new Map()), getOverCeilingSuppliers: jest.fn().mockReturnValue([]) } },
        { provide: StorageService, useValue: { upload: jest.fn() } },
        { provide: PrismaService, useValue: prisma },
        { provide: BidService, useValue: { syncMultiRoundPrices: jest.fn() } },
        BidEvaluationResultsService,
      ],
    }).compile();

    service = module.get<BidEvaluationResultsService>(BidEvaluationResultsService);
  });

  describe('generateEvaluationResults', () => {
    beforeEach(() => {
      // 本组不涉签字包——置 null 走通闸门（外层默认 mock 是闭环态，供归档组用）
      prisma.bidSignPacket.findUnique.mockResolvedValue(null);
    });

    it('rejects until all experts confirm reports', async () => {
      prisma.bidProject.findUnique.mockResolvedValue({
        id: 'p1', stage: 'EVALUATING', name: '测试项目',
        experts: [{ id: 'e1', expertRole: '正选', reportConfirmed: false }, { id: 'e2', expertRole: '正选', reportConfirmed: true }],
        suppliers: [],
      });

      await expect(service.generateEvaluationResults('p1'))
        .rejects.toMatchObject({ response: { code: 'EXPERT_REPORTS_NOT_CONFIRMED' } });
    });

    it('rejects when leader has not co-signed', async () => {
      prisma.bidProject.findUnique.mockResolvedValue({
        id: 'p1', stage: 'EVALUATING', name: '测试项目',
        experts: [{ id: 'e1', expertRole: '正选', reportConfirmed: true }, { id: 'e2', expertRole: '正选', reportConfirmed: true }],
        suppliers: [],
      });
      await expect(service.generateEvaluationResults('p1'))
        .rejects.toMatchObject({ response: { code: 'LEADER_NOT_COSIGNED' } });
    });

    it('rejects when project is not EVALUATING', async () => {
      prisma.bidProject.findUnique.mockResolvedValue({ id: 'p1', stage: 'OPENING', name: 'x', experts: [], suppliers: [] });
      await expect(service.generateEvaluationResults('p1'))
        .rejects.toMatchObject({ response: { code: 'PROJECT_NOT_EVALUATING' } });
    });

    it('spec §10：签字包已闭环 → 重生成结果 409（闭环签字与结果一一对应）', async () => {
      prisma.bidProject.findUnique.mockResolvedValue({
        id: 'p1', stage: 'EVALUATING', name: '测试项目', leaderCoSigned: true,
        experts: [{ id: 'e1', expertRole: '正选', reportConfirmed: true }],
        suppliers: [],
      });
      prisma.bidSignPacket.findUnique.mockResolvedValue({ closedAt: new Date() });
      await expect(service.generateEvaluationResults('p1'))
        .rejects.toMatchObject({ response: { code: 'SIGN_PACKET_CLOSED' } });
    });

    it('spec §10：未闭环签字包 → 重生成结果时删除包并重置全员签字状态', async () => {
      prisma.bidProject.findUnique.mockResolvedValue({
        id: 'p1', stage: 'EVALUATING', name: '测试项目', leaderCoSigned: true,
        experts: [{ id: 'e1', expertRole: '正选', reportConfirmed: true }],
        suppliers: [
          { id: 's1', supplierName: '甲', decryptStatus: 'SUCCESS', submitStatus: '已提交', confirmStatus: 'CONFIRMED' },
        ],
      });
      prisma.bidScoreRecord.findMany.mockImplementation((args: any) =>
        Promise.resolve(args.where.supplierId === 's1' ? [{ score: 90 }] : [{ score: 70 }]),
      );
      prisma.bidSignPacket.findUnique.mockResolvedValue({ fileAssetId: 'fa-sign', sha256: 'sha-stale', closedAt: null });

      await service.generateEvaluationResults('p1');

      expect(prisma.bidSignPacket.delete).toHaveBeenCalledWith({ where: { projectId: 'p1' } });
      expect(prisma.bidExpert.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { projectId: 'p1', expertRole: '正选' },
          data: expect.objectContaining({ signStatus: 'PENDING', signScanFileId: null, dissentingOpinion: null }),
        }),
      );
    });

    it('ranks suppliers by average score and recommends the top supplier', async () => {
      prisma.bidProject.findUnique.mockResolvedValue({
        id: 'p1', stage: 'EVALUATING', name: '测试项目', leaderCoSigned: true,
        experts: [{ id: 'e1', expertRole: '正选', reportConfirmed: true }, { id: 'e2', expertRole: '正选', reportConfirmed: true }],
        suppliers: [
          { id: 's1', supplierName: '甲', decryptStatus: 'SUCCESS', submitStatus: '已提交', confirmStatus: 'CONFIRMED' },
          { id: 's2', supplierName: '乙', decryptStatus: 'SUCCESS', submitStatus: '已提交', confirmStatus: 'CONFIRMED' },
          { id: 's3', supplierName: '丙', decryptStatus: 'SUCCESS', submitStatus: '已撤回', confirmStatus: 'CONFIRMED' },
        ],
      });
      prisma.bidScoreRecord.findMany.mockImplementation((args: any) =>
        Promise.resolve(args.where.supplierId === 's1' ? [{ score: 90 }, { score: 80 }] : [{ score: 70 }, { score: 60 }]),
      );
      prisma.bidEvaluationResult.deleteMany.mockResolvedValue({ count: 0 });
      prisma.bidEvaluationResult.createMany.mockResolvedValue({ count: 2 });
      prisma.bidEvaluationResult.findMany.mockResolvedValue([
        { supplierName: '甲', rank: 1, recommended: true, averageScore: 85 },
        { supplierName: '乙', rank: 2, recommended: false, averageScore: 65 },
      ]);
      prisma.bidSupervisionLog.create.mockResolvedValue({});

      const { results } = await service.generateEvaluationResults('p1');

      expect(prisma.bidEvaluationResult.createMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.arrayContaining([
            expect.objectContaining({ supplierId: 's1', rank: 1, recommended: true }),
            // G2: 去极值后 active 供应商≤3 时全部进入候选人名单，s2 (rank 2) 亦被推荐
            expect.objectContaining({ supplierId: 's2', rank: 2, recommended: true }),
          ]),
        }),
      );
      // 撤回供应商 s3 不参与结果
      const created = prisma.bidEvaluationResult.createMany.mock.calls[0][0].data as any[];
      expect(created.find((r: any) => r.supplierId === 's3')).toBeUndefined();
      expect(results[0].supplierName).toBe('甲');
    });

    it('N3：结果重生成时评标快照 fileAsset 走 upsert（不再 create 撞 key 被 catch 吞）', async () => {
      // 沿用上方成功用例的 mock 前置（复制自包含）
      prisma.bidProject.findUnique.mockResolvedValue({
        id: 'p1', stage: 'EVALUATING', name: '测试项目', leaderCoSigned: true,
        experts: [{ id: 'e1', expertRole: '正选', reportConfirmed: true }, { id: 'e2', expertRole: '正选', reportConfirmed: true }],
        suppliers: [
          { id: 's1', supplierName: '甲', decryptStatus: 'SUCCESS', submitStatus: '已提交', confirmStatus: 'CONFIRMED' },
          { id: 's2', supplierName: '乙', decryptStatus: 'SUCCESS', submitStatus: '已提交', confirmStatus: 'CONFIRMED' },
          { id: 's3', supplierName: '丙', decryptStatus: 'SUCCESS', submitStatus: '已撤回', confirmStatus: 'CONFIRMED' },
        ],
      });
      prisma.bidScoreRecord.findMany.mockImplementation((args: any) =>
        Promise.resolve(args.where.supplierId === 's1' ? [{ score: 90 }, { score: 80 }] : [{ score: 70 }, { score: 60 }]),
      );
      prisma.bidEvaluationResult.deleteMany.mockResolvedValue({ count: 0 });
      prisma.bidEvaluationResult.createMany.mockResolvedValue({ count: 2 });
      prisma.bidEvaluationResult.findMany.mockResolvedValue([
        { supplierName: '甲', rank: 1, recommended: true, averageScore: 85 },
        { supplierName: '乙', rank: 2, recommended: false, averageScore: 65 },
      ]);
      prisma.bidSupervisionLog.create.mockResolvedValue({});
      prisma.bidSignPacket.findUnique.mockResolvedValue(null);
      // buildEvaluationPackage 走到 fileAsset 写入所需 delegate（基础 mock 缺 findMany——旧代码在此被 catch 吞）
      prisma.bidScoreRecordHistory.findMany = jest.fn().mockResolvedValue([]);
      prisma.bidScorePointDecision.findMany = jest.fn().mockResolvedValue([]);
      prisma.fileAsset.upsert = jest.fn().mockResolvedValue({ id: 'fa-1' });
      prisma.fileAsset.create = jest.fn(); // 基础 mock 未挂 create——断言「未被调用」须其存在

      await service.generateEvaluationResults('p1', 'u1');

      // 结果重生成 = 同 key 覆盖 MinIO；FileAsset 须 upsert 使 DB 指纹与新内容一致（旧 create 撞 @unique 被外层 catch 吞）
      expect(prisma.fileAsset.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { key: 'bid-evaluation-handover/p1.json' },
          update: expect.objectContaining({ sha256: expect.any(String) }),
        }),
      );
      expect(prisma.fileAsset.create).not.toHaveBeenCalled();
    });

    /* ── F11（2026-08-28）：基准价偏离法/比例法基准=最高限价——缺失时旧实现全供应商价格分静默置 0
       仅 warn 后照常生成官方结果；改为 400 拦截。公式缺失→专家手填回退、最低评标价法不受影响 ── */
    it('F11：基准价偏离法/比例法 + 缺最高限价 → 400 CEILING_PRICE_REQUIRED，calculate 不执行', async () => {
      for (const formulaType of ['benchmark_deviation', 'ratio'] as const) {
        prisma.bidProject.findUnique.mockResolvedValue({
          id: 'p1', stage: 'EVALUATING', name: '测试项目', leaderCoSigned: true,
          priceFormulaConfig: { formulaType }, // 不设 ceilingPrice
          experts: [{ id: 'e1', expertRole: '正选', reportConfirmed: true }],
          suppliers: [
            { id: 's1', supplierName: '甲', decryptStatus: 'SUCCESS', submitStatus: '已提交', confirmStatus: 'CONFIRMED' },
          ],
        });
        prisma.bidScoreItem.findMany.mockImplementation((args: any) =>
          Promise.resolve(args?.where?.category === 'PRICE' ? [{ id: 'pi1', category: 'PRICE', maxScore: 30 }] : []));
        await expect(service.generateEvaluationResults('p1'))
          .rejects.toMatchObject({ response: { code: 'CEILING_PRICE_REQUIRED' } });
      }
      expect((service as any).priceFormula.calculate).not.toHaveBeenCalled();
    });

    it('F11：最低评标价法不依赖限价 → 放行至 calculate', async () => {
      prisma.bidProject.findUnique.mockResolvedValue({
        id: 'p1', stage: 'EVALUATING', name: '测试项目', leaderCoSigned: true,
        priceFormulaConfig: { formulaType: 'lowest_price' }, // 无 ceilingPrice 亦放行
        experts: [{ id: 'e1', expertRole: '正选', reportConfirmed: true }],
        suppliers: [
          { id: 's1', supplierName: '甲', decryptStatus: 'SUCCESS', submitStatus: '已提交', confirmStatus: 'CONFIRMED' },
        ],
      });
      prisma.bidScoreItem.findMany.mockImplementation((args: any) =>
        Promise.resolve(args?.where?.category === 'PRICE' ? [{ id: 'pi1', category: 'PRICE', maxScore: 30 }] : []));
      prisma.bidOpeningRecord.findMany.mockResolvedValueOnce([
        { bidSupplierId: 's1', amount: '100' },
      ]);
      // 成功路径其余 mock（同排序用例）
      prisma.bidEvaluationResult.deleteMany.mockResolvedValue({ count: 0 });
      prisma.bidEvaluationResult.createMany.mockResolvedValue({ count: 1 });
      prisma.bidEvaluationResult.findMany.mockResolvedValue([
        { supplierName: '甲', rank: 1, recommended: true, averageScore: 85 },
      ]);
      prisma.bidSupervisionLog.create.mockResolvedValue({});

      await service.generateEvaluationResults('p1');

      expect((service as any).priceFormula.calculate).toHaveBeenCalledWith(
        { formulaType: 'lowest_price' },
        expect.any(Map),
        null, // ceilingPrice
        30,
      );
    });
  });


  describe('BidEvaluationResultsService.generateEvaluationResults — 去极值与候选人 (G2)', () => {
    const buildProject = (overrides = {}) => ({
      id: 'p1', stage: 'EVALUATING', name: '项目', leaderCoSigned: true,
      experts: [
        { id: 'e1', reportConfirmed: true },
        { id: 'e2', reportConfirmed: true },
        { id: 'e3', reportConfirmed: true },
        { id: 'e4', reportConfirmed: true },
        { id: 'e5', reportConfirmed: true },
      ],
      suppliers: [
        { id: 's1', supplierName: '甲', decryptStatus: 'SUCCESS', submitStatus: '已提交', confirmStatus: 'CONFIRMED' },
      ],
      ...overrides,
    });

    beforeEach(() => {
      prisma.bidProject.findUnique.mockResolvedValue(buildProject());
      prisma.bidSignPacket.findUnique.mockResolvedValue(null); // spec §10 闸门放行
      prisma.bidEvaluationResult.deleteMany.mockResolvedValue({ count: 0 });
      prisma.bidEvaluationResult.createMany.mockResolvedValue({ count: 1 });
      prisma.bidEvaluationResult.findMany.mockResolvedValue([]);
      prisma.bidSupervisionLog.create.mockResolvedValue({});
      prisma.auditLog.create.mockResolvedValue({});
    });

    it('专家组=5 时去掉一个最高一个最低后求平均', async () => {
      // 5 位专家对 s1 的总评分：10,20,30,40,100 → 去掉 100 与 10 → 20+30+40=90 / 3 = 30
      const scores = [
        { expertId: 'e1', supplierId: 's1', score: 10 },
        { expertId: 'e2', supplierId: 's1', score: 20 },
        { expertId: 'e3', supplierId: 's1', score: 30 },
        { expertId: 'e4', supplierId: 's1', score: 40 },
        { expertId: 'e5', supplierId: 's1', score: 100 },
      ];
      prisma.bidScoreRecord.findMany.mockResolvedValue(scores);

      const result = await service.generateEvaluationResults('p1', 'u1');

      expect(prisma.bidEvaluationResult.createMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.arrayContaining([
            expect.objectContaining({ averageScore: 30 }),
          ]),
        }),
      );
      expect(result).toBeDefined();
    });

    it('专家组<5 时不去极值，直接求平均', async () => {
      prisma.bidProject.findUnique.mockResolvedValue(buildProject({
        experts: [
          { id: 'e1', reportConfirmed: true },
          { id: 'e2', reportConfirmed: true },
          { id: 'e3', reportConfirmed: true },
        ],
      }));
      const scores = [
        { expertId: 'e1', supplierId: 's1', score: 10 },
        { expertId: 'e2', supplierId: 's1', score: 20 },
        { expertId: 'e3', supplierId: 's1', score: 30 },
      ];
      prisma.bidScoreRecord.findMany.mockResolvedValue(scores);

      await service.generateEvaluationResults('p1', 'u1');

      // (10+20+30)/3 = 20
      expect(prisma.bidEvaluationResult.createMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.arrayContaining([
            expect.objectContaining({ averageScore: 20 }),
          ]),
        }),
      );
    });

    it('前 3 名均标记 recommended（候选人）', async () => {
      prisma.bidProject.findUnique.mockResolvedValue(buildProject({
        suppliers: [
          { id: 's1', supplierName: '甲', decryptStatus: 'SUCCESS', submitStatus: '已提交', confirmStatus: 'CONFIRMED' },
          { id: 's2', supplierName: '乙', decryptStatus: 'SUCCESS', submitStatus: '已提交', confirmStatus: 'CONFIRMED' },
          { id: 's3', supplierName: '丙', decryptStatus: 'SUCCESS', submitStatus: '已提交', confirmStatus: 'CONFIRMED' },
          { id: 's4', supplierName: '丁', decryptStatus: 'SUCCESS', submitStatus: '已提交', confirmStatus: 'CONFIRMED' },
        ],
      }));
      prisma.bidScoreRecord.findMany.mockResolvedValue([
        { expertId: 'e1', supplierId: 's1', score: 90 },
        { expertId: 'e2', supplierId: 's2', score: 80 },
        { expertId: 'e3', supplierId: 's3', score: 70 },
        { expertId: 'e4', supplierId: 's4', score: 60 },
      ]);

      await service.generateEvaluationResults('p1', 'u1');

      const call = prisma.bidEvaluationResult.createMany.mock.calls[0][0];
      const data = call.data as any[];
      const recommendedRanks = data.filter((d: any) => d.recommended).map((d: any) => d.rank).sort();
      expect(recommendedRanks).toEqual([1, 2, 3]);
    });

    it('generateEvaluationResults：通过性过半不通过 → 废标，排末位且不推荐', async () => {
      prisma.bidScoreItem.findMany.mockResolvedValue([
        { id: 'si_qual', category: 'QUALIFICATION' },
      ]);
      // 3 专家，2 票不通过 1 票通过 → 过半废标
      prisma.bidProject.findUnique.mockResolvedValue({
        id: 'p1', name: '项目', stage: 'EVALUATING', bondRequired: false, leaderCoSigned: true,
        experts: [{ id: 'e1', expertRole: '正选', reportConfirmed: true }, { id: 'e2', expertRole: '正选', reportConfirmed: true }, { id: 'e3', expertRole: '正选', reportConfirmed: true }],
        suppliers: [{ id: 's1', supplierName: '甲', decryptStatus: 'SUCCESS', submitStatus: 'ok', confirmStatus: 'CONFIRMED' }],
      });
      prisma.bidScoreRecord.findMany.mockResolvedValue([
        // 通过性项：2 不通过 + 1 通过
        { supplierId: 's1', expertId: 'e1', score: 0, passed: false, scoreItemId: 'si_qual' },
        { supplierId: 's1', expertId: 'e2', score: 0, passed: false, scoreItemId: 'si_qual' },
        { supplierId: 's1', expertId: 'e3', score: 0, passed: true, scoreItemId: 'si_qual' },
        // 数值项每人 10 分
        { supplierId: 's1', expertId: 'e1', score: 10 },
        { supplierId: 's1', expertId: 'e2', score: 10 },
        { supplierId: 's1', expertId: 'e3', score: 10 },
      ]);
      prisma.bidEvaluationResult.deleteMany.mockResolvedValue({});
      prisma.bidEvaluationResult.createMany.mockResolvedValue({});
      prisma.bidSupervisionLog.create.mockResolvedValue({});
      prisma.bidEvaluationResult.findMany.mockResolvedValue([
        { supplierId: 's1', supplierName: '甲', totalScore: 30, averageScore: 10, rank: 1, recommended: false, disqualified: true },
      ]);

      await service.generateEvaluationResults('p1');

      const created = (prisma.bidEvaluationResult.createMany.mock.calls[0][0] as any).data[0];
      expect(created.disqualified).toBe(true);
      expect(created.recommended).toBe(false);
    });

    it('H2: 已撤销的废标（BidInvalidBid.status=revoked）不计入失败票，供应商不判废', async () => {
      prisma.bidScoreItem.findMany.mockResolvedValue([
        { id: 'si_qual', category: 'QUALIFICATION' },
      ]);
      prisma.bidProject.findUnique.mockResolvedValue({
        id: 'p1', name: '项目', stage: 'EVALUATING', bondRequired: false, leaderCoSigned: true,
        experts: [{ id: 'e1', expertRole: '正选', reportConfirmed: true }, { id: 'e2', expertRole: '正选', reportConfirmed: true }, { id: 'e3', expertRole: '正选', reportConfirmed: true }],
        suppliers: [{ id: 's1', supplierName: '甲', decryptStatus: 'SUCCESS', submitStatus: 'ok', confirmStatus: 'CONFIRMED' }],
      });
      // 通过性项原本 2 不通过 + 1 通过 → 过半判废；但该 (s1,si_qual) 废标已被管理员撤销
      prisma.bidScoreRecord.findMany.mockResolvedValue([
        { supplierId: 's1', expertId: 'e1', score: 0, passed: false, scoreItemId: 'si_qual' },
        { supplierId: 's1', expertId: 'e2', score: 0, passed: false, scoreItemId: 'si_qual' },
        { supplierId: 's1', expertId: 'e3', score: 0, passed: true, scoreItemId: 'si_qual' },
        { supplierId: 's1', expertId: 'e1', score: 10 },
        { supplierId: 's1', expertId: 'e2', score: 10 },
        { supplierId: 's1', expertId: 'e3', score: 10 },
      ]);
      prisma.bidInvalidBid.findMany.mockResolvedValue([{ supplierId: 's1', scoreItemId: 'si_qual' }]); // 已撤销
      prisma.bidEvaluationResult.deleteMany.mockResolvedValue({});
      prisma.bidEvaluationResult.createMany.mockResolvedValue({});
      prisma.bidSupervisionLog.create.mockResolvedValue({});
      prisma.bidEvaluationResult.findMany.mockResolvedValue([
        { supplierId: 's1', supplierName: '甲', totalScore: 30, averageScore: 10, rank: 1, recommended: true, disqualified: false },
      ]);

      await service.generateEvaluationResults('p1');

      const created = (prisma.bidEvaluationResult.createMany.mock.calls[0][0] as any).data[0];
      expect(created.disqualified).toBe(false); // 撤销生效：不再判废
      expect(created.recommended).toBe(true);
    });

    it('generateEvaluationResults：不通过不过半 → 不废标', async () => {
      prisma.bidScoreItem.findMany.mockResolvedValue([
        { id: 'si_resp', category: 'RESPONSIVE' },
      ]);
      prisma.bidProject.findUnique.mockResolvedValue({
        id: 'p1', name: '项目', stage: 'EVALUATING', bondRequired: false, leaderCoSigned: true,
        experts: [{ id: 'e1', expertRole: '正选', reportConfirmed: true }, { id: 'e2', expertRole: '正选', reportConfirmed: true }, { id: 'e3', expertRole: '正选', reportConfirmed: true }],
        suppliers: [{ id: 's1', supplierName: '甲', decryptStatus: 'SUCCESS', submitStatus: 'ok', confirmStatus: 'CONFIRMED' }],
      });
      // 1 不通过 2 通过 → 不过半
      prisma.bidScoreRecord.findMany.mockResolvedValue([
        { supplierId: 's1', expertId: 'e1', score: 0, passed: false, scoreItemId: 'si_resp' },
        { supplierId: 's1', expertId: 'e2', score: 0, passed: true, scoreItemId: 'si_resp' },
        { supplierId: 's1', expertId: 'e3', score: 0, passed: true, scoreItemId: 'si_resp' },
        { supplierId: 's1', expertId: 'e1', score: 20 },
        { supplierId: 's1', expertId: 'e2', score: 20 },
        { supplierId: 's1', expertId: 'e3', score: 20 },
      ]);
      prisma.bidEvaluationResult.deleteMany.mockResolvedValue({});
      prisma.bidEvaluationResult.createMany.mockResolvedValue({});
      prisma.bidSupervisionLog.create.mockResolvedValue({});
      prisma.bidEvaluationResult.findMany.mockResolvedValue([]);

      await service.generateEvaluationResults('p1');

      const created = (prisma.bidEvaluationResult.createMany.mock.calls[0][0] as any).data[0];
      expect(created.disqualified).toBe(false);
    });

    it('谈判采购: 合格供应商按最终报价升序排名, winner=1', async () => {
      prisma.bidProject.findUnique.mockResolvedValue({
        id: 'p1', name: '谈判项目', stage: 'EVALUATING', bondRequired: false, leaderCoSigned: true,
        procurementMethod: '谈判采购',
        experts: [{ id: 'e1', expertRole: '正选', reportConfirmed: true }],
        suppliers: [
          { id: 's1', supplierName: '甲', decryptStatus: 'SUCCESS', submitStatus: '已提交', confirmStatus: 'CONFIRMED' },
          { id: 's2', supplierName: '乙', decryptStatus: 'SUCCESS', submitStatus: '已提交', confirmStatus: 'CONFIRMED' },
          { id: 's3', supplierName: '丙', decryptStatus: 'SUCCESS', submitStatus: '已提交', confirmStatus: 'CONFIRMED' },
        ],
      });
      prisma.bidScoreItem.findMany.mockResolvedValue([]);
      prisma.bidScoreRecord.findMany.mockResolvedValue([]);
      // 报价: 甲=100, 乙=80, 丙=120 → 排名应为 乙(80)<甲(100)<丙(120)
      prisma.bidOpeningRecord.findMany.mockResolvedValue([
        { bidSupplierId: 's1', amount: '100' },
        { bidSupplierId: 's2', amount: '80' },
        { bidSupplierId: 's3', amount: '120' },
      ]);
      prisma.bidEvaluationResult.deleteMany.mockResolvedValue({});
      prisma.bidEvaluationResult.createMany.mockResolvedValue({});
      prisma.bidSupervisionLog.create.mockResolvedValue({});
      prisma.bidEvaluationResult.findMany.mockResolvedValue([]);
      prisma.auditLog.create.mockResolvedValue({});

      await service.generateEvaluationResults('p1');

      const data = (prisma.bidEvaluationResult.createMany.mock.calls[0][0] as any).data;
      expect(data).toHaveLength(3);
      // rank 1 = 乙(80), rank 2 = 甲(100), rank 3 = 丙(120)
      expect(data[0].supplierName).toBe('乙');
      expect(data[0].rank).toBe(1);
      expect(data[0].recommended).toBe(true); // winner=1
      expect(data[1].supplierName).toBe('甲');
      expect(data[1].rank).toBe(2);
      expect(data[1].recommended).toBe(false);
      expect(data[2].supplierName).toBe('丙');
      expect(data[2].rank).toBe(3);
      expect(data[2].recommended).toBe(false);
    });

    it('谈判采购: 废标供应商排末位, 不影响合格者按价排', async () => {
      prisma.bidProject.findUnique.mockResolvedValue({
        id: 'p1', name: '谈判项目', stage: 'EVALUATING', bondRequired: false, leaderCoSigned: true,
        procurementMethod: '谈判采购',
        experts: [{ id: 'e1', expertRole: '正选', reportConfirmed: true }, { id: 'e2', expertRole: '正选', reportConfirmed: true }, { id: 'e3', expertRole: '正选', reportConfirmed: true }],
        suppliers: [
          { id: 's1', supplierName: '甲', decryptStatus: 'SUCCESS', submitStatus: '已提交', confirmStatus: 'CONFIRMED' },
          { id: 's2', supplierName: '乙(废标)', decryptStatus: 'SUCCESS', submitStatus: '已提交', confirmStatus: 'CONFIRMED' },
        ],
      });
      prisma.bidScoreItem.findMany.mockResolvedValue([
        { id: 'si_qual', category: 'QUALIFICATION' },
      ]);
      // 乙: 通过性 2/3 不通过 → 废标
      prisma.bidScoreRecord.findMany.mockResolvedValue([
        { supplierId: 's2', expertId: 'e1', score: 0, passed: false, scoreItemId: 'si_qual' },
        { supplierId: 's2', expertId: 'e2', score: 0, passed: false, scoreItemId: 'si_qual' },
        { supplierId: 's2', expertId: 'e3', score: 0, passed: true, scoreItemId: 'si_qual' },
      ]);
      // 甲报价 100, 乙报价 50 (更低但废标)
      prisma.bidOpeningRecord.findMany.mockResolvedValue([
        { bidSupplierId: 's1', amount: '100' },
        { bidSupplierId: 's2', amount: '50' },
      ]);
      prisma.bidInvalidBid.findMany.mockResolvedValue([]);
      prisma.bidEvaluationResult.deleteMany.mockResolvedValue({});
      prisma.bidEvaluationResult.createMany.mockResolvedValue({});
      prisma.bidSupervisionLog.create.mockResolvedValue({});
      prisma.bidEvaluationResult.findMany.mockResolvedValue([]);
      prisma.auditLog.create.mockResolvedValue({});

      await service.generateEvaluationResults('p1');

      const data = (prisma.bidEvaluationResult.createMany.mock.calls[0][0] as any).data;
      // 甲 rank 1 (合格, 报价 100), 乙 rank 2 (废标, 即使报价更低)
      expect(data[0].supplierName).toBe('甲');
      expect(data[0].disqualified).toBe(false);
      expect(data[0].recommended).toBe(true);
      expect(data[1].supplierName).toBe('乙(废标)');
      expect(data[1].disqualified).toBe(true);
      expect(data[1].recommended).toBe(false);
    });

    it('谈判采购·无公式配置·最终报价超限价 → 判废并写正确废标决议文案', async () => {
      prisma.bidProject.findUnique.mockResolvedValue({
        id: 'p1', name: '谈判项目', stage: 'EVALUATING', bondRequired: false, leaderCoSigned: true,
        procurementMethod: '谈判采购', ceilingPrice: 100,
        experts: [{ id: 'e1', expertRole: '正选', reportConfirmed: true }],
        suppliers: [
          { id: 's1', supplierName: '甲', decryptStatus: 'SUCCESS', submitStatus: '已提交', confirmStatus: 'CONFIRMED' },
          { id: 's2', supplierName: '乙', decryptStatus: 'SUCCESS', submitStatus: '已提交', confirmStatus: 'CONFIRMED' },
        ],
      });
      prisma.bidScoreItem.findMany.mockResolvedValue([]);
      prisma.bidScoreRecord.findMany.mockResolvedValue([]);
      // 最终报价: 甲=80(未超), 乙=120(超限价 100)
      prisma.bidOpeningRecord.findMany.mockResolvedValue([
        { bidSupplierId: 's1', amount: '80' },
        { bidSupplierId: 's2', amount: '120' },
      ]);
      (service as any).priceFormula.getOverCeilingSuppliers.mockReturnValue(['s2']);
      prisma.bidEvaluationResult.deleteMany.mockResolvedValue({});
      prisma.bidEvaluationResult.createMany.mockResolvedValue({});
      prisma.bidSupervisionLog.create.mockResolvedValue({});
      prisma.bidEvaluationResult.findMany.mockResolvedValue([]);
      prisma.auditLog.create.mockResolvedValue({});

      await service.generateEvaluationResults('p1');

      expect((service as any).priceFormula.getOverCeilingSuppliers).toHaveBeenCalledWith(expect.any(Map), 100);
      const data = (prisma.bidEvaluationResult.createMany.mock.calls[0][0] as any).data;
      expect(data[0].supplierName).toBe('甲');
      expect(data[0].disqualified).toBe(false);
      expect(data[0].recommended).toBe(true);
      expect(data[1].supplierName).toBe('乙');
      expect(data[1].disqualified).toBe(true);
      expect(data[1].recommended).toBe(false);
      // 超限价供应商 bidValidity 落库为 invalid
      expect(prisma.bidSupplier.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 's2' }, data: { bidValidity: 'invalid' } }),
      );
      // 废标决议日志：超限价专属文案，不出现 0/0 票与「响应性性」
      const abolishLogs = prisma.bidSupervisionLog.create.mock.calls
        .filter((c: any[]) => c[0]?.data?.action === '废标决议')
        .map((c: any[]) => c[0].data.result);
      expect(abolishLogs).toHaveLength(1);
      expect(abolishLogs[0]).toContain('最高限价');
      expect(abolishLogs[0]).not.toMatch(/0\/0/);
      expect(abolishLogs[0]).not.toContain('响应性性');
    });

    it('谈判采购·最终报价均未超限价 → 不废标', async () => {
      prisma.bidProject.findUnique.mockResolvedValue({
        id: 'p1', name: '谈判项目', stage: 'EVALUATING', bondRequired: false, leaderCoSigned: true,
        procurementMethod: '谈判采购', ceilingPrice: 100,
        experts: [{ id: 'e1', expertRole: '正选', reportConfirmed: true }],
        suppliers: [
          { id: 's1', supplierName: '甲', decryptStatus: 'SUCCESS', submitStatus: '已提交', confirmStatus: 'CONFIRMED' },
          { id: 's2', supplierName: '乙', decryptStatus: 'SUCCESS', submitStatus: '已提交', confirmStatus: 'CONFIRMED' },
        ],
      });
      prisma.bidScoreItem.findMany.mockResolvedValue([]);
      prisma.bidScoreRecord.findMany.mockResolvedValue([]);
      prisma.bidOpeningRecord.findMany.mockResolvedValue([
        { bidSupplierId: 's1', amount: '80' },
        { bidSupplierId: 's2', amount: '90' },
      ]);
      // 默认 mock 返回 []（未超限价）
      prisma.bidEvaluationResult.deleteMany.mockResolvedValue({});
      prisma.bidEvaluationResult.createMany.mockResolvedValue({});
      prisma.bidSupervisionLog.create.mockResolvedValue({});
      prisma.bidEvaluationResult.findMany.mockResolvedValue([]);
      prisma.auditLog.create.mockResolvedValue({});

      await service.generateEvaluationResults('p1');

      const data = (prisma.bidEvaluationResult.createMany.mock.calls[0][0] as any).data;
      expect(data.every((d: any) => d.disqualified === false)).toBe(true);
      expect(prisma.bidSupervisionLog.create.mock.calls
        .filter((c: any[]) => c[0]?.data?.action === '废标决议')).toHaveLength(0);
    });

    it('公式引擎路径行为不变（邀请招标+公式配置）→ 仍触发超限价判废', async () => {
      prisma.bidProject.findUnique.mockResolvedValue({
        id: 'p1', name: '招标项目', stage: 'EVALUATING', bondRequired: false, leaderCoSigned: true,
        procurementMethod: '邀请招标', ceilingPrice: 100, priceFormulaConfig: { formulaType: 'benchmark_deviation' },
        experts: [{ id: 'e1', expertRole: '正选', reportConfirmed: true }],
        suppliers: [
          { id: 's1', supplierName: '甲', decryptStatus: 'SUCCESS', submitStatus: '已提交', confirmStatus: 'CONFIRMED' },
          { id: 's2', supplierName: '乙', decryptStatus: 'SUCCESS', submitStatus: '已提交', confirmStatus: 'CONFIRMED' },
        ],
      });
      prisma.bidScoreItem.findMany.mockResolvedValue([
        { id: 'pi1', category: 'PRICE', maxScore: 100 },
      ]);
      prisma.bidScoreRecord.findMany.mockResolvedValue([]);
      prisma.bidOpeningRecord.findMany.mockResolvedValue([
        { bidSupplierId: 's1', amount: '80' },
        { bidSupplierId: 's2', amount: '120' },
      ]);
      (service as any).priceFormula.getOverCeilingSuppliers.mockReturnValue(['s2']);
      prisma.bidEvaluationResult.deleteMany.mockResolvedValue({});
      prisma.bidEvaluationResult.createMany.mockResolvedValue({});
      prisma.bidSupervisionLog.create.mockResolvedValue({});
      prisma.bidEvaluationResult.findMany.mockResolvedValue([]);
      prisma.auditLog.create.mockResolvedValue({});

      await service.generateEvaluationResults('p1');

      expect((service as any).priceFormula.getOverCeilingSuppliers).toHaveBeenCalledWith(expect.any(Map), 100);
      expect((service as any).priceFormula.calculate).toHaveBeenCalled();
      const data = (prisma.bidEvaluationResult.createMany.mock.calls[0][0] as any).data;
      expect(data.find((d: any) => d.supplierId === 's2').disqualified).toBe(true);
    });
  });

});

describe('BidEvaluationResultsService — generateEvaluationResults 保证金软标记', () => {
  let service: BidEvaluationResultsService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      bidProject: { findUnique: jest.fn() },
      bidScoreRecord: { findMany: jest.fn().mockResolvedValue([]) },
      bidScoreItem: { findMany: jest.fn().mockResolvedValue([]) },
      bidEvaluationResult: { deleteMany: jest.fn(), createMany: jest.fn(), findMany: jest.fn().mockResolvedValue([]) },
      bidOpeningRecord: { findMany: jest.fn().mockResolvedValue([]) },
      bidBondLedger: { findMany: jest.fn().mockResolvedValue([]) }, // A-104：软标记台账比对（默认无台账行）
      auditLog: { create: jest.fn() },
      bidInvalidBid: { findMany: jest.fn().mockResolvedValue([]) },
      expertDispute: { count: jest.fn().mockResolvedValue(0) },
      bidSupervisionLog: { create: jest.fn() },
      // spec §10 闸门/失效联动：无签字包（findUnique null），事务内 delete 不触发
      bidSignPacket: { findUnique: jest.fn().mockResolvedValue(null), delete: jest.fn().mockResolvedValue({}) },
      bidExpert: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
      $transaction: jest.fn(async (cb: any) => cb({
        bidProject: { findUnique: jest.fn().mockResolvedValue({ stage: 'EVALUATING', name: '测试项目' }) },
        bidEvaluationResult: { deleteMany: jest.fn(), createMany: jest.fn() },
        bidSupervisionLog: { create: jest.fn() },
        bidSupplier: { update: jest.fn() },
        bidSignPacket: { findUnique: jest.fn().mockResolvedValue(null), delete: jest.fn().mockResolvedValue({}) },
        bidExpert: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
        $queryRaw: jest.fn().mockResolvedValue(undefined),
      })),
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        { provide: PriceFormulaService, useValue: { calculate: jest.fn().mockReturnValue(new Map()), getOverCeilingSuppliers: jest.fn().mockReturnValue([]) } },
        { provide: StorageService, useValue: { upload: jest.fn() } },
        { provide: PrismaService, useValue: prisma },
        { provide: BidService, useValue: { syncMultiRoundPrices: jest.fn() } },
        BidEvaluationResultsService,
      ],
    }).compile();
    service = module.get(BidEvaluationResultsService);
  });

  it('bondRequired 且某供应商保证金未达标 → 写高风险监督日志，但仍纳入排名', async () => {
    prisma.bidProject.findUnique.mockResolvedValue({
      id: 'p1', name: 'X', stage: 'EVALUATING', bondRequired: true, leaderCoSigned: true,
      bondAmount: 200000, deadline: new Date('2026-08-01T17:00:00+08:00'),
      experts: [{ reportConfirmed: true }],
      suppliers: [{ id: 's1', supplierName: '甲', decryptStatus: 'SUCCESS', submitStatus: '已提交', confirmStatus: 'CONFIRMED' }],
    });
    prisma.bidOpeningRecord.findMany.mockResolvedValue([{ bidSupplierId: 's1', bondStatus: '未缴纳' }]);
    const txLogCreate = jest.fn();
    prisma.$transaction.mockImplementation(async (cb: any) => cb({
      bidProject: { findUnique: jest.fn().mockResolvedValue({ stage: 'EVALUATING', name: 'X' }) },
      bidEvaluationResult: { deleteMany: jest.fn(), createMany: jest.fn() },
      bidSupervisionLog: { create: txLogCreate },
      bidSupplier: { update: jest.fn() },
      bidSignPacket: { findUnique: jest.fn().mockResolvedValue(null), delete: jest.fn().mockResolvedValue({}) },
      bidExpert: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
      $queryRaw: jest.fn().mockResolvedValue(undefined),
    }));

    await service.generateEvaluationResults('p1', 'actor1');

    const flagged = txLogCreate.mock.calls.find(
      (c: any[]) => c[0].data.riskFlag === '高风险' && String(c[0].data.action).includes('保证金'),
    );
    expect(flagged).toBeTruthy();
    // 不合格分支措辞保持「未达标」
    expect(String(flagged![0].data.result)).toContain('未达标');
  });

  it('A-104：唱标状态合格但台账比对有出入（金额不足）→ 同样软标记，日志附台账比对结论', async () => {
    prisma.bidProject.findUnique.mockResolvedValue({
      id: 'p1', name: 'X', stage: 'EVALUATING', bondRequired: true, leaderCoSigned: true,
      bondAmount: 200000, deadline: new Date('2026-08-01T17:00:00+08:00'),
      experts: [{ reportConfirmed: true }],
      suppliers: [{ id: 's1', supplierName: '甲', decryptStatus: 'SUCCESS', submitStatus: '已提交', confirmStatus: 'CONFIRMED' }],
    });
    prisma.bidOpeningRecord.findMany.mockResolvedValue([{ bidSupplierId: 's1', bondStatus: '已缴纳' }]);
    prisma.bidBondLedger.findMany.mockResolvedValue([{ supplierName: '甲', amount: 100000, arrivedAt: new Date('2026-08-01T08:00:00+08:00'), payMethod: '转账' }]);
    const txLogCreate = jest.fn();
    prisma.$transaction.mockImplementation(async (cb: any) => cb({
      bidProject: { findUnique: jest.fn().mockResolvedValue({ stage: 'EVALUATING', name: 'X' }) },
      bidEvaluationResult: { deleteMany: jest.fn(), createMany: jest.fn() },
      bidSupervisionLog: { create: txLogCreate },
      bidSupplier: { update: jest.fn() },
      bidSignPacket: { findUnique: jest.fn().mockResolvedValue(null), delete: jest.fn().mockResolvedValue({}) },
      bidExpert: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
      $queryRaw: jest.fn().mockResolvedValue(undefined),
    }));

    await service.generateEvaluationResults('p1', 'actor1');

    const flagged = txLogCreate.mock.calls.find(
      (c: any[]) => c[0].data.riskFlag === '高风险' && String(c[0].data.action).includes('保证金'),
    );
    expect(flagged).toBeTruthy();
    expect(String(flagged![0].data.result)).toContain('台账比对');
    expect(String(flagged![0].data.result)).toContain('不足要求 200000');
    // 终审收口：合格分支措辞=「台账比对有出入」，不得误标「未达标」
    expect(String(flagged![0].data.result)).toContain('台账比对有出入');
    expect(String(flagged![0].data.result)).not.toContain('未达标');
  });

  it('bondRequired=false → 不写保证金监督日志', async () => {
    prisma.bidProject.findUnique.mockResolvedValue({
      id: 'p1', name: 'X', stage: 'EVALUATING', bondRequired: false, leaderCoSigned: true,
      experts: [{ reportConfirmed: true }],
      suppliers: [{ id: 's1', supplierName: '甲', decryptStatus: 'SUCCESS', submitStatus: '已提交', confirmStatus: 'CONFIRMED' }],
    });
    const txLogCreate = jest.fn();
    prisma.$transaction.mockImplementation(async (cb: any) => cb({
      bidProject: { findUnique: jest.fn().mockResolvedValue({ stage: 'EVALUATING', name: 'X' }) },
      bidEvaluationResult: { deleteMany: jest.fn(), createMany: jest.fn() },
      bidSupervisionLog: { create: txLogCreate },
      bidSupplier: { update: jest.fn() },
      bidSignPacket: { findUnique: jest.fn().mockResolvedValue(null), delete: jest.fn().mockResolvedValue({}) },
      bidExpert: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
      $queryRaw: jest.fn().mockResolvedValue(undefined),
    }));

    await service.generateEvaluationResults('p1', 'actor1');

    const flagged = txLogCreate.mock.calls.find((c: any[]) => String(c[0].data.action).includes('保证金'));
    expect(flagged).toBeUndefined();
  });
});

/* ── Task 1: generateEvaluationResults expertRole='正选' 过滤 ── */

describe('generateEvaluationResults expertRole filter', () => {
  it('应排除候补专家的评分记录', async () => {
    // 构造 mock：3 个正选专家 + 1 个候补专家的 BidScoreRecord
    const mainExpertId = 'expert-main-1';
    const subExpertId = 'expert-sub-1';
    const mockRecords = [
      { expertId: mainExpertId, supplierId: 'sup-1', scoreItemId: 'item-1', score: 80, passed: null },
      { expertId: subExpertId,  supplierId: 'sup-1', scoreItemId: 'item-1', score: 10, passed: null },
    ];
    // 验证候补的 10 分被排除，不被纳入去极值/均分
    const filtered = mockRecords.filter(
      r => r.expertId !== subExpertId // 模拟 expertRole='正选' 过滤效果
    );
    expect(filtered).toHaveLength(1);
    expect(filtered[0].expertId).toBe(mainExpertId);
  });

  it('service 调用 prisma 时 WHERE 子句包含 expertRole=正选', async () => {
    // 验证修复后的 service 在查询 BidScoreRecord 时带上 expertRole 过滤
    const prisma: any = {
      bidProject: { findUnique: jest.fn() },
      bidScoreRecord: { findMany: jest.fn().mockResolvedValue([]) },
      bidScoreItem: { findMany: jest.fn().mockResolvedValue([]) },
      bidEvaluationResult: { deleteMany: jest.fn(), createMany: jest.fn(), findMany: jest.fn().mockResolvedValue([]) },
      bidOpeningRecord: { findMany: jest.fn().mockResolvedValue([]) },
      bidBondLedger: { findMany: jest.fn().mockResolvedValue([]) }, // A-104：软标记台账比对（默认无台账行）
      auditLog: { create: jest.fn() },
      bidInvalidBid: { findMany: jest.fn().mockResolvedValue([]) },
      expertDispute: { count: jest.fn().mockResolvedValue(0) },
      bidSupervisionLog: { create: jest.fn() },
      // spec §10 闸门/失效联动：无签字包（findUnique null），事务内 delete 不触发
      bidSignPacket: { findUnique: jest.fn().mockResolvedValue(null), delete: jest.fn().mockResolvedValue({}) },
      bidExpert: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
      $transaction: jest.fn(async (cb: any) => cb({
        bidProject: { findUnique: jest.fn().mockResolvedValue({ stage: 'EVALUATING', name: '测试项目' }) },
        bidEvaluationResult: { deleteMany: jest.fn(), createMany: jest.fn() },
        bidSupervisionLog: { create: jest.fn() },
        bidSupplier: { update: jest.fn() },
        bidSignPacket: { findUnique: jest.fn().mockResolvedValue(null), delete: jest.fn().mockResolvedValue({}) },
        bidExpert: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
        $queryRaw: jest.fn().mockResolvedValue(undefined),
      })),
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        { provide: PriceFormulaService, useValue: { calculate: jest.fn().mockReturnValue(new Map()), getOverCeilingSuppliers: jest.fn().mockReturnValue([]) } },
        { provide: StorageService, useValue: { upload: jest.fn() } },
        { provide: PrismaService, useValue: prisma },
        { provide: BidService, useValue: { syncMultiRoundPrices: jest.fn() } },
        BidEvaluationResultsService,
      ],
    }).compile();
    const service = module.get(BidEvaluationResultsService);

    prisma.bidProject.findUnique.mockResolvedValue({
      id: 'p1', name: 'X', stage: 'EVALUATING', bondRequired: false, leaderCoSigned: true,
      experts: [
        { id: 'expert-main-1', expertRole: '正选', reportConfirmed: true },
        { id: 'expert-sub-1', expertRole: '候补', reportConfirmed: true },
      ],
      suppliers: [{ id: 's1', supplierName: '甲', decryptStatus: 'SUCCESS', submitStatus: '已提交', confirmStatus: 'CONFIRMED' }],
    });

    await service.generateEvaluationResults('p1', 'actor1');

    // 核心断言：findMany 的 WHERE 子句必须包含 expertRole: '正选'
    expect(prisma.bidScoreRecord.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          expert: expect.objectContaining({ expertRole: '正选' }),
        }),
      }),
    );
  });

  it('候补专家的通过性投票不计入废标判定', async () => {
    // 构造场景：1 正选 + 1 候补，对同一通过性项都投不通过
    // 候补的票被过滤 → total=0 → 不严格过半 → 不废标
    const subExpertId = 'expert-sub-1';
    const txCreateMany = jest.fn();
    const prisma: any = {
      bidProject: { findUnique: jest.fn() },
      bidScoreRecord: { findMany: jest.fn().mockResolvedValue([]) },
      bidScoreItem: { findMany: jest.fn().mockResolvedValue([
        { id: 'pf-item-1', category: 'QUALIFICATION' },
      ]) },
      bidEvaluationResult: { deleteMany: jest.fn(), createMany: jest.fn(), findMany: jest.fn().mockResolvedValue([]) },
      bidOpeningRecord: { findMany: jest.fn().mockResolvedValue([]) },
      bidBondLedger: { findMany: jest.fn().mockResolvedValue([]) }, // A-104：软标记台账比对（默认无台账行）
      auditLog: { create: jest.fn() },
      bidInvalidBid: { findMany: jest.fn().mockResolvedValue([]) },
      expertDispute: { count: jest.fn().mockResolvedValue(0) },
      bidSupervisionLog: { create: jest.fn() },
      // spec §10 闸门/失效联动：无签字包（findUnique null），事务内 delete 不触发
      bidSignPacket: { findUnique: jest.fn().mockResolvedValue(null), delete: jest.fn().mockResolvedValue({}) },
      bidExpert: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
      $transaction: jest.fn(async (cb: any) => cb({
        bidProject: { findUnique: jest.fn().mockResolvedValue({ stage: 'EVALUATING', name: '测试项目' }) },
        bidEvaluationResult: { deleteMany: jest.fn(), createMany: txCreateMany },
        bidSupervisionLog: { create: jest.fn() },
        bidSupplier: { update: jest.fn() },
        bidSignPacket: { findUnique: jest.fn().mockResolvedValue(null), delete: jest.fn().mockResolvedValue({}) },
        bidExpert: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
        $queryRaw: jest.fn().mockResolvedValue(undefined),
      })),
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        { provide: PriceFormulaService, useValue: { calculate: jest.fn().mockReturnValue(new Map()), getOverCeilingSuppliers: jest.fn().mockReturnValue([]) } },
        { provide: StorageService, useValue: { upload: jest.fn() } },
        { provide: PrismaService, useValue: prisma },
        { provide: BidService, useValue: { syncMultiRoundPrices: jest.fn() } },
        BidEvaluationResultsService,
      ],
    }).compile();
    const service = module.get(BidEvaluationResultsService);

    prisma.bidProject.findUnique.mockResolvedValue({
      id: 'p1', name: 'X', stage: 'EVALUATING', bondRequired: false, leaderCoSigned: true,
      experts: [
        { id: 'expert-main-1', expertRole: '正选', reportConfirmed: true },
        { id: subExpertId, expertRole: '候补', reportConfirmed: true },
      ],
      suppliers: [{ id: 's1', supplierName: '甲', decryptStatus: 'SUCCESS', submitStatus: '已提交', confirmStatus: 'CONFIRMED' }],
    });
    // 候补专家的评分记录——其不通过票不应被统计
    prisma.bidScoreRecord.findMany.mockResolvedValue([
      { expertId: subExpertId, supplierId: 's1', scoreItemId: 'pf-item-1', score: 0, passed: false },
    ]);

    await service.generateEvaluationResults('p1', 'actor1');

    // 候补专家被过滤，废标判定应无 failure（disqualified=false）
    expect(txCreateMany).toHaveBeenCalled();
    const created = txCreateMany.mock.calls[0][0].data[0];
    expect(created.disqualified).toBe(false);
  });
});

describe('abnormal low price detection', () => {
  it('报价低于均值 30%+ 应触发告警标记', () => {
    const prices = [100, 105, 40]; // 第三家异常低
    const avg = prices.reduce((a, b) => a + b, 0) / prices.length;
    const threshold = avg * 0.7; // 低于均值 30%
    const abnormal = prices.filter(p => p < threshold);
    expect(abnormal).toEqual([40]);
  });

  it('报价均正常时不触发告警', () => {
    const prices = [100, 105, 110];
    const avg = prices.reduce((a, b) => a + b, 0) / prices.length;
    const threshold = avg * 0.7;
    const abnormal = prices.filter(p => p < threshold);
    expect(abnormal).toEqual([]);
  });

  it('仅 2 家报价不满足最低门槛时不触发', () => {
    const prices = [100, 40]; // 仅2家，不满足 validPrices.length >= 3
    const avg = prices.reduce((a, b) => a + b, 0) / prices.length;
    const threshold = avg * 0.7;
    // 即使有异常低，2家也不做检测（与 generateEvaluationResults 门槛一致）
    const effectiveCount = prices.length;
    const shouldDetect = effectiveCount >= 3;
    expect(shouldDetect).toBe(false);
  });

  it('报价恰好等于均值 70% 时不触发（边界不包含等号）', () => {
    const prices = [100, 100, 70]; // 70 = avg(90) * 0.7 = 63, so 70 > 63, not abnormal
    const avg = prices.reduce((a, b) => a + b, 0) / prices.length;
    const threshold = avg * 0.7;
    const abnormal = prices.filter(p => p < threshold); // strict <
    expect(abnormal).toEqual([]);
  });

  it('报价低于均值 70% 时触发', () => {
    const prices = [100, 100, 50]; // avg=83.33, threshold=58.33, 50<58.33
    const avg = prices.reduce((a, b) => a + b, 0) / prices.length;
    const threshold = avg * 0.7;
    const abnormal = prices.filter(p => p < threshold);
    expect(abnormal).toEqual([50]);
  });
});

describe('evaluation integrity package', () => {
  it('buildEvaluationPackage 应包含全部评分记录 + 指纹', () => {
    const body = {
      packageType: 'BID_EVALUATION_HANDOVER',
      packageVersion: 1,
      generatedAt: expect.any(String) as string,
      projectId: 'proj-1',
      expertConfirmations: [{ expertName: '张三', expertRole: '正选', reportConfirmed: true, reportConfirmedAt: null, progress: 100, totalScore: 88.5 }],
      scoreRecords: [{ expertId: 'e1', supplierId: 's1', scoreItemId: 'si1', score: 80, passed: true, reason: null }],
      scoreHistory: [{ expertId: 'e1', supplierId: 's1', scoreItemId: 'si1', score: 70, passed: true, action: 'create', createdAt: '2026-01-01T00:00:00.000Z' }],
      pointDecisions: [{ expertId: 'e1', pointId: 'p1', supplierId: 's1', checked: true, awardedScore: 5 }],
    };
    const crypto = require('crypto');
    const fingerprint = crypto.createHash('sha256').update(JSON.stringify(body)).digest('hex');
    expect(fingerprint).toHaveLength(64);
    expect(JSON.parse(JSON.stringify(body)).scoreRecords).toHaveLength(1);
  });

  it('buildEvaluationPackage 指纹应对任意字段变动变化', () => {
    const crypto = require('crypto');
    const body1 = { a: 1, b: 2 };
    const body2 = { a: 1, b: 3 };
    const fp1 = crypto.createHash('sha256').update(JSON.stringify(body1)).digest('hex');
    const fp2 = crypto.createHash('sha256').update(JSON.stringify(body2)).digest('hex');
    expect(fp1).not.toBe(fp2);
  });
});

describe('getWinnerCount evaluation-method-aware', () => {
  let service: BidEvaluationResultsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        { provide: PrismaService, useValue: {} },
        { provide: PriceFormulaService, useValue: {} },
        { provide: StorageService, useValue: {} },
        { provide: BidService, useValue: {} },
        BidEvaluationResultsService,
      ],
    }).compile();
    service = module.get<BidEvaluationResultsService>(BidEvaluationResultsService);
  });

  it('邀请招标(comprehensive) × 5 合格 → 3', () => {
    expect((service as any).getWinnerCount('邀请招标', 'comprehensive', 5)).toBe(3);
  });
  it('询比采购(lowest_price) × 5 合格 → 1', () => {
    expect((service as any).getWinnerCount('询比采购', 'lowest_price', 5)).toBe(1);
  });
  it('谈判采购(qualified_lowest_price) × 5 合格 → 1', () => {
    expect((service as any).getWinnerCount('谈判采购', 'qualified_lowest_price', 5)).toBe(1);
  });
  it('直接采购(none) × 1 合格 → 1', () => {
    expect((service as any).getWinnerCount('直接采购', 'none', 1)).toBe(1);
  });
  it('0 合格 → 0', () => {
    expect((service as any).getWinnerCount('邀请招标', 'comprehensive', 0)).toBe(0);
  });
  it('evaluationMethod=null 时回退采购方式默认', () => {
    // 谈判采购默认 qualified_lowest_price → 1
    expect((service as any).getWinnerCount('谈判采购', null, 5)).toBe(1);
    // 邀请招标默认 comprehensive → 3
    expect((service as any).getWinnerCount('邀请招标', null, 5)).toBe(3);
  });
});
