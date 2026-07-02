import { Injectable, Logger } from '@nestjs/common';
import { LlmService } from '../../local-ai/llm.service';
import {
  VectorSearchService,
  ChunkSearchResult,
} from '../../knowledge/services/vector-search.service';
import { ClauseParserService } from './clause-parser.service';
import {
  buildKnowledgeBaseReferences,
  findDocumentLocation,
  sanitizeDocumentContent,
  splitByChapters,
} from './review-utils';

export interface GeneralReviewIssue {
  severity: 'critical' | 'warning' | 'info';
  description: string;
  relatedClause: string;
  evidence: string;
  suggestion: string;
  documentExcerpt?: string;
  kbExcerpt?: string;
  status?: 'pending' | 'accepted' | 'rejected';
  editedSuggestion?: string;
  resolvedAt?: string;
  documentLocation?: {
    clauseNumber: string;
    sectionName: string;
    excerpt: string;
  };
  knowledgeBaseReferences?: Array<{
    fileName: string;
    clauseContent: string;
    score: number;
  }>;
}

export interface GeneralReviewResult {
  sectionName: string;
  issues: GeneralReviewIssue[];
}

export interface GeneralReviewOutput {
  results: GeneralReviewResult[];
  totalSections: number;
}

const GENERAL_REVIEW_PROMPT = `你是一个采购合规审查专家。你的任务是审查招标文件的一个章节是否符合采购管理制度的要求。

将提供以下信息：
1. 待审文件的章节内容
2. 从知识库中检索到的相关制度条款

请逐条检查该章节中的所有内容，判断是否存在合规问题。

【核心原则】每个问题必须精确锚定到原文中的一小段连续文本。禁止对整段、整节或长篇幅内容提出笼统修改意见。

输出格式（JSON）：
{
  "issues": [
    {
      "severity": "critical" | "warning" | "info",
      "description": "问题描述（一句话，只说问题本身，不要包含修改方案）",
      "relatedClause": "相关的制度条款编号或引用",
      "evidence": "支持判断的具体文件内容引用，格式：条款号 + 原文，如 '第三十五条 投标保证金为合同金额的5%'",
      "suggestion": {
        "description": "修改说明：简要说明需要修改什么以及为什么",
        "operation": "replace" | "insert" | "delete" | "manual",
        "originalText": "原文中需要修改的确切连续文本（必须与文档原文逐字一致）",
        "replacementText": "替换后的新文本",
        "anchor": "插入位置锚点的原文文本（仅 insert 操作）"
      },
      "documentExcerpt": "被审文件中与该问题直接相关的原文片段（50-200字）",
      "kbExcerpt": "知识库中对应条款的原文片段（50-200字）"
    }
  ]
}

如果没有发现问题，返回空数组 {"issues": []}。

【拆分规则】如果一个条款或段落存在多个独立问题，必须拆分为多条 issue，每条 issue 的 originalText 只覆盖该问题对应的那一句话或短语。绝对不允许把整段原文放进 originalText 然后在 suggestion.description 里列举多项修改。

错误示例（禁止）：
- originalText 为整段几十字的条款，description 写"1.修正日期…2.删除…3.降低…4.修改…"
- 对"安全生产协议"整节提出一条笼统的修改建议

正确示例：
- issue 1: originalText="9月31日", operation="replace", replacementText="9月30日"
- issue 2: originalText="解释权归甲方所有", operation="delete"
- issue 3: originalText="每日按合同总额的千分之五支付违约金", operation="replace", replacementText="每日按合同总额的万分之五支付违约金，累计不超过合同总额的10%"

注意：
- 只报告明确的问题，不要猜测
- severity: critical 表示严重违规，warning 表示可能的问题，info 表示提示
- 对于每个问题，evidence 必须引用文档中的具体原文，并优先包含条款号信息
- suggestion 的 operation 含义：
  - replace: 找到原文中的确切文本并替换为新文本（需要 originalText 和 replacementText）
  - delete: 删除原文中的某段文本（需要 originalText）
  - insert: 在原文某个位置后插入新文本（需要 anchor 和 replacementText）
  - manual: 无法精确定位修改内容，仅给出语义描述
- originalText 必须是文档原文中实际存在的连续文本，逐字一致，不能编造
- 如果无法确定原文中需要修改的确切文本，使用 manual 操作
- documentExcerpt 和 kbExcerpt 应提取与问题最相关的原文段落`;

@Injectable()
export class GeneralReviewerService {
  constructor(
    private llm: LlmService,
    private vectorSearch: VectorSearchService,
    private clauseParser: ClauseParserService,
  ) {}

  async review(
    documentContent: string,
    knowledgeBaseId: string,
    signal?: AbortSignal,
  ): Promise<GeneralReviewOutput> {
    const sections = splitByChapters(documentContent, this.clauseParser);
    const issueResults: GeneralReviewResult[] = [];
    const seenContentHashes = new Set<string>();
    const clauses = this.clauseParser.parse(documentContent).clauses;

    for (const section of sections) {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

      const searchQuery = this.sampleSectionText(section.content);
      const searchResults = await this.vectorSearch.search(
        searchQuery,
        knowledgeBaseId,
        25,
      );

      const uniqueClauses: string[] = [];
      for (const result of searchResults) {
        const hash = result.content.slice(0, 100);
        if (!seenContentHashes.has(hash)) {
          seenContentHashes.add(hash);
          uniqueClauses.push(result.content);
        }
      }

      const relevantClauses = uniqueClauses.slice(0, 10).join('\n\n');
      const sanitizedSectionContent = sanitizeDocumentContent(
        section.content,
        12000,
      );

      try {
        const llmResult = await this.llm.chatJson<{
          issues: GeneralReviewIssue[];
        }>(
          GENERAL_REVIEW_PROMPT,
          `【待审文件章节】${section.name}\n${sanitizedSectionContent}\n\n` +
            `【相关制度条款】\n${relevantClauses || '无相关检索结果'}`,
          0,
          signal,
        );

        const issues = Array.isArray(llmResult.issues) ? llmResult.issues : [];
        const enrichedIssues = issues.map((issue) =>
          this.enrichIssue(issue, documentContent, clauses, searchResults),
        );
        issueResults.push({
          sectionName: section.name,
          issues: enrichedIssues,
        });
      } catch (e) {
        if (signal?.aborted) throw e;
        new Logger(GeneralReviewerService.name).warn(
          `Review failed for "${section.name}": ${String(e).slice(0, 200)}`,
        );
        issueResults.push({
          sectionName: section.name,
          issues: [
            {
              severity: 'info' as const,
              description: `审查失败：${String(e).slice(0, 100)}`,
              evidence: '',
              suggestion: '请重新提交审查',
              relatedClause: '',
            },
          ],
        });
      }
    }

    return { results: issueResults, totalSections: issueResults.length };
  }

  private enrichIssue(
    issue: GeneralReviewIssue,
    documentContent: string,
    clauses: Array<{ clauseNumber: string; title: string | null; startOffset: number; endOffset: number; parentSection: string | null }>,
    searchResults: ChunkSearchResult[],
  ): GeneralReviewIssue {
    const knowledgeBaseReferences = buildKnowledgeBaseReferences(searchResults);
    const documentLocation = issue.evidence
      ? findDocumentLocation(issue.evidence, documentContent, clauses)
      : undefined;

    return {
      ...issue,
      documentLocation,
      knowledgeBaseReferences,
    };
  }

  private sampleSectionText(content: string): string {
    const SAMPLE_SIZE = 800;
    const len = content.length;

    if (len <= 2400) return content;

    const head = content.slice(0, SAMPLE_SIZE);
    const mid = content.slice(
      Math.floor(len / 2) - SAMPLE_SIZE / 2,
      Math.floor(len / 2) + SAMPLE_SIZE / 2,
    );
    const tail = content.slice(len - SAMPLE_SIZE);

    return `${head}\n\n${mid}\n\n${tail}`;
  }
}
