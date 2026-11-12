import type { TableData } from "../types/tender-write";
import { parseQuotationTextToTable } from "./quotation-table-text";
import { QUOTATION_TEXT_AI_PROMPT } from "./templates";

/**
 * 报价表批量 AI 双版本生成策略（2026-11-12 用户裁定）：
 * 「智能填入未填项」与打开弹窗批量生成时，报价表**表格版与文字版一起生成**——
 * 表格版（模板字段 aiPrompt 的 Tab 制式提示词 → 转表）+ 文字版（叙述性提示词 → 段落），
 * 一次到位；展示**默认先用表格**（quotationLetterType='table'），用户切「填入文字」
 * 时段落已现成（无需再点一次 AI）。编辑器单字段 AI 仍按当前模式优化对应版本（2026-11-04 分流不变）。
 */

/** 文字版（叙述性段落）提示词——与编辑器单字段 AI 同一份常量，templates.ts 为唯一来源。 */
export const QUOTATION_TEXT_VERSION_PROMPT = QUOTATION_TEXT_AI_PROMPT;

/** 批量双版本生成结果 → 草稿写回计划。 */
export type QuotationBatchWriteBack = {
  /** 展示模式：表格版解析成功恒 table（默认先使用表格）；失败退 text（内容决定模式）。 */
  quotationLetterType: "table" | "text";
  /** 文字版段落（生成成功时写入 quotationLetter；失败时缺省）。 */
  quotationLetter?: string;
  /** 表格版数据（解析成功时写入 quotationLetterTable）。 */
  quotationTable?: TableData;
};

/**
 * 两版生成产物落形：
 * - 表格版可解析 → type='table' + 表格 +（文字版成功的）段落——默认展示表格、切文字模式段落现成；
 * - 表格版解析失败 → type='text' + 段落（内容决定展示模式，不让空表占着默认位）。
 */
export function planQuotationBatchWriteBack(
  tableContent: string,
  textContent: string,
): QuotationBatchWriteBack {
  const table = parseQuotationTextToTable(tableContent);
  if (table) {
    return {
      quotationLetterType: "table",
      ...(textContent.trim() ? { quotationLetter: textContent } : {}),
      quotationTable: table,
    };
  }
  return {
    quotationLetterType: "text",
    ...(textContent.trim() ? { quotationLetter: textContent } : {}),
  };
}
