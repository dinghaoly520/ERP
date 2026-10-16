import { Prisma } from '@prisma/client';

/**
 * 供应商域公司过滤换形（2026-10-16）：把「全部公司 / 限定公司集」的口径收敛为单一
 * where 片段，供供应商库列表/统计等按公司隔离的查询复用。
 *
 * 口径：
 *  - all=true            → 不限（空 where 片段，天然融入其余过滤条件）；
 *  - 限定集（companyIds）→ APPROVED link 存在性（公司链接审批通过才算归属）；
 *  - NO_COMPANY 哨兵（'__no_company__'）→ IN 天然空集（link 不可能持有该 id），
 *    语义=「无归属供应商」，无需专用 NOT EXISTS 分支。
 */
export interface SupplierCompanyScope {
  /** true=全部公司（admin 视角，companyIds 可省）；false=按 companyIds 限定 */
  all: boolean;
  /** 限定公司 id 集；可含 NO_COMPANY 哨兵 */
  companyIds?: string[];
}

export function supplierCompanyWhere(scope: SupplierCompanyScope): Prisma.SupplierWhereInput {
  if (scope.all) return {};
  return {
    companyLinks: {
      some: {
        companyId: { in: scope.companyIds ?? [] },
        status: 'APPROVED',
      },
    },
  };
}
