import { Injectable, Logger } from '@nestjs/common';
import { LlmService } from '../../local-ai/llm.service';

export interface ExtractedFields {
  budgetAmount?: number;
  announcementDate?: string;
  deadlineDate?: string;
  publicityDays?: number;
  procurementMethod?: string;
  hasRenewalJustification?: boolean;
  hasPublicAnnouncement?: boolean;
  hasTechnicalRequirements?: boolean;
  hasEvaluationCriteria?: boolean;
  documentType?: string;
  [key: string]: unknown;
}

const FIELD_EXTRACTION_PROMPT = `你是一个采购文件字段提取专家。从提供的采购招标文件文本中提取以下结构化字段，以 JSON 格式输出：

{
  "budgetAmount": 金额数值（单位：元，如50万填500000），
  "announcementDate": "公告发布日期，格式 YYYY-MM-DD",
  "deadlineDate": "投标截止日期，格式 YYYY-MM-DD",
  "publicityDays": 公示期天数（整数），
  "procurementMethod": "采购方式，如公开招标、邀请招标、竞争性谈判、询价、单一来源",
  "hasRenewalJustification": 是否包含续约必要性说明（boolean），
  "hasPublicAnnouncement": 是否发布了公示（boolean），
  "hasTechnicalRequirements": 是否包含完整技术要求（boolean），
  "hasEvaluationCriteria": 是否包含评分标准（boolean），
  "documentType": "文件类型，如采购公告、招标文件、投标文件、合同、评标报告"
}

如果某个字段无法从文档中确定，则不包含该字段。不要编造信息。`;

@Injectable()
export class FieldExtractorService {
  constructor(private llm: LlmService) {}

  async extract(
    documentContent: string,
    signal?: AbortSignal,
  ): Promise<ExtractedFields> {
    const chunks = this.splitDocument(documentContent);
    const merged: ExtractedFields = {};

    for (const chunk of chunks) {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      try {
        const fields = await this.llm.chatJson<ExtractedFields>(
          FIELD_EXTRACTION_PROMPT,
          `以下是待审文件内容（第${chunk.index}/${chunks.length}部分）：\n\n${chunk.content}`,
          0,
          signal,
        );
        this.mergeFields(merged, fields);
      } catch (e) {
        new Logger(FieldExtractorService.name).warn(
          `Field extraction failed for chunk ${chunk.index}/${chunks.length}: ${String(e).slice(0, 200)}`,
        );
      }
    }

    return merged;
  }

  private splitDocument(
    text: string,
  ): Array<{ index: number; content: string }> {
    const CHUNK_SIZE = 15000;
    if (text.length <= CHUNK_SIZE) {
      return [{ index: 1, content: text }];
    }

    const chunks: Array<{ index: number; content: string }> = [];
    let start = 0;
    let index = 1;

    while (start < text.length) {
      let end = Math.min(start + CHUNK_SIZE, text.length);
      if (end < text.length) {
        const breakPoint = text.lastIndexOf('\n\n', end);
        if (breakPoint > start + CHUNK_SIZE / 2) end = breakPoint;
      }
      chunks.push({ index, content: text.slice(start, end) });
      start = end;
      index++;
    }

    return chunks;
  }

  private mergeFields(target: ExtractedFields, source: ExtractedFields): void {
    for (const [key, value] of Object.entries(source)) {
      if (value === undefined || value === null) continue;
      const existing = target[key];
      // Prefer non-undefined values; for booleans, prefer true
      if (existing === undefined) {
        target[key] = value;
      } else if (typeof value === 'boolean' && value === true) {
        target[key] = true;
      }
    }
  }

  extractNumericByRegex(text: string): Partial<ExtractedFields> {
    const fields: Partial<ExtractedFields> = {};

    // Extract amounts: "50万元", "500,000元", "50万"
    const amountMatch = text.match(/(\d[\d,]*(?:\.\d+)?)\s*万?\s*元/);
    if (amountMatch) {
      const raw = amountMatch[1].replace(/,/g, '');
      let amount = parseFloat(raw);
      if (amountMatch[0].includes('万')) {
        amount *= 10000;
      }
      fields.budgetAmount = amount;
    }

    // Extract publicity days: "公示期5个工作日", "公示5天"
    const daysMatch = text.match(
      /公示[期]?\s*(?:不少[于于]?\s*)?(\d+)\s*(?:个\s*)?(?:工作日|天|日)/,
    );
    if (daysMatch) {
      fields.publicityDays = parseInt(daysMatch[1], 10);
    }

    return fields;
  }
}
