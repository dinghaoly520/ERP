import { Prisma } from '@prisma/client';
import { CompanyScope, scopeCompanyIds } from '../company/company-scope';

/** 供应商域公司过滤（多公司归属 2026-10-16 spec）：APPROVED link 存在性替代单值 Supplier.companyId。
 *  CompanyScopeService.filter 不动（服务专家库/公告/项目等域）；raw SQL 翻译件在
 *  supplier.service.ts listByCompleteness——改本函数形状必须同步改翻译件并 grep 校验（tsc 不保护）。 */
export function supplierCompanyWhere(scope: CompanyScope): Prisma.SupplierWhereInput {
  const ids = scopeCompanyIds(scope);
  if (ids === null) return {};
  return { companyLinks: { some: { companyId: { in: ids }, status: 'APPROVED' } } };
}
