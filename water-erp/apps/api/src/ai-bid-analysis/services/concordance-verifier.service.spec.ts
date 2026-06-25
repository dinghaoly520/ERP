import { ConcordanceVerifierService } from './concordance-verifier.service';
import type { SystemData, BidderKeyInfo } from '../types';

describe('ConcordanceVerifierService', () => {
  let service: ConcordanceVerifierService;

  beforeEach(() => {
    service = new ConcordanceVerifierService();
  });

  // 构造最小 BidderKeyInfo（verify 只读部分字段）
  const mockKeyInfo = (over: Partial<BidderKeyInfo>): BidderKeyInfo =>
    ({
      bidderName: '测试供应商',
      legalPerson: '张明',
      registeredCapital: '5000万元',
      establishedDate: '2000-01-01',
      quotePrice: 2350,
      quotePriceYuan: '2350万元',
      priceValidity: 90,
      qualificationLevel: '甲级',
      qualificationName: '水利水电施工总承包甲级',
      qualificationStatus: '通过',
      performanceCount: 5,
      keyPerformances: [],
      projectManager: '李强',
      projectManagerTitle: '一级建造师',
      constructionPeriod: '540日历天',
      warrantyPeriod: '24个月',
      contactInfo: { phone: '028-88888001', email: 'a@b.com', address: '成都' },
      missingItems: [],
      ...over,
    }) as BidderKeyInfo;

  const mockSystem = (over: Partial<SystemData>): SystemData => ({
    openingAmount: '2350万元',
    openingPeriod: '540日历天',
    legalPerson: '张明',
    creditCode: '91510000MA0001XX01',
    qualifications: [{ name: '水利水电工程施工总承包甲级' }],
    contacts: [{ phone: '028-88888001', email: 'a@b.com' }],
    ...over,
  });

  // ── normalizePrice（通过 verify 间接覆盖）──

  it('报价一致（万元）：2350万元 vs 2350', () => {
    const result = service.verify(mockSystem({}), mockKeyInfo({}));
    const price = result.checks.find((c) => c.field === 'price')!;
    expect(price.status).toBe('consistent');
  });

  it('报价归一化（亿→万元）：2.35亿 vs 23500', () => {
    const result = service.verify(
      mockSystem({ openingAmount: '2.35亿' }),
      mockKeyInfo({ quotePriceYuan: '23500万元', quotePrice: 23500 }),
    );
    const price = result.checks.find((c) => c.field === 'price')!;
    expect(price.status).toBe('consistent');
  });

  it('报价归一化（元→万元）：23500000元 vs 2350', () => {
    const result = service.verify(
      mockSystem({ openingAmount: '23500000元' }),
      mockKeyInfo({ quotePrice: 2350 }),
    );
    const price = result.checks.find((c) => c.field === 'price')!;
    expect(price.status).toBe('consistent');
  });

  it('报价冲突：2350万 vs 2000', () => {
    const result = service.verify(
      mockSystem({ openingAmount: '2350万元' }),
      mockKeyInfo({ quotePriceYuan: '2000万元', quotePrice: 2000 }),
    );
    const price = result.checks.find((c) => c.field === 'price')!;
    expect(price.status).toBe('conflict');
    expect(price.severity).toBe('high');
  });

  it('报价数据不足：openingAmount=null', () => {
    const result = service.verify(
      mockSystem({ openingAmount: null, submissionPrice: null }),
      mockKeyInfo({ quotePrice: 2350 }),
    );
    const price = result.checks.find((c) => c.field === 'price')!;
    expect(price.status).toBe('insufficient_data');
  });

  // ── parsePeriodDays ──

  it('工期一致（日历天）：540日历天 vs 540天', () => {
    const result = service.verify(mockSystem({}), mockKeyInfo({ constructionPeriod: '540天' }));
    const period = result.checks.find((c) => c.field === 'period')!;
    expect(period.status).toBe('consistent');
  });

  it('工期归一化（月→天）：18个月 vs 540天', () => {
    const result = service.verify(
      mockSystem({ openingPeriod: '18个月' }),
      mockKeyInfo({ constructionPeriod: '540天' }),
    );
    const period = result.checks.find((c) => c.field === 'period')!;
    expect(period.status).toBe('consistent');
  });

  it('工期归一化（年→天）：1年 vs 365天', () => {
    const result = service.verify(
      mockSystem({ openingPeriod: '1年' }),
      mockKeyInfo({ constructionPeriod: '365天' }),
    );
    const period = result.checks.find((c) => c.field === 'period')!;
    expect(period.status).toBe('consistent');
  });

  it('工期冲突：540天 vs 600天', () => {
    const result = service.verify(mockSystem({}), mockKeyInfo({ constructionPeriod: '600天' }));
    const period = result.checks.find((c) => c.field === 'period')!;
    expect(period.status).toBe('conflict');
  });

  // ── extractQualificationLevels ──

  it('资质一致（甲级）', () => {
    const result = service.verify(mockSystem({}), mockKeyInfo({ qualificationLevel: '甲级' }));
    const qual = result.checks.find((c) => c.field === 'qualification')!;
    expect(qual.status).toBe('consistent');
  });

  it('资质冲突（标书甲级 vs 系统乙级）', () => {
    const result = service.verify(
      mockSystem({ qualifications: [{ name: '水利水电施工总承包乙级' }] }),
      mockKeyInfo({ qualificationLevel: '甲级' }),
    );
    const qual = result.checks.find((c) => c.field === 'qualification')!;
    expect(qual.status).toBe('conflict');
  });

  it('资质等级正则解析（一级）', () => {
    const result = service.verify(
      mockSystem({ qualifications: [{ name: '建筑工程施工总承包一级' }] }),
      mockKeyInfo({ qualificationLevel: '一级' }),
    );
    const qual = result.checks.find((c) => c.field === 'qualification')!;
    expect(qual.status).toBe('consistent');
  });

  // ── checkLegalPerson ──

  it('法人一致', () => {
    const result = service.verify(mockSystem({ legalPerson: '张明' }), mockKeyInfo({ legalPerson: '张明' }));
    const lp = result.checks.find((c) => c.field === 'legalPerson')!;
    expect(lp.status).toBe('consistent');
  });

  it('法人冲突', () => {
    const result = service.verify(mockSystem({ legalPerson: '张明' }), mockKeyInfo({ legalPerson: '李四' }));
    const lp = result.checks.find((c) => c.field === 'legalPerson')!;
    expect(lp.status).toBe('conflict');
  });

  // ── checkContact ──

  it('联系方式一致（电话匹配）', () => {
    const result = service.verify(
      mockSystem({ contacts: [{ phone: '028-88888001', email: null }] }),
      mockKeyInfo({ contactInfo: { phone: '028-88888001', email: '', address: '' } }),
    );
    const contact = result.checks.find((c) => c.field === 'contact')!;
    expect(contact.status).toBe('consistent');
  });

  it('联系方式不一致（电话不匹配）', () => {
    const result = service.verify(
      mockSystem({ contacts: [{ phone: '028-11111111', email: null }] }),
      mockKeyInfo({ contactInfo: { phone: '028-99999999', email: '', address: '' } }),
    );
    const contact = result.checks.find((c) => c.field === 'contact')!;
    expect(contact.status).toBe('minor_diff');
  });

  // ── summarize ──

  it('summarize：全一致 → consistent', () => {
    const result = service.verify(mockSystem({}), mockKeyInfo({}));
    expect(result.overallStatus).toBe('consistent');
    expect(result.conflictCount).toBe(0);
    expect(result.warningCount).toBe(0);
  });

  it('summarize：有冲突 → conflict', () => {
    const result = service.verify(
      mockSystem({ openingAmount: '2350万元', legalPerson: '张明' }),
      mockKeyInfo({ quotePriceYuan: '2000万元', quotePrice: 2000, legalPerson: '李四' }),
    );
    expect(result.overallStatus).toBe('conflict');
    expect(result.conflictCount).toBeGreaterThanOrEqual(2);
  });
});
