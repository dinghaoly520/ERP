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
 * 规则（用户拍板 2026-08-20）：
 *  - admin：默认全部公司；?companyId=<id> 切换单公司；?companyId=all 显式全部；
 *  - 非 admin：强制本人公司，URL 传 companyId 参数一律忽略（防伪造）；
 *  - 未归属公司的账号：返回永假空集（绝不放行全部），提示管理员归位。
 */

export type CompanyScope =
  | { all: true } // admin·全部公司（默认视图）
  | { all: false; companyId: string }; // 限定单公司（含 '__no_company__' 永假哨兵）

/** 未归属账号的永假公司 id：任何真实数据都不可能等于它，得到空集 */
export const NO_COMPANY = '__no_company__';

@Injectable()
export class CompanyScopeService {
  constructor(private readonly prisma: PrismaService) {}

  /** 解析当前请求的公司视野 */
  async resolveScope(
    user: AuthenticatedUser | undefined,
    requestedCompanyId?: string,
  ): Promise<CompanyScope> {
    if (user?.role === 'admin') {
      if (requestedCompanyId && requestedCompanyId !== 'all') {
        const exists = await this.prisma.company.findUnique({
          where: { id: requestedCompanyId },
          select: { id: true },
        });
        if (exists) return { all: false, companyId: requestedCompanyId };
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
    return { all: false, companyId: me?.companyId ?? NO_COMPANY };
  }

  /** where 片段：all → {}；单公司 → { companyId }。直接展开进各 service 的 where */
  filter(scope: CompanyScope): { companyId?: string } {
    return scope.all ? {} : { companyId: scope.companyId };
  }

  /** 单条数据越权校验（:id 详情/写操作端点用） */
  assertInScope(itemCompanyId: string | null | undefined, scope: CompanyScope): void {
    if (scope.all) return;
    if (itemCompanyId !== scope.companyId) {
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
