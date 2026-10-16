import { supplierCompanyWhere } from './supplier-company-filter';

describe('supplierCompanyWhere（供应商域公司过滤换形，2026-10-16）', () => {
  it('all → 不限', () => {
    expect(supplierCompanyWhere({ all: true })).toEqual({});
  });
  it('限定集 → APPROVED link 存在性', () => {
    expect(supplierCompanyWhere({ all: false, companyIds: ['co-1', 'co-2'] })).toEqual({
      companyLinks: { some: { companyId: { in: ['co-1', 'co-2'] }, status: 'APPROVED' } },
    });
  });
  it('NO_COMPANY 哨兵 → 恒空集（link 不可能有该 id，IN 天然空）', () => {
    const w = supplierCompanyWhere({ all: false, companyIds: ['__no_company__'] }) as any;
    expect(w.companyLinks.some.companyId).toEqual({ in: ['__no_company__'] });
  });
});
