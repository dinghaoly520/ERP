import { Injectable, Logger } from '@nestjs/common';
import { LlmService } from '../local-ai/llm.service';

/* =================================================================
   专家智能抽取 — LLM 分析引擎（统一走 LlmService 网关）
   AI 负责"理解项目 + 评估专家匹配度 + 推荐专家组构成"，
   "谁中选"由调用方的确定层决定（模式驱动：专业匹配/随机/综合择优）。
   无 key / 失败时抛错，调用方（previewExtraction）降级到规则评分。
   ================================================================= */

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
  /** 通知文案缓存（按项目维度去重，省 token）：key → {content, at} */
  private readonly notifyCache = new Map<string, { content: string; at: number }>();
  private static readonly NOTIFY_CACHE_TTL = 30 * 60 * 1000;
  /** 单次 LLM 调用上限（毫秒）：LlmService 内部默认 180s 过长，挂起时会让降级迟迟不触发 */
  private static readonly LLM_ATTEMPT_TIMEOUT_MS = 15_000;
  /** 整条 AI 路径总预算（毫秒）：超过即抛错走规则降级，保证在网关/前端超时前发生 */
  private static readonly LLM_TOTAL_BUDGET_MS = 25_000;
  /** 轻量可观测指标（内存态，供 ai-adoption 端点输出） */
  private metrics = {
    llmCalls: 0,
    llmErrors: 0,
    fallbackCount: 0,
    lastLatencyMs: null as number | null,
    lastModel: null as string | null,
  };

  constructor(private readonly llm: LlmService) {}

  /** 可观测快照（含当前模型名） */
  getMetrics() {
    return { ...this.metrics, model: this.llm.getModel() };
  }

  /** 规则降级计数（由 previewExtraction 在降级时调用） */
  recordFallback() {
    this.metrics.fallbackCount += 1;
  }

  /** 给任意 Promise 套超时：到点即 reject，避免 LLM 挂起拖垮整条降级路径 */
  private withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`LLM 调用超时（>${Math.round(ms / 1000)}s）`)), ms);
      p.then(
        (v) => { clearTimeout(timer); resolve(v); },
        (e) => { clearTimeout(timer); reject(e); },
      );
    });
  }

  /**
   * 带指数退避的 chatJson 重试，并记录耗时/模型。
   * 关键：每次调用套单次超时，整条路径有总预算（默认 25s）——
   * 一旦超预算立即抛错，交由调用方（previewExtraction）降级到规则引擎，
   * 保证在反向代理/前端超时窗口（通常 30–60s）内真正发生降级，而非让用户等到 504。
   */
  private async chatJsonWithRetry<T>(system: string, user: string, temperature: number, attempts = 2): Promise<T> {
    let lastErr: unknown;
    const deadline = Date.now() + ExpertExtractionAiService.LLM_TOTAL_BUDGET_MS;
    for (let i = 0; i < attempts; i++) {
      if (Date.now() >= deadline) break; // 总预算耗尽，立即放弃交给降级
      const start = Date.now();
      try {
        this.metrics.llmCalls += 1;
        const result = await this.withTimeout(
          this.llm.chatJson<T>(system, user, temperature),
          ExpertExtractionAiService.LLM_ATTEMPT_TIMEOUT_MS,
        );
        this.metrics.lastLatencyMs = Date.now() - start;
        this.metrics.lastModel = this.llm.getModel();
        return result;
      } catch (err) {
        lastErr = err;
        this.metrics.llmErrors += 1;
        this.logger.warn(`LLM chatJson 第 ${i + 1}/${attempts} 次失败: ${(err as Error)?.message ?? err}`);
        if (i < attempts - 1 && Date.now() < deadline) await new Promise(r => setTimeout(r, 500 * Math.pow(2, i)));
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
  }

  async analyzeAndScore(
    project: { name: string; procurementMethod: string; procurementType?: string; scope: string; budget?: number | string },
    candidates: ExtractionCandidate[],
    totalNeeded: number,
    extractMode: ExtractMode = 'specialty_match',
  ): Promise<ExpertExtractionLlmResult> {
    const apiKey = process.env.DEEPSEEK_API_KEY;
    if (!apiKey) throw new Error('AI 服务未配置（缺少 DEEPSEEK_API_KEY 环境变量）');
    if (candidates.length === 0) throw new Error('无合规候选专家，请检查专家库状态');

    // 预筛选：AI 推理模型对大量候选会耗尽 token，限制到 top 30
    const MAX_AI_CANDIDATES = 30;
    const ranked = [...candidates].sort((a, b) => {
      const levelRank = (l?: string) => (l === 'A' ? 4 : l === 'B' ? 3 : l === 'C' ? 2 : l === 'D' ? 1 : 0);
      return (levelRank(b.evaluationLevel) + b.pastAvgScore * 0.01) - (levelRank(a.evaluationLevel) + a.pastAvgScore * 0.01);
    });
    const aiCandidates = ranked.slice(0, MAX_AI_CANDIDATES);

    const indexToId = new Map<string, string>();
    const lines = aiCandidates.map((c, i) => {
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

    const userPrompt =
      `招标项目：${project.name}\n` +
      `采购方式：${project.procurementMethod}${project.procurementType ? '（' + project.procurementType + '）' : ''}\n` +
      `项目概况/范围：${project.scope}\n` +
      (project.budget ? `预算：${project.budget}\n` : '') +
      `\n合规候选专家清单（编号 | 姓名 | 专业 | 职称 | 单位 | 历史项目 | 历史评分 | 履职等级 | 出勤 | 质量 | 廉洁 | 偏离度 | 近期次数 | 负荷状态）：\n${lines.join('\n')}`;

    let parsed: any;
    try {
      // 统一走 LlmService 网关（response_format 结构化 JSON + 重试 + 耗时埋点）
      parsed = await this.chatJsonWithRetry<any>(system, userPrompt, 0.2);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.warn(`DeepSeek expert-extraction error: ${msg}`);
      throw new Error(`AI 抽取失败：${msg}`);
    }
    if (!parsed) throw new Error('AI 返回数据解析失败（非 JSON 格式）');

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

    if (scoredExperts.length === 0 && requiredSpecialties.length === 0) throw new Error('AI 未返回有效评分数据');

    return {
      analysis: String(parsed.analysis || '').slice(0, 500),
      requiredSpecialties,
      scoredExperts,
    };
  }

  /** 按抽取模式构建不同的 system prompt */
  private buildSystemPrompt(mode: ExtractMode, totalNeeded: number): string {
    const base = [
      '你是四川水发集团招采系统的评标专家组智能组建助手。',
      `本次共需抽取 ${totalNeeded} 名专家。`,
      '一、requiredSpecialties：推荐专家组的专业构成（各专业需几人，合计应接近 ' + totalNeeded + '），每项含 specialty、count、reason。',
      `二、scoredExperts：从候选清单中选出最合适的 ${totalNeeded * 3} 名专家进行评分（不必给所有专家评分），给出 matchScore(0-100整数)、fitSpecialty(最契合的专业)、reason(15-30字)。`,
      '严格按以下 JSON 格式返回，不要输出其他内容：{"analysis":"简短分析(50字内)","requiredSpecialties":[{"specialty":"","count":0,"reason":""}],"scoredExperts":[{"id":"e0","matchScore":0,"fitSpecialty":"","reason":""}]}',
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

  /** AI 生成单专家个性化通知内容（按项目维度缓存去重 + 占位符校验，走 LlmService 网关） */
  async generateNotification(params: {
    projectName: string;
    expertName: string;
    isLead: boolean;
    totalExperts: number;
    extractMode: string;
    openTime: string;
  }): Promise<string | null> {
    // 缓存去重：通知模板只与项目/角色/人数/开标时间相关（占位符 [[专家姓名]] 原样保留，不按个人区分）
    const cacheKey = [params.projectName, params.isLead ? 'lead' : 'member', params.totalExperts, params.extractMode, params.openTime || ''].join('|');
    const cached = this.notifyCache.get(cacheKey);
    if (cached && Date.now() - cached.at < ExpertExtractionAiService.NOTIFY_CACHE_TTL) {
      return cached.content;
    }

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
      this.metrics.llmCalls += 1;
      const start = Date.now();
      const raw = await this.withTimeout(
        this.llm.chat(
          '你是一位专业的政府企业采购评审管理专家，擅长撰写正式、诚恳的通知文书。',
          prompt,
          0.5,
        ),
        ExpertExtractionAiService.LLM_ATTEMPT_TIMEOUT_MS,
      );
      this.metrics.lastLatencyMs = Date.now() - start;
      this.metrics.lastModel = this.llm.getModel();
      let content = typeof raw === 'string' ? raw.trim() : '';
      if (!content) return null;
      // 占位符校验：模型若漏掉 [[专家姓名]]，自动补默认抬头，保证后续按人替换不失效
      if (!content.includes('[[专家姓名]]')) {
        this.logger.warn('AI 通知缺失 [[专家姓名]] 占位符，已自动补默认抬头');
        content = `[[专家姓名]]专家您好！\n${content}`;
      }
      this.notifyCache.set(cacheKey, { content, at: Date.now() });
      // 缓存上限保护（LRU 近似：淘汰最早一条）
      if (this.notifyCache.size > 200) {
        const oldest = [...this.notifyCache.entries()].sort((a, b) => a[1].at - b[1].at)[0]?.[0];
        if (oldest) this.notifyCache.delete(oldest);
      }
      return content;
    } catch (err) {
      this.metrics.llmErrors += 1;
      this.logger.warn(`DeepSeek notification generation error: ${String(err)}`);
      return null;
    }
  }
}
