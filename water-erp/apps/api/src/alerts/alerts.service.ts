import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CompanyScopeService, scopeCompanyIds } from '../company/company-scope';
import type { AuthenticatedUser } from '../auth/auth.types';
import { supplierCompanyWhere } from '../supplier/supplier-company-filter';

@Injectable()
export class AlertsService {
  constructor(
    private prisma: PrismaService,
    private companyScope: CompanyScopeService,
  ) {}

  /** 仪表盘总览：临期资质数 + 过载专家数。
   *  口径收口（2026-10-28）：与供应商总览/资质预警同口径——临期资质=库内四态
   *  （APPROVED/DISABLED/BLACKLIST）+ 公司视野；过载专家按专家归属公司过滤
   *  （专家库 2026-09-24 已公司隔离，总览不得跨视野计数）。 */
  async overview(actor?: AuthenticatedUser) {
    const scope = actor ? await this.companyScope.resolveScope(actor) : null;
    const ids = scope ? scopeCompanyIds(scope) : null;
    const horizon = new Date(Date.now() + 90 * 86400000);
    const expiringQualifications = await this.prisma.supplierQualification.count({
      where: {
        validTo: { lte: horizon, gt: new Date() }, // 未过期但 90 天内
        supplier: { status: { in: ['APPROVED', 'DISABLED', 'BLACKLIST'] }, ...(scope ? supplierCompanyWhere(scope) : {}) },
      },
    });

    // 过载专家：同时参与 > 3 个未归档项目（内存聚合，避免 groupBy having 类型复杂度）
    const activeAssignments = await this.prisma.bidExpert.findMany({
      where: { project: { stage: { not: 'ARCHIVED' } }, ...(ids !== null ? { user: { companyId: { in: ids } } } : {}) },
      select: { userId: true },
    });
    const perExpert = new Map<string, number>();
    for (const a of activeAssignments) perExpert.set(a.userId, (perExpert.get(a.userId) ?? 0) + 1);
    const overloadedExperts = [...perExpert.values()].filter((c) => c > 3).length;

    return { expiringQualifications, overloadedExperts };
  }

  /** 某供应商的告警：临期资质（含已过期，附 daysLeft）。 */
  async supplierAlerts(supplierId: string) {
    const quals = await this.prisma.supplierQualification.findMany({
      where: { supplierId, validTo: { not: null } },
    });
    const now = Date.now();
    const expiringQualifications = quals
      .map((q) => ({
        id: q.id,
        name: q.name,
        type: q.type,
        validTo: q.validTo as Date,
        daysLeft: Math.ceil(((q.validTo as Date).getTime() - now) / 86400000),
      }))
      .filter((q) => q.daysLeft < 90); // 含已过期（负值）

    return { expiringQualifications };
  }

  /** 某专家的告警：过载 + 连续 D 级。 */
  async expertAlerts(expertUserId: string) {
    const activeProjectCount = await this.prisma.bidExpert.count({
      where: { userId: expertUserId, project: { stage: { not: 'ARCHIVED' } } },
    });
    const recentEvals = await this.prisma.expertEvaluation.findMany({
      where: { expertUserId },
      orderBy: { createdAt: 'desc' },
      take: 2,
    });
    const consecutiveE = recentEvals.length === 2 && recentEvals.every((e) => e.overallGrade === 'E');
    return { activeProjectCount, overloaded: activeProjectCount > 3, consecutiveE };
  }
}
