import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class BigscreenService {
  private readonly logger = new Logger(BigscreenService.name);

  constructor(private readonly prisma: PrismaService) {}

  async getStats() {
    const [
      // --- 概览统计 ---
      procurementTotal,
      procurementActive,
      bidTotal,
      bidActive,
      bidOpening,
      supplierTotal,
      supplierApproved,
      supplierPending,
      supplierDisabled,
      expertTotal,
      expertAvailable,
      announcementPublished,
      catalogTotal,
      bidArchived,

      // --- 供应商等级分布 ---
      supplierEvals,
      supplierClassifications,

      // --- 专家专业分布 ---
      expertSpecialties,

      // --- 采购方式分布 ---
      procurementMethods,

      // --- 招标阶段分布 ---
      bidStages,

      // --- 公告类型 ---
      announcementTypes,

      // --- 采购项目月度趋势 (近12月) ---
      procurementMonthly,
    ] = await Promise.all([
      this.prisma.procurementProject.count(),
      this.prisma.procurementProject.count({
        where: { status: { in: ['PENDING_REVIEW', 'APPROVED', 'BIDDING'] } },
      }),
      this.prisma.bidProject.count(),
      this.prisma.bidProject.count({
        where: { stage: { in: ['OPENING', 'EVALUATING'] } },
      }),
      this.prisma.bidProject.count({ where: { stage: 'OPENING' } }),
      this.prisma.supplier.count(),
      this.prisma.supplier.count({ where: { status: 'APPROVED' } }),
      this.prisma.supplier.count({ where: { status: 'PENDING' } }),
      this.prisma.supplier.count({ where: { status: { in: ['DISABLED', 'BLACKLIST'] } } }),
      this.prisma.expertProfile.count(),
      this.prisma.expertProfile.count({ where: { availability: '可用' } }),
      this.prisma.announcement.count({ where: { status: 'PUBLISHED' } }),
      this.prisma.catalogItem.count(),
      this.prisma.bidProject.count({ where: { stage: 'ARCHIVED' } }),

      // --- 供应商等级 ---
      this.prisma.supplierEvaluation.findMany({
        select: { level: true, overallScore: true },
      }),

      // --- 供应商分类 ---
      this.prisma.supplierClassification.findMany({
        select: { id: true, name: true, _count: { select: { suppliers: true } } },
        orderBy: { suppliers: { _count: 'desc' } },
        take: 10,
      }),

      // --- 专家专业分布 ---
      this.prisma.expertProfile.groupBy({
        by: ['specialty'],
        _count: { id: true },
        orderBy: { _count: { id: 'desc' } },
        take: 10,
      }),

      // --- 采购项目状态分布 ---
      this.prisma.procurementProject.groupBy({
        by: ['status'],
        _count: { id: true },
      }),

      // --- 招标阶段 ---
      this.prisma.bidProject.groupBy({
        by: ['stage'],
        _count: { id: true },
      }),

      // --- 公告类型 ---
      this.prisma.announcement.groupBy({
        by: ['type'],
        _count: { id: true },
        where: { status: 'PUBLISHED' },
      }),

      // --- 月度趋势 ---
      this.getMonthlyTrend(),
    ]);

    // --- 加工返回数据 ---

    // 供应商等级统计
    const levelCounts = { A: 0, B: 0, C: 0, D: 0 };
    let scoreSum = 0;
    for (const e of supplierEvals) {
      const key = e.level as 'A' | 'B' | 'C' | 'D';
      if (key in levelCounts) levelCounts[key]++;
      scoreSum += Number(e.overallScore);
    }
    const evalTotal = supplierEvals.length;
    const avgScore = evalTotal > 0 ? Math.round((scoreSum / evalTotal) * 10) / 10 : 0;

    // 供应商等级趋势
    let trend: 'improving' | 'stable' | 'declining' = 'stable';
    if (evalTotal >= 2) {
      const half = Math.ceil(evalTotal / 2);
      const firstHalf = supplierEvals.slice(0, half);
      const secondHalf = supplierEvals.slice(-half);
      const firstAvg =
        firstHalf.reduce((s, e) => s + Number(e.overallScore), 0) / firstHalf.length;
      const secondAvg =
        secondHalf.reduce((s, e) => s + Number(e.overallScore), 0) / secondHalf.length;
      if (secondAvg > firstAvg + 3) trend = 'improving';
      else if (secondAvg < firstAvg - 3) trend = 'declining';
    }

    const supplierCats = supplierClassifications.map((c) => ({
      name: c.name,
      count: c._count.suppliers,
    }));

    // 专家专业
    const expertSpecList = expertSpecialties.map((s) => ({
      name: s.specialty,
      count: s._count.id,
    }));

    // 采购状态映射
    const STATUS_LABEL: Record<string, string> = {
      DRAFT: '草稿',
      PENDING_REVIEW: '待审核',
      APPROVED: '已通过',
      REJECTED: '已驳回',
      BIDDING: '招标中',
      CONTRACTED: '已签约',
      CLOSED: '已关闭',
    };

    const procurementStatuses = procurementMethods.map((m) => ({
      status: STATUS_LABEL[m.status] || m.status,
      count: m._count.id,
    }));

    // 招标阶段映射
    const STAGE_LABEL: Record<string, string> = {
      DOWNLOAD: '下载标书',
      SUBMIT: '投标',
      OPENING: '开标',
      EVALUATING: '评标',
      ARCHIVED: '归档',
    };

    const bidStagesList = bidStages.map((s) => ({
      stage: STAGE_LABEL[s.stage] || s.stage,
      count: s._count.id,
    }));

    // 公告类型映射
    const TYPE_LABEL: Record<string, string> = {
      BID_NOTICE: '招标公告',
      WINNER_NOTICE: '中标公示',
      POLICY: '政策法规',
      PLATFORM_NOTICE: '平台通知',
    };

    const announcementTypeList = announcementTypes.map((a) => ({
      type: TYPE_LABEL[a.type] || a.type,
      count: a._count.id,
    }));

    // 可用率
    const availRate =
      expertTotal > 0 ? Math.round((expertAvailable / expertTotal) * 100) : 0;

    return {
      overview: {
        procurementTotal,
        procurementActive,
        bidTotal,
        bidActive,
        bidOpening,
        supplierTotal,
        supplierApproved,
        supplierPending,
        supplierDisabled,
        expertTotal,
        expertAvailable,
        availRate,
        announcementPublished,
        catalogTotal,
        bidArchived,
      },
      supplier: {
        levelCounts,
        avgScore,
        evalTotal,
        trend,
        cats: supplierCats,
      },
      expert: {
        specialties: expertSpecList,
      },
      procurement: {
        statuses: procurementStatuses,
        monthly: procurementMonthly,
      },
      bid: {
        stages: bidStagesList,
      },
      announcement: {
        publishedByType: announcementTypeList,
      },
    };
  }

  private async getMonthlyTrend(): Promise<
    Array<{ month: string; budget: number; contract: number }>
  > {
    // 近 12 个月的采购项目预算和合同汇总
    // 聚合 ProcurementProject 表中按创建月份分组的预算和合同金额
    const now = new Date();
    const months: Array<{ month: string; budget: number; contract: number }> = [];

    for (let i = 11; i >= 0; i--) {
      const start = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const end = new Date(now.getFullYear(), now.getMonth() - i + 1, 0, 23, 59, 59);
      const monthLabel = `${start.getMonth() + 1}月`;

      const projects = await this.prisma.procurementProject.findMany({
        where: { createdAt: { gte: start, lte: end } },
        select: { budget: true },
      });

      const budget = projects.reduce((sum, p) => sum + (Number(p.budget) || 0), 0);
      const contract = 0;

      months.push({ month: monthLabel, budget, contract });
    }

    return months;
  }
}
