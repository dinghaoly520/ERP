import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LlmService } from '../local-ai/llm.service';
import type { ConditionCheck } from './supplier-hard-conditions';

/*
   供应商智能选取 — DeepSeek LLM 排序引擎
   2026-07 生产加固收口：统一走 LlmService 网关（超时/重试/并发限流由网关负责）。
   回退语义不变：无 key 或失败时返回 undefined，由调用方降级到规则评分引擎。
 */

/** 送入 LLM 的候选供应商（已由规则检索阶段筛选） */
export interface SelectionCandidate {
  id: string; // 真实 supplier.id（用于回填结果）
  name: string;
  classification?: string;
  businessScope: string;
  tags?: string[]; // 业务标签（浓缩关键词），供语义匹配与择优参考
  qualificationText?: string;
  enterpriseType?: string;
  legalPerson?: string;
  // ── 库内证据（2026-11-04 spec）：让排序基于真实资料而非截断摘要 ──
  industry?: string;
  qualificationNames?: string[]; // 资质全名 top8（替代 60 字截断）
  performanceSummary?: string; // 如「近期业绩2项（钻机采购、钻具供货）」；无记录=undefined（渲染层明示）
  penaltyCount?: number; // 惩戒记录条数
  registeredCapital?: string;
  // 履约/评价表现（规则阶段已算出）——喂给 LLM 让排序体现择优。
  evalLevel?: string;
  evalAvgScore?: number;
  evalCount?: number;
  activeProjects?: number;
}

export interface LlmRecommendation {
  id: string; // 映射回真实 supplier.id
  score: number; // 0-100
  reason: string;
}

export interface SupplierSelectionLlmResult {
  summary: string;
  recommendations: LlmRecommendation[];
}

/** 候选行组装（纯函数）：短编号 c0/c1... 节省 token，回填时映射回真实 id；行内带库内证据+核验标记 */
export function buildCandidateLines(
  candidates: SelectionCandidate[],
  checksBySupplier?: Map<string, ConditionCheck[]>,
): { lines: string[]; indexToId: Map<string, string> } {
  const indexToId = new Map<string, string>();
  const lines = candidates.map((c, i) => {
    const key = `c${i}`;
    indexToId.set(key, c.id);
    const checks = checksBySupplier?.get(c.id);
    const checkMark =
      checks && checks.length > 0
        ? ` 核验:${checks.map((ch) => `${ch.label}${ch.status === 'PASS' ? '✓' : ch.status === 'MISSING' ? '○' : '✗'}`).join(' ')}`
        : '';
    return [
      key,
      c.name,
      c.industry ? `行业:${c.industry}` : '',
      c.classification ? `[${c.classification}]` : '',
      c.enterpriseType || '',
      (c.businessScope || '').slice(0, 90),
      c.tags && c.tags.length > 0 ? `标签:${c.tags.slice(0, 6).join('、')}` : '',
      c.qualificationNames && c.qualificationNames.length > 0
        ? `资质全:${c.qualificationNames.slice(0, 8).map((n) => n.slice(0, 40)).join('、')}`
        : '资质:库内未见',
      `业绩:${c.performanceSummary || '库内无业绩记录'}`,
      c.penaltyCount ? `惩戒:${c.penaltyCount}条` : '',
      c.registeredCapital ? `注册资本:${c.registeredCapital}` : '',
      // 履约/评价表现：让 LLM 在语义匹配之外真正择优（历史评分高、等级好、在建项目适中者优先）。
      // 2026-11-04 修复：调用方曾传 evalGrade（接口字段是 evalLevel）——改名漂移致评价数据从未真正进 LLM 行。
      c.evalAvgScore != null
        ? `历史均分:${c.evalAvgScore}/${c.evalLevel || '-'}(${c.evalCount || 0}次)`
        : c.evalLevel
          ? `历史评价:${c.evalLevel}级(${c.evalCount || 0}次)`
          : '历史评价:无',
      `在建项目:${c.activeProjects ?? 0}`,
    ]
      .filter(Boolean)
      .join(' | ') + checkMark;
  });
  return { lines, indexToId };
}

@Injectable()
export class SupplierSelectionAiService {
  private readonly logger = new Logger(SupplierSelectionAiService.name);

  constructor(
    private readonly llm: LlmService,
    private readonly config: ConfigService,
  ) {}

  async rankCandidates(
    requirement: string,
    candidates: SelectionCandidate[],
    maxCount: number,
    projectContext?: Record<string, string>,
    checksBySupplier?: Map<string, ConditionCheck[]>,
  ): Promise<SupplierSelectionLlmResult | undefined> {
    if (!this.llm.getModel() || candidates.length === 0) return undefined;

    // 紧凑候选清单（buildCandidateLines）：短编号 c0/c1... 节省 token，回填时映射回真实 id
    const { lines, indexToId } = buildCandidateLines(candidates, checksBySupplier);

    const contextBlock = projectContext
      ? Object.entries(projectContext)
          .filter(([, v]) => v?.trim())
          .map(([k, v]) => `【${k}】${v}`)
          .join('\n')
      : '';

    const system = [
      '你是四川省水利发展集团有限公司招采系统的供应商智能推荐引擎。',
      '根据采购需求，从候选供应商清单中挑选最匹配的供应商，按匹配度从高到低排序，最多推荐 ' + maxCount + ' 家。',
      (contextBlock ? '以下为项目完整背景信息，请结合背景信息深度理解采购的真实需求、标的物、预算规模和对供方的资质/能力要求，在此基础上判断供应商的匹配度：\n' + contextBlock : ''),
      '候选清单含「行业/资质全/业绩/惩戒/注册资本/核验标记」证据：✓=已核验满足、○=库内资料缺失（不得据此扣分也不得虚构）、✗=不满足。资料完备且核验✓多者优先；「业绩:库内无业绩记录」者不得虚构其口碑。',
      '对每家给出：匹配度评分(0-100的整数)和一条20-50字的中文推荐理由，须综合其业务标签/经营范围/资质/分类与需求的相关性，并参考历史评价均分/等级与在建项目数体现择优（评分高、等级好者优先；无历史评价者不得虚构口碑）。',
      '严格基于候选清单中的已有信息判断，不得编造清单外不存在的供应商或能力。',
      'summary 必须呼应采购需求中声明的筛选条件（业务标签/行业/资质必须项/业绩门槛/评价等级中实际出现的），并概述候选核验标记分布（如「N家资质资料缺失待人工核实」）与推荐名单整体特点；未声明的条件不得提及，候选清单外的信息不得虚构。',
      '必须只输出一个 JSON 对象，不要输出任何其它文字或代码块标记，格式：',
      '{"summary":"结合筛选条件与核验情况的整体分析(60-120字)","recommendations":[{"id":"c0","score":92,"reason":"..."}]}',
    ].join('\n');

    try {
      // 走 chat() 而非 chatJson()：保留本服务自有的三段式防御性解析（整体 JSON → 去代码块 → 抽取首个 {...}）
      const content = await this.llm.chat(
        system,
        `采购需求：${requirement}\n\n` +
          `候选供应商清单（编号 | 名称 | 行业 | 分类 | 类型 | 经营范围 | 业务标签 | 资质 | 业绩 | 惩戒 | 注册资本 | 历史评价 | 在建项目 | 核验）：\n${lines.join('\n')}`,
        0.2,
        undefined,
        undefined,
        {
          model: this.config.get<string>('DEEPSEEK_MODEL', 'deepseek-v4-flash'),
          maxTokens: 16000, // 候选池 110 家时 prompt 很长，需充足 token 预算保证 JSON 完整输出
          timeoutMs: 180_000, // 候选池大时 LLM 处理耗时更长，默认 90s 容易超时降级
        },
      );

      const parsed = this.parseJson(content);
      if (!parsed || !Array.isArray(parsed.recommendations)) return undefined;

      const recommendations: LlmRecommendation[] = parsed.recommendations
        .map((r: any) => ({
          id: indexToId.get(String(r.id)) ?? '',
          score: Math.max(0, Math.min(100, Math.round(Number(r.score) || 0))),
          reason: String(r.reason || '').slice(0, 200),
        }))
        .filter((r: LlmRecommendation) => r.id)
        .slice(0, maxCount);

      if (recommendations.length === 0) return undefined;

      return {
        summary: String(parsed.summary || '').slice(0, 300),
        recommendations,
      };
    } catch (error) {
      this.logger.warn(
        `DeepSeek supplier-selection error: ${error instanceof Error ? error.message : String(error)}`,
      );
      return undefined;
    }
  }

  /** 防御性解析：先尝试整体 JSON，再从文本中抽取首个 JSON 对象 */
  private parseJson(content: string): any | undefined {
    try {
      return JSON.parse(content);
    } catch {
      // not pure JSON — fall through
    }
    const cleaned = content.replace(/```json/gi, '').replace(/```/g, '').trim();
    try {
      return JSON.parse(cleaned);
    } catch {
      // fall through
    }
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch {
        // ignore
      }
    }
    return undefined;
  }
}
