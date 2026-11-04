import { AccountAdminController } from './account-admin.controller';

/** 2026-11-04 供应商多归属：PATCH supplier-company 收 companyIds[]（替换集语义）——
 *  授予差集 upsert 直批 APPROVED、目标外 APPROVED 删除、主归属快照随集合同步；
 *  列表端点带 companies（APPROVED 集合）。 */
describe('AccountAdminController.updateSupplierCompany（多归属替换集）', () => {
  const actor = { sub: 'admin-1', role: 'admin' } as any;
  const companies = [
    { id: 'co-a', name: '蜀水建设' },
    { id: 'co-b', name: '设计院' },
    { id: 'co-c', name: '亭子口' },
  ];

  const mk = (opts: {
    links?: any[];
    primaryId?: string | null;
  } = {}) => {
    const upsert = jest.fn().mockResolvedValue({});
    const linkDelete = jest.fn().mockResolvedValue({});
    const supplierUpdate = jest.fn().mockResolvedValue({});
    const prisma: any = {
      user: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'u-1',
          supplier: { id: 'sup-1', name: '重庆蜀通', companyId: opts.primaryId ?? null },
        }),
      },
      company: {
        // 模拟 where { id: { in } } 过滤语义（与真实 Prisma 一致）
        findMany: jest.fn().mockImplementation(({ where }: any) =>
          Promise.resolve(companies.filter((c) => where?.id?.in?.includes(c.id))),
        ),
      },
      supplierCompanyLink: {
        findMany: jest.fn().mockResolvedValue(opts.links ?? []),
        upsert,
        delete: linkDelete,
      },
      supplier: { update: supplierUpdate },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
      $transaction: jest.fn((ops: any[]) => Promise.all(ops)),
    };
    return { ctrl: new AccountAdminController(prisma), prisma, upsert, linkDelete, supplierUpdate };
  };

  it('授予差集直批 APPROVED + 移除目标外 APPROVED + 主归属被移除时改指首个', async () => {
    const links = [
      { id: 'l-a', companyId: 'co-a', status: 'APPROVED' },
      { id: 'l-p', companyId: 'co-b', status: 'PENDING' }, // 待审中 → 勾选即直批
    ];
    const { ctrl, upsert, linkDelete, supplierUpdate } = mk({ links, primaryId: 'co-a' });
    // 目标 = co-b（直批待审）+ co-c（新授予）；co-a 取消勾选
    const r = await ctrl.updateSupplierCompany('u-1', { companyIds: ['co-b', 'co-c'] }, actor);

    expect(upsert.mock.calls.map((c) => c[0].where.supplierId_companyId)).toEqual(
      expect.arrayContaining([
        { supplierId: 'sup-1', companyId: 'co-b' },
        { supplierId: 'sup-1', companyId: 'co-c' },
      ]),
    );
    expect(upsert.mock.calls[0][0].create).toMatchObject({ status: 'APPROVED', reviewStage: null });
    expect(upsert.mock.calls[0][0].update).toMatchObject({ status: 'APPROVED', reviewStage: null });
    expect(linkDelete).toHaveBeenCalledWith({ where: { id: 'l-a' } });
    // 主归属 co-a 被移除 → 快照改指目标首个 co-b
    expect(supplierUpdate).toHaveBeenCalledWith({
      where: { id: 'sup-1' },
      data: { companyId: 'co-b', companyName: '设计院' },
      select: expect.anything(),
    });
    expect(r).toMatchObject({ companyId: 'co-b', companyName: '设计院' });
    expect(r.companies.map((c: any) => c.id).sort()).toEqual(['co-b', 'co-c']);
  });

  it('主归属仍在集合内保持不变；空集=全部移出并清空主归属', async () => {
    const keep = mk({ links: [{ id: 'l-a', companyId: 'co-a', status: 'APPROVED' }], primaryId: 'co-a' });
    const r1 = await keep.ctrl.updateSupplierCompany('u-1', { companyIds: ['co-a', 'co-c'] }, actor);
    expect(r1.companyId).toBe('co-a');
    expect(keep.linkDelete).not.toHaveBeenCalled();

    const clear = mk({ links: [{ id: 'l-a', companyId: 'co-a', status: 'APPROVED' }], primaryId: 'co-a' });
    const r2 = await clear.ctrl.updateSupplierCompany('u-1', { companyIds: [] }, actor);
    expect(clear.linkDelete).toHaveBeenCalledWith({ where: { id: 'l-a' } });
    expect(clear.supplierUpdate).toHaveBeenCalledWith({
      where: { id: 'sup-1' },
      data: { companyId: null, companyName: null },
      select: expect.anything(),
    });
    expect(r2.companies).toEqual([]);
  });

  it('公司 id 不存在 → 400 COMPANY_NOT_FOUND；非供应商账号 → 400 NOT_SUPPLIER', async () => {
    const { ctrl, prisma } = mk();
    prisma.company.findMany.mockResolvedValue([companies[0]]); // 只找到 co-a
    await expect(ctrl.updateSupplierCompany('u-1', { companyIds: ['co-a', 'co-x'] }, actor)).rejects.toMatchObject({
      response: { code: 'COMPANY_NOT_FOUND' },
    });

    const notSupplier: any = { ...prisma, user: { findUnique: jest.fn().mockResolvedValue({ id: 'u-1', supplier: null }) } };
    const ctrl2 = new AccountAdminController(notSupplier);
    await expect(ctrl2.updateSupplierCompany('u-1', { companyIds: ['co-a'] }, actor)).rejects.toMatchObject({
      response: { code: 'NOT_SUPPLIER' },
    });
  });

  it('写动作落审计（调整供应商归属公司，含增删公司名）', async () => {
    const { ctrl, prisma } = mk({ links: [{ id: 'l-a', companyId: 'co-a', status: 'APPROVED' }], primaryId: 'co-a' });
    await ctrl.updateSupplierCompany('u-1', { companyIds: ['co-b', 'co-c'] }, actor);
    expect(prisma.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        userId: 'admin-1',
        action: '调整供应商归属公司',
        details: expect.objectContaining({
          added: expect.arrayContaining(['设计院', '亭子口']),
          removed: expect.arrayContaining(['蜀水建设']),
        }),
      }),
    }));
  });
});

describe('AccountAdminController.listSuppliers（列表带多归属 companies）', () => {
  it('companyLinks 按 APPROVED 过滤映射为 companies，非 APPROVED 不入', async () => {
    const prisma: any = {
      user: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'u-1', username: 'x', displayName: 'x', phone: null, email: null,
            isActive: true, isFrozen: false, createdAt: new Date(), passwordVault: 'v',
            supplier: {
              name: '蜀通', creditCode: null, isTemporary: false, companyId: 'co-a', companyName: '蜀水建设',
              companyLinks: [
                { status: 'APPROVED', company: { id: 'co-a', name: '蜀水建设' } },
                { status: 'PENDING', company: { id: 'co-b', name: '设计院' } },
                { status: 'APPROVED', company: { id: 'co-c', name: '亭子口' } },
              ],
            },
          },
        ]),
      },
      auditLog: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const r = await new AccountAdminController(prisma).listSuppliers();
    expect(r[0].supplier!.companies).toEqual([
      { id: 'co-a', name: '蜀水建设' },
      { id: 'co-c', name: '亭子口' },
    ]);
  });
});
