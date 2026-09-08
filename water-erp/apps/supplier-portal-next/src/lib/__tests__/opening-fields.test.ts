import test from "node:test";
import assert from "node:assert/strict";
import {
  FALLBACK_FIELDS,
  formatBidSubmissionPrice,
  formatOpeningAmount,
  openingColumnLabel,
  openingColumnWidth,
  openingRecordCell,
  otherOpeningRows,
  resolveOpeningFields,
  type OpeningFieldDef,
} from "../opening-fields";

/** 法定四列历史标签契约（默认态零漂移铁律：与公开总表表头逐字一致；
 *  P1-C 2026-09-08 amount 去「（元）」后缀——值自带单位，消表头/值单位矛盾） */
const STATUTORY_LABEL_CONTRACT: Array<[string, string]> = [
  ["amount", "报价"],
  ["period", "工期"],
  ["qualityTarget", "质量目标"],
  ["bondStatus", "保证金"],
];

test("A-113 resolveOpeningFields：config 缺失回退默认四列（=现状列序）", () => {
  for (const empty of [null, undefined, [] as OpeningFieldDef[]]) {
    assert.deepEqual(
      resolveOpeningFields(empty).map((f) => f.key),
      ["amount", "period", "qualityTarget", "bondStatus"],
    );
  }
  // 回退即 FALLBACK_FIELDS（后端 DEFAULT_OPENING_FIELDS 的渲染镜像）
  assert.deepEqual(resolveOpeningFields(null), [...FALLBACK_FIELDS]);
});

test("A-113 resolveOpeningFields：非空 config 原样透传（含调序与动态键）", () => {
  const configured: OpeningFieldDef[] = [
    { key: "amount", label: "报价", type: "text" },
    { key: "technicalProposal", label: "技术方案概述", type: "text" },
    { key: "period", label: "工期", type: "text" },
  ];
  const resolved = resolveOpeningFields(configured);
  assert.deepEqual(resolved.map((f) => f.key), ["amount", "technicalProposal", "period"]);
  // 返回副本，改返回值不动入参（页面 memo 依赖引用稳定性）
  resolved.push({ key: "x", label: "x", type: "text" });
  assert.equal(configured.length, 3);
});

test("A-113 法定四列标签/列宽走本页历史口径（默认态零漂移契约）", () => {
  for (const [key, label] of STATUTORY_LABEL_CONTRACT) {
    const f: OpeningFieldDef = { key, label: `config-${key}`, type: "text" };
    assert.equal(openingColumnLabel(f), label, `${key} 标签须用历史措辞而非 config 标签`);
  }
  assert.equal(openingColumnWidth({ key: "amount", label: "报价", type: "text" }), "w-amount");
  assert.equal(openingColumnWidth({ key: "period", label: "工期", type: "text" }), "w-period");
  assert.equal(openingColumnWidth({ key: "qualityTarget", label: "质量承诺", type: "text" }), "w-quality");
  assert.equal(openingColumnWidth({ key: "bondStatus", label: "保证金", type: "select" }), "w-bond");
});

test("A-113 动态列：标签用 config、无固定列宽、取值走 customFields 空显 '—'", () => {
  const f: OpeningFieldDef = { key: "technicalProposal", label: "技术方案概述", type: "text" };
  assert.equal(openingColumnLabel(f), "技术方案概述");
  assert.equal(openingColumnWidth(f), undefined);
  assert.equal(openingRecordCell(f, { customFields: { technicalProposal: "明挖+顶管结合" } }), "明挖+顶管结合");
  assert.equal(openingRecordCell(f, { customFields: {} }), "—");
  assert.equal(openingRecordCell(f, { customFields: { technicalProposal: "" } }), "—");
  assert.equal(openingRecordCell(f, null), "—");
});

test("A-113 法定列取值走专属列原值（空值维持空渲染，不加 '—' 兜底）", () => {
  const row = { amount: "4200000", period: null, customFields: { amount: "不该被读" } };
  assert.equal(openingRecordCell({ key: "amount", label: "报价", type: "text" }, row), "4200000");
  assert.equal(openingRecordCell({ key: "period", label: "工期", type: "text" }, row), null);
  assert.equal(openingRecordCell({ key: "bondStatus", label: "保证金", type: "select" }, null), null);
});

test("P1-1：开标记录金额展示——裸数字千分位+元，带单位原文直出", () => {
  assert.equal(formatOpeningAmount("1485000"), "1,485,000 元");
  assert.equal(formatOpeningAmount("1080万元"), "1080万元");
  assert.equal(formatOpeningAmount(""), "—");
});

test("P1-C：投递报价格式化——bidPriceInYuan 千分位+元、带单位原文直出、空占位", () => {
  assert.equal(formatBidSubmissionPrice(null, 10800000), "10,800,000 元");
  assert.equal(formatBidSubmissionPrice("1080万元", null), "1080万元");
  assert.equal(formatBidSubmissionPrice("1485000", null), "1,485,000 元");
  assert.equal(formatBidSubmissionPrice("", null), "—");
});

test("A-113 otherOpeningRows：仅取 config 动态键且有值者（法定键/空值排除；无 customFields 不渲染）", () => {
  const fields = resolveOpeningFields([
    { key: "amount", label: "报价", type: "text" },
    { key: "projectManager", label: "项目负责人", type: "text" },
    { key: "emptyKey", label: "空值字段", type: "text" },
  ]);
  const record = {
    customFields: { amount: "4200000", projectManager: "张三", emptyKey: "" },
  };
  assert.deepEqual(otherOpeningRows(fields, record), [
    { key: "projectManager", label: "项目负责人", value: "张三" },
  ]);
  assert.deepEqual(otherOpeningRows(fields, { customFields: null }), []);
  assert.deepEqual(otherOpeningRows(fields, null), []);
  assert.deepEqual(otherOpeningRows(fields, {}), []);
});
