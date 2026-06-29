// apps/api/src/ai-bid-analysis/services/comparative-scoring.service.spec.ts
// 方案3增强：横向校准对齐全 5 维（动态 scores 契约，QUALIFICATION/RESPONSIVE 也被校准）
import { Test } from '@nestjs/testing';
import { ComparativeScoringService } from './comparative-scoring.service';
import { PrismaService } from '../../prisma/prisma.service';
import { LlmService } from '../../local-ai/llm.service';

describe('ComparativeScoringService — 横向校准（方案3增强：全维度动态校准）', () => {
  let service: ComparativeScoringService;
  let mockPrisma: any;
  let mockLlm: any;

  beforeEach(async () => {
    mockPrisma = {
      aiBidderResult: { findMany: jest.fn(), update: jest.fn() },
    };
    mockLlm = { chatJson: jest.fn() };

    const module = await Test.createTestingModule({
      providers: [
        ComparativeScoringService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: LlmService, useValue: mockLlm },
      ],
    }).compile();

    service = module.get(ComparativeScoringService);
  });

  it('动态 scores 契约：校准写入 categoryTotals.BUSINESS', async () => {
    mockPrisma.aiBidderResult.findMany.mockResolvedValue([
      { id: 'br-1', keyInfo: { quotePrice: 100 }, categoryTotals: { TECHNICAL: { score: 30, max: 50 }, BUSINESS: { score: 15, max: 30 }, PRICE: { score: 18, max: 20 } }, totalScore: 63, bidSupplier: { supplierName: 'A' } },
      { id: 'br-2', keyInfo: { quotePrice: 110 }, categoryTotals: { TECHNICAL: { score: 25, max: 50 }, BUSINESS: { score: 20, max: 30 }, PRICE: { score: 16, max: 20 } }, totalScore: 61, bidSupplier: { supplierName: 'B' } },
    ]);
    mockLlm.chatJson.mockResolvedValue({
      scores: [{ bidderName: 'A', scores: { BUSINESS: 25 } }],
    });

    await service.score('task-1');

    expect(mockPrisma.aiBidderResult.update).toHaveBeenCalled();
    const updateCall = mockPrisma.aiBidderResult.update.mock.calls[0][0];
    expect(updateCall.where.id).toBe('br-1');
    expect(updateCall.data.categoryTotals.BUSINESS.score).toBe(25);
  });

  it('方案3增强：校准全 5 维（QUALIFICATION/RESPONSIVE 不再被跳过）', async () => {
    mockPrisma.aiBidderResult.findMany.mockResolvedValue([
      { id: 'br-1', keyInfo: { quotePrice: 100 }, categoryTotals: { TECHNICAL: { score: 30, max: 50 }, BUSINESS: { score: 15, max: 30 }, PRICE: { score: 18, max: 20 }, QUALIFICATION: { score: 5, max: 10 }, RESPONSIVE: { score: 6, max: 10 } }, totalScore: 74, bidSupplier: { supplierName: 'A' } },
      { id: 'br-2', keyInfo: { quotePrice: 110 }, categoryTotals: { TECHNICAL: { score: 25, max: 50 }, BUSINESS: { score: 20, max: 30 }, PRICE: { score: 16, max: 20 }, QUALIFICATION: { score: 7, max: 10 }, RESPONSIVE: { score: 5, max: 10 } }, totalScore: 73, bidSupplier: { supplierName: 'B' } },
    ]);
    mockLlm.chatJson.mockResolvedValue({
      scores: [
        {
          bidderName: 'A',
          scores: { TECHNICAL: 40, BUSINESS: 25, PRICE: 18, QUALIFICATION: 8, RESPONSIVE: 9 },
          reason: 'A 各维度略优',
        },
      ],
    });

    await service.score('task-1');

    const updateCall = mockPrisma.aiBidderResult.update.mock.calls[0][0];
    expect(updateCall.where.id).toBe('br-1');
    const totals = updateCall.data.categoryTotals;
    expect(totals.TECHNICAL.score).toBe(40);
    expect(totals.BUSINESS.score).toBe(25);
    expect(totals.PRICE.score).toBe(18);
    expect(totals.QUALIFICATION.score).toBe(8); // 方案3增强：资格维被校准
    expect(totals.RESPONSIVE.score).toBe(9); // 方案3增强：响应维被校准
    // 总分 = 40+25+18+8+9 = 100
    expect(updateCall.data.totalScore).toBe(100);
  });

  it('校准分 clamp 到维度 maxScore（不超过上限）', async () => {
    mockPrisma.aiBidderResult.findMany.mockResolvedValue([
      { id: 'br-1', keyInfo: {}, categoryTotals: { TECHNICAL: { score: 30, max: 50 } }, totalScore: 30, bidSupplier: { supplierName: 'A' } },
      { id: 'br-2', keyInfo: {}, categoryTotals: { TECHNICAL: { score: 25, max: 50 } }, totalScore: 25, bidSupplier: { supplierName: 'B' } },
    ]);
    mockLlm.chatJson.mockResolvedValue({
      scores: [{ bidderName: 'A', scores: { TECHNICAL: 99 } }], // 超 max=50
    });

    await service.score('task-1');

    const updateCall = mockPrisma.aiBidderResult.update.mock.calls[0][0];
    expect(updateCall.data.categoryTotals.TECHNICAL.score).toBe(50); // clamp 到 max
  });

  it('未知维度 key 被忽略（不污染 categoryTotals）', async () => {
    mockPrisma.aiBidderResult.findMany.mockResolvedValue([
      { id: 'br-1', keyInfo: {}, categoryTotals: { TECHNICAL: { score: 30, max: 50 } }, totalScore: 30, bidSupplier: { supplierName: 'A' } },
      { id: 'br-2', keyInfo: {}, categoryTotals: { TECHNICAL: { score: 25, max: 50 } }, totalScore: 25, bidSupplier: { supplierName: 'B' } },
    ]);
    mockLlm.chatJson.mockResolvedValue({
      scores: [{ bidderName: 'A', scores: { TECHNICAL: 40, UNKNOWN_DIM: 100 } }],
    });

    await service.score('task-1');

    const updateCall = mockPrisma.aiBidderResult.update.mock.calls[0][0];
    expect(updateCall.data.categoryTotals.TECHNICAL.score).toBe(40);
    expect(updateCall.data.categoryTotals.UNKNOWN_DIM).toBeUndefined(); // 未知维度不写入
  });
});
