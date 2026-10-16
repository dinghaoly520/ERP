import { SupplierService } from './supplier.service';

/** 注册终审通过 upsert APPROVED link（多公司归属 2026-10-16）——三级闭环与库归属同事务一致。 */
describe('SupplierService.approve — 终审 upsert company link', () => {
  // 构造实参以实际 SupplierService 构造函数为准（prisma + notification，其余 null）：
  // approve 终审路径还会经 audit→prisma.auditLog.create、recordApproval→
  // buildApprovalSnapshot/prisma.supplierApprovalRecord.create（快照取数需空集合兜底）。
  const buildPrisma = (supplier: any) => ({
    supplier: { findUnique: jest.fn().mockResolvedValue(supplier) },
    user: { findUnique: jest.fn().mockResolvedValue({ id: 'rev-1', role: 'admin', companyId: null }), update: jest.fn() },
    auditLog: { create: jest.fn().mockResolvedValue({}) },
    supplierApprovalRecord: { create: jest.fn().mockResolvedValue({}) },
    $transaction: jest.fn(),
  });
  const notification: any = {
    resolveActionable: jest.fn().mockResolvedValue({}),
    create: jest.fn().mockResolvedValue({}),
  };
  const newService = (prisma: any) =>
    new (SupplierService as any)(prisma, notification, null, null, null, null) as SupplierService;

  it('ADMIN 终审通过 → 事务内 upsert APPROVED link（companyId 非空）', async () => {
    const prisma: any = buildPrisma({
      id: 's1', userId: 'u1', companyId: 'co-1', status: 'PENDING', reviewStage: 'ADMIN', name: '甲公司',
      createdAt: new Date('2026-10-16T08:00:00Z'), user: {},
      contacts: [], qualifications: [], bankAccounts: [], performances: [],
    });
    const svc = newService(prisma);
    let linkUpsert: jest.Mock;
    prisma.$transaction.mockImplementation(async (fn: any) => {
      linkUpsert = jest.fn().mockResolvedValue({ id: 'l1' });
      return fn({
        supplier: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
        user: { update: jest.fn() },
        supplierCompanyLink: { upsert: linkUpsert },
      });
    });
    await svc.approve('s1', 'rev-1', '同意');
    expect(linkUpsert!).toHaveBeenCalledWith(expect.objectContaining({
      where: { supplierId_companyId: { supplierId: 's1', companyId: 'co-1' } },
      create: expect.objectContaining({ status: 'APPROVED' }),
    }));
  });

  it('companyId 为空（未归属）→ 跳过 link upsert', async () => {
    const prisma: any = buildPrisma({
      id: 's2', userId: 'u2', companyId: null, status: 'PENDING', reviewStage: 'ADMIN', name: '乙',
      createdAt: new Date('2026-10-16T08:00:00Z'), user: {},
      contacts: [], qualifications: [], bankAccounts: [], performances: [],
    });
    const svc = newService(prisma);
    prisma.$transaction.mockImplementation(async (fn: any) => {
      const linkUpsert = jest.fn();
      await fn({ supplier: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) }, user: { update: jest.fn() }, supplierCompanyLink: { upsert: linkUpsert } });
      expect(linkUpsert).not.toHaveBeenCalled();
    });
    await svc.approve('s2', 'rev-1');
  });
});
