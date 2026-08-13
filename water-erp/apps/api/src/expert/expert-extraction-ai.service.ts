import { Injectable, Logger } from '@nestjs/common';
import { ExpertLevel } from '@prisma/client';
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
  /** 最新履职评价等级 A/B/C/D/E */
  evaluationLevel?: string;
  /** 出勤纪律等级 A/B/C/D/E */
  attendanceGrade?: ExpertLevel;
  /** 评审质量等级 A/B/C/D/E */
  qualityGrade?: ExpertLevel;
  /** 廉洁纪律等级 A/B/C/D/E */
  disciplineGrade?: ExpertLevel;
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
  /** 部门限定：仅从工作单位匹配该部门的专家中抽取（需求方代表「选择部门」） */
  employer?: string;
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

  async analyzeAndScore(
    project: { name: string; procurementMethod: string; procurementType?: string; scope: string; budget?: number | string },
    candidates: ExtractionCandidate[],
    totalNeeded: number,
    extractMode: ExtractMode = 'specialty_match',
    manualSpecs?: string,
  ): Promise<ExpertExtractionLlmResult> {
    const apiKey = process.env.DEEPSEEK_API_KEY;
    if (!apiKey) throw new Error('AI 服务未配置（缺少 DEEPSEEK_API_KEY 环境变量）');
    if (candidates.length === 0) throw new Error('无合规候选专家，请检查专家库状态');

    // 预筛选：AI 推理模型对大量候选会耗尽 token，限制到 top 30
    const MAX_AI_CANDIDATES = 15;
    const ranked = [...candidates].sort((a, b) => {
      const levelRank = (l?: string) => (l === 'A' ? 4 : l === 'B' ? 3 : l === 'C' ? 2 : l === 'D' ? 1 : 0);
      return levelRank(b.evaluationLevel) - levelRank(a.evaluationLevel);
    });
    const aiCandidates = ranked.slice(0, MAX_AI_CANDIDATES);

    const indexToId = new Map<string, string>();
    // 候选行精简到核心6项（减少 token、降低 LLM 耗时、避免超时触发代理 500）
    const lines = aiCandidates.map((c, i) => {
      const key = `e${i}`;
      indexToId.set(key, c.id);
      const grade = c.evaluationLevel || '-';
      const dev = c.scoreDeviation != null ? `${c.scoreDeviation > 0 ? '+' : ''}${c.scoreDeviation}` : '-';
      return [key, c.displayName, `专业:${c.specialty}`, c.title || '', c.employer || '', `履职:${grade} 偏离:${dev} 负荷:${c.currentLoadStatus || '-'} 经验:${c.pastProjects}次`].join(' | ');
    });

    const system = this.buildSystemPrompt(extractMode, totalNeeded);
    // 随机模式分数无区分度(恒70)，提高温度让结构分析更自然；择优/匹配需稳定打分，保持低温
    const temperature = extractMode === 'random' ? 0.5 : 0.2;

    const userPrompt =
      `招标项目：${project.name}\n` +
      `采购方式：${project.procurementMethod}${project.procurementType ? '（' + project.procurementType + '）' : ''}\n` +
      `项目概况/范围：${project.scope}\n` +
      (project.budget ? `预算：${project.budget}\n` : '') +
      (manualSpecs ? `已指定专业配额：${manualSpecs}。requiredSpecialties 请直接用这些专业，analysis 围绕它们分析。\n` : '') +
      `\n候选(编号|姓名|专业|职称|单位|履职 偏离 负荷 经验)：\n${lines.join('\n')}`;

    let parsed: any;
    try {
      // v4-flash 不支持 response_format:json_object → 走 LlmService.chat() 纯文本 + 手动提取 JSON
      // 不套外层 timeout（LlmService 内部有信号量排队，外层 timeout 会在排队期间提前 reject）
      // 改用 options.timeoutMs 控制单次 HTTP 请求超时
      const start = Date.now();
      this.metrics.llmCalls += 1;
      // 30s/次 × 2 次尝试：前端直连 :4001 绕过代理超时，给 AI 充分时间
      const raw = await this.llm.chat(system, userPrompt, temperature, undefined, undefined, { timeoutMs: 30_000, retries: 1 });
      this.metrics.lastLatencyMs = Date.now() - start;
      this.metrics.lastModel = this.llm.getModel();
      // 防御性 JSON 提取：优先匹配完整 JSON 块，失败则尝试去掉代码围栏重试
      const json = raw.match(/\{[\s\S]*\}/);
      if (!json) throw new Error('LLM 响应中未找到 JSON');
      parsed = JSON.parse(json[0]);
    } catch (error) {
      this.metrics.llmErrors += 1;
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
      analysis: String(parsed.analysis || '').slice(0, 800),
      requiredSpecialties,
      scoredExperts,
    };
  }

  /** 按抽取模式构建不同的 system prompt */
  private buildSystemPrompt(mode: ExtractMode, totalNeeded: number): string {
    const isRandom = mode === 'random';
    const base = [
      '你是评标专家组组建助手。本次需抽 ' + totalNeeded + ' 人。',
      'requiredSpecialties：推荐专业构成（各专业人数合计≈' + totalNeeded + '），含 specialty/count/reason(≤15字)。',
      'scoredExperts：填 []（评分由系统规则引擎完成，你只需分析项目+推荐专业结构）。',
      '只输出 JSON：{"analysis":"≤60字","requiredSpecialties":[...],"scoredExperts":[]}',
    ];

    const modeHint = isRandom
      ? '随机模式：只分析专业结构，不评人优劣；analysis 说明项目需覆盖哪些专业及人数配比，引述"随机抽取保障公平"。'
      : mode === 'merit_best'
        ? '择优模式：分析项目专业需求+候选专家的等级分布与职称结构，说明择优方向；系统将按履职等级/偏离度/经验/负荷综合评分择优录取。'
        : '匹配模式：按专业对口度分析。';

    return [...base, modeHint, '不得编造清单外专家。禁止输出 JSON 以外的任何文字。'].join('\n');
  }

  /** AI 生成通知模板（正选/候补分别生成，简短精炼） */
  async generateNotification(params: {
    projectName: string;
    expertName: string;
    isLead: boolean;
    totalExperts: number;
    extractMode: string;
    openTime: string;
    isAlternate?: boolean;
    projectScope?: string;
  }): Promise<string | null> {
    const isAlt = params.isAlternate ?? false;
    const cacheKey = [params.projectName, isAlt ? 'alt' : 'main', params.totalExperts, params.openTime || ''].join('|');
    const cached = this.notifyCache.get(cacheKey);
    if (cached && Date.now() - cached.at < ExpertExtractionAiService.NOTIFY_CACHE_TTL) {
      return cached.content;
    }

    const today = new Date().toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' });
    // 正选 vs 候补：完全不同的定位与措辞
    const roleLine = isAlt
      ? '您被选为本项目候补评审专家。若正选专家因故无法参加，将按序递补您参加评审。请确认是否愿意待命。'
      : '您被选为本项目正选评审专家。请务必于收到通知后15分钟内确认是否参加，逾期将自动视为放弃。';
    const prompt = `撰写评审专家邀请短信通知（纯文本，150-200字，信息完整）。

必须包含的信息：
- 抬头：[[专家姓名]]专家您好！（[[专家姓名]]为占位符，原样输出，不替换）
- 项目名称：${params.projectName}
- 开标时间：${params.openTime || '另行通知'}
- 评审地点：{LOCATION}（{LOCATION} 是占位符，原样输出，禁止翻译、改写或替换为英文）
- 角色与要求：${roleLine}
- 确认方式：正文末尾紧跟" 确认链接（15分钟内有效）：{RSVP_LINK}"（不换行，直接接在正文后面；{RSVP_LINK} 是占位符，原样输出）
- 落款格式（另起两行，居左，不加前导空格）：
  换行后空一行，写：四川水发集团
  再换行写：${today}
- [[专家姓名]]专家您好！后面必须换行（不要跟正文连在同一行）

格式要求：
- 纯文本，禁止 Markdown、引号、星号
- 不提及其他专家姓名
- 感谢或客套语融入正文末句，不要单独成行
- 语气正式诚恳，信息完整但不啰嗦
- 直接输出通知全文`;

    try {
      this.metrics.llmCalls += 1;
      const start = Date.now();
      const raw = await this.llm.chat(
        '你是一位专业的政府企业采购评审管理专家，擅长撰写正式、诚恳的通知文书。',
        prompt,
        0.5,
        undefined, undefined,
        { timeoutMs: 20_000, retries: 0 },
      );
      this.metrics.lastLatencyMs = Date.now() - start;
      this.metrics.lastModel = this.llm.getModel();
      let content = typeof raw === 'string' ? raw.trim() : '';
      if (!content) return null;
      // 替换地点占位符（避免 LLM 翻译「设计」为 design 等英文）
      content = content.replace(/\{LOCATION\}/g, '四川水发集团设计公司3楼采购中心开评标室');
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
