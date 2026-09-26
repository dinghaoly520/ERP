import { Injectable, BadRequestException } from '@nestjs/common';
import { LlmService } from '../local-ai/llm.service';
import { LlmOutputValidator } from '../local-ai/llm-output-validator';
import { OcrService } from '../local-ai/ocr.service';
import { EmbeddingService } from '../local-ai/embedding.service';
import { PrismaService } from '../prisma/prisma.service';
import { getUploadDir } from '../project-management/docx/file-utils';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { processFile } from '../ai-bid-analysis/utils/file-processor';
import { SCORE_POINTS_EXTRACT_SYSTEM, SCORE_POINTS_EXTRACT_PROMPT } from './prompts/score-points.prompt';
import { ScorePointSuggestion, ScorePointSuggestionGroup } from '@water-erp/shared';

@Injectable()
export class ScorePointExtractorService {
  private readonly tenderTextCache = new Map<string, { text: string; expiresAt: number }>();
  private static readonly CACHE_TTL_MS = 1 * 60 * 1000; // 1 min；重型提取已有 DB 级懒缓存兜底

  constructor(
    private readonly llm: LlmService,
    private readonly validator: LlmOutputValidator,
    private readonly ocr: OcrService,
    private readonly embedding: EmbeddingService,
    private readonly prisma: PrismaService,
  ) {}

  async extractScorePoints(projectId: string, itemId: string, sourceAttachmentId?: string): Promise<ScorePointSuggestion[]> {
    const item = await this.prisma.bidScoreItem.findFirst({
      where: { id: itemId, projectId },
      include: { points: true },
    });
    if (!item) {
      throw new BadRequestException({ error: '评分项不存在', code: 'NOT_FOUND' });
    }

    // E5 撤除（2026-09-26 用户裁定）：03 阶段即配得分要点——招标文件含价格项则一并提取；
    // 价格分由公式算的口径仅适用于"公式已启用"项目，由 FE 联动切评标办法为专家评审兜底
    const tenderText = await this.getTenderText(projectId, sourceAttachmentId);
    if (!tenderText) {
      throw new BadRequestException({ error: '采购文件未就绪：请先在「采购文件」步骤通过「采购文件编写」导出或手动上传采购文件', code: 'TENDER_NOT_READY' });
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
          !!raw && typeof raw === 'object' && Array.isArray((raw as any).items) &&
          (raw as any).items.every((i: any) =>
            typeof i.name === 'string' && i.name.length > 0 &&
            typeof i.fullScore === 'number' && i.fullScore >= 0 &&
            typeof i.objective === 'boolean'
          ),
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

  /**
   * 一键提取：全部评分项逐项复用 extractScorePoints。
   * 招标文件文本预取一次写入 tenderTextCache（TTL 1min），逐项调用零成本命中；
   * 单项 LLM 失败由其内部 E6 降级返回 []，不中断整批。
   */
  async extractAllScorePoints(projectId: string, sourceAttachmentId?: string): Promise<ScorePointSuggestionGroup[]> {
    const items = await this.prisma.bidScoreItem.findMany({
      where: { projectId },
      orderBy: [{ category: 'asc' }, { createdAt: 'asc' }],
      include: { points: true },
    });
    if (items.length === 0) return [];

    const tenderText = await this.getTenderText(projectId, sourceAttachmentId);
    if (!tenderText) {
      throw new BadRequestException({ error: '采购文件未就绪：请先在「采购文件」步骤通过「采购文件编写」导出或手动上传采购文件', code: 'TENDER_NOT_READY' });
    }

    const groups: ScorePointSuggestionGroup[] = [];
    for (const item of items) {
      const suggestions = await this.extractScorePoints(projectId, item.id, sourceAttachmentId); // 含 PRICE（E5 撤除，2026-09-26）
      groups.push({
        itemId: item.id,
        itemName: item.name,
        category: item.category,
        maxScore: Number(item.maxScore),
        suggestions,
      });
    }
    return groups;
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
   * 规则优先：正则匹配「资格审查/符合性审查」章节（pass/fail 类专用）。
   * QUALIFICATION → 资格审查段；RESPONSIVE → 符合性审查段。返回章节全文或 null。
   * 关键：审查表（营业执照/资质/业绩；授权书/保证金/报价等）在「资格审查/符合性审查」节，
   * 不在「评分标准」节——后者只是评标办法说明（如最低价法），不含审查项。
   */
  private extractReviewSectionRegex(text: string, category: string): string | null {
    const isQual = category === 'QUALIFICATION';
    const patterns = isQual
      ? [
          /资格审查要求[\s\S]*?(?=符合性审查要求|综合评分法评标标准|第[一二三四五六七八九十百\d]+章\s)/i,
          /一、响应文件的资格审查[\s\S]*?(?=二、|综合评分法评标标准)/i,
          /资格审查[\s\S]*?(?=符合性审查|综合评分法评标标准|第[一二三四五六七八九十百\d]+章\s)/i,
        ]
      : [
          /符合性审查要求[\s\S]*?(?=综合评分法评标标准|比较和评价|第[一二三四五六七八九十百\d]+章\s)/i,
          /2\s*符合性审查[\s\S]*?(?=3\s|综合评分法评标标准|比较和评价)/i,
          /符合性审查[\s\S]*?(?=综合评分法评标标准|比较和评价|第[一二三四五六七八九十百\d]+章\s)/i,
        ];
    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match) {
        const section = match[0].trim();
        if (section.length > 100) return section;
      }
    }
    return null;
  }

  /**
   * 规则优先：正则匹配「采购需求」章节里的商务/技术要求段（打分类 BUSINESS/TECHNICAL 用）。
   * 商务/技术评分依据在采购需求章（如 ★商务要求 / ★技术要求），不在评分标准节（后者只含评标办法说明）。
   */
  private extractRequirementSectionRegex(text: string, category: string): string | null {
    const isBiz = category === 'BUSINESS';
    const patterns = isBiz
      ? [
          /二、\s*商务要求\s*\n[\s\S]*?(?=三、\s*技术要求\s*\n|第[一二三四五六七八九十百\d]+章\s)/i,
          /商务要求\s*\n[\s\S]*?(?=三、\s*技术要求\s*\n|第[一二三四五六七八九十百\d]+章\s)/i,
        ]
      : [
          /三、\s*技术要求\s*\n[\s\S]*?(?=第[一二三四五六七八九十百\d]+章\s|$)/i,
          /技术要求\s*\n[\s\S]*?(?=第[一二三四五六七八九十百\d]+章\s|$)/i,
        ];
    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match) {
        const section = match[0].trim();
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
    // 预处理：跳过目录行（HYPERLINK...PAGEREF），避免正则命中目录片段而非正文
    const cleaned = tenderText.replace(/HYPERLINK[^\n]*PAGEREF[^\n]*\n/g, '');
    // Step 0: pass/fail 类（资格/符合性审查）优先定位审查表章节（而非评分标准节——后者只含评标办法说明）
    if (item.category === 'QUALIFICATION' || item.category === 'RESPONSIVE') {
      const reviewSection = this.extractReviewSectionRegex(cleaned, item.category);
      if (reviewSection && reviewSection.length > 100) {
        return reviewSection.slice(0, 16000);
      }
    }
    // Step 0b: 打分类（商务/技术）优先定位采购需求章节（★商务/技术要求），而非评分标准节
    if (item.category === 'BUSINESS' || item.category === 'TECHNICAL') {
      const reqSection = this.extractRequirementSectionRegex(cleaned, item.category);
      if (reqSection && reqSection.length > 100) {
        return reqSection.slice(0, 16000);
      }
    }
    // Step 1: 正则匹配「评标办法」章节
    const regexSection = this.extractScoringSectionRegex(cleaned);
    if (regexSection && regexSection.length > 200) {
      return regexSection.slice(0, 16000);
    }

    // Step 2: embedding 搜索兜底
    const paragraphs = this.splitParagraphs(cleaned);
    if (paragraphs.length === 0) {
      return cleaned.slice(0, 8000);
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
      return cleaned.slice(0, 8000);
    }
  }

  /** 主动清除招标文件文本缓存（公告重发/文件替换时调用） */
  invalidateTenderCache(projectId: string): void {
    this.tenderTextCache.delete(projectId);
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

  /** 03 阶段提取源解析（2026-09-26 用户裁定：撤公告链——公告是 04 之后才有的内容，
   *  评分标准已前置到 03，提取只认「采购文件」步骤的文件）：
   *  - sourceAttachmentId 给定（完成向导=正式盖章版指针；评分标准按钮=用户多文件时选定的源）
   *    → 直读该附件，并校验其归属本项目（PMI）的「采购文件」步骤；
   *  - 未给定 → 兜底取该轮 03 阶段最新附件（不限类型）。
   *  注意 PMI 阶段附件是**本地盘存储**（persistUploadedFile→getUploadDir()+writeFile，
   *  objectKey 仅 `project-management/<file>` 命名约定，不进 MinIO）——须读本地文件。
   *  重型提取（扫描件 OCR 分钟级）结果经 Attachment.extractedText 落库懒缓存，
   *  saveAttachmentHtml 换文件时置空失效。 */
  private async resolveTenderAttachment(
    projectId: string,
    sourceAttachmentId?: string,
  ): Promise<{ id: string; fileName: string; extractedText: string | null; buffer: Buffer | null } | null> {
    const bp = await this.prisma.bidProject.findUnique({
      where: { id: projectId },
      select: { projectManagementItemId: true, round: true },
    });
    if (!bp?.projectManagementItemId) return null;

    const att = sourceAttachmentId
      ? await this.prisma.attachment.findUnique({
          where: { id: sourceAttachmentId },
          select: {
            id: true,
            fileName: true,
            objectKey: true,
            extractedText: true,
            projectManagementStageId: true,
          },
        })
      : await this.prisma.attachment.findFirst({
          where: {
            projectManagementStage: {
              projectManagementItemId: bp.projectManagementItemId,
              stageKey: 'TENDER_DOCUMENT',
              round: bp.round ?? 1,
            },
          },
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            fileName: true,
            objectKey: true,
            extractedText: true,
            projectManagementStageId: true,
          },
        });
    if (!att) return null;

    // 显式指定源：校验归属（本项目 03 步骤；不强制轮次——跨轮取旧文件无危害，仅提示层面约束）
    if (sourceAttachmentId && att.projectManagementStageId) {
      const stage = await this.prisma.projectManagementStage.findUnique({
        where: { id: att.projectManagementStageId },
        select: { projectManagementItemId: true, stageKey: true },
      });
      if (!stage
        || stage.projectManagementItemId !== bp.projectManagementItemId
        || stage.stageKey !== 'TENDER_DOCUMENT') {
        throw new BadRequestException({ error: '提取源文件不属于本项目「采购文件」步骤', code: 'SOURCE_INVALID' });
      }
    }

    try {
      const stored = att.objectKey.replace(/^project-management\//, '');
      const buffer = await readFile(resolve(getUploadDir(), stored));
      return { id: att.id, fileName: att.fileName, extractedText: att.extractedText, buffer };
    } catch {
      return null;
    }
  }

  private async getTenderText(projectId: string, sourceAttachmentId?: string): Promise<string | null> {
    const cacheKey = sourceAttachmentId ? `${projectId}:${sourceAttachmentId}` : `${projectId}:auto`;
    const cached = this.tenderTextCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.text;
    }
    const att = await this.resolveTenderAttachment(projectId, sourceAttachmentId);
    if (!att?.buffer) return null;

    // DB 懒缓存直读（扫描件 OCR 分钟级——重提取/换入口不再重跑）
    if (att.extractedText) {
      this.tenderTextCache.set(cacheKey, { text: att.extractedText, expiresAt: Date.now() + ScorePointExtractorService.CACHE_TTL_MS });
      return att.extractedText;
    }

    const processed = await processFile(this.ocr, att.buffer, att.fileName);
    this.tenderTextCache.set(cacheKey, { text: processed.text, expiresAt: Date.now() + ScorePointExtractorService.CACHE_TTL_MS });
    // 提取文本落库懒缓存（fire-and-forget；失败不影响本次提取）
    if (processed.text.trim().length > 0) {
      this.prisma.attachment.update({
        where: { id: att.id },
        data: { extractedText: processed.text, extractedTextAt: new Date() },
      }).catch(() => { /* 缓存写入失败静默 */ });
    }
    return processed.text;
  }
}
