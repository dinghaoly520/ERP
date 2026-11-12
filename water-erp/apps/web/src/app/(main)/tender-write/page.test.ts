import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * CR-01（2026-11-12 代码审查移交）：报价模式归一化的设计契约是「所有草稿恢复路径
 * 统一收口过 sanitize」（storage.ts normalizeQuotationMode · 2026-11-12 用户裁定
 * 「优先默认使用表格」）——预览 isQuotationTableMode 与服务端 resolveQuotationMode
 * 对缺失 quotationLetterType 一律按表格渲染。历史应用/版本恢复两条路径若直铺
 * 存量草稿（字段引入前保存的文字报价），真文字会被渲染成空表、且从导出 docx
 * 的报价分支消失。本测试锁定两条路径必须经 sanitize。
 */
const page = readFileSync(
  resolve("src/app/(main)/tender-write/page.tsx"),
  "utf8",
);
const modal = readFileSync(
  resolve("src/components/projects/tender-write-modal.tsx"),
  "utf8",
);

test("CR-01: 历史应用路径过 sanitize——handleApplyHistory 的 draftData 先消毒再入 state", () => {
  const fn = page.match(/const handleApplyHistory =[\s\S]*?\n  };/)?.[0] ?? "";
  assert.ok(fn, "handleApplyHistory 函数应存在");
  assert.match(fn, /sanitizeTenderDraft\(/);
  assert.doesNotMatch(
    fn,
    /\.\.\.record\.draftData/,
    "直铺 record.draftData（未消毒）形态不得回归——存量旧格式草稿会绕过报价模式归一化",
  );
});

test("CR-01: 版本恢复路径过 sanitize——setDrafts(entry.drafts) 须包 sanitizeTenderDraftsState", () => {
  assert.doesNotMatch(
    modal,
    /setDrafts\(entry\.drafts\)/,
    "裸 setDrafts(entry.drafts)（未消毒）形态不得回归",
  );
  assert.match(modal, /setDrafts\(sanitizeTenderDraftsState\(entry\.drafts\)\)/);
});
