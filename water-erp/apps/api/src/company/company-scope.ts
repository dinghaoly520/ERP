import { Injectable, ForbiddenException, Global, Module } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import { CompanyController } from './company.controller';

/**
 * 公司级数据隔离引擎（2026-08-20 方案 docs/superpowers/specs/2026-08-20-company-data-isolation-design.md）
 *
 * 「真隔离」三层落点：
 *  1. 查询层 —— filter() 生成的 where 片段由各 service 注入 Prisma 查询，数据不离开数据库；
 *  2. API 层 —— assertInScope() 用于 :id 端点，直调也无法越权读取他人公司数据；
 *  3. 统计层 —— 所有聚合在隔离后的 where 上计算，不是全量算完再减。
 *
 * 规则（用户拍板 2026-08-20；2026-10-14 多选扩展）：
 *  - admin：默认全部公司；?companyId=<id> 切换单公司；?companyId=all 显式全部；
 *    ?companyId=a,b,c 逗号多选（跨子公司统计，单元素等价单选）——逐 id 校验存在，
 *    全部无效回退全部；部分无效取有效集；
 *  - 非 admin：强制本人公司，URL 传 companyId 参数一律忽略（防伪造）；
 *  - 未归属公司的账号：返回永假空集（绝不放行全部），提示管理员归位。
 */

export type CompanyScope =
  | { all: true } // admin·全部公司（默认视图）
  | { all: false; companyIds: string[] }; // 限定公司集（单选=长度 1；含 '__no_company__' 永假哨兵）

/** 未归属账号的永假公司 id：任何真实数据都不可能等于它，得到空集 */
export const NO_COMPANY = '__no_company__';

/** scope → 公司 id 列表（all = null 表示不限）；直读 scope.companyIds 的统一出口 */
export function scopeCompanyIds(scope: CompanyScope): string[] | null {
  return scope.all ? null : scope.companyIds;
}

/** filter() 返回的 where 片段类型——各 service 接收端签名直接引用，勿手写窄化为 string */
export type CompanyWhere = { companyId?: string | { in: string[] } };

@Injectable()
export class CompanyScopeService {
  constructor(private readonly prisma: PrismaService) {}

  /** 解析当前请求的公司视野（admin 支持 ?companyId= 逗号多选） */
  async resolveScope(
    user: AuthenticatedUser | undefined,
    requestedCompanyId?: string,
  ): Promise<CompanyScope> {
    if (user?.role === 'admin') {
      const requested = (requestedCompanyId ?? '')
        .split(',')
        .map((id) => id.trim())
        .filter((id) => id && id !== 'all');
      if (requested.length > 0) {
        const uniq = [...new Set(requested)];
        const rows = await this.prisma.company.findMany({
          where: { id: { in: uniq } },
          select: { id: true },
        });
        if (rows.length > 0) {
          // 保持请求顺序（分组展示顺序稳定）；部分无效取有效集
          const valid = new Set(rows.map((r) => r.id));
          return { all: false, companyIds: uniq.filter((id) => valid.has(id)) };
        }
      }
      return { all: true };
    }

    // 非 admin：强制本人公司；传参忽略（防伪造）
    const me = user?.sub
      ? await this.prisma.user.findUnique({
          where: { id: user.sub },
          select: { companyId: true },
        })
      : null;
    return { all: false, companyIds: [me?.companyId ?? NO_COMPANY] };
  }

  /** where 片段：all → {}；限定集 → { companyId: { in } }（单选同 in，Prisma 等价） */
  filter(scope: CompanyScope): CompanyWhere {
    if (scope.all) return {};
    return { companyId: { in: scope.companyIds } };
  }

  /** 单条数据越权校验（:id 详情/写操作端点用）：限定集内放行 */
  assertInScope(itemCompanyId: string | null | undefined, scope: CompanyScope): void {
    if (scope.all) return;
    if (itemCompanyId == null || !scope.companyIds.includes(itemCompanyId)) {
      throw new ForbiddenException({
        error: '该数据不属于本公司，无权访问',
        code: 'COMPANY_SCOPE_FORBIDDEN',
      });
    }
  }

  /** 创建业务数据时的公司归属（写时快照）：取登录人 companyId + company 文本 */
  async stampFor(user: AuthenticatedUser | undefined): Promise<{
    companyId?: string;
    companyName?: string;
  }> {
    if (!user?.sub) return {};
    const me = await this.prisma.user.findUnique({
      where: { id: user.sub },
      select: { companyId: true, company: true },
    });
    if (!me?.companyId) return {};
    return { companyId: me.companyId, companyName: me.company ?? undefined };
  }
}

@Global()
@Module({
  controllers: [CompanyController],
  providers: [CompanyScopeService],
  exports: [CompanyScopeService],
})
export class CompanyScopeModule {}
