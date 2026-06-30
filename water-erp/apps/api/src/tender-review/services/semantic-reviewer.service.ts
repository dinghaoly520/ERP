import { Injectable, Logger } from '@nestjs/common';
import { LlmService } from '../../local-ai/llm.service';
import {
  VectorSearchService,
  ChunkSearchResult,
} from '../../knowledge/services/vector-search.service';
import { ClauseParserService } from './clause-parser.service';
import { RuleResult, KnowledgeBaseReference } from './rule-executor.service';
import {
  buildKnowledgeBaseReferences,
  findDocumentLocation,
} from './review-utils';

interface SemanticRule {
  id: string;
  name: string;
  source: string;
  logicExpression: Record<string, any>;
  severity: string;
}

interface LlmJudgment {
  index: number;
  compliant: boolean;
  reasoning: string;
  evidence: string;
  suggestion: {
    description: string;
    operation: 'replace' | 'insert' | 'delete' | 'manual';
    originalText?: string;
    replacementText?: string;
    anchor?: string;
  };
  documentExcerpt: string;
  kbExcerpt: string;
}

const BATCH_SIZE = 6;

const BATCH_REVIEW_SYSTEM_PROMPT = `你是一个采购合规审查专家。你的任务是批量判断招标文件中的内容是否符合给定的多条采购管理制度条款要求。

你将收到多条规则及其相关的知识库上下文，请对每条规则逐一判断。

输出格式（JSON）：
{
  "results": [
    {
      "index": 规则序号（从0开始）,
      "compliant": true 或 false,
      "reasoning": "判断理由的简要说明",
      "evidence": "支持判断的具体文件内容引用，格式：条款号 + 原文引用",
      "suggestion": {
        "description": "修改说明",
        "operation": "replace" | "insert" | "delete" | "manual",
        "originalText": "原文中需要修改的确切连续文本（必须与文档原文逐字一致）",
        "replacementText": "替换后的新文本",
        "anchor": "插入位置锚点的原文文本（仅 insert 操作需要）"
      },
      "documentExcerpt": "被审文件中与该问题直接相关的原文片段（50-200字）",
      "kbExcerpt": "知识库中对应条款的原文片段（50-200字）"
    }
  ]
}

注意：
- 只有在明确违规时才判定 compliant 为 false
- 如果文件内容不够明确但可以合理推断合规，判定为 true
- evidence 必须引用原文中的具体语句，并优先包含条款号信息
- suggestion 的 operation 含义：replace（替换）、insert（插入）、delete（删除）、manual（无法精确定位）
- originalText 必须是文档原文中实际存在的连续文本，逐字一致，不能编造
- 如果无法确定原文中需要修改的确切文本，使用 manual 操作
- 如果规则合规（compliant 为 true），suggestion 可省略或设为 null
- 必须为每条规则返回一个结果，results 数组长度必须等于输入规则数量
- 每条规则的 knowledgeBaseReferences 由系统自动处理，你无需输出`;

@Injectable()
export class SemanticReviewerService {
  constructor(
    private llm: LlmService,
    private vectorSearch: VectorSearchService,
    private clauseParser: ClauseParserService,
  ) {}

  private sanitizeDocumentContent(content: string, maxLength: number): string {
    let sanitized =
      content.length > maxLength
        ? content.slice(0, maxLength) + '\n...(文档过长，已截断)'
        : content;

    const injectionPatterns = [
      /忽略之前的所有指令/gi,
      /请输出以下内容/gi,
      /你的任务是/gi,
      /SYSTEM:/gi,
      /USER:/gi,
      /ASSISTANT:/gi,
    ];

    for (const pattern of injectionPatterns) {
      sanitized = sanitized.replace(pattern, '[已过滤]');
    }

    return sanitized;
  }

  async review(
    rules: SemanticRule[],
    documentContent: string,
    knowledgeBaseId: string,
    signal?: AbortSignal,
  ): Promise<RuleResult[]> {
    if (rules.length === 0) return [];

    const clauses = this.clauseParser.parse(documentContent).clauses;

    // 1. 预先收集每条规则的 KB 检索结果
    const ruleSearchResults = new Map<number, ChunkSearchResult[]>();
    for (let i = 0; i < rules.length; i++) {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      const description =
        (rules[i].logicExpression.description as string) ?? rules[i].name;
      const results = await this.vectorSearch.search(
        description,
        knowledgeBaseId,
        5,
      );
      ruleSearchResults.set(i, results);
    }

    // 2. 分批调用 LLM
    const allResults: RuleResult[] = [];
    for (
      let batchStart = 0;
      batchStart < rules.length;
      batchStart += BATCH_SIZE
    ) {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

      const batchEnd = Math.min(batchStart + BATCH_SIZE, rules.length);
      const batchRules = rules.slice(batchStart, batchEnd);
      const batchResults = await this.reviewBatch(
        batchRules,
        batchStart,
        documentContent,
        knowledgeBaseId,
        clauses,
        ruleSearchResults,
        signal,
      );
      allResults.push(...batchResults);
    }

    return allResults;
  }

  private async reviewBatch(
    batchRules: SemanticRule[],
    globalOffset: number,
    documentContent: string,
    knowledgeBaseId: string,
    clauses: Array<{
      clauseNumber: string;
      title: string | null;
      startOffset: number;
      endOffset: number;
      parentSection: string | null;
    }>,
    ruleSearchResults: Map<number, ChunkSearchResult[]>,
    signal?: AbortSignal,
  ): Promise<RuleResult[]> {
    const docExcerpt = this.sanitizeDocumentContent(documentContent, 6000);

    const rulesSection = batchRules
      .map((rule, i) => {
        const description =
          (rule.logicExpression.description as string) ?? rule.name;
        const searchResults = ruleSearchResults.get(globalOffset + i) ?? [];
        const kbPassages = searchResults.map((r) => r.content).join('\n\n');
        return (
          `--- 规则 ${i} ---\n` +
          `【制度条款】${rule.source}: ${rule.name}\n` +
          `【检查要求】${description}\n` +
          `【知识库相关段落】\n${kbPassages || '无相关检索结果'}`
        );
      })
      .join('\n\n');

    const userPrompt =
      `共 ${batchRules.length} 条规则需要审查：\n\n${rulesSection}\n\n` +
      `【待审文件内容】\n${docExcerpt}`;

    try {
      const llmResult = await this.llm.chatJson<{ results: LlmJudgment[] }>(
        BATCH_REVIEW_SYSTEM_PROMPT,
        userPrompt,
        0,
        signal,
      );

      const judgments = Array.isArray(llmResult.results)
        ? llmResult.results
        : [];

      return batchRules.map((rule, i) => {
        const judgment = judgments.find((j) => j.index === i);
        const searchResults = ruleSearchResults.get(globalOffset + i) ?? [];
        const knowledgeBaseReferences =
          buildKnowledgeBaseReferences(searchResults);
        const documentLocation = judgment?.evidence
          ? findDocumentLocation(judgment.evidence, documentContent, clauses)
          : undefined;

        if (!judgment) {
          return {
            ruleId: rule.id,
            ruleName: rule.name,
            ruleType: 'semantic',
            source: rule.source,
            passed: false,
            severity: rule.severity as 'critical' | 'warning' | 'info',
            details: '批量审查未返回该规则结果',
            suggestion: '',
            documentExcerpt: '',
            kbExcerpt: '',
            documentLocation,
            knowledgeBaseReferences,
          };
        }

        return {
          ruleId: rule.id,
          ruleName: rule.name,
          ruleType: 'semantic',
          source: rule.source,
          passed: judgment.compliant,
          severity: rule.severity as 'critical' | 'warning' | 'info',
          details: judgment.reasoning,
          evidence: judgment.evidence,
          suggestion: judgment.suggestion || '',
          documentExcerpt: judgment.documentExcerpt || '',
          kbExcerpt: judgment.kbExcerpt || '',
          documentLocation,
          knowledgeBaseReferences,
        };
      });
    } catch (e) {
      if (signal?.aborted) throw e;
      // 批量失败时 fallback 到逐条调用
      new Logger(SemanticReviewerService.name).warn(
        `Batch review failed (${batchRules.length} rules), falling back to individual: ${String(e).slice(0, 200)}`,
      );
      const results: RuleResult[] = [];
      for (let i = 0; i < batchRules.length; i++) {
        if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
        results.push(
          await this.reviewSingleRule(
            batchRules[i],
            globalOffset + i,
            documentContent,
            clauses,
            ruleSearchResults,
            signal,
          ),
        );
      }
      return results;
    }
  }

  private async reviewSingleRule(
    rule: SemanticRule,
    globalIndex: number,
    documentContent: string,
    clauses: Array<{
      clauseNumber: string;
      title: string | null;
      startOffset: number;
      endOffset: number;
      parentSection: string | null;
    }>,
    ruleSearchResults: Map<number, ChunkSearchResult[]>,
    signal?: AbortSignal,
  ): Promise<RuleResult> {
    const description =
      (rule.logicExpression.description as string) ?? rule.name;
    const searchResults = ruleSearchResults.get(globalIndex) ?? [];
    const relevantPassages = searchResults.map((r) => r.content).join('\n\n');
    const docExcerpt = this.sanitizeDocumentContent(documentContent, 3000);

    const SINGLE_REVIEW_PROMPT = `你是一个采购合规审查专家。判断招标文件内容是否符合给定的采购管理制度条款要求。

输出格式（JSON）：
{
  "compliant": true 或 false,
  "reasoning": "判断理由",
  "evidence": "具体文件内容引用",
  "suggestion": {
    "description": "修改说明",
    "operation": "replace" | "insert" | "delete" | "manual",
    "originalText": "原文中需要修改的确切文本",
    "replacementText": "替换文本"
  },
  "documentExcerpt": "相关原文片段",
  "kbExcerpt": "知识库条款片段"
}

注意：只有明确违规才判 false。originalText 必须与原文逐字一致。`;

    try {
      const judgment = await this.llm.chatJson<{
        compliant: boolean;
        reasoning: string;
        evidence: string;
        suggestion: any;
        documentExcerpt: string;
        kbExcerpt: string;
      }>(
        SINGLE_REVIEW_PROMPT,
        `【制度条款】${rule.source}: ${rule.name}\n` +
          `【检查要求】${description}\n\n` +
          `【知识库相关段落】\n${relevantPassages || '无相关检索结果'}\n\n` +
          `【待审文件内容】\n${docExcerpt}`,
        0,
        signal,
      );

      const knowledgeBaseReferences =
        buildKnowledgeBaseReferences(searchResults);
      const documentLocation = judgment.evidence
        ? findDocumentLocation(judgment.evidence, documentContent, clauses)
        : undefined;

      return {
        ruleId: rule.id,
        ruleName: rule.name,
        ruleType: 'semantic',
        source: rule.source,
        passed: judgment.compliant,
        severity: rule.severity as 'critical' | 'warning' | 'info',
        details: judgment.reasoning,
        evidence: judgment.evidence,
        suggestion: judgment.suggestion || '',
        documentExcerpt: judgment.documentExcerpt || '',
        kbExcerpt: judgment.kbExcerpt || '',
        documentLocation,
        knowledgeBaseReferences,
      };
    } catch (e) {
      const knowledgeBaseReferences =
        buildKnowledgeBaseReferences(searchResults);
      return {
        ruleId: rule.id,
        ruleName: rule.name,
        ruleType: 'semantic',
        source: rule.source,
        passed: false,
        severity: rule.severity as 'critical' | 'warning' | 'info',
        details: '语义审查 LLM 调用失败，无法判定',
        suggestion: '',
        documentExcerpt: '',
        kbExcerpt: '',
        knowledgeBaseReferences,
      };
    }
  }
}
