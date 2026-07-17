import { Injectable, Logger } from '@nestjs/common';

/* =================================================================
   专家智能抽取 — DeepSeek LLM 分析引擎
   AI 负责"理解项目 + 评估专家匹配度 + 推荐专家组构成"，
   "谁中选"由调用方的确定层决定（模式驱动：专业匹配/随机/综合择优）。
   无 key / 失败时返回 undefined，调用方降级到规则评分。
   ================================================================= */

const DEEPSEEK_API_URL = process.env.DEEPSEEK_API_URL ?? 'https://api.deepseek.com';
const DEEPSEEK_MODEL = process.env.DEEPSEEK_MODEL ?? 'deepseek-v4-flash';

/** 送入 LLM 的合规候选专家（含多维度履职数据） */
export interface ExtractionCandidate {
  id: string;
  displayName: string;
  specialty: string;
  title?: string;
  employer?: string;
  pastProjects: number;
  pastAvgScore: number;
  /** 最新履职评价等级 A/B/C/D */
  evaluationLevel?: string;
  /** 出勤纪律 0-100 */
  attendanceScore?: number;
  /** 评审质量 0-100 */
  qualityScore?: number;
  /** 廉洁纪律 0-100 */
  disciplineScore?: number;
  /** 评分偏离度（正=偏高，负=偏低） */
  scoreDeviation?: number;
  /** 近12月参与项目数 */
  recentProjects12m?: number;
  /** 当前负荷状态 */
  currentLoadStatus?: string;
}

export interface LlmSpecialtyQuota {
  specialty: string;
  count: number;
  reason: string;
}

export interface LlmExpertScore {
  id: string;
  matchScore: number;
  fitSpecialty: string;
  reason: string;
}

export interface ExpertExtractionLlmResult {
  analysis: string;
  requiredSpecialties: LlmSpecialtyQuota[];
  scoredExperts: LlmExpertScore[];
}

/** 抽取模式 */
export type ExtractMode = 'specialty_match' | 'random' | 'merit_best';

@Injectable()
export class ExpertExtractionAiService {
  private readonly logger = new Logger(ExpertExtractionAiService.name);

  async analyzeAndScore(
    project: { name: string; procurementMethod: string; procurementType?: string; scope: string; budget?: number | string },
    candidates: ExtractionCandidate[],
    totalNeeded: number,
    extractMode: ExtractMode = 'specialty_match',
  ): Promise<ExpertExtractionLlmResult | undefined> {
    const apiKey = process.env.DEEPSEEK_API_KEY;
    if (!apiKey || candidates.length === 0) return undefined;

    const indexToId = new Map<string, string>();
    const lines = candidates.map((c, i) => {
      const key = `e${i}`;
      indexToId.set(key, c.id);
      return [
        key,
        c.displayName,
        `专业:${c.specialty}`,
        c.title ? `职称:${c.title}` : '',
        c.employer ? `单位:${c.employer}` : '',
        `历史项目${c.pastProjects}个`,
        c.pastAvgScore > 0 ? `历评${c.pastAvgScore}` : '',
        c.evaluationLevel ? `履职等级:${c.evaluationLevel}` : '',
        c.attendanceScore != null ? `出勤${c.attendanceScore}` : '',
        c.qualityScore != null ? `质量${c.qualityScore}` : '',
        c.disciplineScore != null ? `廉洁${c.disciplineScore}` : '',
        c.scoreDeviation != null ? `偏离度${c.scoreDeviation > 0 ? '+' : ''}${c.scoreDeviation}` : '',
        c.recentProjects12m != null ? `近期${c.recentProjects12m}次` : '',
        c.currentLoadStatus ? `负荷:${c.currentLoadStatus}` : '',
      ].filter(Boolean).join(' | ');
    });

    const system = this.buildSystemPrompt(extractMode, totalNeeded);

    try {
      const response = await fetch(`${DEEPSEEK_API_URL.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: DEEPSEEK_MODEL,
          messages: [
            { role: 'system', content: system },
            {
              role: 'user',
              content:
                `招标项目：${project.name}\n` +
                `采购方式：${project.procurementMethod}${project.procurementType ? '（' + project.procurementType + '）' : ''}\n` +
                `项目概况/范围：${project.scope}\n` +
                (project.budget ? `预算：${project.budget}\n` : '') +
                `\n合规候选专家清单（编号 | 姓名 | 专业 | 职称 | 单位 | 历史项目 | 历史评分 | 履职等级 | 出勤 | 质量 | 廉洁 | 偏离度 | 近期次数 | 负荷状态）：\n${lines.join('\n')}`,
            },
          ],
          temperature: 0.2,
          max_tokens: 4000,
        }),
      });

      if (!response.ok) {
        this.logger.warn(`DeepSeek expert-extraction failed: ${response.status} ${await response.text()}`);
        return undefined;
      }

      const data = await response.json();
      const content: string | undefined = data?.choices?.[0]?.message?.content;
      if (typeof content !== 'string') return undefined;

      const parsed = this.parseJson(content);
      if (!parsed) return undefined;

      const scoredExperts: LlmExpertScore[] = Array.isArray(parsed.scoredExperts)
        ? parsed.scoredExperts
            .map((s: any) => ({
              id: indexToId.get(String(s.id)) ?? '',
              matchScore: Math.max(0, Math.min(100, Math.round(Number(s.matchScore) || 0))),
              fitSpecialty: String(s.fitSpecialty || '').slice(0, 50),
              reason: String(s.reason || '').slice(0, 200),
            }))
            .filter((s: LlmExpertScore) => s.id)
        : [];

      const requiredSpecialties: LlmSpecialtyQuota[] = Array.isArray(parsed.requiredSpecialties)
        ? parsed.requiredSpecialties
            .map((q: any) => ({
              specialty: String(q.specialty || '').slice(0, 50),
              count: Math.max(0, Math.round(Number(q.count) || 0)),
              reason: String(q.reason || '').slice(0, 200),
            }))
            .filter((q: LlmSpecialtyQuota) => q.specialty && q.count > 0)
        : [];

      if (scoredExperts.length === 0 && requiredSpecialties.length === 0) return undefined;

      return {
        analysis: String(parsed.analysis || '').slice(0, 500),
        requiredSpecialties,
        scoredExperts,
      };
    } catch (error) {
      this.logger.warn(`DeepSeek expert-extraction error: ${error instanceof Error ? error.message : String(error)}`);
      return undefined;
    }
  }

  /** 按抽取模式构建不同的 system prompt */
  private buildSystemPrompt(mode: ExtractMode, totalNeeded: number): string {
    const base = [
      '你是四川水发集团招采系统的评标专家组智能组建助手。',
      `本次共需抽取 ${totalNeeded} 名专家。`,
      '一、requiredSpecialties：推荐专家组的专业构成（各专业需几人，合计应接近 ' + totalNeeded + '），每项含 specialty、count、reason。',
      '二、scoredExperts：对候选清单中每位专家给出 matchScore(0-100整数)、fitSpecialty(最契合的专业)、reason(20-50字，结合项目与专家各项数据)。',
    ];

    const modeInstructions: Record<ExtractMode, string[]> = {
      specialty_match: [
        '【专业匹配模式】',
        '重点关注专家专业领域与项目需求的契合度。评分权重：专业匹配度 50%、职称资质 20%、历史经验 15%、履职评价 15%。',
        '分析项目评审所需的专业构成，推荐各专业的合理人数配比。',
        '每位专家的 matchScore 应反映其专业能力与项目需求的匹配程度，不受履职评价的过度影响。',
      ],
      random: [
        '【随机抽取模式】',
        '本模式以公平合规为最高原则。',
        '每位合规专家的 matchScore 应集中在 50-75 之间，确保人人有均等的中选机会。',
        'reason 仅简要说明专家的合规性与基本资质，不做优劣比较。',
        '可不输出 requiredSpecialties（或均匀分配专业构成），不做专业上的择优推荐。',
      ],
      merit_best: [
        '【综合择优模式】',
        '综合评估专家的全方位能力与履历。评分权重：履职评价等级 40%、专业匹配度 25%、评分偏离度（越接近0越好）20%、历史经验 15%。',
        '履职等级 A=优秀(90-100分)、B=良好(80-89分)、C=合格(60-79分)、D=不合格(<60分)——matchScore 必须严格反映此等级差异。',
        '偏离度绝对值越小越好（说明专家评分客观公正），偏离度>|10|的专家应适当降低 matchScore。',
        '当前负荷"繁忙"的专家应降权5-10分，确保负荷均衡。',
        '按综合得分从高到低排序推荐，优先推荐得分最高的专家。',
      ],
    };

    const instructions = modeInstructions[mode] ?? modeInstructions.specialty_match;

    return [
      ...base,
      ...instructions,
      '严格基于候选清单已有信息，不得编造清单外的专家。',
      '必须只输出一个 JSON 对象，不要输出任何其它文字或代码块标记，格式：',
      '{"analysis":"项目评审难点与专家组构成总体分析(60-120字)","requiredSpecialties":[{"specialty":"水利工程","count":2,"reason":"..."}],"scoredExperts":[{"id":"e0","matchScore":88,"fitSpecialty":"水利工程","reason":"..."}]}',
    ].join('\n');
  }

  private parseJson(content: string): any | undefined {
    try { return JSON.parse(content); } catch { /* not pure json */ }
    const cleaned = content.replace(/```json/gi, '').replace(/```/g, '').trim();
    try { return JSON.parse(cleaned); } catch { /* fall through */ }
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (match) { try { return JSON.parse(match[0]); } catch { /* ignore */ } }
    return undefined;
  }

  /** AI 生成单专家个性化通知内容 */
  async generateNotification(params: {
    projectName: string;
    expertName: string;
    isLead: boolean;
    totalExperts: number;
    extractMode: string;
    openTime: string;
  }): Promise<string | null> {
    const apiKey = process.env.DEEPSEEK_API_KEY;
    if (!apiKey) {
      this.logger.warn('DEEPSEEK_API_KEY not configured, cannot generate notification via AI');
      return null;
    }

    const roleText = params.isLead ? '评审组长' : '评审专家组成员';
    const today = new Date().toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' });
    const prompt = `你是四川水发集团采购中心的评审专家邀请通知撰写人。请撰写一封评审邀请通知模板。

撰写规范：
- 第一行必须是：[[专家姓名]]专家您好！（注意：[[专家姓名]] 是占位符，请原样输出，不要替换）
- 正文中用"评审专家组成员"作为角色占位符（系统会根据实际角色替换为"评审组长"或"评审专家组成员"）
- 本项目共 ${params.totalExperts} 位专家参与评审
- 必须包含的信息：项目名称「${params.projectName}」、开标时间「${params.openTime || '待定'}」、评审地点「设计公司3楼采购中心开评标室」
- 提醒专家认真履责、遵守评审纪律、及时回避利益冲突
- 提醒专家请于24小时内回复是否参加，逾期未确认视为自动放弃
- 落款：四川水发集团采购中心，日期为${today}
- 严格禁止：
  1. 不要使用任何 Markdown 符号或格式标记（如 ** 加粗、- 列表、# 标题等），纯文本即可
  2. 不要提及遴选方式或抽取方式
  3. 不要提及或列出其他专家的姓名
  4. 不要加引号、星号等特殊符号
- 语气正式、诚恳
- 直接输出通知全文，不要加任何前缀、说明或标头`;

    try {
      const response = await fetch(`${DEEPSEEK_API_URL.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: DEEPSEEK_MODEL,
          messages: [
            { role: 'system', content: '你是一位专业的政府企业采购评审管理专家，擅长撰写正式、诚恳的通知文书。' },
            { role: 'user', content: prompt },
          ],
          temperature: 0.5,
          max_tokens: 1200,
        }),
      });

      if (!response.ok) {
        this.logger.warn(`DeepSeek notification generation failed: ${response.status}`);
        return null;
      }

      const data = await response.json();
      const content: string | undefined = data?.choices?.[0]?.message?.content;
      return typeof content === 'string' ? content.trim() : null;
    } catch (err) {
      this.logger.warn(`DeepSeek notification generation error: ${String(err)}`);
      return null;
    }
  }
}
