import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LlmService } from '../local-ai/llm.service';

/**
 * 公告摘要 AI —— 统一走 LlmService 网关（2026-07 生产加固收口，此前直连 fetch）
 * 回退语义不变：未配置 key / 任何失败 → undefined（调用方展示原文预览）
 */
@Injectable()
export class AnnouncementAiService {
  private readonly logger = new Logger(AnnouncementAiService.name);

  constructor(
    private readonly llm: LlmService,
    private readonly config: ConfigService,
  ) {}

  /** LLM 是否已配置（供 controller 给出准确报错；未配置 DEEPSEEK_API_KEY 时为 false） */
  isConfigured(): boolean {
    return !!this.llm.getModel();
  }

  async summarize(input: { title: string; type: string; content: string }): Promise<string | undefined> {
    if (!this.llm.getModel()) return undefined;

    const plainContent = this.stripHtml(input.content).slice(0, 6000);
    if (!plainContent) return undefined;

    try {
      const summary = await this.llm.chat(
        [
          '你是四川省水利发展集团有限公司招采门户的信息摘要助手，熟悉国企采购公告、中标公示、政策法规和平台通知的正式表达。',
          '请为门户首页主卡片生成“归纳型摘要”，用于替代原文预览。',
          '要求：一、不得重复公告标题，不得照抄原文第一段，不得输出“AI摘要”等前缀；二、字数控制在160到240个汉字，必须以完整句子结束，不得留下半句话；三、根据公告类型提炼不同重点：招标公告突出采购内容、预算金额、实施地点、交付周期、报名和投标关键要求；中标公示突出评审状态、中标候选人、报价、周期、质量承诺、异议渠道；政策法规突出适用对象、管理要求、执行边界、监督责任；平台通知突出影响范围、功能变化、时间安排、用户操作和支持渠道；四、只使用原文已有信息，不得编造；五、语气正式、简洁、适合政府/国企采购门户。',
        ].join('\n'),
        `公告类型：${input.type}\n公告标题：${input.title}\n公告正文：\n${plainContent}`,
        0.2,
        undefined,
        undefined,
        {
          model: this.config.get<string>('DEEPSEEK_MODEL', 'deepseek-v4-flash'),
          maxTokens: 512,
          timeoutMs: 60_000,
        },
      );

      if (typeof summary !== 'string') return undefined;
      const cleaned = this.cleanSummary(summary);
      return cleaned.length >= 60 ? cleaned : undefined;
    } catch (error) {
      this.logger.warn(`DeepSeek summary error: ${error instanceof Error ? error.message : String(error)}`);
      return undefined;
    }
  }

  private stripHtml(content: string) {
    return content
      .replace(/<h2>.*?<\/h2>/gis, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private cleanSummary(summary: string) {
    const cleaned = summary
      .replace(/^AI摘要[:：]?/i, '')
      .replace(/^摘要[:：]?/, '')
      .replace(/[\r\n]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    return this.truncateAtSentence(cleaned, 320);
  }

  private truncateAtSentence(summary: string, maxLength: number) {
    const clipped = summary.slice(0, maxLength);
    if (summary.length <= maxLength && /[。！？]$/.test(clipped)) return clipped;

    // 1. 优先在句末标点（。；！？）处截断，至少保留 120 字
    const lastSentenceEnd = Math.max(
      clipped.lastIndexOf('。'),
      clipped.lastIndexOf('；'),
      clipped.lastIndexOf('！'),
      clipped.lastIndexOf('？'),
    );
    if (lastSentenceEnd >= 120) {
      return clipped.slice(0, lastSentenceEnd + 1).replace(/；$/, '。');
    }

    // 2. 退而求其次：在逗号/分号处截断（至少保留 60 字），替换为句号
    //    避免半句话被强行加句号（如 "交付周期以。" ← LLM 生成截断 + 旧兜底拼凑）
    const lastClauseSep = Math.max(
      clipped.lastIndexOf('，'),
      clipped.lastIndexOf('；'),
    );
    if (lastClauseSep >= 60) {
      return `${clipped.slice(0, lastClauseSep)}。`;
    }

    // 3. 无任何合理断点 → 去掉末尾标点，不强行加句号
    return clipped.replace(/[，、；：,;:]*$/, '');
  }
}
