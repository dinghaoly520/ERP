import { Injectable, Logger, Inject } from '@nestjs/common';
import type Redis from 'ioredis';
import { ExpertLevel } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { LlmService } from '../local-ai/llm.service';

const EVAL_CACHE_PREFIX = 'supplier:evaluation:analysis:';
const EVAL_CACHE_TTL = 24 * 3600;

/** AI 对供应商某维度的评价建议 */
export interface DimensionAnalysis {
  dimension: string;       // 维度名称
  suggestedGrade: ExpertLevel;  // 建议等级
  rationale: string;       // 评分依据
  evidencePoints: string[]; // 支撑数据点
}

export interface EvaluationAnalysisResult {
  supplierId: string;
  supplierName: string;
  analyzedAt: string;
  engine?: 'deepseek' | 'rules'; // P1-21：LLM 还是规则兜底
  dimensions: DimensionAnalysis[];
  overallGrade: ExpertLevel;  // 综合建议等级
  summary: string;            // 综合摘要
}

const GRADE_SCORE: Record<ExpertLevel, number> = { A: 5, B: 4, C: 3, D: 2, E: 1 };
const SCORE_GRADE: Record<number, ExpertLevel> = { 5: 'A', 4: 'B', 3: 'C', 2: 'D', 1: 'E' };

@Injectable()
export class SupplierEvaluationAnalysisService {
  private readonly logger = new Logger(SupplierEvaluationAnalysisService.name);

  constructor(
    private prisma: PrismaService,
    private llm: LlmService,
    @Inject('REDIS_CLIENT') private redis: Redis,
  ) {}

  async analyze(supplierId: string): Promise<EvaluationAnalysisResult> {
    // 收集供应商数据
    const supplier = await this.prisma.supplier.findUnique({
      where: { id: supplierId },
      select: {
        id: true, name: true, enterpriseType: true, businessScope: true,
        classification: { select: { name: true } },
        qualifications: {
          select: { name: true, type: true, validFrom: true, validTo: true, status: true, updatedAt: true },
        },
        evaluations: {
          orderBy: { createdAt: 'desc' },
          take: 5,
          select: { finalGrade: true, comment: true, completenessGrade: true, responsivenessGrade: true, cooperationGrade: true, complianceGrade: true, comprehensiveGrade: true, createdAt: true, updatedAt: true },
        },
        bidSuppliers: { select: { id: true, projectId: true } },
      },
    });
    if (!supplier) throw new Error('供应商不存在');

    // 收集资质状态统计
    const now = new Date();
    const qualStats = {
      total: supplier.qualifications.length,
      valid: supplier.qualifications.filter(q => !q.validTo || new Date(q.validTo) >= now).length,
      expired: supplier.qualifications.filter(q => q.validTo && new Date(q.validTo) < now).length,
    };

    // C2 缓存：版本号含资质状态(valid/expired) + 最新资质/评价 updatedAt，避免资质编辑/自然过期/评价改写后脏缓存。
    const latestEvalAt = supplier.evaluations[0]?.createdAt?.getTime() ?? 0;
    const latestEvalUpd = supplier.evaluations.reduce((m, e) => Math.max(m, e.updatedAt?.getTime() ?? 0), 0);
    const latestQualUpd = supplier.qualifications.reduce((m, q) => Math.max(m, q.updatedAt?.getTime() ?? 0), 0);
    const evalCacheKey = `${EVAL_CACHE_PREFIX}${supplierId}:${supplier.evaluations.length}-${latestEvalAt}-${latestEvalUpd}-${qualStats.valid}-${qualStats.expired}-${latestQualUpd}`;
    try {
      const hit = await this.redis.get(evalCacheKey);
      if (hit) return JSON.parse(hit) as EvaluationAnalysisResult;
    } catch { /* redis 不可用 → 跳过缓存 */ }

    // 历史评价汇总
    const evalSummary = supplier.evaluations.length > 0 ? {
      count: supplier.evaluations.length,
      grades: supplier.evaluations.map(e => e.finalGrade).join(' → '),
      latestComment: supplier.evaluations[0]?.comment || '',
    } : null;

    const context = {
      供应商名称: supplier.name,
      企业类型: supplier.enterpriseType,
      经营范围: supplier.businessScope?.slice(0, 200),
      分类: supplier.classification?.name || '未分类',
      资质统计: `共 ${qualStats.total} 项，有效 ${qualStats.valid} 项，过期 ${qualStats.expired} 项`,
      历史评价: evalSummary
        ? `${evalSummary.count} 次，等级趋势 ${evalSummary.grades}`
        : '暂无评价记录',
      参与项目数: supplier.bidSuppliers.length,
    };

    try {
      const analysis = await this.llm.chat(
        EVAL_ANALYSIS_SYSTEM_PROMPT,
        JSON.stringify(context, null, 2),
        0.3,
      );

      // 解析 LLM 返回的 JSON
      const jsonMatch = analysis.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        const validGrades = new Set(['A', 'B', 'C', 'D', 'E']);
        const safeDimensions = (parsed.dimensions || []).map((d: any) => ({
          ...d,
          suggestedGrade: validGrades.has(d.suggestedGrade) ? d.suggestedGrade : 'C',
          rationale: (d.rationale || '').replace(/[。，,.\s]+$/g, ''),
        }));
        const overallGrade = validGrades.has(parsed.overallGrade) ? parsed.overallGrade : 'C';
        const result: EvaluationAnalysisResult = {
          supplierId,
          supplierName: supplier.name,
          analyzedAt: new Date().toISOString(),
          engine: 'deepseek',
          dimensions: safeDimensions.length ? safeDimensions : this.fallback(supplier).dimensions,
          overallGrade: overallGrade as ExpertLevel,
          summary: parsed.summary || 'AI 分析已完成，请参考各维度建议',
        };
        try { await this.redis.set(evalCacheKey, JSON.stringify(result), 'EX', EVAL_CACHE_TTL); } catch { /* ignore */ }
        return result;
      }
    } catch (e: any) {
      this.logger.warn(`LLM 分析失败，降级为规则引擎: ${e.message}`);
    }

    return this.fallback(supplier);
  }

  /** 规则引擎兜底：基于供应商数据生成评价等级建议 */
  private fallback(supplier: any): EvaluationAnalysisResult {
    const qualValid = supplier.qualifications.filter((q: any) => !q.validTo || new Date(q.validTo) >= new Date()).length;
    const qualTotal = supplier.qualifications.length;
    const hasEvals = supplier.evaluations.length > 0;
    // 取近期评价综合等级的中位数等级
    const recentGrades: ExpertLevel[] = supplier.evaluations.slice(0, 3).map((e: any) => e.finalGrade || e.completenessGrade || 'C');
    const recentAvgScore = recentGrades.length
      ? recentGrades.reduce((s: number, g: ExpertLevel) => s + (GRADE_SCORE[g] ?? 3), 0) / recentGrades.length
      : 3;
    const projects = supplier.bidSuppliers.length;

    const qualCompletenessGrade = qualTotal > 0
      ? (qualValid === qualTotal ? 'A' : qualValid >= qualTotal * 0.6 ? 'B' : qualValid >= qualTotal * 0.3 ? 'C' : qualValid >= qualTotal * 0.1 ? 'D' : 'E') as ExpertLevel
      : 'E' as ExpertLevel;
    const responsivenessGrade = projects >= 5 ? 'A' : projects >= 3 ? 'B' : projects >= 1 ? 'C' : projects > 0 ? 'D' : 'E' as ExpertLevel;
    const cooperationGrade = hasEvals
      ? (recentAvgScore >= 4 ? 'A' : recentAvgScore >= 3 ? 'B' : recentAvgScore >= 2 ? 'C' : recentAvgScore >= 1.5 ? 'D' : 'E') as ExpertLevel
      : 'C' as ExpertLevel;
    const complianceGrade = qualValid >= qualTotal
      ? 'A' : qualValid >= qualTotal * 0.8 ? 'B' : qualValid >= qualTotal * 0.5 ? 'C' : qualValid >= qualTotal * 0.2 ? 'D' : 'E' as ExpertLevel;
    const comprehensiveGrade = hasEvals
      ? (recentAvgScore >= 4 ? 'A' : recentAvgScore >= 3 ? 'B' : recentAvgScore >= 2 ? 'C' : recentAvgScore >= 1.5 ? 'D' : 'E') as ExpertLevel
      : 'C' as ExpertLevel;

    const dimensions: DimensionAnalysis[] = [
      {
        dimension: '资料完整性(20%)',
        suggestedGrade: qualCompletenessGrade,
        rationale: `共有 ${qualTotal} 项资质材料，其中 ${qualValid} 项在有效期内` + (qualValid === qualTotal ? '，资质齐全' : '，部分资质已过期或即将到期'),
        evidencePoints: supplier.qualifications.slice(0, 3).map((q: any) => `${q.type}: ${q.name}（${!q.validTo || new Date(q.validTo) >= new Date() ? '有效' : '过期'}）`),
      },
      {
        dimension: '响应及时性(30%)',
        suggestedGrade: responsivenessGrade,
        rationale: projects > 0 ? `参与了 ${projects} 个项目，具备项目响应经验` : '暂无项目参与记录，无法评估响应速度',
        evidencePoints: projects > 0 ? [`累计参与 ${projects} 个招标项目`] : ['暂无项目参与数据'],
      },
      {
        dimension: '配合协作(20%)',
        suggestedGrade: cooperationGrade,
        rationale: hasEvals ? `近期评价综合等级均分 ${recentAvgScore.toFixed(1)}（5=A/4=B/3=C/2=D/1=E），反映了一定程度的协作配合` : '暂无评价数据，建议首次评价设为 C 级基准',
        evidencePoints: hasEvals ? supplier.evaluations.slice(0, 2).map((e: any) => `${new Date(e.createdAt).toLocaleDateString('zh-CN')} 综合评价 ${e.finalGrade} 级`) : ['暂无历史评价'],
      },
      {
        dimension: '合规守信(20%)',
        suggestedGrade: complianceGrade,
        rationale: qualValid >= qualTotal ? '资质全部在有效期内，无过期记录' : `${qualTotal - qualValid} 项资质已过期，存在合规风险`,
        evidencePoints: [`${qualValid}/${qualTotal} 项资质有效`, `企业类型：${supplier.enterpriseType}`],
      },
      {
        dimension: '综合评价(10%)',
        suggestedGrade: comprehensiveGrade,
        rationale: hasEvals ? `综合近期 ${Math.min(3, supplier.evaluations.length)} 次评价数据得出的参考等级` : '无评价记录，综合满意度默认为 C 级基准',
        evidencePoints: hasEvals ? ['基于历史评价数据加权计算'] : ['首次评价，无历史参考'],
      },
    ];

    const gradeScores = dimensions.map(d => GRADE_SCORE[d.suggestedGrade]);
    const weighted =
      gradeScores[0] * 0.2 + gradeScores[1] * 0.3 + gradeScores[2] * 0.2 + gradeScores[3] * 0.2 + gradeScores[4] * 0.1;
    const overallGrade = SCORE_GRADE[Math.round(weighted)];

    return {
      supplierId: supplier.id,
      supplierName: supplier.name,
      analyzedAt: new Date().toISOString(),
      dimensions,
      overallGrade,
      engine: 'rules',
      summary: `基于 ${qualTotal} 项资质、${projects} 个项目、${supplier.evaluations.length} 次评价记录的规则分析。建议综合等级 ${overallGrade} 级。`,
    };
  }
}

const EVAL_ANALYSIS_SYSTEM_PROMPT = `你是采购专家评审系统的 AI 评价助手。基于供应商档案数据，为五维等级（A/B/C/D/E）生成可直接填入评价表单的建议。

等级含义：
- A 级（优秀）：表现卓越，远超预期
- B 级（良好）：表现稳定，满足要求
- C 级（合格）：基本达标，可继续合作
- D 级（待改进）：存在明显不足，需要专项提升
- E 级（不合格）：严重不达标，建议触发淘汰预警

工作方式：
1. 分析供应商的资质材料、历史评价记录、项目参与数据、经营范围
2. 对每个维度输出：建议等级（A|B|C|D|E）、评分依据（1-2 句，可直接作为评价理由）、支撑数据点列表（每条 10-30 字，具体可引用到评价依据文本中）

输出严格 JSON（不要 markdown 代码块包裹，直接输出纯 JSON）：
{
  "dimensions": [
    {
      "dimension": "资料完整性(20%)",
      "suggestedGrade": "B",
      "rationale": "该供应商提供了工程设计、工程勘察、测绘等多项资质文件，其中 3 项在有效期内、1 项即将到期，整体资质覆盖主要业务领域，属于良好水平。",
      "evidencePoints": [
        "持有工程设计资质证书（有效，至 2027-12-31）",
        "持有工程勘察资质证书（有效，至 2026-09-15）",
        "乙级测绘资质即将到期（2026-11-01），建议提醒续期",
        "企业信用代码 91510100633140521E 已核验"
      ]
    }
  ],
  "overallGrade": "B",
  "summary": "综合资质、历史表现与项目参与情况，该供应商整体资质较完整、合规记录良好，但因项目参与记录较少，响应及时性和配合协作度建议良好。建议综合等级 B 级。"
}

维度说明：
- 资料完整性(20%)：资质文件数量、有效性、是否覆盖经营范围——越多有效资质等级越高
- 响应及时性(30%)：项目参与数反映响应实践——参与项目越多等级越高；无项目参与时给 D 级
- 配合协作(20%)：历史评价中的合作相关等级——无评价时给 C 级基准；有评价则参考近期等级
- 合规守信(20%)：资质过期情况、企业登记信息完整性——资质全部有效得 A/A-，有过期资质的酌情降级
- 综合评价(10%)：总览全貌的综合判断——有正面历史评价且资质齐全得 A/B 级，信息不足给 C/D 级

注意：
- dimension 字段值必须与上述五个维度名称完全一致（含权重百分比后缀）
- 有历史评价时，rationale 必须引用具体评价数据（日期/等级）
- evidencePoints 每项单独一行，是可直接粘贴到评价依据栏的完整句子
- overallGrade 是五个维度等级加权后的综合等级（A=5/B=4/C=3/D=2/E=1，加权取整）`;
