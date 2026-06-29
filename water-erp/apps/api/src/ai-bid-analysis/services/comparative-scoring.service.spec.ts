// apps/api/src/ai-bid-analysis/services/comparative-scoring.service.spec.ts
// 修复 BUSINESS/COMMERCIAL 命名 bug：横向校准应写入 categoryTotals.BUSINESS
import { Test } from '@nestjs/testing';
import { ComparativeScoringService } from './comparative-scoring.service';
import { PrismaService } from '../../prisma/prisma.service';
import { LlmService } from '../../local-ai/llm.service';

describe('ComparativeScoringService — categoryTotals key（BUSINESS 非 COMMERCIAL）', () => {
  let service: ComparativeScoringService;
  let mockPrisma: any;
  let mockLlm: any;

  beforeEach(async () => {
    mockPrisma = {
      aiBidderResult: {
        findMany: jest.fn(),
        update: jest.fn(),
      },
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

  it('横向校准写入 categoryTotals.BUSINESS（商务维被校准，而非跳过）', async () => {
    mockPrisma.aiBidderResult.findMany.mockResolvedValue([
      {
        id: 'br-1',
        keyInfo: { quotePrice: 100 },
        categoryTotals: {
          TECHNICAL: { score: 30, max: 50 },
          BUSINESS: { score: 15, max: 30 },
          PRICE: { score: 18, max: 20 },
        },
        totalScore: 63,
        bidSupplier: { supplierName: 'A' },
      },
      {
        id: 'br-2',
        keyInfo: { quotePrice: 110 },
        categoryTotals: {
          TECHNICAL: { score: 25, max: 50 },
          BUSINESS: { score: 20, max: 30 },
          PRICE: { score: 16, max: 20 },
        },
        totalScore: 61,
        bidSupplier: { supplierName: 'B' },
      },
    ]);
    mockLlm.chatJson.mockResolvedValue({
      scores: [{ bidderName: 'A', commercial: 25 }], // 校准商务维
    });

    await service.score('task-1');

    expect(mockPrisma.aiBidderResult.update).toHaveBeenCalled();
    const updateCall = mockPrisma.aiBidderResult.update.mock.calls[0][0];
    expect(updateCall.where.id).toBe('br-1');
    // clamp(25, 0, BUSINESS.max=30) = 25；bug 下因 totals.COMMERCIAL undefined 跳过，保持 15
    expect(updateCall.data.categoryTotals.BUSINESS.score).toBe(25);
  });
});
