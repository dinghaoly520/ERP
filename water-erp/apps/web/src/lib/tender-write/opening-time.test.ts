import test from "node:test";
import assert from "node:assert/strict";

// @ts-expect-error Node 原生 --test 的 ESM 解析需要显式 .ts 扩展；tsc（bundler 分辨）不接受——压此行
import { toDateInputValue, toDatetimeLocalValue, openingTimeFromSources } from "./opening-time.ts";

test("toDateInputValue：中文日期/仅日期/ISO 互转，垃圾返空", () => {
  assert.equal(toDateInputValue("2026年4月17日"), "2026-04-17");
  assert.equal(toDateInputValue("2026-04-17"), "2026-04-17");
  assert.equal(toDateInputValue("见公告"), "");
});

test("toDatetimeLocalValue：库内真实格式全覆盖（含单位数时 9:00）", () => {
  // PMI.bidOpeningTime 实存格式（2026-10-29 库内实录）
  assert.equal(toDatetimeLocalValue("2026年4月17日9:00"), "2026-04-17T09:00");
  assert.equal(toDatetimeLocalValue("2026年5月15日14:00"), "2026-05-15T14:00");
  // 模板长格式 / 仅日期 / ISO 家族
  assert.equal(toDatetimeLocalValue("2026年10月20日14时00分00秒"), "2026-10-20T14:00");
  assert.equal(toDatetimeLocalValue("2026年3月23日"), "2026-03-23T00:00");
  assert.equal(toDatetimeLocalValue("2026-03-23T09:00"), "2026-03-23T09:00");
  // 带秒/毫秒的 ISO：合法值截断到分钟透传（勿误判非法而重取来源）
  assert.equal(toDatetimeLocalValue("2026-03-23T09:00:00"), "2026-03-23T09:00");
  assert.equal(toDatetimeLocalValue("2026-03-23T09:00:00.123"), "2026-03-23T09:00");
  assert.equal(toDatetimeLocalValue("见公告"), "");
});

test("openingTimeFromSources：合法 ISO current 原样保留（用户已填优先）", () => {
  assert.equal(openingTimeFromSources("2026-12-01T10:00", "2026年5月15日14:00", "2026-11-01T09:00"), "2026-12-01T10:00");
});

test("openingTimeFromSources：缓存中毒自愈（2026-10-29 加固）——中文 current 归一后采用，不再原样放行", () => {
  // 历史 bug：docx 中文原文覆盖进向导缓存，旧逻辑「非空即返回」使 datetime-local 永远丢弃
  assert.equal(openingTimeFromSources("2026年5月15日14:00", "2026年4月17日9:00", "2026-11-01T09:00"), "2026-05-15T14:00");
});

test("openingTimeFromSources：不可解析 current 视作空——采购文件草稿 → 项目基本信息 链重取", () => {
  assert.equal(openingTimeFromSources("见公告", "2026年4月17日9:00", "2026-11-20T14:30"), "2026-11-20T14:30");
  assert.equal(openingTimeFromSources("见公告", "2026年4月17日9:00", ""), "2026-04-17T09:00");
  assert.equal(openingTimeFromSources("", "", ""), "");
});
