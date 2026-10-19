import { ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CompanyScopeService } from '../company/company-scope';
import { SupplierScopeGuard, SupplierChangeScopeGuard } from './supplier-scope.guard';

/**
 * 供应商 :id 路由公司视野守卫（2026-10-19）：
 * OwnerGuard 对 staff/leader/admin 直通（只管 supplier 角色自访）——:id 子资源与写操作
 * 此前他司 staff 直打 id 即可读/写。守卫谓词与 SupplierService.assertSupplierInScope 同源：
 * 主归属∈视野 或 APPROVED/DISABLED link∈视野（审批流转件终审前只有 Supplier.companyId；
 * DISABLED 放行防「本公司停用 link 后恢复按钮 403」死锁）。
 */
describe('SupplierScopeGuard / SupplierChangeScopeGuard', () => {
  let prisma: any;
  let companyScope: { resolveScope: jest.Mock };

  const ctx = (user: any, params: Record<string, string> = {}, query: Record<string, string> = {}) =>
    ({ switchToHttp: () => ({ getRequest: () => ({ user, params, query }) }) }) as any;

  const STAFF = { sub: 'staff-1', role: 'staff' };

  async function run(guard: any, user: any, params: Record<string, string>, query: Record<string, string> = {}) {
    return guard.canActivate(ctx(user, params, query));
  }

  beforeEach(() => {
    prisma = {
      supplier: { findUnique: jest.fn().mockResolvedValue(null) },
      supplierCompanyLink: { findMany: jest.fn().mockResolvedValue([]) },
      supplierChangeRecord: { findUnique: jest.fn().mockResolvedValue(null) },
    };
    companyScope = { resolveScope: jest.fn().mockResolvedValue({ all: false, companyIds: ['co-1'] }) };
  });

  function buildGuard(kind: 'supplier' | 'change') {
    const Ctor = kind === 'supplier' ? SupplierScopeGuard : SupplierChangeScopeGuard;
    return new Ctor(prisma as unknown as PrismaService, companyScope as unknown as CompanyScopeService);
  }

  it('未登录 → 403 UNAUTHORIZED', async () => {
    await expect(run(buildGuard('supplier'), undefined, { id: 's1' })).rejects.toMatchObject({
      response: { code: 'UNAUTHORIZED' },
    });
  });

  it('supplier 角色跳过（归属校验归 OwnerGuard/服务层，供应商账号无采购公司归属）', async () => {
    await expect(run(buildGuard('supplier'), { sub: 'u', role: 'supplier' }, { id: 's1' })).resolves.toBe(true);
    expect(prisma.supplier.findUnique).not.toHaveBeenCalled();
  });

  it('admin 全部公司视野放行（?companyId= 切公司后同受限定）', async () => {
    prisma.supplier.findUnique.mockResolvedValue({ companyId: 'co-other' });
    companyScope.resolveScope.mockResolvedValue({ all: true });
    await expect(run(buildGuard('supplier'), { sub: 'a', role: 'admin' }, { id: 's1' })).resolves.toBe(true);
    // admin 带 companyId → resolveScope 收到该参数，且切定他司后同受限定（403）
    companyScope.resolveScope.mockResolvedValue({ all: false, companyIds: ['co-x'] });
    await expect(run(buildGuard('supplier'), { sub: 'a', role: 'admin' }, { id: 's1' }, { companyId: 'co-x' }))
      .rejects.toMatchObject({ response: { code: 'COMPANY_SCOPE_FORBIDDEN' } });
    expect(companyScope.resolveScope).toHaveBeenCalledWith(expect.anything(), 'co-x');
  });

  it('主归属∈视野 → 放行（审批流转件：终审落 link 前只有 Supplier.companyId）', async () => {
    prisma.supplier.findUnique.mockResolvedValue({ companyId: 'co-1' });
    await expect(run(buildGuard('supplier'), STAFF, { id: 's1' })).resolves.toBe(true);
    expect(prisma.supplierCompanyLink.findMany).not.toHaveBeenCalled();
  });

  it('APPROVED/DISABLED link∈视野 → 放行；PENDING link 不放行', async () => {
    prisma.supplier.findUnique.mockResolvedValue({ companyId: null });
    prisma.supplierCompanyLink.findMany.mockResolvedValueOnce([{ id: 'l1' }]);
    await expect(run(buildGuard('supplier'), STAFF, { id: 's1' })).resolves.toBe(true);
    prisma.supplierCompanyLink.findMany.mockResolvedValueOnce([]); // 仅 PENDING/他司 link
    await expect(run(buildGuard('supplier'), STAFF, { id: 's1' })).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('全不命中 → 403 COMPANY_SCOPE_FORBIDDEN（与 assertInScope 同语义）', async () => {
    prisma.supplier.findUnique.mockResolvedValue({ companyId: 'co-other' });
    prisma.supplierCompanyLink.findMany.mockResolvedValue([]);
    await expect(run(buildGuard('supplier'), STAFF, { id: 's1' })).rejects.toMatchObject({
      response: { code: 'COMPANY_SCOPE_FORBIDDEN' },
    });
  });

  it('id 非供应商/已删除 → 放行（404 语义交服务层，不吞）', async () => {
    prisma.supplier.findUnique.mockResolvedValue(null);
    await expect(run(buildGuard('supplier'), STAFF, { id: 'not-a-supplier' })).resolves.toBe(true);
  });

  it('变更审批变体：changeId → SupplierChangeRecord → 同谓词；记录不存在放行', async () => {
    prisma.supplierChangeRecord.findUnique.mockResolvedValue({ supplier: { companyId: 'co-other' } });
    await expect(run(buildGuard('change'), STAFF, { changeId: 'cr1' })).rejects.toMatchObject({
      response: { code: 'COMPANY_SCOPE_FORBIDDEN' },
    });
    prisma.supplierChangeRecord.findUnique.mockResolvedValue({ supplier: { companyId: 'co-1' } });
    await expect(run(buildGuard('change'), STAFF, { changeId: 'cr1' })).resolves.toBe(true);
    prisma.supplierChangeRecord.findUnique.mockResolvedValue(null);
    await expect(run(buildGuard('change'), STAFF, { changeId: 'nope' })).resolves.toBe(true);
  });
});
