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
                '你是四川水发集团招采门户的信息摘要助手。',
                '请为门户首页卡片生成正式、简洁、信息密度高的中文摘要。',
                '要求：不重复公告标题；不照抄原文开头；控制在80到140字；提取项目阶段、采购或中标核心信息、金额、周期、报名或异议重点；原文没有的信息不要编造；只输出摘要正文。',
              ].join('\n'),
            },
            {
              role: 'user',
              content: `公告类型：${input.type}\n公告标题：${input.title}\n公告正文：\n${plainContent}`,
            },
          ],
          temperature: 0.2,
          max_tokens: 220,
        }),
      });

      if (!response.ok) {
        this.logger.warn(`DeepSeek summary failed: ${response.status} ${await response.text()}`);
        return undefined;
      }

      const data = await response.json();
      const summary = data?.choices?.[0]?.message?.content;
      return typeof summary === 'string' ? this.cleanSummary(summary) : undefined;
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
    return summary
      .replace(/^AI摘要[:：]?/i, '')
      .replace(/^摘要[:：]?/, '')
      .replace(/[\r\n]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 180);
  }
}
