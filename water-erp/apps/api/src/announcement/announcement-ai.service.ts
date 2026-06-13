import { Injectable, Logger } from '@nestjs/common';

const DEEPSEEK_API_URL = process.env.DEEPSEEK_API_URL ?? 'https://api.deepseek.com';
const DEEPSEEK_MODEL = process.env.DEEPSEEK_MODEL ?? 'deepseek-v4-flash';

@Injectable()
export class AnnouncementAiService {
  private readonly logger = new Logger(AnnouncementAiService.name);

  async summarize(input: { title: string; type: string; content: string }): Promise<string | undefined> {
    const apiKey = process.env.DEEPSEEK_API_KEY;
    if (!apiKey) return undefined;

    const plainContent = this.stripHtml(input.content).slice(0, 6000);
    if (!plainContent) return undefined;

    try {
      const response = await fetch(`${DEEPSEEK_API_URL.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: DEEPSEEK_MODEL,
          messages: [
            {
              role: 'system',
              content: [
                '你是四川水发集团招采门户的信息摘要助手，熟悉国企采购公告、中标公示、政策法规和平台通知的正式表达。',
                '请为门户首页主卡片生成“归纳型摘要”，用于替代原文预览。',
                '要求：一、不得重复公告标题，不得照抄原文第一段，不得输出“AI摘要”等前缀；二、字数控制在160到240个汉字，必须以完整句子结束，不得留下半句话；三、根据公告类型提炼不同重点：招标公告突出采购内容、预算金额、实施地点、交付周期、报名和投标关键要求；中标公示突出评审状态、中标候选人、报价、周期、质量承诺、异议渠道；政策法规突出适用对象、管理要求、执行边界、监督责任；平台通知突出影响范围、功能变化、时间安排、用户操作和支持渠道；四、只使用原文已有信息，不得编造；五、语气正式、简洁、适合政府/国企采购门户。',
              ].join('\n'),
            },
            {
              role: 'user',
              content: `公告类型：${input.type}\n公告标题：${input.title}\n公告正文：\n${plainContent}`,
            },
          ],
          temperature: 0.2,
          max_tokens: 420,
        }),
      });

      if (!response.ok) {
        this.logger.warn(`DeepSeek summary failed: ${response.status} ${await response.text()}`);
        return undefined;
      }

      const data = await response.json();
      const summary = data?.choices?.[0]?.message?.content;
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

    const lastPunctuation = Math.max(
      clipped.lastIndexOf('。'),
      clipped.lastIndexOf('；'),
      clipped.lastIndexOf('！'),
      clipped.lastIndexOf('？'),
    );

    if (lastPunctuation >= 120) {
      return clipped.slice(0, lastPunctuation + 1).replace(/；$/, '。');
    }

    return `${clipped.replace(/[，、；：,;:]*$/, '')}。`;
  }
}
