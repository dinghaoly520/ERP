import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

/**
 * 确认弹窗 portal 守卫（2026-10-26）：use-confirm 的 dialog 必须 createPortal 到 document.body。
 * 背景：dialog 原地渲染在页面树内，被 shell 的 .sp-content（position:relative + z-index:0）
 * 堆叠上下文困住——z-index:10001 只在该上下文内生效；而申请资料变更弹窗（crp-overlay）、
 * 联系人面板（ct-overlay）等 createPortal 到 body（z 2000，根上下文）——confirm 被压在其下，
 * 「确认」不可见不可点，crSubmit 永远 await 不返回，变更申请提交卡死、弹窗不关闭。
 */
const ROOT = process.cwd();
const hook = readFileSync(join(ROOT, "src/components/use-confirm.tsx"), "utf8");

test("use-confirm 的确认弹窗 createPortal 到 document.body（跨出 .sp-content 堆叠上下文）", () => {
  assert.ok(
    /createPortal\s*\(/.test(hook) && /document\.body/.test(hook),
    "use-confirm.tsx 的 dialog 未 createPortal 到 document.body——将被 .sp-content（z-index:0 堆叠上下文）困住，" +
      "在 body 级弹窗（crp-overlay/ct-overlay，z 2000）之下不可见，确认流程卡死（2026-10-26 申请资料变更弹窗不关闭事故）",
  );
});

test("申请资料变更弹窗仍为 body 级 portal（与 confirm 同层才能被 10001 盖过）", () => {
  const page = readFileSync(join(ROOT, "src/app/(main)/profile/page.tsx"), "utf8");
  assert.ok(/createPortal/.test(page), "profile 页的 crp 弹窗不再是 body portal——分层前提变化，请复核 confirm 层级");
});
