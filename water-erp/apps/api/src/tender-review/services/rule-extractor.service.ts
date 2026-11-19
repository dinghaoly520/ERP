import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { LlmService } from '../../local-ai/llm.service';
import { ClauseParserService, Clause } from './clause-parser.service';
import {
  RULE_CHECK_TARGETS,
  RULE_UNITS,
  RULE_SEVERITIES,
} from '@water-erp/shared';

/** 枚举段自 @water-erp/shared 单源注入（2026-11-19 审查 #13）：提示词/后端归一/
 *  前端表单三处同源，加值只改 shared 一处，漏改即「选项表静默改写」复发 */
const UNIT_ENUM_LINE = RULE_UNITS.map((u) => `"${u.value}"(${u.label})`).join(', ');
const CHECK_TARGET_ENUM_LINE = RULE_CHECK_TARGETS.map((t) => `"${t}"`).join('、');

const EXTRACTION_SYSTEM_PROMPT = `你是一个采购合规审查专家。你的任务是从采购管理制度条款中提取可自动检查的结构化规则。

对于每条条款，输出一个 JSON 数组，数组中的每个元素是一条规则对象。如果该条款不包含可检查的规则，返回空数组 []。

每个规则对象必须严格包含以下字段（字段名不能改）：
- "source": 条款来源编号，如 "第十九条"、"一、总体要求"、"第三部分"。如果输入的条款标签是"段落N"或"第N部分"，source 填写该标签原文。不要编造不存在的条款编号。
- "name": 规则简述，一句话描述检查内容
- "ruleType": 必须是以下三者之一："numeric_compare"、"existence_check"、"semantic"
- "checkTarget": 检查对象，如 "采购公告"、"投标文件"、"合同"、"评标报告"、"采购文件"、"全部"
- "logicExpression": 规则逻辑对象
  - numeric_compare 类型: { "field": "字段名", "operator": ">="或"<="或">"或"<"或"=="或"!=", "threshold": 数值, "unit": 单位代码 }
    unit 可选值: ${UNIT_ENUM_LINE}
    根据条款内容选择最合适的单位，例如"30日内"用"days"，"3%以上"用"percent"，"不少于3家"用"count"
  - existence_check 类型: { "checkType": "keyword"或"section", "keywords": ["关键词1"], "sectionName": "章节名" }
  - semantic 类型: { "description": "检查描述" }
- "severity": 必须是以下三者之一："critical"、"warning"、"info"

注意：
- 不要遗漏任何可检查的规则，包括隐含的合规要求（如"应当公开招标"、"不得分包"等）
- 当条款包含数字+单位（如"30日"、"50万"、"3家"）时，优先使用 numeric_compare 而非 semantic
- 当条款包含"应当提供"/"必须包含"/"不得缺少"等存在性要求时，优先使用 existence_check 而非 semantic
- checkTarget 只能使用以下值之一：${CHECK_TARGET_ENUM_LINE}
- 对于确实无法归入 numeric_compare 或 existence_check 的规则才使用 semantic 类型
- 一条条款可能包含多条规则，请全部提取
- source 必须直接使用输入中 [标签] 的内容，不要推测或改写

示例输出：
[{"source":"第五条","name":"采购金额50万以上必须竞标","ruleType":"numeric_compare","checkTarget":"采购文件","logicExpression":{"field":"budgetAmount","operator":">=","threshold":500000,"unit":"cny"},"severity":"critical"}]

请以 JSON 格式输出，不要包含 markdown 代码块标记。`;

const REVIEW_SYSTEM_PROMPT = `你是一个采购合规审查专家。你将看到一份采购管理制度的全文，或按未覆盖条款定位的相关节选，以及已经从中提取的规则列表。

你的任务是检查是否有**遗漏的规则**。请仔细阅读可见内容，找出所有尚未提取的可检查规则。

输出格式（JSON 数组），与提取规则格式相同。如果没有遗漏，返回空数组 []。

注意：
- 重点检查隐含的合规要求（如"应当..."、"不得..."、"必须..."、"禁止..."等表述）
- 检查跨条款的关联规则（基于可见内容）
- 不要重复已提取的规则`;

/** 查漏 Pass 2 的每组条款数（2026-11-19 增强①：由「截断上限」改为「分组粒度」——
 *  未覆盖条款不再截为 15 条×500 字，而是按组逐轮查漏、条款送全文，长文件尾部
 *  安全网同权覆盖；组内条数即定位窗口预算的除数，两处消费同源） */
const MAX_REVIEW_ITEMS = 15;

/** 条款工作项（2026-11-19 审查 #11）：offset=条款在原文中的精确偏移
 *  （ClauseParser 已算出），查漏定位窗口优先用它，indexOf 首次命中会锚错 */
type ExtractItem = { label: string; text: string; offset: number | null };

export type ExtractionProgress = {
  /** Incremental callback to report progress during extraction */
  onProgress?: (extractedCount: number, fileName: string) => Promise<void>;
};

@Injectable()
export class RuleExtractorService {
  private readonly logger = new Logger(RuleExtractorService.name);

  constructor(
    private prisma: PrismaService,
    private llm: LlmService,
    private clauseParser: ClauseParserService,
  ) {}

  async extractFromKnowledgeBase(
    knowledgeBaseId: string,
    progress?: ExtractionProgress,
    skipFiles: string[] = [],
  ): Promise<number> {
    const files = await this.prisma.knowledgeFile.findMany({
      // status READY 闸（2026-11-06 解析异步化）：PARSING/FAILED 不参与规则提取；
      // 下方 !file.content 双保险保留（READY 行恒有 content）
      where: { knowledgeBaseId, isActive: true, status: 'READY' },
    });

    // Load existing rules for deduplication
    const existingRules = await this.prisma.complianceRule.findMany({
      where: { knowledgeBaseId },
      select: { name: true, source: true, ruleType: true },
    });
    const existingKeys = new Set(
      existingRules.map((r) => this.dedupKey(r.ruleType, r.name)),
    );

    let totalExtracted = 0;
    const failedFiles: string[] = [];

    this.logger.log(
      `Starting rule extraction for KB ${knowledgeBaseId}: ${files.length} files, ${existingRules.length} existing rules`,
    );

    for (const file of files) {
      if (skipFiles.includes(file.fileName)) {
        this.logger.log(`Skipping already processed file "${file.fileName}"`);
        continue;
      }
      if (!file.content) {
        this.logger.warn(`Skipping file "${file.fileName}": no content`);
        continue;
      }
      try {
        const extracted = await this.extractFromFile(
          file.content,
          file.fileName,
          knowledgeBaseId,
          existingKeys,
          {
            onBatchProgress: async (fileCount) => {
              if (progress?.onProgress) {
                await progress.onProgress(totalExtracted + fileCount, file.fileName);
              }
            },
          },
        );
        totalExtracted += extracted;
        this.logger.log(
          `Extracted ${extracted} rules from "${file.fileName}" (total: ${totalExtracted})`,
        );
        if (progress?.onProgress) {
          await progress.onProgress(totalExtracted, file.fileName);
        }
      } catch (e) {
        failedFiles.push(file.fileName);
        this.logger.error(
          `Failed to extract from file "${file.fileName}": ${String(e).slice(0, 300)}`,
        );
      }
    }

    if (failedFiles.length > 0) {
      this.logger.warn(
        `Extraction completed with ${failedFiles.length} failed file(s): ${failedFiles.join(', ')}`,
      );
    }

    return totalExtracted;
  }

  private async extractFromFile(
    content: string,
    fileName: string,
    knowledgeBaseId: string,
    existingKeys: Set<string>,
    batchProgress?: { onBatchProgress: (fileCount: number) => Promise<void> },
  ): Promise<number> {
    const parsed = this.clauseParser.parse(content);
    const clauses = parsed.clauses;

    // Fallback: if clause parser found nothing, split into chunks
    const rawItems: ExtractItem[] =
      clauses.length > 0
        ? clauses.map((c) => ({
            label: `${c.clauseNumber}${c.title ? ' ' + c.title : ''}`,
            text: c.content,
            offset: c.startOffset,
          }))
        : this.splitIntoChunks(content);

    // Split long clauses into sub-sections
    const items = this.expandLongItems(rawItems);

    if (items.length === 0) return 0;

    let count = 0;
    const batchSize = 5;
    const MAX_RETRIES = 2;
    let failedBatches = 0;

    // Pass 1: batch extraction with retry
    for (let i = 0; i < items.length; i += batchSize) {
      const batch = items.slice(i, i + batchSize);
      const context = this.buildBatchContext(items, i, batchSize);
      const clausesText = batch
        .map((c) => `[${c.label}]\n${c.text}`)
        .join('\n\n---\n\n');

      const prompt = `${context}\n\n以下来自文件"${fileName}"的${batch.length}条制度条款：\n\n${clausesText}`;
      let rules: any[] | null = null;

      for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
          const result = await this.llm.chatJson<any[]>(
            EXTRACTION_SYSTEM_PROMPT,
            prompt,
          );

          if (Array.isArray(result)) {
            rules = result;
            break;
          }
        } catch (e) {
          const isLastAttempt = attempt === MAX_RETRIES;
          if (isLastAttempt) {
            failedBatches++;
            this.logger.warn(
              `Batch extraction failed for file "${fileName}" at item ${i} after ${MAX_RETRIES} attempts: ${String(e).slice(0, 200)}`,
            );
          } else {
            this.logger.warn(
              `Batch extraction attempt ${attempt}/${MAX_RETRIES} failed for file "${fileName}" at item ${i}, retrying...`,
            );
            // Brief pause before retry to avoid hammering the API
            await new Promise((r) => setTimeout(r, 1000));
          }
        }
      }

      if (rules) {
        const saved = await this.saveRules(
          rules,
          batch,
          fileName,
          knowledgeBaseId,
          existingKeys,
        );
        count += saved;
        if (saved > 0 && batchProgress?.onBatchProgress) {
          await batchProgress.onBatchProgress(count);
        }
      }
    }

    if (failedBatches > 0) {
      this.logger.warn(
        `File "${fileName}": ${failedBatches}/${Math.ceil(items.length / batchSize)} batches failed after retries`,
      );
    }

    // Pass 2: review for missed rules — use source field for accurate matching
    const existingRuleSources = await this.prisma.complianceRule.findMany({
      where: { knowledgeBaseId },
      select: { source: true },
    });
    const coveredLabels = new Set(
      existingRuleSources.map((r) => r.source.split('（')[0].trim()),
    );
    const uncoveredItems = items.filter(
      (item) => !coveredLabels.has(item.label),
    );

    // 全量查漏·分组逐轮（2026-11-19 增强①）：未覆盖条款去截断——旧实现硬顶
    // 15 条×每条 500 字，长文件（未覆盖条款多）尾部安全网变薄；现按组（每组
    // MAX_REVIEW_ITEMS 条）轮询查漏、条款送全文，直至全部覆盖。单组失败重试后
    // 跳过（reviewForMissedRules 返 []），不拖垮其余组
    if (uncoveredItems.length > 0) {
      const allExtractedNames = [...existingKeys].map((k) => {
        const parts = k.split(':');
        return parts.length > 1
          ? `[${parts[0]}] ${parts.slice(1).join(':')}`
          : k;
      });
      for (let gi = 0; gi < uncoveredItems.length; gi += MAX_REVIEW_ITEMS) {
        const group = uncoveredItems.slice(gi, gi + MAX_REVIEW_ITEMS);
        const groupText = group
          .map((c) => `[${c.label}]\n${c.text}`)
          .join('\n\n---\n\n');
        const reviewResult = await this.reviewForMissedRules(
          content,
          fileName,
          allExtractedNames,
          groupText,
          group,
        );

        if (reviewResult.length > 0) {
          const saved = await this.saveRules(
            reviewResult,
            items,
            fileName,
            knowledgeBaseId,
            existingKeys,
          );
          count += saved;
          if (saved > 0 && batchProgress?.onBatchProgress) {
            await batchProgress.onBatchProgress(count);
          }
        }
      }
    }

    return count;
  }

  private buildBatchContext(
    items: Array<{ label: string; text: string }>,
    currentIdx: number,
    batchSize: number,
  ): string {
    const total = items.length;
    const batchStart = currentIdx;
    const batchEnd = Math.min(currentIdx + batchSize, total);

    const prevItem = batchStart > 0 ? items[batchStart - 1] : null;
    const nextItem = batchEnd < total ? items[batchEnd] : null;

    let context = `文档共 ${total} 条条款，当前处理第 ${batchStart + 1}-${batchEnd} 条。`;
    if (prevItem) {
      context += `\n上一条: [${prevItem.label}]`;
    }
    if (nextItem) {
      context += `\n下一条: [${nextItem.label}]`;
    }
    return context;
  }

  private async reviewForMissedRules(
    content: string,
    fileName: string,
    existingRules: string[],
    uncoveredText: string,
    uncoveredItems: ExtractItem[],
  ): Promise<any[]> {
    const { text: fullText, mode } = this.buildReviewContextText(content, uncoveredItems);
    // 标签如实（2026-11-19 审查 #4）：回落头部截断时不再谎称「已按未覆盖条款定位」
    const fullTextLabel =
      mode === 'windows'
        ? '文件相关节选（超长文档，已按未覆盖条款定位上下文）：'
        : mode === 'head'
          ? '文件内容（超长文档，截取前 50000 字）：'
          : '文件全文：';

    const prompt = `文件名: "${fileName}"\n\n已提取的规则列表（${existingRules.length} 条）：\n${existingRules.map((r) => '- ' + r).join('\n')}\n\n以下条款尚未提取到任何规则，请重点检查：\n\n${uncoveredText}\n\n${fullTextLabel}\n${fullText}`;

    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const result = await this.llm.chatJson<any[]>(
          REVIEW_SYSTEM_PROMPT,
          prompt,
        );

        if (Array.isArray(result)) return result;
      } catch (e) {
        if (attempt === 2) {
          this.logger.warn(
            `Review pass failed for file "${fileName}" after 2 attempts: ${String(e).slice(0, 200)}`,
          );
        } else {
          this.logger.warn(
            `Review pass attempt 1/2 failed for file "${fileName}", retrying...`,
          );
          await new Promise((r) => setTimeout(r, 1000));
        }
      }
    }
    return [];
  }

  /** 超长文档查漏上下文（2026-11-19 审查 #4/#11）：优先用条款解析器的精确偏移
   *  （indexOf 首次命中会把窗口锚到前文引用的同 wording 段落），±1500 字窗口
   *  重叠合并，MAX_REVIEW_ITEMS 上限下 ≤45k 字与旧 50k 预算同量级；偏移缺失
   *  回落 probe 定位；定位全失败回落头部截断（旧行为兜底，mode 如实标注） */
  private buildReviewContextText(
    content: string,
    uncoveredItems: ExtractItem[],
  ): { text: string; mode: 'full' | 'windows' | 'head' } {
    const LIMIT = 50000;
    if (content.length <= LIMIT) return { text: content, mode: 'full' };
    const WINDOW = 1500;
    const ranges: Array<[number, number]> = [];
    for (const item of uncoveredItems) {
      let idx = -1;
      if (
        typeof item.offset === 'number' &&
        item.offset >= 0 &&
        item.offset < content.length
      ) {
        idx = item.offset;
      } else {
        const probe = item.text.trim().slice(0, 80);
        if (probe) idx = content.indexOf(probe);
      }
      if (idx < 0) continue;
      ranges.push([
        Math.max(0, idx - WINDOW),
        Math.min(content.length, idx + WINDOW),
      ]);
    }
    if (ranges.length === 0) {
      return { text: content.slice(0, LIMIT), mode: 'head' };
    }
    ranges.sort((a, b) => a[0] - b[0]);
    const merged: Array<[number, number]> = [];
    for (const r of ranges) {
      const last = merged[merged.length - 1];
      if (last && r[0] <= last[1]) {
        last[1] = Math.max(last[1], r[1]);
      } else {
        merged.push([r[0], r[1]]);
      }
    }
    const text = merged
      .map(([s, e]) => {
        // 省略号只在真被截断的边缘出现（#4：起点=0 也加前导……会误导 LLM 认为有前文）
        let seg = content.slice(s, e);
        if (s > 0) seg = `……${seg}`;
        if (e < content.length) seg = `${seg}……`;
        return seg;
      })
      .join('\n\n');
    return { text, mode: 'windows' };
  }

  private splitIntoChunks(text: string): ExtractItem[] {
    const CHUNK_SIZE = 8000;
    const chunks: ExtractItem[] = [];
    let start = 0;
    let index = 1;

    while (start < text.length) {
      let end = Math.min(start + CHUNK_SIZE, text.length);
      if (end < text.length) {
        const breakPoint = text.lastIndexOf('\n\n', end);
        if (breakPoint > start + CHUNK_SIZE / 2) end = breakPoint;
      }
      const content = text.slice(start, end).trim();
      if (content.length > 100) {
        chunks.push({ label: `第${index}部分`, text: content, offset: start });
        index++;
      }
      start = end;
    }

    return chunks;
  }

  private expandLongItems(items: ExtractItem[]): ExtractItem[] {
    const LONG_THRESHOLD = 2000;
    const result: ExtractItem[] = [];

    for (const item of items) {
      if (item.text.length <= LONG_THRESHOLD) {
        result.push(item);
        continue;
      }

      const lines = item.text.split('\n');
      const groups: Array<{ label: string; lines: string[]; start: number }> = [];
      let currentLines: string[] = [];
      let currentLabel = item.label;
      let cursor = 0; // 当前行在 item.text 中的起点（组偏移穿透用）
      let currentStart = 0;

      for (const line of lines) {
        const subMatch = line.match(
          /^[（(][一二三四五六七八九十]+[）)]|^\d+[.、]\s/,
        );
        if (subMatch && currentLines.length > 0) {
          groups.push({ label: currentLabel, lines: currentLines, start: currentStart });
          currentLines = [line];
          currentLabel = `${item.label} - ${line.trim().slice(0, 30)}`;
          currentStart = cursor;
        } else {
          currentLines.push(line);
        }
        cursor += line.length + 1; // +1 = split('\n') 的换行符
      }
      if (currentLines.length > 0) {
        groups.push({ label: currentLabel, lines: currentLines, start: currentStart });
      }

      if (groups.length <= 1) {
        result.push(item);
      } else {
        for (const g of groups) {
          const text = g.lines.join('\n').trim();
          if (text.length > 20) {
            // 组内 trim 可能吞前导空白——±1500 定位窗口容差内
            result.push({
              label: g.label,
              text,
              offset: item.offset == null ? null : item.offset + g.start,
            });
          }
        }
      }
    }

    return result;
  }

  private async saveRules(
    rules: any[],
    batch: Array<{ label: string }>,
    fileName: string,
    knowledgeBaseId: string,
    existingKeys: Set<string>,
  ): Promise<number> {
    const toCreate: Array<{
      knowledgeBaseId: string;
      source: string;
      name: string;
      ruleType: string;
      checkTarget: string;
      logicExpression: any;
      severity: string;
    }> = [];

    for (const rule of rules) {
      const normalized = this.normalizeRule(rule, batch);
      if (!normalized) continue;

      const key = this.dedupKey(normalized.ruleType, normalized.name);
      if (existingKeys.has(key)) continue;
      existingKeys.add(key);

      toCreate.push({
        knowledgeBaseId,
        source: `${normalized.source}（${fileName}）`,
        name: normalized.name,
        ruleType: normalized.ruleType,
        checkTarget: normalized.checkTarget,
        logicExpression: normalized.logicExpression,
        severity: normalized.severity,
      });
    }

    if (toCreate.length === 0) return 0;

    try {
      await this.prisma.complianceRule.createMany({ data: toCreate as any });
      return toCreate.length;
    } catch {
      // createMany fails on conflict — fallback to individual inserts
      let count = 0;
      for (const data of toCreate) {
        try {
          await this.prisma.complianceRule.create({ data: data as any });
          count++;
        } catch {
          // skip duplicate
        }
      }
      return count;
    }
  }

  private dedupKey(ruleType: string, name: string): string {
    const normalized = name
      .replace(/^(不得|不应|须|应当|应该|需要|要)\s*/, '')
      .replace(/\s+/g, '')
      .slice(0, 20);
    return `${ruleType}:${normalized}`;
  }

  private normalizeRule(
    rule: any,
    batch: Array<{ label: string }>,
  ): {
    source: string;
    name: string;
    ruleType: string;
    checkTarget: string;
    logicExpression: any;
    severity: string;
  } | null {
    const source = rule.source ?? rule.来源 ?? batch[0]?.label ?? '';
    const name = rule.name ?? rule.description ?? rule.名称 ?? rule.简述 ?? '';
    let ruleType = rule.ruleType ?? rule.rule_type ?? rule.type ?? '';
    // 枚举收口（2026-11-19 审查 #6/#13）：LLM 词汇漂移不入库——漂移值落库后
    // 编辑表单回显首项（如 severity 漂移值被强转 critical=升权重）、保存即静默改写
    const rawCheckTarget =
      rule.checkTarget ?? rule.check_target ?? rule.检查对象 ?? '全部';
    const checkTarget = (RULE_CHECK_TARGETS as readonly string[]).includes(
      rawCheckTarget,
    )
      ? rawCheckTarget
      : '全部';
    const rawSeverity = rule.severity ?? 'warning';
    const severity = (RULE_SEVERITIES as readonly string[]).includes(rawSeverity)
      ? rawSeverity
      : 'warning';
    const logicExpression =
      rule.logicExpression ??
      rule.logic_expression ??
      rule.condition ??
      rule.logic ??
      {};

    if (!name) return null;

    // Normalize ruleType
    if (ruleType.includes('numeric') || ruleType.includes('数值'))
      ruleType = 'numeric_compare';
    else if (ruleType.includes('existence') || ruleType.includes('存在'))
      ruleType = 'existence_check';
    else if (ruleType.includes('semantic') || ruleType.includes('语义'))
      ruleType = 'semantic';
    else ruleType = 'semantic'; // default fallback

    if (!['numeric_compare', 'existence_check', 'semantic'].includes(ruleType))
      return null;

    // numeric 单位同收口：漂移单位执行侧无法换算，落 'none' 保数值本体
    const logic = { ...(logicExpression as object) };
    if (
      ruleType === 'numeric_compare' &&
      typeof (logic as any).unit === 'string' &&
      !RULE_UNITS.some((u) => u.value === (logic as any).unit)
    ) {
      (logic as any).unit = 'none';
    }

    return { source, name, ruleType, checkTarget, logicExpression: logic, severity };
  }
}
