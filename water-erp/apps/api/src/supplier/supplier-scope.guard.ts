import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CompanyScopeService } from '../company/company-scope';

/**
 * 供应商 :id 路由公司视野守卫（2026-10-19）：
 * OwnerGuard 只管 supplier 角色自访（staff/leader/admin 一律直通）——:id 子资源
 * （资质/评价/时间线/沟通/奖惩/审批历史/档案等）与写操作（停用/拉黑/淘汰/评价/标签…）
 * 此前对公司视野全裸，他司 staff 直打 id 即可读取或操作。
 *
 * 谓词与 SupplierService.assertSupplierInScope 同源（改一处须同步另一处）：
 *  - supplier 角色跳过——归属校验归 OwnerGuard/服务层（供应商账号无采购公司归属，
 *    resolveScope 会落到 NO_COMPANY 永假哨兵，须先放行）；
 *  - admin 全部公司视野放行；?companyId= 切公司后同受限定（与页面选择器一致）；
 *  - 非 admin：主归属∈视野（审批流转件终审落 link 前只有 Supplier.companyId）
 *    或存在 APPROVED/DISABLED link∈视野（DISABLED 放行防「本公司停用 link 后
 *    恢复按钮 403」死锁，口径见 service 注释）；
 *  - id 非供应商/已删除 → 放行，404 语义交服务层（不在守卫吞掉）。
 */

/** id → 供应商引用解析器（changeId 变体先查 SupplierChangeRecord 再落到供应商；
 *  supplierId 供 link 兜底查询——changeId 变体的 rawId 不是供应商主键） */
type SupplierRef = { supplierId: string; companyId: string | null } | null;
type IdResolver = (prisma: PrismaService, rawId: string) => Promise<SupplierRef>;

function makeSupplierScopeGuard(paramName: string, resolve: IdResolver) {
  @Injectable()
  class SupplierScopeGuard implements CanActivate {
    // TS4094：导出匿名类不允许 private 构造参数属性——显式公共字段（Nest 注入不受影响）
    constructor(
      readonly prisma: PrismaService,
      readonly companyScope: CompanyScopeService,
    ) {}

    async canActivate(context: ExecutionContext): Promise<boolean> {
      const req = context.switchToHttp().getRequest();
      const user = req.user;
      if (!user) {
        throw new ForbiddenException({ error: '未登录', code: 'UNAUTHORIZED' });
      }
      if (user.role === 'supplier') return true;
      const rawId = req.params?.[paramName];
      if (!rawId) return true;
      const supplier = await resolve(this.prisma, rawId);
      if (!supplier) return true; // 非 supplier 主键（分类/邀请码等）或已删除——404 归服务层
      const scope = await this.companyScope.resolveScope(user, req.query?.companyId);
      if (scope.all) return true;
      const ids = scope.companyIds;
      if (supplier.companyId != null && ids.includes(supplier.companyId)) return true;
      const links = await this.prisma.supplierCompanyLink.findMany({
        where: { supplierId: supplier.supplierId, companyId: { in: ids }, status: { in: ['APPROVED', 'DISABLED'] } },
        select: { id: true },
        take: 1,
      });
      if (links.length > 0) return true;
      throw new ForbiddenException({ error: '该数据不属于本公司，无权访问', code: 'COMPANY_SCOPE_FORBIDDEN' });
    }
  }
  return SupplierScopeGuard;
}

/** 供应商 :id 路由（详情/子资源读/写操作/审批） */
export const SupplierScopeGuard = makeSupplierScopeGuard(
  'id',
  async (prisma, id) => {
    const supplier = await prisma.supplier.findUnique({ where: { id }, select: { companyId: true } });
    return supplier ? { supplierId: id, companyId: supplier.companyId } : null;
  },
);

/** 变更审批 changes/:changeId/* ——先落 SupplierChangeRecord 再判供应商视野 */
export const SupplierChangeScopeGuard = makeSupplierScopeGuard(
  'changeId',
  async (prisma, id) => {
    const record = await prisma.supplierChangeRecord.findUnique({
      where: { id },
      select: { supplier: { select: { id: true, companyId: true } } },
    });
    return record?.supplier ? { supplierId: record.supplier.id, companyId: record.supplier.companyId } : null;
  },
);
