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

  async analyze(supplierId: string, bypassCache = false): Promise<SupplierPortraitAnalysis> {
    const supplier = await this.prisma.supplier.findUnique({
      where: { id: supplierId },
      select: {
        id: true, name: true, enterpriseType: true, businessScope: true,
        creditCode: true, legalPerson: true, registeredAddress: true,
        status: true, isTemporary: true, tags: true, createdAt: true,
        classification: { select: { name: true } },
        classificationLinks: { include: { classification: { select: { name: true } } } },
        qualifications: { select: { name: true, type: true, validFrom: true, validTo: true, status: true, updatedAt: true } },
        evaluations: {
          orderBy: { createdAt: 'desc' },
          select: { finalGrade: true, comment: true, completenessGrade: true, responsivenessGrade: true, cooperationGrade: true, complianceGrade: true, comprehensiveGrade: true, createdAt: true },
        },
        bidSuppliers: { select: { projectId: true, project: { select: { name: true, projectCode: true } }, submitStatus: true, createdAt: true } },
        contacts: { select: { name: true, phone: true, email: true, position: true, isPrimary: true }, orderBy: { isPrimary: 'desc' } },
      },
    });
    if (!supplier) throw new Error('供应商不存在');

    const [catalogApps, contractPrices] = await Promise.all([
      this.prisma.supplierCatalogApplication.findMany({
        where: { supplierId },
        select: { catalogItem: { select: { name: true } }, proposedName: true, status: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.contractPrice.findMany({
        where: { supplierId },
        select: { catalogItem: { select: { name: true } }, agreedPrice: true, contractNo: true, validFrom: true, validUntil: true, status: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
      }),
    ]);

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
    if (!bypassCache) {
      try {
        const hit = await this.redis.get(cacheKey);
        if (hit) return JSON.parse(hit) as SupplierPortraitAnalysis;
      } catch { /* redis 不可用 → 跳过缓存，继续实时分析 */ }
    }

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
      账户性质: supplier.isTemporary ? '临时供应商（有限期）' : '正式入库供应商',
      业务标签: supplier.tags || [],
      分类标签: supplier.classificationLinks.map(l => l.classification.name),
      资质统计: { 总数: supplier.qualifications.length, 有效: qualValid, 即将到期: qualExpiring, 已过期: qualExpired },
      资质列表: supplier.qualifications.map(q => ({ 名称: q.name, 类型: q.type, 状态: q.status || (!q.validTo || new Date(q.validTo) >= now ? '有效' : '过期') })),
      联系人: supplier.contacts.map(c => ({ 姓名: c.name, 电话: c.phone, 邮箱: c.email, 职位: c.position, 主要联系人: c.isPrimary })),
      评价统计: { 总次数: evalCount, 等级分布: supplier.evaluations.reduce((acc: Record<string,number>, e: any) => { const g = e.finalGrade; acc[g] = (acc[g] || 0) + 1; return acc; }, {} as Record<string, number>) },
      近期评价: recentEvals,
      参与项目数: supplier.bidSuppliers.length,
      近期项目: supplier.bidSuppliers.slice(0, 10).map(bs => ({
        项目名称: bs.project.name,
        项目编号: bs.project.projectCode,
        投标状态: bs.submitStatus,
        参与时间: new Date(bs.createdAt).toLocaleDateString('zh-CN'),
      })),
      供货申请统计: { 总数: catalogApps.length, 已通过: catalogApps.filter(c => c.status === 'APPROVED').length, 审核中: catalogApps.filter(c => c.status === 'PENDING').length },
      近期供货申请: catalogApps.slice(0, 5).map(c => ({ 品类: c.catalogItem?.name || c.proposedName, 状态: c.status })),
      合同统计: { 总数: contractPrices.length, 有效: contractPrices.filter(c => c.status === 'ACTIVE').length },
      近期合同: contractPrices.slice(0, 5).map(c => ({ 品类: c.catalogItem?.name, 合同号: c.contractNo, 金额: c.agreedPrice, 状态: c.status, 有效期: c.validUntil ? new Date(c.validUntil).toLocaleDateString('zh-CN') : '—' })),
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
    const aCount = grades.filter(g => g === 'A').length;
    const bCount = grades.filter(g => g === 'B').length;
    const eCount = grades.filter(g => g === 'E').length;
    const mostRecentGrade = grades[0] || '—';
    const gradeSummary = grades.length > 0 ? grades.join(' → ') : '';
    const days = Math.floor((Date.now() - new Date(supplier.createdAt).getTime()) / 86400000);
    const tags = (supplier.tags || []) as string[];
    const classificationNames = supplier.classificationLinks.map((l: any) => l.classification.name);
    const primaryContact = supplier.contacts?.find((c: any) => c.isPrimary) || supplier.contacts?.[0];
    const contactDesc = primaryContact
      ? `${primaryContact.name}${primaryContact.position ? `（${primaryContact.position}）` : ''}，电话 ${primaryContact.phone}${primaryContact.email ? `，邮箱 ${primaryContact.email}` : ''}`
      : '暂无联系人';

    // 构建纯文字概述
    const parts: string[] = [];

    // 第1段：企业概况
    let p1 = `${supplier.name}，${supplier.enterpriseType}，法定代表人${supplier.legalPerson}，注册地址${supplier.registeredAddress}。`;
    p1 += `注册${days}天，系${supplier.isTemporary ? '临时供应商' : '正式入库供应商'}。`;
    if (tags.length > 0) p1 += `业务标签：${tags.join('、')}。`;
    if (classificationNames.length > 0) p1 += `分类归属：${classificationNames.join('、')}。`;
    p1 += `主要联系人：${contactDesc}。`;
    parts.push(p1);

    // 第2段：资质与评价
    let p2 = `资质共${supplier.qualifications.length}项，有效${qualValid}项`;
    if (qualExpiring > 0) p2 += `，${qualExpiring}项即将到期`;
    if (qualExpired > 0) p2 += `，${qualExpired}项已过期`;
    p2 += '。';
    if (evalCount > 0) {
      p2 += `累计${evalCount}次评价，等级分布：A级${aCount}次、B级${bCount}次${eCount > 0 ? `、E级${eCount}次` : ''}，最近一次${mostRecentGrade}级，趋势${gradeSummary}。`;
    } else {
      p2 += '暂无评价记录，服务水平待验证。';
    }
    parts.push(p2);

    // 第3段：合作
    let p3 = `参与项目${supplier.bidSuppliers.length}个`;
    const wonCount = supplier.bidSuppliers.filter((bs: any) => bs.submitStatus === '已提交').length;
    if (wonCount > 0) p3 += `，已投标${wonCount}个`;
    p3 += '。';
    if (supplier.catalogApps?.length > 0) {
      const approved = supplier.catalogApps.filter((c: any) => c.status === 'APPROVED').length;
      p3 += `供货申请${supplier.catalogApps.length}次（通过${approved}次）。`;
    }
    if (supplier.contracts?.length > 0) {
      p3 += `合同${supplier.contracts.length}份（有效${supplier.contracts.filter((c: any) => c.status === 'ACTIVE').length}份）。`;
    }
    parts.push(p3);

    const overview = parts.join('\n\n');

    // 优势/风险/建议
    const strengths: string[] = [];
    const risks: string[] = [];
    const suggestions: string[] = [];

    if (qualValid >= 3) strengths.push('资质材料较为齐全，覆盖多个业务领域');
    if (evalCount > 0 && (mostRecentGrade === 'A' || mostRecentGrade === 'B')) strengths.push('近期评价等级优良，履约质量可靠');
    if (supplier.bidSuppliers.length >= 3) strengths.push('项目参与经验丰富，响应积极');
    if (supplier.bidSuppliers.length >= 5) strengths.push('活跃供应商，合作基础扎实');
    if (supplier.catalogApps?.filter((c: any) => c.status === 'APPROVED').length >= 2) strengths.push('供货申请通过率较高，品类拓展积极');
    if (strengths.length === 0) strengths.push('具备基本资质，可参与一般性项目');

    if (qualExpired > 0) { risks.push(`${qualExpired}项资质已过期，影响投标资格`); suggestions.push('立即更新已过期资质，恢复投标资格'); }
    if (qualExpiring > 0) { risks.push(`${qualExpiring}项资质即将到期，需关注续期`); suggestions.push('提前准备资质续期材料，避免到期被动'); }
    if (evalCount === 0) { risks.push('尚无评价记录，履约表现未知'); suggestions.push('尽快发起首次评价，建立履约档案'); }
    if (eCount > 0) { risks.push(`历史评价中出现${eCount}次E级不合格记录，履约质量需关注`); suggestions.push('对供应商进行专项辅导或启动绩效改进计划'); }
    if (supplier.bidSuppliers.length === 0) { risks.push('暂无项目参与记录'); suggestions.push('在匹配度合适时邀请该供应商参与试点项目'); }
    if (tags.length === 0) { risks.push('业务标签为空，匹配项目时可能漏选'); suggestions.push('完善业务标签，提高采购系统中的可发现性'); }

    // 适合项目类型
    const suitableFor: string[] = [];
    if (tags.length > 0) suitableFor.push(...tags.map(t => `${t}类项目`));
    if (classificationNames.length > 0) suitableFor.push(...classificationNames.slice(0, 3).map((n: string) => `${n}类项目`));
    if (suitableFor.length === 0) suitableFor.push('通用项目');

    return {
      supplierId: supplier.id,
      supplierName: supplier.name,
      analyzedAt: new Date().toISOString(),
      engine: 'rules',
      overview,
      strengths: strengths.slice(0, 4),
      risks: risks.slice(0, 4),
      suggestions: suggestions.slice(0, 4),
      metrics: [
        { label: '资质有效', value: `${qualValid}/${supplier.qualifications.length}`, interpretation: qualExpired === 0 ? '全部有效' : `${qualExpired}项过期`, tone: qualExpired === 0 ? 'success' : 'warning', icon: 'ShieldCheck' },
        { label: '综合评价', value: evalCount > 0 ? mostRecentGrade : '—', interpretation: evalCount > 0 ? (mostRecentGrade === 'A' || mostRecentGrade === 'B' ? '近期优良' : mostRecentGrade === 'C' ? '合格' : '需关注') : '暂无评价', tone: !evalCount ? 'accent' : (mostRecentGrade === 'A' || mostRecentGrade === 'B') ? 'success' : mostRecentGrade === 'C' ? 'accent' : 'warning', icon: 'Award' },
        { label: '项目参与', value: `${supplier.bidSuppliers.length}`, interpretation: supplier.bidSuppliers.length >= 5 ? '活跃供应商' : supplier.bidSuppliers.length > 0 ? '有项目经验' : '暂无项目', tone: supplier.bidSuppliers.length >= 3 ? 'success' : supplier.bidSuppliers.length > 0 ? 'accent' : 'warning', icon: 'FolderKanban' },
        { label: '评价次数', value: `${evalCount}`, interpretation: evalCount >= 3 ? '评价充分' : evalCount > 0 ? '有评价' : '无评价', tone: evalCount >= 3 ? 'success' : evalCount > 0 ? 'accent' : 'warning', icon: 'CheckCircle2' },
      ],
      historySummary: evalCount > 0 ? `累计${evalCount}次评价，等级趋势${gradeSummary}` : '暂无评价记录',
      suitableFor: suitableFor.slice(0, 5),
    };
  }
}

const PORTRAIT_SYSTEM_PROMPT = `你是采购专家评审系统的 AI 供应商画像分析助手。基于供应商完整档案数据，生成一份纯粹的文本型综合分析报告。

输出严格 JSON（不要 markdown）：
{
  "overview": "3-4 段连续文字。第1段-企业概况：名称、类型、法人、注册地址、注册天数、正式/临时性质、业务标签、分类归属、联系人姓名/职位/电话。第2段-资质与评价：资质总数及有效/到期/过期明细，评价总次数/等级分布/趋势方向/均值。第3段-项目与供货合作：参与项目数、中标与否、供货申请状态、合同情况。第4段-综合评价与展望：结合以上数据做收尾点评。段落之间空行分隔，全文浑然一体，不使用小标题、编号或项目符号。",
  "strengths": ["优势描述1（完整句子，基于数据，不空泛）", "优势描述2", "…至多4条"],
  "risks": ["风险描述1（关注过期资质/评价下降/E级/零项目等）", "…至多4条"],
  "suggestions": ["改进建议1（可操作，如联系XX人做XX）", "…至多4条"],
  "metrics": [
    { "label": "指标名", "value": "值", "interpretation": "一句话解读", "tone": "success|warning|accent|danger", "icon": "Lucide图标名" }
  ],
  "historySummary": "1-2句评价趋势总结，无评价时写'暂无评价记录'",
  "suitableFor": ["项目类型1", "类型2", "…至多5个"]
}

要求：
- overview 是完整的文字段落，覆盖所有维度，不用标题分段
- strengths/risks/suggestions 每条均为完整通顺的中文句子，读起来像报告正文的一部分
- suitableFor 基于业务标签+经营范围+分类标签推荐
- 所有内容纯文本，不使用 markdown 格式`;