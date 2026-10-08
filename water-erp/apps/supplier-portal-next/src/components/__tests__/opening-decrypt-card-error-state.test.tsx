import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

/**
 * P1-8（三门户开评标中断风险审查 2026-09-30）：解密卡可见性单点静默依赖
 * getOpeningRecord——一次瞬时失败整卡消失零提示。契约：
 *  - 卡组件接受 recordError/onRetry，首载失败且未知投递态时渲染错误态+重试，不得静默 return null
 *  - 大厅页区分「拉取失败」与「确无记录」（正常无记录是 HTTP 200 + null），
 *    失败保留上次成功记录（勿抹成 null）、置错误标志
 */
const cardSource = readFileSync(
  new URL("../../components/opening-decrypt-card.tsx", import.meta.url),
  "utf8",
);
const pageSource = readFileSync(
  new URL("../../app/(main)/my-bids/[projectId]/opening-hall/page.tsx", import.meta.url),
  "utf8",
);

test("decrypt card accepts recordError/onRetry props", () => {
  assert.match(cardSource, /recordError\?: boolean/);
  assert.match(cardSource, /onRetry\?: \(\) => void/);
});

test("decrypt card renders an error+retry state instead of vanishing on record fetch failure", () => {
  assert.match(cardSource, /recordError && !submitted/);
  assert.match(cardSource, /重新加载/);
  // 旧静默消失门（!submitted 一刀切 return null）不得原样保留
  assert.doesNotMatch(cardSource, /if \(!isOpening \|\| !submitted \|\| isDualTrack === false\) return null;/);
});

test("opening hall page distinguishes record fetch failure from a genuine no-record response", () => {
  assert.match(pageSource, /setRecordError\(true\)/);
  assert.match(pageSource, /setRecordError\(false\)/);
  // 失败不再吞为 null 抹掉上次成功记录（解密卡随 submitted=false 消失的根因）
  assert.doesNotMatch(pageSource, /getOpeningRecord\(projectId\)\.catch\(\(\) => null\)/);
  // 失败保留旧记录、成功才覆盖
  assert.match(pageSource, /if \(recRes\.ok\) setRecord\(recRes\.r\)/);
});

test("opening hall page passes recordError and onRetry into the decrypt card", () => {
  assert.match(pageSource, /recordError=\{recordError\}/);
  assert.match(pageSource, /onRetry=\{/);
});
