// apps/api/src/bid/clarification-ai.service.ts
// P1-F：澄清答疑 LLM 辅助 —— 提炼回复要点（写 aiSummary）。
// （起草候选问题 draftQuestion 已按用户裁定删除，2026-09-21，两端同删。）
// 全程降级：LLM 失败/无数据 → null summary，不阻塞澄清主流程。
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { LlmService } from '../local-ai/llm.service';
import { CLARIFICATION_SUMMARY_PROMPT } from '../ai-bid-analysis/prompts/clarification-summary.prompt';

@Injectable()
export class ClarificationAiService {
  private readonly logger = new Logger(ClarificationAiService.name);

  constructor(
    private prisma: PrismaService,
    private llm: LlmService,
  ) {}

  /**
   * 提炼回复要点（供全体评委速读）。返回 null 表示不写 aiSummary（LLM 失败/无 reply）。
   */
  async summarizeReply(question: string, reply: string | null): Promise<{ summary: string; keyPoints: string[] } | null> {
    if (!reply) return null;
    try {
      const prompt = CLARIFICATION_SUMMARY_PROMPT
        .replace('{{QUESTION}}', question)
        .replace('{{REPLY}}', reply.slice(0, 2000));
      const result = await this.llm.chatJson<{ summary: string; keyPoints: string[] }>(
        '你是招投标澄清答疑专家。',
        prompt,
        0,
      );
      return { summary: result.summary ?? '', keyPoints: result.keyPoints ?? [] };
    } catch (e) {
      this.logger.warn(`summarizeReply LLM failed: ${String(e).slice(0, 150)}`);
      return null;
    }
  }
}
