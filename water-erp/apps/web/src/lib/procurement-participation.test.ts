import test from "node:test";
import assert from "node:assert/strict";

// @ts-expect-error Node 原生 --test 的 ESM 解析需要显式 .ts 扩展；tsc（bundler 分辨）不接受——压此行
import { isPublicEnrollMethod, isOpeningPassed, filterPublicEnrollRows } from "./procurement-participation.ts";

test("isPublicEnrollMethod：公告型三方式命中，邀请域/谈判不命中", () => {
  for (const m of ["公开招标", "询比采购", "竞价采购"]) assert.equal(isPublicEnrollMethod(m), true);
  for (const m of ["邀请招标", "直接采购", "谈判采购"]) assert.equal(isPublicEnrollMethod(m), false);
  assert.equal(isPublicEnrollMethod(null), false);
  assert.equal(isPublicEnrollMethod(undefined), false);
  assert.equal(isPublicEnrollMethod(""), false);
});

test("isOpeningPassed：确认开标（stage OPENING/EVALUATING/ARCHIVED）恒过点，无需看时间", () => {
  for (const stage of ["OPENING", "EVALUATING", "ARCHIVED"]) {
    assert.equal(isOpeningPassed({ stage, openTime: null }), true);
  }
});

test("isOpeningPassed：未确认时按时间读侧判定——now ≥ 开标时间即过点（延时开标自动外移）", () => {
  const openTime = "2026-11-26T10:00:00+08:00";
  assert.equal(isOpeningPassed({ stage: "SUBMIT", openTime, now: new Date("2026-11-26T10:00:01+08:00").getTime() }), true);
  assert.equal(isOpeningPassed({ stage: "SUBMIT", openTime, now: new Date("2026-11-26T09:59:59+08:00").getTime() }), false);
  // 延时开标重写开标时间后，原时点不再触发收窄
  const delayed = "2026-11-26T14:00:00+08:00";
  assert.equal(isOpeningPassed({ stage: "SUBMIT", openTime: delayed, now: new Date("2026-11-26T10:00:01+08:00").getTime() }), false);
  // 无开标时间且未确认 → 未过点
  assert.equal(isOpeningPassed({ stage: "SUBMIT", openTime: null }), false);
  assert.equal(isOpeningPassed({ stage: null, openTime: "not-a-date" }), false);
});

const rows = [
  { name: "甲·仅下载", intentConfirmedAt: null, submitted: false },
  { name: "乙·已拟参与", intentConfirmedAt: "2026-11-25T09:00:00Z", submitted: false },
  { name: "丙·拟参与并投递", intentConfirmedAt: "2026-11-25T09:00:00Z", submitted: true },
  { name: "丁·投递后撤回", intentConfirmedAt: "2026-11-25T09:00:00Z", submitted: false },
  { name: "戊·仅登记未响应", intentConfirmedAt: null, submitted: false },
];

test("filterPublicEnrollRows：开标前只保留拟参与（下载/登记未响应剔除）", () => {
  assert.deepEqual(
    filterPublicEnrollRows(rows, false).map((r) => r.name),
    ["乙·已拟参与", "丙·拟参与并投递", "丁·投递后撤回"],
  );
});

test("filterPublicEnrollRows：开标后收窄为已投递标书（撤回/未投递剔除，与拟参与无关）", () => {
  assert.deepEqual(
    filterPublicEnrollRows(rows, true).map((r) => r.name),
    ["丙·拟参与并投递"],
  );
  // 无意向记录但已投递（历史/特殊路径）——开标后以投递事实为准仍保留
  assert.deepEqual(filterPublicEnrollRows([{ intentConfirmedAt: null, submitted: true }], true), [
    { intentConfirmedAt: null, submitted: true },
  ]);
});
