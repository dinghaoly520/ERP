// apps/api/src/ai-bid-analysis/queues/bidder.processor.spec.ts
// recalculatePrices priceConflict 保护：一致性冲突置 0 的 PRICE 不应被公式重算
import { Test } from '@nestjs/testing';
import { BidderProcessor } from './bidder.processor';
import { PrismaService } from '../../prisma/prisma.service';
import { OcrService } from '../../local-ai/ocr.service';
import { BidderExtractorService } from '../services/bidder-extractor.service';
import { PlaintextFetcherService } from '../services/plaintext-fetcher.service';
import { SystemDataAggregatorService } from '../services/system-data-aggregator.service';
import { ConcordanceVerifierService } from '../services/concordance-verifier.service';
import { GenericItemScorerService } from '../services/generic-item-scorer.service';
import { FraudDetectorService } from '../services/fraud-detector.service';
import { ComparativeScoringService } from '../services/comparative-scoring.service';
import { CompetitiveAnalysisService } from '../services/competitive-analysis.service';
import { ReportGeneratorService } from '../services/report-generator.service';
import { DocxGeneratorService } from '../services/docx-generator.service';
import { RequirementMatcherService } from '../services/requirement-matcher.service';

describe('BidderProcessor — recalculatePrices priceConflict 保护', () => {
  let service: BidderProcessor;
  let mockPrisma: any;

  beforeEach(async () => {
    mockPrisma = { aiBidderResult: { findMany: jest.fn(), update: jest.fn() } };
    const module = await Test.createTestingModule({
      providers: [
        BidderProcessor,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: OcrService, useValue: {} },
        { provide: BidderExtractorService, useValue: {} },
        { provide: PlaintextFetcherService, useValue: {} },
        { provide: SystemDataAggregatorService, useValue: {} },
        { provide: ConcordanceVerifierService, useValue: {} },
        { provide: GenericItemScorerService, useValue: {} },
        { provide: FraudDetectorService, useValue: {} },
        { provide: ComparativeScoringService, useValue: {} },
        { provide: CompetitiveAnalysisService, useValue: {} },
        { provide: ReportGeneratorService, useValue: {} },
        { provide: DocxGeneratorService, useValue: {} },
        { provide: RequirementMatcherService, useValue: { match: jest.fn() } },
      ],
    }).compile();
    service = module.get(BidderProcessor);
  });

  it('priceConflict 的 PRICE（reason 含"报价一致性冲突"）保持 0 分，不被公式重算', async () => {
    // collectAllPrices（首次 findMany）→ benchmark=105；bidders（第二次 findMany）
    mockPrisma.aiBidderResult.findMany
      .mockResolvedValueOnce([{ keyInfo: { quotePrice: 100 } }, { keyInfo: { quotePrice: 110 } }])
      .mockResolvedValueOnce([
        {
          id: 'br-1',
          keyInfo: { quotePrice: 100 },
          scoreItems: [{ category: 'PRICE', score: 0, maxScore: 30, reason: '报价一致性冲突，该项 0 分' }],
          categoryTotals: { PRICE: { score: 0, max: 30 } },
        },
      ]);
    mockPrisma.aiBidderResult.update.mockResolvedValue({});

    await (service as any).recalculatePrices('task-1');

    // priceConflict bidder 已由 bidder.processor 方案7.3 设好（PRICE=0），
    // recalculatePrices 应跳过它（updated=false → 不 update），保持 0 分不被公式覆盖
    expect(mockPrisma.aiBidderResult.update).not.toHaveBeenCalled();
  });

  it('正常 PRICE（无冲突标记）按公式重算', async () => {
    mockPrisma.aiBidderResult.findMany
      .mockResolvedValueOnce([{ keyInfo: { quotePrice: 100 } }, { keyInfo: { quotePrice: 100 } }]) // benchmark=100
      .mockResolvedValueOnce([
        {
          id: 'br-1',
          keyInfo: { quotePrice: 100 },
          scoreItems: [{ category: 'PRICE', score: 0, maxScore: 30, reason: '报价数据不足，无法公式计算' }],
          categoryTotals: { PRICE: { score: 0, max: 30 } },
        },
      ]);
    mockPrisma.aiBidderResult.update.mockResolvedValue({});

    await (service as any).recalculatePrices('task-1');

    const updateCall = mockPrisma.aiBidderResult.update.mock.calls[0][0];
    const priceItem = updateCall.data.scoreItems.find((i: any) => i.category === 'PRICE');
    expect(priceItem.score).toBe(30); // 偏离 0% → 满分（重算）
  });
});

// Task 7：matcher 步产出 requirementResponses 并写入 bidderResult
describe('BidderProcessor — matcher 集成 requirementResponses', () => {
  let processor: BidderProcessor;
  let prisma: any;
  let requirementMatcher: any;
  let plaintextFetcher: any;
  let ocrService: any;
  let bidderExtractor: any;
  let systemDataAggregator: any;
  let concordanceVerifier: any;
  let genericItemScorer: any;
  let competitiveAnalysis: any;

  beforeEach(async () => {
    prisma = {
      aiBidderResult: {
        findUnique: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]), // checkTaskCompletion 无 pending
        update: jest.fn().mockResolvedValue({}),
        // F7 认领守卫：默认认领成功（PENDING → OCR_PROCESSING）
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      aiConcordanceResult: { upsert: jest.fn().mockResolvedValue({}) },
      bidScoreItem: { findMany: jest.fn().mockResolvedValue([]) },
      aiBidAnalysisTask: { update: jest.fn().mockResolvedValue({}) },
      aiBidReport: { upsert: jest.fn().mockResolvedValue({}) },
      fileAsset: { create: jest.fn() },
    };
    plaintextFetcher = {
      fetchBidderPlaintext: jest.fn().mockImplementation((_id, kind) =>
        Promise.resolve({
          buffer: Buffer.from(''),
          fileId: kind === 'technical' ? 'fa-tech' : 'fa-biz',
        }),
      ),
    };
    ocrService = {
      // file-processor util calls ocrService.ocrPdf(buffer, maxPages, dpi)
      ocrPdf: jest.fn().mockResolvedValue({ text: 'OCR 内容', pages: [{ page: 1, text: 'OCR 内容' }] }),
    };
    bidderExtractor = {
      extract: jest.fn().mockResolvedValue({ keyInfo: {}, extractedInfo: {} }),
    };
    systemDataAggregator = { aggregate: jest.fn().mockResolvedValue({}) };
    concordanceVerifier = {
      verify: jest.fn().mockReturnValue({
        overallStatus: 'pass',
        conflictCount: 0,
        warningCount: 0,
        checks: [],
      }),
    };
    genericItemScorer = {
      score: jest.fn().mockResolvedValue({
        scoreItems: [],
        categoryTotals: {},
        starredResponse: {},
        totalScore: 0,
        overallComment: 'ok',
      }),
    };
    competitiveAnalysis = {
      analyze: jest.fn().mockResolvedValue({
        strengths: [], weaknesses: [], keyObservations: [], overallComment: '',
      }),
    };
    requirementMatcher = { match: jest.fn() };

    const module = await Test.createTestingModule({
      providers: [
        BidderProcessor,
        { provide: PrismaService, useValue: prisma },
        { provide: OcrService, useValue: ocrService },
        { provide: BidderExtractorService, useValue: bidderExtractor },
        { provide: PlaintextFetcherService, useValue: plaintextFetcher },
        { provide: SystemDataAggregatorService, useValue: systemDataAggregator },
        { provide: ConcordanceVerifierService, useValue: concordanceVerifier },
        { provide: GenericItemScorerService, useValue: genericItemScorer },
        { provide: FraudDetectorService, useValue: {} },
        { provide: ComparativeScoringService, useValue: {} },
        { provide: CompetitiveAnalysisService, useValue: competitiveAnalysis },
        { provide: ReportGeneratorService, useValue: {} },
        { provide: DocxGeneratorService, useValue: {} },
        { provide: RequirementMatcherService, useValue: requirementMatcher },
      ],
    }).compile();
    processor = module.get(BidderProcessor);
  });

  it('matcher 步产出 requirementResponses 并写入 bidderResult', async () => {
    prisma.aiBidderResult.findUnique.mockResolvedValueOnce({
      id: 'br-1',
      bidSupplierId: 'bs-1',
      bidSupplier: { id: 'bs-1', supplierName: '测试供应商' },
      task: { id: 't-1', projectId: 'p-1', requirements: { items: [] } },
    });
    requirementMatcher.match.mockResolvedValue([
      {
        requirementId: 'r1',
        category: 'technical',
        tenderContent: '工期',
        isStarred: true,
        status: 'met',
        excerpt: '360天',
        location: { fileId: 'fa-tech', page: 1 },
        confidence: 0.9,
      },
    ]);

    await processor.process({ data: { bidderResultId: 'br-1', taskId: 't-1' } } as any);

    expect(prisma.aiBidderResult.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'br-1' },
        data: expect.objectContaining({ requirementResponses: expect.any(Array) }),
      }),
    );
    expect(prisma.aiBidderResult.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          requirementResponses: expect.arrayContaining([
            expect.objectContaining({ requirementId: 'r1' }),
          ]),
        }),
      }),
    );
  });

  /* ── F7（2026-08-28）认领守卫：非 PENDING 行直接跳过，不进入 OCR/评分流程 ── */
  it('认领 0 行（行已被其它 job 认领或已终态）→ skipped 早退，不触发 OCR 且不误判任务终态', async () => {
    prisma.aiBidderResult.findUnique.mockResolvedValueOnce({
      id: 'br-1',
      bidSupplierId: 'bs-1',
      bidSupplier: { supplierName: '测试供应商' },
      task: { id: 't-1', projectId: 'p-1', requirements: null },
    });
    prisma.aiBidderResult.updateMany.mockResolvedValueOnce({ count: 0 });

    const res = await processor.process({ data: { bidderResultId: 'br-1', taskId: 't-1' } } as any);

    expect(res).toEqual({ skipped: true, bidderResultId: 'br-1' });
    expect(prisma.aiBidderResult.updateMany).toHaveBeenCalledWith({
      where: { id: 'br-1', status: 'PENDING' },
      data: { status: 'OCR_PROCESSING' },
    });
    expect(plaintextFetcher.fetchBidderPlaintext).not.toHaveBeenCalled();
    expect(prisma.aiBidAnalysisTask.update).not.toHaveBeenCalled(); // 不跑 checkTaskCompletion
  });
});
