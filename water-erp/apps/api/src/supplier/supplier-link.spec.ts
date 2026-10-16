import { ForbiddenException } from '@nestjs/common';
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

/** 审批角标 joins 计数（多公司归属 2026-10-16）——与注册审批同口径：
 *  staff→STAFF 级·本公司；leader→LEADER 级·本公司（+本公司无 staff 时兼 STAFF 级）；
 *  admin→ADMIN 级全部 + 「无 leader 公司」LEADER 级 + 「无 staff 且无 leader 公司」STAFF 级（代审，A 方案同口径）。 */
describe('myPendingReviewCount — joins 计数（多公司归属）', () => {
  const mkPrisma = (over: Record<string, any> = {}): any => ({
    user: { findUnique: jest.fn().mockResolvedValue(over.me ?? { companyId: 'co-2' }), count: jest.fn().mockResolvedValue(over.roleCount ?? 1) },
    supplier: { count: jest.fn().mockResolvedValue(0) },
    supplierChangeRecord: { count: jest.fn().mockResolvedValue(0) },
    passwordResetRequest: { count: jest.fn().mockResolvedValue(0) },
    supplierCompanyLink: { count: jest.fn().mockResolvedValue(over.joins ?? 3) },
  });
  // SupplierService 构造实参（prisma, notification, redis, llm, verification, companyScope）——myPendingReviewCount 仅用 prisma
  const newService = (prisma: any) => new (SupplierService as any)(prisma, null, null, null, null, null);

  it('staff：本公司 STAFF 级申请计数', async () => {
    const prisma = mkPrisma();
    const svc = newService(prisma);
    const r = await svc.myPendingReviewCount({ sub: 'u1', role: 'staff', username: 'x' } as any);
    expect(r).toEqual({ registration: 0, changes: 0, resets: 0, joins: 3 });
    expect(prisma.supplierCompanyLink.count).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ reviewStage: { in: ['STAFF'] }, companyId: 'co-2' }),
    }));
  });

  it('supplier 角色：无审批待办，joins=0 且不查 link 表', async () => {
    const prisma: any = { supplierCompanyLink: { count: jest.fn() } };
    const svc = newService(prisma);
    const r = await svc.myPendingReviewCount({ sub: 'u1', role: 'supplier', username: 'x' } as any);
    expect(r.joins).toBe(0);
    expect(prisma.supplierCompanyLink.count).not.toHaveBeenCalled();
  });

  it('leader：LEADER 级 + 本公司无 staff 时兼计 STAFF 级', async () => {
    const prisma = mkPrisma({ roleCount: 0, joins: 4 }); // user.count=0 → 本公司无在编 staff
    const svc = newService(prisma);
    const r = await svc.myPendingReviewCount({ sub: 'u1', role: 'leader', username: 'x' } as any);
    expect(r).toEqual({ registration: 0, changes: 0, resets: 0, joins: 4 });
    expect(prisma.supplierCompanyLink.count).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ reviewStage: { in: ['LEADER', 'STAFF'] }, companyId: 'co-2' }),
    }));
  });

  it('admin：终审件 + 无 leader 公司 LEADER 级 + 无 staff/leader 公司 STAFF 级（代审口径同注册审批 A 方案）', async () => {
    const prisma = mkPrisma({ joins: 7 });
    const svc = newService(prisma);
    const r = await svc.myPendingReviewCount({ sub: 'adm', role: 'admin', username: 'a' } as any);
    expect(r).toEqual({ registration: 0, changes: 0, resets: 0, joins: 7 });
    expect(prisma.supplierCompanyLink.count).toHaveBeenCalledTimes(1);
    // 三批口径锁定在 where 结构上（link.companyId 非空，无「未归属公司」分支）
    const where = (prisma.supplierCompanyLink.count as jest.Mock).mock.calls[0][0].where;
    expect(where.status).toBe('PENDING');
    expect(where.AND[0].OR).toEqual([
      { reviewStage: 'ADMIN' },
      { reviewStage: 'LEADER', company: { users: { none: { role: 'leader', isActive: true } } } },
      { reviewStage: 'STAFF', company: { users: { none: { OR: [{ role: 'staff' }, { role: 'leader' }], isActive: true } } } },
    ]);
  });
});

/** checkDuplicate registeredElsewhere（多公司归属 2026-10-16）——防公开端点枚举：只回布尔，不回公司名。 */
describe('checkDuplicate — companyId/registeredElsewhere（防枚举：不回传公司名）', () => {
  // SupplierService 构造实参（prisma, notification, redis, llm, verification, companyScope）——checkDuplicate 仅用 prisma
  const newService = (prisma: any) => new (SupplierService as any)(prisma, null, null, null, null, null);

  it('他司 APPROVED、本公司无 link → registeredElsewhere=true', async () => {
    const prisma: any = {
      supplier: { findFirst: jest.fn().mockResolvedValue({ id: 's1', status: 'APPROVED' }) },
      company: { findUnique: jest.fn().mockResolvedValue({ id: 'co-mine', name: '本公司' }) },
      supplierCompanyLink: { findUnique: jest.fn().mockResolvedValue(null) },
      supplierContact: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    const svc = newService(prisma);
    const r = await svc.checkDuplicate({ creditCode: '91510000MA62K5XX0X', companyId: 'co-mine' });
    expect(r.creditCode).toBe(true);
    expect(r.registeredElsewhere).toBe(true);
  });

  it('本公司已有 APPROVED link → registeredElsewhere=false', async () => {
    const prisma: any = {
      supplier: { findFirst: jest.fn().mockResolvedValue({ id: 's1', status: 'APPROVED' }) },
      company: { findUnique: jest.fn().mockResolvedValue({ id: 'co-mine', name: '本公司' }) },
      supplierCompanyLink: { findUnique: jest.fn().mockResolvedValue({ id: 'l1', status: 'APPROVED' }) },
      supplierContact: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    const svc = newService(prisma);
    const r = await svc.checkDuplicate({ creditCode: '91510000MA62K5XX0X', companyId: 'co-mine' });
    expect(r.registeredElsewhere).toBe(false);
  });
});

/** get/revealField 越权判定（多公司归属 2026-10-16）——任一 APPROVED link 在视野 或 主归属在视野
 *  即放行（未回填窗口兜底）；无交集复用 assertInScope 的 403 COMPANY_SCOPE_FORBIDDEN。 */
describe('get/revealField — link 视野越权判定（多公司归属）', () => {
  const scopeSvc: any = {
    resolveScope: async () => ({ all: false, companyIds: ['co-2'] }),
    assertInScope: (id: string | null, s: any) => {
      if (!s.all && (id == null || !s.companyIds.includes(id))) {
        throw new ForbiddenException({ error: '该数据不属于本公司，无权访问', code: 'COMPANY_SCOPE_FORBIDDEN' });
      }
    },
  };
  // SupplierService 构造实参（prisma, notification, redis, llm, verification, companyScope）——
  // companyScope 用注入覆盖；supplier 命中时 notification 不触达可为 null。
  // get() 返回形状依赖 include 关系（user/contacts/bankAccounts/changeRecords），mock 补空集合。
  const newService = (prisma: any) => {
    const svc: any = new (SupplierService as any)(prisma, null, null, null, null, null);
    svc['companyScope'] = scopeSvc;
    return svc as SupplierService;
  };
  const actor = { sub: 'u2', role: 'staff', username: 'x' } as any;

  it('get：主归属他司但存在本公司 APPROVED link → 放行', async () => {
    const prisma: any = {
      supplier: { findUnique: jest.fn().mockResolvedValue({ id: 's1', companyId: 'co-1', userId: 'u1', user: null, contacts: [], bankAccounts: [], changeRecords: [] }) },
      supplierCompanyLink: { findMany: jest.fn().mockResolvedValue([{ id: 'l1' }]) },
    };
    const svc = newService(prisma);
    await expect(svc.get('s1', actor)).resolves.toBeTruthy();
    expect(prisma.supplierCompanyLink.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { supplierId: 's1', companyId: { in: ['co-2'] }, status: 'APPROVED' },
      take: 1,
    }));
  });

  it('get：无任何视野交集 → 403 COMPANY_SCOPE_FORBIDDEN', async () => {
    const prisma: any = {
      supplier: { findUnique: jest.fn().mockResolvedValue({ id: 's1', companyId: 'co-1', userId: 'u1', user: null, contacts: [], bankAccounts: [], changeRecords: [] }) },
      supplierCompanyLink: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const svc = newService(prisma);
    await expect(svc.get('s1', actor)).rejects.toMatchObject({ response: { code: 'COMPANY_SCOPE_FORBIDDEN' } });
  });

  it('revealField：主归属他司但存在本公司 APPROVED link → 放行（同口径闸门）', async () => {
    const prisma: any = {
      supplier: { findUnique: jest.fn().mockResolvedValue({ id: 's1', companyId: 'co-1', legalPersonIdCard: null, legalPersonPhone: null }) },
      supplierCompanyLink: { findMany: jest.fn().mockResolvedValue([{ id: 'l1' }]) },
      sensitiveAccessLog: { create: jest.fn().mockResolvedValue({}) },
    };
    const svc = newService(prisma);
    const r = await svc.revealField('s1', { entity: 'supplier', field: 'legalPersonIdCard' }, actor);
    expect(r).toMatchObject({ entity: 'supplier', targetId: 's1', field: 'legalPersonIdCard', value: null });
  });
});
