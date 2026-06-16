import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AlertsService {
  constructor(private prisma: PrismaService) {}

  /** 仪表盘总览：临期资质数 + 过载专家数。 */
  async overview() {
    const horizon = new Date(Date.now() + 90 * 86400000);
    const expiringQualifications = await this.prisma.supplierQualification.count({
      where: {
        validTo: { lte: horizon, gt: new Date() }, // 未过期但 90 天内
        supplier: { status: 'APPROVED' },
      },
    });

    // 过载专家：同时参与 > 3 个未归档项目（内存聚合，避免 groupBy having 类型复杂度）
    const activeAssignments = await this.prisma.bidExpert.findMany({
      where: { project: { stage: { not: 'ARCHIVED' } } },
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
    const consecutiveD = recentEvals.length === 2 && recentEvals.every((e) => e.level === 'D');
    return { activeProjectCount, overloaded: activeProjectCount > 3, consecutiveD };
  }
}
