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
