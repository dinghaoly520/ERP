import { Injectable, BadRequestException } from '@nestjs/common';
import { LlmService } from '../local-ai/llm.service';
import { LlmOutputValidator } from '../local-ai/llm-output-validator';
import { PlaintextFetcherService } from '../ai-bid-analysis/services/plaintext-fetcher.service';
import { OcrService } from '../local-ai/ocr.service';
import { EmbeddingService } from '../local-ai/embedding.service';
import { PrismaService } from '../prisma/prisma.service';
import { processFile } from '../ai-bid-analysis/utils/file-processor';
import { SCORE_POINTS_EXTRACT_SYSTEM, SCORE_POINTS_EXTRACT_PROMPT } from './prompts/score-points.prompt';

export interface ScorePointSuggestion {
  name: string;
  fullScore: number;
  evidenceHint: string;
  objective: boolean;
  evidenceSection?: string;   // E1: 招标文件相关章节名称（如'第三章 评标办法'）
  confidence?: number;         // E1: 0-1 信心分
  adjusted?: boolean;          // E2: true 表示 fullScore 被等比缩放过
  duplicate?: boolean;         // E4: true 表示与已有得分点高度相似
}

@Injectable()
export class ScorePointExtractorService {
  private readonly tenderTextCache = new Map<string, { text: string; expiresAt: number }>();
  private static readonly CACHE_TTL_MS = 1 * 60 * 1000; // 1 min,公告重发后快速过期

  constructor(
    private readonly llm: LlmService,
    private readonly validator: LlmOutputValidator,
    private readonly plaintextFetcher: PlaintextFetcherService,
    private readonly ocr: OcrService,
    private readonly embedding: EmbeddingService,
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

    // E5: PRICE 类别的得分点由报价公式计算，无需 AI 提取
    if (item.category === 'PRICE') {
      return [];
    }

    const tenderText = await this.getTenderText(projectId);
    if (!tenderText) {
      throw new BadRequestException({ error: '招标文件未就绪（未发布招标公告或无招标文件）', code: 'TENDER_NOT_READY' });
    }

    // E1: 语义定位（规则优先 → embedding 兜底）
    const relevantText = await this.getRelevantTenderSection(tenderText, item);

    const prompt = SCORE_POINTS_EXTRACT_PROMPT
      .replace('{{SCORE_ITEM}}', JSON.stringify({ category: item.category, name: item.name }))
      .replace(/{{MAX_SCORE}}/g, String(Number(item.maxScore)))
      .replace('{{EXISTING_POINTS}}', JSON.stringify(item.points.map((p) => p.name)))
      .replace('{{TENDER_TEXT}}', JSON.stringify(relevantText));

    // E6: LLM 降级 —— 失败不抛 500,返回空数组让管理员手动添加
    let result: { items: ScorePointSuggestion[] };
    try {
      result = await this.validator.retryChatJson<{ items: ScorePointSuggestion[] }>(
        this.llm,
        SCORE_POINTS_EXTRACT_SYSTEM,
        prompt,
        (raw): raw is { items: ScorePointSuggestion[] } =>
          !!raw && typeof raw === 'object' && Array.isArray((raw as any).items),
        2,
      );
    } catch {
      return [];
    }

    // E4: 去重 —— 标记与已有得分点高度相似的建议
    for (const point of result.items) {
      for (const existing of item.points) {
        if (this.isDuplicateName(point.name, existing.name)) {
          point.duplicate = true;
          break;
        }
      }
    }

    // E2: fullScore 归一化 —— 如果合计超过 maxScore,等比缩放
    const maxScore = Number(item.maxScore);
    const sum = result.items.reduce((s, p) => s + (Number(p.fullScore) || 0), 0);
    if (sum > maxScore && result.items.length > 0) {
      const ratio = maxScore / sum;
      for (const point of result.items) {
        point.fullScore = Math.round(Number(point.fullScore) * ratio * 10) / 10;
        point.adjusted = true;
      }
    }

    return result.items;
  }

  // ── E1 辅助方法 ──

  /**
   * 规则优先：正则匹配「评标办法」章节。
   * 返回章节全文，或 null（未匹配）。
   */
  private extractScoringSectionRegex(text: string): string | null {
    const patterns = [
      /第[一二三四五六七八九十百\d]+章\s*评标办法[^\n]*([\s\S]*?)(?=第[一二三四五六七八九十百\d]+章\s|\n第[一二三四五六七八九十百\d]+章|$)/i,
      /评标办法[^\n]*\n([\s\S]*?)(?=\n第[一二三四五六七八九十百\d]+章|$)/i,
      /评分标准[^\n]*\n([\s\S]*?)(?=\n第[一二三四五六七八九十百\d]+章|$)/i,
      /评分办法[^\n]*\n([\s\S]*?)(?=\n第[一二三四五六七八九十百\d]+章|$)/i,
      /第[一二三四五六七八九十百\d]+章\s*评审方法[^\n]*([\s\S]*?)(?=第[一二三四五六七八九十百\d]+章\s|\n第[一二三四五六七八九十百\d]+章|$)/i,
    ];
    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match) {
        const section = (match[1] ?? match[0]).trim();
        if (section.length > 100) return section;
      }
    }
    return null;
  }

  /**
   * 分段：按双换行拆分，超 1500 字按单换行再拆。
   */
  private splitParagraphs(text: string): { content: string; index: number }[] {
    const raw = text.split(/\n\s*\n/).filter((p) => p.trim().length > 20);
    const result: { content: string; index: number }[] = [];
    for (const [i, para] of raw.entries()) {
      if (para.length > 1500) {
        const subs = para.split(/\n/).filter((s) => s.trim().length > 20);
        for (const sub of subs) {
          result.push({ content: sub.trim().slice(0, 2000), index: i });
        }
      } else {
        result.push({ content: para.trim(), index: i });
      }
    }
    return result;
  }

  /** 余弦相似度 */
  private cosineSimilarity(a: number[], b: number[]): number {
    let dot = 0, normA = 0, normB = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    return dot / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  /**
   * E1: 定位招标文件中最相关的片段。
   * 1) 规则优先（正则匹配章节）→ 2) embedding 搜索兜底 → 3) 截断兜底。
   */
  private async getRelevantTenderSection(
    tenderText: string,
    item: { category: string; name: string },
  ): Promise<string> {
    // Step 1: 正则匹配「评标办法」章节
    const regexSection = this.extractScoringSectionRegex(tenderText);
    if (regexSection && regexSection.length > 200) {
      return regexSection.slice(0, 16000);
    }

    // Step 2: embedding 搜索兜底
    const paragraphs = this.splitParagraphs(tenderText);
    if (paragraphs.length === 0) {
      return tenderText.slice(0, 8000);
    }

    const query = `评分标准 ${item.category} ${item.name}`;
    try {
      const [queryVec, ...paraVecs] = await this.embedding.embed([
        query,
        ...paragraphs.map((p) => p.content),
      ]);

      const ranked = paragraphs.map((p, i) => ({
        ...p,
        score: this.cosineSimilarity(queryVec, paraVecs[i]),
      }));
      ranked.sort((a, b) => b.score - a.score);

      const topK = ranked.slice(0, 20);
      return topK.map((p) => p.content).join('\n\n').slice(0, 16000);
    } catch {
      // Step 3: embedding 不可用时回退
      return tenderText.slice(0, 8000);
    }
  }

  // ── E4 辅助方法 ──

  /** Levenshtein 编辑距离 */
  private levenshtein(a: string, b: string): number {
    const m = a.length, n = b.length;
    const dp: number[][] = Array.from({ length: m + 1 }, (_, i) => [i]);
    for (let j = 0; j <= n; j++) dp[0][j] = j;
    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
      }
    }
    return dp[m][n];
  }

  /** 判断两个名称是否高度相似（编辑距离归一化 ≤ 0.3 或互相包含）。 */
  private isDuplicateName(a: string, b: string): boolean {
    const na = a.trim(), nb = b.trim();
    if (na === nb) return true;
    if (na.includes(nb) || nb.includes(na)) return true;
    const dist = this.levenshtein(na, nb);
    const maxLen = Math.max(na.length, nb.length);
    return maxLen > 0 && dist / maxLen <= 0.3;
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
