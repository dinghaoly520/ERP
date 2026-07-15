import { Injectable, BadRequestException } from '@nestjs/common';
import { LlmService } from '../local-ai/llm.service';
import { LlmOutputValidator } from '../local-ai/llm-output-validator';
import { PlaintextFetcherService } from '../ai-bid-analysis/services/plaintext-fetcher.service';
import { OcrService } from '../local-ai/ocr.service';
import { PrismaService } from '../prisma/prisma.service';
import { processFile } from '../ai-bid-analysis/utils/file-processor';
import { SCORE_POINTS_EXTRACT_SYSTEM, SCORE_POINTS_EXTRACT_PROMPT } from './prompts/score-points.prompt';

export interface ScorePointSuggestion {
  name: string;
  fullScore: number;
  evidenceHint: string;
  objective: boolean;
}

@Injectable()
export class ScorePointExtractorService {
  private readonly tenderTextCache = new Map<string, { text: string; expiresAt: number }>();
  private static readonly CACHE_TTL_MS = 5 * 60 * 1000;

  constructor(
    private readonly llm: LlmService,
    private readonly validator: LlmOutputValidator,
    private readonly plaintextFetcher: PlaintextFetcherService,
    private readonly ocr: OcrService,
    private readonly prisma: PrismaService,
  ) {}

  async extractScorePoints(projectId: string, itemId: string): Promise<ScorePointSuggestion[]> {
    const item = await this.prisma.bidScoreItem.findFirst({
      where: { id: itemId, projectId },
      include: { points: true },
    });
    if (!item) {
      throw new BadRequestException({ error: '评分项不存在', code: 'NOT_FOUND' });
    }

    const tenderText = await this.getTenderText(projectId);
    if (!tenderText) {
      throw new BadRequestException({ error: '招标文件未就绪（未发布招标公告或无招标文件）', code: 'TENDER_NOT_READY' });
    }

    const prompt = SCORE_POINTS_EXTRACT_PROMPT
      .replace('{{SCORE_ITEM}}', JSON.stringify({ category: item.category, name: item.name }))
      .replace(/{{MAX_SCORE}}/g, String(Number(item.maxScore)))
      .replace('{{EXISTING_POINTS}}', JSON.stringify(item.points.map((p) => p.name)))
      .replace('{{TENDER_TEXT}}', JSON.stringify(tenderText.slice(0, 10000)));

    const result = await this.validator.retryChatJson<{ items: ScorePointSuggestion[] }>(
      this.llm,
      SCORE_POINTS_EXTRACT_SYSTEM,
      prompt,
      (raw): raw is { items: ScorePointSuggestion[] } =>
        !!raw && typeof raw === 'object' && Array.isArray((raw as any).items),
      2,
    );

    return result.items;
  }

  private async getTenderText(projectId: string): Promise<string | null> {
    const cached = this.tenderTextCache.get(projectId);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.text;
    }
    const buffer = await this.plaintextFetcher.fetchTenderPlaintext(projectId);
    if (!buffer) return null;
    const processed = await processFile(this.ocr, buffer, 'tender.pdf');
    this.tenderTextCache.set(projectId, { text: processed.text, expiresAt: Date.now() + ScorePointExtractorService.CACHE_TTL_MS });
    return processed.text;
  }
}
