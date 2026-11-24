import { NotFoundException } from '@nestjs/common';
import { SupplierService } from './supplier.service';

/** 直构 service（同 supplier-review-status-gate.spec 口径）：getCorrectionDiff 只依赖 prisma */
const mkSvc = (supplierRow: Record<string, unknown> | null) => {
  const prisma = {
    supplier: { findUnique: jest.fn().mockResolvedValue(supplierRow) },
    supplierApprovalRecord: { findFirst: jest.fn().mockResolvedValue(null) },
  };
  const svc = new (SupplierService as any)(prisma, {}, null, null, null, null);
  return { prisma, svc };
};

const SUP = () => ({
  id: 'sup-1', name: '成都测试商贸有限公司', creditCode: '91510100MA00000000', supplierNo: 'SUP-000001',
  enterpriseType: '有限责任公司', legalPerson: '张三', legalPersonIdCard: null, legalPersonPhone: null,
  registeredAddress: '成都市XX路1号', detailedAddress: null, businessScope: '销售建材',
  logoUrl: null, organizationCode: null, country: '中国', region: '四川', registeredCapital: '100万元',
  industry: '零售业', companyEmail: null, companyWebsite: null, companyProfile: null,
  tags: ['建材物资销售'], isTemporary: false, establishedDate: new Date('2016-05-30T00:00:00.000Z'),
  companyId: 'co-1', companyName: '四川水发兴川置业管理有限公司', status: 'PENDING',
  user: { username: 'u1', displayName: '测试', email: null },
  contacts: [], qualifications: [], bankAccounts: [], performances: [],
});

describe('getCorrectionDiff + 快照补字段（2026-11-24 spec）', () => {
  it('buildApprovalSnapshot 补 companyId/companyName/establishedDate/companyProfile', async () => {
    const { svc } = mkSvc(SUP());
    const snap = await (svc as any).buildApprovalSnapshot('sup-1');
    expect(snap.companyId).toBe('co-1');
    expect(snap.companyName).toBe('四川水发兴川置业管理有限公司');
    expect(snap.establishedDate).toBe('2016-05-30');
    expect(snap.companyProfile).toBeNull();
  });

  it('无 RETURNED 留痕 → hasRound=false', async () => {
    const { prisma, svc } = mkSvc(SUP());
    const r = await svc.getCorrectionDiff('sup-1');
    expect(r).toEqual({ hasRound: false });
    expect(prisma.supplierApprovalRecord.findFirst).toHaveBeenCalled();
  });

  it('RETURNED 未重提 → hasRound=true、sections=[]、退回原因取留痕记录', async () => {
    const { prisma, svc } = mkSvc({ ...SUP(), status: 'RETURNED', returnReason: null });
    const live = await (svc as any).buildApprovalSnapshot('sup-1');
    prisma.supplierApprovalRecord.findFirst.mockResolvedValue({
      createdAt: new Date('2026-11-20T08:00:00.000Z'), reason: '资质材料不清晰', snapshot: live,
    });
    const r = await svc.getCorrectionDiff('sup-1');
    expect(r.hasRound).toBe(true);
    expect(r.sections).toEqual([]);
    expect(r.returnReason).toBe('资质材料不清晰'); // Supplier.returnReason=null（被缺陷清空）不影响
    expect(r.returnedAt).toBe('2026-11-20T08:00:00.000Z');
  });

  it('重提后 PENDING → 清单非空（字段 旧→新）', async () => {
    const { prisma, svc } = mkSvc({ ...SUP(), registeredCapital: '500万元' });
    const live = await (svc as any).buildApprovalSnapshot('sup-1');
    prisma.supplierApprovalRecord.findFirst.mockResolvedValue({
      createdAt: new Date('2026-11-20T08:00:00.000Z'), reason: '请修正注册资金',
      snapshot: { ...live, registeredCapital: '100万元' },
    });
    const r = await svc.getCorrectionDiff('sup-1');
    expect(r.hasRound).toBe(true);
    expect(r.sections[0].items).toContainEqual(
      { kind: 'modified', rowLabel: '注册资金（万元）', oldValue: '100万元', newValue: '500万元' });
  });

  it('终局态（APPROVED/REJECTED/DISABLED/BLACKLIST）→ hasRound=false', async () => {
    for (const status of ['APPROVED', 'REJECTED', 'DISABLED', 'BLACKLIST']) {
      const { svc } = mkSvc({ ...SUP(), status });
      expect(await svc.getCorrectionDiff('sup-1')).toEqual({ hasRound: false });
    }
  });

  it('供应商不存在 → NotFoundException', async () => {
    const { svc } = mkSvc(null);
    await expect(svc.getCorrectionDiff('nope')).rejects.toThrow(NotFoundException);
  });
});
