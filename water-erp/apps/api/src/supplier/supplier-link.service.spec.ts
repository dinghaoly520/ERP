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

describe('SupplierLinkService — 公司侧（三级审批）', () => {
  const LINK = { id: 'l1', supplierId: 's1', companyId: 'co-2', status: 'PENDING', reviewStage: 'STAFF', supplier: { id: 's1', userId: 'u1', name: '甲供应商', supplierNo: 'SUP-000001', creditCode: '91510000MA62K5XX0X', status: 'APPROVED', isTemporary: false }, company: { name: '乙公司' } };
  const mkSide = (over: Record<string, any> = {}) => {
    const prisma: any = {
      supplierCompanyLink: {
        findUnique: jest.fn().mockResolvedValue({ ...LINK, ...over.link }),
        findMany: jest.fn().mockResolvedValue([{ ...LINK, ...over.link }]),
        update: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        create: jest.fn().mockResolvedValue({ id: 'l-new' }),
      },
      supplier: { findUnique: jest.fn().mockResolvedValue({ id: 's1', name: '甲供应商', status: 'APPROVED', isTemporary: false, userId: 'u1' }) },
      user: {
        findUnique: jest.fn().mockResolvedValue(over.reviewer ?? { id: 'rev-1', role: 'staff', companyId: 'co-2' }),
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(over.staffCount ?? 1),
      },
    };
    const notify = { create: jest.fn().mockResolvedValue({}) };
    const SCOPE: any = { resolveScope: async () => ({ all: false, companyIds: ['co-2'] }) };
    const svc = new SupplierLinkService(prisma, notify as any, SCOPE);
    return { prisma, notify, svc };
  };

  it('approveLink：STAFF 级同公司 staff 通过 → 推进 LEADER；非本级人 → 403 REVIEW_STAGE_MISMATCH', async () => {
    const { prisma, svc } = mkSide();
    const r = await svc.approveLink('l1', 'rev-1', '资质齐全，同意');
    expect(r).toEqual({ success: true, stage: 'LEADER' });
    expect(prisma.supplierCompanyLink.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: 'l1', reviewStage: 'STAFF' }),
      data: expect.objectContaining({ reviewStage: 'LEADER' }),
    }));
    const other = mkSide({ reviewer: { id: 'rev-2', role: 'staff', companyId: 'co-other' } });
    await expect(other.svc.approveLink('l1', 'rev-2', 'x')).rejects.toMatchObject({ response: { code: 'REVIEW_STAGE_MISMATCH' } });
  });

  it('approveLink：STAFF/LEADER 级通过须填缘由 → 400 REVIEW_REASON_REQUIRED', async () => {
    const { svc } = mkSide();
    await expect(svc.approveLink('l1', 'rev-1', '')).rejects.toMatchObject({ response: { code: 'REVIEW_REASON_REQUIRED' } });
  });

  it('approveLink：ADMIN 终审 → APPROVED + 通知供应商；乐观锁 count=0 → 409 CONFLICT', async () => {
    const admin = mkSide({ link: { reviewStage: 'ADMIN' }, reviewer: { id: 'adm', role: 'admin', companyId: null } });
    const r = await admin.svc.approveLink('l1', 'adm', undefined);
    expect(r).toEqual({ success: true, stage: 'DONE' });
    expect(admin.prisma.supplierCompanyLink.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'APPROVED', reviewStage: null }),
    }));
    const clash = mkSide({ link: { reviewStage: 'ADMIN' }, reviewer: { id: 'adm', role: 'admin', companyId: null } });
    (clash.prisma.supplierCompanyLink.updateMany as jest.Mock).mockResolvedValue({ count: 0 });
    await expect(clash.svc.approveLink('l1', 'adm')).rejects.toMatchObject({ response: { code: 'CONFLICT' } });
  });

  it('approveLink：非待审态（APPROVED）→ 400 INVALID_STATUS', async () => {
    const bad = mkSide({ link: { status: 'APPROVED', reviewStage: null } });
    await expect(bad.svc.approveLink('l1', 'rev-1')).rejects.toMatchObject({ response: { code: 'INVALID_STATUS' } });
  });

  it('rejectLink：任一级驳回 → REJECTED + rejectReason + 通知供应商', async () => {
    const { prisma, notify, svc } = mkSide();
    await svc.rejectLink('l1', 'rev-1', '资质不符');
    expect(prisma.supplierCompanyLink.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'REJECTED', rejectReason: '资质不符' }),
    }));
    expect(notify.create).toHaveBeenCalled();
  });

  it('setDisabled：APPROVED↔DISABLED 切换；非此二态 → 400 INVALID_STATUS', async () => {
    const { svc } = mkSide({ link: { status: 'APPROVED', reviewStage: null } });
    await expect(svc.setDisabled('l1', 'rev-1', true)).resolves.toEqual({ success: true });
    const bad = mkSide({ link: { status: 'PENDING', reviewStage: 'STAFF' } });
    await expect(bad.svc.setDisabled('l1', 'rev-1', true)).rejects.toMatchObject({ response: { code: 'INVALID_STATUS' } });
  });

  it('listForCompany：公司视野注入 + supplier 只读字段', async () => {
    const { prisma, svc } = mkSide();
    await svc.listForCompany({ sub: 'u9', role: 'staff', username: 'x' } as any, { status: 'PENDING' });
    expect(prisma.supplierCompanyLink.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ companyId: { in: ['co-2'] }, status: 'PENDING' }),
      include: expect.objectContaining({ supplier: expect.anything() }),
    }));
  });
});

/** 通知兜底链（Task 3 review 遗留项）：STAFF 级公司无 staff → leader 上浮收件 */
describe('SupplierLinkService — 通知兜底链', () => {
  it('STAFF 级缺员 → 通知上浮 leader（staff 查空 → leader 命中）', async () => {
    const prisma: any = {
      supplier: { findUnique: jest.fn().mockResolvedValue({ id: 's1', userId: 'u1', companyId: 'co-1', status: 'APPROVED', isTemporary: false, name: '甲供应商' }) },
      company: { findUnique: jest.fn().mockResolvedValue({ id: 'co-2', name: '乙公司' }) },
      user: {
        findMany: jest.fn()
          .mockResolvedValueOnce([])                  // 同公司 staff 查空
          .mockResolvedValueOnce([{ id: 'ld-1' }]),   // leader 上浮命中
      },
      supplierCompanyLink: { findUnique: jest.fn().mockResolvedValue(null), create: jest.fn().mockResolvedValue({ id: 'l-new' }) },
    };
    const notify = { create: jest.fn().mockResolvedValue({}) };
    const svc = new SupplierLinkService(prisma, notify as any, { resolveScope: async () => ({ all: false, companyIds: [] }) } as any);
    await svc.apply('u1', { companyId: 'co-2' });
    expect(notify.create).toHaveBeenCalledWith(expect.objectContaining({ userId: 'ld-1' }));
  });
});
