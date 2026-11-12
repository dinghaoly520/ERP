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
const writeback = readFileSync(
  resolve("src/lib/tender-write/quotation-ai-writeback.ts"),
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

test("CR-01: 「参考上一轮」服务器轨过 sanitize——上一轮服务端草稿入 ref 前消毒（评审补漏的第三路径）", () => {
  assert.doesNotMatch(
    modal,
    /\? \(r\.drafts as TenderDraftsState\) : null/,
    "裸转 r.drafts as TenderDraftsState（未消毒）形态不得回归",
  );
  assert.match(modal, /sanitizeTenderDraftsState\(r\.drafts as TenderDraftsState\)/);
});

test("CR-05: 报价双版本生成不得全有全无——Promise.all 弃用、allSettled 按各自结果落形", () => {
  assert.doesNotMatch(
    modal,
    /await Promise\.all\(\[/,
    "await Promise.all([ 一败全弃形态不得回归（文字版失败连带丢弃已成功的表格版）",
  );
  const allSettledCount = (modal.match(/Promise\.allSettled\(/g) ?? []).length;
  assert.ok(allSettledCount >= 2, `报价双版本两处调用点应均走 allSettled，实测 ${allSettledCount}`);
  assert.match(modal, /settledAiContent/);
  assert.match(writeback, /export function settledAiContent/);
});

test("CR-09: 归档卷弹窗 api 助手须容错 ok-空响应——不得有无守卫的 return res.json()", () => {
  const volumeModal = readFileSync(
    resolve("src/components/procurements/archive-volume-modal.tsx"),
    "utf8",
  );
  // ok 分支无条件 res.json() 会把「端点空体 200」（如 check-latest 无记录时 Express
  // send(null)=空串）炸成 Unexpected end of JSON input，整弹窗加载失败
  assert.doesNotMatch(
    volumeModal,
    /return res\.json\(\);/,
    "无守卫 return res.json(); 不得回归——空体 200 必须容错为 null",
  );
  assert.match(volumeModal, /text \? JSON\.parse\(text\) : null/);
});

test("CR-10: 流标提示条判定须含 abortedAt 臂——对齐后端三臂（联动流标归档行横幅不丢）", () => {
  const panel = readFileSync(
    resolve("src/components/projects/project-detail-panel.tsx"),
    "utf8",
  );
  const bidApi = readFileSync(resolve("src/lib/api/bid.ts"), "utf8");
  const m = panel.match(/const bidAborted =[\s\S]*?;/);
  assert.ok(m, "bidAborted 判定应存在");
  assert.match(
    m[0],
    /abortedAt/,
    "bidAborted 判定须含 abortedAt 显式列臂（CR-03 后端三臂的前端镜像，否则联动流标归档行横幅不显示）",
  );
  assert.match(bidApi, /abortedAt\?: string \| null/);
});

test("CR-11: 项目详情面板 selectedStage 须兜底 stages 空数组——占位行防整页白屏", () => {
  const panel = readFileSync(
    resolve("src/components/projects/project-detail-panel.tsx"),
    "utf8",
  );
  // `?? stages[0]` 在空数组仍 undefined，首个消费 selectedStage.stageKey 即崩；
  // 修法=末臂合成占位行（不得用早退渲染——组件后段仍有 hooks）
  const memo = panel.match(/const selectedStage = useMemo[\s\S]*?\)\);/);
  assert.ok(memo, "selectedStage memo 应存在");
  assert.match(memo[0], /__no_stage__/, "空数组兜底占位行（__no_stage__）不得移除");
});
