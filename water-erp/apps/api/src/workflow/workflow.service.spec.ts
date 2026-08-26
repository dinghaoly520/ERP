import { WorkflowService, type WorkflowItem } from './workflow.service';

/** C1 流程中心：五源审批只读聚合（注册/密码×2/资料变更/供应商变更/目录申请） */
describe('WorkflowService（C1 统一流程中心）', () => {
  const mk = (prisma: any) => new WorkflowService(prisma);

  it('admin 可见全部五源，按提交时间倒序合并', async () => {
    const t0 = new Date('2026-08-26T08:00:00Z');
    const t1 = new Date('2026-08-26T09:00:00Z');
    const prisma = {
      supplier: { findMany: jest.fn().mockResolvedValue([{ id: 's1', name: '蜀通岩土', createdAt: t1 }]) },
      passwordChangeRequest: { findMany: jest.fn().mockResolvedValue([{ id: 'p1', requestedAt: t0, user: { displayName: '张三' } }]) },
      passwordResetRequest: { findMany: jest.fn().mockResolvedValue([]) },
      profileChangeRequest: { findMany: jest.fn().mockResolvedValue([]) },
      supplierChangeRecord: { findMany: jest.fn().mockResolvedValue([{ id: 'c1', fieldName: 'legalPerson', fieldLabel: '法定代表人', createdAt: t1, supplier: { name: '华西物资' } }]) },
      supplierCatalogApplication: { findMany: jest.fn().mockResolvedValue([{ id: 'a1', type: 'NEW_ITEM', createdAt: t0, supplier: { name: '中科院成都' } }]) },
    };
    const items = await mk(prisma).pending('admin');
    expect(items.map(i => i.source)).toEqual(['supplier_registration', 'supplier_change', 'password_change', 'catalog_application']);
    expect(items[1].title).toContain('法定代表人');
    expect(items.every(i => i.deepLink && i.category && i.status === 'PENDING')).toBe(true);
  });

  it('staff 不见 admin 专属源（注册/密码/资料变更），仍见供应商变更与目录申请', async () => {
    const prisma = {
      supplier: { findMany: jest.fn() },
      passwordChangeRequest: { findMany: jest.fn() },
      passwordResetRequest: { findMany: jest.fn() },
      profileChangeRequest: { findMany: jest.fn() },
      supplierChangeRecord: { findMany: jest.fn().mockResolvedValue([{ id: 'c1', fieldName: 'bank', fieldLabel: '开户行', createdAt: new Date(), supplier: { name: '华西物资' } }]) },
      supplierCatalogApplication: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const items = await mk(prisma).pending('staff');
    expect(items.map(i => i.source)).toEqual(['supplier_change']);
    expect(prisma.supplier.findMany).not.toHaveBeenCalled();
    expect(prisma.passwordChangeRequest.findMany).not.toHaveBeenCalled();
  });

  it('mine 只返回本人发起的申请并带状态', async () => {
    const prisma = {
      passwordChangeRequest: { findMany: jest.fn().mockResolvedValue([{ id: 'p1', requestedAt: new Date(), status: 'PENDING', user: { displayName: '张三' } }]) },
      profileChangeRequest: { findMany: jest.fn().mockResolvedValue([{ id: 'f1', requestedAt: new Date(), status: 'REJECTED', payload: { phone: '13800000000' }, user: { displayName: '张三' } }]) },
    };
    const items = await mk(prisma).mine('u1');
    expect(prisma.passwordChangeRequest.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: 'u1' } }));
    expect(items).toHaveLength(2);
    expect(items.find(i => i.source === 'profile_change')?.status).toBe('REJECTED');
  });

  it('done 聚合各源已处理记录并按处理时间倒序', async () => {
    const d0 = new Date('2026-08-25T10:00:00Z');
    const d1 = new Date('2026-08-26T10:00:00Z');
    const prisma = {
      registrationReview: { findMany: jest.fn().mockResolvedValue([{ id: 'r1', username: 'SUP-9', displayName: '新供应商', decision: 'REJECTED', reviewedAt: d1 }]) },
      passwordChangeRequest: { findMany: jest.fn().mockResolvedValue([{ id: 'p1', requestedAt: d0, reviewedAt: d0, status: 'APPROVED', user: { displayName: '张三' } }]) },
      passwordResetRequest: { findMany: jest.fn().mockResolvedValue([]) },
      profileChangeRequest: { findMany: jest.fn().mockResolvedValue([]) },
      supplierChangeRecord: { findMany: jest.fn().mockResolvedValue([{ id: 'c1', fieldName: 'bank', fieldLabel: '开户行', createdAt: d0, reviewedAt: d0, status: 'APPROVED', supplier: { name: '华西' } }]) },
      supplierCatalogApplication: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const items = await mk(prisma).done();
    expect(items[0].source).toBe('supplier_registration'); // d1 最新
    expect(items.map(i => i.status)).not.toContain('PENDING');
  });
});
