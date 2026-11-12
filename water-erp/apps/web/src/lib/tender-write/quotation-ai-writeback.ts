import type { TableData } from "../types/tender-write";
import { parseQuotationTextToTable } from "../../components/tender-write/quotation-table-editor";

/**
 * 报价表批量 AI 写回策略（2026-11-12 用户裁定：填入文字/设计表格两种模式的 AI 产物形态必须区分）。
 * 编辑器单字段 AI 已按模式分流（2026-11-04 裁定）；打开弹窗批量生成与「智能填入未填项」
 * 两个批量通道经本模块收敛到同口径——模式决定提示词（见 getAiGenerationFields）与写回形态。
 */

/** 批量通道的报价表模式判定：显式存值优先，未设默认表格（报价表优先表格，2026-09-09 拍板；
 * 批量只对空字段发起生成，无需字符串存量回退分支）。 */
export function resolveQuotationAiMode(typeValue: unknown): "text" | "table" {
  return typeValue === "text" ? "text" : "table";
}

export type QuotationWriteBack =
  | { kind: "text"; text: string }
  | { kind: "table"; table: TableData };

/**
 * 生成结果按模式落形：
 * - 文字模式：原样落文字，不解析表格；
 * - 表格模式：Tab/分隔行解析落表格；解析失败回退文字形态（内容决定展示模式——
 *   避免把不可解析的文字灌进表格模式的字符串字段，切「填入文字」时暴露错形内容）。
 */
export function planQuotationWriteBack(mode: "text" | "table", content: string): QuotationWriteBack {
  if (mode === "text") return { kind: "text", text: content };
  const table = parseQuotationTextToTable(content);
  return table ? { kind: "table", table } : { kind: "text", text: content };
}
