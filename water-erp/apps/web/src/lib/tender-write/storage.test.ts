import test from "node:test";
import assert from "node:assert/strict";

import {
  createEmptyTenderDrafts,
} from "./templates";
import {
  beginTenderWriteSession,
  createTenderWriteSessionId,
  readTenderWriteState,
  sanitizeTenderDraft,
  tenderDraftStorageKey,
  writeTenderWriteState,
} from "./storage";

class LocalStorageMock {
  private store = new Map<string, string>();

  getItem(key: string) {
    return this.store.get(key) ?? null;
  }

  setItem(key: string, value: string) {
    this.store.set(key, value);
  }

  removeItem(key: string) {
    this.store.delete(key);
  }

  clear() {
    this.store.clear();
  }
}

test("initial null state write does not erase a saved tender-write draft", () => {
  const localStorage = new LocalStorageMock();
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { localStorage },
  });

  const sessionId = createTenderWriteSessionId();
  beginTenderWriteSession(sessionId);

  const savedDrafts = createEmptyTenderDrafts();
  savedDrafts.COMPETITIVE_NEGOTIATION.projectName = "正在填写的项目";
  writeTenderWriteState({
    selectedType: "COMPETITIVE_NEGOTIATION",
    drafts: savedDrafts,
  });

  writeTenderWriteState({
    selectedType: null,
    drafts: createEmptyTenderDrafts(),
  });

  const restored = readTenderWriteState();
  assert.equal(restored.selectedType, "COMPETITIVE_NEGOTIATION");
  assert.equal(
    restored.drafts.COMPETITIVE_NEGOTIATION.projectName,
    "正在填写的项目",
  );

  delete (globalThis as { window?: unknown }).window;
});

test("new tender-write login session starts from type selection", () => {
  const localStorage = new LocalStorageMock();
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { localStorage },
  });

  const firstSessionId = createTenderWriteSessionId();
  beginTenderWriteSession(firstSessionId);

  const savedDrafts = createEmptyTenderDrafts();
  savedDrafts.COMPETITIVE_NEGOTIATION.projectName = "上次登录的项目";
  writeTenderWriteState({
    selectedType: "COMPETITIVE_NEGOTIATION",
    drafts: savedDrafts,
  });

  const nextSessionId = createTenderWriteSessionId();
  beginTenderWriteSession(nextSessionId);

  const restored = readTenderWriteState();
  assert.equal(restored.selectedType, null);
  assert.equal(restored.drafts.COMPETITIVE_NEGOTIATION.projectName, "");

  delete (globalThis as { window?: unknown }).window;
});

// 2026-10-28 二轮隔离：项目草稿缓存键按轮后缀（R1 沿用旧键=存量不迁移不丢）
test("tenderDraftStorageKey: round 1 keeps legacy key, round>1 gets :R{n} suffix", () => {
  assert.equal(tenderDraftStorageKey("pm-1", 1), "tender-write:project-drafts:v1:pm-1");
  assert.equal(tenderDraftStorageKey("pm-1", 2), "tender-write:project-drafts:v1:pm-1:R2");
  assert.equal(tenderDraftStorageKey("pm-1", 3), "tender-write:project-drafts:v1:pm-1:R3");
  // 轮键互不串读：R2 键不覆盖 R1 旧键
  assert.notEqual(tenderDraftStorageKey("pm-1", 2), tenderDraftStorageKey("pm-1", 1));
});

/** 报价表模式归一化（2026-11-12 用户裁定「优先默认使用表格」）：
 *  ① 文字模式下字符串实为 Tab 表格行（旧批量通道写入的错形残留）→ 收敛表格模式，
 *     表格无数据行时用残留文本转表；② 未设模式 → 默认表格，真文字（无 Tab）保文字。 */
test("sanitizeTenderDraft: 报价表 text+Tab 残留收敛表格模式并转表", () => {
  const out = sanitizeTenderDraft({
    quotationLetterType: "text",
    quotationLetter: "钻机\t800型\t台\t1\t____\t____\n动力站\t80kW\t套\t1\t____\t____",
  });
  assert.equal(out.quotationLetterType, "table");
  const tbl = out.quotationLetterTable as { cells: string[][] } & { cells: { content: string }[][] };
  assert.equal(tbl.cells.length, 3); // 表头 + 2 数据行
  assert.equal(tbl.cells[1][0].content, "钻机");
});

test("sanitizeTenderDraft: 报价表 text+Tab 残留但表格已有数据——只翻模式不覆盖表", () => {
  const existing = { rows: 2, cols: 6, cells: [
    [{ content: "名称", rowSpan: 1, colSpan: 1, align: "center" }],
    [{ content: "已有数据行", rowSpan: 1, colSpan: 1, align: "center" }],
  ] };
  const out = sanitizeTenderDraft({
    quotationLetterType: "text",
    quotationLetter: "钻机\t800型\t台\t1",
    quotationLetterTable: existing,
  });
  assert.equal(out.quotationLetterType, "table");
  assert.equal(out.quotationLetterTable, existing); // 引用不变=未重转表
});

test("sanitizeTenderDraft: 报价表 text+真段落不受扰动", () => {
  const out = sanitizeTenderDraft({
    quotationLetterType: "text",
    quotationLetter: "我方就本项目报价如下：1. 钻机1台，单价____元。",
  });
  assert.equal(out.quotationLetterType, "text");
  assert.equal(out.quotationLetterTable, undefined);
});

test("sanitizeTenderDraft: 报价表未设模式——空内容默认表格", () => {
  const out = sanitizeTenderDraft({ quotationLetter: "" });
  assert.equal(out.quotationLetterType, "table");
});

test("sanitizeTenderDraft: 报价表未设模式——真文字保文字模式（内容保护）", () => {
  const out = sanitizeTenderDraft({ quotationLetter: "老草稿的手写报价文字" });
  assert.equal(out.quotationLetterType, "text");
});

test("sanitizeTenderDraft: 报价表显式表格不扰动、无报价字段不注入", () => {
  const out1 = sanitizeTenderDraft({ quotationLetterType: "table", quotationLetter: "" });
  assert.equal(out1.quotationLetterType, "table");
  const out2 = sanitizeTenderDraft({ projectName: "某项目" });
  assert.equal(out2.quotationLetterType, undefined);
});
