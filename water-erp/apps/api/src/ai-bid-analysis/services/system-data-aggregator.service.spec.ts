// apps/api/src/ai-bid-analysis/services/system-data-aggregator.service.spec.ts
// 报价单位口径（2026-09-14 万元事故的读端防线）：双信封新轨（dual-v2/v3）裸数字=万元，
// 需带「万元」后缀防 ConcordanceVerifier ÷10000 误判；旧轨原值直出（元）。
import { Test, TestingModule } from '@nestjs/testing';
import { SystemDataAggregatorService } from './system-data-aggregator.service';
import { PrismaService } from '../../prisma/prisma.service';

jest.mock('../../common/crypto/field-crypto', () => ({
  openField: jest.fn(() => '148.65'),
}));

describe('SystemDataAggregatorService — 报价单位口径', () => {
  let service: SystemDataAggregatorService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      bidSupplier: { findUnique: jest.fn() },
      bidOpeningRecord: { findFirst: jest.fn() },
      supplierBidSubmission: { findUnique: jest.fn() },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SystemDataAggregatorService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get(SystemDataAggregatorService);
    jest.clearAllMocks();
  });

  const setup = (envelopeVersion: string | null) => {
    prisma.bidSupplier.findUnique.mockResolvedValue({
      supplierId: 'supplier-1',
      projectId: 'project-1',
      supplier: null,
    });
    prisma.bidOpeningRecord.findFirst.mockResolvedValue({ amount: '148.65', period: '90日历天' });
    prisma.supplierBidSubmission.findUnique.mockResolvedValue({
      envelopeVersion,
      bidPrice: 'sealed-blob',
      deliveryPeriod: '90日历天',
    });
  };

  it.each(['dual-v2', 'dual-v3'])('%s：唱标/表单报价带「万元」后缀（裸数字=万元口径）', async (v) => {
    setup(v);

    const out = await service.aggregate('bs-1');

    expect(out.openingAmount).toBe('148.65万元');
    expect(out.submissionPrice).toBe('148.65万元');
  });

  it('旧轨（envelopeVersion=null）：原值直出（元口径）', async () => {
    setup(null);

    const out = await service.aggregate('bs-1');

    expect(out.openingAmount).toBe('148.65');
    expect(out.submissionPrice).toBe('148.65');
  });
});
