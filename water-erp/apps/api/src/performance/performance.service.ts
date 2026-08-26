import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { Document, Packer } from 'docx';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { htmlToDocxChildren } from '../project-management/docx/html-to-docx.converter';
import { createHash } from 'crypto';

/**
 * E1（GB/T 43711 第 9 章）：采购质效评价。
 * 9.3 评价内容覆盖交易组织实施/过程与结果/技术功能；9.4 方法含统计分析/文档检查/满意度评价；
 * 9.5 依评价结果制定纠正预防措施。数据全部来自既有库表，不另建采集通道。
 */
@Injectable()
export class PerformanceService {
  private readonly logger = new Logger(PerformanceService.name);

  constructor(
    private prisma: PrismaService,
    private storage: StorageService,
  ) {}

  /** 三维权重（SystemConfig eval_weight_quality/efficiency/compliance，默认 40/30/30） */
  private async weights() {
    const keys = ['eval_weight_quality', 'eval_weight_efficiency', 'eval_weight_compliance'];
    const rows = await this.prisma.systemConfig.findMany({ where: { key: { in: keys } } });
    const map = new Map(rows.map(r => [r.key, Number(r.value)]));
    const w = {
      quality: map.get('eval_weight_quality') ?? 40,
      efficiency: map.get('eval_weight_efficiency') ?? 30,
      compliance: map.get('eval_weight_compliance') ?? 30,
    };
    const total = w.quality + w.efficiency + w.compliance;
    return total > 0 ? w : { quality: 40, efficiency: 30, compliance: 30 };
  }

  /**
   * 9.4 统计分析：五项质效指标（数据全部已有）。
   *  - 采购周期：立项（PMI createdAt）→ 合同签署（Contract signedAt）均值天数
   *  - 节资率：1 - 成交合同额合计/预算合计
   *  - 竞争充分性：项目均有效供应商数（已确认参评家数）
   *  - 异议率：异议工单数/项目数
   *  - 履约达标率：已验收合同/已签署合同
   */
  async metrics(params: { from?: string; to?: string }) {
    const from = params.from ? new Date(params.from) : new Date(Date.now() - 365 * 86400000);
    const to = params.to ? new Date(params.to) : new Date();

    const [pmis, contracts, objections, bidSuppliers, satisfactions] = await Promise.all([
      this.prisma.projectManagementItem.findMany({
        where: { createdAt: { gte: from, lte: to }, status: { not: 'RECYCLED' } },
        select: { id: true, projectCode: true, budgetAmount: true, createdAt: true },
      }),
      this.prisma.contract.findMany({
        where: { createdAt: { gte: from, lte: to } },
        select: { projectCode: true, projectManagementItemId: true, amount: true, signedAt: true, status: true, createdAt: true },
      }),
      this.prisma.supplierObjection.count({ where: { createdAt: { gte: from, lte: to } } }),
      this.prisma.bidSupplier.findMany({
        where: { createdAt: { gte: from, lte: to }, confirmStatus: 'CONFIRMED' },
        select: { projectId: true },
      }),
      this.prisma.satisfactionFeedback.findMany({
        where: { createdAt: { gte: from, lte: to } },
        select: { score: true },
      }),
    ]);

    // 采购周期：PMI→其合同签署
    const pmiById = new Map(pmis.map(m => [m.id, m]));
    let cycleSum = 0, cycleN = 0;
    for (const c of contracts) {
      if (!c.signedAt) continue;
      const pm = c.projectManagementItemId ? pmiById.get(c.projectManagementItemId) : null;
      if (!pm) continue;
      const days = (c.signedAt.getTime() - pm.createdAt.getTime()) / 86400000;
      if (days >= 0 && days < 3650) { cycleSum += days; cycleN++; }
    }

    // 节资率：有预算 PMI 的合同（按 PMI 预算比对）
    let budgetSum = 0, amountSum = 0;
    for (const c of contracts) {
      if (c.amount == null || !c.projectManagementItemId) continue;
      const pm = pmiById.get(c.projectManagementItemId);
      if (!pm || pm.budgetAmount == null || Number(pm.budgetAmount) <= 0) continue;
      budgetSum += Number(pm.budgetAmount);
      amountSum += Number(c.amount);
    }

    const signedCount = contracts.filter(c => c.signedAt).length;
    const acceptedCount = contracts.filter(c => ['accepted'].includes(c.status)).length;

    // 满意度均分（9.2 交易和服务对象评价）
    const satAvg = satisfactions.length > 0
      ? satisfactions.reduce((s, x) => s + x.score, 0) / satisfactions.length
      : null;

    return {
      period: { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) },
      projectCount: pmis.length,
      contractCount: contracts.length,
      avgCycleDays: cycleN > 0 ? Math.round(cycleSum / cycleN) : null,
      savingsRate: budgetSum > 0 ? Math.round((1 - amountSum / budgetSum) * 1000) / 10 : null,
      competitionAvg: pmis.length > 0 ? Math.round((bidSuppliers.length / Math.max(pmis.length, 1)) * 10) / 10 : null,
      objectionRate: pmis.length > 0 ? Math.round((objections / pmis.length) * 1000) / 10 : null,
      acceptanceRate: signedCount > 0 ? Math.round((acceptedCount / signedCount) * 1000) / 10 : null,
      satisfactionAvg: satAvg != null ? Math.round(satAvg * 10) / 10 : null,
    };
  }

  /** 9.1 评分卡：质量/效率/合规三维 + 服务端加权 */
  async createEvaluation(dto: {
    projectManagementItemId?: string; projectId?: string; projectCode: string; projectName: string;
    qualityScore: number; efficiencyScore: number; complianceScore: number; period?: string; comment?: string;
  }, operator: { userId: string; username: string }) {
    for (const k of ['qualityScore', 'efficiencyScore', 'complianceScore'] as const) {
      const v = dto[k];
      if (v == null || v < 0 || v > 100) throw new BadRequestException({ error: '评分须 0-100', code: 'BAD_SCORE' });
    }
    const w = await this.weights();
    const weighted = Math.round(
      (dto.qualityScore * w.quality + dto.efficiencyScore * w.efficiency + dto.complianceScore * w.compliance)
      / (w.quality + w.efficiency + w.compliance),
    );
    return this.prisma.projectEvaluation.create({
      data: {
        projectManagementItemId: dto.projectManagementItemId ?? null,
        projectId: dto.projectId ?? null,
        projectCode: dto.projectCode,
        projectName: dto.projectName,
        evaluatorId: operator.userId,
        evaluatorName: operator.username,
        qualityScore: Math.round(dto.qualityScore),
        efficiencyScore: Math.round(dto.efficiencyScore),
        complianceScore: Math.round(dto.complianceScore),
        weightedScore: weighted,
        period: dto.period?.trim() || null,
        comment: dto.comment?.trim() || null,
      },
    });
  }

  listEvaluations(params: { projectCode?: string }) {
    return this.prisma.projectEvaluation.findMany({
      where: params.projectCode ? { projectCode: params.projectCode } : {},
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  /** 9.2 供应商满意度简表（1-5 分，每供应商每项目一次） */
  async submitSatisfaction(supplier: { id: string; name: string }, dto: { projectCode: string; score: number; comment?: string }) {
    if (!dto.projectCode?.trim()) throw new BadRequestException({ error: '缺少项目编号', code: 'BAD_PARAMS' });
    if (!Number.isInteger(dto.score) || dto.score < 1 || dto.score > 5) {
      throw new BadRequestException({ error: '评分须 1-5', code: 'BAD_SCORE' });
    }
    return this.prisma.satisfactionFeedback.upsert({
      where: { supplierId_projectCode: { supplierId: supplier.id, projectCode: dto.projectCode.trim() } },
      update: { score: dto.score, comment: dto.comment?.trim() || null },
      create: {
        supplierId: supplier.id, supplierName: supplier.name,
        projectCode: dto.projectCode.trim(), score: dto.score, comment: dto.comment?.trim() || null,
      },
    });
  }

  listSatisfactions(params: { projectCode?: string }) {
    return this.prisma.satisfactionFeedback.findMany({
      where: params.projectCode ? { projectCode: params.projectCode } : {},
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  /** 9.1/9.4：周期性质效报告 DOCX（指标 + 评分汇总 + 满意度） */
  async generateReport(periodLabel?: string) {
    const m = await this.metrics({});
    const w = await this.weights();
    const evals = await this.prisma.projectEvaluation.findMany({ orderBy: { createdAt: 'desc' }, take: 200 });
    const avg = (xs: number[]) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null);

    const html = [
      `<h2>采购质效评价报告${periodLabel ? `（${periodLabel}）` : ''}</h2>`,
      `<p>依据 GB/T 43711—2024 第 9 章编制；统计区间 ${m.period.from} 至 ${m.period.to}。</p>`,
      `<h3>一、统计指标（9.4 统计分析）</h3>`,
      `<p>项目数 ${m.projectCount}；合同数 ${m.contractCount}；平均采购周期 ${m.avgCycleDays ?? '—'} 天；节资率 ${m.savingsRate ?? '—'}%；项目均有效供应商 ${m.competitionAvg ?? '—'} 家；异议率 ${m.objectionRate ?? '—'}%；履约达标率 ${m.acceptanceRate ?? '—'}%；供应商满意度 ${m.satisfactionAvg ?? '—'} 分。</p>`,
      `<h3>二、评价汇总（评分卡 ${evals.length} 份，权重 质量${w.quality}/效率${w.efficiency}/合规${w.compliance}）</h3>`,
      `<p>质量均分 ${avg(evals.map(e => e.qualityScore)) ?? '—'}；效率均分 ${avg(evals.map(e => e.efficiencyScore)) ?? '—'}；合规均分 ${avg(evals.map(e => e.complianceScore)) ?? '—'}；加权总分均值 ${avg(evals.map(e => e.weightedScore)) ?? '—'}。</p>`,
      ...(evals.slice(0, 30).map(e =>
        `<p>${e.projectCode}（${e.projectName}）：质量 ${e.qualityScore}/效率 ${e.efficiencyScore}/合规 ${e.complianceScore} → 加权 ${e.weightedScore}${e.comment ? `；评语：${e.comment}` : ''}。</p>`)),
      `<h3>三、纠正与预防（9.5）</h3>`,
      `<p>对低于 70 分的维度应制定纠正/预防措施并跟踪落实；对满意度与竞争充分性异常项目应复查采购组织与文件编制质量。</p>`,
    ].join('');

    const doc = new Document({ sections: [{ properties: {}, children: htmlToDocxChildren(html) }] });
    const buffer = Buffer.from(await Packer.toBuffer(doc));
    const objectKey = `performance/report-${Date.now()}.docx`;
    await this.storage.upload(objectKey, buffer, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    const asset = await this.prisma.fileAsset.create({
      data: {
        key: objectKey,
        originalName: `采购质效评价报告${periodLabel ? `-${periodLabel}` : ''}.docx`,
        mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        size: buffer.length,
        sha256: createHash('sha256').update(buffer).digest('hex'),
        category: 'performance_report',
      },
    });
    return { fileAssetId: asset.id, objectKey, size: buffer.length, metrics: m };
  }
}
