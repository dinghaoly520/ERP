import { SupplierLinkService } from './supplier-link.service';

/** 供应商侧 link 操作：myLinks/apply（多公司归属 2026-10-16 spec §流程——唯一通道=自主申请） */
describe('SupplierLinkService — 供应商侧', () => {
  /** companyScope 桩（listForCompany 用；供应商侧路径不触它） */
  const SCOPE: any = { resolveScope: async () => ({ all: false, companyIds: ['co-2'] }) };
  const mk = (supplier: any, link: any = null) => {
    const prisma: any = {
      supplier: { findUnique: jest.fn().mockResolvedValue(supplier) },
      company: { findUnique: jest.fn().mockResolvedValue({ id: 'co-2', name: '乙公司' }) },
      // notifyStageApprovers 经 user.findMany 解析 STAFF 级收件人（brief 原稿漏配；须返回 ≥1 人，
      // 否则「通知 STAFF 级审批人」断言无法成立）
      user: { findMany: jest.fn().mockResolvedValue([{ id: 'st-1' }]) },
      supplierCompanyLink: {
        findUnique: jest.fn().mockResolvedValue(link),
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([{ id: 'l1', companyId: 'co-1', company: { name: '甲公司' }, status: 'APPROVED', reviewStage: null }]),
        create: jest.fn().mockResolvedValue({ id: 'l-new' }),
        update: jest.fn().mockResolvedValue({}),
      },
    };
    const notify = { create: jest.fn().mockResolvedValue({}), sendToRole: jest.fn() };
    const svc = new SupplierLinkService(prisma, notify as any, SCOPE);
    return { prisma, notify, svc };
  };
  const SUP = { id: 's1', userId: 'u1', companyId: 'co-1', status: 'APPROVED', isTemporary: false, name: '甲供应商' };

  it('apply：合法申请 → PENDING/STAFF link + 通知 STAFF 级审批人', async () => {
    const { prisma, notify, svc } = mk(SUP);
    const r = await svc.apply('u1', { companyId: 'co-2', note: '希望参与贵司采购' });
    expect(r).toEqual({ id: 'l-new' });
    expect(prisma.supplierCompanyLink.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ supplierId: 's1', companyId: 'co-2', status: 'PENDING', reviewStage: 'STAFF' }),
    }));
    expect(notify.create).toHaveBeenCalled();
  });

  it('apply：临时供应商 → 400 TEMPORARY_NOT_ALLOWED', async () => {
    const { svc } = mk({ ...SUP, isTemporary: true });
    await expect(svc.apply('u1', { companyId: 'co-2' })).rejects.toMatchObject({ response: { code: 'TEMPORARY_NOT_ALLOWED' } });
  });

  it('apply：全局非 APPROVED → 400 SUPPLIER_NOT_APPROVED', async () => {
    const { svc } = mk({ ...SUP, status: 'PENDING' });
    await expect(svc.apply('u1', { companyId: 'co-2' })).rejects.toMatchObject({ response: { code: 'SUPPLIER_NOT_APPROVED' } });
  });

  it('apply：目标公司不存在 → 400 COMPANY_NOT_FOUND', async () => {
    const { prisma, svc } = mk(SUP);
    (prisma.company.findUnique as jest.Mock).mockResolvedValue(null);
    await expect(svc.apply('u1', { companyId: 'co-x' })).rejects.toMatchObject({ response: { code: 'COMPANY_NOT_FOUND' } });
  });

  it('apply：link 已 PENDING → 400 LINK_PENDING_EXISTS；已 APPROVED → ALREADY_IN_COMPANY；DISABLED → LINK_DISABLED', async () => {
    const p = mk(SUP).prisma;
    for (const [status, code] of [['PENDING', 'LINK_PENDING_EXISTS'], ['APPROVED', 'ALREADY_IN_COMPANY'], ['DISABLED', 'LINK_DISABLED']] as const) {
      const svc = new SupplierLinkService(p, { create: jest.fn() } as any, SCOPE);
      (p.supplierCompanyLink.findUnique as jest.Mock).mockResolvedValueOnce({ id: 'l1', status });
      await expect(svc.apply('u1', { companyId: 'co-2' })).rejects.toMatchObject({ response: { code } });
    }
  });

  it('apply：REJECTED 旧 link → 原行复用回 PENDING/STAFF（不建新行）', async () => {
    const prisma: any = {
      supplier: { findUnique: jest.fn().mockResolvedValue(SUP) },
      company: { findUnique: jest.fn().mockResolvedValue({ id: 'co-2', name: '乙公司' }) },
      user: { findMany: jest.fn().mockResolvedValue([{ id: 'st-1' }]) }, // 复用行后仍通知 STAFF 级（brief 原稿漏配）
      supplierCompanyLink: {
        findUnique: jest.fn().mockResolvedValue({ id: 'l-old', status: 'REJECTED' }),
        update: jest.fn().mockResolvedValue({ id: 'l-old' }),
        create: jest.fn(),
      },
    };
    const svc = new SupplierLinkService(prisma, { create: jest.fn() } as any, SCOPE);
    const r = await svc.apply('u1', { companyId: 'co-2' });
    expect(r).toEqual({ id: 'l-old' });
    expect(prisma.supplierCompanyLink.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'l-old' },
      data: expect.objectContaining({ status: 'PENDING', reviewStage: 'STAFF' }),
    }));
    expect(prisma.supplierCompanyLink.create).not.toHaveBeenCalled();
  });

  it('apply：并发竞态 create 撞复合唯一 P2002 → 400 LINK_PENDING_EXISTS（findUnique-then-create 间隙兜底）', async () => {
    const { prisma, svc } = mk(SUP);
    (prisma.supplierCompanyLink.create as jest.Mock).mockRejectedValueOnce({ code: 'P2002' });
    await expect(svc.apply('u1', { companyId: 'co-2' })).rejects.toMatchObject({ response: { code: 'LINK_PENDING_EXISTS' } });
  });

  it('myLinks：返回归属列表并标注主归属', async () => {
    const { svc } = mk(SUP);
    const rows = await svc.myLinks('u1');
    expect(rows[0].companyName).toBe('甲公司');
    expect(rows[0].isPrimary).toBe(true);
  });
});
