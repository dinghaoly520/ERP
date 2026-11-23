import { SupplierService } from './supplier.service';

/** 补正中禁审（2026-11-23 用户裁定，spec §3.1）：RETURNED 状态不可 approve/reject，
 *  须等供应商补正重提回 PENDING；乐观锁谓词同步收紧（防校验后瞬间重提的竞态误审）。 */

const mkNotification = () => ({
  create: jest.fn().mockResolvedValue({}),
  resolveActionable: jest.fn().mockResolvedValue({}),
});

const mkPrisma = (over: Record<string, jest.Mock> = {}) => ({
  supplier: {
    findUnique: jest.fn(),
    updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    update: jest.fn().mockResolvedValue({}),
  },
  user: {
    findUnique: jest.fn(),
    findMany: jest.fn().mockResolvedValue([]),
    update: jest.fn().mockResolvedValue({}),
  },
  supplierContact: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
  supplierQualification: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
  supplierBankAccount: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
  supplierPerformance: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
  supplierClassificationLink: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
  supplierApprovalRecord: { findMany: jest.fn().mockResolvedValue([]), create: jest.fn().mockResolvedValue({}), update: jest.fn().mockResolvedValue({}) },
  fileAsset: { findMany: jest.fn().mockResolvedValue([]), deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
  auditLog: { create: jest.fn().mockResolvedValue({}) },
  notification: { create: jest.fn().mockResolvedValue({}) },
  $transaction: jest.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn({
    supplier: { update: jest.fn().mockResolvedValue({}) },
    supplierContact: { deleteMany: jest.fn() },
    supplierQualification: { deleteMany: jest.fn() },
    supplierBankAccount: { deleteMany: jest.fn() },
    supplierPerformance: { deleteMany: jest.fn() },
    supplierClassificationLink: { deleteMany: jest.fn() },
    user: { update: jest.fn() },
    supplierApprovalRecord: { findMany: jest.fn().mockResolvedValue([]), update: jest.fn() },
    supplierCompanyLink: { upsert: jest.fn() },
  })),
  ...over,
});

const mkSvc = (prisma: ReturnType<typeof mkPrisma>, notification = mkNotification()) =>
  new (SupplierService as any)(prisma, notification, null, null, null, null) as SupplierService;

const SUPPLIER_RETURNED = {
  id: 'sup-1', userId: 'u1', companyId: 'co1', name: '测试供应商',
  status: 'RETURNED', reviewStage: 'STAFF', user: { id: 'u1' },
  // recordApproval → buildApprovalSnapshot 逐段 map 子表
  contacts: [], qualifications: [], bankAccounts: [], performances: [],
};
const REVIEWER_STAFF = { id: 'rev-1', role: 'staff', companyId: 'co1' };

describe('补正中（RETURNED）禁审闸', () => {
  it('approve on RETURNED → 400 AWAITING_RESUBMISSION，零写库', async () => {
    const prisma = mkPrisma();
    prisma.supplier.findUnique.mockResolvedValue(SUPPLIER_RETURNED);
    const svc = mkSvc(prisma);
    await expect(svc.approve('sup-1', 'rev-1', '理由')).rejects.toMatchObject({
      response: { code: 'AWAITING_RESUBMISSION', error: expect.stringContaining('重新提交') },
    });
    expect(prisma.supplier.updateMany).not.toHaveBeenCalled();
  });

  it('reject on RETURNED → 400 AWAITING_RESUBMISSION（断言按级先过、状态闸后置仍拦）', async () => {
    const prisma = mkPrisma();
    prisma.supplier.findUnique.mockResolvedValue(SUPPLIER_RETURNED);
    prisma.user.findUnique.mockResolvedValue(REVIEWER_STAFF); // reject 的按级断言在状态闸之前
    const svc = mkSvc(prisma);
    await expect(svc.reject('sup-1', '理由', 'rev-1')).rejects.toMatchObject({
      response: { code: 'AWAITING_RESUBMISSION' },
    });
    expect(prisma.supplier.updateMany).not.toHaveBeenCalled();
  });

  it('approve on PENDING/STAFF → 乐观锁 where.status 单值 PENDING 且推进 LEADER', async () => {
    const prisma = mkPrisma();
    prisma.supplier.findUnique.mockResolvedValue({ ...SUPPLIER_RETURNED, status: 'PENDING' });
    prisma.user.findUnique.mockResolvedValue(REVIEWER_STAFF);
    const svc = mkSvc(prisma);
    const r = await svc.approve('sup-1', 'rev-1', '同意');
    expect(r).toEqual({ success: true, stage: 'LEADER' });
    const where = prisma.supplier.updateMany.mock.calls[0][0].where;
    expect(where).toMatchObject({ id: 'sup-1', status: 'PENDING', reviewStage: 'STAFF' });
    expect(JSON.stringify(where)).not.toContain('RETURNED');
  });

  it('reject on PENDING → 乐观锁 where.status 单值 PENDING 且置 REJECTED', async () => {
    const prisma = mkPrisma();
    prisma.supplier.findUnique
      .mockResolvedValueOnce({ ...SUPPLIER_RETURNED, status: 'PENDING' }) // 入口读
      .mockResolvedValueOnce({ ...SUPPLIER_RETURNED, status: 'REJECTED' }); // 落库后回读
    prisma.user.findUnique.mockResolvedValue(REVIEWER_STAFF);
    const svc = mkSvc(prisma);
    await svc.reject('sup-1', '资料不符', 'rev-1');
    const where = prisma.supplier.updateMany.mock.calls[0][0].where;
    expect(where).toMatchObject({ id: 'sup-1', status: 'PENDING' });
    expect(JSON.stringify(where)).not.toContain('RETURNED');
  });

  it('approve on 终态（APPROVED）→ 400 INVALID_STATUS（回归）', async () => {
    const prisma = mkPrisma();
    prisma.supplier.findUnique.mockResolvedValue({ ...SUPPLIER_RETURNED, status: 'APPROVED', reviewStage: null });
    const svc = mkSvc(prisma);
    await expect(svc.approve('sup-1', 'rev-1', '理由')).rejects.toMatchObject({
      response: { code: 'INVALID_STATUS' },
    });
  });
});
