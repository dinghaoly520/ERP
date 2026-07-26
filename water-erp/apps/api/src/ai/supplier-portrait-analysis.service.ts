import { Injectable, Logger, Inject } from '@nestjs/common';
import type Redis from 'ioredis';
import { PrismaService } from '../prisma/prisma.service';
import { LlmService } from '../local-ai/llm.service';

const CACHE_PREFIX = 'supplier:portrait:analysis:';
const CACHE_TTL = 24 * 3600; // 24h；评价/资质变动时 cacheVer 改变即自然失效

export interface PortraitInsight {
  label: string;
  value: string;
  interpretation: string;
  tone: 'success' | 'warning' | 'accent' | 'danger';
  icon: string; // lucide icon name
}

export interface SupplierPortraitAnalysis {
  supplierId: string;
  supplierName: string;
  analyzedAt: string;
  engine?: 'deepseek' | 'rules'; // P1-21：标识本次分析由 LLM 还是规则兜底产生（前端据此显示透明徽章）
  overview: string;            // 1-2 段综合评价
  strengths: string[];         // 优势
  risks: string[];             // 风险点
  suggestions: string[];       // 改进建议
  metrics: PortraitInsight[];  // 关键指标卡片
  historySummary: string;      // 历史评价趋势
  suitableFor: string[];       // 适合的项目类型
}

@Injectable()
export class SupplierPortraitAnalysisService {
  private readonly logger = new Logger(SupplierPortraitAnalysisService.name);

  constructor(
    private prisma: PrismaService,
    private llm: LlmService,
    @Inject('REDIS_CLIENT') private redis: Redis,
  ) {}

  async analyze(supplierId: string): Promise<SupplierPortraitAnalysis> {
    const supplier = await this.prisma.supplier.findUnique({
      where: { id: supplierId },
      select: {
        id: true, name: true, enterpriseType: true, businessScope: true,
        creditCode: true, legalPerson: true, registeredAddress: true,
        status: true, createdAt: true,
        classification: { select: { name: true } },
        classificationLinks: { include: { classification: { select: { name: true } } } },
        qualifications: { select: { name: true, type: true, validFrom: true, validTo: true, status: true, updatedAt: true } },
        evaluations: {
          orderBy: { createdAt: 'desc' },
          select: { finalGrade: true, comment: true, completenessGrade: true, responsivenessGrade: true, cooperationGrade: true, complianceGrade: true, comprehensiveGrade: true, createdAt: true },
        },
        bidSuppliers: { select: { projectId: true } },
        contacts: { where: { isPrimary: true }, select: { name: true, phone: true } },
      },
    });
    if (!supplier) throw new Error('供应商不存在');

    const now = new Date();
    const qualValid = supplier.qualifications.filter(q => !q.validTo || new Date(q.validTo) >= now).length;
    const qualExpiring = supplier.qualifications.filter(q => q.validTo && new Date(q.validTo) >= now && new Date(q.validTo).getTime() - now.getTime() < 90 * 86400000).length;
    const qualExpired = supplier.qualifications.length - qualValid;

    // C2 缓存：版本号含「评价数 + 最新评价时间 + 资质有效/过期/即将到期数 + 最新资质 updatedAt」。
    // 此前 `??` 与三元混用优先级错误且 select 漏 updatedAt，导致资质编辑永不失效。资质过期会改变 qualExpired→key 变。
    const latestEvalAt = supplier.evaluations[0]?.createdAt?.getTime() ?? 0;
    const latestQualAt = supplier.qualifications.reduce(
      (m, q) => Math.max(m, q.updatedAt?.getTime() ?? (q.validTo ? new Date(q.validTo).getTime() : 0)),
      0,
    );
    const cacheVer = `${supplier.evaluations.length}-${latestEvalAt}-${qualValid}-${qualExpired}-${qualExpiring}-${latestQualAt}`;
    const cacheKey = CACHE_PREFIX + supplierId + ':' + cacheVer;
    try {
      const hit = await this.redis.get(cacheKey);
      if (hit) return JSON.parse(hit) as SupplierPortraitAnalysis;
    } catch { /* redis 不可用 → 跳过缓存，继续实时分析 */ }

    const evalCount = supplier.evaluations.length;
    const grades = supplier.evaluations.map(e => e.finalGrade);
    const recentEvals = supplier.evaluations.slice(0, 5).map(e => ({
      finalGrade: e.finalGrade,
      date: new Date(e.createdAt).toLocaleDateString('zh-CN'),
      dimensions: { completeness: e.completenessGrade, responsiveness: e.responsivenessGrade, cooperation: e.cooperationGrade, compliance: e.complianceGrade, comprehensive: e.comprehensiveGrade },
    }));

    const context = {
      供应商名称: supplier.name,
      企业类型: supplier.enterpriseType,
      统一社会信用代码: supplier.creditCode,
      法定代表人: supplier.legalPerson,
      注册地址: supplier.registeredAddress,
      经营范围: supplier.businessScope?.slice(0, 300),
      状态: supplier.status === 'APPROVED' ? '已入库' : supplier.status,
      注册时间: new Date(supplier.createdAt).toLocaleDateString('zh-CN'),
      运营天数: Math.floor((now.getTime() - new Date(supplier.createdAt).getTime()) / 86400000),
      分类标签: supplier.classificationLinks.map(l => l.classification.name),
      资质统计: { 总数: supplier.qualifications.length, 有效: qualValid, 即将到期: qualExpiring, 已过期: qualExpired },
      资质列表: supplier.qualifications.map(q => ({ 名称: q.name, 类型: q.type, 状态: q.status || (!q.validTo || new Date(q.validTo) >= now ? '有效' : '过期') })),
      评价统计: { 总次数: evalCount, 等级分布: supplier.evaluations.reduce((acc: Record<string,number>, e: any) => { const g = e.finalGrade; acc[g] = (acc[g] || 0) + 1; return acc; }, {} as Record<string, number>) },
      近期评价: recentEvals,
      参与项目数: supplier.bidSuppliers.length,
      主要联系人: supplier.contacts[0] ? { 姓名: supplier.contacts[0].name, 电话: supplier.contacts[0].phone } : null,
    };

    try {
      const result = await this.llm.chatJson<SupplierPortraitAnalysis>(
        PORTRAIT_SYSTEM_PROMPT,
        JSON.stringify(context, null, 2),
        0.3,
      );
      result.supplierId = supplierId;
      result.supplierName = supplier.name;
      result.analyzedAt = new Date().toISOString();
      result.engine = 'deepseek';
      try { await this.redis.set(cacheKey, JSON.stringify(result), 'EX', CACHE_TTL); } catch { /* ignore */ }
      return result;
    } catch (e: any) {
      this.logger.warn(`LLM portrait 分析失败，降级规则引擎: ${e.message}`);
      return this.fallback(supplier, evalCount, grades, qualValid, qualExpired, qualExpiring);
    }
  }

  private fallback(
    supplier: any, evalCount: number, grades: string[],
    qualValid: number, qualExpired: number, qualExpiring: number,
  ): SupplierPortraitAnalysis {
    const strengths: string[] = [];
    const risks: string[] = [];
    const suggestions: string[] = [];

    const aCount = grades.filter(g => g === 'A').length;
    const bCount = grades.filter(g => g === 'B').length;
    const eCount = grades.filter(g => g === 'E').length;
    const mostRecentGrade = grades[0] || 'C';
    const gradeSummary = grades.join(' → ');

    if (qualValid >= 3) strengths.push('资质材料较为齐全，覆盖多个业务领域');
    if (evalCount > 0 && (mostRecentGrade === 'A' || mostRecentGrade === 'B')) strengths.push('近期评价等级优良，履约质量可靠');
    if (supplier.bidSuppliers.length >= 3) strengths.push('项目参与经验丰富，响应积极');
    if (qualExpired > 0) { risks.push(`${qualExpired} 项资质已过期，影响投标资格`); suggestions.push('立即更新已过期资质，恢复投标资格'); }
    if (qualExpiring > 0) { risks.push(`${qualExpiring} 项资质即将到期`); suggestions.push('提前准备资质续期材料，避免到期被动'); }
    if (evalCount === 0) { risks.push('尚无评价记录，履约表现未知'); suggestions.push('尽快发起首次评价，建立履约档案'); }
    if (eCount > 0) { risks.push(`历史评价中出现 ${eCount} 次 E 级（不合格），履约质量需关注`); suggestions.push('对供应商进行专项辅导或启动绩效改进计划'); }
    if (supplier.bidSuppliers.length === 0) { risks.push('暂无项目参与记录'); suggestions.push('在匹配度合适时邀请该供应商参与项目'); }

    if (strengths.length === 0) strengths.push('具备基本资质，可参与一般性项目');

    return {
      supplierId: supplier.id,
      supplierName: supplier.name,
      analyzedAt: new Date().toISOString(),
      engine: 'rules',
      overview: `${supplier.name}（${supplier.enterpriseType}），${supplier.classificationLinks.map((l: any) => l.classification.name).join('、') || '未分类'}。注册 ${Math.floor((Date.now() - new Date(supplier.createdAt).getTime()) / 86400000)} 天，资质总数 ${supplier.qualifications.length} 项（有效 ${qualValid} 项${qualExpired > 0 ? `，过期 ${qualExpired} 项` : ''}）。${evalCount > 0 ? `累计 ${evalCount} 次评价，等级趋势 ${gradeSummary}。` : '暂无评价记录。'}参与 ${supplier.bidSuppliers.length} 个项目。`,
      strengths: strengths.slice(0, 4),
      risks: risks.slice(0, 4),
      suggestions: suggestions.slice(0, 4),
      metrics: [
        { label: '资质有效', value: `${qualValid}/${supplier.qualifications.length}`, interpretation: qualValid === supplier.qualifications.length ? '全部有效' : `${supplier.qualifications.length - qualValid} 项过期或即将到期`, tone: qualExpired === 0 ? 'success' : 'warning', icon: 'ShieldCheck' },
        { label: '综合评价', value: evalCount > 0 ? mostRecentGrade : '—', interpretation: evalCount > 0 ? (mostRecentGrade === 'A' || mostRecentGrade === 'B' ? '近期优良' : mostRecentGrade === 'C' ? '合格' : '需关注') : '暂无评价', tone: !evalCount ? 'accent' : (mostRecentGrade === 'A' || mostRecentGrade === 'B') ? 'success' : mostRecentGrade === 'C' ? 'accent' : 'warning', icon: 'Award' },
        { label: '项目参与', value: `${supplier.bidSuppliers.length}`, interpretation: supplier.bidSuppliers.length >= 5 ? '活跃供应商' : supplier.bidSuppliers.length > 0 ? '有项目经验' : '暂无项目', tone: supplier.bidSuppliers.length >= 3 ? 'success' : supplier.bidSuppliers.length > 0 ? 'accent' : 'warning', icon: 'FolderKanban' },
        { label: '评价次数', value: `${evalCount}`, interpretation: evalCount >= 3 ? '评价充分' : evalCount > 0 ? '有评价' : '无评价', tone: evalCount >= 3 ? 'success' : evalCount > 0 ? 'accent' : 'warning', icon: 'CheckCircle2' },
      ],
      historySummary: evalCount > 0 ? `累计 ${evalCount} 次评价，等级趋势 ${gradeSummary}` : '暂无评价记录',
      suitableFor: supplier.classificationLinks.length > 0 ? supplier.classificationLinks.slice(0, 3).map((l: any) => `${l.classification.name}类项目`) : ['通用项目'],
    };
  }
}

const PORTRAIT_SYSTEM_PROMPT = `你是采购专家评审系统的 AI 供应商画像分析助手。基于供应商档案数据，生成综合性画像分析报告。

输出严格 JSON（不要 markdown）：
{
  "overview": "1-2 段综合评价，包含企业基本信息、资质概况、评价概况、项目参与概况的关键数据",
  "strengths": ["优势1", "优势2", "…至多4条"],
  "risks": ["风险1", "风险2", "…至多4条"],
  "suggestions": ["建议1", "建议2", "…至多4条"],
  "metrics": [
    { "label": "指标名", "value": "指标值", "interpretation": "一句话解读", "tone": "success|warning|accent|danger", "icon": "Lucide图标名" }
  ],
  "historySummary": "近期评价趋势一句话",
  "suitableFor": ["适合参与的项目类型1", "类型2"]
}

tone 取值规则：success=良好/达标，warning=需关注/有风险，accent=中性/信息提示，danger=严重问题

指标建议（从数据中提取，不编造）：
- 资质有效数/总数
- 评价均分（无评价填 "—")
- 项目参与数
- 评价次数
- 运营天数（可选）

suitableFor：基于供应商分类标签和经营范围推荐适合的项目类型`;