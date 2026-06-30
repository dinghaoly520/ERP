import { Injectable, Logger } from '@nestjs/common';
import { ExtractedFields } from './field-extractor.service';
import { ClauseParserService, Clause } from './clause-parser.service';
import { LlmService } from '../../local-ai/llm.service';
import type { StructuredSuggestion } from './text-operations';

export interface DocumentLocation {
  clauseNumber: string;
  sectionName: string;
  excerpt: string;
}

export interface KnowledgeBaseReference {
  fileName: string;
  clauseContent: string;
  score: number;
}

export interface RuleResult {
  ruleId: string;
  ruleName: string;
  ruleType: string;
  source: string;
  passed: boolean;
  severity: 'critical' | 'warning' | 'info';
  details: string;
  evidence?: string;
  suggestion?: string | StructuredSuggestion;
  documentExcerpt?: string;
  kbExcerpt?: string;
  status?: 'pending' | 'accepted' | 'rejected';
  documentLocation?: DocumentLocation;
  knowledgeBaseReferences?: KnowledgeBaseReference[];
  notApplicable?: boolean;
  dataMissing?: boolean;
}

interface Rule {
  id: string;
  name: string;
  source: string;
  ruleType: string;
  logicExpression: Record<string, any>;
  severity: string;
}

interface MissingDataRule {
  rule: Rule;
  fieldName?: string;
  checkType?: string;
  keywords?: string[];
  reason: string;
}

type Applicability = 'applicable' | 'not_applicable' | 'incomplete';

@Injectable()
export class RuleExecutorService {
  private readonly logger = new Logger(RuleExecutorService.name);

  constructor(
    private clauseParser: ClauseParserService,
    private llm: LlmService,
  ) {}

  async executeNumericRules(
    rules: Rule[],
    fields: ExtractedFields,
    documentContent: string,
  ): Promise<RuleResult[]> {
    const clauses = this.clauseParser.parse(documentContent).clauses;
    const results: RuleResult[] = [];
    const missingDataRules: MissingDataRule[] = [];
    const failedResults: Array<{ index: number; rule: Rule; reason: string }> =
      [];

    for (const rule of rules) {
      const result = this.tryExecuteNumericRule(
        rule,
        fields,
        clauses,
        documentContent,
      );
      if (result) {
        if (!result.passed) {
          failedResults.push({
            index: results.length,
            rule,
            reason: `${result.details}`,
          });
        }
        results.push(result);
      } else {
        const logic = rule.logicExpression;
        missingDataRules.push({
          rule,
          fieldName: logic.field as string,
          reason: `数值比较，需字段 "${logic.field}"`,
        });
      }
    }

    if (missingDataRules.length > 0) {
      const map = await this.batchCheckApplicability(
        missingDataRules,
        documentContent,
      );
      for (const entry of missingDataRules) {
        results.push(
          this.buildMissingDataResult(entry, map.get(entry.rule.id)),
        );
      }
    }

    if (failedResults.length > 0) {
      const applicabilityMap = await this.batchCheckFailedApplicability(
        failedResults.map((f) => ({ rule: f.rule, reason: f.reason })),
        documentContent,
      );
      for (const { index, rule } of failedResults) {
        const judgment = applicabilityMap.get(rule.id);
        if (judgment === 'not_applicable') {
          results[index] = {
            ...results[index],
            passed: true,
            severity: 'info',
            details: `本项不适用`,
            suggestion: '',
            notApplicable: true,
            evidence: undefined,
            documentLocation: undefined,
          };
        }
      }
    }

    return results;
  }

  async executeExistenceRules(
    rules: Rule[],
    documentContent: string,
    fields: ExtractedFields,
  ): Promise<RuleResult[]> {
    const clauses = this.clauseParser.parse(documentContent).clauses;
    const results: RuleResult[] = [];
    const missingDataRules: MissingDataRule[] = [];
    const failedResults: Array<{ index: number; rule: Rule; reason: string }> =
      [];

    for (const rule of rules) {
      const result = this.tryExecuteExistenceRule(
        rule,
        documentContent,
        fields,
        clauses,
      );
      if (result) {
        if (!result.passed) {
          failedResults.push({
            index: results.length,
            rule,
            reason: `${result.details}`,
          });
        }
        results.push(result);
      } else {
        const logic = rule.logicExpression;
        const checkType = logic.checkType as string;
        const keywords = (logic.keywords as string[]) ?? [];
        const sectionName = logic.sectionName as string | undefined;
        const field = logic.field as string | undefined;
        missingDataRules.push({
          rule,
          checkType,
          keywords: checkType === 'keyword' ? keywords : undefined,
          fieldName: checkType === 'field' ? field : undefined,
          reason:
            checkType === 'field'
              ? `存在性检查，需字段 "${field}"`
              : `存在性检查，未找到 "${keywords.join('、') || sectionName}"`,
        });
      }
    }

    if (missingDataRules.length > 0) {
      const map = await this.batchCheckApplicability(
        missingDataRules,
        documentContent,
      );
      for (const entry of missingDataRules) {
        results.push(
          this.buildMissingDataResult(entry, map.get(entry.rule.id)),
        );
      }
    }

    if (failedResults.length > 0) {
      const applicabilityMap = await this.batchCheckFailedApplicability(
        failedResults.map((f) => ({ rule: f.rule, reason: f.reason })),
        documentContent,
      );
      for (const { index, rule } of failedResults) {
        if (applicabilityMap.get(rule.id) === 'not_applicable') {
          results[index] = {
            ...results[index],
            passed: true,
            severity: 'info',
            details: `该条款不适用于本文档，已自动跳过（${results[index].details}）`,
            suggestion: '',
            notApplicable: true,
            evidence: undefined,
            documentLocation: undefined,
          };
        }
      }
    }

    return results;
  }

  // ── Individual rule execution (returns null when data is missing) ──

  private tryExecuteNumericRule(
    rule: Rule,
    fields: ExtractedFields,
    clauses: Clause[],
    documentContent: string,
  ): RuleResult | null {
    const logic = rule.logicExpression;
    const field = logic.field as string;
    const value = fields[field];
    if (value === undefined || value === null) return null;

    const operator = logic.operator as string;
    const threshold = logic.threshold as number;
    const numValue =
      typeof value === 'number' ? value : parseFloat(String(value));
    const numThreshold = threshold;

    let passed: boolean;
    let operatorText: string;
    switch (operator) {
      case '>=':
        passed = numValue >= numThreshold;
        operatorText = '≥';
        break;
      case '<=':
        passed = numValue <= numThreshold;
        operatorText = '≤';
        break;
      case '>':
        passed = numValue > numThreshold;
        operatorText = '>';
        break;
      case '<':
        passed = numValue < numThreshold;
        operatorText = '<';
        break;
      case '==':
        passed = numValue === numThreshold;
        operatorText = '=';
        break;
      case '!=':
        passed = numValue !== numThreshold;
        operatorText = '≠';
        break;
      default:
        passed = false;
        operatorText = operator;
    }

    const valueStr = String(numValue);
    const fieldIdx = documentContent.indexOf(field);
    const valueIdx =
      fieldIdx >= 0
        ? documentContent.indexOf(valueStr, Math.max(0, fieldIdx - 300))
        : documentContent.indexOf(valueStr);
    const documentLocation =
      valueIdx >= 0
        ? this.buildDocumentLocation(clauses, valueIdx, documentContent)
        : undefined;

    // Try to locate the value text in the original document for structured suggestion
    let originalTextSnippet = '';
    if (!passed && valueIdx >= 0) {
      const lineStart = documentContent.lastIndexOf('\n', valueIdx) + 1;
      const lineEnd = documentContent.indexOf('\n', valueIdx);
      originalTextSnippet = documentContent
        .slice(lineStart, lineEnd > 0 ? lineEnd : valueIdx + 100)
        .trim();
    }

    let suggestion: string | StructuredSuggestion;
    if (passed) {
      suggestion = '';
    } else if (originalTextSnippet) {
      const replacementText = originalTextSnippet.replace(
        valueStr,
        String(numThreshold),
      );
      suggestion = {
        description: `建议将${this.formatFieldName(field)}调整为 ${this.formatValue(numThreshold)}`,
        operation: 'replace',
        originalText: originalTextSnippet,
        replacementText,
      };
    } else {
      suggestion = {
        description: `建议将${this.formatFieldName(field)}调整为满足 ${operatorText} ${this.formatValue(numThreshold)} 的要求`,
        operation: 'manual',
      };
    }

    return {
      ruleId: rule.id,
      ruleName: rule.name,
      ruleType: rule.ruleType,
      source: rule.source,
      passed,
      severity: rule.severity as 'critical' | 'warning' | 'info',
      details: passed
        ? `符合要求`
        : `${this.formatFieldName(field)}为 ${this.formatValue(numValue)}，不符合 ${operatorText} ${this.formatValue(numThreshold)} 的要求`,
      evidence: `${field}=${numValue}, threshold=${numThreshold}`,
      suggestion,
      documentExcerpt: documentLocation?.excerpt || '',
      documentLocation,
    };
  }

  private tryExecuteExistenceRule(
    rule: Rule,
    documentContent: string,
    fields: ExtractedFields,
    clauses: Clause[],
  ): RuleResult | null {
    const logic = rule.logicExpression;
    const checkType = logic.checkType as string;
    const keywords = (logic.keywords as string[]) ?? [];
    const sectionName = logic.sectionName as string | undefined;

    let found = false;
    let evidence = '';
    let matchOffset = -1;

    if (checkType === 'field') {
      const fieldName = logic.field as string;
      const value = fields[fieldName];
      if (value !== true) return null; // field not found in extraction
      found = true;
      evidence = `字段 ${fieldName}=${value}`;
    } else if (checkType === 'keyword' || checkType === 'section') {
      const searchTerms =
        keywords.length > 0 ? keywords : sectionName ? [sectionName] : [];
      if (searchTerms.length === 0) return null;
      for (const term of searchTerms) {
        const idx = documentContent.indexOf(term);
        if (idx >= 0) {
          found = true;
          matchOffset = idx;
          const start = Math.max(0, idx - 50);
          const end = Math.min(documentContent.length, idx + term.length + 50);
          evidence = `...${documentContent.slice(start, end)}...`;
          break;
        }
      }
      if (!found) return null; // keyword not found in document
    } else {
      return null;
    }

    const documentLocation =
      matchOffset >= 0
        ? this.buildDocumentLocation(clauses, matchOffset, documentContent)
        : undefined;

    return {
      ruleId: rule.id,
      ruleName: rule.name,
      ruleType: rule.ruleType,
      source: rule.source,
      passed: true,
      severity: rule.severity as 'critical' | 'warning' | 'info',
      details: `符合要求`,
      evidence: evidence || undefined,
      suggestion: '',
      documentExcerpt: documentLocation?.excerpt || '',
      documentLocation,
    };
  }

  // ── Document location helpers ──

  private findClauseAtOffset(clauses: Clause[], offset: number): Clause | null {
    for (const clause of clauses) {
      if (offset >= clause.startOffset && offset < clause.endOffset)
        return clause;
    }
    return null;
  }

  private buildDocumentLocation(
    clauses: Clause[],
    offset: number,
    documentContent: string,
  ): DocumentLocation {
    const clause = this.findClauseAtOffset(clauses, offset);
    const start = Math.max(0, offset - 100);
    const end = Math.min(documentContent.length, offset + 100);
    return {
      clauseNumber: clause?.clauseNumber ?? '',
      sectionName:
        [clause?.parentSection, clause?.title].filter(Boolean).join(' > ') ||
        '',
      excerpt: documentContent.slice(start, end).trim(),
    };
  }

  // ── LLM-based applicability check for missing-data rules ──

  private async batchCheckApplicability(
    entries: MissingDataRule[],
    documentContent: string,
  ): Promise<Map<string, Applicability>> {
    const snippet = documentContent.slice(0, 6000);

    const rulesList = entries
      .map((e, i) => `${i + 1}. [${e.rule.name}] ${e.reason}`)
      .join('\n');

    const prompt = `你正在审查一份招标文件。以下规则条款因无法从文档中提取到对应数据而无法自动判定。请判断每条规则条款是否实际适用于该招标文件。

规则列表：
${rulesList}

判断标准：
- "applicable": 该条款确实适用于此招标文件，文档应当包含但未包含相关数据 → 属于违规
- "not_applicable": 该条款与此招标文件无关，不应强制要求 → 跳过
- "incomplete": 条款适用，但文档中该部分数据填写不完整或模糊 → 标记为信息缺失

请以 JSON 数组格式输出，每个元素包含 index（数字）和 judgment（"applicable"/"not_applicable"/"incomplete"）。`;

    try {
      const raw = await this.llm.chatJson<any>(
        '你是一名专业的招标文件审查专家，负责判断审查规则是否适用于给定的招标文件。',
        `${prompt}\n\n招标文件内容（截取）：\n${snippet}`,
      );

      const result: Array<{ index: number; judgment: string }> = Array.isArray(
        raw,
      )
        ? raw
        : (raw.results ?? raw.data ?? []);

      const map = new Map<string, Applicability>();
      for (const item of result) {
        const entry = entries[item.index - 1];
        if (
          entry &&
          ['applicable', 'not_applicable', 'incomplete'].includes(item.judgment)
        ) {
          map.set(entry.rule.id, item.judgment as Applicability);
        }
      }
      // Default for any missing: applicable
      for (const entry of entries) {
        if (!map.has(entry.rule.id)) {
          map.set(entry.rule.id, 'applicable');
        }
      }
      return map;
    } catch {
      // If LLM fails, treat all as applicable (conservative fallback)
      const map = new Map<string, Applicability>();
      for (const entry of entries) {
        map.set(entry.rule.id, 'applicable');
      }
      return map;
    }
  }

  private async batchCheckFailedApplicability(
    entries: Array<{ rule: Rule; reason: string }>,
    documentContent: string,
  ): Promise<Map<string, Applicability>> {
    const snippet = documentContent.slice(0, 6000);

    const rulesList = entries
      .map((e, i) => `${i + 1}. [${e.rule.name}] ${e.reason}`)
      .join('\n');

    const prompt = `你正在审查一份招标文件。以下规则条款虽然检测到了数据但未通过合规检查。请判断每条规则条款是否实际适用于该招标文件的采购类型和场景。

规则列表：
${rulesList}

判断标准：
- "applicable": 该条款确实适用于此招标文件，未通过检查属于真实违规
- "not_applicable": 该条款与此招标文件的采购类型/场景无关，不应强制要求 → 跳过
例如：如果规则是"询比采购金额上限"但文件属于公开招标，则应判定为 not_applicable

请以 JSON 数组格式输出，每个元素包含 index（数字）和 judgment（"applicable" 或 "not_applicable"）。`;

    try {
      const raw = await this.llm.chatJson<any>(
        '你是一名专业的招标文件审查专家，负责判断审查规则是否适用于给定的招标文件。',
        `${prompt}\n\n招标文件内容（截取）：\n${snippet}`,
      );

      const result: Array<{ index: number; judgment: string }> = Array.isArray(
        raw,
      )
        ? raw
        : (raw.results ?? raw.data ?? []);

      const map = new Map<string, Applicability>();
      for (const item of result) {
        const entry = entries[item.index - 1];
        if (entry && ['applicable', 'not_applicable'].includes(item.judgment)) {
          map.set(entry.rule.id, item.judgment as Applicability);
        }
      }
      for (const entry of entries) {
        if (!map.has(entry.rule.id)) {
          map.set(entry.rule.id, 'applicable');
        }
      }
      return map;
    } catch {
      const map = new Map<string, Applicability>();
      for (const entry of entries) {
        map.set(entry.rule.id, 'applicable');
      }
      return map;
    }
  }

  private buildMissingDataResult(
    entry: MissingDataRule,
    applicability?: Applicability,
  ): RuleResult {
    const { rule } = entry;

    if (applicability === 'not_applicable') {
      return {
        ruleId: rule.id,
        ruleName: rule.name,
        ruleType: rule.ruleType,
        source: rule.source,
        passed: true,
        severity: 'info',
        details: `本项不适用`,
        suggestion: '',
        notApplicable: true,
      };
    }

    if (applicability === 'incomplete') {
      return {
        ruleId: rule.id,
        ruleName: rule.name,
        ruleType: rule.ruleType,
        source: rule.source,
        passed: false,
        severity: 'warning',
        details: `数据填写不完整`,
        suggestion: {
          description: `请补充完善文档中 "${this.formatFieldName(entry.fieldName || rule.name)}" 相关信息`,
          operation: 'manual',
        },
        dataMissing: true,
      };
    }

    // applicable — real violation
    return {
      ruleId: rule.id,
      ruleName: rule.name,
      ruleType: rule.ruleType,
      source: rule.source,
      passed: false,
      severity: rule.severity as 'critical' | 'warning' | 'info',
      details: `缺少必要数据`,
      suggestion: {
        description: `请确保文档中包含规则 "${rule.name}" 所要求的完整数据`,
        operation: 'manual',
      },
      dataMissing: true,
    };
  }

  // ── Formatting helpers ──

  private formatFieldName(field: string): string {
    const fieldNames: Record<string, string> = {
      budgetAmount: '预算金额',
      awardAmount: '成交金额',
      projectAmount: '项目金额',
      procurementAmount: '采购金额',
      contractAmount: '合同金额',
      estimatedAmount: '估算金额',
      tenderDeadline: '投标截止时间',
      bidOpenTime: '开标时间',
      validDays: '有效期',
      guaranteeAmount: '保证金金额',
      guaranteeRate: '保证金比例',
      advancePayment: '预付款比例',
      qualityPeriod: '质保期',
      deliveryPeriod: '交货期',
      servicePeriod: '服务期',
    };
    return fieldNames[field] || field;
  }

  private formatValue(value: number): string {
    // Format large numbers as 万元 or 元
    if (value >= 10000) {
      return `${(value / 10000).toFixed(2)} 万元`;
    }
    if (value >= 1000) {
      return `${(value / 10000).toFixed(2)} 万元`;
    }
    return `${value} 元`;
  }
}
