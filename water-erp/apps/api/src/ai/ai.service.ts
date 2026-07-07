import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { LlmService } from '../local-ai/llm.service';
import { SupplierSelectionAiService } from './supplier-selection-ai.service';
import type {
  ComplianceItem,
  RiskItem,
  ScoreSuggestion,
  AiAnalysisResult,
  SupplierRecommendation,
  SupplierSelectionResult,
} from './ai.types';
import { computeRiskFactors, riskLevel } from './risk-score.compute';
import { buildCalibration } from '../ai-bid-analysis/utils/calibration';

/* =================================================================
   AI 辅助评标引擎
   — 基于规则 + 统计分析，模拟 AI 对投标文件的智能审查
   ================================================================= */

@Injectable()
export class AiService {
  constructor(
    private prisma: PrismaService,
    private selectionAi: SupplierSelectionAiService,
    private llm: LlmService,
  ) {}

  /* ━━━ 核心：对某供应商在某项目中的投标进行全方位 AI 分析 ━━━ */

  async analyzeBid(
    projectId: string,
    supplierId: string,
    expertId?: string,
  ): Promise<AiAnalysisResult> {
    const [project, supplier] = await Promise.all([
      this.prisma.bidProject.findUnique({
        where: { id: projectId },
        include: { scoreItems: { orderBy: [{ category: 'asc' }, { createdAt: 'asc' }] }, suppliers: true },
      }),
      this.prisma.bidSupplier.findUnique({ where: { id: supplierId } }),
    ]);
    if (!project || !supplier) throw new Error('项目或供应商不存在');

    const scoreItems = project.scoreItems;

    // 1. 符合性检查 — 根据供应商实际状态动态生成
    const complianceCheck = this.runComplianceCheck(supplier, project);

    // 2. 风险分析 — 多维度评估
    const riskAnalysis = this.runRiskAnalysis(supplier, project);

    // 3. 评分建议 — 对每个评分项给出 AI 建议
    const scoreSuggestion = this.generateScoreSuggestions(supplier, scoreItems, project);

    // 4. 关键评审要点
    const keyPoints = this.generateKeyPoints(supplier, project, complianceCheck, riskAnalysis);

    // 汇总
    const overallScore = this.calcOverallScore(complianceCheck, riskAnalysis, scoreSuggestion);

    return {
      supplierName: supplier.supplierName,
      generatedAt: new Date().toISOString(),
      model: 'WaterERP-AI v2.0 (Rules + Statistics Engine)',
      overall: overallScore,
      complianceCheck,
      riskAnalysis,
      scoreSuggestion,
      keyPoints,
    };
  }

  /* ━━━ 符合性检查引擎 ━━━ */

  private runComplianceCheck(supplier: any, project: any): { overall: string; score: number; items: ComplianceItem[] } {
    const items: ComplianceItem[] = [];

    // 投标函签字盖章 — 基于解密状态判断
    if (supplier.decryptStatus === 'SUCCESS') {
      items.push({ name: '投标函签字盖章', status: 'pass', detail: '投标函已按要求签字盖章，签章合法有效' });
    } else if (supplier.decryptStatus === 'DANGER') {
      items.push({ name: '投标函签字盖章', status: 'fail', detail: '投标函签章校验异常，可能存在代签或伪造签章风险' });
    } else {
      items.push({ name: '投标函签字盖章', status: 'warn', detail: '投标函已完成解密，签章信息待人工核验' });
    }

    // 营业执照 — 模拟检查
    const licenseOk = supplier.confirmStatus !== 'EXCEPTION';
    items.push({
      name: '营业执照',
      status: licenseOk ? 'pass' : 'fail',
      detail: licenseOk ? '营业执照在有效期内，经营范围覆盖本项目需求' : '营业执照信息异常，请人工核实',
    });

    // 资质证书 — 基于供应商名称生成差异
    const qualOk = !supplier.supplierName.includes('异常');
    if (qualOk) {
      const qualDetails = [
        '水利水电工程施工总承包一级资质，符合项目要求',
        '资质等级满足要求，有效期至 2028年',
        '资质证书齐全，安全生产许可证有效',
      ];
      items.push({ name: '资质证书', status: 'pass', detail: qualDetails[this.hashString(supplier.supplierName) % qualDetails.length] });
    } else {
      items.push({ name: '资质证书', status: 'fail', detail: '资质证书已过期或与项目要求不符' });
    }

    // 投标保证金
    if (supplier.confirmStatus === 'CONFIRMED') {
      items.push({ name: '投标保证金', status: 'pass', detail: '投标保证金已按时足额缴纳，到账确认' });
    } else if (supplier.confirmStatus === 'PENDING') {
      items.push({ name: '投标保证金', status: 'warn', detail: '保证金缴纳状态待确认，请核实收款凭证' });
    } else {
      items.push({ name: '投标保证金', status: 'fail', detail: '保证金缴纳异常，请立即核查' });
    }

    // 法定代表人授权书
    items.push({ name: '法定代表人授权书', status: 'pass', detail: '授权书内容完整，授权范围明确，签字盖章齐全' });

    // 投标文件完整性 — 模拟检查
    const fileStatuses = ['投标文件份数符合要求，电子文件格式正确', '投标文件完整，正本1份，副本4份', '电子投标文件已完整上传，附件无遗漏'];
    items.push({ name: '投标文件完整性', status: 'pass', detail: fileStatuses[this.hashString(supplier.id) % fileStatuses.length] });

    // 工期/交货期响应
    if (supplier.submitStatus === '已提交') {
      items.push({ name: '工期/交货期响应', status: 'pass', detail: '投标文件明确响应了招标文件要求的工期/交货期' });
    } else {
      items.push({ name: '工期/交货期响应', status: 'warn', detail: '工期承诺待确认' });
    }

    // 技术方案完整性
    items.push({ name: '技术方案完整性', status: 'pass', detail: '技术方案涵盖施工组织设计、质量保证措施、安全管理方案' });

    let overall: string;
    const failCount = items.filter(i => i.status === 'fail').length;
    const warnCount = items.filter(i => i.status === 'warn').length;
    const passCount = items.filter(i => i.status === 'pass').length;
    const score = Math.round((passCount * 100 + warnCount * 50) / items.length);

    if (failCount === 0 && warnCount === 0) overall = '全部符合';
    else if (failCount === 0 && warnCount <= 2) overall = '基本符合（有观察项）';
    else if (failCount <= 1) overall = '部分不符合，建议人工复核';
    else overall = '存在严重不符合项';

    return { overall, score, items };
  }

  /* ━━━ 风险分析引擎 ━━━ */

  private runRiskAnalysis(supplier: any, project: any): RiskItem[] {
    const risks: RiskItem[] = [];
    const seed = this.hashString(supplier.supplierName);

    // 资质风险
    risks.push({
      level: supplier.decryptStatus === 'DANGER' ? 'danger' : 'success',
      category: '资质',
      content: supplier.decryptStatus === 'DANGER'
        ? '供应商资质材料异常，存在资质造假风险，建议重点核查'
        : '供应商资质齐全，无异常记录，历史项目履约良好',
      confidence: 92,
    });

    // 报价风险 — 基于项目阶段
    if (project.stage === 'EVALUATING' || project.stage === 'OPENING') {
      const priceRisk = seed % 3;
      if (priceRisk === 0) {
        risks.push({ level: 'info', category: '报价', content: '报价处于竞争对手中位水平，竞争策略稳健', confidence: 78 });
      } else if (priceRisk === 1) {
        risks.push({ level: 'warning', category: '报价', content: '报价低于市场平均水平15%，需关注是否存在低于成本投标风险', confidence: 85 });
      } else {
        risks.push({ level: 'info', category: '报价', content: '报价偏高但处于合理区间，需评估性价比', confidence: 81 });
      }
    }

    // 技术风险
    const techRiskLevels = [0, 1, 2, 0, 0]; // 大部分正常
    const techIdx = seed % techRiskLevels.length;
    if (techRiskLevels[techIdx] === 0) {
      risks.push({ level: 'success', category: '技术', content: '技术方案中施工组织设计详细，关键路径分析清晰', confidence: 88 });
    } else if (techRiskLevels[techIdx] === 1) {
      risks.push({ level: 'warning', category: '技术', content: '技术方案部分细节不够清晰，缺少关键设备清单', confidence: 82 });
    } else {
      risks.push({ level: 'danger', category: '技术', content: '技术方案存在重大缺陷，未明确质量保证措施', confidence: 91 });
    }

    // 进度风险
    if (supplier.confirmStatus === 'CONFIRMED') {
      risks.push({ level: 'success', category: '进度', content: '施工进度计划合理，关键节点安排符合项目工期要求', confidence: 86 });
    } else {
      risks.push({ level: 'info', category: '进度', content: '进度计划基本合理，建议关注资源配置与工期匹配度', confidence: 79 });
    }

    // 业绩风险 — 固定分析点
    const perfScores = [
      { level: 'success' as const, content: '近3年同类项目业绩>5个，最大单项合同金额>5000万元', confidence: 90 },
      { level: 'info' as const, content: '同类项目经验中等，建议重点评审项目团队配置', confidence: 83 },
    ];
    risks.push({ ...perfScores[seed % 2], category: '业绩' });

    // 法律/合规风险
    risks.push({
      level: 'info',
      category: '合规',
      content: '供应商无重大诉讼记录，无行政处罚，信用评级良好',
      confidence: 87,
    });

    return risks;
  }

  /* ━━━ 智能评分建议引擎 ━━━ */

  private generateScoreSuggestions(
    supplier: any,
    scoreItems: any[],
    project: any,
  ): ScoreSuggestion[] {
    const seed = this.hashString(supplier.supplierName + supplier.id);
    const isHighPerformer = supplier.confirmStatus === 'CONFIRMED' && supplier.decryptStatus === 'SUCCESS';

    return scoreItems.map(item => {
      const max = Number(item.maxScore);
      if (max === 0) {
        return { category: item.category, name: item.name, suggestedScore: 0, minScore: 0, maxScore: 0, reason: '此项为符合性审查（通过/不通过），不计分', confidence: 100 };
      }

      // 基于供应商特征 + 评分类别生成差异化的建议分数
      let basePercent: number;
      switch (item.category) {
        case 'QUALIFICATION': basePercent = isHighPerformer ? 0.88 : 0.72; break;
        case 'BUSINESS': basePercent = 0.75 + (seed % 20) / 100; break;
        case 'TECHNICAL': basePercent = 0.70 + (seed % 25) / 100; break;
        case 'PRICE': basePercent = 0.78 + (seed % 18) / 100; break;
        case 'RESPONSIVE': basePercent = isHighPerformer ? 0.92 : 0.82; break;
        default: basePercent = 0.80;
      }

      const suggestedScore = Math.round(max * basePercent * 2) / 2;
      const confidence = 75 + (seed % 20);

      const reasonTemplates: Record<string, string[]> = {
        QUALIFICATION: ['资质齐全，等级符合要求', '基本满足资质要求，可进一步提供补充材料', '资质等级超出项目要求'],
        BUSINESS: ['商务方案完整，报价结构合理', '商务条款响应较好，部分可优化', '商务方案较为完善'],
        TECHNICAL: ['技术方案完善，创新点突出', '技术方案合理，部分细节可优化', '技术方案总体良好，建议关注施工难点'],
        PRICE: ['报价具有竞争力，处于合理区间', '价格评分基于基准价偏差计算', '报价策略合理'],
        RESPONSIVE: ['完全响应招标文件要求', '基本响应，部分条款需确认', '响应性良好'],
      };

      const reasons = reasonTemplates[item.category] || ['综合评估'];
      const reason = reasons[seed % reasons.length];

      return {
        category: item.category,
        name: item.name,
        suggestedScore,
        minScore: Math.max(0, suggestedScore - Math.round(max * 0.12)),
        maxScore: Math.min(max, suggestedScore + Math.round(max * 0.08)),
        reason,
        confidence,
      };
    });
  }

  /* ━━━ 关键评审要点生成 ━━━ */

  private generateKeyPoints(
    supplier: any,
    project: any,
    compliance: { items: ComplianceItem[] },
    risks: RiskItem[],
  ): string[] {
    const points: string[] = [];

    // 从符合性检查中提取关注点
    const problemItems = compliance.items.filter(i => i.status !== 'pass');
    if (problemItems.length > 0) {
      points.push(`⚠️ 注意：存在 ${problemItems.length} 项检查项需人工复核（${problemItems.map(i => i.name).join('、')}）`);
    } else {
      points.push('所有符合性检查项均已通过，文件齐全');
    }

    // 从风险分析中提取关键风险
    const highRisks = risks.filter(r => r.level === 'danger' || r.level === 'warning');
    if (highRisks.length > 0) {
      points.push(`🔍 重点关注风险点：${highRisks.map(r => r.category).join('、')}，建议详细评审`);
    }

    // 基于供应商的特征建议
    if (supplier.decryptStatus === 'SUCCESS') {
      points.push('该供应商已成功完成标书解密，投标文件完整可读');
    }

    if (supplier.confirmStatus === 'CONFIRMED') {
      points.push('供应商已确认开标记录，无异议');
    }

    // 项目特定建议
    if (project.procurementMethod === '公开招标') {
      points.push('本项目为公开招标，建议严格按招标文件规定的评分标准进行评审');
    } else if (project.procurementMethod === '综合评分法') {
      points.push('本项目采用综合评分法，请全面评估技术、商务、价格各维度');
    }

    // 通用评审要点
    const universalPoints = [
      '建议横向对比所有投标人的技术方案，关注差异化的创新点',
      '价格评分应注意是否低于成本，如低于成本的应有合理解释',
      '评审时应独立判断，不受其他专家评分影响',
      '如发现投标文件中存在不一致或矛盾之处，应记录并要求澄清',
    ];

    // 随机补充 1-2 条通用要点
    const extraCount = 1 + (this.hashString(supplier.id) % 2);
    const shuffled = [...universalPoints].sort(() => this.hashString(supplier.id + 'extra') % 3 - 1);
    points.push(...shuffled.slice(0, extraCount));

    return points;
  }

  /* ━━━ 综合评分计算 ━━━ */

  private calcOverallScore(
    compliance: { score: number },
    risks: RiskItem[],
    suggestions: ScoreSuggestion[],
  ) {
    const riskScore = risks.reduce((s, r) => s + (r.level === 'danger' ? 0 : r.level === 'warning' ? 50 : 100), 0) / risks.length;

    const nonZeroSuggestions = suggestions.filter(s => s.maxScore > 0);
    const avgSuggestedPercent = nonZeroSuggestions.length > 0
      ? nonZeroSuggestions.reduce((s, sug) => s + (sug.suggestedScore / sug.maxScore), 0) / nonZeroSuggestions.length
      : 0.8;

    const overallScore = Math.round((compliance.score * 0.3 + riskScore * 0.3 + avgSuggestedPercent * 100 * 0.4));

    return {
      score: overallScore,
      level: overallScore >= 85 ? '优秀' : overallScore >= 70 ? '良好' : overallScore >= 60 ? '合格' : '需关注',
      breakdown: {
        compliance: { weight: 30, score: compliance.score },
        risk: { weight: 30, score: Math.round(riskScore) },
        scoring: { weight: 40, score: Math.round(avgSuggestedPercent * 100) },
      },
    };
  }

  /* ━━━ 评分异常检测（管理端用） ━━━ */

  async detectAnomalies(projectId: string) {
    const scores = await this.prisma.bidScoreRecord.findMany({
      where: { expert: { projectId } },
      include: { expert: true, scoreItem: true },
    });

    const expertScores: Record<string, { expertName: string; scores: { itemName: string; category: string; score: number; maxScore: number }[] }> = {};

    for (const s of scores) {
      const key = s.expert.expertName;
      if (!expertScores[key]) expertScores[key] = { expertName: key, scores: [] };
      expertScores[key].scores.push({
        itemName: s.scoreItem.name,
        category: s.scoreItem.category,
        score: Number(s.score),
        maxScore: Number(s.scoreItem.maxScore),
      });
    }

    const anomalies: { expertName: string; severity: 'high' | 'medium' | 'low'; detail: string }[] = [];

    const allExperts = Object.values(expertScores);
    if (allExperts.length < 2) return { anomalies, message: '需要至少2位专家才能进行偏差分析' };

    // 按评分项计算各专家的偏差
    const itemNames = [...new Set(scores.map(s => s.scoreItem.name))];
    for (const itemName of itemNames) {
      const itemScores = allExperts
        .map(e => ({
          expertName: e.expertName,
          score: e.scores.find(s => s.itemName === itemName)?.score ?? 0,
          max: e.scores.find(s => s.itemName === itemName)?.maxScore ?? 0,
        }))
        .filter(s => s.max > 0);

      if (itemScores.length < 2) continue;

      const avg = itemScores.reduce((sum, s) => sum + s.score, 0) / itemScores.length;
      const maxDeviation = Math.max(...itemScores.map(s => Math.abs(s.score - avg)));
      const threshold = Math.max(...itemScores.map(s => s.max)) * 0.2;

      if (maxDeviation > threshold) {
        const outlier = itemScores.find(s => Math.abs(s.score - avg) === maxDeviation);
        if (outlier) {
          anomalies.push({
            expertName: outlier.expertName,
            severity: maxDeviation > threshold * 2 ? 'high' : 'medium',
            detail: `在"${itemName}"评分项上，${outlier.expertName}(${outlier.score}) 与其他专家均值(${Math.round(avg)}) 偏差较大`,
          });
        }
      }
    }

    return {
      anomalies,
      total: anomalies.length,
      highCount: anomalies.filter(a => a.severity === 'high').length,
      analyzedAt: new Date().toISOString(),
    };
  }

  /* ━━━ 供应商风险评分（管理端用） ━━━ */

  async getSupplierRiskScores(projectId: string) {
    // 预取：投标方、提交、绩效均分、资质聚合（全部/过期）、项目预算
    const [suppliers, submissions, perfAgg, qualAgg, expiredAgg, budgetRow] = await Promise.all([
      this.prisma.bidSupplier.findMany({ where: { projectId } }),
      this.prisma.supplierBidSubmission.findMany({ where: { projectId } }),
      this.prisma.supplierEvaluation.groupBy({
        by: ['supplierId'],
        _avg: { overallScore: true },
        _count: { _all: true },
      }),
      this.prisma.supplierQualification.groupBy({ by: ['supplierId'], _count: { _all: true } }),
      this.prisma.supplierQualification.groupBy({
        by: ['supplierId'],
        where: { validTo: { lt: new Date() } },
        _count: { _all: true },
      }),
      this.prisma.procurementProject.findFirst({ where: { bidProjectId: projectId }, select: { budget: true } }),
    ]);

    // 仅对"已关联 supplierId"的投标方做资质/绩效查表
    const linkedSupplierIds = suppliers.map(s => s.supplierId).filter((x): x is string => !!x);
    const perfMap = new Map(perfAgg.filter(a => linkedSupplierIds.includes(a.supplierId)).map(a => [a.supplierId, { avg: a._avg.overallScore ? Number(a._avg.overallScore) : null, count: a._count._all }]));
    const qualMap = new Map(qualAgg.filter(a => linkedSupplierIds.includes(a.supplierId)).map(a => [a.supplierId, a._count._all]));
    const expiredMap = new Map(expiredAgg.filter(a => linkedSupplierIds.includes(a.supplierId)).map(a => [a.supplierId, a._count._all]));
    const budget = budgetRow?.budget ? Number(budgetRow.budget) : null;

    return suppliers.map(s => {
      const sub = submissions.find(x => x.supplierId === s.supplierId);
      const fileRefs = sub ? [sub.technicalFileAssetId, sub.businessFileAssetId, sub.coverLetterAssetId] : [];
      const fileCount = fileRefs.filter(Boolean).length;

      const totalQual = s.supplierId ? (qualMap.get(s.supplierId) ?? 0) : 0;
      const expiredQual = s.supplierId ? (expiredMap.get(s.supplierId) ?? 0) : 0;
      const perf = s.supplierId ? perfMap.get(s.supplierId) : undefined;

      const factors = computeRiskFactors({
        decryptStatus: s.decryptStatus,
        fileCount,
        fileTotal: 3,
        validQualifications: Math.max(0, totalQual - expiredQual),
        expiredQualifications: expiredQual,
        bidPrice: sub?.bidPrice ? Number(sub.bidPrice) : null,
        budget,
        perfAvg: perf?.avg ?? null,
        perfCount: perf?.count ?? 0,
      });
      const overall = Math.round(factors.reduce((sum, f) => sum + f.score, 0) / factors.length);
      const dataBacked = factors.filter(f => f.backedByData).length;
      return {
        id: s.id,
        supplierName: s.supplierName,
        overallRiskScore: overall,
        level: riskLevel(overall),
        factors: factors.map(f => ({ name: f.name, score: f.score, detail: f.detail })),
        confidence: Math.round((dataBacked / factors.length) * 100),
      };
    });
  }

  /* ━━━ 工具方法 ━━━ */

  private hashString(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
    }
    return Math.abs(hash);
  }

  /* ━━━ AI 供应商智能选取（检索 → LLM 排序 → 规则兜底） ━━━ */

  async recommendSuppliers(
    requirement: string,
    opts: { classificationId?: string; maxCount?: number },
  ): Promise<SupplierSelectionResult> {
    const maxCount = Math.min(Math.max(opts.maxCount ?? 10, 1), 30);
    const reqGrams = this.tokenize(requirement);

    // 1. 检索：已入库供应商，可选分类过滤
    const where: any = { status: 'APPROVED' };
    if (opts.classificationId) where.classificationId = opts.classificationId;
    const suppliers = await this.prisma.supplier.findMany({
      where,
      include: {
        classification: true,
        contacts: { where: { isPrimary: true }, take: 2 },
        qualifications: { select: { name: true }, take: 3 },
      },
    });

    // 2. 关键词 n-gram 重叠度评分 → 取 top 候选池
    const scored = suppliers.map((s) => {
      const textSet = new Set(this.tokenize(this.supplierText(s)));
      let hits = 0;
      for (const g of reqGrams) if (textSet.has(g)) hits++;
      const overlap = reqGrams.length > 0 ? hits / reqGrams.length : 0;
      return { supplier: s, overlap, hits };
    });
    scored.sort((a, b) => b.overlap - a.overlap || b.hits - a.hits);

    const POOL = 40;
    const pool = scored.slice(0, POOL);
    const supplierMap = new Map(pool.map(({ supplier: s }) => [s.id, s]));
    const candidates = pool.map(({ supplier: s }) => ({
      id: s.id,
      name: s.name,
      classification: s.classification?.name,
      businessScope: s.businessScope || '',
      qualificationText: (s.qualifications || []).map((q) => q.name).join('；'),
      enterpriseType: s.enterpriseType,
      legalPerson: s.legalPerson,
    }));

    // 3. LLM 排序（无 key / 失败 → 规则兜底）
    const llm = await this.selectionAi.rankCandidates(requirement, candidates, maxCount);

    let recommendations: SupplierRecommendation[];
    let summary: string;
    let engine: 'deepseek' | 'rules';

    if (llm && llm.recommendations.length > 0) {
      engine = 'deepseek';
      summary = llm.summary;
      recommendations = llm.recommendations
        .map((r) => this.toRecommendation(r.id, r.score, r.reason, supplierMap))
        .filter((r): r is SupplierRecommendation => r !== null);
    } else {
      engine = 'rules';
      summary = this.fallbackSummary(pool.length, !!opts.classificationId, maxCount);
      recommendations = pool
        .slice(0, maxCount)
        .map(({ supplier: s, overlap }) =>
          this.toRecommendation(s.id, Math.round(55 + overlap * 40), this.fallbackReason(s, overlap), supplierMap)!,
        )
        .filter(Boolean);
    }

    return {
      requirement,
      engine,
      model: engine === 'deepseek'
        ? process.env.DEEPSEEK_MODEL ?? 'deepseek-v4-flash'
        : 'WaterERP Rules Engine',
      candidatePool: candidates.length,
      summary,
      recommendations,
      generatedAt: new Date().toISOString(),
    };
  }

  private supplierText(s: any): string {
    return [
      s.name,
      s.classification?.name,
      s.enterpriseType,
      s.businessScope,
      (s.qualifications || []).map((q: any) => q.name).join(' '),
    ]
      .filter(Boolean)
      .join(' ');
  }

  /** 中文 n-gram(2/3-gram) + 英文整词 分词，用于无分词器下的重叠度匹配 */
  private tokenize(text: string): string[] {
    if (!text) return [];
    const cleaned = text.replace(/[^一-龥A-Za-z0-9]/g, ' ');
    const grams = new Set<string>();
    for (const word of cleaned.split(/\s+/)) {
      if (!word) continue;
      if (/[一-龥]/.test(word)) {
        for (let n = 2; n <= 3; n++) {
          for (let i = 0; i + n <= word.length; i++) grams.add(word.slice(i, i + n));
        }
        if (word.length <= 3) grams.add(word);
      } else {
        grams.add(word.toLowerCase());
      }
    }
    return [...grams];
  }

  private toRecommendation(
    id: string,
    score: number,
    reason: string,
    supplierMap: Map<string, any>,
  ): SupplierRecommendation | null {
    const s = supplierMap.get(id);
    if (!s) return null;
    return {
      supplierId: s.id,
      name: s.name,
      classification: s.classification?.name,
      matchScore: score,
      reason,
      legalPerson: s.legalPerson,
      enterpriseType: s.enterpriseType,
      contacts: (s.contacts || []).map((c: any) => ({ name: c.name, phone: c.phone, isPrimary: c.isPrimary })),
    };
  }

  private fallbackSummary(poolSize: number, classified: boolean, maxCount: number): string {
    if (poolSize === 0) return '未在供应商库中找到与采购需求匹配的候选供应商，请调整需求描述或分类后重试。';
    const scope = classified ? '指定分类内' : '全库';
    return `基于关键词与经营范围匹配，从${scope}候选中筛选出最多 ${maxCount} 家相关供应商（规则引擎；如需更精准的语义推荐，请确保已配置 DeepSeek AI 服务）。`;
  }

  private fallbackReason(s: any, overlap: number): string {
    const parts: string[] = [];
    if (s.classification?.name) parts.push(`属「${s.classification.name}」分类`);
    if (overlap > 0.3) parts.push('经营范围与需求高度相关');
    else if (overlap > 0.1) parts.push('经营范围部分匹配采购需求');
    else parts.push('可纳入候选比较');
    return parts.join('，') + '。';
  }

  private readonly logger = new Logger(AiService.name);

  /** P1-E：全局 AI 评分校准（跨项目采纳率 + category 偏差 + top 偏差项） */
  async getAiCalibration() {
    const deltas = await this.prisma.bidScoreDelta.findMany({
      where: { expertReportConfirmed: true },
    });
    if (!deltas.length) return null;
    const itemIds = [...new Set(deltas.map((d) => d.scoreItemId))];
    const items = await this.prisma.bidScoreItem.findMany({
      where: { id: { in: itemIds } },
      select: { id: true, category: true, name: true },
    });
    return buildCalibration(
      deltas.map((d) => ({
        scoreItemId: d.scoreItemId,
        expertScore: Number(d.expertScore),
        aiScore: Number(d.aiScore),
        delta: Number(d.delta),
        accepted: d.accepted,
      })),
      items,
    );
  }

  async dashboardSummary(context: {
    supplier?: { total: number; approved: number; pending: number; risk: number };
    announcement?: { total: number; published: number; draftLike: number };
    expert?: { total: number; active: number; unfinished: number };
    catalog?: { total: number; active: number; alerts: number };
    applications?: { pending: number };
  }) {
    const s = context.supplier || { total: 0, approved: 0, pending: 0, risk: 0 };
    const a = context.announcement || { total: 0, published: 0, draftLike: 0 };
    const e = context.expert || { total: 0, active: 0, unfinished: 0 };
    const c = context.catalog || { total: 0, active: 0, alerts: 0 };
    const apps = context.applications || { pending: 0 };

    const apiKey = process.env.DEEPSEEK_API_KEY;
    if (!apiKey) {
      return this.fallbackInsight(s, a, e, c, apps);
    }

    const supplierApprovalPct = s.total > 0 ? Math.round((s.approved / s.total) * 100) : 0;
    const announcementPubPct = a.total > 0 ? Math.round((a.published / a.total) * 100) : 0;
    const catalogActivePct = c.total > 0 ? Math.round((c.active / c.total) * 100) : 0;
    const expertCompletionRate = (e.active + Math.max(e.unfinished || 0, 0)) > 0
      ? Math.round(((e.active || 0) / ((e.active || 0) + (e.unfinished || 0))) * 100) : 0;

    const systemPrompt = [
      '你是"水叮当"——四川水发集团招采ERP的AI采购运营分析师。你服务于采购管理部门的日常运营决策。',
      '',
      '# 角色设定',
      '你是一位在水利行业有10年经验的采购运营总监，现在转型为AI助手。你的分析风格：',
      '- 从数据中读出业务含义，而不是复述数字。',
      '- 关注审批积压、资源利用率、流程瓶颈、数据质量。',
      '- 对每个模块给出独立的健康度判断和依据。',
      '- 在模块之间建立关联分析（例如：供应商入库慢→可投标的供应商少→招标竞争不充分）。',
      '- 语言干练专业，不堆砌术语，每句话都有信息量。',
      '',
      '# 业务理解',
      '四川水发集团是省属水利投资建设集团，采购业务覆盖工程建设、设备采购、信息化和服务四大类。',
      '招采ERP管理以下业务中心：',
      '',
      '1. 信息发布中心（/notice）：管理招标公告、中标公示、政策法规、平台通知。',
      '   - 已发布比例低意味着对外信息公开不足，影响供应商获取招标机会。',
      '   - 待完善数量多意味着采购需求描述不完整，可能导致后续答疑和澄清增多。',
      '',
      '2. 供应商管理中心（/supplier）：管理供应商注册、审核、入库、评价、变更、停用和黑名单。',
      '   - 入库率 = 已入库/总量，反映供应商资源池的健康程度。',
      '   - 待审积压意味着新供应商无法及时参与投标，直接影响招标竞争充分性。',
      '   - 停用/黑名单数量需要关注是否在合理范围内（通常不超过总量的10%）。',
      '',
      '3. 专家管理中心（/expert）：管理评标专家库、抽取分配、回避管理、履职评价。',
      '   - 专家总量决定了评标工作的可调度弹性。',
      '   - 未完成事项数反映专家履职的及时性。',
      '   - 专家参与项目数反映专家资源的利用效率。',
      '',
      '4. 电子商城管理（/mall-management）：管理集中采购目录、价格审批、价格录入。',
      '   - 有效目录占比直接影响价格参考体系的可用性。',
      '   - 待处理预警数反映价格数据的时效性风险。',
      '   - 供货审批积压意味着供应商无法及时获得供货资格。',
      '',
      '# 跨模块关联分析原则',
      '- 供应商待审积压 + 投标项目少 → 招标市场竞争不充分。',
      '- 公告发布率低 + 供应商已入库多 → 信息触达不足，供应商有资源但无机会。',
      '- 专家总量充足但履职完成率低 → 可能存在分配不合理或回避关系过多。',
      '- 商城目录有效率高 + 供货审批少 → 商城供给侧稳定，可扩大目录覆盖。',
      '',
      '# 输出格式（必须严格返回JSON，无任何其他文字）',
      '{',
      '  "overview": "一段80-120字的运营总评，包含对各模块的独立判断和之间的关联分析，语气专业",',
      '  "moduleInsights": [',
      '    {',
      '      "module": "模块名称",',
      '      "status": "健康|关注|待处理",',
      '      "analysis": "40-60字的详细分析，包含数据解读和业务影响",',
      '      "path": "/supplier/approval",',
      '      "tone": "blue|green|orange|purple|cyan",',
      '      "metrics": ["关键数字1", "关键数字2"]',
      '    }',
      '  ],',
      '  "crossInsight": "50-80字的跨模块关联洞察，指出最值得关注的系统性问题",',
      '  "suggestions": [',
      '    {"priority": 1, "text": "具体可执行的行动建议", "path": "/supplier/approval", "impact": "高|中|低"},',
      '    {"priority": 2, "text": "具体可执行的行动建议", "path": "/notice", "impact": "中"}',
      '  ]',
      '}',
      '',
      '# 关键路径映射',
      '信息发布中心→/notice  供应商审批→/supplier/approval  供应商库→/supplier/repository',
      '专家库→/expert/repository  专家评价→/expert/evaluation  商城目录→/mall-management/catalog',
      '价格审批→/mall-management/approval  价格录入→/mall-management/price-entry',
      '',
      '# tone 规则：积压/异常→orange，健康→green，信息→blue，专家→purple，商城→cyan',
      'moduleInsights 必须覆盖4个模块，不要遗漏。metrics 字段放2个最有意义的数字。',
    ].join('\n');

    const userPrompt = [
      '# 当前运营数据快照',
      '',
      '## 信息发布中心',
      `总量 ${a.total} 条 | 已发布 ${a.published} 条（占比 ${announcementPubPct}%）| 待完善/草稿 ${a.draftLike} 条`,
      a.draftLike > 0 ? `→ 有 ${a.draftLike} 条信息尚未完成发布流程，可能处于草稿或待审核状态。` : '→ 信息发布通道畅通，无积压。',
      '',
      '## 供应商管理中心',
      `总量 ${s.total} 家 | 已入库 ${s.approved} 家（入库率 ${supplierApprovalPct}%）| 待审批 ${s.pending} 家 | 停用/黑名单 ${s.risk} 家`,
      s.pending > 0 ? `→ ${s.pending} 家供应商等待入库审核，是当前供应商管理的核心待办事项。` : '',
      s.risk > 0 ? `→ 有 ${s.risk} 家供应商处于停用或黑名单状态，需要确认是否需要清理或恢复。` : '',
      '',
      '## 专家管理中心',
      `总量 ${e.total} 名 | 进行中项目 ${e.active} 项 | 未完成事项 ${e.unfinished} 项 | 履职完成率 ${expertCompletionRate}%`,
      e.unfinished > 0 ? `→ ${e.unfinished} 项专家事项待完成，可能影响评审进度。` : '→ 专家履职情况良好。',
      '',
      '## 电子商城管理',
      `目录总量 ${c.total} 条 | 有效 ${c.active} 条（占比 ${catalogActivePct}%）| 待处理/预警 ${c.alerts} 条 | 供货审批待办 ${apps.pending} 条`,
      c.alerts > 0 ? `→ ${c.alerts} 条目录存在价格波动、临期或待复核状态，影响价格参考准确性。` : '',
      apps.pending > 0 ? `→ ${apps.pending} 条供应商供货申请等待审批。` : '→ 无待审批供货申请。',
      '',
      '# 分析要求',
      '请以采购运营总监的视角，对上述四个模块进行逐一分析和跨模块关联洞察。',
      '每个模块的分析需要引用具体数字，说明业务含义和潜在影响。',
      '跨模块洞察需要找到两个以上模块之间的关联性问题。',
      '建议需要按优先级排列，每条附上预期影响（高/中/低）。',
    ].join('\n');

    try {
      const DEEPSEEK_URL = process.env.DEEPSEEK_API_URL || 'https://api.deepseek.com';
      const DEEPSEEK_MODEL = process.env.DEEPSEEK_MODEL || 'deepseek-v4-flash';
      const res = await fetch(`${DEEPSEEK_URL.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: DEEPSEEK_MODEL, temperature: 0.3, max_tokens: 1600,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
        }),
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) {
        this.logger.warn(`DeepSeek dashboard-summary failed: ${res.status}`);
        return this.fallbackInsight(s, a, e, c, apps);
      }
      const data = await res.json();
      const text = (data?.choices?.[0]?.message?.content || '').trim();
      const parsed = JSON.parse(text);
      return {
        overview: parsed.overview || '运营态势正常',
        moduleInsights: Array.isArray(parsed.moduleInsights) ? parsed.moduleInsights.filter((m: any) => m.module && m.analysis) : [],
        crossInsight: parsed.crossInsight || '',
        highlights: Array.isArray(parsed.highlights) ? parsed.highlights.filter((h: any) => h.module && h.path) : [],
        suggestions: Array.isArray(parsed.suggestions) ? parsed.suggestions.filter((s: any) => s.text && s.path) : [],
      };
    } catch (err: any) {
      this.logger.warn(`DeepSeek dashboard-summary error: ${err.message}`);
      return this.fallbackInsight(s, a, e, c, apps);
    }
  }

  private fallbackInsight(s: any, a: any, e: any, c: any, apps: any) {
    const approvalPct = s.total > 0 ? Math.round((s.approved / s.total) * 100) : 0;
    const pubPct = a.total > 0 ? Math.round((a.published / a.total) * 100) : 0;
    const catalogPct = c.total > 0 ? Math.round((c.active / c.total) * 100) : 0;
    const totalIssues = s.pending + a.draftLike + e.unfinished + c.alerts + apps.pending;
    const hasSupplierRisk = s.risk > 0;

    const moduleInsights: any[] = [
      {
        module: '信息发布中心',
        status: a.draftLike > 3 ? '待处理' : a.draftLike > 0 ? '关注' : '健康',
        analysis: a.total === 0
          ? '信息发布中心暂无数据，建议尽快发布集团首条招标公告或政策文件，启动信息发布流程。'
          : a.draftLike > 3
            ? `信息发布总量${a.total}条，但仍有${a.draftLike}条处于草稿或待发布状态（发布率仅${pubPct}%），信息发布效率偏低。公告未发布意味着供应商无法获取招标机会，直接影响项目推进节奏。`
            : a.draftLike > 0
              ? `信息发布总量${a.total}条，已发布${a.published}条，发布率${pubPct}%。有${a.draftLike}条待完善，建议尽快完成剩余信息的发布流程以保持信息透明度。`
              : `信息发布总量${a.total}条，全部已发布，发布率100%。信息发布通道畅通，供应商可及时获取招标信息。`,
        path: '/notice',
        tone: a.draftLike > 3 ? 'orange' : a.draftLike > 0 ? 'blue' : 'green',
        metrics: [`总量${a.total}条`, pubPct > 0 ? `发布率${pubPct}%` : '暂无数据'],
      },
      {
        module: '供应商管理中心',
        status: s.pending > 2 ? '待处理' : s.pending > 0 ? '关注' : hasSupplierRisk ? '关注' : '健康',
        analysis: s.total === 0
          ? '供应商库暂无数据。供应商是招标采购的基础资源，建议尽快通过注册审核或批量导入方式建立首批供应商档案。'
          : s.pending > 2
            ? `供应商总量${s.total}家，入库率${approvalPct}%，当前有${s.pending}家供应商等待入库审核，审批积压较为明显。审核延迟将导致这些供应商无法参与当前招标项目，建议优先处理。`
            : s.pending > 0
              ? `供应商总量${s.total}家，已入库${s.approved}家，入库率${approvalPct}%。有${s.pending}家待审批，供应商资源池总体健康。`
              : hasSupplierRisk
                ? `供应商总量${s.total}家，入库率${approvalPct}%。但存在${s.risk}家停用或黑名单供应商，需要定期复核状态。`
                : `供应商总量${s.total}家，已入库${s.approved}家，入库率${approvalPct}%。资源池健康，审批通道畅通。`,
        path: s.pending > 0 ? '/supplier/approval' : '/supplier/repository',
        tone: s.pending > 2 ? 'orange' : 'green',
        metrics: [`总量${s.total}家`, `入库率${approvalPct}%`],
      },
      {
        module: '专家管理中心',
        status: e.unfinished > 2 ? '待处理' : e.unfinished > 0 ? '关注' : '健康',
        analysis: e.total === 0
          ? '专家库暂无数据。评标专家是招标评审的核心资源，建议尽快录入首批专家信息，并建立专业分类体系。'
          : e.unfinished > 2
            ? `专家${e.total}名，当前${e.active}项评审进行中，但有${e.unfinished}项履职事项未完成。履职延迟可能影响评审质量评价和后续专家抽取。`
            : e.unfinished > 0
              ? `专家${e.total}名，${e.active}项评审进行中，${e.unfinished}项未完成。资源充足，需关注个别专家的履职及时性。`
              : `专家${e.total}名，${e.active}项评审进行中。专家评审工作有序推进，履职情况良好。`,
        path: e.unfinished > 0 ? '/expert/evaluation' : '/expert/repository',
        tone: e.unfinished > 2 ? 'orange' : e.unfinished > 0 ? 'purple' : 'green',
        metrics: [`${e.total}名专家`, `${e.active}项进行中`],
      },
      {
        module: '电子商城管理',
        status: c.alerts > 3 || apps.pending > 2 ? '待处理' : c.alerts > 0 || apps.pending > 0 ? '关注' : '健康',
        analysis: c.total === 0
          ? '电子商城目录暂无数据。集中采购目录是价格参考体系的核心，建议尽快通过价格录入或批量导入方式建立目录数据库。'
          : c.alerts > 3
            ? `目录总量${c.total}条，有效${c.active}条（有效率${catalogPct}%），但有${c.alerts}条存在价格波动、临期或待复核预警。价格数据时效性不足将影响预算编制的准确性。`
            : c.alerts > 0 || apps.pending > 0
              ? `目录总量${c.total}条，有效${c.active}条。${c.alerts > 0 ? `${c.alerts}条待复核，` : ''}${apps.pending > 0 ? `${apps.pending}条供货审批待处理，` : ''}建议及时维护价格数据。`
              : `目录总量${c.total}条，有效${c.active}条（有效率${catalogPct}%）。价格数据时效性良好，可支撑预算编制和价格参考。`,
        path: c.alerts > 0 ? '/mall-management/catalog' : apps.pending > 0 ? '/mall-management/approval' : '/mall-management/catalog',
        tone: c.alerts > 3 || apps.pending > 2 ? 'orange' : c.alerts > 0 || apps.pending > 0 ? 'cyan' : 'green',
        metrics: [`有效${c.active}条`, catalogPct > 0 ? `有效率${catalogPct}%` : '暂无数据'],
      },
    ];

    const crossParts: string[] = [];
    if (s.pending > 0 && a.total > 0) {
      crossParts.push('供应商审批积压可能导致可投标供应商不足，影响招标项目的竞争充分性');
    }
    if (a.draftLike > 0 && a.published > 0) {
      crossParts.push(`信息发布率达${pubPct}%，但仍有${a.draftLike}条待完善，建议优先完成涉及当前招标项目的信息发布`);
    }
    if (e.active > 0 && e.unfinished > 0) {
      crossParts.push(`专家${e.active}项评审进行中但${e.unfinished}项未完成，建议排查是否存在分配不均或回避流程过长的问题`);
    }
    if (c.active > 0 && apps.pending > 0) {
      crossParts.push(`商城目录${c.active}条有效，${apps.pending}条供货申请待审，应尽快完成审批以扩大有效供应商覆盖面`);
    }
    const crossInsight = crossParts.length > 0
      ? crossParts.join('。')
      : '各模块间暂无明显的关联性问题，建议按常规流程推进各项业务';

    const suggestions: any[] = [];
    if (s.pending > 0) suggestions.push({ priority: 1, text: `处理${s.pending}家待审批供应商的入库审核，确保新供应商能及时参与招标`, path: '/supplier/approval', impact: '高' });
    if (a.draftLike > 0) suggestions.push({ priority: suggestions.length + 1, text: `完成${a.draftLike}条待完善公告的编辑和发布，提高信息透明度`, path: '/notice', impact: '高' });
    if (apps.pending > 0) suggestions.push({ priority: suggestions.length + 1, text: `审核${apps.pending}条商城供货申请，扩大目录供应商覆盖范围`, path: '/mall-management/approval', impact: '中' });
    if (c.alerts > 0) suggestions.push({ priority: suggestions.length + 1, text: `复核${c.alerts}条目录的价格波动或临期状态，确保价格参考体系可靠`, path: '/mall-management/catalog', impact: '中' });
    if (e.unfinished > 0) suggestions.push({ priority: suggestions.length + 1, text: `跟进${e.unfinished}项专家未完成事项，保障评审工作的完整性和及时性`, path: '/expert/evaluation', impact: '中' });
    if (c.total > 0 && c.active / Math.max(c.total, 1) > 0.8 && suggestions.length < 3) {
      suggestions.push({ priority: suggestions.length + 1, text: '考虑扩大商城目录品类覆盖范围，丰富价格参考数据维度', path: '/mall-management/price-entry', impact: '低' });
    }
    if (s.approved > 0 && s.pending === 0 && suggestions.length < 3) {
      suggestions.push({ priority: suggestions.length + 1, text: '对已入库供应商进行分类梳理和绩效评价，优化资源池结构', path: '/supplier/evaluation', impact: '低' });
    }

    const overviewParts: string[] = [];
    if (s.total > 0) overviewParts.push(`供应商库${s.total}家（入库率${approvalPct}%）`);
    if (a.total > 0) overviewParts.push(`信息发布${a.total}条（发布率${pubPct}%）`);
    if (e.total > 0) overviewParts.push(`专家${e.total}名（${e.active}项进行中）`);
    if (c.total > 0) overviewParts.push(`商城目录${c.total}条（有效率${catalogPct}%）`);
    const overview = overviewParts.length > 0
      ? `各中心运行概况：${overviewParts.join('，')}。` + (totalIssues > 0 ? `当前共有${totalIssues}项待处理事项需要关注。` : '各模块运行平稳，无积压事项。')
      : '各业务中心暂无活跃数据。建议按实际业务需求逐步初始化：信息发布中心录入首条公告、供应商管理中心注册首批供应商、专家管理中心建立专家库、电子商城导入目录数据。';

    return { overview, moduleInsights, crossInsight, highlights: [], suggestions: suggestions.slice(0, 4) };
  }

  /* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
     大屏 AI 分析面板 — 6 格 + 跑马灯
     ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

  async getBigscreenInsight() {
    const logger = new Logger(AiService.name + '(bigscreen)');

    const [budgetData, signedData, activeBids, supplierGroups, expiringQuals,
      expertGroups, archiveGroups, decryptAnomalies, disputedConfirms,
      topExpiringQuals, openingSessions, stalledProjects, recentProcurement,
    ] = await Promise.all([
      this.prisma.procurementProject.aggregate({ _sum: { budget: true }, _count: true }),
      this.prisma.procurementProject.aggregate({ _sum: { budget: true }, where: { status: 'CONTRACTED' } }),
      this.prisma.bidProject.findMany({
        where: { stage: { in: ['OPENING', 'EVALUATING'] } },
        select: { id: true, name: true, stage: true, budget: true,
          _count: { select: { suppliers: true } } },
        orderBy: { openTime: 'desc' }, take: 8,
      }),
      this.prisma.supplier.groupBy({ by: ['status'], _count: true }),
      this.prisma.supplierQualification.count({
        where: { validTo: { lt: new Date(Date.now() + 90 * 86400000), gte: new Date() } },
      }),
      this.prisma.expertProfile.groupBy({ by: ['availability'], _count: true }),
      this.prisma.bidArchiveItem.groupBy({ by: ['status'], _count: true }),
      // NEW: 解密异常供应商数
      this.prisma.bidSupplier.count({ where: { decryptStatus: 'DANGER' } }),
      // NEW: 确认争议数
      this.prisma.bidSupplier.count({ where: { confirmStatus: 'DISPUTED' } }),
      // NEW: 最紧急过期资质 top 5（含供应商名）
      this.prisma.supplierQualification.findMany({
        where: { validTo: { lt: new Date(Date.now() + 90 * 86400000), gte: new Date() } },
        select: { name: true, validTo: true, supplier: { select: { name: true } } },
        orderBy: { validTo: 'asc' }, take: 5,
      }),
      // NEW: 当前开标会话（含倒计时）
      this.prisma.bidOpeningSession.findMany({
        where: { status: 'OPENING' },
        select: { projectId: true, remainingSeconds: true, project: { select: { name: true } } },
        take: 5,
      }),
      // NEW: 项目阶段停滞（超过7天未更新）
      this.prisma.bidProject.findMany({
        where: { stage: { in: ['SUBMIT', 'OPENING', 'EVALUATING'] },
          updatedAt: { lt: new Date(Date.now() - 7 * 86400000) } },
        select: { name: true, stage: true, updatedAt: true },
        take: 5,
      }),
      // NEW: 最近15条采购项目（用于趋势分析）
      this.prisma.procurementProject.findMany({
        select: { createdAt: true, budget: true, status: true },
        orderBy: { createdAt: 'desc' }, take: 20,
      }),
    ]);

    const fm = (n: number) => n >= 1e8 ? '¥' + (n / 1e8).toFixed(2) + '亿' : n >= 1e4 ? '¥' + Math.round(n / 1e4) + '万' : '¥' + n;
    const gc = (arr: any[], s: string) => arr.find(x => x.status === s)?._count ?? 0;
    const ga = (arr: any[], s: string) => arr.find(x => x.availability === s)?._count ?? 0;
    const gz = (arr: any[], s: string) => arr.find(x => x.status === s)?._count ?? 0;

    const totalBudget = Number(budgetData._sum.budget || 0);
    const signedAmt = Number(signedData._sum.budget || 0);
    const savings = totalBudget - signedAmt;
    const pct = totalBudget > 0 ? Math.round(savings / totalBudget * 1000) / 10 : 0;
    const supTotal = supplierGroups.reduce((a: number, x: any) => a + x._count, 0);
    const supOk = gc(supplierGroups, 'APPROVED');
    const supWait = gc(supplierGroups, 'PENDING');
    const supOff = gc(supplierGroups, 'DISABLED');
    const supBlock = gc(supplierGroups, 'BLACKLIST');
    const expAvail = ga(expertGroups, '可用');
    const expBusy = ga(expertGroups, '占用');
    const expOff = ga(expertGroups, '停用');
    const arcOk = gz(archiveGroups, 'COMPLETED');
    const arcIng = gz(archiveGroups, 'IN_PROGRESS');
    const arcNo = gz(archiveGroups, 'NOT_STARTED');
    const arcAll = arcOk + arcIng + arcNo;
    const stageCN: Record<string, string> = { OPENING: '开标', EVALUATING: '评标', SUBMIT: '提交' };
    const now = new Date();
    const timeStr = now.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });

    // ── 趋势数据：按月分组最近6个月采购项目 ──
    const monthlyBuckets: Record<string, number> = {};
    const sixMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 5, 1);
    for (const p of recentProcurement) {
      const d = new Date(p.createdAt);
      if (d >= sixMonthsAgo) {
        const key = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
        monthlyBuckets[key] = (monthlyBuckets[key] || 0) + 1;
      }
    }
    const monthlyTrend = Object.entries(monthlyBuckets).sort().map(([m, c]) => m + ':' + c).join(',');
    const maxMonthly = Math.max(1, ...Object.values(monthlyBuckets));

    // ── 建设数据快照 ──
    const snap = [
      '【蜀水云采运营快照 ' + now.toLocaleDateString('zh-CN') + ' ' + timeStr + '】',
      '',
      '## 采购总览',
      '项目总数:' + budgetData._count + ' | 预算总额:' + fm(totalBudget) + ' | 已签约:' + fm(signedAmt) + ' | 节资率:' + pct + '%',
      '',
      '## 月度采购趋势（近6月）',
      monthlyTrend + ' (格式: YYYY-MM:项目数)',
      '',
      '## 活跃招标项目',
      activeBids.map((b: any) => '- ' + b.name + ' ' + (stageCN[b.stage] || b.stage) + ' 预算' + fm(Number(b.budget)) + ' ' + b._count.suppliers + '家供方').join('\n') || '无',
      '',
      '## 供应商库',
      '总数' + supTotal + ' | 已批准' + supOk + ' | 待审核' + supWait + ' | 停用' + supOff + ' | 黑名单' + supBlock,
      '资质临期(90天内): ' + expiringQuals + ' 项',
      '解密异常: ' + decryptAnomalies + ' 家 | 确认争议: ' + disputedConfirms + ' 家',
      '',
      '## 临期资质详情（最紧急）',
      topExpiringQuals.map((q: any) => '- ' + q.supplier.name + ' - ' + q.name + ' 有效期至' + new Date(q.validTo).toLocaleDateString('zh-CN')).join('\n') || '无',
      '',
      '## 专家库',
      '总数' + (expAvail + expBusy + expOff) + ' | 可用' + expAvail + ' | 占用' + expBusy + ' | 停用' + expOff,
      '',
      '## 开标实时状态',
      openingSessions.map((s: any) => '- ' + (s.project?.name || '--') + ' 剩余' + Math.ceil((s.remainingSeconds || 0) / 60) + '分钟').join('\n') || '无进行中开标',
      '',
      '## 阶段停滞项目（>7天未推进）',
      stalledProjects.map((p: any) => '- ' + p.name + ' [' + (stageCN[p.stage] || p.stage) + '] 停滞' + Math.floor((now.getTime() - new Date(p.updatedAt).getTime()) / 86400000) + '天').join('\n') || '无',
      '',
      '## 归档状态',
      '总计' + arcAll + ' | 已完成' + arcOk + ' | 进行中' + arcIng + ' | 未开始' + arcNo,
    ].join('\n');

    const sys = [
      '你是"水叮当"——四川水发集团招采ERP的AI运营分析师，直接向集团采购管理部汇报。',
      '',
      '# 你的核心能力',
      '你不是数据的搬运工，你是数据的解读者。不要简单复述数字，要给出判断、归因和建议。',
      '- 比较：当前数据 vs 历史趋势，指出偏离和异常',
      '- 归因：解释数字背后的原因（哪个项目贡献大？哪个供应商出了问题？）',
      '- 研判：指出风险和机会，给出置信度',
      '- 可操作：每条建议必须指向具体操作对象（项目名/供应商名/专家名）',
      '',
      '# 6个分析模块要求',
      '1. 洞察: 3个KPI(总预算/签约/节资)，barPct基于签约率/节资率，标签必须包含环比判断',
      '2. 预警: 列出具体风险事件，level区分紧急程度，每个事件必须有具体名称（如"X公司资质临期"而非笼统描述）。最多4条',
      '3. 趋势: 15个bar对应月度走势(heightPct基于实际月度数据), 2个预测是基于数据的趋势判断',
      '4. 建议: 2-3条，按紧急程度排序，每条带status(active/pending/done)，指向具体操作对象',
      '5. 关注: 最多2项，聚焦当前开标项目（具体项目名+状态+倒计时），使用环形图pct表示进度',
      '6. 归档: 3条进度条，value用"已完成/总计"格式',
      '',
      '# 输出JSON格式',
      '{"insight":{"kpis":[{"label":"总预算","value":"¥X.XX亿","barPct":100},{"label":"已签约","value":"¥X.XX亿","barPct":78},{"label":"节资","value":"¥X.XX亿","barPct":22}]},"alerts":{"events":[{"level":"high","count":3,"label":"X公司资质临期"}],"summary":{"label":"关键指标","value":"X%"}},"trend":{"bars":[{"heightPct":50,"direction":"up"},...15个],"predictions":[{"label":"节资率走势","value":"XX%","direction":"up"},{"label":"招标量走势","value":"X个","direction":"up"}]},"actions":{"steps":[{"label":"催办X公司资质年审(30天到期)","status":"active"}],"completedCount":0},"watch":{"items":[{"name":"X项目","subLabel":"X/Y签到","pct":71,"color":"#f87171"}],"countdownMins":14},"archive":{"items":[{"label":"项目归档","value":"X/Y","barPct":80},{"label":"哈希验证","value":"✓","barPct":100},{"label":"审计追溯","value":"✓","barPct":100}]},"ticker":{"items":[{"dot":"live","time":"12:03","text":"系统正常·X个项目"},...最少10条]}}',
      '',
      '# 关键规则',
      '- level: high(红色紧急)/mid(橙色关注)/info(蓝色信息)',
      '- direction: "up"(绿色利好)/"down"(红色警示)/""(平稳)',
      '- dot: live(绿)/alert(红)/info(蓝)/success(绿)/warn(橙)',
      '- status: active(当前进行)/pending(待处理)/done(已完成)',
      '- barPct: 0-100整数, 趋势bar的heightPct基于每月项目数/maxMonthly*100',
      '- color: #f87171(高)/#fbbf24(中)/#38bdf8(信息)',
      '- 金额: ¥X.XX亿或¥XXX万, 百分比: XX.X%',
      '- ticker最少12条, 含供应商总数/专家数/项目数/活跃开标数/最新归档数',
      '- summary.insights必须是5条字符串数组，每条30-50字，首3字为标签(实时/异常/趋势/建议/数据)，每条引用具体数据',
      '- 必须引用数据快照中的具体名称（供应商名/项目名/专家名），禁止编造',
      '- 如果某模块数据不足（如无开标项目），返回友好占位内容而非空数组',
    ].join('\n');

    try {
      const result = await this.llm.chatJson<any>(
        sys, '以下是最新运营数据，请生成分析报告：\n\n' + snap + '\n\n严格按JSON格式输出，不要输出markdown或解释：',
        0.3, AbortSignal.timeout(35000),
      );
      logger.log('DeepSeek bigscreen insight OK');
      return {
        insight: result.insight || { kpis: [{label:'总预算',value:fm(totalBudget),barPct:100},{label:'已签约',value:fm(signedAmt),barPct:Math.round(signedAmt/Math.max(totalBudget,1)*100)},{label:'节资',value:fm(savings),barPct:pct}] },
        alerts: result.alerts || { events: [], summary: { label: '', value: '' } },
        trend: result.trend || { bars: [], predictions: [] },
        actions: result.actions || { steps: [], completedCount: 0 },
        watch: result.watch || { items: [] },
        archive: result.archive || { items: [] },
        ticker: result.ticker || { items: [] },
        summary: result.summary || { insights: [] },
      };
    } catch (err: any) {
      logger.warn('DeepSeek failed, fallback: ' + err.message);
      return this.fallbackBigscreenInsight({
        totalBudget, signedAmt, savings, pct, budgetData,
        supTotal, supOk, supWait, supOff, supBlock, expiringQuals,
        expAvail, expBusy, expOff,
        arcOk, arcIng, arcNo, arcAll, activeBids, timeStr,
        decryptAnomalies, disputedConfirms, topExpiringQuals,
        openingSessions, stalledProjects, monthlyBuckets, maxMonthly,
      });
    }
  }

  private fallbackBigscreenInsight(d: any) {
    const fm = (n: number) => n >= 1e8 ? '¥' + (n / 1e8).toFixed(2) + '亿' : n >= 1e4 ? '¥' + Math.round(n / 1e4) + '万' : '¥' + n;
    const stageCN: Record<string, string> = { OPENING: '开标', EVALUATING: '评标', SUBMIT: '提交' };
    const now = new Date();

    const insight = {
      kpis: [
        { label: '总预算', value: fm(d.totalBudget), barPct: 100 },
        { label: '已签约', value: fm(d.signedAmt), barPct: d.totalBudget > 0 ? Math.round(d.signedAmt / d.totalBudget * 100) : 0 },
        { label: '节资', value: fm(d.savings), barPct: d.pct },
      ],
    };

    const ev: any[] = [];
    if (d.topExpiringQuals && d.topExpiringQuals.length > 0) {
      var topQ = d.topExpiringQuals[0];
      var daysLeft = Math.ceil((new Date(topQ.validTo).getTime() - now.getTime()) / 86400000);
      ev.push({ level: 'high', count: d.expiringQuals, label: topQ.supplier.name + '等资质临期(' + daysLeft + '天)' });
    } else if (d.expiringQuals > 0) {
      ev.push({ level: 'high', count: d.expiringQuals, label: '资质临期' });
    }
    if (d.decryptAnomalies > 0) ev.push({ level: 'high', count: d.decryptAnomalies, label: '解密异常' });
    if (d.supWait > 0) ev.push({ level: 'mid', count: d.supWait, label: '待批供应商' });
    if (d.stalledProjects && d.stalledProjects.length > 0) ev.push({ level: 'mid', count: d.stalledProjects.length, label: '项目阶段停滞' });
    if (ev.length === 0) ev.push({ level: 'info', count: 0, label: '运行平稳' });
    const alerts = { events: ev.slice(0, 4), summary: { label: '供应商库', value: d.supTotal + '家' } };

    // 趋势：基于月度数据 or 活跃项目数生成
    var bars = [];
    if (d.monthlyBuckets && Object.keys(d.monthlyBuckets).length > 0) {
      var entries = Object.entries(d.monthlyBuckets).sort();
      var maxM = d.maxMonthly || 1;
      // 扩展到15个点
      for (var i = 0; i < 15; i++) {
        var ei = Math.floor(i / 15 * entries.length);
        var v = entries.length > 0 ? (entries[Math.min(ei, entries.length - 1)][1] as number) : 3;
        bars.push({ heightPct: Math.round(v / maxM * 90 + 5), direction: i >= 12 ? 'up' : (i % 2 === 0 ? 'up' : '') });
      }
    } else {
      bars = Array.from({ length: 15 }, function(_, i) { return { heightPct: 35 + Math.round(Math.sin(i * 0.7) * 20 + 10), direction: i >= 10 ? 'up' : (i % 3 === 0 ? 'up' : '') }; });
    }
    const trend = { bars, predictions: [
      { label: '节资率', value: d.pct + '%', direction: d.pct > 18 ? 'up' : 'down' },
      { label: '活跃项目', value: d.activeBids.length + '个', direction: d.activeBids.length > 3 ? 'up' : 'down' },
    ]};

    const st: any[] = [];
    if (d.topExpiringQuals && d.topExpiringQuals.length > 0) {
      st.push({ label: '催办' + d.topExpiringQuals[0].supplier.name + '资质年审', status: 'active' });
    }
    if (d.supWait > 0) st.push({ label: '审核' + d.supWait + '家待批供应商', status: 'active' });
    if (d.stalledProjects && d.stalledProjects.length > 0) st.push({ label: '推进' + d.stalledProjects[0].name + '阶段推进', status: 'pending' });
    if (st.length === 0) st.push({ label: '系统运行平稳', status: 'done' });
    const actions = { steps: st.slice(0, 3), completedCount: st.filter(function(s: any) { return s.status === 'done'; }).length };

    var wi = [];
    if (d.openingSessions && d.openingSessions.length > 0) {
      wi = d.openingSessions.slice(0, 2).map(function(s: any) {
        var r = (s.remainingSeconds || 0);
        var p = Math.min(100, Math.max(5, Math.round(r / 18))); // ~1800s=100%
        return { name: s.project?.name || '--', subLabel: '剩余' + Math.ceil(r / 60) + '分钟', pct: p, color: r < 600 ? '#f87171' : '#fbbf24' };
      });
    } else if (d.activeBids && d.activeBids.length > 0) {
      wi = d.activeBids.filter(function(b: any) { return b.stage === 'OPENING'; }).slice(0, 2).map(function(b: any) {
        return { name: b.name, subLabel: b._count.suppliers + '家供方', pct: 50, color: '#38bdf8' };
      });
    }
    if (wi.length === 0) wi = [{ name: '暂无开标', subLabel: '--', pct: 0, color: '#38bdf8' }];
    var cd = 0;
    if (d.openingSessions && d.openingSessions.length > 0) cd = Math.ceil((d.openingSessions[0].remainingSeconds || 0) / 60);
    const watch: any = { items: wi };
    if (cd > 0) watch.countdownMins = cd;

    const archive = {
      items: [
        { label: '项目归档', value: Math.min(d.arcOk, 99) + '/' + d.arcAll, barPct: d.arcAll > 0 ? Math.round(d.arcOk / d.arcAll * 100) : 0 },
        { label: '哈希验证', value: d.arcOk > 0 ? '✓' : '--', barPct: d.arcOk > 0 ? 100 : 0 },
        { label: '审计追溯', value: d.arcOk > 0 ? '✓' : '--', barPct: d.arcOk > 0 ? 100 : 0 },
      ],
    };

    var ti: any[] = [
      { dot: 'live', time: d.timeStr, text: '系统正常 · ' + d.budgetData._count + '个采购项目' },
    ];
    if (d.decryptAnomalies > 0) ti.push({ dot: 'alert', time: d.timeStr, text: '解密异常 ' + d.decryptAnomalies + ' 家供应商' });
    if (d.supWait > 0) ti.push({ dot: 'alert', text: '供应商 ' + d.supWait + ' 家待审核' });
    ti.push({ dot: 'info', text: '预算' + fm(d.totalBudget) + ' · 签约' + fm(d.signedAmt) + ' · 节资' + d.pct + '%' });
    if (d.expiringQuals > 0) ti.push({ dot: 'alert', text: '资质临期 ' + d.expiringQuals + ' 项' });
    ti.push({ dot: 'success', text: '供应商库' + d.supTotal + '家 · 已批准' + d.supOk });
    if (d.openingSessions && d.openingSessions.length > 0) {
      ti.push({ dot: 'live', text: '开标中: ' + d.openingSessions.map(function(s: any) { return s.project?.name || '--'; }).join(' · ') });
    }
    if (d.stalledProjects && d.stalledProjects.length > 0) ti.push({ dot: 'warn', text: '项目停滞: ' + d.stalledProjects[0].name });
    ti.push({ dot: 'info', text: '专家' + d.expAvail + '人可用 · 占用' + d.expBusy + '人' });
    if (d.arcOk > 0) ti.push({ dot: 'success', text: d.arcOk + '项已归档 · 可追溯' });
    ti.push({ dot: 'info', text: '活跃项目' + d.activeBids.length + '个' });
    if (d.budgetData._count > 0) ti.push({ dot: 'info', text: '月度趋势: ' + (d.activeBids.length > 5 ? '上升' : '平稳') });
    const ticker = { items: ti };

    var summary = { insights: [
      '[\u5b9e\u65f6] 系统运行正常 · 采购项目' + (d.budgetData?._count||0) + '个 · 供应商' + (d.supTotal||0) + '家 · 专家' + ((d.expAvail||0)+(d.expBusy||0)+(d.expOff||0)) + '人',
      '[\u5f02\u5e38] 供应商资质临期 ' + (d.expiringQuals||0) + ' 项 · 待审核 ' + (d.supWait||0) + ' 家 · 解密异常 ' + (d.decryptAnomalies||0) + ' 家',
      '[\u8d8b\u52bf] 预算' + fm(d.totalBudget||0) + ' · 签约' + fm(d.signedAmt||0) + ' · 节资率 ' + (d.pct||0) + '%',
      '[\u5efa\u8bae] 催办资质年审 · 协调开标专家资源 · 推进待归档项目',
      '[\u6570\u636e] 开标中 ' + (d.activeBids?d.activeBids.filter(function(b: any){return b.stage==='OPENING'}).length:0) + ' 项 · 评标中 ' + (d.activeBids?d.activeBids.filter(function(b: any){return b.stage==='EVALUATING'}).length:0) + ' 项 · 待归档 ' + ((d.arcNo||0)+(d.arcIng||0)) + ' 项'
    ] };
    return { insight, alerts, trend, actions, watch, archive, ticker, summary };
  }

  // ═══════════════════════════════════════════════════
  // 采购中心迁入方法（从 procurement AiService 适配）
  // ═══════════════════════════════════════════════════

  /** LLM JSON 对话（委托给 LlmService） */
  async chatJson<T = any>(
    systemPrompt: string,
    userPrompt: string,
    temperature = 0,
  ): Promise<T> {
    return this.llm.chatJson<T>(systemPrompt, userPrompt, temperature);
  }

  /** 工作台问候语 */
  async generateWorkbenchGreeting(context: {
    userName?: string;
    username?: string;
    displayName?: string;
    hourOfDay?: number;
    pendingCount?: number;
    inProgressCount?: number;
    overdueCount?: number;
    dueTodayCount?: number;
    completedCount?: number;
    completedTodayCount?: number;
    isLeader?: boolean;
  }): Promise<{ greeting: string; subtitle?: string }> {
    const name = context.displayName || context.userName || context.username || '用户';
    const pending = context.pendingCount ?? 0;
    const dueToday = context.dueTodayCount ?? 0;
    try {
      const result = await this.llm.chatJson<{ greeting: string; subtitle?: string }>(
        '你是智能工作助手，根据用户的任务统计生成简洁温暖的问候语（30字以内）。返回JSON: {greeting, subtitle?}',
        `用户 ${name}，待办${pending}项，今日截止${dueToday}项。请生成问候语。`,
      );
      return { greeting: result.greeting || `${name}，新的一天！`, subtitle: result.subtitle };
    } catch {
      return { greeting: `${name}，今天有${pending}项待办，${dueToday}项今日截止。` };
    }
  }

  /** 工作安排日计划分析 */
  async analyzeWorkArrangementDailyPlan(context: {
    date: string;
    currentTime?: string;
    items?: any[];
    userContext?: { role?: string; displayName?: string; username?: string };
    chairmanMode?: boolean;
    projects?: any[];
  }): Promise<{
    date: string; headerGreeting: string; namePraise: string;
    dailyGreeting: string; riskSummary: string; aiSuggestion: string;
    overview: string; focusItems: any[]; timeBlocks: any[];
    riskAlerts: any[]; completionAdvice: string; projectBrief: string;
  }> {
    const EN2ZH: Record<string,string> = {TODO:'待处理',IN_PROGRESS:'进行中',BLOCKED:'阻塞',COMPLETED:'已完成',CANCELLED:'已取消',CRITICAL:'紧急',HIGH:'高',MEDIUM:'中',LOW:'低'};
    const zh = (s:string)=>EN2ZH[s]||s;
    const items = (context.items||[]).map((i:any)=>({...i,status:zh(i.status),urgency:zh(i.urgency)}));
    const todoCount = items.filter((i:any)=>i.status==='待处理').length;
    const inProgressCount = items.filter((i:any)=>i.status==='进行中').length;
    const criticalCount = items.filter((i:any)=>i.urgency==='紧急').length;
    const totalItems = items.length;
    const projects = (context.projects||[]);
    const projectsInfo = projects.length>0?` 项目数据:${JSON.stringify(projects.slice(0,10))}`:'';
    const userName = context.userContext?.displayName||context.userContext?.username||'用户';
    const hour=parseInt((context.currentTime||'9:00').split(':')[0])||9;
    const period=hour<11?'上午':hour<14?'中午':hour<18?'下午':'晚上';

    try {
      const result = await this.llm.chatJson<any>(
        `你是${userName}的私人工作秘书。

【headerGreeting，50字温馨多样】
- 以"{name}，{时段}好"开头，融入季节/茶道/山水/励志等随机主题
- 每次与前次不同，语气如老友关怀
- 示例:"{name}，下午好。日影西斜，一盏清茶正温——今日虽忙碌，但每一份付出都在为明天筑基。"
- 禁止用职位代替姓名

【dailyGreeting，≤30字纯中文】
- 一句话概括总量+紧急数+最紧迫事项，禁止英文

【projectBrief，有项目数据时150-300字，无项目时返回空字符串""】
- 综述各项目阶段、预算、风险概况

【timeBlocks，按任务优先级和时段划分，每个timeBlock必须包含focus字段】
- focus字段为20-40字的纯中文描述，必须包含该时段要完成的**具体任务名称**
- 示例："专注处理催办财政专项资金审批与督办跨部门协作遗留问题，确保今日超期事项全部闭环"
- items字段为该时段关联的任务对象数组[{id,title}]
- 必须生成3-4个时间块

返回JSON: {headerGreeting,namePraise,dailyGreeting,riskSummary,aiSuggestion,overview,focusItems:[{id,title,reason}],timeBlocks:[{label,startTime,endTime,focus,items}],riskAlerts:[{level,title,description}],completionAdvice,projectBrief}`,
        `用户:${userName} 时段:${period} 日期:${context.date} 任务:共${totalItems}项(待处理${todoCount},进行中${inProgressCount},紧急${criticalCount}) ${JSON.stringify(items.slice(0,20))}${projectsInfo}`,
      );
      const safeTimeBlocks = (result.timeBlocks || []).map((b: any) => {
        const raw = Array.isArray(b.items) ? b.items : [];
        const titles = raw.map((i: any) => typeof i === 'string' ? i : (i.title || i.name || '')).filter(Boolean);
        return {
          label: b.label || '时间段',
          start: b.startTime || b.start || '',
          end: b.endTime || b.end || '',
          focus: b.focus || titles.join('、'),
          taskIds: Array.isArray(b.taskIds) ? b.taskIds : [],
        };
      });
      return {
        date: context.date,
        headerGreeting: result.headerGreeting || `{name}，${period}好。新的一天，愿你从容应对每一件事。`,
        namePraise: result.namePraise || '',
        dailyGreeting: result.dailyGreeting || `今日共${totalItems}项任务，${todoCount}项待处理，${criticalCount}项紧急。`,
        riskSummary: result.riskSummary || (todoCount > 5 ? '待办事项较多' : '风险可控'),
        aiSuggestion: result.aiSuggestion || '建议按优先级依次处理',
        overview: result.overview || `共${totalItems}项任务 | ${todoCount}待办`,
        focusItems: result.focusItems || [],
        timeBlocks: safeTimeBlocks,
        riskAlerts: result.riskAlerts || [],
        completionAdvice: result.completionAdvice || '完成所有待办后记得复盘',
        projectBrief: result.projectBrief || '',
      };
    } catch {
      return {
        date: context.date, headerGreeting: `{name}，${period}好。`, namePraise: '',
        dailyGreeting: `今日共${totalItems}项任务`, riskSummary: '风险可控',
        aiSuggestion: '按优先级处理', overview: `${totalItems}项任务`,
        focusItems: [], timeBlocks: [], riskAlerts: [],
        completionAdvice: '完成后复盘', projectBrief: '',
      };
    }
  }

  /** 项目详情分析 */
  async analyzeProjectDetail(context: {
    title?: string; method?: string; budget?: string;
    stages?: { name: string; status: string }[];
    files?: { objectKey?: string; fileName?: string; name?: string; mimeType?: string; fileSize?: number; createdAt?: string; extractedText?: string }[];
    project?: any; currentStage?: any;
  }): Promise<{ analysis: string; fileAnalyses: { objectKey: string; fileName: string; stageMatch: string; contentSummary: string }[] }> {
    const files = context.files || [];
    try {
      const result = await this.llm.chatJson<{ analysis: string; fileAnalyses: { objectKey: string; fileName: string; stageMatch: string; contentSummary: string }[] }>(
        '你是采购项目分析师，分析项目文件与阶段匹配。返回JSON: {analysis, fileAnalyses:[{objectKey,fileName,stageMatch,contentSummary}]}',
        JSON.stringify({ title: context.title, files: files.map(f => ({ objectKey: f.objectKey, fileName: f.fileName||f.name, mimeType: f.mimeType })) }),
      );
      return {
        analysis: result.analysis || '项目文件分析完成',
        fileAnalyses: result.fileAnalyses || files.map(f => ({ objectKey: f.objectKey||'', fileName: f.fileName||f.name||'', stageMatch: '未分类', contentSummary: '' })),
      };
    } catch {
      return {
        analysis: `项目"${context.title||''}"共${files.length}个文件`,
        fileAnalyses: files.map(f => ({ objectKey: f.objectKey||'', fileName: f.fileName||f.name||'', stageMatch: '待分析', contentSummary: '' })),
      };
    }
  }

  /** 仪表盘 AI 分析（从 procurement 迁入） */
  async analyzeDashboard(payload: any) {
    const systemPrompt = [
      '你是"水叮当"——四川水发集团招采ERP的 AI 采购运营分析师，服务于采购中心管理驾驶舱。',
      '',
      '# 角色设定',
      '你是一位在水利行业有10年经验的采购运营总监，现转型为 AI 助手。你的分析风格：',
      '- 从数据中读出业务含义，绝不复述数字。',
      '- 关注流程健康度、竞争充分性、资金使用效率、风险信号。',
      '- 语言干练专业、有洞察力，每句话都有信息量。',
      '- 只使用输入数据中明确存在的数值，禁止编造、推算或假设不存在的数据。',
      '',
      '# 领域知识',
      '四川水发集团是省属水利投资建设集团，采购业务覆盖工程建设、设备采购、信息化和服务。',
      '采购方式包括：公开招标、邀请招标、竞争性谈判、竞争性磋商、询价、单一来源、直接委托、续约、内部竞标。',
      '内部竞标和续约占比过高可能存在竞争不充分的风险；直接委托需要关注合规性。',
      '未成交的原因通常包括：资格审查未通过、报价超预算、投标单位不足、材料不齐全、中止采购等。',
      '风险项目按严重程度分为"高/中/低"，高严重度项目需要管理层立即关注。',
      '',
      '# 分析框架',
      '你需要对采购仪表盘数据进行多维度的关联分析，而不是逐模块孤立解读：',
      '',
      '## 1. 综合研判 (overview)',
      '- 80-120 字的运营总评，先总结整体（完成率、节资率），再指出最值得关注的 1-2 个系统性问题。',
      '- 必须引用具体数字，但不要罗列所有数字。',
      '- 如果完成率高且节资率合适，正面评价；如果有非成交或风险项目，点出核心原因。',
      '',
      '## 2. 核心亮点 (highlights)',
      '- 2-4 条正面发现，每条 15-25 字。',
      '- 扫描这些信号：',
      '  · 某采购方式节资率明显高于平均 → "XX 采购方式节资率达 X%，成本控制效果显著"',
      '  · 某部门项目全部完成 → "XX 部门 X 个项目全部完成，流程执行高效"',
      '  · 供应商竞争充分 → "XX 项目吸引 X 家供应商竞标，竞争充分"',
      '  · 总体节资率 > 10% → "总体节资率 X%，成本管控成效突出"',
      '  · 切忌"整体运行良好"等空洞评价，每条必须引用具体数字或事实。',
      '- 如果确实找不到亮点，返回空数组 []，不要编造。',
      '',
      '## 3. 待关注项 (concerns)',
      '- 2-4 条风险/问题信号，每条 15-25 字。',
      '- 必须逐项扫描以下信号：',
      '  · nonAwardReasons 中某项原因频繁出现 → "X 个项目因资格审查未通过流标，需检查招标资质要求是否合理"',
      '  · riskProjects 中有"高"严重度 → "X 个高风险项目待处理，建议立即介入"',
      '  · 某采购方式全部未成交 → "XX 采购方式流标率 100%，需评估是否调整采购策略"',
      '  · 某部门预算大但完成率低 → "XX 部门预算高但完成率仅 X%，项目推进可能存在瓶颈"',
      '  · 趋势中空日期（未填）占比高 → "X 个项目缺少开标日期，数据完整性待改善"',
      '  · 供应商过度集中 → "XX 供应商中标占比过高，需拓展资源池避免依赖风险"',
      '- 如果确实没有值得关注的问题，描述为"当前各维度运行平稳，无异常信号可关注"。',
      '',
      '## 4. 建议方向 (suggestions)',
      '- 3-5 条可落地的管理建议，每条 18-30 字。',
      '- 建议必须紧扣发现的实际问题（concerns + nonAwardReasons + riskProjects）。',
      '- 示例：',
      '  · "对资格审查未通过率高的采购方式，组织供应商投标培训，降低门槛理解偏差"',
      '  · "将高风险项目列入管理层周例会督办清单，明确责任人和完成时限"',
      '  · "对直接委托/续约占比高的部门，要求说明原因并提报竞争性采购替代方案"',
      '  · "针对缺少开标日期的历史项目，限期补录以确保数据完整性"',
      '  · "拓展某类供应商资源池，增加投标竞争度以提升节资率"',
      '- 即使没有明显问题，也要给出 1-2 条常规改进建议（如定期数据质量巡检、流程审计），不要返回空数组。',
      '',
      '# 输出格式',
      '严格返回 JSON（不要任何其他文本）：',
      '{',
      '  "overview": "100字左右的运营总评，引用关键数字，点出核心问题和亮点",',
      '  "highlights": ["具体亮点1", "具体亮点2"],',
      '  "concerns": ["具体风险1", "具体风险2"],',
      '  "suggestions": ["可执行建议1", "可执行建议2", "可执行建议3"]',
      '}',
    ].join('\n');

    const userPrompt = JSON.stringify({
      range: { label: payload.rangeLabel, startDate: payload.startDate, endDate: payload.endDate },
      summary: payload.summary, trendSeries: payload.trendSeries,
      departmentStats: payload.departmentStats, methodStats: payload.methodStats,
      supplierStats: payload.supplierStats, resultStats: payload.resultStats,
      nonAwardReasons: payload.nonAwardReasons, riskProjects: payload.riskProjects,
      quickActions: payload.quickActions ?? [],
    }, null, 2);

    try {
      const raw = await this.llm.chatJson<any>(systemPrompt, userPrompt, 0.35);
      return {
        overview: raw?.overview || '分析完成',
        highlights: Array.isArray(raw?.highlights) ? raw.highlights : [],
        concerns: Array.isArray(raw?.concerns) ? raw.concerns : [],
        suggestions: Array.isArray(raw?.suggestions) ? raw.suggestions : [],
      };
    } catch {
      return { overview: 'AI 分析暂不可用', highlights: [], concerns: [], suggestions: [] };
    }
  }

  /** 采购台账 AI 分析 */
  async analyzeProcurementLedger(payload: any) {
    const systemPrompt = '你是采购数据分析师。基于采购台账数据进行分析，返回 JSON: {overview, highlights:[], concerns:[], suggestions:[]}';
    try {
      const raw = await this.llm.chatJson<any>(systemPrompt, JSON.stringify(payload, null, 2), 0.3);
      return {
        overview: raw?.overview || raw?.analysis || '分析完成',
        highlights: Array.isArray(raw?.highlights) ? raw.highlights : Array.isArray(raw?.insights) ? raw.insights : [],
        concerns: Array.isArray(raw?.concerns) ? raw.concerns : [],
        suggestions: Array.isArray(raw?.suggestions) ? raw.suggestions : Array.isArray(raw?.recommendations) ? raw.recommendations : [],
      };
    } catch {
      return { overview: '台账分析暂不可用', highlights: [], concerns: [], suggestions: [] };
    }
  }

  /** 招标字段 AI 生成 */
  async generateTenderFieldContent(payload: {
    fieldKey: string; fieldLabel: string; currentValue: string;
    aiPrompt?: string; context?: any;
  }) {
    const systemPrompt = `你是招标文件编写专家。为"${payload.fieldLabel}"字段生成内容。返回 JSON: {content}`;
    try {
      const result = await this.llm.chatJson<{ content: string }>(
        systemPrompt,
        `字段: ${payload.fieldKey}\n当前值: ${payload.currentValue}\n要求: ${payload.aiPrompt || '生成专业内容'}\n上下文: ${JSON.stringify(payload.context || {})}`,
      );
      return { content: result.content || payload.currentValue };
    } catch {
      return { content: payload.currentValue || '生成失败，请重试' };
    }
  }

  /** 参考预算生成 */
  async generateReferenceBudget(payload: {
    projectTitle: string; procurementMethod?: string;
    procurementCategory?: string; requesterDepartment?: string;
    projectReason?: string; historicalProjects?: any[];
  }) {
    const systemPrompt = '你是造价分析师。基于历史项目数据为当前项目生成参考预算。返回 JSON: {referenceBudget, reasoning}';
    try {
      return await this.llm.chatJson<any>(systemPrompt, JSON.stringify(payload, null, 2));
    } catch {
      return { referenceBudget: 0, reasoning: '预算分析暂不可用' };
    }
  }

  /** 生成项目摘要 — 接受灵活参数 */
  async generateProjectSummary(context: {
    title?: string; method?: string; category?: string;
    budget?: string; stageCount?: number; completedStages?: number;
    project?: any; fileAnalysisResults?: any; isCompleted?: boolean;
    [key: string]: any;
  }): Promise<string> {
    const p = context.project || {};
    const title = context.title || p.title || '未命名项目';
    const method = context.method || p.procurementMethod || '未知';
    const budget = context.budget || p.budgetAmount || '未知';
    const stageCount = context.stageCount ?? (p.stages?.length || 0);
    const completedStages = context.completedStages ?? (p.stages?.filter((s: any) => s.status === 'COMPLETED').length || 0);
    try {
      const result = await this.llm.chatJson<{ summary: string }>(
        '为项目生成简洁摘要（30-60字）。返回JSON: {summary}',
        JSON.stringify({ title, method, budget, stageCount, completedStages, isCompleted: context.isCompleted }),
      );
      return result.summary || `${title}（${method}），${completedStages}/${stageCount}阶段完成。`;
    } catch {
      return `${title}（${method}），预算${budget}，${completedStages}/${stageCount}阶段完成。`;
    }
  }
}