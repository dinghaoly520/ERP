import { Injectable, Logger } from '@nestjs/common';
import { LlmService } from '../../local-ai/llm.service';
import { ClauseParserService } from './clause-parser.service';
import { findDocumentLocation, sanitizeDocumentContent, splitByChapters } from './review-utils';
import type { GeneralReviewIssue } from './general-reviewer.service';

export interface LlmFreeReviewIssue extends GeneralReviewIssue {
  source: 'llm-free';
}

export interface LlmFreeReviewSection {
  sectionName: string;
  issues: LlmFreeReviewIssue[];
}

export interface LlmFreeReviewResult {
  results: LlmFreeReviewSection[];
  totalSections: number;
}

const LLM_FREE_REVIEW_PROMPT = `你是一个资深的采购招标文件审查专家。你将收到一份招标文件的某个章节内容，请凭借你的专业知识，独立判断该章节中是否存在以下类型的通用性问题：

1. **条款与采购类型不匹配**：文件中的某些条款是针对其他采购类型（如 IT 采购、服务采购）设计的，与当前招标项目的实际类型不符。例如：钻探工程招标文件中出现"开发接口""开发手册""软件源码"等 IT 相关条款。
2. **不适用条款**：文件中包含明显不适用的通用模板内容，应当删除或替换为适合当前采购类型的专业条款。
3. **行业常识性错误**：根据行业经验和常识可以判断的不合理内容，如不合理的违约金比例、不合理的质保要求等。
4. **关键信息缺失**：该类采购项目应当包含但文件中遗漏的重要条款。
5. **条款矛盾或逻辑冲突**：同一文件中不同条款之间存在矛盾或不一致。

输出格式（JSON）：
{
  "issues": [
    {
      "severity": "critical" | "warning" | "info",
      "description": "问题描述（一句话，只说问题本身，不要包含修改方案）",
      "relatedClause": "涉及的条款编号或章节名称",
      "evidence": "支持判断的具体文件内容引用，格式：条款号 + 原文",
      "suggestion": {
        "description": "修改说明：简要说明需要修改什么以及为什么",
        "operation": "replace" | "insert" | "delete" | "manual",
        "originalText": "原文中需要修改的确切连续文本（必须与文档原文逐字一致）",
        "replacementText": "替换后的新文本",
        "anchor": "插入位置锚点的原文文本（仅 insert 操作）"
      },
      "documentExcerpt": "被审文件中与该问题直接相关的原文片段（50-200字）"
    }
  ]
}

如果没有发现问题，返回空数组 {"issues": []}。

【拆分规则】如果一个条款或段落存在多个独立问题，必须拆分为多条 issue，每条 issue 的 originalText 只覆盖该问题对应的那一句话或短语。

注意：
- 只报告明确的问题，不要猜测或过度解读
- severity: critical 表示严重问题（必须修改），warning 表示建议修改，info 表示提示性信息
- evidence 必须引用文档中的具体原文，并优先包含条款号信息
- suggestion 的 operation 含义：
  - replace: 找到原文中的确切文本并替换为新文本
  - delete: 删除原文中的某段文本
  - insert: 在原文某个位置后插入新文本
  - manual: 无法精确定位修改内容，仅给出语义描述
- originalText 必须是文档原文中实际存在的连续文本，逐字一致，不能编造
- 如果无法确定原文中需要修改的确切文本，使用 manual 操作
- documentExcerpt 应提取与问题最相关的原文段落`;

@Injectable()
export class LlmFreeReviewerService {
  constructor(
    private llm: LlmService,
    private clauseParser: ClauseParserService,
  ) {}

  async review(
    documentContent: string,
    signal?: AbortSignal,
  ): Promise<LlmFreeReviewResult> {
    const sections = splitByChapters(documentContent, this.clauseParser);
    const issueResults: LlmFreeReviewSection[] = [];
    const clauses = this.clauseParser.parse(documentContent).clauses;

    for (const section of sections) {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

      const sanitizedSectionContent = sanitizeDocumentContent(
        section.content,
        12000,
      );

      try {
        const llmResult = await this.llm.chatJson<{
          issues: GeneralReviewIssue[];
        }>(
          LLM_FREE_REVIEW_PROMPT,
          `【待审文件章节】${section.name}\n${sanitizedSectionContent}`,
          0,
          signal,
        );

        const issues: LlmFreeReviewIssue[] = (
          Array.isArray(llmResult.issues) ? llmResult.issues : []
        ).map((issue) => ({
          ...issue,
          source: 'llm-free' as const,
          documentLocation: issue.evidence
            ? findDocumentLocation(issue.evidence, documentContent, clauses)
            : undefined,
          // No knowledge base references — this is LLM-only review
          kbExcerpt: undefined,
          knowledgeBaseReferences: undefined,
        }));

        issueResults.push({
          sectionName: section.name,
          issues,
        });
      } catch (e) {
        if (signal?.aborted) throw e;
        new Logger(LlmFreeReviewerService.name).warn(
          `LLM-free review failed for "${section.name}": ${String(e).slice(0, 200)}`,
        );
        // Non-critical: skip failed sections silently
      }
    }

    return { results: issueResults, totalSections: issueResults.length };
  }
}
