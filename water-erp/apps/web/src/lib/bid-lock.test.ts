import test from "node:test";
import assert from "node:assert/strict";

// @ts-expect-error Node 原生 --test 的 ESM 解析需要显式 .ts 扩展；tsc（bundler 分辨）不接受——压此行
import { roundBidOpened, latestBidOpened } from "./bid-lock.ts";

const bp = (round: number, stage: string) => ({ round, stage });

test("roundBidOpened：该轮已启动开标（OPENING/EVALUATING/ARCHIVED）→ true", () => {
  for (const stage of ["OPENING", "EVALUATING", "ARCHIVED"]) {
    assert.equal(roundBidOpened([bp(1, stage)], 1), true);
  }
});

test("roundBidOpened：未启动（DOWNLOAD/SUBMIT）→ false——到达开标确认页不锁（修复主径）", () => {
  assert.equal(roundBidOpened([bp(1, "SUBMIT")], 1), false);
  assert.equal(roundBidOpened([bp(1, "DOWNLOAD")], 1), false);
});

test("roundBidOpened：该轮流标（ABORTED）→ false——流标轮穿闸可重开，对齐后端 reopenStage", () => {
  assert.equal(roundBidOpened([bp(1, "ABORTED")], 1), false);
});

test("roundBidOpened：无 bp / round 未命中 → false（未发公告项目不因开标锁）", () => {
  assert.equal(roundBidOpened([], 1), false);
  assert.equal(roundBidOpened([bp(1, "OPENING")], 2), false);
});

test("roundBidOpened：round 归一（null/undefined 视为 1，与组件 (s.round ?? 1) 同式）", () => {
  assert.equal(roundBidOpened([{ round: null, stage: "OPENING" }], 1), true);
});

test("latestBidOpened：多轮取最新非流标轮——最新轮 SUBMIT → false（旧轮状态不代管）", () => {
  assert.equal(latestBidOpened([bp(1, "OPENING"), bp(2, "SUBMIT")]), false);
});

test("latestBidOpened：最新非流标轮 OPENING → true；全流标/空 → false", () => {
  assert.equal(latestBidOpened([bp(1, "ABORTED"), bp(2, "OPENING")]), true);
  assert.equal(latestBidOpened([bp(1, "ABORTED")]), false);
  assert.equal(latestBidOpened([]), false);
});
