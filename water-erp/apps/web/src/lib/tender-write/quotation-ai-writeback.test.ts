import test from "node:test";
import assert from "node:assert/strict";

import { planQuotationWriteBack, resolveQuotationAiMode } from "./quotation-ai-writeback";

const TAB_ROW = "便携式全液压岩心钻机主机\t800型，钻进深度NQ≥800m\t台\t1\t____\t____";

test("planQuotationWriteBack：文字模式产物原样落文字（不解析表格）", () => {
  const plan = planQuotationWriteBack("text", `1. 便携式钻机，规格800型，单位台，数量1台，单价____元。`);
  assert.equal(plan.kind, "text");
  assert.ok(plan.kind === "text" && plan.text.includes("单价____"));
});

test("planQuotationWriteBack：表格模式 Tab 行解析落表格（表头列序固定）", () => {
  const plan = planQuotationWriteBack("table", `${TAB_ROW}\n液压卷扬机\t单绳提升力≥30kN\t台\t1\t____\t____`);
  assert.equal(plan.kind, "table");
  if (plan.kind !== "table") return;
  assert.equal(plan.table.rows, 3); // 表头 + 2 数据行
  assert.equal(plan.table.cells[0][0].content, "名称");
  assert.equal(plan.table.cells[1][0].content, "便携式全液压岩心钻机主机");
});

test("planQuotationWriteBack：表格模式解析失败回退文字形态（内容决定展示模式）", () => {
  const plan = planQuotationWriteBack("table", "本项目报价以成交总价为准，总报价人民币____元整。");
  assert.equal(plan.kind, "text");
});

test("resolveQuotationAiMode：显式存值优先，未设默认表格（批量只跑空字段）", () => {
  assert.equal(resolveQuotationAiMode("text"), "text");
  assert.equal(resolveQuotationAiMode("table"), "table");
  assert.equal(resolveQuotationAiMode(undefined), "table");
  assert.equal(resolveQuotationAiMode("legacy-garbage"), "table");
});
