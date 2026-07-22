// apps/api/src/bid/clarification-ai.service.ts
// P1-F：澄清答疑 LLM 辅助 —— 起草候选问题（不落库）+ 提炼回复要点（写 aiSummary）。
// 全程降级：LLM 失败/无数据 → 空 drafts / null summary，不阻塞澄清主流程。
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { LlmService } from '../local-ai/llm.service';
import { CLARIFICATION_DRAFT_PROMPT } from '../ai-bid-analysis/prompts/clarification-draft.prompt';
import { CLARIFICATION_SUMMARY_PROMPT } from '../ai-bid-analysis/prompts/clarification-summary.prompt';

@Injectable()
export class ClarificationAiService {
  private readonly logger = new Logger(ClarificationAiService.name);

  constructor(
    private prisma: PrismaService,
    private llm: LlmService,
  ) {}

  /**
   * 起草澄清问题候选（基于该供应商 AI 分析的弱点 + 未响应★条款）。
   * 不落库——专家改完再走 createClarification 入库。
   */
  async draftQuestion(projectId: string, supplierId: string): Promise<{ drafts: string[]; basis: string[] }> {
    try {
      const br = await this.prisma.aiBidderResult.findFirst({
        where: { bidSupplierId: supplierId, status: 'COMPLETED', bidSupplier: { projectId } }, // P1-1：项目约束，防跨项目读取
        select: {
          weaknesses: true,
          starredResponse: true,
          bidSupplier: { select: { supplierName: true } },
        },
      });
      if (!br) return { drafts: [], basis: [] };

      const weaknesses = (br.weaknesses as any[]) ?? [];
      const weaknessesText = weaknesses.length
        ? weaknesses.map((w) => w?.point ?? w?.title ?? JSON.stringify(w)).join('\n')
        : '（无）';
      const unmet = ((br.starredResponse as any)?.unmet as string[]) ?? [];
      const unmetText = unmet.length ? unmet.join('\n') : '（无）';
      const supplierName = br.bidSupplier?.supplierName ?? '';

      const prompt = CLARIFICATION_DRAFT_PROMPT
        .replace('{{SUPPLIER_NAME}}', supplierName)
        .replace('{{WEAKNESSES}}', weaknessesText)
        .replace('{{UNMET}}', unmetText);

      const result = await this.llm.chatJson<{ drafts: string[]; basis: string[] }>(
        '你是招投标澄清答疑专家。',
        prompt,
        0.3,
      );
      return { drafts: result.drafts ?? [], basis: result.basis ?? [] };
    } catch (e) {
      this.logger.warn(`draftQuestion LLM failed: ${String(e).slice(0, 150)}`);
      return { drafts: [], basis: [] };
    }
  }

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
