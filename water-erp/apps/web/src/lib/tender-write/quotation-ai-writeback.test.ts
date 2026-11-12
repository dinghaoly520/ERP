import test from "node:test";
import assert from "node:assert/strict";

import { planQuotationBatchWriteBack, QUOTATION_TEXT_VERSION_PROMPT } from "./quotation-ai-writeback";

const TAB_ROW = "便携式全液压岩心钻机主机\t800型，钻进深度NQ≥800m\t台\t1\t____\t____";
const PARAGRAPH = "我方就本项目所供设备逐项报价如下：1. 便携式全液压岩心钻机1台，规格800型，单价____元，合价____元。";

test("planQuotationBatchWriteBack：双版本齐生成——默认先使用表格（type=table），段落同时落字符串", () => {
  const plan = planQuotationBatchWriteBack(`${TAB_ROW}\n液压卷扬机\t单绳提升力≥30kN\t台\t1\t____\t____`, PARAGRAPH);
  assert.equal(plan.quotationLetterType, "table");
  assert.equal(plan.quotationLetter, PARAGRAPH);
  assert.equal(plan.quotationTable?.rows, 3); // 表头 + 2 数据行
  assert.equal(plan.quotationTable?.cells[1][0].content, "便携式全液压岩心钻机主机");
});

test("planQuotationBatchWriteBack：表格版解析失败退文字模式（内容决定展示模式）", () => {
  const plan = planQuotationBatchWriteBack("本项目报价以成交总价为准，总报价人民币____元整。", PARAGRAPH);
  assert.equal(plan.quotationLetterType, "text");
  assert.equal(plan.quotationLetter, PARAGRAPH);
  assert.equal(plan.quotationTable, undefined);
});

test("planQuotationBatchWriteBack：文字版失败的兜底——仅表格版可用时保持默认表格", () => {
  const plan = planQuotationBatchWriteBack(TAB_ROW, "");
  assert.equal(plan.quotationLetterType, "table");
  assert.equal(plan.quotationLetter, undefined);
  assert.equal(plan.quotationTable?.rows, 2);
});

test("QUOTATION_TEXT_VERSION_PROMPT：文字版提示词为叙述性口径（与编辑器单字段 AI 同源）", () => {
  assert.ok(QUOTATION_TEXT_VERSION_PROMPT.includes("必须采用叙述性文字表达"));
  assert.ok(!QUOTATION_TEXT_VERSION_PROMPT.includes("必须以制表符"));
});
