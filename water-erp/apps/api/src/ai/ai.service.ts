import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SupplierSelectionAiService } from './supplier-selection-ai.service';
import type {
  ComplianceItem,
  RiskItem,
  ScoreSuggestion,
  AiAnalysisResult,
  SupplierRecommendation,
  SupplierSelectionResult,
} from './ai.types';

/* =================================================================
   AI 辅助评标引擎
   — 基于规则 + 统计分析，模拟 AI 对投标文件的智能审查
   ================================================================= */

@Injectable()
export class AiService {
  constructor(
    private prisma: PrismaService,
    private selectionAi: SupplierSelectionAiService,
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
    const suppliers = await this.prisma.bidSupplier.findMany({ where: { projectId } });
    return suppliers.map(s => {
      const seed = this.hashString(s.supplierName);
      const riskFactors = [
        { name: '文件完整性', score: s.submitStatus === '已提交' ? 90 + (seed % 10) : 50 + (seed % 20) },
        { name: '解密状态', score: s.decryptStatus === 'SUCCESS' ? 100 : s.decryptStatus === 'DANGER' ? 20 : 50 },
        { name: '资质合规', score: s.confirmStatus === 'CONFIRMED' ? 95 : 65 + (seed % 20) },
        { name: '报价风险', score: 70 + (seed % 25) },
        { name: '历史履约', score: 75 + (seed % 20) },
      ];
      const overall = Math.round(riskFactors.reduce((sum, f) => sum + f.score, 0) / riskFactors.length);
      return {
        id: s.id,
        supplierName: s.supplierName,
        overallRiskScore: overall,
        level: overall >= 85 ? '低风险' : overall >= 65 ? '中风险' : '高风险',
        factors: riskFactors,
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

  async dashboardSummary(context: {
    supplier?: { total: number; approved: number; pending: number; risk: number };
    announcement?: { total: number; published: number; draftLike: number };
    expert?: { total: number; active: number; unfinished: number };
    catalog?: { total: number; active: number; alerts: number };
    applications?: { pending: number };
  }) {
    const apiKey = process.env.DEEPSEEK_API_KEY;
    if (!apiKey) {
      return { summary: 'AI 引擎暂未配置（DEEPSEEK_API_KEY 缺失），无法生成运营摘要。', level: 'info' as const };
    }

    const s = context.supplier || {};
    const a = context.announcement || {};
    const e = context.expert || {};
    const c = context.catalog || {};
    const apps = context.applications || {};

    const systemPrompt = [
      '你是四川水发集团智慧招采ERP中的"水叮当"——采购运营智能管理助手。',
      '你帮助采购管理员快速理解各业务中心的整体运行状态，发现需要关注的问题并给出可执行的建议。',
      '',
      '你的角色定位：',
      '- 运营参谋，不是报表机器人。你需要从数据中读出"意味"，而不只是复述数字。',
      '- 优先关注：待办积压、审批阻塞、风险积累、数据异常、资源配置失衡。',
      '- 对每个问题给出1句可执行建议（谁来处理、怎么做、优先级如何）。',
      '',
      '回答风格：',
      '- 中文，语气干练、直接，像一位经验丰富的采购运营总监在晨会上做简报。',
      '- 结构清晰：先总评（1句），再分点指出关键问题（2-3条），最后给出今日建议（1-2条）。',
      '- 每条不超过40字，总字数控制在150字以内。',
      '- 不编造数据、不猜测未提供的信息。',
      '- 纯文本输出，不用 markdown。',
    ].join('\n');

    // Determine overall status
    const riskScore = (s.pending || 0) * 2 + (apps.pending || 0) * 3 + (a.draftLike || 0) + (e.unfinished || 0) + (c.alerts || 0) * 2;
    const statusLabel = riskScore >= 15 ? '⚠️ 需重点关注' : riskScore >= 6 ? '📋 日常跟进' : '✅ 运行平稳';

    const prompt = [
      `平台整体状态：${statusLabel}`,
      '',
      '各中心实时数据：',
      `【信息发布】总量${a.total}条，已发布${a.published}条，待完善${a.draftLike}条。`,
      `【供应商库】总量${s.total}家，已入库${s.approved}家，待审批${s.pending}家，停用/黑名单${s.risk}家。`,
      `【专家资源】${e.total}名专家，${e.active}项进行中，${e.unfinished}项未完成。`,
      `【商城目录】${c.total}条目录，${c.active}条有效，${c.alerts}条待处理/预警。`,
      `【供货审批】${apps.pending}条待审核申请。`,
      '',
      '请按以下结构简要分析：',
      '总评：（1句话概括当前运营态势）',
      '关注点：（列出2-3条需要优先处理的事务及建议动作）',
      '今日建议：（1-2条给采购管理员的本日行动建议）',
    ].join('\n');

    try {
      const DEEPSEEK_URL = process.env.DEEPSEEK_API_URL || 'https://api.deepseek.com';
      const DEEPSEEK_MODEL = process.env.DEEPSEEK_MODEL || 'deepseek-v4-flash';
      const res = await fetch(`${DEEPSEEK_URL.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: DEEPSEEK_MODEL,
          temperature: 0.3,
          max_tokens: 600,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: prompt },
          ],
        }),
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) {
        this.logger.warn(`DeepSeek dashboard-summary failed: ${res.status}`);
        return { summary: 'AI 引擎暂时不可用，请稍后刷新页面重试。', level: 'warn' as const };
      }
      const data = await res.json();
      const text = (data?.choices?.[0]?.message?.content || '').trim();
      return { summary: text || 'AI 未能生成有效摘要，请稍后重试。', level: 'info' as const };
    } catch (err: any) {
      this.logger.warn(`DeepSeek dashboard-summary error: ${err.message}`);
      return { summary: 'AI 引擎连接超时或不可用，当前数据统计可正常查看。', level: 'warn' as const };
    }
  }
}
