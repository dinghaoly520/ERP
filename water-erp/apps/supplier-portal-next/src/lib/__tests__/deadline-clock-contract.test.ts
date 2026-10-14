import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const submissionSource = readFileSync(
  resolve("src/app/(main)/bids/[id]/submit/page.tsx"),
  "utf8",
);
const quoteSource = readFileSync(
  resolve("src/app/(main)/bids/[id]/round-quote/page.tsx"),
  "utf8",
);

test("round-quote deadlines use the synchronized server clock", () => {
  // 旧 legacy 提交页（完整标书/拆分）已整体移除（2026-10-14 代解密清除）——
  // 投标截止倒计时由详情页 serverNow 驱动；本契约对象收敛为报价轮次页
  assert.match(quoteSource, /serverNowMs\(\)/);
  assert.doesNotMatch(quoteSource, /new Date\(\) > new Date\(r\.deadline\)/);
});
