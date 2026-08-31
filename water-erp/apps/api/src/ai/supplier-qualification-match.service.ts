import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { LlmService } from '../local-ai/llm.service';

/**
 * 供应商资格符合性分析（供应商邀请·审核候选 → 详情页右栏）：
 * 对照本次采购的资格条件（BidProject.qualification / PMI.supplierRequirements），
 * 用供应商库内资料逐条判定。
 *
 * 稳定性设计（严格限制输出）：LLM 只输出结构化判定
 * （第几条 → 状态 + 证据类型 + 引用清单条目名），依据文本、总结、风险提示、
 * 置信度全部由后端按固定模板生成——同一供应商+项目的报告文本完全一致，
 * 消除 LLM 逐次措辞漂移。LLM 不可用回退确定性关键词粗判。
 */

export interface QualificationMatchItem {
  requirement: string;
  status: '符合' | '不符合' | '待核实';
  evidence: string;
}

export interface QualificationMatchResult {
  conclusion: '符合' | '部分符合' | '不符合';
  confidence: number;
  items: QualificationMatchItem[];
  summary: string;
  risks: string[];
  source: 'ai' | 'fallback';
}

/** 证据类型（LLM 只能从中选择；对应固定句式模板） */
type EvidenceType = 'qualification' | 'scope' | 'performance' | 'capital' | 'none';
const EVIDENCE_TYPES: EvidenceType[] = ['qualification', 'scope', 'performance', 'capital', 'none'];

@Injectable()
export class SupplierQualificationMatchService {
  private readonly logger = new Logger(SupplierQualificationMatchService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly llm: LlmService,
  ) {}

  /** 拆分资格条件文本为逐条要求（分号/句号/序号分隔，供逐条对照） */
  private splitRequirements(text: string): string[] {
    return text
      .split(/[；;\n]|(?<=。)/)
      .map((t) => t.replace(/^(?:\d+[.、．]|[（(]\d+[)）]|[一二三四五六七八九十]+[、.．])\s*/, '').trim())
      .filter((t) => t.length >= 4)
      .slice(0, 12);
  }

  // ── 固定模板区：所有输出文本由以下句式拼装，LLM 不产自由文本 ──

  private evidenceText(
    type: EvidenceType,
    refs: string[],
    ctx: {
      qualifications: Array<{ name: string; validTo: Date | null }>;
      performances: Array<{ projectName: string; signDate: Date | null }>;
      registeredCapital: string | null;
    },
  ): string {
    switch (type) {
      case 'qualification': {
        const quals = refs
          .map((name) => ctx.qualifications.find((q) => q.name === name))
          .filter((q): q is { name: string; validTo: Date | null } => !!q);
        if (quals.length === 0) return '库内资料未见直接对应项，需人工核验或要求供应商补充';
        return quals
          .map((q) => `持有资质「${q.name}」${q.validTo ? `（有效期至 ${q.validTo.toISOString().slice(0, 10)}）` : '（长期有效）'}`)
          .join('；');
      }
      case 'performance': {
        const perfs = refs
          .map((name) => ctx.performances.find((p) => p.projectName === name))
          .filter((p): p is { projectName: string; signDate: Date | null } => !!p);
        if (perfs.length === 0) return '库内资料未见直接对应项，需人工核验或要求供应商补充';
        return perfs.map((p) => `具有同类业绩「${p.projectName}」${p.signDate ? `（${p.signDate.toISOString().slice(0, 10)}）` : ''}`).join('；');
      }
      case 'scope':
        return '经营范围涵盖该要求所述业务范围';
      case 'capital':
        return ctx.registeredCapital ? `注册资本 ${ctx.registeredCapital}，满足注册资本要求` : '注册资本信息库内未登记，需人工核验';
      case 'none':
      default:
        return '库内资料未见直接对应项，需人工核验或要求供应商补充';
    }
  }

  /** 统计驱动的固定总结与结论（不由 LLM 生成） */
  private buildVerdict(items: QualificationMatchResult['items']) {
    const met = items.filter((i) => i.status === '符合').length;
    const pending = items.filter((i) => i.status === '待核实').length;
    const fail = items.filter((i) => i.status === '不符合').length;
    const total = items.length;
    const conclusion: QualificationMatchResult['conclusion'] = fail > 0 ? '不符合' : pending > 0 ? '部分符合' : '符合';
    const summary =
      `共 ${total} 项资格条件：${met} 项符合、${pending} 项待核实${fail > 0 ? `、${fail} 项不符合` : ''}。` +
      (conclusion === '符合'
        ? '库内资料显示该供应商满足本项目全部资格条件。'
        : conclusion === '部分符合'
          ? '其余条件建议要求供应商补充证明材料后人工核验。'
          : '库内资料显示存在不满足项，建议不予通过资格审查或要求供应商澄清。');
    return { conclusion, summary, confidence: total > 0 ? Math.round((met / total) * 100) / 100 : 0 };
  }

  /** 规则化风险提示（确定性生成，不由 LLM 生成） */
  private buildRisks(items: QualificationMatchResult['items'], expiredQuals: number): string[] {
    const risks: string[] = [];
    if (expiredQuals > 0) risks.push(`${expiredQuals} 项资质证书已过有效期，须要求供应商更新后方可采信`);
    if (items.some((i) => i.status === '待核实')) risks.push('存在待核实项，建议要求供应商补充证明材料后人工核验');
    if (items.some((i) => i.status === '不符合')) risks.push('存在不符合项，资格审查环节应重点复核');
    risks.push('本分析基于库内静态资料，最终资格认定以资格审查结果为准');
    return risks;
  }

  async analyze(supplierId: string, projectId: string): Promise<QualificationMatchResult & { supplierName: string; projectName: string }> {
    const supplier = await this.prisma.supplier.findUnique({
      where: { id: supplierId },
      select: {
        name: true, businessScope: true, registeredCapital: true, enterpriseType: true,
        tags: true, industry: true, region: true,
        qualifications: { select: { name: true, type: true, validFrom: true, validTo: true, status: true } },
        performances: { orderBy: { createdAt: 'desc' }, take: 8, select: { projectName: true, recordType: true, contractAmount: true, signDate: true, clientName: true } },
        evaluations: { orderBy: { createdAt: 'desc' }, take: 5, select: { finalGrade: true, comment: true } },
      },
    });
    if (!supplier) throw new BadRequestException({ error: '供应商不存在', code: 'NOT_FOUND' });

    const bp = await this.prisma.bidProject.findUnique({
      where: { id: projectId },
      select: { id: true, name: true, projectCode: true, procurementMethod: true, qualification: true },
    }).catch(() => null)
      .then((r) => r ?? this.prisma.bidProject.findFirst({
        where: { projectManagementItemId: projectId },
        select: { id: true, name: true, projectCode: true, procurementMethod: true, qualification: true },
      }));
    if (!bp) throw new BadRequestException({ error: '采购项目不存在', code: 'NOT_FOUND' });
    const pmi = await this.prisma.projectManagementItem.findFirst({
      where: { bidProjects: { some: { id: bp.id } } },
      select: { supplierRequirements: true },
    });
    const requirementText = (bp.qualification || pmi?.supplierRequirements || '').trim();
    if (!requirementText) {
      throw new BadRequestException({ error: '本项目未设置资格条件，无法进行符合性分析', code: 'NO_REQUIREMENT' });
    }
    const requirements = this.splitRequirements(requirementText);

    const now = new Date();
    const expiredQuals = supplier.qualifications.filter((q) => q.validTo && q.validTo < now).length;
    const evidenceCtx = {
      qualifications: supplier.qualifications,
      performances: supplier.performances,
      registeredCapital: supplier.registeredCapital,
    };

    let items: Array<{ requirement: string; status: QualificationMatchItem['status']; type: EvidenceType; refs: string[] }>;
    let source: 'ai' | 'fallback' = 'ai';
    try {
      // 资质/业绩带固定编号（Q1…/P1…），LLM 引用时逐字复制名称——杜绝改写漂移
      const qualList = supplier.qualifications.map((q, i) => `Q${i + 1} ${q.name}${q.validTo ? `（有效期至 ${q.validTo.toISOString().slice(0, 10)}${q.validTo < now ? '，已过期' : ''}）` : '（长期有效）'}`);
      const perfList = supplier.performances.map((p, i) => `P${i + 1} ${p.projectName}${p.signDate ? `（${p.signDate.toISOString().slice(0, 10)}）` : ''}`);
      const userPrompt = [
        `采购项目：${bp.name}（${bp.procurementMethod}）`,
        '资格条件清单：',
        ...requirements.map((r, i) => `${i + 1}. ${r}`),
        '',
        '供应商库内资料：',
        `- 企业类型：${supplier.enterpriseType}${supplier.registeredCapital ? `；注册资本：${supplier.registeredCapital}` : ''}${supplier.industry ? `；所属行业：${supplier.industry}` : ''}`,
        `- 经营范围：${supplier.businessScope.slice(0, 1000)}`,
        ...(qualList.length ? ['- 资质清单：', ...qualList] : ['- 资质清单：（无）']),
        ...(perfList.length ? ['- 业绩清单：', ...perfList] : ['- 业绩清单：（无）']),
        '',
        '对每条资格条件输出一个判定对象，规则：',
        '- status：库内资料明确覆盖该要求=「符合」；有证据明确表明不满足（如资质已过期、注册资本低于门槛、经营范围明确不含）=「不符合」；仅是库内没有相关资料（未上传、未登记）=「待核实」，不得判「不符合」；',
        '- evidenceType：符合时选最主要依据类型——资质=qualification / 经营范围=scope / 业绩=performance / 注册资本=capital；不符合或待核实选 none；',
        '- refs：逐字复制上清单中的名称（不含 Q/P 编号），最多 2 个；evidenceType 为 none 时 refs 必须为空数组；严禁改写或编造清单中不存在的名称；',
        '- 已过有效期的资质不得作为「符合」依据。',
        '输出 json：{"items":[{"index":1,"status":"符合","evidenceType":"qualification","refs":["资质名称"]}]}，items 与资格条件清单一一对应、顺序一致、数量相等。',
      ].join('\n');
      const ai = await this.llm.chatJson<{ items?: Array<{ index?: number; status?: string; evidenceType?: string; refs?: unknown }> }>(
        '你是采购资格审查审查员，只做逐条对照判定，严格按指定 json 结构输出，不添加任何解释。',
        userPrompt,
        0,
      );
      const parsed = (ai?.items ?? [])
        .map((it) => ({
          requirement: '',
          status: (['符合', '不符合', '待核实'].includes(String(it?.status)) ? it.status : '待核实') as QualificationMatchItem['status'],
          type: (EVIDENCE_TYPES.includes(String(it?.evidenceType) as EvidenceType) ? it.evidenceType : 'none') as EvidenceType,
          refs: Array.isArray(it?.refs) ? it.refs.map((r) => String(r)).filter(Boolean).slice(0, 2) : [],
          index: Number(it?.index) || 0,
        }));
      // 按清单顺序回填；数量不齐 → 视为解析失败走兜底
      if (parsed.length === requirements.length && parsed.every((p) => p.index >= 1 && p.index <= requirements.length)) {
        items = requirements.map((_, i) => {
          const hit = parsed.find((p) => p.index === i + 1) ?? parsed[i];
          return { requirement: requirements[i], status: hit.status, type: hit.type, refs: hit.refs };
        });
      } else {
        throw new Error(`LLM 判定数量不齐（${parsed.length}/${requirements.length}）`);
      }
    } catch (err) {
      this.logger.warn(`资格符合性 AI 判定失败/不合格，回退关键词粗判: ${err instanceof Error ? err.message : err}`);
      source = 'fallback';
      const validQuals = supplier.qualifications.filter((q) => !q.validTo || q.validTo > now);
      items = requirements.map((r) => {
        const key = r.replace(/[的之并须应需等（）()]/g, '').slice(0, 6);
        const hitQual = validQuals.find((q) => (q.name ?? '').includes(key));
        const hitPerf = supplier.performances.find((p) => (p.projectName ?? '').includes(key));
        if (hitQual) return { requirement: r, status: '符合' as const, type: 'qualification' as const, refs: [hitQual.name] };
        if (hitPerf) return { requirement: r, status: '符合' as const, type: 'performance' as const, refs: [hitPerf.projectName] };
        if (supplier.businessScope.includes(key)) return { requirement: r, status: '符合' as const, type: 'scope' as const, refs: [] };
        return { requirement: r, status: '待核实' as const, type: 'none' as const, refs: [] };
      });
    }

    const fullItems: QualificationMatchItem[] = items.map((it) => ({
      requirement: it.requirement,
      status: it.status,
      evidence: this.evidenceText(it.type, it.refs, evidenceCtx),
    }));
    const { conclusion, summary, confidence } = this.buildVerdict(fullItems);
    const risks = this.buildRisks(fullItems, expiredQuals);

    return { conclusion, confidence, items: fullItems, summary, risks, source, supplierName: supplier.name, projectName: bp.name };
  }
}
